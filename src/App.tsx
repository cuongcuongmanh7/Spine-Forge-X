import { useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { confirm, message, open } from '@tauri-apps/plugin-dialog';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';
import appIconUrl from '../src-tauri/icons/icon.ico';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleStop,
  FileText,
  FolderOpen,
  Minus,
  Play,
  RotateCw,
  Save,
  Search,
  Settings,
  Terminal,
  Trash2,
  Square,
  X,
  XCircle
} from 'lucide-react';

type ExportMode = 'perProjectJson' | 'globalJson' | 'builtIn' | 'generatedSettings';
type FallbackMode = 'builtIn' | 'globalJson' | 'skip';
type OutputPolicy = 'timestamp' | 'sourceFolderName';
type Language = 'vi' | 'en';
type ThemeMode = 'light' | 'dark';
type TabKey = 'main' | 'settings';
type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'upToDate' | 'error';

type ScanResult = {
  files: string[];
  skipped: string[];
};

type ValidateResult = {
  ok: boolean;
  warnings: string[];
  errors: string[];
};

type CleanResult = {
  deleted: string[];
  failed: string[];
};

type BatchExportResult = {
  completed: number;
  total: number;
  outputFolders: string[];
  stopped: boolean;
};

type SectionProps = {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
};

type FieldStatusProps = {
  ok?: boolean;
  warning?: boolean;
  message: string;
};

type UpdateUiState = {
  status: UpdateStatus;
  version: string;
  progress: number;
  progressKnown: boolean;
};

const targetVersionPresets = ['3.8.99', '4.0.xx', '4.1.xx', '4.2.xx', '4.3.xx', 'lateststable'];
const appVersionLabel = `v${__APP_VERSION__}`;
const initialUpdateUi: UpdateUiState = {
  status: 'idle',
  version: '',
  progress: 0,
  progressKnown: false
};

const defaultState = {
  spinePath: '',
  inputPath: '',
  outputPath: '',
  outputPolicy: 'timestamp' as OutputPolicy,
  targetVersion: '4.3.xx',
  exportMode: 'perProjectJson' as ExportMode,
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
  clean: false,
  parallelJobs: 1,
  maxMemory: '512m',
  timeoutSeconds: 300,
  preserveRelativePaths: true
};

type AppSettings = typeof defaultState;

const copy = {
  vi: {
    subtitle: 'Batch export và nâng cấp version cho Spine project.',
    ready: 'Sẵn sàng',
    needsSetup: 'Cần cấu hình',
    mainTab: 'Chức năng chính',
    settingsTab: 'Cài đặt',
    inputFiles: 'File đầu vào',
    inputPath: 'Input path',
    browseFolder: 'Chọn folder',
    browseFiles: 'Chọn file',
    scan: 'Quét',
    spineFiles: '.spine files',
    skipped: 'bỏ qua',
    remove: 'Xóa',
    outputDirectory: 'Output',
    outputRoot: 'Output root',
    outputPolicy: 'Cơ chế output',
    timestampPolicy: 'Folder timestamp',
    sourceFolderPolicy: 'Folder theo source',
    timestampPolicyHelp: 'Xuất vào folder export_<Spine version>_DDMMYYYY_HHMMSS. Khi có output root, app có thể mirror relative path trước.',
    sourceFolderPolicyHelp: 'Chọn output root tổng; mỗi file xuất vào outputRoot/<tên folder chứa file .spine>, ví dụ outputRoot/4001.',
    outputHelperAuto: 'Để trống: mỗi folder chứa .spine sẽ có folder timestamp riêng.',
    outputHelperSelected: 'Có output root: app mirror cấu trúc từ input path và tạo folder timestamp bên trong.',
    outputHelperSourceFolder: 'Policy này cần output root. Output con được đặt theo tên folder chứa file .spine.',
    browseOutput: 'Chọn output',
    cleanTimestamp: 'Xóa timestamp exports',
    cleanConfirmTitle: 'Xác nhận xóa',
    cleanConfirmBody: 'Xóa tất cả folder export_<version>_DDMMYYYY_HHMMSS trong input path?',
    cleanResultTitle: 'Clean hoàn tất',
    cleanDone: 'Đã xóa timestamp exports',
    cleanFailed: 'Xóa timestamp exports thất bại',
    executable: 'Spine Executable',
    executableNotice: 'Windows CLI nên dùng Spine.com. Spine.exe chỉ là fallback và có thể không chờ process kết thúc.',
    executablePath: 'Executable',
    autoDetect: 'Auto detect',
    exportStrategy: 'Chiến lược export',
    perProjectJson: 'Dùng .export.json cạnh .spine',
    globalJson: 'Ép global .export.json',
    builtIn: 'Built-in export format',
    generatedSettings: 'Tạo export settings',
    generatedSettingsHelp: 'Sinh temp .export.json theo các tuỳ chọn bên dưới. Chỉ dùng khi muốn ép toàn bộ project theo một template chung.',
    generatedFormat: 'Định dạng',
    generatedSkeletonExtension: 'Skeleton extension',
    generatedPackAtlas: 'Pack atlas',
    generatedMaxWidth: 'Atlas max width',
    generatedMaxHeight: 'Atlas max height',
    generatedPremultiplyAlpha: 'Premultiply alpha',
    generatedPot: 'Power of two',
    generatedPaddingX: 'Padding X',
    generatedPaddingY: 'Padding Y',
    generatedSkeleton: 'Skeleton export',
    generatedAtlas: 'Atlas pack',
    generatedPaths: 'Path & output',
    generatedPrettyPrint: 'Pretty print',
    generatedNonessential: 'Nonessential data',
    generatedStripWhitespaceX: 'Strip whitespace X',
    generatedStripWhitespaceY: 'Strip whitespace Y',
    generatedRotation: 'Rotation',
    generatedAlias: 'Alias',
    generatedIgnoreBlankImages: 'Ignore blank images',
    generatedAlphaThreshold: 'Alpha threshold',
    generatedMinWidth: 'Atlas min width',
    generatedMinHeight: 'Atlas min height',
    generatedMultipleOfFour: 'Multiple of four',
    generatedSquare: 'Square',
    generatedOutputFormat: 'Output format',
    generatedJpegQuality: 'JPEG quality',
    generatedBleed: 'Bleed',
    generatedBleedIterations: 'Bleed iterations',
    generatedEdgePadding: 'Edge padding',
    generatedDuplicatePadding: 'Duplicate padding',
    generatedFilterMin: 'Filter min',
    generatedFilterMag: 'Filter mag',
    generatedWrapX: 'Wrap X',
    generatedWrapY: 'Wrap Y',
    generatedTextureFormat: 'Texture format',
    generatedAtlasExtension: 'Atlas extension',
    generatedCombineSubdirectories: 'Combine subdirectories',
    generatedFlattenPaths: 'Flatten paths',
    generatedUseIndexes: 'Use indexes',
    generatedFast: 'Fast',
    generatedLimitMemory: 'Limit memory',
    generatedPacking: 'Packing',
    generatedPackSource: 'Pack source',
    generatedPackTarget: 'Pack target',
    generatedWarnings: 'Warnings',
    generatedForceAll: 'Force all',
    targetVersion: 'Target version',
    detectVersion: 'Detect version',
    builtInExport: 'Built-in export',
    missingJson: 'Thiếu .export.json',
    useBuiltIn: 'Dùng built-in export',
    useGlobalJson: 'Dùng global JSON',
    skipFile: 'Bỏ qua file',
    globalExportJson: 'Global .export.json',
    advancedRuntime: 'Advanced Runtime',
    parallelJobs: 'Parallel jobs',
    maxMemory: 'Max memory',
    timeoutSeconds: 'Timeout seconds',
    cleanAnimation: 'Clean animation',
    preserveRelativePaths: 'Mirror relative folders into output root (chỉ Timestamped export)',
    run: 'Chạy export',
    start: 'Bắt đầu',
    running: 'Đang chạy...',
    stop: 'Dừng',
    openOutput: 'Mở output',
    logResults: 'Log & kết quả',
    conversionLog: 'Conversion Log',
    clear: 'Xóa log',
    save: 'Lưu',
    autoDetectFailed: 'Auto detect thất bại',
    detectedSpine: 'Đã detect Spine executable',
    detectedVersion: 'Đã detect Spine version',
    versionDetectFailed: 'Detect version thất bại',
    inputEmpty: 'Input path đang trống.',
    scanFailed: 'Scan thất bại',
    scanning: 'Đang scan',
    scanned: 'Đã scan',
    starting: 'Bắt đầu batch export',
    finished: 'Batch export hoàn tất.',
    batchFailed: 'Batch export thất bại',
    stopRequested: 'Đã yêu cầu dừng.',
    stopFailed: 'Dừng thất bại',
    openOutputEmpty: 'Chưa có output folder để mở.',
    openOutputFailed: 'Mở output thất bại',
    pendingSave: 'Save log sẽ nối native file dialog ở bước sau.',
    language: 'Ngôn ngữ',
    theme: 'Theme',
    light: 'Light',
    dark: 'Dark',
    exportSuccessTitle: 'Export thành công',
    exportSuccessBody: 'Đã export {completed}/{total} file.',
    exportFailedTitle: 'Export thất bại',
    exportStoppedTitle: 'Export đã dừng',
    exportStoppedBody: 'Đã dừng sau khi export {completed}/{total} file.'
  },
  en: {
    subtitle: 'Batch export and version upgrade workflow for Spine projects.',
    ready: 'Ready',
    needsSetup: 'Needs setup',
    mainTab: 'Main',
    settingsTab: 'Settings',
    inputFiles: 'Input Files',
    inputPath: 'Input path',
    browseFolder: 'Browse Folder',
    browseFiles: 'Browse Files',
    scan: 'Scan',
    spineFiles: '.spine files',
    skipped: 'skipped',
    remove: 'Remove',
    outputDirectory: 'Output',
    outputRoot: 'Output root',
    outputPolicy: 'Policy',
    timestampPolicy: 'Timestamp folder',
    sourceFolderPolicy: 'Source folder',
    timestampPolicyHelp: 'Exports into export_<Spine version>_DDMMYYYY_HHMMSS. With an output root, the app can mirror relative folders first.',
    sourceFolderPolicyHelp: 'Choose one output root; each file exports to outputRoot/<source .spine parent folder name>, for example outputRoot/4001.',
    outputHelperAuto: 'Empty: each source .spine folder gets its own timestamp folder.',
    outputHelperSelected: 'With output root: the app mirrors input folders and creates a timestamp folder inside.',
    outputHelperSourceFolder: 'This policy requires an output root. Child output folders use the parent folder name of each .spine file.',
    browseOutput: 'Browse Output',
    cleanTimestamp: 'Clean timestamp exports',
    cleanConfirmTitle: 'Confirm cleanup',
    cleanConfirmBody: 'Delete all export_<version>_DDMMYYYY_HHMMSS folders under the input path?',
    cleanResultTitle: 'Cleanup finished',
    cleanDone: 'Cleaned timestamp exports',
    cleanFailed: 'Clean timestamp exports failed',
    executable: 'Spine Executable',
    executableNotice: 'On Windows CLI, prefer Spine.com. Spine.exe is only a fallback and may not wait for process completion.',
    executablePath: 'Executable',
    autoDetect: 'Auto detect',
    exportStrategy: 'Export Strategy',
    perProjectJson: 'Use .export.json next to .spine',
    globalJson: 'Force global .export.json',
    builtIn: 'Built-in export format',
    generatedSettings: 'Generated export settings',
    generatedSettingsHelp: 'Creates a temporary .export.json from the options below. Use only when all projects should share one template.',
    generatedFormat: 'Format',
    generatedSkeletonExtension: 'Skeleton extension',
    generatedPackAtlas: 'Pack atlas',
    generatedMaxWidth: 'Atlas max width',
    generatedMaxHeight: 'Atlas max height',
    generatedPremultiplyAlpha: 'Premultiply alpha',
    generatedPot: 'Power of two',
    generatedPaddingX: 'Padding X',
    generatedPaddingY: 'Padding Y',
    generatedSkeleton: 'Skeleton export',
    generatedAtlas: 'Atlas pack',
    generatedPaths: 'Path & output',
    generatedPrettyPrint: 'Pretty print',
    generatedNonessential: 'Nonessential data',
    generatedStripWhitespaceX: 'Strip whitespace X',
    generatedStripWhitespaceY: 'Strip whitespace Y',
    generatedRotation: 'Rotation',
    generatedAlias: 'Alias',
    generatedIgnoreBlankImages: 'Ignore blank images',
    generatedAlphaThreshold: 'Alpha threshold',
    generatedMinWidth: 'Atlas min width',
    generatedMinHeight: 'Atlas min height',
    generatedMultipleOfFour: 'Multiple of four',
    generatedSquare: 'Square',
    generatedOutputFormat: 'Output format',
    generatedJpegQuality: 'JPEG quality',
    generatedBleed: 'Bleed',
    generatedBleedIterations: 'Bleed iterations',
    generatedEdgePadding: 'Edge padding',
    generatedDuplicatePadding: 'Duplicate padding',
    generatedFilterMin: 'Filter min',
    generatedFilterMag: 'Filter mag',
    generatedWrapX: 'Wrap X',
    generatedWrapY: 'Wrap Y',
    generatedTextureFormat: 'Texture format',
    generatedAtlasExtension: 'Atlas extension',
    generatedCombineSubdirectories: 'Combine subdirectories',
    generatedFlattenPaths: 'Flatten paths',
    generatedUseIndexes: 'Use indexes',
    generatedFast: 'Fast',
    generatedLimitMemory: 'Limit memory',
    generatedPacking: 'Packing',
    generatedPackSource: 'Pack source',
    generatedPackTarget: 'Pack target',
    generatedWarnings: 'Warnings',
    generatedForceAll: 'Force all',
    targetVersion: 'Target version',
    detectVersion: 'Detect version',
    builtInExport: 'Built-in export',
    missingJson: 'Missing .export.json',
    useBuiltIn: 'Use built-in export',
    useGlobalJson: 'Use global JSON',
    skipFile: 'Skip file',
    globalExportJson: 'Global .export.json',
    advancedRuntime: 'Advanced Runtime',
    parallelJobs: 'Parallel jobs',
    maxMemory: 'Max memory',
    timeoutSeconds: 'Timeout seconds',
    cleanAnimation: 'Clean animation',
    preserveRelativePaths: 'Mirror relative folders into output root (Timestamped export only)',
    run: 'Run',
    start: 'Start',
    running: 'Running...',
    stop: 'Stop',
    openOutput: 'Open Output',
    logResults: 'Log & Results',
    conversionLog: 'Conversion Log',
    clear: 'Clear',
    save: 'Save',
    autoDetectFailed: 'Auto detect failed',
    detectedSpine: 'Detected Spine executable',
    detectedVersion: 'Detected Spine version',
    versionDetectFailed: 'Version detect failed',
    inputEmpty: 'Input path is empty.',
    scanFailed: 'Scan failed',
    scanning: 'Scanning',
    scanned: 'Scanned',
    starting: 'Starting batch export',
    finished: 'Batch export finished.',
    batchFailed: 'Batch export failed',
    stopRequested: 'Stop requested.',
    stopFailed: 'Stop failed',
    openOutputEmpty: 'No output folder is available yet.',
    openOutputFailed: 'Open output failed',
    pendingSave: 'Save log is pending native file integration.',
    language: 'Language',
    theme: 'Theme',
    light: 'Light',
    dark: 'Dark',
    exportSuccessTitle: 'Export completed',
    exportSuccessBody: 'Exported {completed}/{total} files.',
    exportFailedTitle: 'Export failed',
    exportStoppedTitle: 'Export stopped',
    exportStoppedBody: 'Stopped after exporting {completed}/{total} files.'
  }
};

function readStoredLanguage(): Language {
  return localStorage.getItem('spineforge.language') === 'en' ? 'en' : 'vi';
}

function readStoredTheme(): ThemeMode {
  const stored = localStorage.getItem('spineforge.theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readStoredSettings(): AppSettings {
  const stored = localStorage.getItem('spineforge.settings');
  if (!stored) return defaultState;

  try {
    const parsed = { ...defaultState, ...JSON.parse(stored) } as AppSettings;
    if ((parsed.exportMode as string) === 'internalExperimental') {
      parsed.exportMode = 'perProjectJson';
    }
    return parsed;
  } catch {
    return defaultState;
  }
}

function Section({ title, defaultOpen = true, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="section">
      <button className="section-header" onClick={() => setOpen((value) => !value)}>
        <span>{title}</span>
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
      </button>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

function FieldStatus({ ok, warning, message }: FieldStatusProps) {
  if (ok) {
    return (
      <span className="field-status ok" title={message}>
        <CheckCircle2 size={18} />
      </span>
    );
  }

  if (warning) {
    return (
      <span className="field-status warning" title={message}>
        <AlertTriangle size={18} />
      </span>
    );
  }

  return (
    <span className="field-status error" title={message}>
      <XCircle size={18} />
    </span>
  );
}

function App() {
  const [language, setLanguage] = useState<Language>(readStoredLanguage);
  const [theme, setTheme] = useState<ThemeMode>(readStoredTheme);
  const [activeTab, setActiveTab] = useState<TabKey>('main');
  const [settings, setSettings] = useState(readStoredSettings);
  const [targetVersions, setTargetVersions] = useState<string[]>(targetVersionPresets);
  const [files, setFiles] = useState<string[]>([]);
  const [skippedFiles, setSkippedFiles] = useState<string[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [lastOutputFolders, setLastOutputFolders] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isChoosingInputFolder, setIsChoosingInputFolder] = useState(false);
  const [isChoosingInputFiles, setIsChoosingInputFiles] = useState(false);
  const [isChoosingOutputFolder, setIsChoosingOutputFolder] = useState(false);
  const [isCleaningTimestamp, setIsCleaningTimestamp] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isOpeningOutput, setIsOpeningOutput] = useState(false);
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);
  const [isDetectingVersion, setIsDetectingVersion] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [validation, setValidation] = useState<ValidateResult>({ ok: false, warnings: [], errors: [] });
  const [updateUi, setUpdateUi] = useState<UpdateUiState>(initialUpdateUi);
  const pendingUpdateRef = useRef<Update | null>(null);
  const updateStatusTimerRef = useRef<number | null>(null);

  const t = copy[language];
  const progress = files.length === 0 ? 0 : Math.round((currentIndex / files.length) * 100);
  const currentFile = files[Math.max(0, currentIndex - 1)] ?? '';
  const canStart = useMemo(() => validation.ok && files.length > 0 && !isRunning, [files.length, isRunning, validation.ok]);
  const appWindow = getCurrentWindow();
  const outputRootMissingForSourceFolder = settings.outputPolicy === 'sourceFolderName' && !settings.outputPath.trim();
  const outputHelper =
    settings.outputPolicy === 'sourceFolderName'
      ? t.outputHelperSourceFolder
      : settings.outputPath
        ? t.outputHelperSelected
        : t.outputHelperAuto;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('spineforge.theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('spineforge.language', language);
  }, [language]);

  useEffect(() => {
    localStorage.setItem('spineforge.settings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    const unlisten = Promise.all([
      listen<string>('spine-log', (event) => appendLog(event.payload)),
      listen<string>('spine-error', (event) => appendLog(`[ERROR] ${event.payload}`)),
      listen<{ current: number; total: number; file: string }>('spine-progress', (event) => {
        setCurrentIndex(event.payload.current);
        appendLog(`[PROGRESS] ${event.payload.current}/${event.payload.total} ${event.payload.file}`);
      })
    ]);

    return () => {
      unlisten.then((callbacks) => callbacks.forEach((callback) => callback()));
    };
  }, []);

  useEffect(() => {
    void validateSettings();
  }, [settings.spinePath, settings.outputPath, settings.outputPolicy, settings.exportMode, settings.globalJsonPath]);

  useEffect(() => {
    void autoDetectSpine(true);
  }, []);

  useEffect(() => {
    void checkForAppUpdate();
  }, []);

  useEffect(() => {
    return () => {
      if (updateStatusTimerRef.current !== null) {
        window.clearTimeout(updateStatusTimerRef.current);
      }
    };
  }, []);

  function appendLog(message: string) {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((items) => [...items, `${timestamp} - ${message}`]);
  }

  function showTemporaryUpdateStatus(status: UpdateStatus, durationMs = 3000) {
    if (updateStatusTimerRef.current !== null) {
      window.clearTimeout(updateStatusTimerRef.current);
    }

    setUpdateUi({ ...initialUpdateUi, status });
    updateStatusTimerRef.current = window.setTimeout(() => {
      setUpdateUi(initialUpdateUi);
      updateStatusTimerRef.current = null;
    }, durationMs);
  }

  async function checkForAppUpdate(manual = false) {
    try {
      setUpdateUi((current) => ({ ...current, status: 'checking' }));
      const update = await check({ timeout: 30000 });
      if (!update) {
        if (manual) {
          showTemporaryUpdateStatus('upToDate');
        } else {
          setUpdateUi(initialUpdateUi);
        }
        return;
      }

      pendingUpdateRef.current = update;
      let downloaded = 0;
      let contentLength = 0;

      setUpdateUi({
        status: 'downloading',
        version: update.version,
        progress: 0,
        progressKnown: false
      });

      await update.download((event: DownloadEvent) => {
        if (event.event === 'Started') {
          downloaded = 0;
          contentLength = event.data.contentLength ?? 0;
          setUpdateUi({
            status: 'downloading',
            version: update.version,
            progress: 0,
            progressKnown: contentLength > 0
          });
          return;
        }

        if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          const progress = contentLength > 0 ? Math.min(100, Math.round((downloaded / contentLength) * 100)) : 0;
          setUpdateUi({
            status: 'downloading',
            version: update.version,
            progress,
            progressKnown: contentLength > 0
          });
          return;
        }

        setUpdateUi({
          status: 'ready',
          version: update.version,
          progress: 100,
          progressKnown: true
        });
      });
    } catch (error) {
      pendingUpdateRef.current = null;
      console.warn('Update check failed:', error);
      setUpdateUi(initialUpdateUi);
    }
  }

  async function installPendingUpdate() {
    const update = pendingUpdateRef.current;
    if (!update) return;

    try {
      await update.install();
      await relaunch();
    } catch (error) {
      setUpdateUi({ ...initialUpdateUi, status: 'error' });
      appendLog(`Update install failed: ${String(error)}`);
    }
  }

  function updateSetting<K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function updateInputPath(value: string) {
    updateSetting('inputPath', value);
    if (!value.trim()) {
      setFiles([]);
      setSkippedFiles([]);
      setCurrentIndex(0);
    }
  }

  function updateOutputPath(value: string) {
    updateSetting('outputPath', value);
    if (!value.trim()) {
      setLastOutputFolders([]);
    }
  }

  function updateGeneratedFormat(value: string) {
    setSettings((current) => ({
      ...current,
      generatedFormat: value,
      generatedSkeletonExtension: value === 'binary' ? '.skel' : '.json'
    }));
  }

  function addTargetVersion(version: string) {
    setTargetVersions((versions) => (versions.includes(version) ? versions : [version, ...versions]));
    updateSetting('targetVersion', version);
  }

  async function detectVersion(spinePath = settings.spinePath) {
    if (isDetectingVersion) return;
    if (!spinePath.trim()) {
      appendLog(`${t.versionDetectFailed}: Spine executable path is empty.`);
      return;
    }

    setIsDetectingVersion(true);
    try {
      const version = await invoke<string>('detect_spine_version', { spinePath });
      addTargetVersion(version);
      appendLog(`${t.detectedVersion}: ${version}`);
    } catch (error) {
      appendLog(`${t.versionDetectFailed}: ${String(error)}`);
    } finally {
      setIsDetectingVersion(false);
    }
  }

  async function autoDetectSpine(silent = false) {
    if (isAutoDetecting) return;
    setIsAutoDetecting(true);
    try {
      const detected = await invoke<string>('auto_detect_spine');
      updateSetting('spinePath', detected);
      appendLog(`${t.detectedSpine}: ${detected}`);
      await detectVersion(detected);
    } catch (error) {
      if (!silent) appendLog(`${t.autoDetectFailed}: ${String(error)}`);
    } finally {
      setIsAutoDetecting(false);
    }
  }

  async function scanPath(inputPath: string) {
    const result = await invoke<ScanResult>('scan_spine_files', { inputPath });
    setFiles(result.files);
    setSkippedFiles(result.skipped);
    setCurrentIndex(0);
    appendLog(`${t.scanned} ${result.files.length} Spine files. ${t.skipped}: ${result.skipped.length}.`);
  }

  async function scanInput() {
    if (isScanning) return;
    if (!settings.inputPath.trim()) {
      appendLog(t.inputEmpty);
      return;
    }

    setIsScanning(true);
    appendLog(`${t.scanning}: ${settings.inputPath}`);
    try {
      await scanPath(settings.inputPath);
    } catch (error) {
      appendLog(`${t.scanFailed}: ${String(error)}`);
    } finally {
      setIsScanning(false);
    }
  }

  async function chooseInputFolder() {
    if (isChoosingInputFolder || isScanning) return;
    setIsChoosingInputFolder(true);

    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t.browseFolder
      });

      if (typeof selected !== 'string') return;
      updateInputPath(selected);

      setIsScanning(true);
      appendLog(`${t.scanning}: ${selected}`);
      await scanPath(selected);
    } catch (error) {
      appendLog(`${t.scanFailed}: ${String(error)}`);
    } finally {
      setIsScanning(false);
      setIsChoosingInputFolder(false);
    }
  }

  async function chooseInputFiles() {
    if (isChoosingInputFiles) return;
    setIsChoosingInputFiles(true);

    try {
      const selected = await open({
        directory: false,
        multiple: true,
        title: t.browseFiles,
        filters: [{ name: 'Spine Project', extensions: ['spine'] }]
      });

      if (!Array.isArray(selected)) return;
      const spineFiles = selected.filter((path) => path.toLowerCase().endsWith('.spine'));
      setFiles((items) => Array.from(new Set([...items, ...spineFiles])).sort());
      setSkippedFiles([]);
      setCurrentIndex(0);
      appendLog(`${t.scanned} ${spineFiles.length} Spine files.`);
    } finally {
      setIsChoosingInputFiles(false);
    }
  }

  async function chooseOutputFolder() {
    if (isChoosingOutputFolder) return;
    setIsChoosingOutputFolder(true);

    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t.browseOutput
      });

      if (typeof selected !== 'string') return;
      updateOutputPath(selected);
    } finally {
      setIsChoosingOutputFolder(false);
    }
  }

  async function cleanTimestampExports() {
    if (isCleaningTimestamp) return;
    if (!settings.inputPath.trim()) {
      appendLog(t.inputEmpty);
      return;
    }

    setIsCleaningTimestamp(true);
    try {
      const accepted = await confirm(t.cleanConfirmBody, { title: t.cleanConfirmTitle, kind: 'warning' });
      if (!accepted) return;

      const result = await invoke<CleanResult>('clean_timestamp_exports', { inputPath: settings.inputPath });
      const body = `${t.cleanDone}: ${result.deleted.length}. Failed: ${result.failed.length}.`;
      appendLog(body);
      result.failed.forEach((item) => appendLog(`[CLEAN FAILED] ${item}`));
      await message(body, { title: t.cleanResultTitle, kind: result.failed.length ? 'warning' : 'info' });
    } catch (error) {
      const body = String(error);
      appendLog(`${t.cleanFailed}: ${body}`);
      await message(body, { title: t.cleanFailed, kind: 'error' });
    } finally {
      setIsCleaningTimestamp(false);
    }
  }

  async function validateSettings() {
    try {
      const result = await invoke<ValidateResult>('validate_settings', {
        spinePath: settings.spinePath,
        outputPath: settings.outputPath,
        outputPolicy: settings.outputPolicy,
        exportMode: settings.exportMode,
        globalJsonPath: settings.globalJsonPath
      });
      setValidation(result);
    } catch (error) {
      setValidation({ ok: false, warnings: [], errors: [String(error)] });
    }
  }

  async function startExport() {
    if (!canStart || isRunning) return;

    setIsRunning(true);
    setCurrentIndex(0);
    appendLog(`${t.starting}: ${files.length} files.`);

    try {
      const result = await invoke<BatchExportResult>('start_batch_export', {
        request: {
          spinePath: settings.spinePath,
          inputRoot: settings.inputPath,
          files,
          outputPath: settings.outputPath,
          outputPolicy: settings.outputPolicy,
          targetVersion: settings.targetVersion,
          exportMode: settings.exportMode,
          fallbackMode: settings.fallbackMode,
          globalJsonPath: settings.globalJsonPath || null,
          builtInExport: settings.builtInExport,
          generatedFormat: settings.generatedFormat,
          generatedSkeletonExtension: settings.generatedSkeletonExtension,
          generatedPackAtlas: settings.generatedPackAtlas,
          generatedMaxWidth: settings.generatedMaxWidth,
          generatedMaxHeight: settings.generatedMaxHeight,
          generatedPremultiplyAlpha: settings.generatedPremultiplyAlpha,
          generatedPot: settings.generatedPot,
          generatedPaddingX: settings.generatedPaddingX,
          generatedPaddingY: settings.generatedPaddingY,
          generatedPrettyPrint: settings.generatedPrettyPrint,
          generatedNonessential: settings.generatedNonessential,
          generatedStripWhitespaceX: settings.generatedStripWhitespaceX,
          generatedStripWhitespaceY: settings.generatedStripWhitespaceY,
          generatedRotation: settings.generatedRotation,
          generatedAlias: settings.generatedAlias,
          generatedIgnoreBlankImages: settings.generatedIgnoreBlankImages,
          generatedAlphaThreshold: settings.generatedAlphaThreshold,
          generatedMinWidth: settings.generatedMinWidth,
          generatedMinHeight: settings.generatedMinHeight,
          generatedMultipleOfFour: settings.generatedMultipleOfFour,
          generatedSquare: settings.generatedSquare,
          generatedOutputFormat: settings.generatedOutputFormat,
          generatedJpegQuality: settings.generatedJpegQuality,
          generatedBleed: settings.generatedBleed,
          generatedBleedIterations: settings.generatedBleedIterations,
          generatedEdgePadding: settings.generatedEdgePadding,
          generatedDuplicatePadding: settings.generatedDuplicatePadding,
          generatedFilterMin: settings.generatedFilterMin,
          generatedFilterMag: settings.generatedFilterMag,
          generatedWrapX: settings.generatedWrapX,
          generatedWrapY: settings.generatedWrapY,
          generatedTextureFormat: settings.generatedTextureFormat,
          generatedAtlasExtension: settings.generatedAtlasExtension,
          generatedCombineSubdirectories: settings.generatedCombineSubdirectories,
          generatedFlattenPaths: settings.generatedFlattenPaths,
          generatedUseIndexes: settings.generatedUseIndexes,
          generatedFast: settings.generatedFast,
          generatedLimitMemory: settings.generatedLimitMemory,
          generatedPacking: settings.generatedPacking,
          generatedPackSource: settings.generatedPackSource,
          generatedPackTarget: settings.generatedPackTarget,
          generatedWarnings: settings.generatedWarnings,
          generatedForceAll: settings.generatedForceAll,
          clean: settings.clean,
          parallelJobs: settings.parallelJobs,
          maxMemory: settings.maxMemory,
          timeoutSeconds: settings.timeoutSeconds,
          preserveRelativePaths: settings.preserveRelativePaths
        }
      });
      setLastOutputFolders(result.outputFolders);
      if (result.stopped) {
        const body = formatMessage(t.exportStoppedBody, result.completed, result.total);
        appendLog(body);
        await message(body, { title: t.exportStoppedTitle, kind: 'warning' });
      } else {
        const body = formatMessage(t.exportSuccessBody, result.completed, result.total);
        appendLog(t.finished);
        await message(body, { title: t.exportSuccessTitle, kind: 'info' });
      }
    } catch (error) {
      const body = String(error);
      appendLog(`${t.batchFailed}: ${body}`);
      await message(body, { title: t.exportFailedTitle, kind: 'error' });
    } finally {
      setIsRunning(false);
    }
  }

  async function stopExport() {
    if (isStopping) return;
    setIsStopping(true);
    try {
      await invoke('stop_batch_export');
      appendLog(t.stopRequested);
    } catch (error) {
      appendLog(`${t.stopFailed}: ${String(error)}`);
    } finally {
      setIsStopping(false);
    }
  }

  function removeFile(path: string) {
    setFiles((items) => items.filter((item) => item !== path));
  }

  function formatMessage(template: string, completed: number, total: number) {
    return template.replace('{completed}', String(completed)).replace('{total}', String(total));
  }

  async function openOutputFolder() {
    if (isOpeningOutput) return;
    const target = resolveOpenOutputTarget();
    if (!target) {
      appendLog(t.openOutputEmpty);
      return;
    }

    setIsOpeningOutput(true);
    try {
      await invoke('open_path', { path: target });
    } catch (error) {
      appendLog(`${t.openOutputFailed}: ${String(error)}`);
    } finally {
      setIsOpeningOutput(false);
    }
  }

  function resolveOpenOutputTarget() {
    if (lastOutputFolders.length === 1) return lastOutputFolders[0];
    if (lastOutputFolders.length > 1 && settings.outputPath.trim()) return settings.outputPath;
    if (lastOutputFolders.length > 0) return lastOutputFolders[0];
    if (settings.outputPath.trim()) return settings.outputPath;
    return settings.inputPath.trim() || '';
  }

  return (
    <div className="window-frame">
      <div className="custom-titlebar">
        <div
          className="titlebar-drag-zone"
          onMouseDown={() => void appWindow.startDragging()}
          onDoubleClick={() => void appWindow.toggleMaximize()}
        >
          <div className="titlebar-brand">
            <img className="titlebar-mark" src={appIconUrl} alt="" aria-hidden="true" />
            <span>SpineForge X</span>
            <span className="titlebar-version">{appVersionLabel}</span>
            <button
              className="titlebar-update-check"
              title="Check for update"
              disabled={updateUi.status === 'checking' || updateUi.status === 'downloading' || updateUi.status === 'ready'}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => void checkForAppUpdate(true)}
            >
              <RotateCw className={updateUi.status === 'checking' ? 'spin' : undefined} size={13} />
            </button>
            {updateUi.status === 'upToDate' && <span className="titlebar-update-note">Up to date</span>}
            {updateUi.status === 'downloading' && (
              <span className="titlebar-update" title={`Downloading new version (v${updateUi.version})`}>
                <span>Downloading new version (v{updateUi.version})</span>
                <progress value={updateUi.progressKnown ? updateUi.progress : undefined} max={100} />
                <span>{updateUi.progressKnown ? `${updateUi.progress}%` : '...'}</span>
              </span>
            )}
            {updateUi.status === 'ready' && (
              <button
                className="titlebar-update-button"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => void installPendingUpdate()}
              >
                Relaunch for v{updateUi.version}
              </button>
            )}
          </div>
        </div>
        <div className="titlebar-controls">
          <button title="Minimize" onClick={() => void appWindow.minimize()}>
            <Minus size={15} />
          </button>
          <button title="Maximize" onClick={() => void appWindow.toggleMaximize()}>
            <Square size={13} />
          </button>
          <button className="close" title="Close" onClick={() => void appWindow.close()}>
            <X size={16} />
          </button>
        </div>
      </div>

      <main className="app-shell">
        <div className="app-sticky-head">
          <header className="app-header">
            <div>
              <h1>SpineForge X</h1>
              <p>{t.subtitle}</p>
            </div>
            <div className={`status-pill ${validation.ok ? 'ready' : 'needs-setup'}`}>
              {validation.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              {validation.ok ? t.ready : t.needsSetup}
            </div>
          </header>

          <nav className="tab-bar">
            <button className={activeTab === 'main' ? 'active' : ''} onClick={() => setActiveTab('main')}>
              <Play size={16} />
              {t.mainTab}
            </button>
            <button className={activeTab === 'settings' ? 'active' : ''} onClick={() => setActiveTab('settings')}>
              <Settings size={16} />
              {t.settingsTab}
            </button>
          </nav>
        </div>

        {activeTab === 'main' && (
          <div className="tab-panel">
            <Section title={t.inputFiles}>
              <div className="form-row">
                <label>{t.inputPath}</label>
                <input
                  value={settings.inputPath}
                  onChange={(event) => updateInputPath(event.target.value)}
                  placeholder="D:\Project\SpineAssets"
                />
                <button className="icon-button" title={t.browseFolder} disabled={isChoosingInputFolder || isScanning} onClick={chooseInputFolder}>
                  {isChoosingInputFolder ? <RotateCw className="spin" size={18} /> : <FolderOpen size={18} />}
                </button>
                <button className="icon-button" title={t.scan} disabled={isScanning || !settings.inputPath.trim()} onClick={scanInput}>
                  <RotateCw className={isScanning ? 'spin' : undefined} size={18} />
                </button>
              </div>
              <div className="button-row offset-row">
                <button className="secondary-button" disabled={isChoosingInputFolder || isScanning} onClick={chooseInputFolder}>
                  {isChoosingInputFolder ? <RotateCw className="spin" size={18} /> : <FolderOpen size={18} />}
                  {t.browseFolder}
                </button>
                <button className="secondary-button" disabled={isChoosingInputFiles} onClick={chooseInputFiles}>
                  {isChoosingInputFiles ? <RotateCw className="spin" size={18} /> : <FileText size={18} />}
                  {t.browseFiles}
                </button>
              </div>
              <div className="file-summary">
                <span>{files.length} {t.spineFiles}</span>
                <span>{skippedFiles.length} {t.skipped}</span>
              </div>
              {files.length > 0 && (
                <div className="file-list">
                  {files.map((file) => (
                    <div className="file-item" key={file}>
                      <FileText size={16} />
                      <span title={file}>{file}</span>
                      <button className="ghost-icon" title={t.remove} onClick={() => removeFile(file)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title={t.outputDirectory}>
              <div className="form-row">
                <label>{t.outputRoot}</label>
                <input
                  className={outputRootMissingForSourceFolder ? 'field-invalid' : undefined}
                  value={settings.outputPath}
                  onChange={(event) => updateOutputPath(event.target.value)}
                  placeholder="Optional: D:\Project\Output"
                />
                <FieldStatus
                  ok={Boolean(settings.outputPath.trim())}
                  warning={!settings.outputPath.trim() && !outputRootMissingForSourceFolder}
                  message={outputHelper}
                />
                <button className="icon-button" title={t.browseOutput} disabled={isChoosingOutputFolder} onClick={chooseOutputFolder}>
                  {isChoosingOutputFolder ? <RotateCw className="spin" size={18} /> : <FolderOpen size={18} />}
                </button>
              </div>
              <div className="form-row">
                <label>{t.outputPolicy}</label>
                <div className="mode-grid output-policy-grid">
                  {([
                    ['timestamp', t.timestampPolicy, t.timestampPolicyHelp],
                    ['sourceFolderName', t.sourceFolderPolicy, t.sourceFolderPolicyHelp]
                  ] as [OutputPolicy, string, string][]).map(([value, label, description]) => (
                    <label className="mode-option detailed" key={value}>
                      <input
                        type="radio"
                        checked={settings.outputPolicy === value}
                        onChange={() => updateSetting('outputPolicy', value)}
                      />
                      <span className="mode-option-content">
                        <strong>{label}</strong>
                        <small>{description}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <p className="helper-text">{outputHelper}</p>
            </Section>

            <Section title={t.run}>
              {validation.errors.length > 0 && (
                <div className="notice danger">
                  <XCircle size={18} />
                  <span>{validation.errors.join(' ')}</span>
                </div>
              )}
              {validation.warnings.length > 0 && (
                <div className="notice warning">
                  <AlertTriangle size={18} />
                  <span>{validation.warnings.join(' ')}</span>
                </div>
              )}
              <div className="run-actions">
                <button className="primary-button" disabled={!canStart || isRunning} onClick={startExport}>
                  {isRunning ? <RotateCw className="spin" size={18} /> : <Play size={18} />}
                  {isRunning ? t.running : t.start}
                </button>
                <button className="secondary-button" disabled={!isRunning || isStopping} onClick={stopExport}>
                  {isStopping ? <RotateCw className="spin" size={18} /> : <CircleStop size={18} />}
                  {t.stop}
                </button>
                <button className="secondary-button" disabled={!resolveOpenOutputTarget() || isOpeningOutput} onClick={openOutputFolder}>
                  {isOpeningOutput ? <RotateCw className="spin" size={18} /> : <FolderOpen size={18} />}
                  {t.openOutput}
                </button>
                <button className="secondary-button" disabled={!settings.inputPath || isCleaningTimestamp} onClick={cleanTimestampExports}>
                  {isCleaningTimestamp ? <RotateCw className="spin" size={18} /> : <Trash2 size={18} />}
                  {t.cleanTimestamp}
                </button>
              </div>
              <div className="progress-row">
                <progress value={progress} max={100} />
                <span>{currentIndex} / {files.length}</span>
              </div>
              {currentFile && <div className="current-file">{currentFile}</div>}
            </Section>

            <Section title={t.logResults} defaultOpen>
              <div className="log-toolbar">
                <span><Terminal size={16} /> {t.conversionLog}</span>
                <div>
                  <button className="ghost-button" onClick={() => setLogs([])}>{t.clear}</button>
                  <button className="ghost-button" onClick={() => appendLog(t.pendingSave)}>
                    <Save size={14} />
                    {t.save}
                  </button>
                </div>
              </div>
              <pre className="log-view">{logs.join('\n')}</pre>
            </Section>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="tab-panel">
            <Section title={t.settingsTab}>
              <div className="header-controls settings-controls">
                <label className="segmented-label">
                  <span>{t.language}</span>
                  <span className="segmented-control">
                    <button className={language === 'vi' ? 'active' : ''} onClick={() => setLanguage('vi')}>VI</button>
                    <button className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')}>EN</button>
                  </span>
                </label>
                <label className="segmented-label">
                  <span>{t.theme}</span>
                  <span className="segmented-control">
                    <button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}>{t.light}</button>
                    <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>{t.dark}</button>
                  </span>
                </label>
              </div>
            </Section>

            <Section title={t.executable}>
              <div className="notice warning">
                <AlertTriangle size={18} />
                <span>{t.executableNotice}</span>
              </div>
              <div className="form-row">
                <label>{t.executablePath}</label>
                <input
                  value={settings.spinePath}
                  onChange={(event) => updateSetting('spinePath', event.target.value)}
                  placeholder="C:\Program Files\Spine\Spine.com"
                />
                <FieldStatus ok={Boolean(settings.spinePath) && validation.errors.length === 0} message="Spine executable path" />
                <button className="icon-button" title={t.autoDetect} disabled={isAutoDetecting} onClick={() => autoDetectSpine(false)}>
                  {isAutoDetecting ? <RotateCw className="spin" size={18} /> : <Search size={18} />}
                </button>
              </div>
            </Section>

            <Section title={t.exportStrategy}>
              <div className="mode-grid">
                {([
                  ['perProjectJson', t.perProjectJson],
                  ['globalJson', t.globalJson],
                  ['builtIn', t.builtIn],
                  ['generatedSettings', t.generatedSettings]
                ] as [ExportMode, string][]).map(([value, label]) => (
                  <label className="mode-option" key={value}>
                    <input
                      type="radio"
                      checked={settings.exportMode === value}
                      onChange={() => updateSetting('exportMode', value)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              {settings.exportMode === 'generatedSettings' && (
                <>
                  <div className="notice warning">
                    <AlertTriangle size={18} />
                    <span>{t.generatedSettingsHelp}</span>
                  </div>
                  <div className="generated-settings-grid">
                    <h3>{t.generatedSkeleton}</h3>
                    <div className="form-grid">
                      <label>
                        {t.generatedFormat}
                        <select value={settings.generatedFormat} onChange={(event) => updateGeneratedFormat(event.target.value)}>
                          <option value="json">JSON</option>
                          <option value="binary">Binary</option>
                        </select>
                      </label>
                      <label>
                        {t.generatedSkeletonExtension}
                        <select value={settings.generatedSkeletonExtension} onChange={(event) => updateSetting('generatedSkeletonExtension', event.target.value)}>
                          {settings.generatedFormat === 'binary' ? (
                            <>
                              <option value=".skel">.skel</option>
                              <option value=".skel.bytes">.skel.bytes</option>
                            </>
                          ) : (
                            <option value=".json">.json</option>
                          )}
                        </select>
                      </label>
                      <label className="checkbox-line">
                        <input type="checkbox" checked={settings.generatedPrettyPrint} onChange={(event) => updateSetting('generatedPrettyPrint', event.target.checked)} />
                        {t.generatedPrettyPrint}
                      </label>
                      <label className="checkbox-line">
                        <input type="checkbox" checked={settings.generatedNonessential} onChange={(event) => updateSetting('generatedNonessential', event.target.checked)} />
                        {t.generatedNonessential}
                      </label>
                      <label className="checkbox-line">
                        <input type="checkbox" checked={settings.clean} onChange={(event) => updateSetting('clean', event.target.checked)} />
                        {t.cleanAnimation}
                      </label>
                      <label className="checkbox-line">
                        <input type="checkbox" checked={settings.generatedWarnings} onChange={(event) => updateSetting('generatedWarnings', event.target.checked)} />
                        {t.generatedWarnings}
                      </label>
                      <label className="checkbox-line">
                        <input type="checkbox" checked={settings.generatedForceAll} onChange={(event) => updateSetting('generatedForceAll', event.target.checked)} />
                        {t.generatedForceAll}
                      </label>
                    </div>

                    <h3>{t.generatedAtlas}</h3>
                    <div className="form-grid">
                      <label className="checkbox-line">
                        <input type="checkbox" checked={settings.generatedPackAtlas} onChange={(event) => updateSetting('generatedPackAtlas', event.target.checked)} />
                        {t.generatedPackAtlas}
                      </label>
                      <label>
                        {t.generatedMaxWidth}
                        <select value={settings.generatedMaxWidth} onChange={(event) => updateSetting('generatedMaxWidth', Number(event.target.value))}>
                          {[512, 1024, 2048, 4096].map((value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                      </label>
                      <label>
                        {t.generatedMaxHeight}
                        <select value={settings.generatedMaxHeight} onChange={(event) => updateSetting('generatedMaxHeight', Number(event.target.value))}>
                          {[512, 1024, 2048, 4096].map((value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                      </label>
                      <label>
                        {t.generatedMinWidth}
                        <input type="number" min={1} value={settings.generatedMinWidth} onChange={(event) => updateSetting('generatedMinWidth', Number(event.target.value))} />
                      </label>
                      <label>
                        {t.generatedMinHeight}
                        <input type="number" min={1} value={settings.generatedMinHeight} onChange={(event) => updateSetting('generatedMinHeight', Number(event.target.value))} />
                      </label>
                      <label>
                        {t.generatedPaddingX}
                        <input type="number" min={0} value={settings.generatedPaddingX} onChange={(event) => updateSetting('generatedPaddingX', Number(event.target.value))} />
                      </label>
                      <label>
                        {t.generatedPaddingY}
                        <input type="number" min={0} value={settings.generatedPaddingY} onChange={(event) => updateSetting('generatedPaddingY', Number(event.target.value))} />
                      </label>
                      <label>
                        {t.generatedAlphaThreshold}
                        <input type="number" min={0} max={255} value={settings.generatedAlphaThreshold} onChange={(event) => updateSetting('generatedAlphaThreshold', Number(event.target.value))} />
                      </label>
                      <label>
                        {t.generatedBleedIterations}
                        <input type="number" min={0} value={settings.generatedBleedIterations} onChange={(event) => updateSetting('generatedBleedIterations', Number(event.target.value))} />
                      </label>
                      <label>
                        {t.generatedJpegQuality}
                        <input type="number" min={0} max={1} step={0.05} value={settings.generatedJpegQuality} onChange={(event) => updateSetting('generatedJpegQuality', Number(event.target.value))} />
                      </label>
                      <label>
                        {t.generatedOutputFormat}
                        <select value={settings.generatedOutputFormat} onChange={(event) => updateSetting('generatedOutputFormat', event.target.value)}>
                          <option value="png">png</option>
                          <option value="jpg">jpg</option>
                          <option value="webp">webp</option>
                        </select>
                      </label>
                      <label>
                        {t.generatedTextureFormat}
                        <select value={settings.generatedTextureFormat} onChange={(event) => updateSetting('generatedTextureFormat', event.target.value)}>
                          <option value="RGBA8888">RGBA8888</option>
                          <option value="RGBA4444">RGBA4444</option>
                          <option value="RGB888">RGB888</option>
                          <option value="RGB565">RGB565</option>
                          <option value="Alpha">Alpha</option>
                          <option value="LuminanceAlpha">LuminanceAlpha</option>
                        </select>
                      </label>
                      <label>
                        {t.generatedFilterMin}
                        <select value={settings.generatedFilterMin} onChange={(event) => updateSetting('generatedFilterMin', event.target.value)}>
                          {['Nearest', 'Linear', 'MipMap', 'MipMapNearestNearest', 'MipMapLinearNearest', 'MipMapNearestLinear', 'MipMapLinearLinear'].map((value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                      </label>
                      <label>
                        {t.generatedFilterMag}
                        <select value={settings.generatedFilterMag} onChange={(event) => updateSetting('generatedFilterMag', event.target.value)}>
                          {['Nearest', 'Linear'].map((value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                      </label>
                      <label>
                        {t.generatedWrapX}
                        <select value={settings.generatedWrapX} onChange={(event) => updateSetting('generatedWrapX', event.target.value)}>
                          {['ClampToEdge', 'Repeat', 'MirroredRepeat'].map((value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                      </label>
                      <label>
                        {t.generatedWrapY}
                        <select value={settings.generatedWrapY} onChange={(event) => updateSetting('generatedWrapY', event.target.value)}>
                          {['ClampToEdge', 'Repeat', 'MirroredRepeat'].map((value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                      </label>
                      <label>
                        {t.generatedPacking}
                        <select value={settings.generatedPacking} onChange={(event) => updateSetting('generatedPacking', event.target.value)}>
                          <option value="polygons">polygons</option>
                          <option value="rectangles">rectangles</option>
                        </select>
                      </label>
                      {[
                        ['generatedPremultiplyAlpha', t.generatedPremultiplyAlpha],
                        ['generatedPot', t.generatedPot],
                        ['generatedMultipleOfFour', t.generatedMultipleOfFour],
                        ['generatedSquare', t.generatedSquare],
                        ['generatedStripWhitespaceX', t.generatedStripWhitespaceX],
                        ['generatedStripWhitespaceY', t.generatedStripWhitespaceY],
                        ['generatedRotation', t.generatedRotation],
                        ['generatedAlias', t.generatedAlias],
                        ['generatedIgnoreBlankImages', t.generatedIgnoreBlankImages],
                        ['generatedBleed', t.generatedBleed],
                        ['generatedEdgePadding', t.generatedEdgePadding],
                        ['generatedDuplicatePadding', t.generatedDuplicatePadding],
                        ['generatedFast', t.generatedFast],
                        ['generatedLimitMemory', t.generatedLimitMemory]
                      ].map(([key, label]) => (
                        <label className="checkbox-line" key={key}>
                          <input type="checkbox" checked={Boolean(settings[key as keyof AppSettings])} onChange={(event) => updateSetting(key as keyof AppSettings, event.target.checked as never)} />
                          {label}
                        </label>
                      ))}
                    </div>

                    <h3>{t.generatedPaths}</h3>
                    <div className="form-grid">
                      <label>
                        {t.generatedAtlasExtension}
                        <input value={settings.generatedAtlasExtension} onChange={(event) => updateSetting('generatedAtlasExtension', event.target.value)} />
                      </label>
                      <label>
                        {t.generatedPackSource}
                        <select value={settings.generatedPackSource} onChange={(event) => updateSetting('generatedPackSource', event.target.value)}>
                          <option value="attachments">attachments</option>
                          <option value="folder">folder</option>
                        </select>
                      </label>
                      <label>
                        {t.generatedPackTarget}
                        <select value={settings.generatedPackTarget} onChange={(event) => updateSetting('generatedPackTarget', event.target.value)}>
                          <option value="perskeleton">perskeleton</option>
                          <option value="single">single</option>
                        </select>
                      </label>
                      <label className="checkbox-line">
                        <input type="checkbox" checked={settings.generatedCombineSubdirectories} onChange={(event) => updateSetting('generatedCombineSubdirectories', event.target.checked)} />
                        {t.generatedCombineSubdirectories}
                      </label>
                      <label className="checkbox-line">
                        <input type="checkbox" checked={settings.generatedFlattenPaths} onChange={(event) => updateSetting('generatedFlattenPaths', event.target.checked)} />
                        {t.generatedFlattenPaths}
                      </label>
                      <label className="checkbox-line">
                        <input type="checkbox" checked={settings.generatedUseIndexes} onChange={(event) => updateSetting('generatedUseIndexes', event.target.checked)} />
                        {t.generatedUseIndexes}
                      </label>
                    </div>
                  </div>
                </>
              )}
              <div className="form-grid">
                <label>
                  {t.targetVersion}
                  <div className="inline-field">
                    <select value={settings.targetVersion} onChange={(event) => updateSetting('targetVersion', event.target.value)}>
                      {targetVersions.map((version) => (
                        <option key={version} value={version}>{version}</option>
                      ))}
                    </select>
                    <button className="icon-button" title={t.detectVersion} disabled={isDetectingVersion} onClick={() => detectVersion()}>
                      {isDetectingVersion ? <RotateCw className="spin" size={18} /> : <Search size={18} />}
                    </button>
                  </div>
                </label>
                <label>
                  {t.builtInExport}
                  <select value={settings.builtInExport} onChange={(event) => updateSetting('builtInExport', event.target.value)}>
                    <option value="binary+pack">binary+pack</option>
                    <option value="json+pack">json+pack</option>
                    <option value="binary">binary</option>
                    <option value="json">json</option>
                  </select>
                </label>
                <label>
                  {t.missingJson}
                  <select value={settings.fallbackMode} onChange={(event) => updateSetting('fallbackMode', event.target.value as FallbackMode)}>
                    <option value="builtIn">{t.useBuiltIn}</option>
                    <option value="globalJson">{t.useGlobalJson}</option>
                    <option value="skip">{t.skipFile}</option>
                  </select>
                </label>
                <label>
                  {t.globalExportJson}
                  <input value={settings.globalJsonPath} onChange={(event) => updateSetting('globalJsonPath', event.target.value)} />
                </label>
              </div>
            </Section>

            <Section title={t.advancedRuntime} defaultOpen={false}>
              <div className="form-grid">
                <label>
                  {t.parallelJobs}
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={settings.parallelJobs}
                    onChange={(event) => updateSetting('parallelJobs', Number(event.target.value))}
                  />
                </label>
                <label>
                  {t.maxMemory}
                  <input value={settings.maxMemory} onChange={(event) => updateSetting('maxMemory', event.target.value)} />
                </label>
                <label>
                  {t.timeoutSeconds}
                  <input
                    type="number"
                    min={30}
                    value={settings.timeoutSeconds}
                    onChange={(event) => updateSetting('timeoutSeconds', Number(event.target.value))}
                  />
                </label>
                <label className="checkbox-line">
                  <input type="checkbox" checked={settings.clean} onChange={(event) => updateSetting('clean', event.target.checked)} />
                  {t.cleanAnimation}
                </label>
                <label className="checkbox-line">
                  <input
                    type="checkbox"
                    checked={settings.preserveRelativePaths}
                    disabled={settings.outputPolicy !== 'timestamp'}
                    onChange={(event) => updateSetting('preserveRelativePaths', event.target.checked)}
                  />
                  {t.preserveRelativePaths}
                </label>
              </div>
            </Section>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
