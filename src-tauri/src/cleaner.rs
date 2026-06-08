//! Source-folder cleaning: find image assets that the skeleton no longer
//! references and move them to a timestamped backup. Ported from the standalone
//! Spine-Cleaner (TS) matcher, reimplemented in Rust.
//!
//! Reference source: the caller exports a `.spine` to a temporary JSON skeleton
//! (via the Spine CLI) and passes its contents to [`extract_json_references`].
//! We deliberately ignore any stale `.json` sitting next to the images.
//!
//! Safety: a reference that matches several images only by basename is
//! *ambiguous*. Rather than risk deleting in-use art, every ambiguous candidate
//! is treated as referenced (kept) — ambiguous/missing references never cause a
//! move.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use walkdir::WalkDir;

const IMAGE_EXTENSIONS: [&str; 6] = ["png", "jpg", "jpeg", "webp", "bmp", "tga"];
const IGNORED_DIRS: [&str; 4] = ["_unused_backup", ".spine-cleaner", "node_modules", ".git"];

// ---- Path helpers (port of path-utils.ts) ---------------------------------

/// Forward-slash, no leading slash, no doubled slashes.
fn normalize_relative_path(value: &str) -> String {
    let replaced = value.replace('\\', "/");
    let trimmed = replaced.trim_start_matches('/');
    let mut out = String::with_capacity(trimmed.len());
    let mut prev_slash = false;
    for ch in trimmed.chars() {
        if ch == '/' {
            if prev_slash {
                continue;
            }
            prev_slash = true;
        } else {
            prev_slash = false;
        }
        out.push(ch);
    }
    out
}

fn normalize_key(value: &str) -> String {
    normalize_relative_path(value).to_lowercase()
}

fn split_dir_base(p: &str) -> (&str, &str) {
    match p.rfind('/') {
        Some(i) => (&p[..i], &p[i + 1..]),
        None => ("", p),
    }
}

/// Strip a trailing extension from a basename, leaving a leading-dot name (".env") intact.
fn strip_ext(name: &str) -> &str {
    match name.rfind('.') {
        Some(i) if i > 0 => &name[..i],
        _ => name,
    }
}

fn without_extension(value: &str) -> String {
    let norm = normalize_relative_path(value);
    let (dir, base) = split_dir_base(&norm);
    let stem = strip_ext(base);
    if dir.is_empty() {
        stem.to_string()
    } else {
        format!("{dir}/{stem}")
    }
}

fn basename_key(value: &str) -> String {
    let key = normalize_key(value);
    split_dir_base(&key).1.to_string()
}

fn basename_without_extension_key(value: &str) -> String {
    let no_ext = without_extension(&normalize_key(value));
    split_dir_base(&no_ext).1.to_string()
}

// ---- Reference extraction (port of json-parser.ts) ------------------------

fn add_attachment_reference(refs: &mut HashSet<String>, name: &str, value: &Value) {
    if let Value::Object(obj) = value {
        if let Some(Value::String(path)) = obj.get("path") {
            if !path.trim().is_empty() {
                refs.insert(normalize_relative_path(path.trim()));
                return;
            }
        }
    }
    refs.insert(normalize_relative_path(name));
}

/// A slot map is `{ slotName: { attachmentName: attachmentValue } }`.
fn visit_slot_map(refs: &mut HashSet<String>, slot_map: &Value) {
    let Value::Object(slots) = slot_map else { return };
    for attachments in slots.values() {
        if let Value::Object(att) = attachments {
            for (name, value) in att {
                add_attachment_reference(refs, name, value);
            }
        }
    }
}

/// Extract every attachment image reference from a Spine JSON skeleton.
/// Handles both `skins` shapes: an array of `{ name, attachments }` (modern) and
/// a legacy object whose values are slot maps.
pub fn extract_json_references(content: &str) -> Vec<String> {
    let parsed: Value = match serde_json::from_str(content) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    let Value::Object(root) = parsed else { return Vec::new() };

    let mut refs: HashSet<String> = HashSet::new();
    match root.get("skins") {
        Some(Value::Array(skins)) => {
            for skin in skins {
                if let Value::Object(obj) = skin {
                    if let Some(attachments) = obj.get("attachments") {
                        visit_slot_map(&mut refs, attachments);
                    }
                }
            }
        }
        Some(Value::Object(skins)) => {
            for skin_value in skins.values() {
                visit_slot_map(&mut refs, skin_value);
            }
        }
        _ => {}
    }

    let mut out: Vec<String> = refs.into_iter().filter(|r| !r.is_empty()).collect();
    out.sort();
    out
}

// ---- Image collection + index --------------------------------------------

#[derive(Debug, Clone)]
pub struct ImageAsset {
    pub absolute_path: PathBuf,
    pub relative_path: String,
    pub size_bytes: u64,
}

fn has_image_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            let lower = e.to_lowercase();
            IMAGE_EXTENSIONS.contains(&lower.as_str())
        })
        .unwrap_or(false)
}

/// Collect every image file under `images_dir` (recursive), skipping IGNORED_DIRS.
pub fn collect_images(images_dir: &Path) -> Vec<ImageAsset> {
    let mut images = Vec::new();
    let walker = WalkDir::new(images_dir).into_iter().filter_entry(|entry| {
        if entry.file_type().is_dir() {
            if let Some(name) = entry.file_name().to_str() {
                return !IGNORED_DIRS.contains(&name);
            }
        }
        true
    });

    for entry in walker.filter_map(Result::ok) {
        let path = entry.path();
        if !entry.file_type().is_file() || !has_image_extension(path) {
            continue;
        }
        let relative = path
            .strip_prefix(images_dir)
            .map(|rel| normalize_relative_path(&rel.to_string_lossy()))
            .unwrap_or_default();
        let size_bytes = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        images.push(ImageAsset {
            absolute_path: path.to_path_buf(),
            relative_path: relative,
            size_bytes,
        });
    }

    images.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    images
}

struct ImageIndex {
    by_relative: HashMap<String, usize>,
    by_relative_no_ext: HashMap<String, usize>,
    by_basename: HashMap<String, Vec<usize>>,
    by_basename_no_ext: HashMap<String, Vec<usize>>,
}

fn make_index(images: &[ImageAsset]) -> ImageIndex {
    let mut index = ImageIndex {
        by_relative: HashMap::new(),
        by_relative_no_ext: HashMap::new(),
        by_basename: HashMap::new(),
        by_basename_no_ext: HashMap::new(),
    };
    for (i, image) in images.iter().enumerate() {
        let relative = normalize_key(&image.relative_path);
        index.by_relative.insert(relative.clone(), i);
        index.by_relative_no_ext.insert(without_extension(&relative), i);
        index
            .by_basename
            .entry(basename_key(&image.relative_path))
            .or_default()
            .push(i);
        index
            .by_basename_no_ext
            .entry(basename_without_extension_key(&image.relative_path))
            .or_default()
            .push(i);
    }
    index
}

enum Match {
    /// Exactly one image matched (exact path, no-ext, or unique basename).
    One(usize),
    /// Several images share the basename — kept (never moved), reported as ambiguous.
    Ambiguous,
    /// No image matched this reference.
    Missing,
}

fn match_reference(reference: &str, images: &[ImageAsset], index: &ImageIndex) -> (Match, Vec<usize>) {
    let key = normalize_key(reference);

    if let Some(&i) = index.by_relative.get(&key) {
        return (Match::One(i), vec![i]);
    }
    if let Some(&i) = index.by_relative_no_ext.get(&without_extension(&key)) {
        return (Match::One(i), vec![i]);
    }

    if let Some(candidates) = index.by_basename.get(&basename_key(&key)) {
        if candidates.len() == 1 {
            return (Match::One(candidates[0]), candidates.clone());
        }
        if candidates.len() > 1 {
            return (Match::Ambiguous, candidates.clone());
        }
    }

    if let Some(candidates) = index.by_basename_no_ext.get(&basename_without_extension_key(&key)) {
        if candidates.len() == 1 {
            return (Match::One(candidates[0]), candidates.clone());
        }
        if candidates.len() > 1 {
            return (Match::Ambiguous, candidates.clone());
        }
    }

    let _ = images;
    (Match::Missing, Vec::new())
}

// ---- Scan + move ----------------------------------------------------------

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UnusedImage {
    pub absolute_path: String,
    pub relative_path: String,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub total_images: usize,
    pub used: usize,
    pub unused: Vec<UnusedImage>,
    /// References that matched no image at all.
    pub missing: Vec<String>,
    /// References that matched several images by basename (kept, not moved).
    pub ambiguous: Vec<String>,
}

impl ScanResult {
    pub fn unused_bytes(&self) -> u64 {
        self.unused.iter().map(|u| u.size_bytes).sum()
    }
}

/// Compare `references` against the images on disk and classify each image as
/// used or unused. Ambiguous/missing references are reported but never make an
/// image "unused" (ambiguous candidates are treated as used).
pub fn scan(references: &[String], images: &[ImageAsset]) -> ScanResult {
    let index = make_index(images);
    let mut referenced: HashSet<usize> = HashSet::new();
    let mut missing: Vec<String> = Vec::new();
    let mut ambiguous: Vec<String> = Vec::new();

    for reference in references {
        let (outcome, candidates) = match_reference(reference, images, &index);
        match outcome {
            Match::One(i) => {
                referenced.insert(i);
            }
            Match::Ambiguous => {
                // Conservative: keep every candidate so ambiguity never deletes art.
                for i in candidates {
                    referenced.insert(i);
                }
                ambiguous.push(reference.clone());
            }
            Match::Missing => missing.push(reference.clone()),
        }
    }

    let unused: Vec<UnusedImage> = images
        .iter()
        .enumerate()
        .filter(|(i, _)| !referenced.contains(i))
        .map(|(_, image)| UnusedImage {
            absolute_path: image.absolute_path.to_string_lossy().to_string(),
            relative_path: image.relative_path.clone(),
            size_bytes: image.size_bytes,
        })
        .collect();

    missing.sort();
    missing.dedup();
    ambiguous.sort();
    ambiguous.dedup();

    ScanResult {
        total_images: images.len(),
        used: referenced.len(),
        unused,
        missing,
        ambiguous,
    }
}

/// Move `unused` images into `<parent-of-images_dir>/_unused_backup/<stamp>`,
/// preserving their sub-folder structure. Refuses to move any file that does
/// not live under `images_dir`. Returns the backup directory path.
pub fn move_unused(images_dir: &Path, unused: &[UnusedImage], stamp: &str) -> Result<String, String> {
    let parent = images_dir
        .parent()
        .ok_or_else(|| "Images dir has no parent for backup.".to_string())?;
    let backup_dir = parent.join("_unused_backup").join(stamp);

    for item in unused {
        let absolute = PathBuf::from(&item.absolute_path);
        let relative = absolute
            .strip_prefix(images_dir)
            .map_err(|_| format!("Refusing to move file outside images dir: {}", item.absolute_path))?;
        let destination = backup_dir.join(relative);
        if let Some(dir) = destination.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        fs::rename(&absolute, &destination).map_err(|e| e.to_string())?;
    }

    Ok(backup_dir.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn test_dir(tag: &str) -> PathBuf {
        static SEQ: AtomicUsize = AtomicUsize::new(0);
        let seq = SEQ.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "spineforge-cleaner-test-{}-{}-{}",
            tag,
            std::process::id(),
            seq
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn asset(rel: &str) -> ImageAsset {
        ImageAsset {
            absolute_path: PathBuf::from(format!("/img/{rel}")),
            relative_path: rel.to_string(),
            size_bytes: 1,
        }
    }

    #[test]
    fn path_helpers_normalize_and_split() {
        assert_eq!(normalize_relative_path("\\a\\\\b/c"), "a/b/c");
        assert_eq!(normalize_key("Skin/B_Cape.PNG"), "skin/b_cape.png");
        assert_eq!(without_extension("skin/b_cape.png"), "skin/b_cape");
        assert_eq!(without_extension("b_cape.png"), "b_cape");
        assert_eq!(basename_key("skin/b_cape.png"), "b_cape.png");
        assert_eq!(basename_without_extension_key("skin/B_Cape.png"), "b_cape");
    }

    #[test]
    fn extract_refs_object_skins_uses_name_or_path() {
        // Legacy object-shaped skins: values are slot maps directly.
        let json = r#"{
            "skins": {
                "default": { "slotA": { "body": {}, "head": { "path": "skin/head_v2" } } }
            }
        }"#;
        let refs = extract_json_references(json);
        assert_eq!(refs, vec!["body".to_string(), "skin/head_v2".to_string()]);
    }

    #[test]
    fn extract_refs_array_skins() {
        // Modern array-shaped skins: each entry has name + attachments.
        let json = r#"{
            "skins": [
                { "name": "default", "attachments": { "slotA": { "arm": { "path": "skin/arm" } } } }
            ]
        }"#;
        let refs = extract_json_references(json);
        assert_eq!(refs, vec!["skin/arm".to_string()]);
    }

    #[test]
    fn scan_matches_bare_name_to_subfolder_and_flags_unused() {
        // Reference "body" (bare) must match images/skin/body.png by basename.
        let images = vec![asset("skin/body.png"), asset("skin/leftover.png")];
        let refs = vec!["body".to_string()];
        let result = scan(&refs, &images);
        assert_eq!(result.used, 1);
        assert_eq!(result.unused.len(), 1);
        assert_eq!(result.unused[0].relative_path, "skin/leftover.png");
        assert!(result.missing.is_empty());
    }

    #[test]
    fn scan_exact_path_match_wins() {
        let images = vec![asset("skin_a/body.png"), asset("skin_b/body.png")];
        // Exact relative path → matches just skin_a/body, leaving skin_b/body unused.
        let refs = vec!["skin_a/body.png".to_string()];
        let result = scan(&refs, &images);
        assert_eq!(result.used, 1);
        assert_eq!(result.unused.len(), 1);
        assert_eq!(result.unused[0].relative_path, "skin_b/body.png");
    }

    #[test]
    fn scan_ambiguous_keeps_all_candidates() {
        // "shadow" matches shadow.png in two folders → ambiguous → both kept.
        let images = vec![asset("skin_a/shadow.png"), asset("skin_b/shadow.png")];
        let refs = vec!["shadow".to_string()];
        let result = scan(&refs, &images);
        assert!(result.unused.is_empty(), "ambiguous candidates must be kept");
        assert_eq!(result.ambiguous, vec!["shadow".to_string()]);
        assert_eq!(result.used, 2);
    }

    #[test]
    fn scan_missing_reference_reported() {
        let images = vec![asset("skin/body.png")];
        let refs = vec!["body".to_string(), "ghost".to_string()];
        let result = scan(&refs, &images);
        assert_eq!(result.missing, vec!["ghost".to_string()]);
        assert!(result.unused.is_empty());
    }

    #[test]
    fn move_unused_preserves_structure_and_refuses_outside() {
        let root = test_dir("move");
        let images_dir = root.join("images");
        fs::create_dir_all(images_dir.join("skin")).unwrap();
        let junk = images_dir.join("skin/junk.png");
        fs::write(&junk, b"x").unwrap();

        let unused = vec![UnusedImage {
            absolute_path: junk.to_string_lossy().to_string(),
            relative_path: "skin/junk.png".to_string(),
            size_bytes: 1,
        }];
        let backup = move_unused(&images_dir, &unused, "2026-06-08_10-00-00").unwrap();

        // Original gone, backup keeps the sub-folder structure.
        assert!(!junk.exists());
        assert!(PathBuf::from(&backup).join("skin/junk.png").is_file());
        assert!(backup.contains("_unused_backup"));

        // A file outside images_dir is rejected.
        let outside = root.join("outside.png");
        fs::write(&outside, b"x").unwrap();
        let bad = vec![UnusedImage {
            absolute_path: outside.to_string_lossy().to_string(),
            relative_path: "outside.png".to_string(),
            size_bytes: 1,
        }];
        assert!(move_unused(&images_dir, &bad, "2026-06-08_10-00-00").is_err());

        let _ = fs::remove_dir_all(&root);
    }
}
