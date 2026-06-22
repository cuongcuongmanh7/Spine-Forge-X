export type ExportMode =
  | 'perProjectJson'
  | 'globalJson'
  | 'builtIn'
  | 'generatedSettings'
  | 'lastExportSettings';
export type FallbackMode = 'builtIn' | 'globalJson' | 'skip';
export type OutputPolicy = 'timestamp' | 'sourceFolderName' | 'linkedProject' | 'exportSubfolder';
export type Language = 'vi' | 'en';
export type ThemeMode = 'light' | 'dark';
export type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'upToDate' | 'error';

export type ScanResult = {
  files: string[];
  skipped: string[];
};

export type ValidateResult = {
  ok: boolean;
  warnings: string[];
  errors: string[];
  spineOk?: boolean;
  spineWarning?: boolean;
  outputOk?: boolean;
  outputWarning?: boolean;
};

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export type Toast = {
  id: number;
  message: string;
  kind: ToastKind;
};

export type CleanResult = {
  deleted: string[];
  failed: string[];
};

// ----- Clean Source Folder (v0.2.9) -----

export type ImageEntry = {
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
};

export type FolderScan = {
  folder: string;
  imagesDir: string;
  spineFile: string;
  totalImages: number;
  used: number;
  usedImages: ImageEntry[];
  unused: ImageEntry[];
  unusedBytes: number;
  missing: string[];
  ambiguous: string[];
  error: string | null;
};

export type BatchScanSummary = {
  units: FolderScan[];
  totalUnused: number;
  totalUnusedBytes: number;
};

/** A discovered `.spine` unit, for the pre-scan folder picker (no export). */
export type CleanUnitInfo = {
  folder: string;
  spineFile: string;
};

export type FolderCleanResult = {
  folder: string;
  moved: number;
  backupDir: string | null;
  error: string | null;
};

export type BatchCleanResult = {
  units: FolderCleanResult[];
  totalMoved: number;
  stopped: boolean;
};

export type ExportPreset = {
  name: string;
  path: string;
  builtIn: boolean;
};

export type BatchExportResult = {
  completed: number;
  failed: number;
  skipped: number;
  total: number;
  outputFolders: string[];
  stopped: boolean;
};

export type UpdateUiState = {
  status: UpdateStatus;
  version: string;
  progress: number;
  progressKnown: boolean;
  message: string;
  /** Release notes from the updater manifest, shown when an update is ready. */
  notes?: string;
};
