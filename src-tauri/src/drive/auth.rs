//! Tier B — Google identity half: the installed-app OAuth flow (loopback redirect + PKCE), the
//! short-lived access-token cache, refresh-token storage in the OS keyring, and the account lookup.
//! The Drive REST metadata calls live in the parent module ([`super`]); this module only deals with
//! *who* is signed in and handing the rest of Tier B a fresh access token.

use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};

use base64::Engine;
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, State};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

use super::{drive_client, drive_id_cache_file, map_status};
use crate::{error::ResultExt, model::AppState};

// Embedded OAuth client (Google "Desktop app" type). The desktop "secret" is not truly secret
// per Google's own docs — acceptable for an internal tool. Override at build time via env vars.
const GOOGLE_CLIENT_ID: &str = match option_env!("SPINEFORGE_GOOGLE_CLIENT_ID") {
    Some(v) => v,
    None => "PASTE_CLIENT_ID.apps.googleusercontent.com",
};
const GOOGLE_CLIENT_SECRET: &str = match option_env!("SPINEFORGE_GOOGLE_CLIENT_SECRET") {
    Some(v) => v,
    None => "PASTE_CLIENT_SECRET",
};
// `openid email profile` so the token response includes a Google `id_token` we can exchange for a
// Firebase Auth session (metadata sync); `drive.readonly` for Tier-B file metadata.
const SCOPE: &str = "openid email profile https://www.googleapis.com/auth/drive.readonly";

// Keyring location for the long-lived refresh token.
const KEYRING_SERVICE: &str = "spineforge-x";
const KEYRING_ACCOUNT: &str = "gdrive";

/// Cached short-lived access token (refresh token lives in the keyring). `id_token` is the Google
/// OpenID token used to mint a Firebase Auth session; present when `openid` scope was granted.
pub(crate) struct DriveToken {
    pub(crate) access_token: String,
    pub(crate) id_token: Option<String>,
    pub(crate) expires_at: Instant,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DriveAccount {
    email: String,
    display_name: String,
    photo_link: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
    refresh_token: Option<String>,
    id_token: Option<String>,
}

#[derive(Deserialize)]
struct About {
    user: AboutUser,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AboutUser {
    display_name: String,
    email_address: String,
    photo_link: Option<String>,
}

// ---- commands ---------------------------------------------------------------

/// Current signed-in account, or `None` if there's no usable refresh token (never signed in,
/// or it was revoked). Never errors on a missing/expired token so the UI can render "signed out".
#[tauri::command]
pub(crate) async fn drive_account(
    state: State<'_, Arc<AppState>>,
) -> Result<Option<DriveAccount>, String> {
    if read_refresh_token()?.is_none() {
        return Ok(None);
    }
    match fetch_account(&state).await {
        Ok(account) => Ok(Some(account)),
        // Token revoked / network down → treat as signed out rather than surfacing an error.
        Err(_) => Ok(None),
    }
}

/// Run the installed-app OAuth flow: loopback + PKCE, store the refresh token, return the account.
#[tauri::command]
pub(crate) async fn drive_sign_in(
    state: State<'_, Arc<AppState>>,
) -> Result<DriveAccount, String> {
    // Bind the loopback listener first so we know the port for the redirect URI.
    let listener = TcpListener::bind("127.0.0.1:0").await.str_err()?;
    let port = listener.local_addr().str_err()?.port();
    let redirect = format!("http://127.0.0.1:{port}");

    let verifier = random_string(64);
    let challenge = pkce_challenge(&verifier);
    let expected_state = random_string(32);

    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}&access_type=offline&prompt=consent&code_challenge={}&code_challenge_method=S256&state={}",
        enc(GOOGLE_CLIENT_ID),
        enc(&redirect),
        enc(SCOPE),
        challenge,
        expected_state,
    );

    crate::system::open_url(auth_url).await?;

    let code = accept_code(listener, &expected_state).await?;
    let tokens = exchange_code(&code, &verifier, &redirect).await?;
    let refresh = tokens
        .refresh_token
        .clone()
        .ok_or("Google không trả refresh token — hãy thử đăng nhập lại.")?;
    write_refresh_token(&refresh)?;
    cache_access_token(&state, tokens.access_token, tokens.id_token, tokens.expires_in).await;

    fetch_account(&state).await
}

/// Forget the account: clear the keyring entry and any cached state.
#[tauri::command]
pub(crate) async fn drive_sign_out(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    clear_refresh_token()?;
    *state.drive_token.lock().await = None;
    state.drive_file_ids.lock().await.clear();
    *state.drive_roots.lock().await = None;
    // Drop the persisted ID cache so a different account never reuses the previous one's IDs.
    if let Some(path) = drive_id_cache_file(&app) {
        let _ = std::fs::remove_file(path);
    }
    Ok(())
}

/// Google OpenID `id_token` for the signed-in account, to mint a Firebase Auth session. Refreshes
/// the token first (so it's fresh), then returns the cached id token. `None` if the grant carried
/// no id token (e.g. an account that signed in before the `openid` scope was added — it re-signs
/// in to grant it).
#[tauri::command]
pub(crate) async fn drive_id_token(state: State<'_, Arc<AppState>>) -> Result<Option<String>, String> {
    access_token(&state).await?;
    Ok(state.drive_token.lock().await.as_ref().and_then(|t| t.id_token.clone()))
}

// ---- tokens -----------------------------------------------------------------

/// Valid access token: returns the cached one if still fresh, otherwise refreshes via the keyring.
/// The Drive REST half ([`super`]) calls this before every request.
pub(super) async fn access_token(state: &AppState) -> Result<String, String> {
    {
        let guard = state.drive_token.lock().await;
        if let Some(token) = guard.as_ref() {
            if token.expires_at > Instant::now() + Duration::from_secs(30) {
                return Ok(token.access_token.clone());
            }
        }
    }
    let refresh = read_refresh_token()?.ok_or("Chưa đăng nhập Google Drive.")?;
    let tokens = exchange_refresh(&refresh).await?;
    let access = tokens.access_token.clone();
    cache_access_token(state, tokens.access_token, tokens.id_token, tokens.expires_in).await;
    Ok(access)
}

async fn cache_access_token(
    state: &AppState,
    access_token: String,
    id_token: Option<String>,
    expires_in: u64,
) {
    // A refresh-token grant may omit `id_token`; keep the last one we saw so `drive_id_token`
    // still has something to hand Firebase between full sign-ins.
    let prev_id = state.drive_token.lock().await.as_ref().and_then(|t| t.id_token.clone());
    *state.drive_token.lock().await = Some(DriveToken {
        access_token,
        id_token: id_token.or(prev_id),
        expires_at: Instant::now() + Duration::from_secs(expires_in),
    });
}

async fn fetch_account(state: &AppState) -> Result<DriveAccount, String> {
    let token = access_token(state).await?;
    let resp = drive_client()
        .get("https://www.googleapis.com/drive/v3/about")
        .query(&[("fields", "user(displayName,emailAddress,photoLink)")])
        .bearer_auth(&token)
        .send()
        .await
        .str_err()?;
    if !resp.status().is_success() {
        return Err(map_status(resp).await);
    }
    let about: About = resp.json().await.str_err()?;
    Ok(DriveAccount {
        email: about.user.email_address,
        display_name: about.user.display_name,
        photo_link: about.user.photo_link,
    })
}

async fn exchange_code(
    code: &str,
    verifier: &str,
    redirect: &str,
) -> Result<TokenResponse, String> {
    post_token(&[
        ("client_id", GOOGLE_CLIENT_ID),
        ("client_secret", GOOGLE_CLIENT_SECRET),
        ("code", code),
        ("code_verifier", verifier),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect),
    ])
    .await
}

async fn exchange_refresh(refresh: &str) -> Result<TokenResponse, String> {
    post_token(&[
        ("client_id", GOOGLE_CLIENT_ID),
        ("client_secret", GOOGLE_CLIENT_SECRET),
        ("refresh_token", refresh),
        ("grant_type", "refresh_token"),
    ])
    .await
}

async fn post_token(params: &[(&str, &str)]) -> Result<TokenResponse, String> {
    let resp = drive_client()
        .post("https://oauth2.googleapis.com/token")
        .form(params)
        .send()
        .await
        .str_err()?;
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Đổi token Google thất bại: {body}"));
    }
    resp.json::<TokenResponse>().await.str_err()
}

// ---- keyring ----------------------------------------------------------------

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).str_err()
}

fn read_refresh_token() -> Result<Option<String>, String> {
    match keyring_entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn write_refresh_token(token: &str) -> Result<(), String> {
    keyring_entry()?.set_password(token).str_err()
}

fn clear_refresh_token() -> Result<(), String> {
    match keyring_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ---- loopback OAuth redirect ------------------------------------------------

/// Wait for Google to redirect back to the loopback server and return the auth `code`.
/// Tolerates stray requests (favicon, etc.) and verifies the `state` to block CSRF.
async fn accept_code(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    // Cap how long an abandoned attempt (e.g. browser closed before consent) keeps the loopback
    // listener + command alive. The frontend can cancel sooner; this just bounds the orphan.
    let deadline = Duration::from_secs(180);
    loop {
        let (mut stream, _) = tokio::time::timeout(deadline, listener.accept())
            .await
            .map_err(|_| "Hết thời gian chờ đăng nhập Google Drive.".to_string())?
            .str_err()?;

        let mut buf = vec![0u8; 8192];
        let n = stream.read(&mut buf).await.str_err()?;
        let request = String::from_utf8_lossy(&buf[..n]);
        let path = request
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .unwrap_or("");

        let Some(qpos) = path.find('?') else {
            respond(&mut stream, "").await;
            continue;
        };
        let params = parse_query(&path[qpos + 1..]);

        if let Some(err) = params.get("error") {
            respond(&mut stream, "Đăng nhập bị từ chối. Có thể đóng tab này.").await;
            return Err(format!("Google OAuth báo lỗi: {err}"));
        }
        if let (Some(code), Some(state)) = (params.get("code"), params.get("state")) {
            let ok = state == expected_state;
            respond(
                &mut stream,
                if ok {
                    "Đã đăng nhập SpineForge X. Có thể đóng tab này."
                } else {
                    "State không khớp — thử lại."
                },
            )
            .await;
            if !ok {
                return Err("OAuth state không khớp.".to_string());
            }
            return Ok(code.clone());
        }

        respond(&mut stream, "").await;
    }
}

async fn respond(stream: &mut TcpStream, message: &str) {
    let body = format!(
        "<!doctype html><meta charset=utf-8><body style=\"font-family:sans-serif;padding:2rem\">{message}</body>"
    );
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.flush().await;
}

fn parse_query(query: &str) -> HashMap<String, String> {
    query
        .split('&')
        .filter_map(|pair| {
            let (k, v) = pair.split_once('=')?;
            let key = urlencoding::decode(k).ok()?.into_owned();
            let value = urlencoding::decode(v).ok()?.into_owned();
            Some((key, value))
        })
        .collect()
}

// ---- helpers ----------------------------------------------------------------

fn enc(value: &str) -> String {
    urlencoding::encode(value).into_owned()
}

fn random_string(len: usize) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let mut rng = rand::thread_rng();
    (0..len)
        .map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char)
        .collect()
}

fn pkce_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
}
