//! Small filesystem/OS utility commands used across the UI: path checks,
//! opening files/URLs in the system shell, text writes and thumbnails.

use std::fs;
use tokio::process::Command;

use crate::{
    error::ResultExt,
    paths::{parse_quoted_path, unquote},
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

/// Read an image file and return it as a base64 data URL, for thumbnail display
/// in the webview (used by the Clean Source Folder detail view). Size-capped so
/// a stray huge file can't blow up the UI.
#[tauri::command]
pub(crate) fn read_image_data_url(path: String) -> Result<String, String> {
    use base64::Engine;
    let p = parse_quoted_path(&path);
    let meta = fs::metadata(&p).str_err()?;
    if meta.len() > 16 * 1024 * 1024 {
        return Err("Ảnh quá lớn để xem thumbnail.".to_string());
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
        _ => "application/octet-stream",
    };
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

#[tauri::command]
pub(crate) async fn open_url(url: String) -> Result<(), String> {
    let target = url.trim();
    if !(target.starts_with("http://") || target.starts_with("https://")) {
        return Err("Chỉ mở được http(s) URL.".to_string());
    }

    #[cfg(windows)]
    {
        // `explorer <url>` returns a non-zero exit code on success, so use `cmd /c start`.
        Command::new("cmd")
            .args(["/c", "start", "", target])
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
