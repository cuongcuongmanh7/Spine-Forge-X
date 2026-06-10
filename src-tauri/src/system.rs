//! Small filesystem/OS utility commands used across the UI: path checks,
//! opening files/URLs in the system shell, text writes and thumbnails.

use std::{fs, path::PathBuf};
use tokio::process::Command;

#[tauri::command]
pub(crate) fn path_exists(path: String) -> bool {
    let trimmed = path.trim().trim_matches('"');
    !trimmed.is_empty() && PathBuf::from(trimmed).exists()
}

#[tauri::command]
pub(crate) fn write_text_file(path: String, content: String) -> Result<(), String> {
    let target = PathBuf::from(path.trim_matches('"'));
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&target, content).map_err(|e| e.to_string())
}

/// Read an image file and return it as a base64 data URL, for thumbnail display
/// in the webview (used by the Clean Source Folder detail view). Size-capped so
/// a stray huge file can't blow up the UI.
#[tauri::command]
pub(crate) fn read_image_data_url(path: String) -> Result<String, String> {
    use base64::Engine;
    let p = PathBuf::from(path.trim_matches('"'));
    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    if meta.len() > 16 * 1024 * 1024 {
        return Err("Ảnh quá lớn để xem thumbnail.".to_string());
    }
    let bytes = fs::read(&p).map_err(|e| e.to_string())?;
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
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub(crate) async fn open_path(path: String) -> Result<(), String> {
    let target = PathBuf::from(path.trim_matches('"'));
    if !target.exists() {
        return Err("Path không tồn tại.".to_string());
    }

    #[cfg(windows)]
    {
        Command::new("explorer")
            .arg(target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// List immediate subdirectory names of `path` (sorted). Used by the Linked Project modal's
/// "Auto-fill from Unity root" — each subfolder becomes a candidate destination type.
#[tauri::command]
pub(crate) fn list_subdirectories(path: String) -> Result<Vec<String>, String> {
    let root = PathBuf::from(path.trim_matches('"'));
    if !root.is_dir() {
        return Err("Path không phải thư mục hợp lệ.".to_string());
    }
    let mut names: Vec<String> = fs::read_dir(&root)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();
    names.sort();
    Ok(names)
}
