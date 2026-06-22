//! Tier B realtime — background poller over the [Drive Changes API]. Instead of re-fetching every
//! file's metadata (the manual "Load Drive data" path), we grab a start page token once per shared
//! drive and then poll `changes.list` on an interval, which returns ONLY what changed since the last
//! token. Each change is classified (edit / rename / add / delete) and tagged with the actor so the
//! frontend can both refresh the affected rows silently AND surface a "who did what" notification.
//!
//! Runs only while the Library tab is open (the frontend calls `drive_watch_start`/`drive_watch_stop`
//! on mount/unmount + focus). Cost is ~a few quota units per poll — negligible vs the daily quota.
//!
//! [Drive Changes API]: https://developers.google.com/workspace/drive/api/reference/rest/v3/changes

use std::{
    collections::{HashMap, HashSet},
    sync::{atomic::Ordering, Arc},
    time::Duration,
};

use chrono::DateTime;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use super::auth::access_token;
use super::{drive_client, send_with_retry, shared_drive_id, split_user, UserRef};
use crate::{error::ResultExt, model::AppState};

/// How often to poll `changes.list` while the watcher is running. 10s feels responsive while still
/// cheap (~3 quota units/poll; the loop only runs while the Library tab is open + focused). Drive
/// has no cheaper push for a desktop app (webhooks need a public endpoint), so polling is the lever.
const POLL_INTERVAL: Duration = Duration::from_secs(10);

// ---- Google API response shapes --------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartPageToken {
    start_page_token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChangeList {
    #[serde(default)]
    changes: Vec<ChangeItem>,
    next_page_token: Option<String>,
    new_start_page_token: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChangeItem {
    #[serde(default)]
    removed: bool,
    file_id: Option<String>,
    time: Option<String>,
    file: Option<ChangeFile>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChangeFile {
    name: Option<String>,
    #[serde(default)]
    parents: Vec<String>,
    #[serde(default)]
    trashed: bool,
    // For add-vs-edit on untracked files: a just-created file has created≈modified.
    created_time: Option<String>,
    modified_time: Option<String>,
    last_modifying_user: Option<UserRef>,
}

/// Minimal folder lookup (name + parents) for resolving an `export`/`ex` folder up to its unit.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FolderMeta {
    name: Option<String>,
    #[serde(default)]
    parents: Vec<String>,
}

// ---- event payload (to the frontend) ----------------------------------------

/// One classified change, emitted to the frontend over the `drive-changes` event. `rel_path` is the
/// Drive-relative path (for an add it's `folder/name`). `kind` distinguishes a `.spine` unit from a
/// source image living directly in a unit folder.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DriveChange {
    action: &'static str, // "edit" | "rename" | "add" | "delete"
    kind: &'static str,   // "spine" | "image"
    rel_path: String,
    old_name: Option<String>,
    new_name: Option<String>,
    actor_name: Option<String>,
    actor_email: Option<String>,
    time: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ChangesPayload {
    changes: Vec<DriveChange>,
}

// ---- commands ---------------------------------------------------------------

/// Start watching the given shared drives for changes. Seeds a start page token for any drive not
/// already tracked, then spawns the poll loop (at most one — a repeat call only re-seeds tokens).
#[tauri::command]
pub(crate) async fn drive_watch_start(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    drive_names: Vec<String>,
) -> Result<(), String> {
    let token = access_token(&state).await?;
    let client = drive_client();
    for name in &drive_names {
        if state.drive_change_tokens.lock().await.contains_key(name) {
            continue;
        }
        // Skip drives we can't resolve (not on this account) rather than failing the whole start.
        let Ok(drive_id) = shared_drive_id(&state, &client, &token, name).await else {
            continue;
        };
        if let Ok(start) = fetch_start_token(&client, &token, &drive_id).await {
            state.drive_change_tokens.lock().await.insert(name.clone(), start);
        }
    }
    // Bump the epoch and spawn a loop tagged with it. Any previously-running loop sees a newer epoch
    // and exits, so a stop→start (focus toggle, library switch) never leaves two loops polling.
    state.drive_watch_running.store(true, Ordering::SeqCst);
    let my_epoch = state.drive_watch_epoch.fetch_add(1, Ordering::SeqCst) + 1;
    let state_arc: Arc<AppState> = (*state).clone();
    tauri::async_runtime::spawn(async move { poll_loop(app, state_arc, my_epoch).await });
    Ok(())
}

/// Stop the poll loop (it exits at its next tick). Tokens are kept so a later restart resumes the
/// delta instead of skipping changes that happened while paused.
#[tauri::command]
pub(crate) async fn drive_watch_stop(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    state.drive_watch_running.store(false, Ordering::SeqCst);
    Ok(())
}

// ---- poll loop --------------------------------------------------------------

async fn poll_loop(app: AppHandle, state: Arc<AppState>, my_epoch: u64) {
    let client = drive_client();
    // direct-parent folder id → (owning unit folder rel, in_export) | None. Lives for the loop's
    // lifetime so each subfolder costs at most one parent-chain walk (a few `files.get`) per session.
    let mut asset_cache: HashMap<String, Option<(String, bool)>> = HashMap::new();
    let alive = |s: &AppState| {
        s.drive_watch_running.load(Ordering::SeqCst)
            && s.drive_watch_epoch.load(Ordering::SeqCst) == my_epoch
    };
    while alive(&state) {
        tokio::time::sleep(POLL_INTERVAL).await;
        if !alive(&state) {
            break; // stopped, or superseded by a newer start
        }
        // Stay silent on transient errors (network/token): keep tokens, retry next tick.
        let _ = poll_once(&app, &state, &client, &mut asset_cache).await;
    }
}

async fn poll_once(
    app: &AppHandle,
    state: &AppState,
    client: &reqwest::Client,
    asset_cache: &mut HashMap<String, Option<(String, bool)>>,
) -> Result<(), String> {
    // Snapshot tracked drive names without holding the lock across awaits.
    let names: Vec<String> = state.drive_change_tokens.lock().await.keys().cloned().collect();
    if names.is_empty() {
        return Ok(());
    }
    let token = access_token(state).await?;
    let (id_to_rel, id_to_folder, unit_folder_ids) = reverse_maps(state).await;

    let mut collected: Vec<DriveChange> = Vec::new();
    for name in names {
        let Some(mut cursor) = state.drive_change_tokens.lock().await.get(&name).cloned() else {
            continue;
        };
        let Ok(drive_id) = shared_drive_id(state, client, &token, &name).await else {
            continue;
        };
        loop {
            let list = match fetch_changes(client, &token, &drive_id, &cursor).await {
                Ok(list) => list,
                Err(_) => {
                    // A stale/expired page token (or transient error) — resync to "now" quietly so
                    // we don't loop on a dead cursor. We may miss this tick's delta; that's fine.
                    if let Ok(fresh) = fetch_start_token(client, &token, &drive_id).await {
                        state.drive_change_tokens.lock().await.insert(name.clone(), fresh);
                    }
                    break;
                }
            };
            for ch in &list.changes {
                if let Some(dc) = classify(ch, &id_to_rel, &id_to_folder) {
                    collected.push(dc);
                } else if let Some(dc) =
                    classify_asset(ch, client, &token, &id_to_folder, &unit_folder_ids, asset_cache).await
                {
                    collected.push(dc);
                }
            }
            if let Some(next) = list.next_page_token {
                cursor = next;
                continue;
            }
            if let Some(new_start) = list.new_start_page_token {
                state.drive_change_tokens.lock().await.insert(name.clone(), new_start);
            }
            break;
        }
    }
    if !collected.is_empty() {
        let _ = app.emit("drive-changes", ChangesPayload { changes: collected });
    }
    Ok(())
}

// ---- helpers ----------------------------------------------------------------

/// Build reverse lookups from the resolved-id cache:
/// - `id_to_rel`: tracked `.spine` file id → relPath.
/// - `id_to_folder`: tracked folder id → folder relPath (to show the folder path).
/// - `unit_folder_ids`: ids of folders that DIRECTLY contain a `.spine` (the "unit" folders) — used
///   to recognize a source-image edit in a unit folder (and exclude export/ex artifacts, whose
///   folders are never walked into the cache).
async fn reverse_maps(
    state: &AppState,
) -> (HashMap<String, String>, HashMap<String, String>, HashSet<String>) {
    let guard = state.drive_file_ids.lock().await;
    let mut id_to_rel = HashMap::new();
    let mut id_to_folder = HashMap::new();
    let mut folder_rel_to_id: HashMap<String, String> = HashMap::new();
    let mut spine_rels: Vec<String> = Vec::new();
    for (rel, id) in guard.iter() {
        if rel.to_ascii_lowercase().ends_with(".spine") {
            id_to_rel.insert(id.clone(), rel.clone());
            spine_rels.push(rel.clone());
        } else {
            id_to_folder.insert(id.clone(), rel.clone());
            folder_rel_to_id.insert(rel.clone(), id.clone());
        }
    }
    // A unit folder = the immediate parent of a tracked `.spine`.
    let mut unit_folder_ids = HashSet::new();
    for spine_rel in &spine_rels {
        if let Some((parent, _)) = spine_rel.rsplit_once('/') {
            if let Some(fid) = folder_rel_to_id.get(parent) {
                unit_folder_ids.insert(fid.clone());
            }
        }
    }
    (id_to_rel, id_to_folder, unit_folder_ids)
}

/// Source-image extensions we surface when they change inside a unit folder.
const IMAGE_EXTS: [&str; 7] = ["png", "psd", "jpg", "jpeg", "webp", "tga", "bmp"];

fn is_image(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    IMAGE_EXTS.iter().any(|ext| lower.ends_with(&format!(".{ext}")))
}

/// Heuristic add-vs-edit for an untracked file: a just-uploaded file has `createdTime ≈ modifiedTime`
/// (within a few seconds), whereas an edited existing file was created well before this change.
fn is_new_file(file: &ChangeFile) -> bool {
    match (file.created_time.as_deref(), file.modified_time.as_deref()) {
        (Some(c), Some(m)) => match (DateTime::parse_from_rfc3339(c), DateTime::parse_from_rfc3339(m)) {
            (Ok(c), Ok(m)) => (m - c).num_seconds().abs() <= 5,
            _ => false,
        },
        _ => false,
    }
}

/// Classify one raw change into a notifiable [`DriveChange`], or `None` to ignore it (untracked
/// file outside a unit folder, sidecar churn, etc.). Covers `.spine` units AND source images that
/// live directly in a unit folder.
fn classify(
    ch: &ChangeItem,
    id_to_rel: &HashMap<String, String>,
    id_to_folder: &HashMap<String, String>,
) -> Option<DriveChange> {
    let file_id = ch.file_id.as_ref()?;
    let file = ch.file.as_ref();
    let (actor_name, actor_email) = split_user(file.and_then(|f| f.last_modifying_user.clone()));
    // Note: we intentionally include the signed-in user's own changes (they want to see those too).
    let known_rel = id_to_rel.get(file_id);

    // Tracked `.spine` delete: trash (file present, trashed=true) OR permanent (no file). We know the
    // relPath from the cache either way.
    let trashed = file.map(|f| f.trashed).unwrap_or(false);
    if let Some(rel) = known_rel {
        if ch.removed || trashed {
            return Some(DriveChange {
                action: "delete",
                kind: "spine",
                rel_path: rel.clone(),
                old_name: Some(leaf_name(rel)),
                new_name: None,
                actor_name,
                actor_email,
                time: ch.time.clone(),
            });
        }
    }

    // Permanent removal of an untracked file carries no `file` object → can't attribute. Skip.
    if ch.removed {
        return None;
    }
    let file = file?;
    let new_name = file.name.clone();

    if let Some(rel) = known_rel {
        // Tracked `.spine`: rename when the leaf name changed, otherwise a content edit.
        let leaf = leaf_name(rel);
        if let Some(nn) = &new_name {
            if !nn.eq_ignore_ascii_case(&leaf) {
                return Some(DriveChange {
                    action: "rename",
                    kind: "spine",
                    rel_path: rel.clone(),
                    old_name: Some(leaf),
                    new_name: Some(nn.clone()),
                    actor_name,
                    actor_email,
                    time: ch.time.clone(),
                });
            }
        }
        return Some(DriveChange {
            action: "edit",
            kind: "spine",
            rel_path: rel.clone(),
            old_name: None,
            new_name,
            actor_name,
            actor_email,
            time: ch.time.clone(),
        });
    }

    // Untracked id (incl. trashed files, which DO carry a `file`). Need a name + recognized folder.
    let Some(name) = new_name else { return None };

    // A `.spine` under any tracked folder: trashed → delete, else a brand-new unit → add. (Source
    // images and exported skeletons live in unit SUBFOLDERS and are handled by `classify_asset`,
    // which walks the parent chain — they can't be resolved from the cache synchronously here.)
    if name.to_ascii_lowercase().ends_with(".spine") {
        let folder = file.parents.iter().find_map(|p| id_to_folder.get(p))?;
        let action = if trashed { "delete" } else { "add" };
        return Some(DriveChange {
            action,
            kind: "spine",
            rel_path: format!("{folder}/{name}"),
            old_name: None,
            new_name: Some(name),
            actor_name,
            actor_email,
            time: ch.time.clone(),
        });
    }

    None
}

/// True for exported skeleton files we surface (a `.json`/`.skel`/`.skel.bytes`), excluding the
/// cleaner's `.export.json` settings file.
fn is_skeleton(name: &str) -> bool {
    let l = name.to_ascii_lowercase();
    if l.ends_with(".export.json") {
        return false;
    }
    l.ends_with(".json") || l.contains(".skel")
}

/// Max ancestors to walk up looking for the owning unit folder (guards against deep/looping trees).
const MAX_UNIT_WALK: usize = 8;

/// Locate the unit folder that owns a file living somewhere in a unit's subtree, by walking up the
/// parent chain (lazy `files.get`, memoized per direct-parent id). Returns `(unitFolderRel, in_export)`
/// where `in_export` is true if an `export`/`ex` folder sits between the file and its unit. `None`
/// when the file isn't under any tracked unit.
async fn locate_unit(
    parent_id: &str,
    client: &reqwest::Client,
    token: &str,
    id_to_folder: &HashMap<String, String>,
    unit_folder_ids: &HashSet<String>,
    cache: &mut HashMap<String, Option<(String, bool)>>,
) -> Option<(String, bool)> {
    if let Some(cached) = cache.get(parent_id) {
        return cached.clone();
    }
    let mut cur = parent_id.to_string();
    let mut in_export = false;
    let mut result = None;
    for _ in 0..MAX_UNIT_WALK {
        if unit_folder_ids.contains(&cur) {
            result = id_to_folder.get(&cur).map(|rel| (rel.clone(), in_export));
            break;
        }
        let (name, parents) = folder_meta(client, token, &cur).await?;
        let nl = name.to_ascii_lowercase();
        if nl == "export" || nl == "ex" {
            in_export = true;
        }
        let Some(next) = parents.into_iter().next() else { break };
        cur = next;
    }
    cache.insert(parent_id.to_string(), result.clone());
    result
}

/// Classify an untracked, non-`.spine` change that lives in a unit's subtree: a source **image**
/// (anywhere under the unit but NOT under `export`/`ex`) or an exported **skeleton** (`.json`/`.skel`/
/// `.skel.bytes`, typically in `export`/`ex`). Walks the parent chain to find the owning unit.
async fn classify_asset(
    ch: &ChangeItem,
    client: &reqwest::Client,
    token: &str,
    id_to_folder: &HashMap<String, String>,
    unit_folder_ids: &HashSet<String>,
    cache: &mut HashMap<String, Option<(String, bool)>>,
) -> Option<DriveChange> {
    // Permanent removal carries no `file` (so no name/parents) → can't attribute. (Trash keeps them.)
    if ch.removed {
        return None;
    }
    let file = ch.file.as_ref()?;
    let name = file.name.clone()?;
    let is_img = is_image(&name);
    let is_skel = is_skeleton(&name);
    if !is_img && !is_skel {
        return None;
    }
    let parent = file.parents.first()?;
    let (unit_rel, in_export) =
        locate_unit(parent, client, token, id_to_folder, unit_folder_ids, cache).await?;
    let (actor_name, actor_email) = split_user(file.last_modifying_user.clone());

    if is_skel {
        // Exported skeleton = re-export. Skip trash deletes (re-export churns old files → noise).
        if file.trashed {
            return None;
        }
        return Some(DriveChange {
            action: "edit",
            kind: "export",
            rel_path: format!("{unit_rel}/{name}"),
            old_name: None,
            new_name: Some(name),
            actor_name,
            actor_email,
            time: ch.time.clone(),
        });
    }

    // Source image: exclude anything under an export/ex folder (those are output artifacts).
    if in_export {
        return None;
    }
    let action = if file.trashed {
        "delete"
    } else if is_new_file(file) {
        "add"
    } else {
        "edit"
    };
    Some(DriveChange {
        action,
        kind: "image",
        rel_path: format!("{unit_rel}/{name}"),
        old_name: None,
        new_name: Some(name),
        actor_name,
        actor_email,
        time: ch.time.clone(),
    })
}

async fn folder_meta(
    client: &reqwest::Client,
    token: &str,
    id: &str,
) -> Option<(String, Vec<String>)> {
    let resp = send_with_retry(|| {
        client
            .get(format!("https://www.googleapis.com/drive/v3/files/{id}"))
            .query(&[("supportsAllDrives", "true"), ("fields", "name,parents")])
            .bearer_auth(token)
    })
    .await
    .ok()?;
    let meta: FolderMeta = resp.json().await.ok()?;
    Some((meta.name?, meta.parents))
}

fn leaf_name(rel: &str) -> String {
    rel.rsplit('/').next().unwrap_or(rel).to_string()
}

async fn fetch_start_token(
    client: &reqwest::Client,
    token: &str,
    drive_id: &str,
) -> Result<String, String> {
    let resp = send_with_retry(|| {
        client
            .get("https://www.googleapis.com/drive/v3/changes/startPageToken")
            .query(&[("driveId", drive_id), ("supportsAllDrives", "true")])
            .bearer_auth(token)
    })
    .await?;
    let parsed: StartPageToken = resp.json().await.str_err()?;
    Ok(parsed.start_page_token)
}

async fn fetch_changes(
    client: &reqwest::Client,
    token: &str,
    drive_id: &str,
    page_token: &str,
) -> Result<ChangeList, String> {
    let resp = send_with_retry(|| {
        client
            .get("https://www.googleapis.com/drive/v3/changes")
            .query(&[
                ("pageToken", page_token),
                ("driveId", drive_id),
                ("corpora", "drive"),
                ("includeItemsFromAllDrives", "true"),
                ("supportsAllDrives", "true"),
                ("spaces", "drive"),
                ("pageSize", "200"),
                (
                    "fields",
                    "newStartPageToken,nextPageToken,changes(fileId,removed,time,file(name,parents,trashed,createdTime,modifiedTime,lastModifyingUser(displayName,emailAddress)))",
                ),
            ])
            .bearer_auth(token)
    })
    .await?;
    resp.json::<ChangeList>().await.str_err()
}
