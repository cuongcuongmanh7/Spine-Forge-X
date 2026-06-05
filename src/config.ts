import type { ExportMode, FallbackMode, OutputPolicy, UpdateUiState } from './types';

/**
 * App-wide configuration — shared across every session. Edited in the Settings popup.
 */
export const defaultAppConfig = {
  spinePath: '',
  parallelJobs: 1,
  maxMemory: '512m',
  timeoutSeconds: 300
};

export type AppConfig = typeof defaultAppConfig;

/**
 * Per-session configuration — every session in the Recents column is fully independent.
 */
export const defaultSessionConfig = {
  inputPath: '',
  inputFiles: [] as string[],
  // Full paths removed from a folder-scan result; re-applied on re-scan so deletions survive restart.
  excludedFiles: [] as string[],
  outputPath: '',
  outputPolicy: 'timestamp' as OutputPolicy,
  // Pass --clean to Spine: wipe each output folder before exporting.
  clean: false,
  // Timestamp policy only: mirror the input path's relative folder structure into the output root.
  preserveRelativePaths: true,
  // For the source-folder policy: shorten the folder name to the token before the
  // first underscore, e.g. "3001_Lucius" -> "3001".
  cleanFolderName: false,
  targetVersion: '4.3.xx',
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
  generatedForceAll: false
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

export type Session = {
  id: string;
  /** Every session belongs to exactly one project. */
  projectId: string;
  name: string;
  /** true until the user renames it — lets a folder pick keep updating the auto name. */
  autoNamed: boolean;
  config: SessionConfig;
  createdAt: number;
  updatedAt: number;
};

/** Per-session readiness shown as a colored dot in the sidebar. */
export type SessionStatus = 'green' | 'yellow' | 'red';

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

export const targetVersionPresets = ['3.8.99', '4.3.11', 'lateststable'];

/** Starting point for a brand-new global preset in the editor (JSON skeleton + packed atlas). */
export const defaultExportPreset = {
  class: 'export-json',
  extension: '.json',
  format: 'JSON',
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
