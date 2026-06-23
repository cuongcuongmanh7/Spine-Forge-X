//! Shared data types crossing the command/engine boundary: the app state, the
//! batch-export request/result, validation/scan results, and the clean-source
//! scan types. Split out of lib.rs in v0.3.3. Fields are `pub(crate)` because
//! the export (`export`) and clean (`clean`) engines construct/read them.

use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::atomic::{AtomicBool, AtomicU64},
};
use tokio::sync::Mutex;

use crate::cleaner;
use crate::drive::DriveToken;
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
    /// Tier B Google Drive: cached short-lived access token (refresh token is in the keyring).
    pub(crate) drive_token: Mutex<Option<DriveToken>>,
    /// Tier B: cache of `path-prefix → Drive file/folder ID` (every walked folder + the final file)
    /// so a batch over a library traverses each shared folder only once/session.
    pub(crate) drive_file_ids: Mutex<HashMap<String, String>>,
    /// Tier B: cache of `shared-drive-name → driveId`, fetched once via `drives.list`.
    pub(crate) drive_roots: Mutex<Option<HashMap<String, String>>>,
    /// Tier B realtime: `shared-drive-name → Drive Changes API page token`, advanced each poll so
    /// the background watcher fetches only the delta since last tick.
    pub(crate) drive_change_tokens: Mutex<HashMap<String, String>>,
    /// Tier B realtime: true while the changes poller should keep running. Cleared by
    /// `drive_watch_stop` so the loop exits at its next tick.
    pub(crate) drive_watch_running: AtomicBool,
    /// Tier B realtime: bumped on every `drive_watch_start`. Each spawned poll loop captures the
    /// epoch it was born with and exits once a newer start supersedes it — so a stop→start (e.g. a
    /// focus toggle) never leaves two loops polling at once.
    pub(crate) drive_watch_epoch: AtomicU64,
    /// Library filesystem watcher (notify) — held here to keep it alive; dropped on stop. Plain
    /// `std::sync::Mutex` because the watcher is touched outside async and never held across `.await`.
    pub(crate) library_watcher: std::sync::Mutex<Option<notify::RecommendedWatcher>>,
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
            drive_token: Mutex::new(None),
            drive_file_ids: Mutex::new(HashMap::new()),
            drive_roots: Mutex::new(None),
            drive_change_tokens: Mutex::new(HashMap::new()),
            drive_watch_running: AtomicBool::new(false),
            drive_watch_epoch: AtomicU64::new(0),
            library_watcher: std::sync::Mutex::new(None),
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
    ExportSubfolder,
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

/// One `.spine` in an asset-library scan: its location, sizes, image-folder
/// footprint, and offline-parsed editor version. Warning evaluation and version
/// grouping happen in the frontend (thresholds are UI-owned), so this stays raw.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryEntry {
    /// `.spine` path relative to the scanned root (drives folder/type grouping).
    pub(crate) rel_path: String,
    pub(crate) spine_file: String,
    /// The unit folder containing the `.spine`.
    pub(crate) folder: String,
    pub(crate) images_dir: String,
    pub(crate) spine_bytes: u64,
    pub(crate) image_bytes: u64,
    pub(crate) image_count: usize,
    /// Editor version (e.g. "3.8.99", "4.3.17"); `None` when it can't be parsed.
    pub(crate) version: Option<String>,
    /// True when an exported `.json` skeleton was found (in an `export`/`ex` subfolder).
    pub(crate) exported: bool,
    /// Animation clip names read from the exported skeleton(s), unioned + sorted.
    pub(crate) animations: Vec<String>,
    /// Skin names read from the exported skeleton(s), unioned + sorted.
    pub(crate) skins: Vec<String>,
    pub(crate) animation_count: usize,
    pub(crate) error: Option<String>,
}

/// Result of scanning a master folder for `.spine` assets.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryScan {
    pub(crate) root: String,
    pub(crate) entries: Vec<LibraryEntry>,
    pub(crate) total_spine_bytes: u64,
    pub(crate) total_image_bytes: u64,
}

/// One texture page referenced by an exported atlas.
#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportPage {
    /// The page filename exactly as the atlas references it (e.g. `hero.png`).
    pub(crate) name: String,
    /// Absolute path to that page image on disk.
    pub(crate) path: String,
}

/// The on-disk file set the Spine web player needs to render a unit's export:
/// one skeleton (json/skel), its atlas, and the texture pages. Resolved from the
/// unit's `export`/`ex` subfolder ([`crate::library::list_export_assets`]).
#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportAssets {
    /// Absolute path to the skeleton file.
    pub(crate) skeleton_path: String,
    /// `"json"` or `"skel"` (binary).
    pub(crate) skeleton_format: String,
    /// Runtime version family needed to load it: `"3.8"`, `"4.x"`, or `None` when
    /// it couldn't be determined.
    pub(crate) version: Option<String>,
    /// Absolute path to the atlas file.
    pub(crate) atlas_path: String,
    /// Texture pages the atlas references (resolved to absolute paths).
    pub(crate) pages: Vec<ExportPage>,
}

/// One texture page in a health report: the name as the atlas references it, its
/// resolved path, and whether it actually exists on disk (+ its byte size).
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HealthPage {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) exists: bool,
    pub(crate) bytes: u64,
}

/// Diagnostic snapshot of why a unit's export does (or doesn't) load in the thumbnail/preview
/// player. Collects every check instead of bailing on the first error, plus the raw atlas text
/// and skeleton header so a human (or AI) can pinpoint the cause. See
/// [`crate::library::health_check_entry`].
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HealthReport {
    pub(crate) rel_path: String,
    pub(crate) spine_file: String,
    pub(crate) folder: String,
    /// Editor version from the `.spine` (passed in from the frontend entry).
    pub(crate) editor_version: Option<String>,
    /// `export`/`ex` subfolders found under the unit folder.
    pub(crate) export_dirs: Vec<String>,
    /// Every file in those export dirs, as `name (size)` lines — for eyeballing what got exported.
    pub(crate) export_files: Vec<String>,
    pub(crate) skeleton_path: Option<String>,
    /// `"json"` or `"skel"`.
    pub(crate) skeleton_format: Option<String>,
    pub(crate) skeleton_bytes: u64,
    /// Runtime version family the skeleton needs ("3.8" / "4.2" / "4.3" / "4.x").
    pub(crate) detected_version: Option<String>,
    /// JSON: the `skeleton{}` header object (truncated). Skel: hex of the first 16 bytes + version.
    pub(crate) skeleton_header: Option<String>,
    pub(crate) atlas_path: Option<String>,
    /// Full atlas text (small; lists pages + regions — the richest single diagnostic).
    pub(crate) atlas_content: Option<String>,
    pub(crate) pages: Vec<HealthPage>,
    /// Human-readable issues found; empty when healthy.
    pub(crate) problems: Vec<String>,
    pub(crate) ok: bool,
}
