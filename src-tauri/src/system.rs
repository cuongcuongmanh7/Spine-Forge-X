//! Small filesystem/OS utility commands used across the UI: path checks,
//! opening files/URLs in the system shell, text writes and thumbnails.

use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tokio::process::Command;

use crate::{
    error::ResultExt,
    paths::{parse_quoted_path, path_to_string, unquote},
};

#[tauri::command]
pub(crate) fn path_exists(path: String) -> bool {
    let trimmed = unquote(path.trim());
    !trimmed.is_empty() && parse_quoted_path(trimmed).exists()
}

#[tauri::command]
pub(crate) fn write_text_file(path: String, content: String) -> Result<(), String> {
    let target = parse_quoted_path(&path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).str_err()?;
    }
    fs::write(&target, content).str_err()
}

/// Pre-fill the sync folder by probing for a Google Drive "Shared drives" mount. The mount root
/// (`G:\Shared drives`) is a virtual listing you CAN'T write files into — only the individual
/// shared drives under it are writable. So return the first **writable** shared drive
/// (e.g. `G:\Shared drives\FD`); the frontend then anchors path-rebasing at the parent mount.
/// Returns `None` when none is writable. Windows-only; other platforms return `None`.
#[tauri::command]
pub(crate) fn detect_drive_root() -> Option<String> {
    #[cfg(windows)]
    {
        for letter in b'A'..=b'Z' {
            let mount = format!("{}:\\Shared drives", letter as char);
            if !std::path::Path::new(&mount).is_dir() {
                continue;
            }
            let Ok(entries) = fs::read_dir(&mount) else { continue };
            let mut dirs: Vec<std::path::PathBuf> = entries
                .filter_map(Result::ok)
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect();
            dirs.sort();
            for dir in dirs {
                // Confirm writability with a throwaway probe file (deleted right after).
                let probe = dir.join(".__spineforge_write_test");
                if fs::write(&probe, b"x").is_ok() {
                    let _ = fs::remove_file(&probe);
                    return Some(path_to_string(&dir));
                }
            }
        }
    }
    None
}

/// Read a UTF-8 text file, returning `None` when it doesn't exist (vs `Err` on a real
/// read failure). Used by the sync layer to load the profile file from a Google Drive
/// folder without treating "not synced yet" as an error.
#[tauri::command]
pub(crate) fn read_text_file(path: String) -> Result<Option<String>, String> {
    let target = parse_quoted_path(&path);
    if !target.exists() {
        return Ok(None);
    }
    fs::read_to_string(&target).map(Some).str_err()
}

/// Read any file and return it as a base64 data URL with a MIME guessed from the
/// extension. Size-capped (16 MB) so a stray huge file can't blow up the UI.
/// Used to feed local skeleton/atlas/image bytes to the Spine web player, which
/// resolves them from a `rawDataURIs` map instead of fetching over the network.
#[tauri::command]
pub(crate) fn read_file_data_url(path: String) -> Result<String, String> {
    use base64::Engine;
    let p = parse_quoted_path(&path);
    let meta = fs::metadata(&p).str_err()?;
    if meta.len() > 16 * 1024 * 1024 {
        return Err("File quá lớn để nạp.".to_string());
    }
    let bytes = fs::read(&p).str_err()?;
    let mime = match p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("gif") => "image/gif",
        Some("json") => "application/json",
        Some("atlas") | Some("txt") => "text/plain",
        Some("skel") | Some("bytes") => "application/octet-stream",
        _ => "application/octet-stream",
    };
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

/// Read an image file as a base64 data URL for thumbnail display (Clean Source
/// detail view). Thin wrapper over [`read_file_data_url`].
#[tauri::command]
pub(crate) fn read_image_data_url(path: String) -> Result<String, String> {
    read_file_data_url(path)
}

#[tauri::command]
pub(crate) async fn open_url(url: String) -> Result<(), String> {
    let target = url.trim();
    if !(target.starts_with("http://") || target.starts_with("https://")) {
        return Err("Chỉ mở được http(s) URL.".to_string());
    }

    #[cfg(windows)]
    {
        // Open via rundll32's URL handler, NOT `cmd /c start`: cmd treats `&` as a command
        // separator, so a URL with query params (e.g. the Google OAuth URL) gets truncated at the
        // first `&` and loses every later param. rundll32 receives the whole URL as one argument.
        Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", target])
            .spawn()
            .str_err()?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(target)
            .spawn()
            .str_err()?;
    }

    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(target)
            .spawn()
            .str_err()?;
    }

    Ok(())
}

#[tauri::command]
pub(crate) async fn open_path(path: String) -> Result<(), String> {
    let target = parse_quoted_path(&path);
    if !target.exists() {
        return Err("Path không tồn tại.".to_string());
    }

    #[cfg(windows)]
    {
        Command::new("explorer")
            .arg(target)
            .spawn()
            .str_err()?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(target)
            .spawn()
            .str_err()?;
    }

    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(target)
            .spawn()
            .str_err()?;
    }

    Ok(())
}

/// Open a `.spine` project in the Spine editor. Prefers the user's configured
/// editor path; on Windows that's usually `Spine.com` (the CLI launcher), so we
/// swap to the sibling `Spine.exe` to bring up the GUI. Falls back to the OS
/// default handler for `.spine` when no valid editor path is configured.
#[tauri::command]
pub(crate) async fn open_in_spine(spine_path: String, file: String) -> Result<(), String> {
    let target = parse_quoted_path(&file);
    if !target.exists() {
        return Err("File .spine không tồn tại.".to_string());
    }

    let editor = parse_quoted_path(&spine_path);
    if !spine_path.trim().is_empty() && editor.exists() {
        #[cfg(windows)]
        let editor = {
            let is_com = editor
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("com"))
                .unwrap_or(false);
            if is_com {
                let exe = editor.with_extension("exe");
                if exe.exists() {
                    exe
                } else {
                    editor
                }
            } else {
                editor
            }
        };
        // Launch with the working directory set to Spine's install folder (like a normal
        // double-click). The old 3.8.x editor's bundled JRE resolves resources relative to
        // CWD; spawning from the app's dir can make it crash on startup.
        let mut cmd = Command::new(&editor);
        cmd.arg(&target);
        if let Some(dir) = editor.parent() {
            cmd.current_dir(dir);
        }
        cmd.spawn().str_err()?;
        return Ok(());
    }

    // No editor configured — let the OS open it with the default `.spine` app.
    open_path(file).await
}

/// List immediate subdirectory names of `path` (sorted). Used by the Linked Project modal's
/// "Auto-fill from Unity root" — each subfolder becomes a candidate destination type.
#[tauri::command]
pub(crate) fn list_subdirectories(path: String) -> Result<Vec<String>, String> {
    let root = parse_quoted_path(&path);
    if !root.is_dir() {
        return Err("Path không phải thư mục hợp lệ.".to_string());
    }
    let mut names: Vec<String> = fs::read_dir(&root)
        .str_err()?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();
    names.sort();
    Ok(names)
}

/// Reject cache keys that aren't plain hex/word tokens — the key is joined into a file path,
/// so this prevents `..`/separators from escaping the cache directory.
fn safe_cache_key(key: &str) -> Result<&str, String> {
    if !key.is_empty()
        && key.len() <= 128
        && key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        Ok(key)
    } else {
        Err("Khóa cache không hợp lệ.".to_string())
    }
}

/// Subpath (under the `Shared drives` mount) of the team's shared app-data root. The drive letter
/// varies per machine, so we resolve the mount rather than hardcode it.
const APP_DATA_SUBPATH: &str = "Pamvis/spine_app_data";

/// Resolve the team's shared app-data folder (`<letter>:\Shared drives\Pamvis\spine_app_data`) on
/// this machine by scanning for the Pamvis shared-drive mount. Returns `None` when the Pamvis drive
/// isn't mounted/visible — the UI then warns the user. Windows-only; other platforms return `None`.
#[tauri::command]
pub(crate) fn resolve_app_data_dir() -> Option<String> {
    #[cfg(windows)]
    {
        for letter in b'A'..=b'Z' {
            let pamvis = format!("{}:\\Shared drives\\Pamvis", letter as char);
            if std::path::Path::new(&pamvis).is_dir() {
                let dir = std::path::Path::new(&format!("{}:\\Shared drives", letter as char))
                    .join(APP_DATA_SUBPATH.replace('/', "\\"));
                return Some(path_to_string(&dir));
            }
        }
    }
    None
}

/// Resolve the thumbnail cache folder. When the frontend passes a `dir` (the shared app-data root
/// resolved per-machine), thumbnails live in `<dir>/thumbs` so the whole team reuses them; otherwise
/// fall back to the per-machine app cache dir.
fn thumb_cache_dir(app: &AppHandle, dir: &Option<String>) -> Result<PathBuf, String> {
    if let Some(d) = dir.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        return Ok(parse_quoted_path(d).join("thumbs"));
    }
    app.path()
        .app_cache_dir()
        .map(|path| path.join("thumbs"))
        .str_err()
}

/// Return a cached skeleton thumbnail as a PNG data URL, or `None` if not generated yet.
/// Used by the Library grid to skip the (expensive) off-screen WebGL render when a thumbnail
/// for this asset revision already exists (locally or in the shared Drive folder).
#[tauri::command]
pub(crate) fn thumb_cache_get(app: AppHandle, key: String, dir: Option<String>) -> Result<Option<String>, String> {
    use base64::Engine;
    let key = safe_cache_key(&key)?;
    let file = thumb_cache_dir(&app, &dir)?.join(format!("{key}.png"));
    if !file.exists() {
        return Ok(None);
    }
    let bytes = fs::read(&file).str_err()?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(Some(format!("data:image/png;base64,{encoded}")))
}

/// Persist a generated skeleton thumbnail (a `data:image/png;base64,...` URL) to the cache dir.
#[tauri::command]
pub(crate) fn thumb_cache_put(app: AppHandle, key: String, data: String, dir: Option<String>) -> Result<(), String> {
    use base64::Engine;
    let key = safe_cache_key(&key)?;
    let b64 = data
        .split_once(',')
        .map(|(_, rest)| rest)
        .ok_or("data URL không hợp lệ.")?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .str_err()?;
    let base = thumb_cache_dir(&app, &dir)?;
    fs::create_dir_all(&base).str_err()?;
    fs::write(base.join(format!("{key}.png")), bytes).str_err()
}
