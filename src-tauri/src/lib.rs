#![recursion_limit = "256"]

use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State, Window};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
    sync::{Mutex, Semaphore},
    task::JoinSet,
    time,
};
use walkdir::WalkDir;

#[derive(Default)]
struct AppState {
    stop_requested: AtomicBool,
    running_children: Mutex<Vec<u32>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
enum ExportMode {
    PerProjectJson,
    InternalExperimental,
    GlobalJson,
    BuiltIn,
    GeneratedSettings,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
enum FallbackMode {
    BuiltIn,
    GlobalJson,
    Skip,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
enum OutputPolicy {
    Timestamp,
    SourceFolderName,
    LinkedProject,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BatchExportRequest {
    spine_path: String,
    input_root: String,
    files: Vec<String>,
    output_path: String,
    output_policy: OutputPolicy,
    target_version: String,
    export_mode: ExportMode,
    fallback_mode: FallbackMode,
    global_json_path: Option<String>,
    built_in_export: String,
    generated_format: String,
    generated_skeleton_extension: String,
    generated_pack_atlas: bool,
    generated_max_width: i32,
    generated_max_height: i32,
    generated_premultiply_alpha: bool,
    generated_pot: bool,
    generated_padding_x: i32,
    generated_padding_y: i32,
    generated_pretty_print: bool,
    generated_nonessential: bool,
    generated_strip_whitespace_x: bool,
    generated_strip_whitespace_y: bool,
    generated_rotation: bool,
    generated_alias: bool,
    generated_ignore_blank_images: bool,
    generated_alpha_threshold: i32,
    generated_min_width: i32,
    generated_min_height: i32,
    generated_multiple_of_four: bool,
    generated_square: bool,
    generated_output_format: String,
    generated_jpeg_quality: f64,
    generated_bleed: bool,
    generated_bleed_iterations: i32,
    generated_edge_padding: bool,
    generated_duplicate_padding: bool,
    generated_filter_min: String,
    generated_filter_mag: String,
    generated_wrap_x: String,
    generated_wrap_y: String,
    generated_texture_format: String,
    generated_atlas_extension: String,
    generated_combine_subdirectories: bool,
    generated_flatten_paths: bool,
    generated_use_indexes: bool,
    generated_fast: bool,
    generated_limit_memory: bool,
    generated_packing: String,
    generated_pack_source: String,
    generated_pack_target: String,
    generated_warnings: bool,
    generated_force_all: bool,
    clean: bool,
    parallel_jobs: usize,
    max_memory: String,
    timeout_seconds: u64,
    preserve_relative_paths: bool,
    clean_folder_name: bool,
    #[serde(default)]
    unicode_workaround: bool,
    /// For the LinkedProject policy: the resolved destination type folder (e.g. "Heroes").
    /// Output routes to `output_path/<linked_dest_type>/<idFolder>`.
    #[serde(default)]
    linked_dest_type: String,
}

#[derive(Debug, Serialize)]
struct ScanResult {
    files: Vec<String>,
    skipped: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ValidateResult {
    ok: bool,
    warnings: Vec<String>,
    errors: Vec<String>,
    spine_ok: bool,
    spine_warning: bool,
    output_ok: bool,
    output_warning: bool,
}

#[derive(Debug, Serialize)]
struct CleanResult {
    deleted: Vec<String>,
    failed: Vec<String>,
}

/// Outcome of processing a single .spine file in a batch export.
#[derive(Debug)]
enum FileOutcome {
    /// CLI exited 0 and at least one output file was found.
    Completed,
    /// CLI failed (non-zero exit, timeout) or exited 0 but produced no output.
    Failed(String),
    /// File was skipped because FallbackMode::Skip was active and no .export.json was found.
    Skipped,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchExportResult {
    completed: usize,
    failed: usize,
    skipped: usize,
    total: usize,
    output_folders: Vec<String>,
    stopped: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportPreset {
    name: String,
    path: String,
    built_in: bool,
}

#[derive(Debug, Serialize, Clone)]
struct ProgressPayload {
    current: usize,
    total: usize,
    file: String,
}

struct ExportPlan {
    arg: Option<String>,
    temp_file: Option<PathBuf>,
}

#[tauri::command]
fn auto_detect_spine() -> Result<String, String> {
    spine_candidates()
        .into_iter()
        .find(|path| path.exists())
        .map(|path| path.to_string_lossy().to_string())
        .ok_or_else(|| "Không tìm thấy Spine executable trong các path phổ biến.".to_string())
}

#[tauri::command]
async fn detect_spine_version(window: Window, spine_path: String) -> Result<String, String> {
    let path = PathBuf::from(spine_path.trim_matches('"'));
    if !path.exists() {
        return Err("Spine executable không tồn tại.".to_string());
    }

    let mut cmd = Command::new(path);
    cmd.arg("--version").stdout(Stdio::piped()).stderr(Stdio::piped());
    apply_no_window(&mut cmd);
    let output = cmd.output().await.map_err(|e| e.to_string())?;

    let mut text = String::new();
    text.push_str(&String::from_utf8_lossy(&output.stdout));
    text.push_str(&String::from_utf8_lossy(&output.stderr));

    // Surface the raw output so the user can see exactly what Spine printed (e.g. the launcher
    // version vs the editor version) when diagnosing a wrong detection.
    for line in text.lines().filter(|l| !l.trim().is_empty()) {
        let _ = window.emit("spine-log", format!("[--version] {line}"));
    }

    parse_spine_version(&text).ok_or_else(|| {
        if text.trim().is_empty() {
            "Không đọc được version từ Spine CLI.".to_string()
        } else {
            format!("Không parse được version từ output: {}", text.trim())
        }
    })
}

#[tauri::command]
fn scan_spine_files(input_path: String) -> Result<ScanResult, String> {
    let path = PathBuf::from(input_path.trim_matches('"'));
    if !path.exists() {
        return Err("Input path không tồn tại.".to_string());
    }

    let mut files = Vec::new();
    let mut skipped = Vec::new();

    if path.is_file() {
        if is_spine_file(&path) && !is_temp_spine_file(&path) {
            files.push(path_to_string(&path));
        } else {
            skipped.push(path_to_string(&path));
        }
        return Ok(ScanResult { files, skipped });
    }

    for entry in WalkDir::new(&path).into_iter().filter_map(Result::ok) {
        let entry_path = entry.path();
        if !entry_path.is_file() {
            continue;
        }

        if is_spine_file(entry_path) {
            if is_temp_spine_file(entry_path) {
                skipped.push(path_to_string(entry_path));
            } else {
                files.push(path_to_string(entry_path));
            }
        }
    }

    files.sort();
    skipped.sort();

    Ok(ScanResult { files, skipped })
}

#[tauri::command]
fn validate_settings(
    spine_path: String,
    output_path: String,
    output_policy: String,
    export_mode: String,
    global_json_path: String,
) -> ValidateResult {
    let mut warnings = Vec::new();
    let mut errors = Vec::new();
    let mut spine_ok = false;
    let mut spine_warning = false;
    let mut output_ok = false;
    let mut output_warning = false;

    let spine = PathBuf::from(spine_path.trim_matches('"'));
    if spine_path.trim().is_empty() {
        errors.push("Chưa chọn Spine executable.".to_string());
    } else if !spine.exists() {
        errors.push("Spine executable không tồn tại.".to_string());
    } else {
        spine_ok = true;
        if cfg!(windows) {
            let file_name = spine
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            if file_name == "spine.exe" {
                spine_ok = false;
                spine_warning = true;
                warnings.push("Windows CLI nên dùng Spine.com thay vì Spine.exe.".to_string());
            }
        }
    }

    if !output_path.trim().is_empty() {
        let output = PathBuf::from(output_path.trim_matches('"'));
        if !output.exists() {
            output_warning = true;
            warnings.push("Output directory chưa tồn tại; app sẽ thử tạo khi chạy.".to_string());
        } else {
            output_ok = true;
        }
    } else if output_policy == "sourceFolderName" {
        errors.push("Policy folder theo tên source cần chọn output root.".to_string());
    } else if output_policy == "linkedProject" {
        // The frontend passes the resolved Unity root as output_path; empty means no
        // Linked Project / type has been selected yet.
        errors.push("Linked Project cần chọn Project và Type.".to_string());
    } else {
        output_warning = true;
    }

    if (export_mode == "globalJson" || export_mode == "perProjectJson")
        && !global_json_path.trim().is_empty()
    {
        let global = PathBuf::from(global_json_path.trim_matches('"'));
        if !global.exists() {
            errors.push("Global .export.json không tồn tại.".to_string());
        }
    }

    if export_mode == "internalExperimental" {
        errors.push("Use internal project settings đã bị tắt vì Spine CLI cần --export/-e để export.".to_string());
    }

    ValidateResult {
        ok: errors.is_empty(),
        warnings,
        errors,
        spine_ok,
        spine_warning,
        output_ok,
        output_warning,
    }
}

#[tauri::command]
fn clean_timestamp_exports(input_path: String) -> Result<CleanResult, String> {
    let root = PathBuf::from(input_path.trim_matches('"'));
    if !root.exists() {
        return Err("Input path không tồn tại.".to_string());
    }

    let scan_root = if root.is_file() {
        root.parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "Không xác định được folder input.".to_string())?
    } else {
        root
    };

    let mut deleted = Vec::new();
    let mut failed = Vec::new();

    for entry in WalkDir::new(&scan_root)
        .min_depth(1)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_dir())
    {
        let path = entry.path();
        let should_delete = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(is_timestamp_export_folder)
            .unwrap_or(false);

        if !should_delete {
            continue;
        }

        match fs::remove_dir_all(path) {
            Ok(_) => deleted.push(path_to_string(path)),
            Err(error) => failed.push(format!("{}: {}", path_to_string(path), error)),
        }
    }

    deleted.sort();
    failed.sort();

    Ok(CleanResult { deleted, failed })
}

#[tauri::command]
fn list_export_presets(app: AppHandle) -> Result<Vec<ExportPreset>, String> {
    let mut presets = Vec::new();

    for dir in built_in_preset_dirs(&app) {
        collect_presets_from_dir(&dir, true, &mut presets);
    }

    let user_dir = user_preset_dir(&app)?;
    fs::create_dir_all(&user_dir).map_err(|e| e.to_string())?;
    collect_presets_from_dir(&user_dir, false, &mut presets);

    presets.sort_by(|a, b| {
        b.built_in
            .cmp(&a.built_in)
            .then_with(|| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()))
    });
    presets.dedup_by(|a, b| a.built_in == b.built_in && a.name.eq_ignore_ascii_case(&b.name));

    Ok(presets)
}

#[tauri::command]
fn import_user_export_preset(app: AppHandle, source_path: String) -> Result<ExportPreset, String> {
    let source = PathBuf::from(source_path.trim_matches('"'));
    if !source.is_file() {
        return Err("Preset source không tồn tại.".to_string());
    }

    let name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Không đọc được tên preset.".to_string())?;
    let safe_name = validate_preset_file_name(name)?;
    let content = fs::read_to_string(&source).map_err(|e| e.to_string())?;
    validate_export_json_content(&content)?;

    let user_dir = user_preset_dir(&app)?;
    fs::create_dir_all(&user_dir).map_err(|e| e.to_string())?;
    let target = user_dir.join(&safe_name);
    fs::write(&target, content).map_err(|e| e.to_string())?;

    Ok(ExportPreset {
        name: safe_name,
        path: path_to_string(&target),
        built_in: false,
    })
}

#[tauri::command]
fn read_user_export_preset(app: AppHandle, name: String) -> Result<String, String> {
    let safe_name = validate_preset_file_name(&name)?;
    let path = user_preset_dir(&app)?.join(safe_name);
    fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Read any .export.json preset by absolute path (built-in resource or user), for the editor.
#[tauri::command]
fn read_export_preset(path: String) -> Result<String, String> {
    let target = PathBuf::from(path.trim_matches('"'));
    if !target
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.ends_with(".export.json"))
        .unwrap_or(false)
    {
        return Err("Chỉ đọc được file .export.json.".to_string());
    }
    fs::read_to_string(&target).map_err(|e| e.to_string())
}

/// Save (create or overwrite) a user preset from edited content, into the user preset dir.
#[tauri::command]
fn save_user_export_preset(app: AppHandle, name: String, content: String) -> Result<ExportPreset, String> {
    let safe_name = validate_preset_file_name(&name)?;
    validate_export_json_content(&content)?;
    let user_dir = user_preset_dir(&app)?;
    fs::create_dir_all(&user_dir).map_err(|e| e.to_string())?;
    let target = user_dir.join(&safe_name);
    fs::write(&target, content).map_err(|e| e.to_string())?;
    Ok(ExportPreset {
        name: safe_name,
        path: path_to_string(&target),
        built_in: false,
    })
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    let target = PathBuf::from(path.trim_matches('"'));
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&target, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_user_export_preset(app: AppHandle, name: String) -> Result<(), String> {
    let safe_name = validate_preset_file_name(&name)?;
    let path = user_preset_dir(&app)?.join(safe_name);
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn start_batch_export(
    window: Window,
    state: State<'_, Arc<AppState>>,
    request: BatchExportRequest,
) -> Result<BatchExportResult, String> {
    state.stop_requested.store(false, Ordering::SeqCst);

    if request.files.is_empty() {
        return Err("Không có file .spine để export.".to_string());
    }

    let parallel_jobs = request.parallel_jobs.clamp(1, 8);
    let _ = window.emit("spine-log", format!("Running {parallel_jobs} parallel jobs"));

    let total = request.files.len();
    let run_folder_name = make_export_folder_name(&request.target_version);
    match request.output_policy {
        OutputPolicy::Timestamp => {
            let _ = window.emit("spine-log", format!("Timestamp export folder: {run_folder_name}"));
        }
        OutputPolicy::SourceFolderName => {
            let _ = window.emit("spine-log", "Output policy: source folder name");
        }
        OutputPolicy::LinkedProject => {
            let _ = window.emit(
                "spine-log",
                format!("Output policy: linked project → {}", request.linked_dest_type),
            );
        }
    }

    let shared_request = Arc::new(request);
    let semaphore = Arc::new(Semaphore::new(parallel_jobs));
    let state_arc: Arc<AppState> = Arc::clone(&state);
    // Shared counter tracking how many files have been fully processed (any outcome).
    // Each task atomically increments this after export_one_file returns, so progress
    // events always arrive in completion order (1, 2, 3, …) rather than spawn order.
    let completed_count = Arc::new(AtomicUsize::new(0));

    // Spawn one task per file; each task acquires a semaphore permit before calling
    // export_one_file, so at most `parallel_jobs` exports run concurrently.
    let mut join_set: JoinSet<(usize, FileOutcome, Option<String>)> = JoinSet::new();

    for (index, file) in shared_request.files.iter().enumerate() {
        // Check stop flag BEFORE queuing so a Stop request drains the queue immediately.
        if !may_start_next(&state_arc.stop_requested) {
            let _ = window.emit("spine-log", "Batch stopped by user.");
            break;
        }

        let file = file.clone();
        let run_folder = run_folder_name.clone();
        let req = Arc::clone(&shared_request);
        let sem = Arc::clone(&semaphore);
        let app_state = Arc::clone(&state_arc);
        let win = window.clone();
        let counter = Arc::clone(&completed_count);

        join_set.spawn(async move {
            // Check stop flag once before blocking on the semaphore.
            if !may_start_next(&app_state.stop_requested) {
                return (index, FileOutcome::Skipped, None);
            }

            // Acquire permit — blocks if `parallel_jobs` tasks are already running.
            // The permit is held for the lifetime of the export call and released on drop.
            let _permit = sem.acquire().await;

            // Re-check stop flag after acquiring the permit (could have been set while waiting).
            if !may_start_next(&app_state.stop_requested) {
                return (index, FileOutcome::Skipped, None);
            }

            let output_dir_hint = {
                let input_path = std::path::PathBuf::from(file.as_str());
                resolve_output_dir(&req, &input_path, &run_folder).ok()
            };

            let outcome = export_one_file(win.clone(), app_state, req, &file, &run_folder).await;

            // Emit progress AFTER processing completes — ensures current reflects actual
            // completion order across parallel tasks, not spawn order.
            let current = counter.fetch_add(1, Ordering::SeqCst) + 1;
            let payload = ProgressPayload {
                current,
                total,
                file: file.clone(),
            };
            let _ = win.emit("spine-progress", payload);

            (index, outcome, output_dir_hint)
        });
    }

    let mut completed = 0usize;
    let mut failed = 0usize;
    let mut skipped = 0usize;
    let mut output_folders = Vec::new();
    let mut stopped = false;

    while let Some(result) = join_set.join_next().await {
        match result {
            Ok((_index, outcome, output_dir_hint)) => match outcome {
                FileOutcome::Completed => {
                    completed += 1;
                    if let Some(dir) = output_dir_hint {
                        output_folders.push(dir);
                    }
                }
                FileOutcome::Failed(reason) => {
                    failed += 1;
                    let _ = window.emit("spine-error", format!("Failed: {reason}"));
                }
                FileOutcome::Skipped => {
                    skipped += 1;
                }
            },
            Err(join_err) => {
                // Task panicked — treat as a failed file.
                failed += 1;
                let _ = window.emit("spine-error", format!("Task error: {join_err}"));
            }
        }
    }

    // If the stop flag was set, reflect that in the result.
    if state_arc.stop_requested.load(Ordering::SeqCst) {
        stopped = true;
    }

    output_folders.sort();
    output_folders.dedup();

    Ok(BatchExportResult {
        completed,
        failed,
        skipped,
        total,
        output_folders,
        stopped,
    })
}

#[tauri::command]
async fn stop_batch_export(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    state.stop_requested.store(true, Ordering::SeqCst);

    let child_ids = {
        let children = state.running_children.lock().await;
        children.clone()
    };

    for pid in child_ids {
        kill_process(pid).await;
    }

    Ok(())
}

/// True when `path` exists on disk. Used by the UI to warn (not block) when a
/// configured directory — e.g. a Linked Project's Unity root — is missing.
#[tauri::command]
fn path_exists(path: String) -> bool {
    let trimmed = path.trim().trim_matches('"');
    !trimmed.is_empty() && PathBuf::from(trimmed).exists()
}

#[tauri::command]
async fn open_path(path: String) -> Result<(), String> {
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
fn list_subdirectories(path: String) -> Result<Vec<String>, String> {
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

/// Scan `output_dir` for at least one file with a recognised Spine output
/// extension (`.skel`, `.json`, `.atlas`). Returns `true` when at least one
/// such file is found, `false` otherwise.
fn has_output_files(output_dir: &str) -> bool {
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

async fn export_one_file(
    window: Window,
    state: Arc<AppState>,
    request: Arc<BatchExportRequest>,
    file: &str,
    run_folder_name: &str,
) -> FileOutcome {
    let input_file = PathBuf::from(file);
    let output_dir = match resolve_output_dir(&request, &input_file, run_folder_name) {
        Ok(dir) => dir,
        Err(e) => return FileOutcome::Failed(e),
    };

    // Unicode workaround: when enabled and the input or output path contains non-ASCII
    // characters (SpineCLI can mis-handle these on some setups), run the export against an
    // ASCII temp copy of the project, then copy the result back. The guard removes the temp
    // dirs on any exit path.
    let use_workaround =
        request.unicode_workaround && (has_non_ascii(file) || has_non_ascii(&output_dir));
    let mut unicode_temps: Vec<PathBuf> = Vec::new();
    let (effective_input, effective_output) = if use_workaround {
        match copy_spine_to_temp(&input_file) {
            Ok((temp_input, temp_in_dir)) => {
                let temp_out_dir = unicode_temp_dir("out");
                unicode_temps.push(temp_in_dir);
                unicode_temps.push(temp_out_dir.clone());
                let _ = window.emit(
                    "spine-log",
                    format!("Unicode workaround: exporting via ASCII temp for {file}"),
                );
                (temp_input, path_to_string(&temp_out_dir))
            }
            Err(e) => return FileOutcome::Failed(format!("Unicode workaround copy failed: {e}")),
        }
    } else {
        (input_file.clone(), output_dir.clone())
    };
    let _temp_guard = TempDirGuard(unicode_temps);

    let export_plan = match resolve_export_plan(&request, &effective_input, &effective_output) {
        Ok(plan) => plan,
        Err(e) => {
            // FallbackMode::Skip produces an Err — treat it as Skipped, not Failed.
            if e.starts_with("Không tìm thấy .export.json cạnh") {
                let _ = window.emit("spine-log", format!("Skipped (no export.json): {file}"));
                return FileOutcome::Skipped;
            }
            return FileOutcome::Failed(e);
        }
    };

    if !effective_output.trim().is_empty() {
        if let Err(e) = fs::create_dir_all(&effective_output) {
            return FileOutcome::Failed(e.to_string());
        }
    }
    let _ = window.emit("spine-log", format!("Output: {output_dir}"));
    let _ = window.emit(
        "spine-log",
        format!(
            "Export action: {}",
            export_plan.arg.as_deref().unwrap_or("none")
        ),
    );

    let effective_input_str = path_to_string(&effective_input);
    let mut cmd = Command::new(&request.spine_path);
    cmd.arg(format!("-Xmx{}", request.max_memory))
        .arg("--update")
        .arg(&request.target_version)
        .arg("--input")
        .arg(&effective_input_str)
        .arg("--output")
        .arg(&effective_output);

    if request.clean {
        cmd.arg("--clean");
    }

    if let Some(export_arg) = &export_plan.arg {
        cmd.arg("--export").arg(export_arg);
    }

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    apply_no_window(&mut cmd);

    let command_line = format!("{cmd:?}");
    let _ = window.emit("spine-log", format!("Running: {command_line}"));

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return FileOutcome::Failed(e.to_string()),
    };
    if let Some(pid) = child.id() {
        state.running_children.lock().await.push(pid);
    }

    let stdout_task = child.stdout.take().map(|stdout| {
        let window = window.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = window.emit("spine-log", line);
            }
        })
    });

    let stderr_task = child.stderr.take().map(|stderr| {
        let window = window.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = window.emit("spine-error", line);
            }
        })
    });

    let timeout = Duration::from_secs(request.timeout_seconds.max(30));
    let status = match time::timeout(timeout, child.wait()).await {
        Ok(result) => match result {
            Ok(s) => s,
            Err(e) => {
                if let Some(temp_file) = export_plan.temp_file {
                    let _ = fs::remove_file(temp_file);
                }
                return FileOutcome::Failed(e.to_string());
            }
        },
        Err(_) => {
            let _ = child.kill().await;
            if let Some(temp_file) = export_plan.temp_file {
                let _ = fs::remove_file(temp_file);
            }
            return FileOutcome::Failed(format!("Timeout khi export: {file}"));
        }
    };

    if let Some(pid) = child.id() {
        state.running_children.lock().await.retain(|value| *value != pid);
    }

    if let Some(task) = stdout_task {
        let _ = task.await;
    }
    if let Some(task) = stderr_task {
        let _ = task.await;
    }

    if !status.success() {
        if let Some(temp_file) = export_plan.temp_file {
            let _ = fs::remove_file(temp_file);
        }
        return FileOutcome::Failed(format!("Spine CLI failed for {file} with status {status}."));
    }

    if let Some(temp_file) = export_plan.temp_file {
        let _ = fs::remove_file(temp_file);
    }

    // Requirement 8.1 / 8.2: CLI exited 0 — verify that at least one output file exists.
    if !has_output_files(&effective_output) {
        let warn = format!("CLI exit 0 nhưng không tìm thấy file output: {file}");
        let _ = window.emit("spine-log", format!("[WARNING] {warn}"));
        return FileOutcome::Failed(warn);
    }

    // Unicode workaround: bring the exported files back from the ASCII temp dir to the real output.
    if use_workaround {
        if let Err(e) = copy_dir_recursive(Path::new(&effective_output), Path::new(&output_dir)) {
            return FileOutcome::Failed(format!("Copy output back failed: {e}"));
        }
    }

    let _ = window.emit("spine-log", format!("Completed: {file}"));

    FileOutcome::Completed
}

fn resolve_output_dir(
    request: &BatchExportRequest,
    input_file: &Path,
    run_folder_name: &str,
) -> Result<String, String> {
    let parent = input_file
        .parent()
        .ok_or_else(|| "Không xác định được output directory.".to_string())?;

    let output_root = request.output_path.trim();

    match request.output_policy {
        OutputPolicy::Timestamp => {
            if output_root.is_empty() {
                return Ok(path_to_string(&parent.join(run_folder_name)));
            }

            let mut output_dir = PathBuf::from(output_root.trim_matches('"'));

            if request.preserve_relative_paths {
                let input_root = PathBuf::from(request.input_root.trim_matches('"'));
                let relative_base = if input_root.is_file() {
                    input_root
                        .parent()
                        .and_then(|root_parent| parent.strip_prefix(root_parent).ok())
                } else {
                    parent.strip_prefix(&input_root).ok()
                };

                if let Some(relative) = relative_base {
                    if !relative.as_os_str().is_empty() {
                        output_dir.push(relative);
                    }
                }
            }

            output_dir.push(run_folder_name);
            Ok(path_to_string(&output_dir))
        }
        OutputPolicy::SourceFolderName => {
            if output_root.is_empty() {
                return Err("Policy folder theo tên source cần output root.".to_string());
            }

            let source_folder_name = parent
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| "Không xác định được tên folder chứa file .spine.".to_string())?;
            let folder_name = if request.clean_folder_name {
                clean_source_folder_name(source_folder_name)
            } else {
                source_folder_name
            };
            let mut output_dir = PathBuf::from(output_root.trim_matches('"'));
            output_dir.push(folder_name);
            Ok(path_to_string(&output_dir))
        }
        OutputPolicy::LinkedProject => {
            if output_root.is_empty() {
                return Err("Linked Project cần Unity root (output path).".to_string());
            }
            if request.linked_dest_type.trim().is_empty() {
                return Err("Linked Project cần chọn Type đích.".to_string());
            }

            let source_folder_name = parent
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| "Không xác định được tên folder chứa file .spine.".to_string())?;
            // The id token is the part before the first underscore, e.g. "4001_Char" -> "4001".
            let id = clean_source_folder_name(source_folder_name);

            // base = unityRoot/<destType>
            let mut base = PathBuf::from(output_root.trim_matches('"'));
            base.push(request.linked_dest_type.trim());

            // Reuse an existing id folder if one is found, else create a new folder named after
            // the source folder (so "0001_Fighter" reuses "Heroes/0001_Fighter" instead of "Heroes/0001").
            let folder = find_existing_id_folder(&base, id).unwrap_or_else(|| source_folder_name.to_string());
            base.push(folder);
            Ok(path_to_string(&base))
        }
    }
}

/// Find an already-existing destination folder under `base` that belongs to `id`, in priority order:
/// 1. a folder whose name is exactly `id`, then
/// 2. a folder whose name starts with `{id}_` (e.g. id "0001" → "0001_Fighter").
/// Returns `None` when neither exists (caller then creates a new folder). Among multiple prefix
/// matches the first in sorted order is chosen for determinism.
fn find_existing_id_folder(base: &Path, id: &str) -> Option<String> {
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

/// Returns the resolved output directories that already exist and contain files,
/// so the UI can warn before overwriting them. Mainly relevant for the source-folder
/// policy (timestamp folders are unique per run and won't pre-exist).
#[tauri::command]
fn check_output_collisions(request: BatchExportRequest) -> Result<Vec<String>, String> {
    let run_folder_name = make_export_folder_name(&request.target_version);
    let mut dirs = std::collections::BTreeSet::new();
    for file in &request.files {
        let input_file = PathBuf::from(file);
        if let Ok(dir) = resolve_output_dir(&request, &input_file, &run_folder_name) {
            dirs.insert(dir);
        }
    }
    let existing = dirs
        .into_iter()
        .filter(|dir| {
            let path = Path::new(dir);
            path.is_dir()
                && fs::read_dir(path)
                    .map(|mut entries| entries.next().is_some())
                    .unwrap_or(false)
        })
        .collect();
    Ok(existing)
}

fn resolve_export_plan(
    request: &BatchExportRequest,
    input_file: &Path,
    output_dir: &str,
) -> Result<ExportPlan, String> {
    if matches!(request.export_mode, ExportMode::GeneratedSettings) {
        let temp_file = create_generated_export_settings(request, input_file, output_dir)?;
        return Ok(ExportPlan {
            arg: Some(path_to_string(&temp_file)),
            temp_file: Some(temp_file),
        });
    }

    let arg = resolve_export_arg(request, input_file)?;

    // Preset files (globalJson / per-project / built-in path) are passed straight to Spine.
    // Older presets may carry the invalid packSource value "folder", which Spine silently
    // ignores (falling back to attachments). Rewrite such files to a normalized temp copy so
    // the user's intent is honored without having to re-save the preset.
    if let Some(arg_value) = &arg {
        if let Some(plan) = normalize_preset_file(arg_value)? {
            return Ok(plan);
        }
    }

    Ok(ExportPlan {
        arg,
        temp_file: None,
    })
}

fn create_generated_export_settings(
    request: &BatchExportRequest,
    input_file: &Path,
    output_dir: &str,
) -> Result<PathBuf, String> {
    let format = if request.generated_format.eq_ignore_ascii_case("binary") {
        "Binary"
    } else {
        "JSON"
    };
    let extension = normalize_skeleton_extension(&request.generated_skeleton_extension, format);
    let class_name = if format == "Binary" {
        "export-binary"
    } else {
        "export-json"
    };

    let pack_atlas = if request.generated_pack_atlas {
        serde_json::json!({
            "stripWhitespaceX": request.generated_strip_whitespace_x,
            "stripWhitespaceY": request.generated_strip_whitespace_y,
            "rotation": request.generated_rotation,
            "alias": request.generated_alias,
            "ignoreBlankImages": request.generated_ignore_blank_images,
            "alphaThreshold": request.generated_alpha_threshold.clamp(0, 255),
            "minWidth": request.generated_min_width.max(1),
            "minHeight": request.generated_min_height.max(1),
            "maxWidth": request.generated_max_width.max(16),
            "maxHeight": request.generated_max_height.max(16),
            "pot": request.generated_pot,
            "multipleOfFour": request.generated_multiple_of_four,
            "square": request.generated_square,
            "outputFormat": request.generated_output_format,
            "jpegQuality": request.generated_jpeg_quality.clamp(0.0, 1.0),
            "premultiplyAlpha": request.generated_premultiply_alpha,
            "bleed": request.generated_bleed,
            "scale": [1],
            "scaleSuffix": [""],
            "scaleResampling": ["bicubic"],
            "paddingX": request.generated_padding_x.max(0),
            "paddingY": request.generated_padding_y.max(0),
            "edgePadding": request.generated_edge_padding,
            "duplicatePadding": request.generated_duplicate_padding,
            "filterMin": request.generated_filter_min,
            "filterMag": request.generated_filter_mag,
            "wrapX": request.generated_wrap_x,
            "wrapY": request.generated_wrap_y,
            "format": request.generated_texture_format,
            "atlasExtension": request.generated_atlas_extension,
            "combineSubdirectories": request.generated_combine_subdirectories,
            "flattenPaths": request.generated_flatten_paths,
            "useIndexes": request.generated_use_indexes,
            "debug": false,
            "fast": request.generated_fast,
            "limitMemory": request.generated_limit_memory,
            "currentProject": true,
            "packing": request.generated_packing,
            "prettyPrint": request.generated_pretty_print,
            "legacyOutput": false,
            "webp": null,
            "bleedIterations": request.generated_bleed_iterations.max(0),
            "ignore": false,
            "separator": "_",
            "silent": false
        })
    } else {
        serde_json::Value::Null
    };

    let settings = serde_json::json!({
        "class": class_name,
        "extension": extension,
        "format": format,
        "prettyPrint": request.generated_pretty_print,
        "nonessential": request.generated_nonessential,
        "cleanUp": request.clean,
        "packAtlas": pack_atlas,
        "packSource": normalize_pack_source(&request.generated_pack_source),
        "packTarget": request.generated_pack_target,
        "warnings": request.generated_warnings,
        "version": null,
        "output": output_dir,
        "forceAll": request.generated_force_all,
        "input": path_to_string(input_file),
        "open": false
    });

    let temp_file = std::env::temp_dir().join(format!(
        "spineforge-x-{}-{}.export.json",
        chrono::Local::now().format("%Y%m%d%H%M%S%3f"),
        std::process::id()
    ));
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&temp_file, json).map_err(|e| e.to_string())?;
    Ok(temp_file)
}

fn resolve_export_arg(request: &BatchExportRequest, input_file: &Path) -> Result<Option<String>, String> {
    match request.export_mode {
        ExportMode::InternalExperimental => Err(
            "Use internal project settings đã bị tắt vì Spine CLI cần --export/-e để export."
                .to_string(),
        ),
        ExportMode::GlobalJson => request
            .global_json_path
            .clone()
            .filter(|value| !value.trim().is_empty())
            .map(Some)
            .ok_or_else(|| "Force global settings cần global .export.json.".to_string()),
        ExportMode::BuiltIn => Ok(Some(request.built_in_export.clone())),
        ExportMode::GeneratedSettings => Ok(Some(request.built_in_export.clone())),
        ExportMode::PerProjectJson => {
            if let Some(per_project) = find_per_project_export_json(input_file) {
                return Ok(Some(path_to_string(&per_project)));
            }

            match request.fallback_mode {
                FallbackMode::BuiltIn => Ok(Some(request.built_in_export.clone())),
                FallbackMode::GlobalJson => request
                    .global_json_path
                    .clone()
                    .filter(|value| !value.trim().is_empty())
                    .map(Some)
                    .ok_or_else(|| "Fallback global JSON được chọn nhưng path trống.".to_string()),
                FallbackMode::Skip => Err(format!(
                    "Không tìm thấy .export.json cạnh {}",
                    path_to_string(input_file)
                )),
            }
        }
    }
}

fn find_per_project_export_json(input_file: &Path) -> Option<PathBuf> {
    let parent = input_file.parent()?;
    let mut candidates = fs::read_dir(parent)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.ends_with(".export.json"))
                    .unwrap_or(false)
        })
        .collect::<Vec<_>>();

    candidates.sort();
    candidates.into_iter().next()
}

fn make_export_folder_name(target_version: &str) -> String {
    let version = sanitize_folder_part(target_version);
    let now = chrono::Local::now();
    format!("export_{}_{}", version, now.format("%d%m%Y_%H%M%S"))
}

/// Shorten a source folder name to the token before the first underscore,
/// e.g. "3001_Lucius" -> "3001". Falls back to the full name when there is no
/// underscore or the leading token would be empty.
fn clean_source_folder_name(name: &str) -> &str {
    match name.split_once('_') {
        Some((head, _)) if !head.is_empty() => head,
        _ => name,
    }
}

fn sanitize_folder_part(value: &str) -> String {
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

/// Map our UI pack-source value to the string Spine actually recognises in
/// `.export.json`. Spine expects `attachments` or `imagefolders`; the legacy
/// value `folder` is silently ignored by Spine (it falls back to attachments),
/// so translate it to the correct enum.
fn normalize_pack_source(value: &str) -> &str {
    match value.trim() {
        "folder" => "imagefolders",
        other => other,
    }
}

/// If `arg` points to an `.export.json` file whose `packSource` is the legacy/invalid value
/// "folder", write a corrected copy ("imagefolders") to a temp file and return a plan pointing
/// at it. Returns `Ok(None)` when the file needs no rewrite (or isn't a readable JSON preset),
/// so the caller falls back to using the original path unchanged.
fn normalize_preset_file(arg: &str) -> Result<Option<ExportPlan>, String> {
    let path = Path::new(arg);
    let is_export_json = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.ends_with(".export.json"))
        .unwrap_or(false);
    if !is_export_json || !path.is_file() {
        return Ok(None);
    }

    let Ok(content) = fs::read_to_string(path) else {
        return Ok(None);
    };
    let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&content) else {
        return Ok(None);
    };

    let needs_fix = value
        .get("packSource")
        .and_then(|source| source.as_str())
        .map(|source| source.trim() == "folder")
        .unwrap_or(false);
    if !needs_fix {
        return Ok(None);
    }

    value["packSource"] = serde_json::Value::String("imagefolders".to_string());
    let temp_file = std::env::temp_dir().join(format!(
        "spineforge-x-{}-{}.export.json",
        chrono::Local::now().format("%Y%m%d%H%M%S%3f"),
        std::process::id()
    ));
    let json = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    fs::write(&temp_file, json).map_err(|e| e.to_string())?;

    Ok(Some(ExportPlan {
        arg: Some(path_to_string(&temp_file)),
        temp_file: Some(temp_file),
    }))
}

fn normalize_skeleton_extension(value: &str, format: &str) -> String {
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

fn is_timestamp_export_folder(name: &str) -> bool {
    let parts = name.split('_').collect::<Vec<_>>();
    parts.len() == 4
        && parts[0] == "export"
        && !parts[1].is_empty()
        && parts[2].len() == 8
        && parts[2].chars().all(|ch| ch.is_ascii_digit())
        && parts[3].len() == 6
        && parts[3].chars().all(|ch| ch.is_ascii_digit())
}

fn spine_candidates() -> Vec<PathBuf> {
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

fn is_spine_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("spine"))
        .unwrap_or(false)
}

fn is_temp_spine_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.starts_with(".~") || name.starts_with('~'))
        .unwrap_or(false)
}

/// Stop-gate used by the batch export loop: returns true when no Stop has been
/// requested and the next file may start. Centralised here so the invariant
/// "a Stop request prevents any new file from starting" stays unit-testable.
fn may_start_next(stop_requested: &AtomicBool) -> bool {
    !stop_requested.load(Ordering::SeqCst)
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

/// True when `s` contains any non-ASCII character (e.g. Vietnamese/Chinese path segments).
fn has_non_ascii(s: &str) -> bool {
    !s.is_ascii()
}

/// Build a unique ASCII temp directory path under the system temp dir.
fn unicode_temp_dir(suffix: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "spineforge-uni-{}-{}-{}",
        std::process::id(),
        chrono::Local::now().format("%Y%m%d%H%M%S%3f"),
        suffix
    ))
}

/// Copy a `.spine` file and every sibling file (images / atlas sources / `.export.json` live next
/// to it) into a fresh ASCII temp directory. Returns `(temp_input_file, temp_input_dir)`; the
/// caller is responsible for removing `temp_input_dir`. The file name is preserved (only the
/// containing directory is made ASCII — the common failing case is a non-ASCII folder path).
fn copy_spine_to_temp(input_file: &Path) -> Result<(PathBuf, PathBuf), String> {
    let parent = input_file
        .parent()
        .ok_or_else(|| "Không xác định được folder nguồn.".to_string())?;
    let file_name = input_file
        .file_name()
        .ok_or_else(|| "Không xác định được tên file .spine.".to_string())?;

    let temp_dir = unicode_temp_dir("in");
    let _ = fs::remove_dir_all(&temp_dir);
    fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    for entry in fs::read_dir(parent).map_err(|e| e.to_string())?.filter_map(Result::ok) {
        let path = entry.path();
        if path.is_file() {
            if let Some(name) = path.file_name() {
                fs::copy(&path, temp_dir.join(name)).map_err(|e| e.to_string())?;
            }
        }
    }

    Ok((temp_dir.join(file_name), temp_dir))
}

/// Recursively copy every file/subdir from `src` into `dst` (creating `dst` as needed).
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in WalkDir::new(src).min_depth(1).into_iter().filter_map(Result::ok) {
        let rel = entry
            .path()
            .strip_prefix(src)
            .map_err(|e| e.to_string())?;
        let target = dst.join(rel);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        } else if entry.file_type().is_file() {
            if let Some(p) = target.parent() {
                fs::create_dir_all(p).map_err(|e| e.to_string())?;
            }
            fs::copy(entry.path(), &target).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Removes the held temp directories when dropped, so the Unicode workaround cleans up on any
/// exit path (success, failure, or timeout).
struct TempDirGuard(Vec<PathBuf>);

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        for dir in &self.0 {
            let _ = fs::remove_dir_all(dir);
        }
    }
}

fn built_in_preset_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        dirs.push(resource_dir.join("export-presets"));
    }

    dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("export-presets"));
    dirs
}

fn user_preset_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("export-presets"))
        .map_err(|e| e.to_string())
}

fn collect_presets_from_dir(dir: &Path, built_in: bool, presets: &mut Vec<ExportPreset>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };

        if path.is_file() && name.ends_with(".export.json") {
            presets.push(ExportPreset {
                name: name.to_string(),
                path: path_to_string(&path),
                built_in,
            });
        }
    }
}

fn validate_preset_file_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if !trimmed.ends_with(".export.json") {
        return Err("Preset phải có đuôi .export.json.".to_string());
    }

    if trimmed.is_empty()
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains(':')
        || trimmed == ".export.json"
    {
        return Err("Tên preset không hợp lệ.".to_string());
    }

    Ok(trimmed.to_string())
}

fn validate_export_json_content(content: &str) -> Result<(), String> {
    let value: serde_json::Value = serde_json::from_str(content)
        .map_err(|e| format!("Preset không phải JSON hợp lệ: {e}"))?;
    let class = value
        .get("class")
        .and_then(|value| value.as_str())
        .unwrap_or_default();

    if !class.starts_with("export-") {
        return Err("Preset không giống Spine export settings JSON: thiếu class export-*.".to_string());
    }

    Ok(())
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
fn parse_spine_version(output: &str) -> Option<String> {
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
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Suppress the console window that Windows pops up when spawning console executables
/// (e.g. Spine.com). No-op on other platforms.
fn apply_no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

async fn kill_process(pid: u32) {
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

pub fn run() {
    let state = Arc::new(AppState::default());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(state)
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("spine-log", "SpineForge X ready.");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            auto_detect_spine,
            detect_spine_version,
            scan_spine_files,
            validate_settings,
            check_output_collisions,
            list_export_presets,
            import_user_export_preset,
            read_user_export_preset,
            read_export_preset,
            save_user_export_preset,
            delete_user_export_preset,
            write_text_file,
            clean_timestamp_exports,
            open_path,
            path_exists,
            list_subdirectories,
            start_batch_export,
            stop_batch_export
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Create a unique empty temp directory for a test and return its path.
    /// A process-wide sequence counter guarantees uniqueness even when called
    /// many times within the same microsecond (e.g. inside a proptest loop).
    fn test_dir(tag: &str) -> PathBuf {
        static SEQ: AtomicUsize = AtomicUsize::new(0);
        let seq = SEQ.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "spineforge-test-{}-{}-{}-{}",
            tag,
            std::process::id(),
            chrono::Local::now().format("%Y%m%d%H%M%S%6f"),
            seq
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn has_non_ascii_detects_unicode() {
        assert!(!has_non_ascii("D:/Projects/Spine/Enemy/4001"));
        assert!(has_non_ascii("D:/Dự án/Nhân vật"));
        assert!(has_non_ascii("D:/项目/角色"));
        assert!(!has_non_ascii(""));
    }

    #[test]
    fn clean_source_folder_name_takes_id_token() {
        assert_eq!(clean_source_folder_name("3001_Lucius"), "3001");
        assert_eq!(clean_source_folder_name("0001_Fighter"), "0001");
        // No underscore, or empty leading token → keep the whole name.
        assert_eq!(clean_source_folder_name("4001"), "4001");
        assert_eq!(clean_source_folder_name("_Lucius"), "_Lucius");
    }

    #[test]
    fn find_existing_id_folder_priority_exact_then_prefix_then_none() {
        let base = test_dir("find-id");
        fs::create_dir_all(base.join("0001_Fighter")).unwrap();
        fs::create_dir_all(base.join("0002")).unwrap();
        fs::create_dir_all(base.join("0003_A")).unwrap();
        fs::create_dir_all(base.join("00030_B")).unwrap(); // must NOT match id "0003" prefix

        // Exact match wins.
        assert_eq!(find_existing_id_folder(&base, "0002").as_deref(), Some("0002"));
        // Prefix `{id}_` match when no exact folder exists.
        assert_eq!(find_existing_id_folder(&base, "0001").as_deref(), Some("0001_Fighter"));
        assert_eq!(find_existing_id_folder(&base, "0003").as_deref(), Some("0003_A"));
        // No match → None (so caller creates a fresh folder).
        assert_eq!(find_existing_id_folder(&base, "9999"), None);
        // Empty id never matches.
        assert_eq!(find_existing_id_folder(&base, ""), None);

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn find_existing_id_folder_none_when_base_missing() {
        let missing = std::env::temp_dir().join("spineforge-test-missing-xyz-does-not-exist");
        let _ = fs::remove_dir_all(&missing);
        assert_eq!(find_existing_id_folder(&missing, "0001"), None);
    }

    #[test]
    fn parse_spine_version_prefers_editor_over_launcher() {
        let output = "Spine Launcher 4.3.05\n\
            Esoteric Software LLC (C) 2013-2026 | http://esotericsoftware.com\n\
            Windows 10 Pro amd64 10.0\n\
            Starting: Spine 4.3.17 Professional\n\
            Spine 4.3.17 Professional\n\
            Complete.";
        assert_eq!(parse_spine_version(output).as_deref(), Some("4.3.17"));
    }

    #[test]
    fn parse_spine_version_handles_single_line_and_windows_build() {
        // A lone editor line.
        assert_eq!(parse_spine_version("Spine 3.8.99 Professional").as_deref(), Some("3.8.99"));
        // The Windows build token (10.0.19045) must not win over the editor line.
        let output = "Spine Launcher 4.3.05\n\
            Windows 10 Pro amd64 10.0.19045\n\
            Spine 4.3.17 Professional";
        assert_eq!(parse_spine_version(output).as_deref(), Some("4.3.17"));
    }

    #[test]
    fn copy_dir_recursive_copies_nested_files() {
        let src = test_dir("copy-src");
        let dst = test_dir("copy-dst");
        fs::create_dir_all(src.join("sub")).unwrap();
        fs::write(src.join("a.atlas"), b"atlas").unwrap();
        fs::write(src.join("sub/b.png"), b"png").unwrap();

        copy_dir_recursive(&src, &dst).unwrap();
        assert!(dst.join("a.atlas").is_file());
        assert!(dst.join("sub/b.png").is_file());

        let _ = fs::remove_dir_all(&src);
        let _ = fs::remove_dir_all(&dst);
    }

    #[test]
    fn has_output_files_recognizes_unity_double_extensions() {
        let dir = test_dir("has-output-unity");
        // Unity Spine runtime convention: skeleton .skel.bytes + atlas .atlas.txt.
        fs::write(dir.join("3004_Gale.skel.bytes"), b"skel").unwrap();
        fs::write(dir.join("3004_Gale.atlas.txt"), b"atlas").unwrap();
        fs::write(dir.join("3004_Gale.png"), b"png").unwrap();
        assert!(has_output_files(&path_to_string(&dir)));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn has_output_files_recognizes_plain_extensions() {
        let dir = test_dir("has-output-plain");
        fs::write(dir.join("hero.json"), b"{}").unwrap();
        fs::write(dir.join("hero.atlas"), b"atlas").unwrap();
        assert!(has_output_files(&path_to_string(&dir)));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn has_output_files_false_when_only_meta_or_textures() {
        let dir = test_dir("has-output-meta");
        // Only Unity .meta sidecars and textures — no real skeleton/atlas output.
        fs::write(dir.join("3004_Gale.skel.bytes.meta"), b"meta").unwrap();
        fs::write(dir.join("3004_Gale.atlas.txt.meta"), b"meta").unwrap();
        fs::write(dir.join("3004_Gale.png"), b"png").unwrap();
        assert!(!has_output_files(&path_to_string(&dir)));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn has_output_files_false_when_dir_missing() {
        let missing = std::env::temp_dir().join("spineforge-test-output-missing-xyz");
        let _ = fs::remove_dir_all(&missing);
        assert!(!has_output_files(&path_to_string(&missing)));
    }

    // ---- Property tests (proptest) ----------------------------------------
    //
    // These lock the pure invariants added across v0.2.5–v0.2.6 (validation,
    // output routing, preset name rules, version parsing) so future refactors
    // can't silently break them. FS-touching branches are exercised with the
    // `test_dir()` helper above; the rest are pure string/number logic.

    use proptest::prelude::*;

    /// Build a neutral `BatchExportRequest` with every field defaulted. Tests
    /// override only the handful of fields relevant to the behaviour under test.
    fn base_request() -> BatchExportRequest {
        BatchExportRequest {
            spine_path: String::new(),
            input_root: String::new(),
            files: Vec::new(),
            output_path: String::new(),
            output_policy: OutputPolicy::SourceFolderName,
            target_version: String::new(),
            export_mode: ExportMode::GlobalJson,
            fallback_mode: FallbackMode::GlobalJson,
            global_json_path: None,
            built_in_export: String::new(),
            generated_format: String::new(),
            generated_skeleton_extension: String::new(),
            generated_pack_atlas: false,
            generated_max_width: 0,
            generated_max_height: 0,
            generated_premultiply_alpha: false,
            generated_pot: false,
            generated_padding_x: 0,
            generated_padding_y: 0,
            generated_pretty_print: false,
            generated_nonessential: false,
            generated_strip_whitespace_x: false,
            generated_strip_whitespace_y: false,
            generated_rotation: false,
            generated_alias: false,
            generated_ignore_blank_images: false,
            generated_alpha_threshold: 0,
            generated_min_width: 0,
            generated_min_height: 0,
            generated_multiple_of_four: false,
            generated_square: false,
            generated_output_format: String::new(),
            generated_jpeg_quality: 0.0,
            generated_bleed: false,
            generated_bleed_iterations: 0,
            generated_edge_padding: false,
            generated_duplicate_padding: false,
            generated_filter_min: String::new(),
            generated_filter_mag: String::new(),
            generated_wrap_x: String::new(),
            generated_wrap_y: String::new(),
            generated_texture_format: String::new(),
            generated_atlas_extension: String::new(),
            generated_combine_subdirectories: false,
            generated_flatten_paths: false,
            generated_use_indexes: false,
            generated_fast: false,
            generated_limit_memory: false,
            generated_packing: String::new(),
            generated_pack_source: String::new(),
            generated_pack_target: String::new(),
            generated_warnings: false,
            generated_force_all: false,
            clean: false,
            parallel_jobs: 1,
            max_memory: String::new(),
            timeout_seconds: 0,
            preserve_relative_paths: false,
            clean_folder_name: false,
            unicode_workaround: false,
            linked_dest_type: String::new(),
        }
    }

    /// Build a `BatchExportRequest` for LinkedProject routing tests.
    fn linked_request(output_path: &str, linked_dest_type: &str) -> BatchExportRequest {
        BatchExportRequest {
            output_path: output_path.to_string(),
            output_policy: OutputPolicy::LinkedProject,
            linked_dest_type: linked_dest_type.to_string(),
            ..base_request()
        }
    }

    proptest! {
        /// Property 5: validate_settings always reports an error (ok == false)
        /// when the Spine path is empty — regardless of the other inputs.
        #[test]
        fn prop_validate_settings_rejects_empty_spine_path(
            output_policy in prop::sample::select(vec!["timestamp", "sourceFolderName", "linkedProject"]),
            export_mode in prop::sample::select(vec!["globalJson", "perProjectJson", "builtIn"]),
        ) {
            let result = validate_settings(
                String::new(),
                String::new(),
                output_policy.to_string(),
                export_mode.to_string(),
                String::new(),
            );
            prop_assert!(!result.ok);
            prop_assert!(!result.errors.is_empty());
            prop_assert!(!result.spine_ok);
        }

        /// Property 6: ExportMode "internalExperimental" is always rejected,
        /// even if every other field is otherwise valid-looking.
        #[test]
        fn prop_validate_settings_rejects_internal_experimental(
            spine_path in "[a-zA-Z0-9/]{0,20}",
            output_path in "[a-zA-Z0-9/]{0,20}",
        ) {
            let result = validate_settings(
                spine_path,
                output_path,
                "sourceFolderName".to_string(),
                "internalExperimental".to_string(),
                String::new(),
            );
            prop_assert!(!result.ok);
        }

        /// Property 9: parallel_jobs is always clamped into [1, 8].
        #[test]
        fn prop_parallel_jobs_clamped(jobs in 0usize..1000) {
            let clamped = jobs.clamp(1, 8);
            prop_assert!((1..=8).contains(&clamped));
            // Idempotent: values already in range are unchanged.
            if (1..=8).contains(&jobs) {
                prop_assert_eq!(clamped, jobs);
            }
        }

        /// Property 10: validate_preset_file_name accepts a clean *.export.json
        /// name and rejects anything with a path separator, colon, or the bare
        /// ".export.json".
        // The leading char is constrained to a non-space so the trimmed stem is
        // never empty — a whitespace-only stem would collapse to the bare
        // ".export.json", which the validator legitimately rejects.
        #[test]
        fn prop_validate_preset_file_name(stem in "[a-zA-Z0-9_-][a-zA-Z0-9 _-]{0,29}") {
            let valid = format!("{stem}.export.json");
            prop_assert_eq!(validate_preset_file_name(&valid).unwrap(), valid.trim().to_string());

            // Path separators / colon must be rejected.
            for bad in [
                format!("a/{stem}.export.json"),
                format!("a\\{stem}.export.json"),
                format!("C:{stem}.export.json"),
            ] {
                prop_assert!(validate_preset_file_name(&bad).is_err());
            }

            // Wrong / missing extension is rejected.
            prop_assert!(validate_preset_file_name(&stem).is_err());
            prop_assert!(validate_preset_file_name(".export.json").is_err());
        }

        /// Property 13: normalize_pack_source maps the legacy "folder" value to
        /// "imagefolders" and leaves every other value (after trimming) intact.
        #[test]
        fn prop_normalize_pack_source(value in "[a-zA-Z]{0,15}") {
            let normalized = normalize_pack_source(&value);
            if value.trim() == "folder" {
                prop_assert_eq!(normalized, "imagefolders");
            } else {
                prop_assert_eq!(normalized, value.trim());
            }
        }

        /// Property: parse_spine_version returns Some iff the output contains a
        /// d.d.d token, and never picks the "Launcher" line when an editor line
        /// with a version is present.
        #[test]
        fn prop_parse_spine_version_prefers_editor(
            launcher in "[0-9]{1,2}\\.[0-9]{1,2}\\.[0-9]{1,2}",
            editor in "[0-9]{1,2}\\.[0-9]{1,2}\\.[0-9]{1,2}",
        ) {
            let output = format!("Spine Launcher {launcher}\nSpine {editor} Professional");
            let parsed = parse_spine_version(&output);
            prop_assert_eq!(parsed.as_deref(), Some(editor.as_str()));
        }

        /// Property 7: the timestamp export folder name always has the shape
        /// `export_{sanitized-version}_{ddmmyyyy_hhmmss}` — a sanitized version
        /// token (no underscores, since `_` is not allowed) followed by an
        /// 8-digit date, `_`, and a 6-digit time. (tasks.md 6.1)
        #[test]
        fn prop_export_folder_name_matches_pattern(version in ".{0,40}") {
            let name = make_export_folder_name(&version);
            let rest = name.strip_prefix("export_").expect("must start with export_");

            // The last 15 chars are the chrono timestamp `ddmmyyyy_hhmmss`.
            prop_assert!(rest.len() >= 16, "name too short: {}", name);
            let split = rest.len() - 15;
            // The char just before the timestamp is the separating underscore.
            prop_assert_eq!(&rest[split - 1..split], "_");
            let stamp = &rest[split..];
            let digits: Vec<char> = stamp.chars().collect();
            for (i, ch) in digits.iter().enumerate() {
                if i == 8 {
                    prop_assert_eq!(*ch, '_');
                } else {
                    prop_assert!(ch.is_ascii_digit(), "non-digit in timestamp: {}", stamp);
                }
            }

            // The middle token is exactly the sanitized version (never empty).
            let version_token = &rest[..split - 1];
            prop_assert_eq!(version_token, sanitize_folder_part(&version));
            prop_assert!(!version_token.is_empty());
            prop_assert!(!version_token.contains('_'));
        }

        /// Property 11: once a Stop is requested, no further file may start.
        /// Models the batch loop's stop-gate (`may_start_next`) over the real
        /// AtomicBool: setting the flag at index `stop_at` means exactly
        /// `min(stop_at, total)` files start. (tasks.md 2.3)
        #[test]
        fn prop_stop_gate_blocks_new_files(total in 1usize..30, stop_at in 0usize..30) {
            let stop = AtomicBool::new(false);
            let mut started = 0usize;
            for i in 0..total {
                if i == stop_at {
                    stop.store(true, Ordering::SeqCst);
                }
                if may_start_next(&stop) {
                    started += 1;
                }
            }
            prop_assert_eq!(started, stop_at.min(total));
        }
    }

    /// Property 17 (example-based, FS-backed): resolve_output_dir for the
    /// LinkedProject policy never produces a duplicate folder — it reuses an
    /// existing id folder and only falls back to the source name when none exists.
    #[test]
    fn resolve_output_dir_linked_project_reuses_then_creates() {
        let unity_root = test_dir("linked-out");
        // Existing destination: Heroes/0001_Fighter
        fs::create_dir_all(unity_root.join("Heroes/0001_Fighter")).unwrap();

        let req = linked_request(unity_root.to_str().unwrap(), "Heroes");

        // Input id "0001" should reuse the existing prefixed folder, not create "0001".
        let input = unity_root.join("src/0001_Fighter/skel.spine");
        let resolved = resolve_output_dir(&req, &input, "run").unwrap();
        assert_eq!(
            PathBuf::from(&resolved),
            unity_root.join("Heroes/0001_Fighter")
        );

        // Unknown id "9999" → fall back to the source folder name (fresh folder).
        let input2 = unity_root.join("src/9999_New/skel.spine");
        let resolved2 = resolve_output_dir(&req, &input2, "run").unwrap();
        assert_eq!(PathBuf::from(&resolved2), unity_root.join("Heroes/9999_New"));

        // Missing dest type → error, never an empty/duplicate path.
        let bad = linked_request(unity_root.to_str().unwrap(), "");
        assert!(resolve_output_dir(&bad, &input, "run").is_err());

        let _ = fs::remove_dir_all(&unity_root);
    }

    /// Property 12 (FS-backed, example-based): when no `.export.json` sits next
    /// to the input file, PerProjectJson falls back per `FallbackMode`:
    /// BuiltIn → the built-in preset, GlobalJson → the global path (error when
    /// empty), Skip → always an error. (tasks.md 6.2)
    #[test]
    fn fallback_mode_when_no_export_json() {
        let dir = test_dir("fallback"); // empty dir → find_per_project_export_json returns None
        let input = dir.join("hero.spine");

        // BuiltIn → uses the built-in preset string.
        let built_in = BatchExportRequest {
            export_mode: ExportMode::PerProjectJson,
            fallback_mode: FallbackMode::BuiltIn,
            built_in_export: "binary+pack".to_string(),
            ..base_request()
        };
        assert_eq!(
            resolve_export_arg(&built_in, &input).unwrap().as_deref(),
            Some("binary+pack")
        );

        // GlobalJson with a non-empty path → uses that path.
        let global_ok = BatchExportRequest {
            export_mode: ExportMode::PerProjectJson,
            fallback_mode: FallbackMode::GlobalJson,
            global_json_path: Some("D:/presets/global.export.json".to_string()),
            ..base_request()
        };
        assert_eq!(
            resolve_export_arg(&global_ok, &input).unwrap().as_deref(),
            Some("D:/presets/global.export.json")
        );

        // GlobalJson with an empty/blank path → error.
        let global_empty = BatchExportRequest {
            export_mode: ExportMode::PerProjectJson,
            fallback_mode: FallbackMode::GlobalJson,
            global_json_path: Some("   ".to_string()),
            ..base_request()
        };
        assert!(resolve_export_arg(&global_empty, &input).is_err());

        // Skip → always an error (file is skipped, not exported).
        let skip = BatchExportRequest {
            export_mode: ExportMode::PerProjectJson,
            fallback_mode: FallbackMode::Skip,
            built_in_export: "binary+pack".to_string(),
            ..base_request()
        };
        assert!(resolve_export_arg(&skip, &input).is_err());

        let _ = fs::remove_dir_all(&dir);
    }

    // FS-backed property tests run fewer cases — each one builds a real temp
    // directory tree, so the default 256 cases would be needlessly slow.
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(32))]

        /// Property 1: scan_spine_files returns only valid `.spine` files (not
        /// temp `~`/`.~` ones) in `files`, routes temp `.spine` to `skipped`,
        /// and ignores non-spine files entirely. (tasks.md 1.2)
        #[test]
        fn prop_scan_spine_files_filters_temp_and_non_spine(kinds in prop::collection::vec(0u8..4, 0..12)) {
            let dir = test_dir("scan-spine");
            let mut expected_files = Vec::new();
            let mut expected_skipped = Vec::new();

            for (i, kind) in kinds.iter().enumerate() {
                let (name, bucket): (String, Option<&mut Vec<String>>) = match kind {
                    0 => (format!("f{i}.spine"), Some(&mut expected_files)),       // valid
                    1 => (format!("~f{i}.spine"), Some(&mut expected_skipped)),    // temp (~)
                    2 => (format!(".~f{i}.spine"), Some(&mut expected_skipped)),   // temp (.~)
                    _ => (format!("f{i}.txt"), None),                              // non-spine → ignored
                };
                let path = dir.join(&name);
                fs::write(&path, b"x").unwrap();
                if let Some(bucket) = bucket {
                    bucket.push(path_to_string(&path));
                }
            }
            expected_files.sort();
            expected_skipped.sort();

            let result = scan_spine_files(path_to_string(&dir)).unwrap();
            prop_assert_eq!(result.files, expected_files);
            prop_assert_eq!(result.skipped, expected_skipped);

            let _ = fs::remove_dir_all(&dir);
        }
    }
}
