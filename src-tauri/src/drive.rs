//! Tier B — Google Drive REST API. Tier A reads/writes the Drive *folder* via the
//! mounted filesystem and so can't see who owns a `.spine`, when it last changed, or its
//! revision history; only the Drive API exposes that. This module signs in with Google's
//! installed-app OAuth flow (loopback redirect + PKCE), stores the refresh token in the OS
//! keyring (Windows Credential Manager), and reads file metadata + revisions on demand.
//!
//! All HTTP runs here in Rust (reqwest, native) — the webview never calls googleapis, so no
//! CSP change is needed and the OAuth redirect lands on a localhost socket, not the app.
//!
//! Scope is read-only (`drive.readonly`): enough for owner, modified time, and the revision
//! list; never write/restore. (We need `drive.readonly` rather than the narrower
//! `drive.metadata.readonly` because `drives.list` — used to map a shared-drive name to its ID —
//! only accepts `drive` or `drive.readonly`, not the metadata-only scope.)

use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};

use base64::Engine;
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

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
const SCOPE: &str = "https://www.googleapis.com/auth/drive.readonly";

// Keyring location for the long-lived refresh token.
const KEYRING_SERVICE: &str = "spineforge-x";
const KEYRING_ACCOUNT: &str = "gdrive";

/// Cached short-lived access token (refresh token lives in the keyring).
pub(crate) struct DriveToken {
    pub(crate) access_token: String,
    pub(crate) expires_at: Instant,
}

// ---- public command types ---------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DriveAccount {
    email: String,
    display_name: String,
    photo_link: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DriveRevision {
    id: String,
    modified_time: Option<String>,
    editor_name: Option<String>,
    editor_email: Option<String>,
    size: Option<String>,
}

/// Lightweight per-file metadata for the Library dashboard (owner + modified only, no revisions),
/// returned in bulk so columns can sort across the whole inventory.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DriveBasic {
    rel_path: String,
    owner_email: Option<String>,
    owner_name: Option<String>,
    // Shared-drive files have no per-file owner (the drive owns them), so the dashboard falls back
    // to the last editor — which IS populated — to keep the "Owner" column useful.
    last_editor_email: Option<String>,
    last_editor_name: Option<String>,
    modified_time: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DriveFileInfo {
    owner_email: Option<String>,
    owner_name: Option<String>,
    modified_time: Option<String>,
    last_editor_email: Option<String>,
    last_editor_name: Option<String>,
    size: Option<String>,
    revisions: Vec<DriveRevision>,
}

// ---- Google API response shapes --------------------------------------------

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
    refresh_token: Option<String>,
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserRef {
    display_name: Option<String>,
    email_address: Option<String>,
}

#[derive(Deserialize)]
struct DriveList {
    #[serde(default)]
    drives: Vec<DriveItem>,
}

#[derive(Deserialize)]
struct DriveItem {
    id: String,
    name: String,
}

#[derive(Deserialize)]
struct FileList {
    #[serde(default)]
    files: Vec<FileItem>,
}

#[derive(Deserialize)]
struct FileItem {
    id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileMeta {
    #[serde(default)]
    owners: Vec<UserRef>,
    modified_time: Option<String>,
    last_modifying_user: Option<UserRef>,
    size: Option<String>,
}

#[derive(Deserialize)]
struct RevList {
    #[serde(default)]
    revisions: Vec<RevItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RevItem {
    id: String,
    modified_time: Option<String>,
    last_modifying_user: Option<UserRef>,
    size: Option<String>,
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
    cache_access_token(&state, tokens.access_token, tokens.expires_in).await;

    fetch_account(&state).await
}

/// Forget the account: clear the keyring entry and any cached state.
#[tauri::command]
pub(crate) async fn drive_sign_out(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    clear_refresh_token()?;
    *state.drive_token.lock().await = None;
    state.drive_file_ids.lock().await.clear();
    *state.drive_roots.lock().await = None;
    Ok(())
}

/// Owner, last-modified, and revision history for a `.spine`, looked up by its path relative to
/// the Shared drives mount (e.g. `FD/[FD] Animation/hero/hero.spine`): the first segment is the
/// shared-drive name, the rest are folder names. File IDs are cached per session.
#[tauri::command]
pub(crate) async fn drive_file_metadata(
    state: State<'_, Arc<AppState>>,
    rel_path: String,
) -> Result<DriveFileInfo, String> {
    let file_id = resolve_file_id(&state, &rel_path).await?;
    let token = access_token(&state).await?;
    let client = reqwest::Client::new();

    let meta_resp = client
        .get(format!("https://www.googleapis.com/drive/v3/files/{file_id}"))
        .query(&[
            ("supportsAllDrives", "true"),
            (
                "fields",
                "owners(displayName,emailAddress),modifiedTime,lastModifyingUser(displayName,emailAddress),size",
            ),
        ])
        .bearer_auth(&token)
        .send()
        .await
        .str_err()?;
    if !meta_resp.status().is_success() {
        return Err(map_status(meta_resp).await);
    }
    let meta: FileMeta = meta_resp.json().await.str_err()?;

    // Revisions are best-effort: a missing list shouldn't fail the whole lookup.
    let rev_resp = client
        .get(format!("https://www.googleapis.com/drive/v3/files/{file_id}/revisions"))
        .query(&[
            (
                "fields",
                "revisions(id,modifiedTime,lastModifyingUser(displayName,emailAddress),size)",
            ),
            ("pageSize", "1000"),
        ])
        .bearer_auth(&token)
        .send()
        .await
        .str_err()?;
    let mut revisions: Vec<DriveRevision> = if rev_resp.status().is_success() {
        rev_resp
            .json::<RevList>()
            .await
            .map(|r| {
                r.revisions
                    .into_iter()
                    .map(|rev| {
                        let (name, email) = split_user(rev.last_modifying_user);
                        DriveRevision {
                            id: rev.id,
                            modified_time: rev.modified_time,
                            editor_name: name,
                            editor_email: email,
                            size: rev.size,
                        }
                    })
                    .collect()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    // API returns oldest → newest; show newest first.
    revisions.reverse();

    let owner = meta.owners.into_iter().next();
    let (owner_name, owner_email) = split_user(owner);
    let (last_editor_name, last_editor_email) = split_user(meta.last_modifying_user);

    Ok(DriveFileInfo {
        owner_email,
        owner_name,
        modified_time: meta.modified_time,
        last_editor_email,
        last_editor_name,
        size: meta.size,
        revisions,
    })
}

/// Bulk owner + last-modified for many files (the Library dashboard columns). Resolves each path
/// reusing the folder/drive caches; per-file errors are returned inline so one bad path doesn't
/// fail the batch. Skips the revision call (lighter than `drive_file_metadata`).
#[tauri::command]
pub(crate) async fn drive_files_basic(
    state: State<'_, Arc<AppState>>,
    rel_paths: Vec<String>,
) -> Result<Vec<DriveBasic>, String> {
    let token = access_token(&state).await?;
    let client = reqwest::Client::new();
    let mut out = Vec::with_capacity(rel_paths.len());
    for rel in rel_paths {
        match basic_for(&state, &client, &token, &rel).await {
            Ok(meta) => {
                let (owner_name, owner_email) = split_user(meta.owners.into_iter().next());
                let (last_editor_name, last_editor_email) = split_user(meta.last_modifying_user);
                out.push(DriveBasic {
                    rel_path: rel,
                    owner_email,
                    owner_name,
                    last_editor_email,
                    last_editor_name,
                    modified_time: meta.modified_time,
                    error: None,
                });
            }
            Err(e) => out.push(DriveBasic {
                rel_path: rel,
                owner_email: None,
                owner_name: None,
                last_editor_email: None,
                last_editor_name: None,
                modified_time: None,
                error: Some(e),
            }),
        }
    }
    Ok(out)
}

async fn basic_for(
    state: &AppState,
    client: &reqwest::Client,
    token: &str,
    rel: &str,
) -> Result<FileMeta, String> {
    let file_id = resolve_file_id(state, rel).await?;
    let resp = client
        .get(format!("https://www.googleapis.com/drive/v3/files/{file_id}"))
        .query(&[
            ("supportsAllDrives", "true"),
            (
                "fields",
                "owners(displayName,emailAddress),lastModifyingUser(displayName,emailAddress),modifiedTime",
            ),
        ])
        .bearer_auth(token)
        .send()
        .await
        .str_err()?;
    if !resp.status().is_success() {
        return Err(map_status(resp).await);
    }
    resp.json::<FileMeta>().await.str_err()
}

/// Download one past revision of a `.spine` to a temp file and return its local path (caller opens
/// it in Spine). Read-only: never writes back to Drive. Note: linked images may not resolve since
/// the temp copy sits outside the original folder — enough to inspect the skeleton/animations.
#[tauri::command]
pub(crate) async fn drive_open_revision(
    state: State<'_, Arc<AppState>>,
    rel_path: String,
    revision_id: String,
) -> Result<String, String> {
    let file_id = resolve_file_id(&state, &rel_path).await?;
    let token = access_token(&state).await?;
    let resp = reqwest::Client::new()
        .get(format!(
            "https://www.googleapis.com/drive/v3/files/{file_id}/revisions/{revision_id}"
        ))
        .query(&[("alt", "media"), ("supportsAllDrives", "true")])
        .bearer_auth(&token)
        .send()
        .await
        .str_err()?;
    if !resp.status().is_success() {
        return Err(map_status(resp).await);
    }
    let bytes = resp.bytes().await.str_err()?;

    let stem = normalize_rel(&rel_path);
    let name = stem.rsplit('/').next().unwrap_or("file.spine");
    let base = name.strip_suffix(".spine").unwrap_or(name);
    let safe_rev: String = revision_id.chars().filter(|c| c.is_alphanumeric()).collect();
    let dir = std::env::temp_dir().join("spineforge-revisions");
    std::fs::create_dir_all(&dir).str_err()?;
    let path = dir.join(format!("{base}__rev{safe_rev}.spine"));
    std::fs::write(&path, &bytes).str_err()?;
    Ok(crate::path_to_string(&path))
}

// ---- file-id resolution -----------------------------------------------------

async fn resolve_file_id(state: &AppState, rel_path: &str) -> Result<String, String> {
    let key = normalize_rel(rel_path);
    if let Some(id) = state.drive_file_ids.lock().await.get(&key).cloned() {
        return Ok(id);
    }

    let segments: Vec<&str> = key.split('/').filter(|s| !s.is_empty()).collect();
    if segments.len() < 2 {
        return Err("File không nằm trên shared drive Google Drive.".to_string());
    }

    let token = access_token(state).await?;
    let client = reqwest::Client::new();
    let drive_id = shared_drive_id(state, &client, &token, segments[0]).await?;

    // Walk the folder chain, caching every prefix so sibling files reuse resolved folder IDs.
    let mut parent = drive_id.clone();
    let mut prefix = segments[0].to_string();
    for seg in &segments[1..] {
        prefix.push('/');
        prefix.push_str(seg);
        if let Some(id) = state.drive_file_ids.lock().await.get(&prefix).cloned() {
            parent = id;
            continue;
        }
        parent = find_child(&client, &token, &drive_id, &parent, seg).await?;
        state.drive_file_ids.lock().await.insert(prefix.clone(), parent.clone());
    }
    Ok(parent)
}

/// Map a shared-drive name to its ID, caching the full `drives.list` once per session.
async fn shared_drive_id(
    state: &AppState,
    client: &reqwest::Client,
    token: &str,
    name: &str,
) -> Result<String, String> {
    {
        let guard = state.drive_roots.lock().await;
        if let Some(map) = guard.as_ref() {
            return map
                .get(name)
                .cloned()
                .ok_or_else(|| format!("Không tìm thấy shared drive '{name}' trên tài khoản này."));
        }
    }
    let resp = client
        .get("https://www.googleapis.com/drive/v3/drives")
        .query(&[("pageSize", "100"), ("fields", "drives(id,name)")])
        .bearer_auth(token)
        .send()
        .await
        .str_err()?;
    if !resp.status().is_success() {
        return Err(map_status(resp).await);
    }
    let list: DriveList = resp.json().await.str_err()?;
    let map: HashMap<String, String> = list.drives.into_iter().map(|d| (d.name, d.id)).collect();
    let found = map.get(name).cloned();
    *state.drive_roots.lock().await = Some(map);
    found.ok_or_else(|| format!("Không tìm thấy shared drive '{name}' trên tài khoản này."))
}

async fn find_child(
    client: &reqwest::Client,
    token: &str,
    drive_id: &str,
    parent: &str,
    name: &str,
) -> Result<String, String> {
    // Escape single quotes for the Drive query language.
    let q = format!(
        "'{}' in parents and name = '{}' and trashed = false",
        parent,
        name.replace('\'', "\\'")
    );
    let resp = client
        .get("https://www.googleapis.com/drive/v3/files")
        .query(&[
            ("q", q.as_str()),
            ("corpora", "drive"),
            ("driveId", drive_id),
            ("includeItemsFromAllDrives", "true"),
            ("supportsAllDrives", "true"),
            ("fields", "files(id)"),
            ("pageSize", "10"),
        ])
        .bearer_auth(token)
        .send()
        .await
        .str_err()?;
    if !resp.status().is_success() {
        return Err(map_status(resp).await);
    }
    let list: FileList = resp.json().await.str_err()?;
    list.files
        .into_iter()
        .next()
        .map(|f| f.id)
        .ok_or_else(|| format!("Không tìm thấy '{name}' trên Google Drive."))
}

// ---- tokens -----------------------------------------------------------------

/// Valid access token: returns the cached one if still fresh, otherwise refreshes via the keyring.
async fn access_token(state: &AppState) -> Result<String, String> {
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
    cache_access_token(state, tokens.access_token, tokens.expires_in).await;
    Ok(access)
}

async fn cache_access_token(state: &AppState, access_token: String, expires_in: u64) {
    *state.drive_token.lock().await = Some(DriveToken {
        access_token,
        expires_at: Instant::now() + Duration::from_secs(expires_in),
    });
}

async fn fetch_account(state: &AppState) -> Result<DriveAccount, String> {
    let token = access_token(state).await?;
    let resp = reqwest::Client::new()
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
    let resp = reqwest::Client::new()
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

fn split_user(user: Option<UserRef>) -> (Option<String>, Option<String>) {
    match user {
        Some(u) => (u.display_name, u.email_address),
        None => (None, None),
    }
}

fn normalize_rel(rel_path: &str) -> String {
    rel_path.replace('\\', "/")
}

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

async fn map_status(resp: reqwest::Response) -> String {
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    // Pull Google's `error.message` when present; it's the most useful diagnostic.
    let reason = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().map(str::to_string))
        .unwrap_or(body);
    match status.as_u16() {
        401 => "Phiên Google Drive đã hết hạn — hãy đăng nhập lại.".to_string(),
        403 => format!("Google Drive từ chối (403): {reason}"),
        404 => "Không tìm thấy file trên Google Drive.".to_string(),
        _ => format!("Lỗi Google Drive ({status}): {reason}"),
    }
}
