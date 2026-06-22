//! Tier B — Google Drive REST API. Tier A reads/writes the Drive *folder* via the
//! mounted filesystem and so can't see who owns a `.spine`, when it last changed, or its
//! revision history; only the Drive API exposes that. This module reads file metadata +
//! revisions on demand; the OAuth sign-in + token/keyring machinery lives in [`auth`].
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
    path::PathBuf,
    sync::Arc,
    time::Duration,
};

use futures::StreamExt;
use rand::Rng;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, Window};

use crate::{error::ResultExt, model::AppState};

// `pub(crate)` so `generate_handler!` in lib.rs can reach the commands' macro-generated items at
// their defining path (`drive::auth::drive_sign_in`, …); a plain re-export wouldn't carry those.
pub(crate) mod auth;
pub(crate) use auth::DriveToken;
use auth::access_token;

// ---- public command types ---------------------------------------------------

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

// ---- shared HTTP plumbing ---------------------------------------------------

/// Per-request timeout for every Drive REST call. WITHOUT this, a single stalled socket hangs the
/// whole batch forever — the reported symptom was "Load Drive data" spinning for minutes on a large
/// library, then silently returning nothing (the await never resolved, so the timestamp never set).
const DRIVE_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// Max Drive lookups in flight during a batch. Bounded so wall-clock drops from minutes to seconds
/// without tripping Google's per-user rate limit.
const DRIVE_BASICS_CONCURRENCY: usize = 8;
/// Max retries for a rate-limited Drive request before giving up.
const DRIVE_MAX_RETRIES: u32 = 5;

/// reqwest client with sane timeouts for all Drive REST calls (falls back to the default client if
/// the builder ever fails, which it won't with these options). Used by [`auth`] too.
pub(super) fn drive_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(DRIVE_REQUEST_TIMEOUT)
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

/// Map a failed Drive response to a friendly Vietnamese error string. Visible to [`auth`] so the
/// sign-in path formats errors the same way.
pub(super) async fn map_status(resp: reqwest::Response) -> String {
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    // Pull Google's `error.message` when present; it's the most useful diagnostic.
    let reason = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().map(str::to_string))
        .unwrap_or(body);
    status_message(status, &reason)
}

fn status_message(status: u16, reason: &str) -> String {
    match status {
        401 => "Phiên Google Drive đã hết hạn — hãy đăng nhập lại.".to_string(),
        403 => format!("Google Drive từ chối (403): {reason}"),
        404 => "Không tìm thấy file trên Google Drive.".to_string(),
        other => format!("Lỗi Google Drive ({other}): {reason}"),
    }
}

/// Truncated exponential backoff with jitter (Google's recommended handling for 429/403 rate
/// limits): 1s, 2s, 4s, 8s, 16s — each plus up to 1s of random jitter, capped at 32s.
fn retry_backoff(attempt: u32) -> Duration {
    let secs = (1u64 << attempt).min(32);
    let jitter_ms = rand::thread_rng().gen_range(0..1000);
    Duration::from_millis(secs * 1000 + jitter_ms)
}

/// Send a Drive request, retrying `429 Too Many Requests` and rate-limit `403`s with truncated
/// exponential backoff (per Google's guidance). `build` reconstructs the request each attempt
/// because a reqwest request/response can't be reused. Returns a guaranteed-success response, or an
/// already-mapped error string — so callers skip the usual `!is_success` + `map_status` dance.
/// Non-rate-limit failures (permission denied, not found, …) return immediately without retrying.
async fn send_with_retry(
    build: impl Fn() -> reqwest::RequestBuilder,
) -> Result<reqwest::Response, String> {
    let mut attempt: u32 = 0;
    loop {
        let resp = build().send().await.str_err()?;
        let status = resp.status();
        if status.is_success() {
            return Ok(resp);
        }
        // Read the body once: it decides retryability AND (if we give up) builds the message.
        let body = resp.text().await.unwrap_or_default();
        let rate_limited = status == reqwest::StatusCode::TOO_MANY_REQUESTS
            || (status == reqwest::StatusCode::FORBIDDEN
                && (body.contains("userRateLimitExceeded")
                    || body.contains("rateLimitExceeded")
                    || body.contains("Rate Limit Exceeded")));
        if rate_limited && attempt < DRIVE_MAX_RETRIES {
            tokio::time::sleep(retry_backoff(attempt)).await;
            attempt += 1;
            continue;
        }
        let reason = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| v["error"]["message"].as_str().map(str::to_string))
            .unwrap_or(body);
        return Err(status_message(status.as_u16(), &reason));
    }
}

// ---- commands ---------------------------------------------------------------

/// Owner, last-modified, and revision history for a `.spine`, looked up by its path relative to
/// the Shared drives mount (e.g. `FD/[FD] Animation/hero/hero.spine`): the first segment is the
/// shared-drive name, the rest are folder names. File IDs are cached per session.
#[tauri::command]
pub(crate) async fn drive_file_metadata(
    state: State<'_, Arc<AppState>>,
    rel_path: String,
) -> Result<DriveFileInfo, String> {
    let client = drive_client();
    let file_id = resolve_file_id(&state, &client, &rel_path).await?;
    let token = access_token(&state).await?;

    let meta_resp = send_with_retry(|| {
        client
            .get(format!("https://www.googleapis.com/drive/v3/files/{file_id}"))
            .query(&[
                ("supportsAllDrives", "true"),
                (
                    "fields",
                    "owners(displayName,emailAddress),modifiedTime,lastModifyingUser(displayName,emailAddress),size",
                ),
            ])
            .bearer_auth(&token)
    })
    .await?;
    let meta: FileMeta = meta_resp.json().await.str_err()?;

    // Revisions are best-effort: a missing list shouldn't fail the whole lookup.
    let mut revisions: Vec<DriveRevision> = match send_with_retry(|| {
        client
            .get(format!("https://www.googleapis.com/drive/v3/files/{file_id}/revisions"))
            .query(&[
                (
                    "fields",
                    "revisions(id,modifiedTime,lastModifyingUser(displayName,emailAddress),size)",
                ),
                ("pageSize", "1000"),
            ])
            .bearer_auth(&token)
    })
    .await
    {
        Ok(rev_resp) => rev_resp
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
            .unwrap_or_default(),
        Err(_) => Vec::new(),
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

/// Progress payload for the `drive-basics-progress` event (lets the UI show N/total instead of a
/// silent spinner during a long batch).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DriveBasicsProgress {
    done: usize,
    total: usize,
}

/// Bulk owner + last-modified for many files (the Library dashboard columns). Resolves each path
/// reusing the folder/drive caches; per-file errors are returned inline so one bad path doesn't
/// fail the batch. Skips the revision call (lighter than `drive_file_metadata`).
#[tauri::command]
pub(crate) async fn drive_files_basic(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    window: Window,
    rel_paths: Vec<String>,
) -> Result<Vec<DriveBasic>, String> {
    let token = access_token(&state).await?;
    let client = drive_client();
    // Warm the session cache from disk so a repeat load skips the expensive `files.list` walk.
    load_persisted_ids(&app, &state).await;
    let total = rel_paths.len();
    let mut out: Vec<DriveBasic> = Vec::with_capacity(total);
    let mut done = 0usize;
    let _ = window.emit("drive-basics-progress", DriveBasicsProgress { done, total });

    // Warm the shared-drive + common-ancestor folder cache with ONE sequential lookup first, so the
    // parallel fan-out below doesn't fire N duplicate requests for the same top-level folders before
    // the cache fills.
    let mut rest = rel_paths.into_iter();
    if let Some(first) = rest.next() {
        out.push(basic_entry(&state, &client, &token, first).await);
        done += 1;
        let _ = window.emit("drive-basics-progress", DriveBasicsProgress { done, total });
    }

    let mut stream = futures::stream::iter(rest)
        .map(|rel| {
            let (state, client, token) = (&state, &client, &token);
            async move { basic_entry(state, client, token, rel).await }
        })
        .buffer_unordered(DRIVE_BASICS_CONCURRENCY);
    while let Some(entry) = stream.next().await {
        out.push(entry);
        done += 1;
        let _ = window.emit("drive-basics-progress", DriveBasicsProgress { done, total });
    }
    // Persist the freshly-resolved IDs so the next session/load is mostly cache hits.
    save_persisted_ids(&app, &state).await;
    Ok(out)
}

/// Resolve one file's basic metadata into a row, capturing any per-file error in the row itself so a
/// single bad path never fails the batch.
async fn basic_entry(
    state: &AppState,
    client: &reqwest::Client,
    token: &str,
    rel: String,
) -> DriveBasic {
    match basic_for(state, client, token, &rel).await {
        Ok(meta) => {
            let (owner_name, owner_email) = split_user(meta.owners.into_iter().next());
            let (last_editor_name, last_editor_email) = split_user(meta.last_modifying_user);
            DriveBasic {
                rel_path: rel,
                owner_email,
                owner_name,
                last_editor_email,
                last_editor_name,
                modified_time: meta.modified_time,
                error: None,
            }
        }
        Err(e) => DriveBasic {
            rel_path: rel,
            owner_email: None,
            owner_name: None,
            last_editor_email: None,
            last_editor_name: None,
            modified_time: None,
            error: Some(e),
        },
    }
}

/// Owner/last-modified for one file, with a stale-cache self-heal: a persisted Drive ID can go dead
/// if the folder/file was deleted+recreated (rename/content edits keep the ID). When a lookup comes
/// back "not found", drop this path's cached prefixes and re-resolve cold once before giving up.
async fn basic_for(
    state: &AppState,
    client: &reqwest::Client,
    token: &str,
    rel: &str,
) -> Result<FileMeta, String> {
    match basic_for_once(state, client, token, rel).await {
        Ok(meta) => Ok(meta),
        Err(e) if e.contains("Không tìm thấy") => {
            invalidate_path_cache(state, rel).await;
            basic_for_once(state, client, token, rel).await
        }
        Err(e) => Err(e),
    }
}

async fn basic_for_once(
    state: &AppState,
    client: &reqwest::Client,
    token: &str,
    rel: &str,
) -> Result<FileMeta, String> {
    let file_id = resolve_file_id(state, client, rel).await?;
    let resp = send_with_retry(|| {
        client
            .get(format!("https://www.googleapis.com/drive/v3/files/{file_id}"))
            .query(&[
                ("supportsAllDrives", "true"),
                (
                    "fields",
                    "owners(displayName,emailAddress),lastModifyingUser(displayName,emailAddress),modifiedTime",
                ),
            ])
            .bearer_auth(token)
    })
    .await?;
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
    let client = drive_client();
    let file_id = resolve_file_id(&state, &client, &rel_path).await?;
    let token = access_token(&state).await?;
    let resp = send_with_retry(|| {
        client
            .get(format!(
                "https://www.googleapis.com/drive/v3/files/{file_id}/revisions/{revision_id}"
            ))
            .query(&[("alt", "media"), ("supportsAllDrives", "true")])
            .bearer_auth(&token)
    })
    .await?;
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

// ---- cross-session file-id cache --------------------------------------------

/// On-disk location of the cross-session `path → Drive ID` cache (per-machine app cache dir).
/// Used by [`auth::drive_sign_out`] to drop the cache on sign-out.
pub(super) fn drive_id_cache_file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_cache_dir()
        .ok()
        .map(|d| d.join("drive-folder-ids.json"))
}

/// Load the persisted ID cache into the session map — but only when the session map is still empty,
/// so we never clobber IDs already resolved (and possibly corrected) this run. Best-effort.
async fn load_persisted_ids(app: &AppHandle, state: &AppState) {
    let mut guard = state.drive_file_ids.lock().await;
    if !guard.is_empty() {
        return;
    }
    let Some(path) = drive_id_cache_file(app) else { return };
    if let Ok(text) = std::fs::read_to_string(&path) {
        if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&text) {
            *guard = map;
        }
    }
}

/// Write the session ID cache back to disk (best-effort; a failed write just means a colder next load).
async fn save_persisted_ids(app: &AppHandle, state: &AppState) {
    let snapshot = state.drive_file_ids.lock().await.clone();
    let Some(path) = drive_id_cache_file(app) else { return };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(text) = serde_json::to_string(&snapshot) {
        let _ = std::fs::write(&path, text);
    }
}

/// Drop a path's cached IDs — the full-path entry and every folder prefix — so the next resolve
/// walks cold and picks up IDs that changed underneath us (deleted+recreated folder/file).
async fn invalidate_path_cache(state: &AppState, rel_path: &str) {
    let key = normalize_rel(rel_path);
    let mut guard = state.drive_file_ids.lock().await;
    guard.remove(&key);
    let mut prefix = String::new();
    for seg in key.split('/').filter(|s| !s.is_empty()) {
        if !prefix.is_empty() {
            prefix.push('/');
        }
        prefix.push_str(seg);
        guard.remove(&prefix);
    }
}

// ---- file-id resolution -----------------------------------------------------

async fn resolve_file_id(
    state: &AppState,
    client: &reqwest::Client,
    rel_path: &str,
) -> Result<String, String> {
    let key = normalize_rel(rel_path);
    if let Some(id) = state.drive_file_ids.lock().await.get(&key).cloned() {
        return Ok(id);
    }

    let segments: Vec<&str> = key.split('/').filter(|s| !s.is_empty()).collect();
    if segments.len() < 2 {
        return Err("File không nằm trên shared drive Google Drive.".to_string());
    }

    let token = access_token(state).await?;
    let drive_id = shared_drive_id(state, client, &token, segments[0]).await?;

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
        parent = find_child(client, &token, &drive_id, &parent, seg).await?;
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
    let resp = send_with_retry(|| {
        client
            .get("https://www.googleapis.com/drive/v3/drives")
            .query(&[("pageSize", "100"), ("fields", "drives(id,name)")])
            .bearer_auth(token)
    })
    .await?;
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
    let resp = send_with_retry(|| {
        client
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
    })
    .await?;
    let list: FileList = resp.json().await.str_err()?;
    list.files
        .into_iter()
        .next()
        .map(|f| f.id)
        .ok_or_else(|| format!("Không tìm thấy '{name}' trên Google Drive."))
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
