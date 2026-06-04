export type ExportMode = 'perProjectJson' | 'globalJson' | 'builtIn' | 'generatedSettings';
export type FallbackMode = 'builtIn' | 'globalJson' | 'skip';
export type OutputPolicy = 'timestamp' | 'sourceFolderName';
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

export type ExportPreset = {
  name: string;
  path: string;
  builtIn: boolean;
};

export type BatchExportResult = {
  completed: number;
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
};
