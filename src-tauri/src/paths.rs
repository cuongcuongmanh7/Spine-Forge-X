//! Path string helpers shared across commands. Paths reaching the backend from
//! the UI (drag-drop, paste, manual entry) often arrive wrapped in double-quotes;
//! these helpers strip that consistently instead of every call site repeating
//! `trim_matches('"')`.

use std::path::{Path, PathBuf};

/// Strip surrounding double-quotes from a path string, returning the bare slice.
pub(crate) fn unquote(s: &str) -> &str {
    s.trim_matches('"')
}

/// Parse a possibly-quoted path string into a `PathBuf`.
pub(crate) fn parse_quoted_path(s: &str) -> PathBuf {
    PathBuf::from(unquote(s))
}

/// Lossy `Path` → `String`, used wherever a path crosses the Tauri boundary.
pub(crate) fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

/// True when `s` contains any non-ASCII character (e.g. Vietnamese/Chinese path
/// segments). Used to decide whether the Unicode copy-to-temp workaround applies.
pub(crate) fn has_non_ascii(s: &str) -> bool {
    !s.is_ascii()
}

/// Map the legacy/invalid `packSource` value "folder" to the canonical
/// "imagefolders"; pass any other value through untouched.
pub(crate) fn normalize_pack_source(value: &str) -> &str {
    match value.trim() {
        "folder" => "imagefolders",
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unquote_strips_surrounding_quotes() {
        assert_eq!(unquote("\"C:/a b/c\""), "C:/a b/c");
        assert_eq!(unquote("C:/a/b"), "C:/a/b");
        assert_eq!(unquote(""), "");
    }

    #[test]
    fn has_non_ascii_detects_unicode() {
        assert!(!has_non_ascii("D:/Projects/Spine/Enemy/4001"));
        assert!(has_non_ascii("D:/Dự án/Nhân vật"));
        assert!(has_non_ascii("D:/项目/角色"));
        assert!(!has_non_ascii(""));
    }

    #[test]
    fn normalize_pack_source_maps_legacy_folder() {
        assert_eq!(normalize_pack_source("folder"), "imagefolders");
        assert_eq!(normalize_pack_source("  folder  "), "imagefolders");
        assert_eq!(normalize_pack_source("imagefolders"), "imagefolders");
        assert_eq!(normalize_pack_source("rectangles"), "rectangles");
    }
}
