//! Shared data types crossing the command/engine boundary: the app state, the
//! batch-export request/result, validation/scan results, and the clean-source
//! scan types. Split out of lib.rs in v0.3.3. Fields are `pub(crate)` because
//! the export (`export`) and clean (`clean`) engines construct/read them.

use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::PathBuf, sync::atomic::AtomicBool};
use tokio::sync::Mutex;

use crate::cleaner;
use crate::path_to_string;

/// Identifies a unit's scan inputs. A cached scan is reused only when all of
/// these match, so any edit to the `.spine` or the image set forces a re-export.
#[derive(Clone, PartialEq)]
pub(crate) struct ScanSig {
    pub(crate) target_version: String,
    pub(crate) spine_mtime: u64,
    pub(crate) spine_size: u64,
    pub(crate) img_count: usize,
    pub(crate) img_bytes: u64,
}

pub(crate) struct AppState {
    pub(crate) stop_requested: AtomicBool,
    pub(crate) running_children: Mutex<Vec<u32>>,
    /// When true, closing/minimizing the window hides it to the tray instead of quitting.
    pub(crate) run_in_background: AtomicBool,
    /// Set just before a real quit (tray "Quit") so the close handler lets the window close.
    pub(crate) quitting: AtomicBool,
    /// Per-session cache of clean-source scans, keyed by `.spine` path. Lets a
    /// re-scan skip the expensive Spine CLI export for units that haven't changed.
    pub(crate) scan_cache: Mutex<HashMap<PathBuf, (ScanSig, FolderScan)>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            stop_requested: AtomicBool::new(false),
            running_children: Mutex::new(Vec::new()),
            // Default on; the frontend syncs the persisted user preference at startup.
            run_in_background: AtomicBool::new(true),
            quitting: AtomicBool::new(false),
            scan_cache: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ExportMode {
    PerProjectJson,
    InternalExperimental,
    GlobalJson,
    BuiltIn,
    GeneratedSettings,
    /// Parse each project's last-export settings straight out of the `.spine`
    /// binary (see `spine_project`) and merge them over the selected global
    /// preset. Falls back to the unmodified preset when parsing fails.
    LastExportSettings,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum FallbackMode {
    BuiltIn,
    GlobalJson,
    Skip,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum OutputPolicy {
    Timestamp,
    SourceFolderName,
    LinkedProject,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BatchExportRequest {
    pub(crate) spine_path: String,
    pub(crate) input_root: String,
    pub(crate) files: Vec<String>,
    pub(crate) output_path: String,
    pub(crate) output_policy: OutputPolicy,
    pub(crate) target_version: String,
    pub(crate) export_mode: ExportMode,
    pub(crate) fallback_mode: FallbackMode,
    pub(crate) global_json_path: Option<String>,
    pub(crate) built_in_export: String,
    pub(crate) generated_format: String,
    pub(crate) generated_skeleton_extension: String,
    pub(crate) generated_pack_atlas: bool,
    pub(crate) generated_max_width: i32,
    pub(crate) generated_max_height: i32,
    pub(crate) generated_premultiply_alpha: bool,
    pub(crate) generated_pot: bool,
    pub(crate) generated_padding_x: i32,
    pub(crate) generated_padding_y: i32,
    pub(crate) generated_pretty_print: bool,
    pub(crate) generated_nonessential: bool,
    pub(crate) generated_strip_whitespace_x: bool,
    pub(crate) generated_strip_whitespace_y: bool,
    pub(crate) generated_rotation: bool,
    pub(crate) generated_alias: bool,
    pub(crate) generated_ignore_blank_images: bool,
    pub(crate) generated_alpha_threshold: i32,
    pub(crate) generated_min_width: i32,
    pub(crate) generated_min_height: i32,
    pub(crate) generated_multiple_of_four: bool,
    pub(crate) generated_square: bool,
    pub(crate) generated_output_format: String,
    pub(crate) generated_jpeg_quality: f64,
    pub(crate) generated_bleed: bool,
    pub(crate) generated_bleed_iterations: i32,
    pub(crate) generated_edge_padding: bool,
    pub(crate) generated_duplicate_padding: bool,
    pub(crate) generated_filter_min: String,
    pub(crate) generated_filter_mag: String,
    pub(crate) generated_wrap_x: String,
    pub(crate) generated_wrap_y: String,
    pub(crate) generated_texture_format: String,
    pub(crate) generated_atlas_extension: String,
    pub(crate) generated_combine_subdirectories: bool,
    pub(crate) generated_flatten_paths: bool,
    pub(crate) generated_use_indexes: bool,
    pub(crate) generated_fast: bool,
    pub(crate) generated_limit_memory: bool,
    pub(crate) generated_packing: String,
    pub(crate) generated_pack_source: String,
    pub(crate) generated_pack_target: String,
    pub(crate) generated_warnings: bool,
    pub(crate) generated_force_all: bool,
    pub(crate) clean: bool,
    pub(crate) parallel_jobs: usize,
    pub(crate) max_memory: String,
    pub(crate) timeout_seconds: u64,
    pub(crate) preserve_relative_paths: bool,
    pub(crate) clean_folder_name: bool,
    #[serde(default)]
    pub(crate) unicode_workaround: bool,
    /// For the LinkedProject policy: the resolved destination type folder (e.g. "Heroes").
    /// Output routes to `output_path/<linked_dest_type>/<idFolder>`.
    #[serde(default)]
    pub(crate) linked_dest_type: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct ScanResult {
    pub(crate) files: Vec<String>,
    pub(crate) skipped: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ValidateResult {
    pub(crate) ok: bool,
    pub(crate) warnings: Vec<String>,
    pub(crate) errors: Vec<String>,
    pub(crate) spine_ok: bool,
    pub(crate) spine_warning: bool,
    pub(crate) output_ok: bool,
    pub(crate) output_warning: bool,
}

#[derive(Debug, Serialize)]
pub(crate) struct CleanResult {
    pub(crate) deleted: Vec<String>,
    pub(crate) failed: Vec<String>,
}

/// Outcome of processing a single .spine file in a batch export.
#[derive(Debug)]
pub(crate) enum FileOutcome {
    /// CLI exited 0 and at least one output file was found.
    Completed,
    /// CLI failed (non-zero exit, timeout) or exited 0 but produced no output.
    Failed(String),
    /// File was skipped because FallbackMode::Skip was active and no .export.json was found.
    Skipped,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BatchExportResult {
    pub(crate) completed: usize,
    pub(crate) failed: usize,
    pub(crate) skipped: usize,
    pub(crate) total: usize,
    pub(crate) output_folders: Vec<String>,
    pub(crate) stopped: bool,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct ProgressPayload {
    pub(crate) current: usize,
    pub(crate) total: usize,
    pub(crate) file: String,
}

/// One source folder to clean: its `.spine` file and the image directory.
pub(crate) struct CleanUnit {
    pub(crate) spine_file: PathBuf,
    pub(crate) images_dir: PathBuf,
    pub(crate) folder: PathBuf,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FolderScan {
    pub(crate) folder: String,
    pub(crate) images_dir: String,
    pub(crate) spine_file: String,
    pub(crate) total_images: usize,
    pub(crate) used: usize,
    pub(crate) used_images: Vec<cleaner::ImageEntry>,
    pub(crate) unused: Vec<cleaner::ImageEntry>,
    pub(crate) unused_bytes: u64,
    pub(crate) missing: Vec<String>,
    pub(crate) ambiguous: Vec<String>,
    /// Per-folder failure (export/parse) — does not abort the whole batch.
    pub(crate) error: Option<String>,
}

impl FolderScan {
    pub(crate) fn empty(unit: &CleanUnit, error: Option<String>) -> Self {
        FolderScan {
            folder: path_to_string(&unit.folder),
            images_dir: path_to_string(&unit.images_dir),
            spine_file: path_to_string(&unit.spine_file),
            total_images: 0,
            used: 0,
            used_images: Vec::new(),
            unused: Vec::new(),
            unused_bytes: 0,
            missing: Vec::new(),
            ambiguous: Vec::new(),
            error,
        }
    }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BatchScanSummary {
    pub(crate) units: Vec<FolderScan>,
    pub(crate) total_unused: usize,
    pub(crate) total_unused_bytes: u64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FolderCleanResult {
    pub(crate) folder: String,
    pub(crate) moved: usize,
    pub(crate) backup_dir: Option<String>,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BatchCleanResult {
    pub(crate) units: Vec<FolderCleanResult>,
    pub(crate) total_moved: usize,
    pub(crate) stopped: bool,
}

/// One discovered clean unit, for letting the user pick which folders to scan.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CleanUnitInfo {
    /// Source folder containing the `.spine`.
    pub(crate) folder: String,
    /// The `.spine` path — used as the stable key and as the `excluded` token.
    pub(crate) spine_file: String,
}
