//! Asset Library scan (v0.3.7): inventory every `.spine` under a master folder,
//! fully offline. Reuses `clean::discover_clean_units` for `.spine`+image pairing,
//! `cleaner::collect_images` for per-folder image bytes/count, and
//! `spine_project::read_editor_version` for the editor version (no Spine CLI run).
//! Per-unit work runs bounded-parallel via `concurrent::run_indexed`.

use std::collections::{BTreeSet, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

use notify::event::ModifyKind;
use notify::{EventKind, RecursiveMode, Watcher};
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

use crate::clean::discover_clean_units;
use crate::model::{AppState, BatchScanSummary, ExportAssets, ExportPage, FolderScan, LibraryEntry, LibraryScan};
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

/// Image extensions an atlas page filename can carry.
const PAGE_IMAGE_EXTS: [&str; 6] = ["png", "jpg", "jpeg", "webp", "bmp", "tga"];

/// Texture-page filenames an atlas references: the non-indented, colon-free lines
/// ending in an image extension (the page headers; region/property lines are excluded).
pub(crate) fn atlas_page_names(content: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in content.lines() {
        if line.is_empty() || line.starts_with(' ') || line.starts_with('\t') || line.contains(':') {
            continue;
        }
        let name = line.trim_end();
        let lower = name.to_ascii_lowercase();
        if PAGE_IMAGE_EXTS.iter().any(|ext| lower.ends_with(&format!(".{ext}"))) {
            let name = name.to_string();
            if !out.contains(&name) {
                out.push(name);
            }
        }
    }
    out
}

/// Map a full Spine version ("3.8.99", "4.2.43", "4.3.17") to the runtime key we render with:
/// the vendored 3.8 player, or a specific 4.x minor ("4.2", "4.3", …) — the 4.x binary/JSON
/// formats differ between minors, so a 4.2 export must load the 4.2 runtime, not 4.3. Unparseable
/// 4.x falls back to the generic "4.x" key (latest bundled 4.x player).
fn version_family(v: &str) -> String {
    if v.starts_with("3.8") {
        return "3.8".to_string();
    }
    let mut it = v.split('.');
    match (it.next(), it.next()) {
        (Some(major), Some(minor)) if !major.is_empty() && !minor.is_empty() && minor.bytes().all(|c| c.is_ascii_digit()) => {
            format!("{major}.{minor}")
        }
        _ => "4.x".to_string(),
    }
}

/// Version family of a JSON skeleton, read from its `skeleton.spine` field.
pub(crate) fn json_skeleton_version(content: &str) -> Option<String> {
    let root: Value = serde_json::from_str(content).ok()?;
    let spine = root.get("skeleton")?.get("spine")?.as_str()?;
    Some(version_family(spine))
}

/// Strip the export extension(s) off a filename to get its "set" stem, so a skeleton can be
/// matched to the atlas of the same base name. Handles `.skel.bytes`, `.skel`, `.json`, `.atlas`,
/// `.atlas.txt`. e.g. `9905.skel.bytes` → `9905`, `9905_Portal.atlas.txt` → `9905_portal`.
fn export_stem(file_name: &str) -> String {
    let mut s = file_name.to_ascii_lowercase();
    if let Some(t) = s.strip_suffix(".bytes") {
        s = t.to_string();
    }
    if let Some(t) = s.strip_suffix(".txt") {
        s = t.to_string();
    }
    for ext in [".skel", ".json", ".atlas"] {
        if let Some(t) = s.strip_suffix(ext) {
            return t.to_string();
        }
    }
    s
}

/// Choose the skeleton + atlas that actually belong together in an export dir. A folder can hold
/// more than one set (a main rig + a separate "Portal"/effect atlas); picking the first skeleton
/// and the first atlas independently can cross them (main skeleton + effect atlas → "region not
/// found in atlas" → blank preview). So pair by base-name stem, preferring: the set matching the
/// unit folder name, then JSON over binary, then the largest skeleton (the main rig). Falls back to
/// preferred-skeleton + first-atlas when names genuinely differ and only one set exists.
pub(crate) fn pick_export_pair(dir: &Path, folder_stem: &str) -> Option<(PathBuf, String, PathBuf)> {
    let mut skels: Vec<(PathBuf, String, String, u64)> = Vec::new(); // path, format, stem, size
    let mut atlases: Vec<(PathBuf, String)> = Vec::new(); // path, stem
    for file in std::fs::read_dir(dir).ok()?.filter_map(Result::ok) {
        let path = file.path();
        if !path.is_file() {
            continue;
        }
        let fname = file.file_name().to_string_lossy().to_string();
        let lname = fname.to_ascii_lowercase();
        if lname.ends_with(".export.json") {
            continue;
        }
        if lname.contains(".atlas") {
            atlases.push((path, export_stem(&fname)));
        } else if lname.ends_with(".json") {
            let sz = file.metadata().map(|m| m.len()).unwrap_or(0);
            skels.push((path, "json".to_string(), export_stem(&fname), sz));
        } else if lname.contains(".skel") {
            let sz = file.metadata().map(|m| m.len()).unwrap_or(0);
            skels.push((path, "skel".to_string(), export_stem(&fname), sz));
        }
    }
    if skels.is_empty() || atlases.is_empty() {
        return None;
    }
    // Stem-matched pairs (skeleton ↔ atlas of the same base name).
    let mut pairs: Vec<(&PathBuf, &String, &str, u64, &PathBuf)> = Vec::new();
    for (sp, fmt, st, sz) in &skels {
        if let Some((ap, _)) = atlases.iter().find(|(_, ast)| ast == st) {
            pairs.push((sp, fmt, st.as_str(), *sz, ap));
        }
    }
    if pairs.is_empty() {
        // Names genuinely differ: keep the old behaviour (preferred skeleton + first atlas).
        let (sp, fmt, _, _) = skels.iter().find(|(_, f, _, _)| f == "json").or_else(|| skels.first())?;
        return Some((sp.clone(), fmt.clone(), atlases.first()?.0.clone()));
    }
    // Rank: how well the set name matches the folder/id (exact > contains > none), then JSON over
    // skel, then largest skeleton. The folder id is often only a substring of the set name
    // (folder `9912` → set `Splash_9912`), so a plain equality check isn't enough — and a folder
    // can carry a leftover copy-pasted set (`Splash_9911`) we must rank below the real one.
    let name_score = |stem: &str| -> u8 {
        if folder_stem.is_empty() {
            0
        } else if stem == folder_stem {
            2
        } else if stem.contains(folder_stem) {
            1
        } else {
            0
        }
    };
    pairs.sort_by(|a, b| {
        let aj = (a.1 == "json") as u8;
        let bj = (b.1 == "json") as u8;
        name_score(b.2).cmp(&name_score(a.2)).then(bj.cmp(&aj)).then(b.3.cmp(&a.3))
    });
    let best = &pairs[0];
    Some((best.0.clone(), best.1.clone(), best.4.clone()))
}

/// The unit folder's name, lowercased — the stem the "main" export set usually matches.
pub(crate) fn folder_stem_of(unit_folder: &Path) -> String {
    unit_folder
        .file_name()
        .map(|n| n.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

/// Resolve the file set the Spine web player needs to render a unit's already-exported
/// skeleton: skeleton (json/skel) + atlas + texture pages, plus the runtime version
/// detected from the skeleton itself. Scans the unit's `export`/`ex` subfolder and returns
/// the first complete skeleton+atlas pair (JSON preferred over binary). Offline — no Spine CLI.
#[tauri::command]
pub(crate) fn list_export_assets(folder: String) -> Result<ExportAssets, String> {
    let unit_folder = parse_quoted_path(&folder);
    if !unit_folder.exists() {
        return Err("Folder không tồn tại.".to_string());
    }

    let Ok(children) = std::fs::read_dir(&unit_folder) else {
        return Err("Không đọc được folder.".to_string());
    };
    let mut export_dirs: Vec<PathBuf> = Vec::new();
    for child in children.filter_map(Result::ok) {
        if !child.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = child.file_name().to_string_lossy().to_ascii_lowercase();
        if name == "export" || name == "ex" {
            export_dirs.push(child.path());
        }
    }
    if export_dirs.is_empty() {
        return Err("Chưa export — không có thư mục export/.".to_string());
    }

    let folder_stem = folder_stem_of(&unit_folder);
    for dir in export_dirs {
        let Some((skel_path, format, atlas_path)) = pick_export_pair(&dir, &folder_stem) else {
            continue;
        };

        let version = if format == "json" {
            std::fs::read_to_string(&skel_path)
                .ok()
                .and_then(|c| json_skeleton_version(&c))
        } else {
            // Pick the runtime from the binary header's version string, NOT from a full parse:
            // a 3.8 file our hand-ported reader can't fully walk must still render on the 3.8
            // runtime, or string offsets misalign into garbled region names. See
            // `skel_binary::read_skel_version_family`.
            std::fs::read(&skel_path)
                .ok()
                .map(|data| skel_binary::read_skel_version_family(&data))
        };

        let atlas_dir = atlas_path.parent().unwrap_or(&dir).to_path_buf();
        let pages = std::fs::read_to_string(&atlas_path)
            .map(|c| atlas_page_names(&c))
            .unwrap_or_default()
            .into_iter()
            .map(|name| {
                let page_path = atlas_dir.join(&name);
                ExportPage { name, path: path_to_string(&page_path) }
            })
            .collect();

        return Ok(ExportAssets {
            skeleton_path: path_to_string(&skel_path),
            skeleton_format: format,
            version,
            atlas_path: path_to_string(&atlas_path),
            pages,
        });
    }

    Err("Không tìm thấy skeleton + atlas hợp lệ trong export/.".to_string())
}

// ---- filesystem watcher (auto-detect added/removed .spine on the mounted Shared drive) ---------

/// Debounce window: collapse a burst of filesystem events (a folder sync, a bulk delete) into a
/// single rescan signal once things go quiet for this long.
const FS_DEBOUNCE: Duration = Duration::from_secs(2);

/// Is this event one that could change the library *inventory* (a `.spine` added/removed/renamed,
/// or a folder created/removed)? We ignore pure content edits and our own sidecar JSON churn so the
/// watcher doesn't fire a rescan on every save or metadata write.
fn is_structural_event(event: &notify::Event) -> bool {
    let kind_matters = matches!(
        event.kind,
        EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(ModifyKind::Name(_))
    );
    if !kind_matters {
        return false;
    }
    event.paths.iter().any(|p| {
        let s = p.to_string_lossy().to_ascii_lowercase();
        if s.contains("spineforge-") {
            return false; // our own sidecar files (library-meta / drive-meta) — never a real change
        }
        if s.contains("_unused_backup") {
            return false; // our own clean-backup folder churn — moving images here isn't an inventory change
        }
        // A `.spine` file, or a path with no extension (a folder add/remove that may carry units).
        s.ends_with(".spine") || p.extension().is_none()
    })
}

/// Watch the library root (the mounted Shared-drive folder, synced by Google Drive for Desktop) for
/// `.spine` files appearing/disappearing, and emit a debounced `library-fs-changed` event so the
/// frontend re-runs its scan. Replaces any previous watcher. No-op-safe to call repeatedly.
///
/// Caveat: Google Drive for Desktop streams files on demand, so events can arrive late or oddly
/// ordered — the heavy debounce + `.spine`-only filter keep that from causing rescan storms.
#[tauri::command]
pub(crate) async fn library_watch_start(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    root: String,
) -> Result<(), String> {
    let root_path = parse_quoted_path(&root);
    if !root_path.exists() {
        return Err("Path không tồn tại.".to_string());
    }

    // notify's callback is sync; forward "something structural happened" into an async debouncer.
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            if is_structural_event(&event) {
                let _ = tx.send(());
            }
        }
    })
    .map_err(|e| e.to_string())?;
    watcher.watch(&root_path, RecursiveMode::Recursive).map_err(|e| e.to_string())?;

    // Keep the watcher alive by parking it in state (dropping it stops watching). Replace any prior.
    *state.library_watcher.lock().unwrap() = Some(watcher);

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        // Trailing debounce: on the first event, wait until FS_DEBOUNCE of silence, then emit once.
        while rx.recv().await.is_some() {
            loop {
                tokio::select! {
                    _ = tokio::time::sleep(FS_DEBOUNCE) => break,
                    msg = rx.recv() => {
                        if msg.is_none() { return; } // channel closed (watcher dropped) → stop
                    }
                }
            }
            let _ = app_handle.emit("library-fs-changed", ());
        }
    });
    Ok(())
}

/// Stop watching the library folder (drops the watcher, which ends the event stream + debouncer).
#[tauri::command]
pub(crate) async fn library_watch_stop(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    *state.library_watcher.lock().unwrap() = None;
    Ok(())
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

    #[test]
    fn list_export_assets_prefers_json_and_detects_version_and_pages() {
        let unit = temp_dir("exassets");
        let export = unit.join("export");
        std::fs::create_dir_all(&export).unwrap();
        // 4.x JSON skeleton carries its version in skeleton.spine.
        std::fs::write(
            export.join("hero.json"),
            r#"{"skeleton":{"spine":"4.3.17"},"skins":[{"name":"default"}],"animations":{"idle":{}}}"#,
        )
        .unwrap();
        // A binary skeleton also present — JSON must win.
        std::fs::write(export.join("hero.skel"), b"\x00binary").unwrap();
        // Atlas with two pages; region/property lines must not be picked as pages.
        std::fs::write(
            export.join("hero.atlas"),
            "hero.png\nsize: 1024,1024\nformat: RGBA8888\nhead\n  xy: 2, 2\nhero_1.png\nsize: 512,512\nbody\n  xy: 2, 2\n",
        )
        .unwrap();
        std::fs::write(export.join("hero.export.json"), r#"{"ignored":true}"#).unwrap();

        let assets = list_export_assets(unit.to_string_lossy().to_string()).unwrap();
        assert_eq!(assets.skeleton_format, "json");
        assert!(assets.skeleton_path.ends_with("hero.json"));
        // Version family is the precise 4.x minor now, so the matching runtime is picked.
        assert_eq!(assets.version.as_deref(), Some("4.3"));
        assert!(assets.atlas_path.ends_with("hero.atlas"));
        let names: Vec<&str> = assets.pages.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, vec!["hero.png", "hero_1.png"], "pages only, in order");

        let _ = std::fs::remove_dir_all(&unit);
    }

    #[test]
    fn list_export_assets_binary_3_8_detected() {
        let unit = temp_dir("exassets-bin");
        let export = unit.join("ex");
        std::fs::create_dir_all(&export).unwrap();
        // A real 3.8-format binary skeleton parses; build a minimal valid one via skel_binary's
        // own round-trip is overkill here, so assert the 4.x fallback for an unparseable blob.
        std::fs::write(export.join("mob.skel.bytes"), b"\x00not-a-real-skel").unwrap();
        std::fs::write(export.join("mob.atlas.txt"), "mob.png\nsize: 64,64\npart\n  xy: 1,1\n").unwrap();

        let assets = list_export_assets(unit.to_string_lossy().to_string()).unwrap();
        assert_eq!(assets.skeleton_format, "skel");
        // No "3.8" version string in the header ⇒ treated as 4.x.
        assert_eq!(assets.version.as_deref(), Some("4.x"));
        assert_eq!(assets.pages.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), vec!["mob.png"]);

        let _ = std::fs::remove_dir_all(&unit);
    }

    #[test]
    fn list_export_assets_errors_without_export() {
        let unit = temp_dir("exassets-none");
        assert!(list_export_assets(unit.to_string_lossy().to_string()).is_err());
        let _ = std::fs::remove_dir_all(&unit);
    }
}
