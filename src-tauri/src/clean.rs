//! Clean source folder (v0.2.9). For a "pack folder" (packSource = imagefolders)
//! workflow, Spine packs the whole image folder, so unused images bloat the
//! atlas. This discovers images the skeleton no longer references and moves them
//! to a per-folder backup. References come from the *current* `.spine`, exported
//! to a temporary JSON skeleton via the Spine CLI (the `.spine` binary can't be
//! parsed directly, and any JSON next to the images is often stale). The pure
//! matching/move logic lives in `cleaner`. Split out of lib.rs in v0.3.3.

use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{atomic::Ordering, Arc},
    time::Duration,
};
use tauri::{Emitter, State, Window};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
    time,
};
use walkdir::WalkDir;

use crate::error::ResultExt;
use crate::model::*;
use crate::paths::*;
use crate::util::*;
use crate::{cleaner, concurrent};

/// Discover every `.spine` under `root` (recursive), pairing each with its image
/// directory (`<folder>/images` when present, else the folder itself). Supports
/// a single source folder or a parent containing many of them.
pub(crate) fn discover_clean_units(root: &Path) -> Vec<CleanUnit> {
    let mut units = Vec::new();
    for entry in WalkDir::new(root).into_iter().filter_map(Result::ok) {
        let path = entry.path();
        if !entry.file_type().is_file() || !is_spine_file(path) || is_temp_spine_file(path) {
            continue;
        }
        let Some(folder) = path.parent() else { continue };
        let images = folder.join("images");
        let images_dir = if images.is_dir() { images } else { folder.to_path_buf() };
        units.push(CleanUnit {
            spine_file: path.to_path_buf(),
            images_dir,
            folder: folder.to_path_buf(),
        });
    }
    units.sort_by(|a, b| a.spine_file.cmp(&b.spine_file));
    units
}

/// Drop units whose `.spine` is in the `excluded` list (files the user removed
/// from the export set) so cleaning respects the same selection as exporting.
fn filter_excluded_units(units: Vec<CleanUnit>, excluded: &[String]) -> Vec<CleanUnit> {
    if excluded.is_empty() {
        return units;
    }
    let excluded: Vec<String> = excluded
        .iter()
        .map(|p| normalize_path_for_compare(unquote(p)))
        .collect();
    units
        .into_iter()
        .filter(|unit| {
            let key = normalize_path_for_compare(&path_to_string(&unit.spine_file));
            !excluded.contains(&key)
        })
        .collect()
}

/// Minimal JSON-export settings: export the skeleton as JSON only (no atlas pack).
fn write_temp_json_export_settings(out_dir: &Path, spine_file: &Path) -> Result<PathBuf, String> {
    // Pack an atlas (`packAtlas: {}` = default settings). The atlas region names
    // are the authoritative used-image paths — they preserve each skin's image
    // folder and renamed-file basename (e.g. `skin_order_of_light/head copy`),
    // which the JSON skeleton drops (it keeps only bare placeholder names like
    // `head`). Without this, renamed/foldered images get flagged unused.
    let settings = serde_json::json!({
        "class": "export-json",
        "extension": ".json",
        "format": "JSON",
        "packAtlas": {},
        "packSource": "attachments",
        "nonessential": false,
        "cleanUp": false,
        "output": path_to_string(out_dir),
        "input": path_to_string(spine_file),
        "open": false
    });
    let settings_path = out_dir.join("clean-export.export.json");
    fs::write(
        &settings_path,
        serde_json::to_string_pretty(&settings).str_err()?,
    )
    .str_err()?;
    Ok(settings_path)
}

/// Export `spine_file` to a temp JSON skeleton via the Spine CLI and return its
/// parsed attachment references. The temp dir is removed before returning.
async fn references_from_spine(
    state: &Arc<AppState>,
    spine_path: &str,
    target_version: &str,
    spine_file: &Path,
) -> Result<Vec<String>, String> {
    let out_dir = unicode_temp_dir("clean");
    let _ = fs::remove_dir_all(&out_dir);
    fs::create_dir_all(&out_dir).str_err()?;
    let _guard = TempDirGuard(vec![out_dir.clone()]);

    let settings = write_temp_json_export_settings(&out_dir, spine_file)?;

    let mut cmd = Command::new(unquote(spine_path));
    cmd.arg("--update")
        .arg(target_version)
        .arg("--input")
        .arg(path_to_string(spine_file))
        .arg("--output")
        .arg(path_to_string(&out_dir))
        .arg("--export")
        .arg(path_to_string(&settings))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_no_window(&mut cmd);

    let mut child = cmd.spawn().str_err()?;
    let pid = child.id();
    if let Some(pid) = pid {
        state.running_children.lock().await.push(pid);
    }
    // Drain stdout/stderr so the child can't block on a full pipe buffer.
    let stdout_task = child.stdout.take().map(|s| {
        tokio::spawn(async move {
            let mut lines = BufReader::new(s).lines();
            while let Ok(Some(_)) = lines.next_line().await {}
        })
    });
    let stderr_task = child.stderr.take().map(|s| {
        tokio::spawn(async move {
            let mut lines = BufReader::new(s).lines();
            while let Ok(Some(_)) = lines.next_line().await {}
        })
    });

    let status = match time::timeout(Duration::from_secs(120), child.wait()).await {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => return Err(e.to_string()),
        Err(_) => {
            let _ = child.kill().await;
            return Err("Timeout khi export .spine để quét.".to_string());
        }
    };
    if let Some(pid) = pid {
        state.running_children.lock().await.retain(|v| *v != pid);
    }
    if let Some(t) = stdout_task {
        let _ = t.await;
    }
    if let Some(t) = stderr_task {
        let _ = t.await;
    }
    if !status.success() {
        return Err(format!("Spine CLI export thất bại (status {status})."));
    }

    // Collect output files. A project may hold several skeletons (base + per-skin
    // variants), so we union across every atlas / skeleton the CLI wrote.
    let outputs: Vec<PathBuf> = fs::read_dir(&out_dir)
        .str_err()?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .collect();

    let has_ext = |p: &Path, ext: &str| {
        p.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case(ext))
            .unwrap_or(false)
    };

    let mut refs: HashSet<String> = HashSet::new();

    // Prefer the atlas: its region names are the authoritative used-image paths,
    // preserving skin folders and renamed basenames the JSON skeleton drops.
    let atlas_paths: Vec<&PathBuf> = outputs.iter().filter(|p| has_ext(p, "atlas")).collect();
    for atlas in &atlas_paths {
        let content = fs::read_to_string(atlas).str_err()?;
        refs.extend(cleaner::extract_atlas_references(&content));
    }

    // Fall back to the JSON skeleton(s) when no atlas was produced (e.g. packing
    // unavailable) so scanning still works in a degraded, less-precise mode.
    if refs.is_empty() {
        let json_paths: Vec<&PathBuf> = outputs
            .iter()
            .filter(|p| {
                has_ext(p, "json")
                    && !p
                        .file_name()
                        .and_then(|n| n.to_str())
                        .map(|n| n.ends_with(".export.json"))
                        .unwrap_or(false)
            })
            .collect();
        if json_paths.is_empty() {
            return Err("Không tìm thấy atlas/JSON sau khi export.".to_string());
        }
        for json_path in &json_paths {
            let content = fs::read_to_string(json_path).str_err()?;
            refs.extend(cleaner::extract_json_references(&content));
        }
    }

    let mut refs: Vec<String> = refs.into_iter().collect();
    refs.sort();
    Ok(refs)
}

/// Cheap fingerprint of a unit's scan inputs: the `.spine` file's mtime + size,
/// the image count + total bytes, and the target version. Computed from the
/// already-collected image list (no extra disk walk) plus one stat of the
/// `.spine`. Any add/remove/resize of images or edit to the `.spine` changes it.
fn scan_signature(
    spine_file: &Path,
    target_version: &str,
    images: &[cleaner::ImageAsset],
) -> ScanSig {
    let (spine_mtime, spine_size) = fs::metadata(spine_file)
        .map(|m| {
            let mtime = m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            (mtime, m.len())
        })
        .unwrap_or((0, 0));
    ScanSig {
        target_version: target_version.to_string(),
        spine_mtime,
        spine_size,
        img_count: images.len(),
        img_bytes: images.iter().map(|i| i.size_bytes).sum(),
    }
}

/// Export + scan a single unit (no file moves). Reuses a cached result when the
/// unit's inputs are unchanged, skipping the expensive Spine CLI export.
async fn scan_unit(
    state: &Arc<AppState>,
    spine_path: &str,
    target_version: &str,
    unit: &CleanUnit,
) -> FolderScan {
    // Collecting images is cheap (a filesystem walk); the export is what costs
    // seconds. Fingerprint first so an unchanged unit can hit the cache.
    let images = cleaner::collect_images(&unit.images_dir);
    let sig = scan_signature(&unit.spine_file, target_version, &images);
    if let Some((cached_sig, cached_scan)) = state.scan_cache.lock().await.get(&unit.spine_file) {
        if *cached_sig == sig {
            return cached_scan.clone();
        }
    }

    match references_from_spine(state, spine_path, target_version, &unit.spine_file).await {
        Ok(refs) => {
            let result = cleaner::scan(&refs, &images);
            let scan = FolderScan {
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
            };
            state
                .scan_cache
                .lock()
                .await
                .insert(unit.spine_file.clone(), (sig, scan.clone()));
            scan
        }
        Err(e) => FolderScan::empty(unit, Some(e)),
    }
}

/// Run every unit concurrently (bounded), optionally moving unused files.
/// Returns each unit's scan plus, when `do_move`, its (moved-count, backup-dir).
async fn run_clean_units(
    window: &Window,
    state: &Arc<AppState>,
    spine_path: &str,
    target_version: &str,
    units: Vec<CleanUnit>,
    do_move: bool,
) -> Vec<(FolderScan, Option<(usize, String)>)> {
    let total = units.len();
    // Most of each unit's cost is Spine CLI/JVM startup (idle wait), so scaling
    // past the old fixed 4 helps. Cap at 8 to bound concurrent Spine processes
    // (each uses real RAM/GPU); never spawn more than there are units.
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    let parallel = cores.clamp(4, 8).min(total.max(1));
    // One backup timestamp per run (each folder gets its own _unused_backup/<stamp>).
    let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();

    let indexed = concurrent::run_indexed(
        units,
        parallel,
        &state.stop_requested,
        |_index, unit, done| {
            let st = Arc::clone(state);
            let win = window.clone();
            let sp = spine_path.to_string();
            let tv = target_version.to_string();
            let stamp = stamp.clone();
            async move {
                if !may_start_next(&st.stop_requested) {
                    return (FolderScan::empty(&unit, Some("Đã dừng.".to_string())), None);
                }
                let mut scan = scan_unit(&st, &sp, &tv, &unit).await;
                let mut moved_info = None;
                if do_move && scan.error.is_none() && !scan.unused.is_empty() {
                    match cleaner::move_unused(&unit.images_dir, &scan.unused, &stamp) {
                        Ok(backup) => {
                            // Moving files changes the image set; drop the now-stale
                            // cache entry so the next scan re-exports this unit.
                            st.scan_cache.lock().await.remove(&unit.spine_file);
                            moved_info = Some((scan.unused.len(), backup));
                        }
                        Err(e) => scan.error = Some(e),
                    }
                }
                let current = done.tick();
                let _ = win.emit(
                    "spine-progress",
                    ProgressPayload {
                        current,
                        total,
                        file: scan.folder.clone(),
                    },
                );
                let detail = match &scan.error {
                    Some(err) => format!("LỖI: {err}"),
                    None => format!("{} unused", scan.unused.len()),
                };
                let _ = win.emit("spine-log", format!("[{current}/{total}] {} — {detail}", scan.folder));
                (scan, moved_info)
            }
        },
    )
    .await;

    // run_indexed returns completion order; restore the original unit order.
    let mut results: Vec<Option<(FolderScan, Option<(usize, String)>)>> =
        (0..total).map(|_| None).collect();
    for (index, pair) in indexed {
        results[index] = Some(pair);
    }
    results.into_iter().flatten().collect()
}

/// Move a specific folder's already-scanned unused images to its own
/// `_unused_backup/<timestamp>`. Reuses the paths from a prior scan, so it does
/// not re-export the `.spine`. Returns the backup directory.
#[tauri::command]
pub(crate) fn move_unused_images(images_dir: String, files: Vec<String>) -> Result<String, String> {
    if files.is_empty() {
        return Err("Không có ảnh thừa để chuyển.".to_string());
    }
    let dir = parse_quoted_path(&images_dir);
    let entries: Vec<cleaner::ImageEntry> = files
        .into_iter()
        .map(|absolute_path| cleaner::ImageEntry {
            absolute_path,
            relative_path: String::new(),
            size_bytes: 0,
        })
        .collect();
    let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    cleaner::move_unused(&dir, &entries, &stamp)
}

/// Count how many `.spine` units live under `root` without exporting anything.
/// Cheap (a single directory walk) — used to warn before a large scan that would
/// otherwise spawn the Spine CLI once per skeleton.
#[tauri::command]
pub(crate) fn count_clean_units(root: String, excluded: Vec<String>) -> usize {
    let root_path = parse_quoted_path(&root);
    if !root_path.exists() {
        return 0;
    }
    filter_excluded_units(discover_clean_units(&root_path), &excluded).len()
}

/// List every `.spine` unit under `root` without exporting (a single cheap walk).
/// Lets the UI show a checkbox list so the user can scan only some sub-folders;
/// the unchecked ones are passed back as `excluded` to scan/clean.
#[tauri::command]
pub(crate) fn list_clean_units(root: String) -> Vec<CleanUnitInfo> {
    let root_path = parse_quoted_path(&root);
    if !root_path.exists() {
        return Vec::new();
    }
    discover_clean_units(&root_path)
        .into_iter()
        .map(|unit| CleanUnitInfo {
            folder: path_to_string(&unit.folder),
            spine_file: path_to_string(&unit.spine_file),
        })
        .collect()
}

/// Scan source folders under `root` for unused image assets (no files touched).
#[tauri::command]
pub(crate) async fn scan_source_folders(
    window: Window,
    state: State<'_, Arc<AppState>>,
    spine_path: String,
    target_version: String,
    root: String,
    excluded: Vec<String>,
) -> Result<BatchScanSummary, String> {
    let root_path = parse_quoted_path(&root);
    if !root_path.exists() {
        return Err("Path không tồn tại.".to_string());
    }
    if spine_path.trim().is_empty() {
        return Err("Chưa chọn Spine executable.".to_string());
    }

    let units = filter_excluded_units(discover_clean_units(&root_path), &excluded);
    if units.is_empty() {
        return Err("Không tìm thấy file .spine nào trong thư mục.".to_string());
    }

    state.stop_requested.store(false, Ordering::SeqCst);
    let total = units.len();
    let _ = window.emit("spine-log", format!("Quét {total} folder để tìm ảnh thừa…"));

    let state_arc: Arc<AppState> = Arc::clone(&state);
    let scans = run_clean_units(&window, &state_arc, &spine_path, &target_version, units, false).await;

    let mut total_unused = 0usize;
    let mut total_unused_bytes = 0u64;
    let units_out: Vec<FolderScan> = scans
        .into_iter()
        .map(|(scan, _)| {
            total_unused += scan.unused.len();
            total_unused_bytes += scan.unused_bytes;
            scan
        })
        .collect();

    Ok(BatchScanSummary {
        units: units_out,
        total_unused,
        total_unused_bytes,
    })
}

/// Scan + move unused images to a per-folder timestamped backup.
#[tauri::command]
pub(crate) async fn clean_source_folders(
    window: Window,
    state: State<'_, Arc<AppState>>,
    spine_path: String,
    target_version: String,
    root: String,
    excluded: Vec<String>,
) -> Result<BatchCleanResult, String> {
    let root_path = parse_quoted_path(&root);
    if !root_path.exists() {
        return Err("Path không tồn tại.".to_string());
    }
    if spine_path.trim().is_empty() {
        return Err("Chưa chọn Spine executable.".to_string());
    }

    let units = filter_excluded_units(discover_clean_units(&root_path), &excluded);
    if units.is_empty() {
        return Err("Không tìm thấy file .spine nào trong thư mục.".to_string());
    }

    state.stop_requested.store(false, Ordering::SeqCst);
    let total = units.len();
    let _ = window.emit("spine-log", format!("Dọn ảnh thừa cho {total} folder…"));

    let state_arc: Arc<AppState> = Arc::clone(&state);
    let scans = run_clean_units(&window, &state_arc, &spine_path, &target_version, units, true).await;

    let mut total_moved = 0usize;
    let units_out: Vec<FolderCleanResult> = scans
        .into_iter()
        .map(|(scan, moved)| {
            let (moved_count, backup_dir) = match moved {
                Some((count, dir)) => (count, Some(dir)),
                None => (0, None),
            };
            total_moved += moved_count;
            FolderCleanResult {
                folder: scan.folder,
                moved: moved_count,
                backup_dir,
                error: scan.error,
            }
        })
        .collect();

    let stopped = state.stop_requested.load(Ordering::SeqCst);
    Ok(BatchCleanResult {
        units: units_out,
        total_moved,
        stopped,
    })
}
