#![recursion_limit = "256"]

mod clean;
mod cleaner;
mod concurrent;
mod drive;
mod error;
mod export;
mod library;
mod model;
mod paths;
mod presets;
mod skel_binary;
mod spine_project;
mod system;
mod tray;
mod util;

#[cfg(test)]
mod tests;

use std::{
    fs,
    path::Path,
    process::Stdio,
    sync::{atomic::Ordering, Arc},
};
use tauri::{Emitter, Manager, State, Window};
use tokio::process::Command;
use walkdir::WalkDir;

use error::ResultExt;
// Re-export so sibling modules and the test module can resolve these by
// `crate::<name>` (and the slim commands below by bare name) after the v0.3.3
// split of lib.rs into model / util / export / clean.
pub(crate) use paths::{normalize_pack_source, parse_quoted_path, path_to_string};
pub(crate) use export::*;
pub(crate) use model::*;
pub(crate) use util::*;

/// Decode the last-export settings stored in a `.spine` project file, for
/// previewing what the `lastExportSettings` export mode would apply.
#[tauri::command]
fn read_spine_export_settings(path: String) -> Result<spine_project::DecodedSettings, String> {
    spine_project::read_export_settings(Path::new(&path))
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
    let path = parse_quoted_path(&spine_path);
    if !path.exists() {
        return Err("Spine executable không tồn tại.".to_string());
    }

    let mut cmd = Command::new(path);
    cmd.arg("--version").stdout(Stdio::piped()).stderr(Stdio::piped());
    apply_no_window(&mut cmd);
    let output = cmd.output().await.str_err()?;

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
    let path = parse_quoted_path(&input_path);
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

    let spine = parse_quoted_path(&spine_path);
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
        let output = parse_quoted_path(&output_path);
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

    if (export_mode == "globalJson"
        || export_mode == "perProjectJson"
        || export_mode == "lastExportSettings")
        && !global_json_path.trim().is_empty()
    {
        let global = parse_quoted_path(&global_json_path);
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
    let root = parse_quoted_path(&input_path);
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
    let state_arc: Arc<AppState> = Arc::clone(&state);

    // One task per file, capped at `parallel_jobs` concurrent exports (see
    // concurrent::run_indexed). Each task re-checks the stop flag — it could have
    // been set while it waited for a permit — and reports completion order via
    // `done.tick()` so progress events arrive 1, 2, 3, … rather than in spawn order.
    let results = concurrent::run_indexed(
        shared_request.files.clone(),
        parallel_jobs,
        &state_arc.stop_requested,
        |_index, file, done| {
            let req = Arc::clone(&shared_request);
            let app_state = Arc::clone(&state_arc);
            let win = window.clone();
            let run_folder = run_folder_name.clone();
            async move {
                if !may_start_next(&app_state.stop_requested) {
                    return (FileOutcome::Skipped, None);
                }

                // This job now holds a permit and is actively exporting — let the
                // UI overlay list it (removed again on the spine-progress event).
                let _ = win.emit("spine-job-start", file.clone());

                let output_dir_hint = {
                    let input_path = std::path::PathBuf::from(file.as_str());
                    resolve_output_dir(&req, &input_path, &run_folder).ok()
                };

                let outcome =
                    export_one_file(win.clone(), app_state, req, &file, &run_folder).await;

                let current = done.tick();
                let _ = win.emit(
                    "spine-progress",
                    ProgressPayload {
                        current,
                        total,
                        file: file.clone(),
                    },
                );

                (outcome, output_dir_hint)
            }
        },
    )
    .await;

    let mut completed = 0usize;
    let mut failed = 0usize;
    let mut skipped = 0usize;
    let mut output_folders = Vec::new();
    let mut stopped = false;

    for (_index, (outcome, output_dir_hint)) in results {
        match outcome {
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
        }
    }

    // If the stop flag was set, reflect that in the result.
    if state_arc.stop_requested.load(Ordering::SeqCst) {
        stopped = true;
        let _ = window.emit("spine-log", "Batch stopped by user.");
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

/// Sync the user's "run in background" preference into shared state. The window
/// close/minimize handler reads this to decide whether to hide to tray or quit.
#[tauri::command]
fn set_run_in_background(state: State<'_, Arc<AppState>>, enabled: bool) {
    state.run_in_background.store(enabled, Ordering::SeqCst);
}

pub fn run() {
    let state = Arc::new(AppState::default());

    tauri::Builder::default()
        // First plugin: a second launch (e.g. while hidden in the tray) restores the running window instead of spawning a new process.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| tray::show_main_window(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(state)
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("spine-log", "SpineForge X ready.");
            }
            tray::build(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| tray::on_window_event(window, event))
        .invoke_handler(tauri::generate_handler![
            auto_detect_spine,
            detect_spine_version,
            scan_spine_files,
            validate_settings,
            export::check_output_collisions,
            export::resolve_output_dirs,
            presets::list_export_presets,
            presets::import_user_export_preset,
            presets::read_user_export_preset,
            presets::read_export_preset,
            read_spine_export_settings,
            presets::save_user_export_preset,
            presets::delete_user_export_preset,
            system::write_text_file,
            system::read_text_file,
            system::detect_drive_root,
            clean_timestamp_exports,
            system::open_path,
            system::open_url,
            system::path_exists,
            system::read_image_data_url,
            system::read_file_data_url,
            library::list_export_assets,
            clean::count_clean_units,
            clean::list_clean_units,
            clean::scan_source_folders,
            clean::clean_source_folders,
            clean::move_unused_images,
            library::scan_library,
            library::scan_library_unused,
            system::open_in_spine,
            system::list_subdirectories,
            drive::drive_account,
            drive::drive_sign_in,
            drive::drive_sign_out,
            drive::drive_file_metadata,
            drive::drive_files_basic,
            drive::drive_open_revision,
            start_batch_export,
            stop_batch_export,
            set_run_in_background
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
