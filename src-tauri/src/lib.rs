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
        if state_arc.stop_requested.load(Ordering::SeqCst) {
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
            if app_state.stop_requested.load(Ordering::SeqCst) {
                return (index, FileOutcome::Skipped, None);
            }

            // Acquire permit — blocks if `parallel_jobs` tasks are already running.
            // The permit is held for the lifetime of the export call and released on drop.
            let _permit = sem.acquire().await;

            // Re-check stop flag after acquiring the permit (could have been set while waiting).
            if app_state.stop_requested.load(Ordering::SeqCst) {
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
            p.extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| {
                    let lower = ext.to_ascii_lowercase();
                    lower == "skel" || lower == "json" || lower == "atlas"
                })
                .unwrap_or(false)
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
    fn test_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "spineforge-test-{}-{}-{}",
            tag,
            std::process::id(),
            chrono::Local::now().format("%Y%m%d%H%M%S%6f")
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
}
