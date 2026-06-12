//! Leaf helpers shared across the command/engine modules: Spine executable
//! detection + version parsing, path/name predicates, output-folder naming,
//! temp-directory plumbing for the Unicode workaround, and process control.
//! Split out of lib.rs in v0.3.3. No project-type dependencies (keeps the
//! dependency graph flat).

use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, AtomicUsize, Ordering},
};
use tokio::process::Command;
use walkdir::WalkDir;

use crate::error::ResultExt;

/// Scan `output_dir` for at least one file with a recognised Spine output
/// extension (`.skel`, `.json`, `.atlas`). Returns `true` when at least one
/// such file is found, `false` otherwise.
pub(crate) fn has_output_files(output_dir: &str) -> bool {
    let path = Path::new(output_dir);
    if !path.is_dir() {
        return false;
    }
    WalkDir::new(path)
        .into_iter()
        .filter_map(Result::ok)
        .any(|entry| {
            let p = entry.path();
            if !p.is_file() {
                return false;
            }
            let Some(name) = p.file_name().and_then(|n| n.to_str()) else {
                return false;
            };
            let lower = name.to_ascii_lowercase();
            // Bỏ qua Unity .meta sidecar để tránh false positive khi chỉ còn .meta.
            if lower.ends_with(".meta") {
                return false;
            }
            // Match trong cả tên file (không chỉ đuôi cuối) để nhận các đuôi Unity như
            // .skel.bytes và .atlas.txt, không chỉ .skel/.json/.atlas thuần.
            lower.contains(".skel") || lower.contains(".atlas") || lower.ends_with(".json")
        })
}

/// Find an already-existing destination folder under `base` that belongs to `id`, in priority order:
/// 1. a folder whose name is exactly `id`, then
/// 2. a folder whose name starts with `{id}_` (e.g. id "0001" → "0001_Fighter").
/// Returns `None` when neither exists (caller then creates a new folder). Among multiple prefix
/// matches the first in sorted order is chosen for determinism.
pub(crate) fn find_existing_id_folder(base: &Path, id: &str) -> Option<String> {
    if id.is_empty() || !base.is_dir() {
        return None;
    }

    let mut subdirs: Vec<String> = fs::read_dir(base)
        .ok()?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();
    subdirs.sort();

    // 1. Exact match.
    if let Some(exact) = subdirs.iter().find(|name| name.as_str() == id) {
        return Some(exact.clone());
    }
    // 2. Prefix `{id}_` match.
    let prefix = format!("{id}_");
    subdirs.into_iter().find(|name| name.starts_with(&prefix))
}

pub(crate) fn make_export_folder_name(target_version: &str) -> String {
    let version = sanitize_folder_part(target_version);
    let now = chrono::Local::now();
    format!("export_{}_{}", version, now.format("%d%m%Y_%H%M%S"))
}

/// Shorten a source folder name to the token before the first underscore,
/// e.g. "3001_Lucius" -> "3001". Falls back to the full name when there is no
/// underscore or the leading token would be empty.
pub(crate) fn clean_source_folder_name(name: &str) -> &str {
    match name.split_once('_') {
        Some((head, _)) if !head.is_empty() => head,
        _ => name,
    }
}

pub(crate) fn sanitize_folder_part(value: &str) -> String {
    let sanitized = value
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '.' || ch == '-' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>();

    if sanitized.is_empty() {
        "unknown".to_string()
    } else {
        sanitized
    }
}

pub(crate) fn normalize_skeleton_extension(value: &str, format: &str) -> String {
    let fallback = if format == "Binary" { ".skel" } else { ".json" };
    let trimmed = value.trim();

    if trimmed.is_empty()
        || !trimmed.starts_with('.')
        || trimmed.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])
    {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

pub(crate) fn is_timestamp_export_folder(name: &str) -> bool {
    let parts = name.split('_').collect::<Vec<_>>();
    parts.len() == 4
        && parts[0] == "export"
        && !parts[1].is_empty()
        && parts[2].len() == 8
        && parts[2].chars().all(|ch| ch.is_ascii_digit())
        && parts[3].len() == 6
        && parts[3].chars().all(|ch| ch.is_ascii_digit())
}

/// Normalised path for case/slash-insensitive comparison against the UI's file list.
pub(crate) fn normalize_path_for_compare(p: &str) -> String {
    p.replace('\\', "/").to_lowercase()
}

pub(crate) fn spine_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(spine_path) = std::env::var("SPINE_PATH") {
        let path = PathBuf::from(spine_path);
        candidates.push(path.clone());
        candidates.push(path.join("Spine.com"));
        candidates.push(path.join("Spine.exe"));
    }

    if cfg!(windows) {
        candidates.push(PathBuf::from(r"C:\Program Files\Spine\Spine.com"));
        candidates.push(PathBuf::from(r"C:\Program Files (x86)\Spine\Spine.com"));
        candidates.push(PathBuf::from(r"C:\Program Files\Spine\Spine.exe"));
        candidates.push(PathBuf::from(r"C:\Program Files (x86)\Spine\Spine.exe"));
    } else if cfg!(target_os = "macos") {
        candidates.push(PathBuf::from("/Applications/Spine.app/Contents/MacOS/Spine"));
    }

    candidates
}

pub(crate) fn is_spine_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("spine"))
        .unwrap_or(false)
}

pub(crate) fn is_temp_spine_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.starts_with(".~") || name.starts_with('~'))
        .unwrap_or(false)
}

/// Stop-gate used by the batch export loop: returns true when no Stop has been
/// requested and the next file may start. Centralised here so the invariant
/// "a Stop request prevents any new file from starting" stays unit-testable.
pub(crate) fn may_start_next(stop_requested: &AtomicBool) -> bool {
    !stop_requested.load(Ordering::SeqCst)
}

/// Build a unique ASCII temp directory path under the system temp dir.
pub(crate) fn unicode_temp_dir(suffix: &str) -> PathBuf {
    // A process-wide counter guarantees uniqueness even when several temp dirs
    // are requested within the same millisecond (e.g. concurrent clean units),
    // so parallel tasks never stomp on each other's directory (Windows os error 3).
    static SEQ: AtomicUsize = AtomicUsize::new(0);
    let seq = SEQ.fetch_add(1, Ordering::SeqCst);
    std::env::temp_dir().join(format!(
        "spineforge-uni-{}-{}-{}-{}",
        std::process::id(),
        chrono::Local::now().format("%Y%m%d%H%M%S%3f"),
        suffix,
        seq
    ))
}

/// Copy a `.spine` file and every sibling file (images / atlas sources / `.export.json` live next
/// to it) into a fresh ASCII temp directory. Returns `(temp_input_file, temp_input_dir)`; the
/// caller is responsible for removing `temp_input_dir`. The file name is preserved (only the
/// containing directory is made ASCII — the common failing case is a non-ASCII folder path).
pub(crate) fn copy_spine_to_temp(input_file: &Path) -> Result<(PathBuf, PathBuf), String> {
    let parent = input_file
        .parent()
        .ok_or_else(|| "Không xác định được folder nguồn.".to_string())?;
    let file_name = input_file
        .file_name()
        .ok_or_else(|| "Không xác định được tên file .spine.".to_string())?;

    let temp_dir = unicode_temp_dir("in");
    let _ = fs::remove_dir_all(&temp_dir);
    fs::create_dir_all(&temp_dir).str_err()?;

    for entry in fs::read_dir(parent).str_err()?.filter_map(Result::ok) {
        let path = entry.path();
        if path.is_file() {
            if let Some(name) = path.file_name() {
                fs::copy(&path, temp_dir.join(name)).str_err()?;
            }
        }
    }

    Ok((temp_dir.join(file_name), temp_dir))
}

/// Recursively copy every file/subdir from `src` into `dst` (creating `dst` as needed).
pub(crate) fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).str_err()?;
    for entry in WalkDir::new(src).min_depth(1).into_iter().filter_map(Result::ok) {
        let rel = entry.path().strip_prefix(src).str_err()?;
        let target = dst.join(rel);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&target).str_err()?;
        } else if entry.file_type().is_file() {
            if let Some(p) = target.parent() {
                fs::create_dir_all(p).str_err()?;
            }
            fs::copy(entry.path(), &target).str_err()?;
        }
    }
    Ok(())
}

/// Removes the held temp directories when dropped, so the Unicode workaround cleans up on any
/// exit path (success, failure, or timeout).
pub(crate) struct TempDirGuard(pub(crate) Vec<PathBuf>);

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        for dir in &self.0 {
            let _ = fs::remove_dir_all(dir);
        }
    }
}

/// Parse the Spine *editor* version (`\d+\.\d+\.\d+`) from `Spine.com --version` output.
///
/// The CLI prints several version-like tokens, e.g.:
/// ```text
/// Spine Launcher 4.3.05                  <- launcher, NOT what --update wants
/// Windows 10 Pro amd64 10.0
/// Starting: Spine 4.3.17 Professional    <- the editor version we want
/// Spine 4.3.17 Professional
/// ```
/// Taking the first semver token would return the launcher version. Instead, prefer a line that
/// mentions "Spine" but not "Launcher" (the editor lines), and only fall back to the first token
/// anywhere if no such line is found.
pub(crate) fn parse_spine_version(output: &str) -> Option<String> {
    for line in output.lines() {
        let lower = line.to_ascii_lowercase();
        if lower.contains("spine") && !lower.contains("launcher") {
            if let Some(version) = first_semver_in(line) {
                return Some(version);
            }
        }
    }
    first_semver_in(output)
}

/// Return the first `\d+\.\d+\.\d+` token in `text`, trimming surrounding punctuation.
fn first_semver_in(text: &str) -> Option<String> {
    for token in text.split(|ch: char| ch.is_whitespace() || ch == ',' || ch == ';') {
        let trimmed = token.trim_matches(|ch: char| !ch.is_ascii_alphanumeric());
        if is_semver_token(trimmed) {
            return Some(trimmed.to_string());
        }
    }
    None
}

/// Returns `true` when `s` matches the pattern `\d+\.\d+\.\d+` exactly —
/// one or more digit groups separated by exactly two dots, nothing else.
fn is_semver_token(s: &str) -> bool {
    let parts: Vec<&str> = s.split('.').collect();
    parts.len() == 3 && parts.iter().all(|part| !part.is_empty() && part.chars().all(|ch| ch.is_ascii_digit()))
}

/// Windows flag that prevents a spawned console process from opening a console window.
#[cfg(windows)]
pub(crate) const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Suppress the console window that Windows pops up when spawning console executables
/// (e.g. Spine.com). No-op on other platforms.
pub(crate) fn apply_no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

pub(crate) async fn kill_process(pid: u32) {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("taskkill");
        cmd.arg("/PID").arg(pid.to_string()).arg("/T").arg("/F");
        apply_no_window(&mut cmd);
        let _ = cmd.output().await;
    }

    #[cfg(not(windows))]
    {
        let _ = Command::new("kill")
            .arg("-TERM")
            .arg(pid.to_string())
            .output()
            .await;
    }
}
