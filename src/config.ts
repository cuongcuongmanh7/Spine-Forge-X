import type { ExportMode, FallbackMode, OutputPolicy, UpdateUiState } from './types';

/** One source→dest folder mapping inside a Linked Project (e.g. `Hero` → `Heroes`). */
export type LinkedType = {
  sourceName: string;
  destName: string;
};

/**
 * A saved link between a Spine art tree and a Unity asset tree. Shared across sessions
 * (lives in AppConfig). Output routes to `unityRoot/<type.destName>/<idFolder>`.
 */
export type LinkedProject = {
  id: string;
  name: string;
  /** Unity asset root the export writes into, e.g. `.../Assets/.../Animations/Spine`. */
  unityRoot: string;
  /** Art tree containing the `.spine` files (informational; used for Auto-fill convenience). */
  sourceRoot: string;
  types: LinkedType[];
};

/**
 * App-wide configuration — shared across every session. Edited in the Settings popup.
 */
export const defaultAppConfig = {
  spinePath: '',
  parallelJobs: 4,
  maxMemory: '512m',
  timeoutSeconds: 300,
  // When true, closing or minimizing the window hides the app to the system tray
  // instead of quitting. Synced to the Rust side, which enforces it.
  runInBackground: true,
  // Saved Unity links, reusable by any session via the `linkedProject` output policy.
  linkedProjects: [] as LinkedProject[],
  // Asset Library warnings: an image folder or a .spine larger than these (in MB) is flagged.
  libraryImageFolderWarnMB: 50,
  librarySpineFileWarnMB: 10
};

export type AppConfig = typeof defaultAppConfig;

/** Summary of a single export run, kept per session to power the project dashboard. */
export type ExportRecord = {
  /** Epoch ms when the run finished. */
  at: number;
  completed: number;
  failed: number;
  skipped: number;
  total: number;
  /** true if the user stopped the run early. */
  stopped: boolean;
  /** Wall-clock run time in ms. Absent on records saved before this field existed. */
  durationMs?: number;
};

/**
 * Per-session configuration — every session in the Recents column is fully independent.
 */
export const defaultSessionConfig = {
  inputPath: '',
  inputFiles: [] as string[],
  // Full paths removed from a folder-scan result; re-applied on re-scan so deletions survive restart.
  excludedFiles: [] as string[],
  outputPath: '',
  // 'timestamp' is temporarily hidden in the UI; new sessions default to source-folder routing.
  outputPolicy: 'sourceFolderName' as OutputPolicy,
  // For the linkedProject policy: which saved LinkedProject + which type (by sourceName) to use.
  linkedProjectId: '',
  linkedTypeName: '',
  // Pass --clean to Spine: wipe each output folder before exporting.
  clean: false,
  // Timestamp policy only: mirror the input path's relative folder structure into the output root.
  preserveRelativePaths: true,
  // For the source-folder policy: shorten the folder name to the token before the
  // first underscore, e.g. "3001_Lucius" -> "3001".
  cleanFolderName: false,
  targetVersion: '4.3.XX',
  exportMode: 'globalJson' as ExportMode,
  fallbackMode: 'builtIn' as FallbackMode,
  globalJsonPath: '',
  builtInExport: 'binary+pack',
  generatedFormat: 'json',
  generatedSkeletonExtension: '.json',
  generatedPackAtlas: true,
  generatedMaxWidth: 2048,
  generatedMaxHeight: 2048,
  generatedPremultiplyAlpha: false,
  generatedPot: true,
  generatedPaddingX: 2,
  generatedPaddingY: 2,
  generatedPrettyPrint: true,
  generatedNonessential: true,
  generatedStripWhitespaceX: true,
  generatedStripWhitespaceY: true,
  generatedRotation: true,
  generatedAlias: true,
  generatedIgnoreBlankImages: false,
  generatedAlphaThreshold: 3,
  generatedMinWidth: 16,
  generatedMinHeight: 16,
  generatedMultipleOfFour: false,
  generatedSquare: false,
  generatedOutputFormat: 'png',
  generatedJpegQuality: 0.9,
  generatedBleed: true,
  generatedBleedIterations: 2,
  generatedEdgePadding: true,
  generatedDuplicatePadding: false,
  generatedFilterMin: 'Linear',
  generatedFilterMag: 'Linear',
  generatedWrapX: 'ClampToEdge',
  generatedWrapY: 'ClampToEdge',
  generatedTextureFormat: 'RGBA8888',
  generatedAtlasExtension: '.atlas',
  generatedCombineSubdirectories: false,
  generatedFlattenPaths: false,
  generatedUseIndexes: false,
  generatedFast: false,
  generatedLimitMemory: true,
  generatedPacking: 'polygons',
  generatedPackSource: 'attachments',
  generatedPackTarget: 'perskeleton',
  generatedWarnings: true,
  generatedForceAll: false,
  // When enabled, the backend copies .spine files to an ASCII temp path before calling
  // SpineCLI, to work around SpineCLI failures with non-ASCII (Unicode) paths.
  unicodeWorkaround: false,
  // When enabled, open the output folder automatically after an export finishes
  // (skips re-opening if the app just opened that same folder).
  autoOpenOutputAfterExport: false,
  // Summary of this session's most recent export — read by the project dashboard. Not a
  // user setting; persisted alongside config so the dashboard survives restarts.
  lastExport: null as ExportRecord | null
};

export type SessionConfig = typeof defaultSessionConfig;

/** Flat shape consumed by the workspace UI and the Tauri export request (AppConfig + SessionConfig). */
export type MergedConfig = AppConfig & SessionConfig;

/** A project groups multiple sessions in the sidebar. */
export type Project = {
  id: string;
  name: string;
  /** true for the auto-created default project (lets migration keep it un-renamed). */
  autoNamed: boolean;
  createdAt: number;
  updatedAt: number;
};

/**
 * An imported master folder, scanned into an asset inventory. Separate from the export-oriented
 * `Project` — a Library just records where the spine assets live so the dashboard can re-scan.
 */
export type Library = {
  id: string;
  name: string;
  rootPath: string;
  createdAt: number;
  /** Epoch ms of the last successful scan; null until scanned once. */
  lastScanAt: number | null;
};

/** One `.spine` asset in a library scan (mirrors the Rust `LibraryEntry`). */
export type LibraryEntry = {
  /** `.spine` path relative to the scanned root — drives folder/type grouping. */
  relPath: string;
  spineFile: string;
  folder: string;
  imagesDir: string;
  spineBytes: number;
  imageBytes: number;
  imageCount: number;
  /** Editor version (e.g. "3.8.99"); null when it couldn't be parsed. */
  version: string | null;
  /** True when an exported `.json` skeleton was found (in an export/ex subfolder). */
  exported: boolean;
  /** Animation clip names read from the exported skeleton(s). */
  animations: string[];
  /** Skin names read from the exported skeleton(s). */
  skins: string[];
  animationCount: number;
  error: string | null;
};

/** A texture page an exported atlas references (mirrors the Rust `ExportPage`). */
export type ExportPage = {
  /** Page filename exactly as the atlas references it (e.g. `hero.png`). */
  name: string;
  /** Absolute path to that page image on disk. */
  path: string;
};

/**
 * On-disk file set the Spine web player needs to render a unit's export
 * (mirrors the Rust `ExportAssets`). Returned by the `list_export_assets` command.
 */
export type ExportAssets = {
  skeletonPath: string;
  /** `"json"` or `"skel"` (binary). */
  skeletonFormat: 'json' | 'skel';
  /** Runtime family: `"3.8"`, `"4.x"`, or null when undetermined. */
  version: string | null;
  atlasPath: string;
  pages: ExportPage[];
};

/** Result of scanning a master folder (mirrors the Rust `LibraryScan`). */
export type LibraryScan = {
  root: string;
  entries: LibraryEntry[];
  totalSpineBytes: number;
  totalImageBytes: number;
};

/** Persistent "clean still valid" marker for one library entry. */
export type LibraryCleanRecord = {
  spineFile: string;
  scannedAt: number;
  cleanedAt?: number;
  unusedCount: number;
  unusedBytes: number;
  spineBytes: number;
  imageBytes: number;
  imageCount: number;
  version: string | null;
  exported: boolean;
};

export type LibraryCleanState = Record<string, LibraryCleanRecord>;

export type Session = {
  id: string;
  /** Every session belongs to exactly one project. */
  projectId: string;
  name: string;
  /** true until the user renames it — lets a folder pick keep updating the auto name. */
  autoNamed: boolean;
  /** false for a freshly created session → it goes through the setup wizard. Duplicates inherit
   *  the source's value; sessions loaded from storage default to true (already configured). */
  wizardCompleted: boolean;
  config: SessionConfig;
  createdAt: number;
  updatedAt: number;
};

/** Per-session readiness shown as a colored dot in the sidebar. */
export type SessionStatus = 'green' | 'yellow' | 'red';

/**
 * Cross-session overlap within the same project, surfaced as a sidebar badge so the
 * user notices BEFORE running Export all (where the later session overwrites the earlier).
 * - sharedInput: this session shares at least one input .spine with another session (attention).
 * - outputCollision: this session resolves to an output dir another session also targets (danger).
 */
export type SessionOverlap = {
  sharedInput: boolean;
  outputCollision: boolean;
};

/** Ephemeral, never persisted. Reset on app restart. */
export type SessionRuntime = {
  files: string[];
  skippedFiles: string[];
  logs: string[];
  lastOutputFolders: string[];
  currentIndex: number;
};

export function emptyRuntime(): SessionRuntime {
  return { files: [], skippedFiles: [], logs: [], lastOutputFolders: [], currentIndex: 0 };
}

// Patch-agnostic presets: Spine resolves `MAJOR.MINOR.XX` to the latest installed patch of that
// minor (e.g. `4.3.XX` → 4.3.17). We can't enumerate installed editor versions via the CLI, so
// these generic forms are safer than hard-coding specific patches that may not exist on a machine.
// A concrete version detected from `--version` is added to the dropdown on top of these.
export const targetVersionPresets = ['4.3.XX', '3.8.XX', 'lateststable'];

/** Starting point for a brand-new global preset in the editor (binary skeleton + packed atlas). */
export const defaultExportPreset = {
  class: 'export-binary',
  extension: '.skel',
  format: 'Binary',
  prettyPrint: true,
  nonessential: true,
  cleanUp: false,
  packAtlas: {
    stripWhitespaceX: true,
    stripWhitespaceY: true,
    rotation: true,
    alias: true,
    ignoreBlankImages: false,
    alphaThreshold: 3,
    minWidth: 16,
    minHeight: 16,
    maxWidth: 2048,
    maxHeight: 2048,
    pot: true,
    multipleOfFour: false,
    square: false,
    outputFormat: 'png',
    jpegQuality: 0.9,
    premultiplyAlpha: false,
    bleed: true,
    scale: [1],
    scaleSuffix: [''],
    scaleResampling: ['bicubic'],
    paddingX: 2,
    paddingY: 2,
    edgePadding: true,
    duplicatePadding: false,
    filterMin: 'Linear',
    filterMag: 'Linear',
    wrapX: 'ClampToEdge',
    wrapY: 'ClampToEdge',
    format: 'RGBA8888',
    atlasExtension: '.atlas',
    combineSubdirectories: false,
    flattenPaths: false,
    useIndexes: false,
    debug: false,
    fast: false,
    limitMemory: true,
    currentProject: true,
    packing: 'polygons',
    prettyPrint: true,
    legacyOutput: false,
    webp: null,
    bleedIterations: 2,
    ignore: false,
    separator: '_',
    silent: false
  } as Record<string, unknown> | null,
  packSource: 'attachments',
  packTarget: 'perskeleton',
  warnings: true,
  version: null,
  output: '',
  forceAll: false,
  input: '',
  open: false
};

export const initialUpdateUi: UpdateUiState = {
  status: 'idle',
  version: '',
  progress: 0,
  progressKnown: false,
  message: ''
};

export const appVersionLabel = `v${__APP_VERSION__}`;

// Public releases page — opened when the user clicks the version label to read the changelog.
export const releasesUrl = 'https://github.com/cuongcuongmanh7/Spine-Forge-X/releases';
