#![recursion_limit = "256"]

use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State, Window};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
    sync::Mutex,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchExportResult {
    completed: usize,
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
async fn detect_spine_version(spine_path: String) -> Result<String, String> {
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
    if parallel_jobs > 1 {
        let _ = window.emit(
            "spine-log",
            format!(
                "Parallel jobs hiện đang chạy tuần tự ở skeleton đầu tiên. Requested: {parallel_jobs}."
            ),
        );
    }

    let total = request.files.len();
    let mut completed = 0;
    let mut output_folders = Vec::new();
    let mut stopped = false;
    let run_folder_name = make_export_folder_name(&request.target_version);
    match request.output_policy {
        OutputPolicy::Timestamp => {
            let _ = window.emit("spine-log", format!("Timestamp export folder: {run_folder_name}"));
        }
        OutputPolicy::SourceFolderName => {
            let _ = window.emit("spine-log", "Output policy: source folder name");
        }
    }
    let shared_request = Arc::new(request);

    for (index, file) in shared_request.files.iter().enumerate() {
        if state.stop_requested.load(Ordering::SeqCst) {
            let _ = window.emit("spine-log", "Batch stopped by user.");
            stopped = true;
            break;
        }

        let payload = ProgressPayload {
            current: index + 1,
            total,
            file: file.clone(),
        };
        let _ = window.emit("spine-progress", payload);

        let output_dir = export_one_file(&window, &state, shared_request.as_ref(), file, &run_folder_name).await?;
        completed += 1;
        output_folders.push(output_dir);
    }

    output_folders.sort();
    output_folders.dedup();

    Ok(BatchExportResult {
        completed,
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

async fn export_one_file(
    window: &Window,
    state: &State<'_, Arc<AppState>>,
    request: &BatchExportRequest,
    file: &str,
    run_folder_name: &str,
) -> Result<String, String> {
    let input_file = PathBuf::from(file);
    let output_dir = resolve_output_dir(request, &input_file, run_folder_name)?;
    let export_plan = resolve_export_plan(request, &input_file, &output_dir)?;

    if !output_dir.trim().is_empty() {
        fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;
    }
    let _ = window.emit("spine-log", format!("Output: {output_dir}"));
    let _ = window.emit(
        "spine-log",
        format!(
            "Export action: {}",
            export_plan.arg.as_deref().unwrap_or("none")
        ),
    );

    let mut cmd = Command::new(&request.spine_path);
    cmd.arg(format!("-Xmx{}", request.max_memory))
        .arg("--update")
        .arg(&request.target_version)
        .arg("--input")
        .arg(file)
        .arg("--output")
        .arg(&output_dir);

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

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
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
        Ok(result) => result.map_err(|e| e.to_string())?,
        Err(_) => {
            let _ = child.kill().await;
            return Err(format!("Timeout khi export: {file}"));
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
        return Err(format!("Spine CLI failed for {file} with status {status}."));
    }

    if let Some(temp_file) = export_plan.temp_file {
        let _ = fs::remove_file(temp_file);
    }

    let _ = window.emit("spine-log", format!("Completed: {file}"));

    Ok(output_dir)
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
                .ok_or_else(|| "Không xác định được tên folder chứa file .spine.".to_string())?;
            let mut output_dir = PathBuf::from(output_root.trim_matches('"'));
            output_dir.push(source_folder_name);
            Ok(path_to_string(&output_dir))
        }
    }
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
        "packSource": request.generated_pack_source,
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

fn parse_spine_version(output: &str) -> Option<String> {
    for token in output.split(|ch: char| !(ch.is_ascii_alphanumeric() || ch == '.')) {
        let cleaned = token.trim_matches('.');
        if matches!(cleaned, "3.8.99" | "4.3.11") {
            return Some(cleaned.to_string());
        }
    }

    None
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
            start_batch_export,
            stop_batch_export
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
