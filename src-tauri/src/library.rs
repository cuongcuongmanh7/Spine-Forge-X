//! Asset Library scan (v0.3.7): inventory every `.spine` under a master folder,
//! fully offline. Reuses `clean::discover_clean_units` for `.spine`+image pairing,
//! `cleaner::collect_images` for per-folder image bytes/count, and
//! `spine_project::read_editor_version` for the editor version (no Spine CLI run).
//! Per-unit work runs bounded-parallel via `concurrent::run_indexed`.

use std::sync::atomic::AtomicBool;

use crate::clean::discover_clean_units;
use crate::model::{LibraryEntry, LibraryScan};
use crate::paths::{parse_quoted_path, path_to_string};
use crate::{cleaner, concurrent, spine_project};

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
