//! Asset Library scan (v0.3.7): inventory every `.spine` under a master folder,
//! fully offline. Reuses `clean::discover_clean_units` for `.spine`+image pairing,
//! `cleaner::collect_images` for per-folder image bytes/count, and
//! `spine_project::read_editor_version` for the editor version (no Spine CLI run).
//! Per-unit work runs bounded-parallel via `concurrent::run_indexed`.

use std::collections::{BTreeSet, HashSet};
use std::path::Path;
use std::sync::atomic::AtomicBool;

use serde_json::Value;

use crate::clean::discover_clean_units;
use crate::model::{BatchScanSummary, FolderScan, LibraryEntry, LibraryScan};
use crate::paths::{parse_quoted_path, path_to_string, unquote};
use crate::util::normalize_path_for_compare;
use crate::{cleaner, concurrent, skel_binary, spine_project};

/// Animation + skin names read from a unit's exported skeleton(s).
struct SkeletonMeta {
    exported: bool,
    animations: Vec<String>,
    skins: Vec<String>,
}

/// Read animation + skin names from the `.json` skeleton(s) a unit has already exported.
/// Convention: exports live in an `export` or `ex` subfolder of the unit folder. Offline
/// (no Spine CLI). Unions across every skeleton found; `exported=false` when none exist.
fn read_skeleton_meta(unit_folder: &Path) -> SkeletonMeta {
    let mut animations: BTreeSet<String> = BTreeSet::new();
    let mut skins: BTreeSet<String> = BTreeSet::new();
    let mut exported = false;

    let Ok(children) = std::fs::read_dir(unit_folder) else {
        return SkeletonMeta { exported: false, animations: Vec::new(), skins: Vec::new() };
    };
    for child in children.filter_map(Result::ok) {
        if !child.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = child.file_name().to_string_lossy().to_ascii_lowercase();
        if name != "export" && name != "ex" {
            continue;
        }
        let Ok(files) = std::fs::read_dir(child.path()) else { continue };
        for file in files.filter_map(Result::ok) {
            let path = file.path();
            let lname = file.file_name().to_string_lossy().to_ascii_lowercase();
            // Settings file the cleaner writes — not an export artifact.
            if lname.ends_with(".export.json") {
                continue;
            }
            // Any real skeleton/atlas artifact means this unit has been exported, even when
            // it's binary (`.skel`/`.skel.bytes`) or a Unity `.atlas.txt`.
            let is_skeleton_json = lname.ends_with(".json");
            let is_artifact = is_skeleton_json || lname.contains(".skel") || lname.contains(".atlas");
            if !is_artifact {
                continue;
            }
            exported = true;
            // Binary skeletons (`.skel`/`.skel.bytes`, e.g. Unity exports) carry the same
            // animation/skin names as JSON — read them with the 3.8 binary parser. 4.x or any
            // malformed file simply yields nothing (the unit still counts as exported).
            if !is_skeleton_json {
                if lname.contains(".skel") {
                    if let Ok(data) = std::fs::read(&path) {
                        if let Ok(names) = skel_binary::read_skel_names(&data) {
                            animations.extend(names.animations);
                            skins.extend(names.skins);
                        }
                    }
                }
                continue;
            }
            let Ok(content) = std::fs::read_to_string(&path) else { continue };
            let Ok(Value::Object(root)) = serde_json::from_str::<Value>(&content) else { continue };
            if let Some(Value::Object(anims)) = root.get("animations") {
                animations.extend(anims.keys().cloned());
            }
            match root.get("skins") {
                // Modern: array of { name, ... }.
                Some(Value::Array(list)) => {
                    for skin in list {
                        if let Some(Value::String(n)) = skin.get("name") {
                            skins.insert(n.clone());
                        }
                    }
                }
                // Legacy 3.8: object keyed by skin name.
                Some(Value::Object(obj)) => skins.extend(obj.keys().cloned()),
                _ => {}
            }
        }
    }

    SkeletonMeta {
        exported,
        animations: animations.into_iter().collect(),
        skins: skins.into_iter().collect(),
    }
}

#[tauri::command]
pub(crate) async fn scan_library(root: String) -> Result<LibraryScan, String> {
    let root_path = parse_quoted_path(&root);
    if !root_path.exists() {
        return Err("Path không tồn tại.".to_string());
    }

    let units = discover_clean_units(&root_path);
    if units.is_empty() {
        return Ok(LibraryScan {
            root: path_to_string(&root_path),
            entries: Vec::new(),
            total_spine_bytes: 0,
            total_image_bytes: 0,
        });
    }

    // Each unit only does cheap, blocking filesystem work (stat + inflate + image
    // walk), so a modest fan-out keeps a large tree responsive. No Stop wiring is
    // needed — a local flag satisfies run_indexed and is never set.
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    let parallel = cores.clamp(2, 8).min(units.len());
    let stop = AtomicBool::new(false);

    let results = concurrent::run_indexed(units, parallel, &stop, |_index, unit, _done| {
        let root_pb = root_path.clone();
        async move {
            let spine_bytes = std::fs::metadata(&unit.spine_file).map(|m| m.len()).unwrap_or(0);
            let version = spine_project::read_editor_version(&unit.spine_file);
            let images = cleaner::collect_images(&unit.images_dir);
            let image_bytes: u64 = images.iter().map(|i| i.size_bytes).sum();
            let meta = read_skeleton_meta(&unit.folder);
            let rel_path = unit
                .spine_file
                .strip_prefix(&root_pb)
                .map(|p| path_to_string(p))
                .unwrap_or_else(|_| path_to_string(&unit.spine_file));
            LibraryEntry {
                rel_path,
                spine_file: path_to_string(&unit.spine_file),
                folder: path_to_string(&unit.folder),
                images_dir: path_to_string(&unit.images_dir),
                spine_bytes,
                image_bytes,
                image_count: images.len(),
                version,
                exported: meta.exported,
                animation_count: meta.animations.len(),
                animations: meta.animations,
                skins: meta.skins,
                error: None,
            }
        }
    })
    .await;

    let mut entries: Vec<LibraryEntry> = results.into_iter().map(|(_, entry)| entry).collect();
    entries.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));

    let total_spine_bytes = entries.iter().map(|e| e.spine_bytes).sum();
    let total_image_bytes = entries.iter().map(|e| e.image_bytes).sum();

    Ok(LibraryScan {
        root: path_to_string(&root_path),
        entries,
        total_spine_bytes,
        total_image_bytes,
    })
}

/// Used-image references from a unit's already-exported `.atlas` files (in an `export`/`ex`
/// subfolder). Atlas region names are the authoritative used-image list. Empty when no atlas.
fn read_export_atlas_refs(unit_folder: &Path) -> Vec<String> {
    let mut refs: BTreeSet<String> = BTreeSet::new();
    let Ok(children) = std::fs::read_dir(unit_folder) else { return Vec::new() };
    for child in children.filter_map(Result::ok) {
        if !child.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = child.file_name().to_string_lossy().to_ascii_lowercase();
        if name != "export" && name != "ex" {
            continue;
        }
        let Ok(files) = std::fs::read_dir(child.path()) else { continue };
        for file in files.filter_map(Result::ok) {
            // Match `.atlas` and Unity's `.atlas.txt`.
            let is_atlas = file
                .file_name()
                .to_str()
                .map(|n| n.to_ascii_lowercase().contains(".atlas"))
                .unwrap_or(false);
            if !is_atlas {
                continue;
            }
            if let Ok(content) = std::fs::read_to_string(file.path()) {
                refs.extend(cleaner::extract_atlas_references(&content));
            }
        }
    }
    refs.into_iter().collect()
}

/// Offline unused-image scan for the Library Clean tab: compares each unit's on-disk images
/// against the used-image list from its already-exported `.atlas` — no Spine CLI, no editor
/// launch. `selected` (a list of `.spine` paths) scopes the scan; empty means every unit.
/// A unit with no atlas is returned as an error (never flagged so all images look unused).
#[tauri::command]
pub(crate) fn scan_library_unused(root: String, selected: Vec<String>) -> Result<BatchScanSummary, String> {
    let root_path = parse_quoted_path(&root);
    if !root_path.exists() {
        return Err("Path không tồn tại.".to_string());
    }
    let mut units = discover_clean_units(&root_path);
    if !selected.is_empty() {
        let set: HashSet<String> = selected
            .iter()
            .map(|p| normalize_path_for_compare(unquote(p)))
            .collect();
        units.retain(|u| set.contains(&normalize_path_for_compare(&path_to_string(&u.spine_file))));
    }

    let mut total_unused = 0usize;
    let mut total_unused_bytes = 0u64;
    let mut out = Vec::with_capacity(units.len());
    for unit in &units {
        let refs = read_export_atlas_refs(&unit.folder);
        if refs.is_empty() {
            out.push(FolderScan::empty(
                unit,
                Some("Không tìm thấy atlas trong export/ — chưa export?".to_string()),
            ));
            continue;
        }
        let images = cleaner::collect_images(&unit.images_dir);
        let result = cleaner::scan(&refs, &images);
        total_unused += result.unused.len();
        total_unused_bytes += result.unused_bytes();
        out.push(FolderScan {
            folder: path_to_string(&unit.folder),
            images_dir: path_to_string(&unit.images_dir),
            spine_file: path_to_string(&unit.spine_file),
            total_images: result.total_images,
            used: result.used,
            unused_bytes: result.unused_bytes(),
            used_images: result.used_images,
            unused: result.unused,
            missing: result.missing,
            ambiguous: result.ambiguous,
            error: None,
        });
    }

    Ok(BatchScanSummary { units: out, total_unused, total_unused_bytes })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        static SEQ: AtomicUsize = AtomicUsize::new(0);
        let seq = SEQ.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("sfx-libmeta-{}-{}-{}", tag, std::process::id(), seq));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn read_skeleton_meta_unions_both_skin_shapes() {
        let unit = temp_dir("meta");
        let export = unit.join("export");
        std::fs::create_dir_all(&export).unwrap();
        // 4.x skeleton: skins as an array of { name }, animations as an object.
        std::fs::write(
            export.join("hero.json"),
            r#"{"skins":[{"name":"default"},{"name":"gold"}],"animations":{"idle":{},"attack":{}}}"#,
        )
        .unwrap();
        // 3.8 skeleton: skins as an object keyed by name.
        std::fs::write(
            export.join("hero_alt.json"),
            r#"{"skins":{"default":{},"silver":{}},"animations":{"walk":{}}}"#,
        )
        .unwrap();
        // A settings file that must be ignored.
        std::fs::write(export.join("hero.export.json"), r#"{"animations":{"SHOULD_IGNORE":{}}}"#).unwrap();

        let meta = read_skeleton_meta(&unit);
        assert!(meta.exported);
        assert_eq!(meta.animations, vec!["attack", "idle", "walk"]);
        assert_eq!(meta.skins, vec!["default", "gold", "silver"]);

        let _ = std::fs::remove_dir_all(&unit);
    }

    #[test]
    fn read_skeleton_meta_binary_export_is_exported_without_animations() {
        let unit = temp_dir("binexport");
        let export = unit.join("export");
        std::fs::create_dir_all(&export).unwrap();
        // Unity-style binary export: no JSON skeleton, only .skel.bytes + .atlas.txt.
        std::fs::write(export.join("0001.skel.bytes"), b"\x00binary").unwrap();
        std::fs::write(export.join("0001.atlas.txt"), "0001.png\nsize: 64,64\nhead\n").unwrap();

        let meta = read_skeleton_meta(&unit);
        assert!(meta.exported, "binary export should count as exported");
        assert!(meta.animations.is_empty());

        let _ = std::fs::remove_dir_all(&unit);
    }

    #[test]
    fn read_export_atlas_refs_reads_region_names() {
        let unit = temp_dir("atlas");
        let export = unit.join("ex");
        std::fs::create_dir_all(&export).unwrap();
        // Minimal libGDX atlas: page image line (skipped) + two region names.
        let atlas = "skeleton.png\nsize: 1024,1024\nformat: RGBA8888\nhead\n  rotate: false\n  xy: 2, 2\nbody\n  rotate: false\n  xy: 2, 2\n";
        std::fs::write(export.join("skeleton.atlas"), atlas).unwrap();

        let refs = read_export_atlas_refs(&unit);
        assert!(refs.contains(&"head".to_string()), "got {refs:?}");
        assert!(refs.contains(&"body".to_string()), "got {refs:?}");
        assert!(!refs.iter().any(|r| r.contains(".png")));

        let _ = std::fs::remove_dir_all(&unit);
    }

    #[test]
    fn read_export_atlas_refs_empty_without_atlas() {
        let unit = temp_dir("atlas-none");
        assert!(read_export_atlas_refs(&unit).is_empty());
        let _ = std::fs::remove_dir_all(&unit);
    }

    #[test]
    fn read_skeleton_meta_marks_unexported_when_no_export_folder() {
        let unit = temp_dir("noexport");
        let meta = read_skeleton_meta(&unit);
        assert!(!meta.exported);
        assert!(meta.animations.is_empty());
        let _ = std::fs::remove_dir_all(&unit);
    }
}
