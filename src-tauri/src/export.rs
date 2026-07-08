//! The batch-export engine: resolving an output directory + an export plan for a
//! single `.spine`, running the Spine CLI for one file, and the collision-preview
//! commands. Split out of lib.rs in v0.3.3. The `start_batch_export` command (the
//! parallel driver) stays in lib.rs and calls `export_one_file` here.

use std::{
    fs,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};
use tauri::{Emitter, Window};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
    time,
};

use crate::error::ResultExt;
use crate::model::*;
use crate::paths::*;
use crate::spine_project;
use crate::util::*;

pub(crate) struct ExportPlan {
    pub(crate) arg: Option<String>,
    pub(crate) temp_file: Option<PathBuf>,
    /// Optional per-file log line describing how the plan was built (e.g. the
    /// pack sizes parsed from the project). Emitted as `spine-log` by the caller.
    pub(crate) note: Option<String>,
}

/// Why an export plan could not be produced. `Skip` marks the file as skipped
/// in the batch report; `Fail` marks it as failed.
#[derive(Debug)]
pub(crate) enum PlanError {
    Skip(String),
    Fail(String),
}

impl From<String> for PlanError {
    fn from(message: String) -> Self {
        PlanError::Fail(message)
    }
}

pub(crate) async fn export_one_file(
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

    // Pre-clean: a shared output folder (the `export`/`ex` subfolder, or a reused source-name /
    // linked folder) accumulates old artifacts across runs, so a re-export producing fewer atlas
    // pages leaves orphans behind. Remove only THIS unit's stale files (matched by skeleton base
    // name) before writing — files belonging to other units in the same folder are left untouched.
    let skeleton_base = input_file
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("");
    let removed = clean_matching_outputs(Path::new(&output_dir), skeleton_base);
    if removed > 0 {
        let _ = window.emit(
            "spine-log",
            format!("Cleaned {removed} stale file(s) matching '{skeleton_base}' in {output_dir}"),
        );
    }

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
        Err(PlanError::Skip(reason)) => {
            let _ = window.emit("spine-log", format!("Skipped: {reason}"));
            return FileOutcome::Skipped;
        }
        Err(PlanError::Fail(e)) => return FileOutcome::Failed(e),
    };
    if let Some(note) = &export_plan.note {
        let _ = window.emit("spine-log", note.clone());
    }

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

/// Remove a unit's own stale export artifacts from `output_dir` before a re-export, keeping any
/// files that belong to *other* units sharing the folder. Only names matching `skeleton_base` are
/// deleted — `Foo.json`, `Foo.atlas`, `Foo.atlas.txt`, `Foo.skel.bytes`, `Foo.png`, `Foo2.png` for
/// base `Foo`. The `.export.json` settings sidecar and the source `.spine` are always preserved.
/// Best-effort: a missing directory or a per-file error is ignored. Returns the count removed.
pub(crate) fn clean_matching_outputs(output_dir: &Path, skeleton_base: &str) -> usize {
    if skeleton_base.is_empty() {
        return 0;
    }
    let Ok(entries) = fs::read_dir(output_dir) else {
        return 0;
    };
    let base = skeleton_base.to_ascii_lowercase();
    let mut removed = 0;
    for entry in entries.filter_map(Result::ok) {
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        if name.ends_with(".export.json") || name.ends_with(".spine") {
            continue;
        }
        if name_matches_base(&name, &base) && fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    removed
}

/// Is `file_name` (already lowercased) an export artifact of `base` (already lowercased)? True for
/// the base followed by an extension (`base.ext`, e.g. `foo.json`, `foo.atlas.txt`) or an atlas-page
/// index then an extension (`base<digits>.ext`, e.g. `foo2.png`). Unrelated names never match:
/// `bar.png` (no prefix), `foobar.png` (prefix but the remainder isn't digits-then-dot).
pub(crate) fn name_matches_base(file_name: &str, base: &str) -> bool {
    let Some(rest) = file_name.strip_prefix(base) else {
        return false;
    };
    // Require an extension separator; the chars before the first '.' must all be ASCII digits
    // (empty for `base.ext`, "2"/"10"/… for atlas pages `base2.png`).
    match rest.split_once('.') {
        Some((head, _)) => head.chars().all(|c| c.is_ascii_digit()),
        None => false,
    }
}

pub(crate) fn resolve_output_dir(
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

            let mut output_dir = parse_quoted_path(output_root);

            if request.preserve_relative_paths {
                let input_root = parse_quoted_path(&request.input_root);
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
            let mut output_dir = parse_quoted_path(output_root);
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
            let mut base = parse_quoted_path(output_root);
            base.push(request.linked_dest_type.trim());

            // Reuse an existing id folder if one is found, else create a new folder named after
            // the source folder (so "0001_Fighter" reuses "Heroes/0001_Fighter" instead of "Heroes/0001").
            let folder = find_existing_id_folder(&base, id).unwrap_or_else(|| source_folder_name.to_string());
            base.push(folder);
            Ok(path_to_string(&base))
        }
        OutputPolicy::ExportSubfolder => {
            // Each file exports into an "export" folder created next to it,
            // inside the folder that contains the .spine file.
            Ok(path_to_string(&parent.join("export")))
        }
    }
}

/// Returns the resolved output directories that already exist and contain files,
/// so the UI can warn before overwriting them. Mainly relevant for the source-folder
/// policy (timestamp folders are unique per run and won't pre-exist).
#[tauri::command]
pub(crate) fn check_output_collisions(request: BatchExportRequest) -> Result<Vec<String>, String> {
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

/// Returns every output directory this request resolves to, regardless of whether
/// it already exists on disk. The UI uses this to detect two sessions in the same
/// "export all" batch that would write to the same folder (and silently overwrite
/// each other) even when the target doesn't pre-exist — a case check_output_collisions
/// can't catch because it only inspects existing dirs.
#[tauri::command]
pub(crate) fn resolve_output_dirs(request: BatchExportRequest) -> Result<Vec<String>, String> {
    let run_folder_name = make_export_folder_name(&request.target_version);
    let mut dirs = std::collections::BTreeSet::new();
    for file in &request.files {
        let input_file = PathBuf::from(file);
        if let Ok(dir) = resolve_output_dir(&request, &input_file, &run_folder_name) {
            dirs.insert(dir);
        }
    }
    Ok(dirs.into_iter().collect())
}

pub(crate) fn resolve_export_plan(
    request: &BatchExportRequest,
    input_file: &Path,
    output_dir: &str,
) -> Result<ExportPlan, PlanError> {
    if matches!(request.export_mode, ExportMode::GeneratedSettings) {
        let temp_file = create_generated_export_settings(request, input_file, output_dir)?;
        return Ok(ExportPlan {
            arg: Some(path_to_string(&temp_file)),
            temp_file: Some(temp_file),
            note: None,
        });
    }

    if matches!(request.export_mode, ExportMode::LastExportSettings) {
        return create_last_export_settings(request, input_file);
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
        note: None,
    })
}

/// ExportMode::LastExportSettings — decode the settings stored in the `.spine`
/// project and merge them over the base preset (`global_json_path`). On any
/// parse failure the file still exports with the unmodified base preset (the
/// behavior the user picked for this mode), with the reason logged per file.
pub(crate) fn create_last_export_settings(
    request: &BatchExportRequest,
    input_file: &Path,
) -> Result<ExportPlan, PlanError> {
    let base_path = request
        .global_json_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            PlanError::Fail("Chế độ settings-từ-project cần chọn preset nền (.export.json).".to_string())
        })?;

    let decoded = match spine_project::read_export_settings(input_file) {
        Ok(decoded) => decoded,
        Err(reason) => {
            let note = format!(
                "[WARN] Không parse được settings từ project ({reason}); file này export bằng preset nền — {}",
                path_to_string(input_file)
            );
            // Same path the plain GlobalJson mode takes, including the legacy
            // packSource normalization.
            if let Some(mut plan) = normalize_preset_file(base_path)? {
                plan.note = Some(note);
                return Ok(plan);
            }
            return Ok(ExportPlan {
                arg: Some(base_path.to_string()),
                temp_file: None,
                note: Some(note),
            });
        }
    };

    let base_content = fs::read_to_string(base_path)
        .map_err(|e| PlanError::Fail(format!("Đọc preset nền thất bại ({base_path}): {e}")))?;

    // Divergence warning: when the project's stored pack max differs from the
    // base preset, the .spine likely wasn't re-exported from the editor (its
    // stored settings are stale relative to the artist's intent), so the parsed
    // value may be wrong. Surface it instead of silently exporting at a bad size.
    let base_max = serde_json::from_str::<serde_json::Value>(&base_content)
        .ok()
        .and_then(|v| {
            v.get("packAtlas")
                .and_then(|p| p.get("maxWidth"))
                .and_then(serde_json::Value::as_u64)
        });
    let mut note = format!(
        "Settings từ project: {} — {}",
        decoded.summary(),
        path_to_string(input_file)
    );
    if let Some(base_max) = base_max {
        if u64::from(decoded.pack_sizes.max_width) != base_max {
            note.push_str(&format!(
                "  [WARN] pack max từ .spine = {} ≠ preset nền = {}; kiểm tra file đã export lại từ editor chưa (giá trị trong .spine có thể stale)",
                decoded.pack_sizes.max_width, base_max
            ));
        }
    }

    let merged =
        spine_project::merge_decoded_settings(&base_content, &decoded).map_err(PlanError::Fail)?;
    let temp_file = write_temp_export_settings(&merged)?;
    Ok(ExportPlan {
        arg: Some(path_to_string(&temp_file)),
        temp_file: Some(temp_file),
        note: Some(note),
    })
}

/// Write export settings JSON to a unique temp file (UTF-8, no BOM) and return
/// its path. The caller owns cleanup via `ExportPlan::temp_file`.
fn write_temp_export_settings(settings: &serde_json::Value) -> Result<PathBuf, String> {
    // Timestamp+pid alone collides when parallel jobs plan within the same
    // millisecond in one process (the first job's cleanup then deletes the
    // file out from under the others), so a per-process counter is required.
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let seq = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let temp_file = std::env::temp_dir().join(format!(
        "spineforge-x-{}-{}-{}.export.json",
        chrono::Local::now().format("%Y%m%d%H%M%S%3f"),
        std::process::id(),
        seq
    ));
    let json = serde_json::to_string_pretty(settings).str_err()?;
    fs::write(&temp_file, json).str_err()?;
    Ok(temp_file)
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

    write_temp_export_settings(&settings)
}

pub(crate) fn resolve_export_arg(
    request: &BatchExportRequest,
    input_file: &Path,
) -> Result<Option<String>, PlanError> {
    match request.export_mode {
        ExportMode::InternalExperimental => Err(PlanError::Fail(
            "Use internal project settings đã bị tắt vì Spine CLI cần --export/-e để export."
                .to_string(),
        )),
        ExportMode::GlobalJson | ExportMode::LastExportSettings => request
            .global_json_path
            .clone()
            .filter(|value| !value.trim().is_empty())
            .map(Some)
            .ok_or_else(|| {
                PlanError::Fail("Force global settings cần global .export.json.".to_string())
            }),
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
                    .ok_or_else(|| {
                        PlanError::Fail(
                            "Fallback global JSON được chọn nhưng path trống.".to_string(),
                        )
                    }),
                FallbackMode::Skip => Err(PlanError::Skip(format!(
                    "Không tìm thấy .export.json cạnh {}",
                    path_to_string(input_file)
                ))),
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
    let temp_file = write_temp_export_settings(&value)?;

    Ok(Some(ExportPlan {
        arg: Some(path_to_string(&temp_file)),
        temp_file: Some(temp_file),
        note: None,
    }))
}
