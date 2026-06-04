import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { confirm, message, open, save } from '@tauri-apps/plugin-dialog';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';
import {
  defaultAppConfig,
  defaultSessionConfig,
  emptyRuntime,
  initialUpdateUi,
  targetVersionPresets,
  type AppConfig,
  type MergedConfig,
  type Session,
  type SessionConfig,
  type SessionRuntime
} from './config';
import { formatMessage, getCopy, type Translations } from './i18n';
import {
  basename,
  cloneSession,
  createSession,
  loadPersistedState,
  persistActiveId,
  persistAppConfig,
  persistLanguage,
  persistSessions,
  persistTheme
} from './sessions';
import type {
  BatchExportResult,
  CleanResult,
  ExportPreset,
  Language,
  ScanResult,
  ThemeMode,
  Toast,
  ToastKind,
  UpdateStatus,
  UpdateUiState,
  ValidateResult
} from './types';

const persisted = loadPersistedState();

function snapshotRuntime(
  files: string[],
  skippedFiles: string[],
  logs: string[],
  lastOutputFolders: string[],
  currentIndex: number
): SessionRuntime {
  return { files, skippedFiles, logs, lastOutputFolders, currentIndex };
}

export function useAppControllerValue() {
  const [language, setLanguage] = useState<Language>(persisted.language);
  const [theme, setTheme] = useState<ThemeMode>(persisted.theme);
  const [appConfig, setAppConfig] = useState<AppConfig>(persisted.appConfig);
  const [sessions, setSessions] = useState<Session[]>(persisted.sessions);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(persisted.activeSessionId);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const [targetVersions, setTargetVersions] = useState<string[]>(targetVersionPresets);

  // Active-session runtime (ephemeral). Other sessions' runtime lives in runtimeByIdRef.
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const [files, setFiles] = useState<string[]>(activeSession?.config.inputFiles ?? []);
  const [skippedFiles, setSkippedFiles] = useState<string[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [lastOutputFolders, setLastOutputFolders] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [runningSessionId, setRunningSessionId] = useState<string | null>(null);

  const [isScanning, setIsScanning] = useState(false);
  const [isChoosingInputFolder, setIsChoosingInputFolder] = useState(false);
  const [isChoosingInputFiles, setIsChoosingInputFiles] = useState(false);
  const [isChoosingOutputFolder, setIsChoosingOutputFolder] = useState(false);
  const [isChoosingGlobalJson, setIsChoosingGlobalJson] = useState(false);
  const [isCleaningTimestamp, setIsCleaningTimestamp] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isOpeningOutput, setIsOpeningOutput] = useState(false);
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);
  const [isDetectingVersion, setIsDetectingVersion] = useState(false);

  const [exportPresets, setExportPresets] = useState<ExportPreset[]>([]);
  const [presetPreview, setPresetPreview] = useState('');
  const [isPresetBusy, setIsPresetBusy] = useState(false);
  const [presetImportedTick, setPresetImportedTick] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [validation, setValidation] = useState<ValidateResult>({ ok: false, warnings: [], errors: [] });
  const [updateUi, setUpdateUi] = useState<UpdateUiState>(initialUpdateUi);

  const toastIdRef = useRef(0);
  const presetTickTimerRef = useRef<number | null>(null);
  const pendingUpdateRef = useRef<Update | null>(null);
  const updateStatusTimerRef = useRef<number | null>(null);
  const runtimeByIdRef = useRef<Record<string, SessionRuntime>>({});
  const activeIdRef = useRef<string | null>(activeSessionId);
  const runningIdRef = useRef<string | null>(null);

  const t = getCopy(language);
  const appWindowRef = useRef<ReturnType<typeof getCurrentWindow> | null>(null);
  function getAppWindow() {
    if (!appWindowRef.current) {
      try {
        appWindowRef.current = getCurrentWindow();
      } catch {
        return null;
      }
    }
    return appWindowRef.current;
  }

  const sessionConfig: SessionConfig = activeSession?.config ?? defaultSessionConfig;
  const merged = useMemo<MergedConfig>(() => ({ ...appConfig, ...sessionConfig }), [appConfig, sessionConfig]);

  const isRunning = runningSessionId !== null && runningSessionId === activeSessionId;
  const anyRunning = runningSessionId !== null;
  const progress = files.length === 0 ? 0 : Math.round((currentIndex / files.length) * 100);
  const currentFile = files[Math.max(0, currentIndex - 1)] ?? '';
  const canStart = useMemo(
    () => validation.ok && files.length > 0 && !anyRunning && activeSessionId !== null,
    [validation.ok, files.length, anyRunning, activeSessionId]
  );
  const outputRootMissingForSourceFolder = merged.outputPolicy === 'sourceFolderName' && !merged.outputPath.trim();
  const maxMemoryValid = /^\d+[kKmMgG]?$/.test(merged.maxMemory.trim());
  const outputHelper =
    merged.outputPolicy === 'sourceFolderName'
      ? t.outputHelperSourceFolder
      : merged.outputPath
        ? t.outputHelperSelected
        : t.outputHelperAuto;
  const selectedExportPreset = useMemo(
    () => exportPresets.find((preset) => preset.path === merged.globalJsonPath),
    [exportPresets, merged.globalJsonPath]
  );

  useEffect(() => {
    activeIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    persistTheme(theme);
  }, [theme]);

  useEffect(() => {
    persistLanguage(language);
  }, [language]);

  useEffect(() => {
    persistAppConfig(appConfig);
  }, [appConfig]);

  useEffect(() => {
    persistSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    persistActiveId(activeSessionId);
  }, [activeSessionId]);

  function stamp(text: string) {
    return `${new Date().toLocaleTimeString()} - ${text}`;
  }

  function appendLog(text: string) {
    setLogs((items) => [...items, stamp(text)]);
  }

  // Route async run output to the originating session even if the user switched away.
  function recordRunLog(line: string) {
    const runId = runningIdRef.current;
    if (!runId || runId === activeIdRef.current) {
      setLogs((items) => [...items, line]);
      return;
    }
    const rt = runtimeByIdRef.current[runId] ?? emptyRuntime();
    rt.logs = [...rt.logs, line];
    runtimeByIdRef.current[runId] = rt;
  }

  function recordRunProgress(current: number) {
    const runId = runningIdRef.current;
    if (!runId || runId === activeIdRef.current) {
      setCurrentIndex(current);
      return;
    }
    const rt = runtimeByIdRef.current[runId] ?? emptyRuntime();
    rt.currentIndex = current;
    runtimeByIdRef.current[runId] = rt;
  }

  function recordRunOutput(folders: string[]) {
    const runId = runningIdRef.current;
    if (!runId || runId === activeIdRef.current) {
      setLastOutputFolders(folders);
      return;
    }
    const rt = runtimeByIdRef.current[runId] ?? emptyRuntime();
    rt.lastOutputFolders = folders;
    runtimeByIdRef.current[runId] = rt;
  }

  useEffect(() => {
    let unlisten: Promise<Array<() => void>> | null = null;
    try {
      unlisten = Promise.all([
        listen<string>('spine-log', (event) => recordRunLog(stamp(event.payload))),
        listen<string>('spine-error', (event) => recordRunLog(stamp(`[ERROR] ${event.payload}`))),
        listen<{ current: number; total: number; file: string }>('spine-progress', (event) => {
          recordRunProgress(event.payload.current);
          recordRunLog(stamp(`[PROGRESS] ${event.payload.current}/${event.payload.total} ${event.payload.file}`));
        })
      ]);
    } catch (error) {
      console.warn('Event listeners unavailable:', error);
    }
    return () => {
      unlisten?.then((callbacks) => callbacks.forEach((callback) => callback())).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    void validateSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appConfig.spinePath, sessionConfig.outputPath, sessionConfig.outputPolicy, sessionConfig.exportMode, sessionConfig.globalJsonPath, activeSessionId]);

  useEffect(() => {
    void autoDetectSpine(true);
    void checkForAppUpdate();
    void loadExportPresets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedExportPreset || selectedExportPreset.builtIn) {
      setPresetPreview('');
      return;
    }
    void loadUserPresetContent(selectedExportPreset.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExportPreset?.name, selectedExportPreset?.builtIn]);

  useEffect(() => {
    return () => {
      if (updateStatusTimerRef.current !== null) window.clearTimeout(updateStatusTimerRef.current);
      if (presetTickTimerRef.current !== null) window.clearTimeout(presetTickTimerRef.current);
    };
  }, []);

  function dismissToast(id: number) {
    setToasts((items) => items.filter((item) => item.id !== id));
  }

  function pushToast(text: string, kind: ToastKind = 'info') {
    const id = (toastIdRef.current += 1);
    setToasts((items) => [...items, { id, message: text, kind }]);
    window.setTimeout(() => dismissToast(id), 3500);
  }

  function showTemporaryUpdateStatus(status: UpdateStatus, durationMs = 3000, text = '') {
    if (updateStatusTimerRef.current !== null) window.clearTimeout(updateStatusTimerRef.current);
    setUpdateUi({ ...initialUpdateUi, status, message: text });
    updateStatusTimerRef.current = window.setTimeout(() => {
      setUpdateUi(initialUpdateUi);
      updateStatusTimerRef.current = null;
    }, durationMs);
  }

  async function checkForAppUpdate(manual = false) {
    try {
      setUpdateUi((current) => ({ ...current, status: 'checking', message: '' }));
      if (manual) appendLog('Checking for app update...');
      const update = await check({ timeout: 30000 });
      if (!update) {
        if (manual) {
          showTemporaryUpdateStatus('upToDate');
          appendLog('App is up to date.');
        } else {
          setUpdateUi(initialUpdateUi);
        }
        return;
      }

      pendingUpdateRef.current = update;
      let downloaded = 0;
      let contentLength = 0;

      setUpdateUi({ status: 'downloading', version: update.version, progress: 0, progressKnown: false, message: '' });
      appendLog(`Downloading app update v${update.version}...`);

      await update.download((event: DownloadEvent) => {
        if (event.event === 'Started') {
          downloaded = 0;
          contentLength = event.data.contentLength ?? 0;
          setUpdateUi({ status: 'downloading', version: update.version, progress: 0, progressKnown: contentLength > 0, message: '' });
          return;
        }
        if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          const value = contentLength > 0 ? Math.min(100, Math.round((downloaded / contentLength) * 100)) : 0;
          setUpdateUi({ status: 'downloading', version: update.version, progress: value, progressKnown: contentLength > 0, message: '' });
          return;
        }
        setUpdateUi({ status: 'ready', version: update.version, progress: 100, progressKnown: true, message: '' });
        appendLog(`App update v${update.version} is ready to install.`);
      });
    } catch (error) {
      const body = String(error);
      pendingUpdateRef.current = null;
      console.warn('Update check failed:', error);
      appendLog(`Update check failed: ${body}`);
      showTemporaryUpdateStatus('error', 6000, body);
    }
  }

  async function installPendingUpdate() {
    const update = pendingUpdateRef.current;
    if (!update) return;
    try {
      await update.install();
      await relaunch();
    } catch (error) {
      const body = String(error);
      setUpdateUi({ ...initialUpdateUi, status: 'error', message: body });
      appendLog(`Update install failed: ${body}`);
      showTemporaryUpdateStatus('error', 6000, body);
    }
  }

  function updateAppConfig<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    setAppConfig((current) => ({ ...current, [key]: value }));
  }

  function patchSession(id: string, patch: Partial<SessionConfig>) {
    setSessions((list) =>
      list.map((s) => (s.id === id ? { ...s, config: { ...s.config, ...patch }, updatedAt: Date.now() } : s))
    );
  }

  function updateSessionConfig<K extends keyof SessionConfig>(key: K, value: SessionConfig[K]) {
    if (!activeSessionId) return;
    patchSession(activeSessionId, { [key]: value } as Partial<SessionConfig>);
  }

  // Dispatcher used by the generated-settings grid: routes by which config owns the key.
  function updateSetting<K extends keyof MergedConfig>(key: K, value: MergedConfig[K]) {
    if (key in defaultAppConfig) {
      updateAppConfig(key as keyof AppConfig, value as never);
    } else {
      updateSessionConfig(key as keyof SessionConfig, value as never);
    }
  }

  function updateInputPath(value: string) {
    updateSessionConfig('inputPath', value);
    if (!value.trim()) {
      setFiles([]);
      setSkippedFiles([]);
      setCurrentIndex(0);
    }
  }

  function updateOutputPath(value: string) {
    updateSessionConfig('outputPath', value);
    if (!value.trim()) setLastOutputFolders([]);
  }

  function updateGeneratedFormat(value: string) {
    if (!activeSessionId) return;
    patchSession(activeSessionId, {
      generatedFormat: value,
      generatedSkeletonExtension: value === 'binary' ? '.skel' : '.json'
    });
  }

  function addTargetVersion(version: string) {
    setTargetVersions((versions) => (versions.includes(version) ? versions : [version, ...versions]));
    updateSessionConfig('targetVersion', version);
  }

  // ----- Session lifecycle -----

  function captureActiveRuntime() {
    if (activeSessionId) {
      runtimeByIdRef.current[activeSessionId] = snapshotRuntime(files, skippedFiles, logs, lastOutputFolders, currentIndex);
    }
  }

  function loadRuntime(session: Session | null) {
    if (!session) {
      setFiles([]);
      setSkippedFiles([]);
      setLogs([]);
      setLastOutputFolders([]);
      setCurrentIndex(0);
      return;
    }
    const rt = runtimeByIdRef.current[session.id] ?? { ...emptyRuntime(), files: [...session.config.inputFiles] };
    setFiles(rt.files);
    setSkippedFiles(rt.skippedFiles);
    setLogs(rt.logs);
    setLastOutputFolders(rt.lastOutputFolders);
    setCurrentIndex(rt.currentIndex);
  }

  function selectSession(id: string) {
    if (id === activeSessionId) return;
    captureActiveRuntime();
    const next = sessions.find((s) => s.id === id) ?? null;
    setActiveSessionId(id);
    loadRuntime(next);
    setMenuOpenId(null);
    setRenamingId(null);
  }

  function newSession() {
    captureActiveRuntime();
    const session = createSession(t, sessions);
    setSessions((list) => [session, ...list]);
    setActiveSessionId(session.id);
    loadRuntime(session);
    setMenuOpenId(null);
    setSettingsOpen(false);
    return session.id;
  }

  /** Returns a session id to operate on, creating one if the workspace is empty. */
  function ensureActiveSession(): string {
    if (activeSessionId) return activeSessionId;
    const session = createSession(t, sessions);
    setSessions((list) => [session, ...list]);
    setActiveSessionId(session.id);
    return session.id;
  }

  async function deleteSession(id: string) {
    const target = sessions.find((s) => s.id === id);
    if (!target) return;
    const ok = await confirm(t.deleteSessionConfirm.replace('{name}', target.name || t.untitledSession), {
      title: t.deleteSession,
      kind: 'warning'
    });
    if (!ok) return;

    if (runningSessionId === id) {
      try {
        await invoke('stop_batch_export');
      } catch (error) {
        appendLog(`${t.stopFailed}: ${String(error)}`);
      }
      runningIdRef.current = null;
      setRunningSessionId(null);
    }

    delete runtimeByIdRef.current[id];
    const remaining = sessions.filter((s) => s.id !== id);
    setSessions(remaining);
    setMenuOpenId(null);

    if (activeSessionId === id) {
      const index = sessions.findIndex((s) => s.id === id);
      const fallback = remaining[index] ?? remaining[index - 1] ?? remaining[0] ?? null;
      setActiveSessionId(fallback ? fallback.id : null);
      loadRuntime(fallback);
    }
  }

  function renameSession(id: string, name: string) {
    const trimmed = name.trim();
    setSessions((list) =>
      list.map((s) => (s.id === id ? { ...s, name: trimmed || s.name || t.untitledSession, autoNamed: false, updatedAt: Date.now() } : s))
    );
    setRenamingId(null);
  }

  function duplicateSession(id: string) {
    const source = sessions.find((s) => s.id === id);
    if (!source) return;
    captureActiveRuntime();
    const copy = cloneSession(source, t);
    setSessions((list) => {
      const index = list.findIndex((s) => s.id === id);
      const next = [...list];
      next.splice(index + 1, 0, copy);
      return next;
    });
    setActiveSessionId(copy.id);
    loadRuntime(copy);
    setMenuOpenId(null);
  }

  // ----- Presets -----

  async function loadExportPresets() {
    try {
      const presets = await invoke<ExportPreset[]>('list_export_presets');
      setExportPresets(presets);
    } catch (error) {
      appendLog(`${t.presetLoadFailed}: ${String(error)}`);
    }
  }

  async function loadUserPresetContent(name: string) {
    try {
      const content = await invoke<string>('read_user_export_preset', { name });
      setPresetPreview(content);
    } catch (error) {
      appendLog(`${t.presetLoadFailed}: ${String(error)}`);
      pushToast(t.presetLoadFailed, 'error');
    }
  }

  function flashPresetTick() {
    setPresetImportedTick(true);
    if (presetTickTimerRef.current !== null) window.clearTimeout(presetTickTimerRef.current);
    presetTickTimerRef.current = window.setTimeout(() => {
      setPresetImportedTick(false);
      presetTickTimerRef.current = null;
    }, 2500);
  }

  async function chooseGlobalJsonFile() {
    if (isChoosingGlobalJson) return;
    setIsChoosingGlobalJson(true);
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        title: t.globalExportJson,
        filters: [{ name: 'Spine export settings', extensions: ['export.json'] }]
      });
      if (typeof selected !== 'string') return;
      if (!selected.toLowerCase().endsWith('.export.json')) {
        appendLog(t.invalidExportJsonFile);
        return;
      }
      updateSessionConfig('globalJsonPath', selected);
    } finally {
      setIsChoosingGlobalJson(false);
    }
  }

  async function importGlobalJsonPreset() {
    if (isPresetBusy) return;
    setIsPresetBusy(true);
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        title: t.importPreset,
        filters: [{ name: 'Spine export settings', extensions: ['export.json'] }]
      });
      if (typeof selected !== 'string') return;
      if (!selected.toLowerCase().endsWith('.export.json')) {
        appendLog(t.invalidExportJsonFile);
        return;
      }
      const preset = await invoke<ExportPreset>('import_user_export_preset', { sourcePath: selected });
      await loadExportPresets();
      updateSessionConfig('globalJsonPath', preset.path);
      await loadUserPresetContent(preset.name);
      appendLog(`${t.presetImported}: ${preset.name}`);
      pushToast(`${t.presetImported}: ${preset.name}`, 'success');
      flashPresetTick();
    } catch (error) {
      appendLog(`${t.presetImportFailed}: ${String(error)}`);
      pushToast(t.presetImportFailed, 'error');
    } finally {
      setIsPresetBusy(false);
    }
  }

  async function deleteUserPreset() {
    if (isPresetBusy || !selectedExportPreset || selectedExportPreset.builtIn) return;
    const ok = await confirm(`${t.deletePreset}: ${selectedExportPreset.name}?`, { title: t.deletePreset });
    if (!ok) return;
    setIsPresetBusy(true);
    try {
      await invoke('delete_user_export_preset', { name: selectedExportPreset.name });
      updateSessionConfig('globalJsonPath', '');
      setPresetPreview('');
      await loadExportPresets();
      appendLog(`${t.presetDeleted}: ${selectedExportPreset.name}`);
      pushToast(`${t.presetDeleted}: ${selectedExportPreset.name}`, 'success');
    } catch (error) {
      appendLog(`${t.presetDeleteFailed}: ${String(error)}`);
      pushToast(t.presetDeleteFailed, 'error');
    } finally {
      setIsPresetBusy(false);
    }
  }

  async function resetDefaultConfig() {
    const ok = await confirm(t.resetDefaultsConfirm, { title: t.resetDefaults });
    if (!ok) return;

    setLanguage('en');
    setTheme('dark');
    setAppConfig({ ...defaultAppConfig, spinePath: appConfig.spinePath });
    if (activeSessionId) {
      patchSession(activeSessionId, {
        ...defaultSessionConfig,
        inputPath: '',
        inputFiles: [],
        outputPath: 'C:\\Users\\Admin\\Desktop\\export',
        outputPolicy: 'sourceFolderName',
        targetVersion: '3.8.99',
        exportMode: 'globalJson',
        globalJsonPath: ''
      });
    }
    setFiles([]);
    setSkippedFiles([]);
    setCurrentIndex(0);
    setLastOutputFolders([]);
    setPresetPreview('');
    appendLog(t.resetDefaultsDone);
    pushToast(t.resetDefaultsDone, 'success');
  }

  // ----- Spine detection -----

  async function detectVersion(spinePath = merged.spinePath) {
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
      pushToast(`${t.detectedVersion}: ${version}`, 'success');
    } catch (error) {
      appendLog(`${t.versionDetectFailed}: ${String(error)}`);
      pushToast(t.versionDetectFailed, 'error');
    } finally {
      setIsDetectingVersion(false);
    }
  }

  async function autoDetectSpine(silent = false) {
    if (isAutoDetecting) return;
    setIsAutoDetecting(true);
    try {
      const detected = await invoke<string>('auto_detect_spine');
      updateAppConfig('spinePath', detected);
      appendLog(`${t.detectedSpine}: ${detected}`);
      pushToast(`${t.detectedSpine}: ${detected}`, 'success');
      await detectVersion(detected);
    } catch (error) {
      if (!silent) {
        appendLog(`${t.autoDetectFailed}: ${String(error)}`);
        pushToast(t.autoDetectFailed, 'error');
      }
    } finally {
      setIsAutoDetecting(false);
    }
  }

  // ----- Input scanning -----

  async function scanPath(inputPath: string) {
    const result = await invoke<ScanResult>('scan_spine_files', { inputPath });
    setFiles(result.files);
    setSkippedFiles(result.skipped);
    setCurrentIndex(0);
    appendLog(`${t.scanned} ${result.files.length} Spine files. ${t.skipped}: ${result.skipped.length}.`);
  }

  async function scanInput() {
    if (isScanning) return;
    if (!merged.inputPath.trim()) {
      appendLog(t.inputEmpty);
      return;
    }
    setIsScanning(true);
    appendLog(`${t.scanning}: ${merged.inputPath}`);
    try {
      await scanPath(merged.inputPath);
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
      const selected = await open({ directory: true, multiple: false, title: t.browseFolder });
      if (typeof selected !== 'string') return;

      const id = ensureActiveSession();
      setSessions((list) =>
        list.map((s) => {
          if (s.id !== id) return s;
          const name = s.autoNamed ? basename(selected) || s.name : s.name;
          return { ...s, name, config: { ...s.config, inputPath: selected, inputFiles: [] }, updatedAt: Date.now() };
        })
      );

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
      const id = ensureActiveSession();
      const combined = Array.from(new Set([...files, ...spineFiles])).sort();
      setFiles(combined);
      setSkippedFiles([]);
      setCurrentIndex(0);
      patchSession(id, { inputFiles: combined });
      appendLog(`${t.scanned} ${spineFiles.length} Spine files.`);
    } finally {
      setIsChoosingInputFiles(false);
    }
  }

  async function chooseOutputFolder() {
    if (isChoosingOutputFolder) return;
    setIsChoosingOutputFolder(true);
    try {
      const selected = await open({ directory: true, multiple: false, title: t.browseOutput });
      if (typeof selected !== 'string') return;
      updateOutputPath(selected);
    } finally {
      setIsChoosingOutputFolder(false);
    }
  }

  async function cleanTimestampExports() {
    if (isCleaningTimestamp) return;
    if (!merged.inputPath.trim()) {
      appendLog(t.inputEmpty);
      return;
    }
    setIsCleaningTimestamp(true);
    try {
      const accepted = await confirm(t.cleanConfirmBody, { title: t.cleanConfirmTitle, kind: 'warning' });
      if (!accepted) return;
      const result = await invoke<CleanResult>('clean_timestamp_exports', { inputPath: merged.inputPath });
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

  // ----- Validation & export -----

  async function validateSettings() {
    try {
      const result = await invoke<ValidateResult>('validate_settings', {
        spinePath: merged.spinePath,
        outputPath: merged.outputPath,
        outputPolicy: merged.outputPolicy,
        exportMode: merged.exportMode,
        globalJsonPath: merged.globalJsonPath
      });
      setValidation(result);
    } catch (error) {
      setValidation({ ok: false, warnings: [], errors: [String(error)] });
    }
  }

  function buildExportRequest() {
    return {
      spinePath: merged.spinePath,
      inputRoot: merged.inputPath,
      files,
      outputPath: merged.outputPath,
      outputPolicy: merged.outputPolicy,
      targetVersion: merged.targetVersion,
      exportMode: merged.exportMode,
      fallbackMode: merged.fallbackMode,
      globalJsonPath: merged.globalJsonPath || null,
      builtInExport: merged.builtInExport,
      generatedFormat: merged.generatedFormat,
      generatedSkeletonExtension: merged.generatedSkeletonExtension,
      generatedPackAtlas: merged.generatedPackAtlas,
      generatedMaxWidth: merged.generatedMaxWidth,
      generatedMaxHeight: merged.generatedMaxHeight,
      generatedPremultiplyAlpha: merged.generatedPremultiplyAlpha,
      generatedPot: merged.generatedPot,
      generatedPaddingX: merged.generatedPaddingX,
      generatedPaddingY: merged.generatedPaddingY,
      generatedPrettyPrint: merged.generatedPrettyPrint,
      generatedNonessential: merged.generatedNonessential,
      generatedStripWhitespaceX: merged.generatedStripWhitespaceX,
      generatedStripWhitespaceY: merged.generatedStripWhitespaceY,
      generatedRotation: merged.generatedRotation,
      generatedAlias: merged.generatedAlias,
      generatedIgnoreBlankImages: merged.generatedIgnoreBlankImages,
      generatedAlphaThreshold: merged.generatedAlphaThreshold,
      generatedMinWidth: merged.generatedMinWidth,
      generatedMinHeight: merged.generatedMinHeight,
      generatedMultipleOfFour: merged.generatedMultipleOfFour,
      generatedSquare: merged.generatedSquare,
      generatedOutputFormat: merged.generatedOutputFormat,
      generatedJpegQuality: merged.generatedJpegQuality,
      generatedBleed: merged.generatedBleed,
      generatedBleedIterations: merged.generatedBleedIterations,
      generatedEdgePadding: merged.generatedEdgePadding,
      generatedDuplicatePadding: merged.generatedDuplicatePadding,
      generatedFilterMin: merged.generatedFilterMin,
      generatedFilterMag: merged.generatedFilterMag,
      generatedWrapX: merged.generatedWrapX,
      generatedWrapY: merged.generatedWrapY,
      generatedTextureFormat: merged.generatedTextureFormat,
      generatedAtlasExtension: merged.generatedAtlasExtension,
      generatedCombineSubdirectories: merged.generatedCombineSubdirectories,
      generatedFlattenPaths: merged.generatedFlattenPaths,
      generatedUseIndexes: merged.generatedUseIndexes,
      generatedFast: merged.generatedFast,
      generatedLimitMemory: merged.generatedLimitMemory,
      generatedPacking: merged.generatedPacking,
      generatedPackSource: merged.generatedPackSource,
      generatedPackTarget: merged.generatedPackTarget,
      generatedWarnings: merged.generatedWarnings,
      generatedForceAll: merged.generatedForceAll,
      clean: merged.clean,
      parallelJobs: merged.parallelJobs,
      maxMemory: merged.maxMemory,
      timeoutSeconds: merged.timeoutSeconds,
      preserveRelativePaths: merged.preserveRelativePaths
    };
  }

  async function startExport() {
    if (!canStart || anyRunning) return;
    const sid = activeSessionId;
    if (!sid) return;

    runningIdRef.current = sid;
    setRunningSessionId(sid);
    setCurrentIndex(0);
    recordRunLog(stamp(`${t.starting}: ${files.length} files.`));

    try {
      const result = await invoke<BatchExportResult>('start_batch_export', { request: buildExportRequest() });
      recordRunOutput(result.outputFolders);
      if (result.stopped) {
        const body = formatMessage(t.exportStoppedBody, result.completed, result.total);
        recordRunLog(stamp(body));
        await message(body, { title: t.exportStoppedTitle, kind: 'warning' });
      } else {
        const body = formatMessage(t.exportSuccessBody, result.completed, result.total);
        recordRunLog(stamp(t.finished));
        await message(body, { title: t.exportSuccessTitle, kind: 'info' });
      }
    } catch (error) {
      const body = String(error);
      recordRunLog(stamp(`${t.batchFailed}: ${body}`));
      await message(body, { title: t.exportFailedTitle, kind: 'error' });
    } finally {
      runningIdRef.current = null;
      setRunningSessionId(null);
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
    if (activeSessionId && sessionConfig.inputFiles.includes(path)) {
      patchSession(activeSessionId, { inputFiles: sessionConfig.inputFiles.filter((item) => item !== path) });
    }
  }

  function resolveOpenOutputTarget() {
    if (lastOutputFolders.length === 1) return lastOutputFolders[0];
    if (lastOutputFolders.length > 1 && merged.outputPath.trim()) return merged.outputPath;
    if (lastOutputFolders.length > 0) return lastOutputFolders[0];
    if (merged.outputPath.trim()) return merged.outputPath;
    return merged.inputPath.trim() || '';
  }

  async function openOutputFolder() {
    if (isOpeningOutput) return;
    const target = resolveOpenOutputTarget();
    if (!target) {
      appendLog(t.openOutputEmpty);
      pushToast(t.openOutputEmpty, 'warning');
      return;
    }
    setIsOpeningOutput(true);
    try {
      await invoke('open_path', { path: target });
    } catch (error) {
      appendLog(`${t.openOutputFailed}: ${String(error)}`);
      pushToast(`${t.openOutputFailed}: ${String(error)}`, 'error');
    } finally {
      setIsOpeningOutput(false);
    }
  }

  async function saveLogToFile() {
    if (logs.length === 0) {
      pushToast(t.logEmpty, 'warning');
      return;
    }
    try {
      const target = await save({ title: t.save, defaultPath: 'spineforge-log.txt', filters: [{ name: 'Log', extensions: ['txt', 'log'] }] });
      if (typeof target !== 'string') return;
      await invoke('write_text_file', { path: target, content: logs.join('\n') });
      appendLog(`${t.logSaved}: ${target}`);
      pushToast(t.logSaved, 'success');
    } catch (error) {
      appendLog(`${t.logSaveFailed}: ${String(error)}`);
      pushToast(t.logSaveFailed, 'error');
    }
  }

  return {
    t,
    language,
    setLanguage,
    theme,
    setTheme,
    appConfig,
    merged,
    updateSetting,
    updateAppConfig,
    updateSessionConfig,
    updateInputPath,
    updateOutputPath,
    updateGeneratedFormat,
    addTargetVersion,
    targetVersions,

    sessions,
    activeSession,
    activeSessionId,
    selectSession,
    newSession,
    deleteSession,
    renameSession,
    duplicateSession,
    renamingId,
    setRenamingId,
    menuOpenId,
    setMenuOpenId,

    settingsOpen,
    setSettingsOpen,

    files,
    skippedFiles,
    logs,
    setLogs,
    lastOutputFolders,
    currentIndex,
    progress,
    currentFile,
    isRunning,
    anyRunning,
    runningSessionId,
    canStart,

    isScanning,
    isChoosingInputFolder,
    isChoosingInputFiles,
    isChoosingOutputFolder,
    isChoosingGlobalJson,
    isCleaningTimestamp,
    isStopping,
    isOpeningOutput,
    isAutoDetecting,
    isDetectingVersion,

    exportPresets,
    selectedExportPreset,
    presetPreview,
    isPresetBusy,
    presetImportedTick,

    validation,
    updateUi,
    getAppWindow,
    maxMemoryValid,
    outputRootMissingForSourceFolder,
    outputHelper,

    // actions
    checkForAppUpdate,
    installPendingUpdate,
    autoDetectSpine,
    detectVersion,
    scanInput,
    chooseInputFolder,
    chooseInputFiles,
    chooseOutputFolder,
    chooseGlobalJsonFile,
    importGlobalJsonPreset,
    deleteUserPreset,
    cleanTimestampExports,
    startExport,
    stopExport,
    removeFile,
    openOutputFolder,
    saveLogToFile,
    resolveOpenOutputTarget,
    resetDefaultConfig,
    toasts,
    pushToast,
    dismissToast
  };
}

export type AppController = ReturnType<typeof useAppControllerValue>;

const AppContext = createContext<AppController | null>(null);

export function AppProvider({ value, children }: { value: AppController; children: React.ReactNode }) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppController {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

export type { Translations };
