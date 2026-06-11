import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { confirm, message, open, save } from '@tauri-apps/plugin-dialog';
import {
  defaultAppConfig,
  defaultExportPreset,
  defaultSessionConfig,
  emptyRuntime,
  targetVersionPresets,
  type AppConfig,
  type LinkedProject,
  type LinkedType,
  type MergedConfig,
  type ExportRecord,
  type Project,
  type Session,
  type SessionConfig,
  type SessionRuntime,
  type SessionStatus
} from './config';
import { formatMessage, formatSummary, getCopy, type Translations } from './i18n';
import { computeCanStart, statusFromValidation } from './validation';
import { commonParentPath } from './paths';
import { useAppUpdater } from './useAppUpdater';
import { useDragDrop } from './useDragDrop';
import { useCleanSource } from './useCleanSource';
import { usePresets } from './usePresets';
import {
  basename,
  cloneSession,
  createDefaultProject,
  createProject,
  createSession,
  loadPersistedState,
  makeId,
  persistActiveId,
  persistActiveProjectId,
  persistAppConfig,
  persistCollapsedProjects,
  persistLanguage,
  persistProjects,
  persistSessions,
  persistTheme
} from './sessions';
import type {
  BatchCleanResult,
  BatchExportResult,
  BatchScanSummary,
  CleanResult,
  ExportPreset,
  Language,
  ScanResult,
  ThemeMode,
  Toast,
  ToastKind,
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

/**
 * Resolve the Unity destination for a session using the `linkedProject` output policy:
 * look up the saved LinkedProject by id, then the chosen type by sourceName. Returns the
 * unityRoot (becomes the backend `outputPath`) and the destName (becomes `linkedDestType`),
 * or null when the project/type selection is incomplete.
 */
function resolveLinkedTarget(cfg: MergedConfig): { unityRoot: string; destName: string } | null {
  const project = cfg.linkedProjects.find((p) => p.id === cfg.linkedProjectId);
  if (!project) return null;
  const type = project.types.find((t) => t.sourceName === cfg.linkedTypeName);
  if (!type) return null;
  return { unityRoot: project.unityRoot, destName: type.destName };
}

/** Resolve the destination type folder ("unityRoot/destType") for a linked-project config, or ''. */
function linkedDestFolder(cfg: MergedConfig): string {
  const linked = cfg.outputPolicy === 'linkedProject' ? resolveLinkedTarget(cfg) : null;
  if (!linked || !linked.unityRoot.trim()) return '';
  const root = linked.unityRoot.replace(/[\\/]+$/, '');
  const sep = root.includes('\\') ? '\\' : '/';
  return linked.destName.trim() ? `${root}${sep}${linked.destName.trim()}` : root;
}

/** Token before the first underscore, e.g. "0001_Fighter" -> "0001". Mirrors backend clean_source_folder_name. */
function idToken(folderName: string): string {
  const idx = folderName.indexOf('_');
  return idx > 0 ? folderName.slice(0, idx) : folderName;
}

/**
 * For each input file, find which LinkedProject type its path belongs to: a path segment that
 * matches a type's `sourceName` (case-insensitive). Returns per-type match counts and how many
 * files matched no type — used to auto-pick the session's single Type and warn on a mix.
 */
function detectTypesFromFiles(
  files: string[],
  project: LinkedProject
): { counts: Map<string, number>; unmatched: number } {
  const bySource = new Map(project.types.map((t) => [t.sourceName.toLowerCase(), t.sourceName]));
  const counts = new Map<string, number>();
  let unmatched = 0;
  for (const file of files) {
    const segments = file.split(/[\\/]+/).map((s) => s.toLowerCase());
    const hit = segments.map((s) => bySource.get(s)).find((name): name is string => Boolean(name));
    if (hit) counts.set(hit, (counts.get(hit) ?? 0) + 1);
    else unmatched += 1;
  }
  return { counts, unmatched };
}

export function useAppControllerValue() {
  const [language, setLanguage] = useState<Language>(persisted.language);
  const [theme, setTheme] = useState<ThemeMode>(persisted.theme);
  const [appConfig, setAppConfig] = useState<AppConfig>(persisted.appConfig);
  const [projects, setProjects] = useState<Project[]>(persisted.projects);
  const [sessions, setSessions] = useState<Session[]>(persisted.sessions);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(persisted.activeSessionId);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(persisted.activeProjectId);
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(
    new Set(persisted.collapsedProjectIds)
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [linkedModalOpen, setLinkedModalOpen] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  // Warning shown at the Output step when input files don't all map to one linked Type.
  const [linkedTypeWarning, setLinkedTypeWarning] = useState('');
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  // Project that a popup-created session should land in (resolved when the dialog opens).
  const [pendingSessionProjectId, setPendingSessionProjectId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [projectMenuOpenId, setProjectMenuOpenId] = useState<string | null>(null);
  const [sessionStatuses, setSessionStatuses] = useState<Record<string, SessionStatus>>({});

  const [targetVersions, setTargetVersions] = useState<string[]>(targetVersionPresets);

  // Active-session runtime (ephemeral). Other sessions' runtime lives in runtimeByIdRef.
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;
  const [files, setFiles] = useState<string[]>(activeSession?.config.inputFiles ?? []);
  const [skippedFiles, setSkippedFiles] = useState<string[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [lastOutputFolders, setLastOutputFolders] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [runningSessionId, setRunningSessionId] = useState<string | null>(null);
  // Live progress for the blocking run overlay — updated for whichever session is running,
  // independent of which session is currently active.
  const [liveProgress, setLiveProgress] = useState<{ current: number; total: number; file: string }>({
    current: 0,
    total: 0,
    file: ''
  });
  // Set during "Export all" so the overlay can show "session X / Y".
  const [batchProgress, setBatchProgress] = useState<{ index: number; count: number } | null>(null);

  const [isScanning, setIsScanning] = useState(false);
  const [isChoosingInputFolder, setIsChoosingInputFolder] = useState(false);
  const [isChoosingInputFiles, setIsChoosingInputFiles] = useState(false);
  const [isChoosingOutputFolder, setIsChoosingOutputFolder] = useState(false);
  const [isCleaningTimestamp, setIsCleaningTimestamp] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isOpeningOutput, setIsOpeningOutput] = useState(false);
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);
  const [isDetectingVersion, setIsDetectingVersion] = useState(false);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [validation, setValidation] = useState<ValidateResult>({ ok: false, warnings: [], errors: [] });

  const toastIdRef = useRef(0);
  const runtimeByIdRef = useRef<Record<string, SessionRuntime>>({});
  const activeIdRef = useRef<string | null>(activeSessionId);
  const runningIdRef = useRef<string | null>(null);
  // Last output folder the app opened (auto or manual) — used to avoid re-opening
  // the same folder right after another export.
  const lastOpenedOutputRef = useRef<string | null>(null);
  // Session ids already auto-scanned this app run, so we scan a folder session at most once automatically.
  const autoScannedRef = useRef<Set<string>>(new Set());

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

  // Clean Source Folder lives in its own hook (modal state, per-session scan cache, scan/move).
  const {
    cleanSourceFolderOpen,
    setCleanSourceFolderOpen,
    isCleaningSourceFolder,
    cleanScanRoot,
    setCleanScanRoot,
    cleanScanSummary,
    setCleanScanSummary,
    scanSourceFolders,
    countCleanUnits,
    listCleanUnits,
    cleanSourceFolders,
    moveFolderUnused,
    readImageDataUrl
  } = useCleanSource({
    spinePath: merged.spinePath,
    targetVersion: merged.targetVersion,
    activeSessionId,
    t,
    appendLog,
    pushToast,
    resetProgress: () => setLiveProgress({ current: 0, total: 0, file: '' })
  });

  // Export presets (list/import/delete + editor + live preview) live in their own hook.
  const {
    exportPresets,
    selectedExportPreset,
    presetPreview,
    isPresetBusy,
    presetImportedTick,
    presetEditorOpen,
    editingPreset,
    isChoosingGlobalJson,
    chooseGlobalJsonFile,
    importGlobalJsonPreset,
    deleteUserPreset,
    openPresetEditor,
    closePresetEditor,
    saveUserPreset,
    newPreset,
    duplicateSelectedPreset
  } = usePresets({
    globalJsonPath: merged.globalJsonPath,
    setGlobalJsonPath: (path) => updateSessionConfig('globalJsonPath', path),
    t,
    appendLog,
    pushToast
  });

  const isRunning = runningSessionId !== null && runningSessionId === activeSessionId;
  const anyRunning = runningSessionId !== null;
  const progress = files.length === 0 ? 0 : Math.round((currentIndex / files.length) * 100);
  const currentFile = files[Math.max(0, currentIndex - 1)] ?? '';
  const canStart = useMemo(
    () =>
      computeCanStart({
        validationOk: validation.ok,
        fileCount: files.length,
        globalJsonPath: merged.globalJsonPath,
        anyRunning,
        activeSessionId
      }),
    [validation.ok, files.length, merged.globalJsonPath, anyRunning, activeSessionId]
  );
  // Status for the main-panel pill — same logic as the sidebar dots (input-aware), so they always agree.
  const activeStatus: SessionStatus = activeSession ? statusFromValidation(activeSession, validation, files.length) : 'red';
  const outputRootMissingForSourceFolder = merged.outputPolicy === 'sourceFolderName' && !merged.outputPath.trim();
  const maxMemoryValid = /^\d+[kKmMgG]?$/.test(merged.maxMemory.trim());
  const outputHelper =
    merged.outputPolicy === 'sourceFolderName'
      ? t.outputHelperSourceFolder
      : merged.outputPath
        ? t.outputHelperSelected
        : t.outputHelperAuto;
  // Whether the effective export packs from image folders ("pack folder" mode):
  // generatedSettings → the generatedPackSource field; globalJson → the selected
  // preset's `packSource`. Drives the clean-source hint + auto-clean wiring.
  const isPackFolder = useMemo(() => {
    const isFolderValue = (value: unknown) => {
      const v = String(value ?? '').toLowerCase();
      return v === 'imagefolders' || v === 'folder';
    };
    if (merged.exportMode === 'generatedSettings') {
      return isFolderValue(merged.generatedPackSource);
    }
    // lastExportSettings bases on the selected preset too → same handling.
    if (merged.exportMode === 'globalJson' || merged.exportMode === 'lastExportSettings') {
      try {
        return isFolderValue((JSON.parse(presetPreview) as { packSource?: unknown }).packSource);
      } catch {
        return false;
      }
    }
    return false;
  }, [merged.exportMode, merged.generatedPackSource, presetPreview]);

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
    persistProjects(projects);
  }, [projects]);

  useEffect(() => {
    persistActiveId(activeSessionId);
  }, [activeSessionId]);

  useEffect(() => {
    persistActiveProjectId(activeProjectId);
  }, [activeProjectId]);

  useEffect(() => {
    persistCollapsedProjects([...collapsedProjectIds]);
  }, [collapsedProjectIds]);

  function stamp(text: string) {
    return `${new Date().toLocaleTimeString()} - ${text}`;
  }

  function appendLog(text: string) {
    setLogs((items) => [...items, stamp(text)]);
  }

  // App auto-update lifecycle lives in its own hook (checks on mount).
  const { updateUi, checkForAppUpdate, installPendingUpdate, openReleasesPage } = useAppUpdater(appendLog);
  // OS drag-drop: zone routing lives in useDragDrop. The output zone only exists while
  // the output path field is editable; the linkedProject policy hides it.
  const outputDropEnabled = merged.outputPolicy !== 'linkedProject';
  const { isDragOver, dragPosition } = useDragDrop({
    enabled: !anyRunning,
    outputDropEnabled,
    onInputFiles: applyInputFiles,
    onInputFolder: applyInputFolder,
    onOutputFolder: updateOutputPath,
    onUnsupported: (zone) => pushToast(zone === 'output' ? t.dropOutputUnsupported : t.dropUnsupported, 'warning')
  });

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

  /** Persist a session's latest export summary (counts + time) for the project dashboard. */
  function recordLastExport(sessionId: string, result: BatchExportResult) {
    const record: ExportRecord = {
      at: Date.now(),
      completed: result.completed,
      failed: result.failed,
      skipped: result.skipped,
      total: result.total,
      stopped: result.stopped
    };
    setSessions((list) =>
      list.map((s) =>
        s.id === sessionId ? { ...s, config: { ...s.config, lastExport: record }, updatedAt: Date.now() } : s
      )
    );
  }

  useEffect(() => {
    let unlisten: Promise<Array<() => void>> | null = null;
    try {
      unlisten = Promise.all([
        listen<string>('spine-log', (event) => recordRunLog(stamp(event.payload))),
        listen<string>('spine-error', (event) => recordRunLog(stamp(`[ERROR] ${event.payload}`))),
        listen<{ current: number; total: number; file: string }>('spine-progress', (event) => {
          recordRunProgress(event.payload.current);
          setLiveProgress({ current: event.payload.current, total: event.payload.total, file: event.payload.file });
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
  }, [appConfig.spinePath, appConfig.linkedProjects, sessionConfig.outputPath, sessionConfig.outputPolicy, sessionConfig.exportMode, sessionConfig.globalJsonPath, sessionConfig.linkedProjectId, sessionConfig.linkedTypeName, activeSessionId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshSessionStatuses(), 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, appConfig.spinePath]);

  useEffect(() => {
    void autoDetectSpine(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the Rust side in sync with the "run in background" preference (close/minimize to tray).
  useEffect(() => {
    void invoke('set_run_in_background', { enabled: appConfig.runInBackground }).catch(() => undefined);
  }, [appConfig.runInBackground]);

  // Auto-scan the active folder session once (e.g. on open / first switch) so its file list shows
  // without a manual Scan. Only the active session is scanned; exclusions are respected.
  useEffect(() => {
    const session = activeSession;
    if (!session || isScanning) return;
    const id = session.id;
    if (autoScannedRef.current.has(id)) return;
    if (!session.config.inputPath.trim()) return;
    // Already have files (scanned earlier this run, or an explicit file list) → nothing to do.
    const rt = runtimeByIdRef.current[id];
    if ((rt && rt.files.length > 0) || session.config.inputFiles.length > 0 || files.length > 0) return;
    autoScannedRef.current.add(id);
    void (async () => {
      setIsScanning(true);
      appendLog(`${t.scanning}: ${session.config.inputPath}`);
      try {
        await scanPath(session.config.inputPath, session.config.excludedFiles ?? []);
      } catch (error) {
        appendLog(`${t.scanFailed}: ${String(error)}`);
      } finally {
        setIsScanning(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  function dismissToast(id: number) {
    setToasts((items) => items.filter((item) => item.id !== id));
  }

  function pushToast(text: string, kind: ToastKind = 'info') {
    const id = (toastIdRef.current += 1);
    setToasts((items) => [...items, { id, message: text, kind }]);
    window.setTimeout(() => dismissToast(id), 3500);
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

  // ----- Linked Projects (Unity links, shared across sessions via appConfig) -----

  function addLinkedProject(): string {
    const id = makeId();
    const project: LinkedProject = { id, name: '', unityRoot: '', sourceRoot: '', types: [] };
    setAppConfig((current) => ({ ...current, linkedProjects: [...current.linkedProjects, project] }));
    return id;
  }

  function updateLinkedProject(id: string, patch: Partial<LinkedProject>) {
    setAppConfig((current) => ({
      ...current,
      linkedProjects: current.linkedProjects.map((p) => (p.id === id ? { ...p, ...patch } : p))
    }));
  }

  function deleteLinkedProject(id: string) {
    setAppConfig((current) => ({ ...current, linkedProjects: current.linkedProjects.filter((p) => p.id !== id) }));
    // Sessions still pointing at this link fall back to "no selection" (validation flags them).
  }

  /** Auto-pick the session's linked Type from the input files' paths; warn if files span types. */
  function autoDetectLinkedType() {
    if (!activeSessionId) return;
    const project = appConfig.linkedProjects.find((p) => p.id === sessionConfig.linkedProjectId);
    if (!project || project.types.length === 0) {
      setLinkedTypeWarning('');
      return;
    }
    const { counts, unmatched } = detectTypesFromFiles(files, project);
    if (counts.size === 0) {
      setLinkedTypeWarning(t.linkedTypeNoMatch);
      return;
    }
    // Pick the most-matched type.
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    if (sessionConfig.linkedTypeName !== best) updateSessionConfig('linkedTypeName', best);
    if (counts.size > 1 || unmatched > 0) {
      const names = [...counts.keys()].join(', ');
      setLinkedTypeWarning(t.linkedTypeMismatch.replace('{types}', names).replace('{best}', best));
    } else {
      setLinkedTypeWarning('');
    }
  }

  // ----- Setup wizard -----

  /** Mark a session's setup wizard finished → it switches to the full editing view. */
  function completeWizard(id: string) {
    setSessions((list) => list.map((s) => (s.id === id ? { ...s, wizardCompleted: true, updatedAt: Date.now() } : s)));
  }

  /** List immediate subfolders of a path (for "Auto-fill from Unity root"). Returns [] on error. */
  async function listSubdirectories(path: string): Promise<string[]> {
    if (!path.trim()) return [];
    try {
      return await invoke<string[]>('list_subdirectories', { path });
    } catch (error) {
      appendLog(`${t.linkedAutoFillFailed}: ${String(error)}`);
      return [];
    }
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

  /** Resolve which project a new session should land in, creating a default one if needed. */
  function resolveTargetProject(): Project {
    const fromActive = projects.find((p) => p.id === activeProjectId);
    if (fromActive) return fromActive;
    const fromSession = activeSession ? projects.find((p) => p.id === activeSession.projectId) : undefined;
    if (fromSession) return fromSession;
    if (projects[0]) return projects[0];
    const project = createDefaultProject(language);
    setProjects((list) => [project, ...list]);
    return project;
  }

  function selectSession(id: string) {
    if (id === activeSessionId) return;
    captureActiveRuntime();
    const next = sessions.find((s) => s.id === id) ?? null;
    setActiveSessionId(id);
    if (next) setActiveProjectId(next.projectId);
    loadRuntime(next);
    setMenuOpenId(null);
    setRenamingId(null);
  }

  function newSession() {
    captureActiveRuntime();
    const project = resolveTargetProject();
    const session = createSession(t, sessions, project.id);
    setSessions((list) => [session, ...list]);
    setActiveProjectId(project.id);
    setActiveSessionId(session.id);
    loadRuntime(session);
    setMenuOpenId(null);
    setSettingsOpen(false);
    return session.id;
  }

  /** Open the "name session" popup, targeting an explicit project (or the resolved default). */
  function openNewSessionDialog(projectId?: string) {
    const targetId = projectId ?? resolveTargetProject().id;
    setPendingSessionProjectId(targetId);
    setSessionDialogOpen(true);
    setProjectMenuOpenId(null);
    setMenuOpenId(null);
  }

  /** Create a session with the name from the popup, in the pending target project. */
  function confirmNewSession(name: string) {
    captureActiveRuntime();
    const projectId = pendingSessionProjectId ?? resolveTargetProject().id;
    const base = createSession(t, sessions, projectId);
    const trimmed = name.trim();
    const session = trimmed ? { ...base, name: trimmed, autoNamed: false } : base;
    setSessions((list) => [session, ...list]);
    setActiveProjectId(projectId);
    setActiveSessionId(session.id);
    loadRuntime(session);
    setCollapsedProjectIds((set) => {
      if (!set.has(projectId)) return set;
      const next = new Set(set);
      next.delete(projectId);
      return next;
    });
    setSettingsOpen(false);
    setSessionDialogOpen(false);
    setPendingSessionProjectId(null);
    return session.id;
  }

  /** Returns a session id to operate on, creating one (and a project if needed) if the workspace is empty. */
  function ensureActiveSession(): string {
    if (activeSessionId && sessions.some((s) => s.id === activeSessionId)) return activeSessionId;
    const project = resolveTargetProject();
    const session = createSession(t, sessions, project.id);
    setSessions((list) => [session, ...list]);
    setActiveProjectId(project.id);
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
      // Prefer another session in the same project, then any session, then none.
      const sameProject = remaining.filter((s) => s.projectId === target.projectId);
      const fallback = sameProject[0] ?? remaining[0] ?? null;
      setActiveSessionId(fallback ? fallback.id : null);
      if (fallback) setActiveProjectId(fallback.projectId);
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
    const copy = cloneSession(source, t, sessions);
    // Scanned files live in the ephemeral runtime, not in config — carry them over so the
    // duplicate shows the same files without needing a re-scan. (captureActiveRuntime above
    // ensures the source's runtime is up to date if it was the active session.)
    const sourceRuntime = runtimeByIdRef.current[source.id];
    if (sourceRuntime) {
      runtimeByIdRef.current[copy.id] = {
        files: [...sourceRuntime.files],
        skippedFiles: [...sourceRuntime.skippedFiles],
        logs: [],
        lastOutputFolders: [],
        currentIndex: 0
      };
    }
    setSessions((list) => {
      const index = list.findIndex((s) => s.id === id);
      const next = [...list];
      next.splice(index + 1, 0, copy);
      return next;
    });
    setActiveProjectId(copy.projectId);
    setActiveSessionId(copy.id);
    loadRuntime(copy);
    setMenuOpenId(null);
  }

  // ----- Project lifecycle -----

  function newProject(name?: string) {
    captureActiveRuntime();
    const base = createProject(t, projects);
    const trimmed = (name ?? '').trim();
    const project = trimmed ? { ...base, name: trimmed, autoNamed: false } : base;
    const session = createSession(t, sessions, project.id);
    setProjects((list) => [project, ...list]);
    setSessions((list) => [session, ...list]);
    setActiveProjectId(project.id);
    setActiveSessionId(session.id);
    loadRuntime(session);
    setProjectMenuOpenId(null);
    setProjectDialogOpen(false);
    setSettingsOpen(false);
    return project.id;
  }

  function renameProject(id: string, name: string) {
    const trimmed = name.trim();
    setProjects((list) =>
      list.map((p) => (p.id === id ? { ...p, name: trimmed || p.name || t.untitledProject, autoNamed: false, updatedAt: Date.now() } : p))
    );
    setRenamingProjectId(null);
  }

  function addSessionToProject(projectId: string) {
    captureActiveRuntime();
    const session = createSession(t, sessions, projectId);
    setSessions((list) => [session, ...list]);
    setActiveProjectId(projectId);
    setActiveSessionId(session.id);
    loadRuntime(session);
    setProjectMenuOpenId(null);
    setCollapsedProjectIds((set) => {
      if (!set.has(projectId)) return set;
      const next = new Set(set);
      next.delete(projectId);
      return next;
    });
    return session.id;
  }

  function toggleProjectCollapsed(id: string) {
    setCollapsedProjectIds((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function deleteProject(id: string) {
    const target = projects.find((p) => p.id === id);
    if (!target) return;
    const childIds = sessions.filter((s) => s.projectId === id).map((s) => s.id);
    const ok = await confirm(
      t.deleteProjectConfirm.replace('{name}', target.name || t.untitledProject).replace('{count}', String(childIds.length)),
      { title: t.deleteProject, kind: 'warning' }
    );
    if (!ok) return;

    if (runningSessionId && childIds.includes(runningSessionId)) {
      try {
        await invoke('stop_batch_export');
      } catch (error) {
        appendLog(`${t.stopFailed}: ${String(error)}`);
      }
      runningIdRef.current = null;
      setRunningSessionId(null);
    }

    for (const childId of childIds) delete runtimeByIdRef.current[childId];

    const remainingProjects = projects.filter((p) => p.id !== id);
    const remainingSessions = sessions.filter((s) => s.projectId !== id);
    setProjects(remainingProjects);
    setSessions(remainingSessions);
    setProjectMenuOpenId(null);
    setCollapsedProjectIds((set) => {
      if (!set.has(id)) return set;
      const next = new Set(set);
      next.delete(id);
      return next;
    });

    if (activeProjectId === id || (activeSessionId && childIds.includes(activeSessionId))) {
      const fallbackProject = remainingProjects[0] ?? null;
      const fallbackSession = fallbackProject
        ? remainingSessions.find((s) => s.projectId === fallbackProject.id) ?? null
        : null;
      setActiveProjectId(fallbackProject ? fallbackProject.id : null);
      setActiveSessionId(fallbackSession ? fallbackSession.id : null);
      loadRuntime(fallbackSession);
    }
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

  async function scanPath(inputPath: string, excluded: string[] = []) {
    const result = await invoke<ScanResult>('scan_spine_files', { inputPath });
    const excludedSet = new Set(excluded);
    const kept = excludedSet.size ? result.files.filter((f) => !excludedSet.has(f)) : result.files;
    setFiles(kept);
    setSkippedFiles(result.skipped);
    setCurrentIndex(0);
    appendLog(`${t.scanned} ${kept.length} Spine files. ${t.skipped}: ${result.skipped.length}.`);
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
      await scanPath(merged.inputPath, sessionConfig.excludedFiles ?? []);
    } catch (error) {
      appendLog(`${t.scanFailed}: ${String(error)}`);
    } finally {
      setIsScanning(false);
    }
  }

  /** Point the active session at a folder and scan it. Shared by Browse + drag-drop. */
  async function applyInputFolder(selected: string) {
    const id = ensureActiveSession();
    setSessions((list) =>
      list.map((s) => {
        if (s.id !== id) return s;
        const name = s.autoNamed ? basename(selected) || s.name : s.name;
        // New folder → reset any exclusions from the previous folder.
        return { ...s, name, config: { ...s.config, inputPath: selected, inputFiles: [], excludedFiles: [] }, updatedAt: Date.now() };
      })
    );
    setIsScanning(true);
    appendLog(`${t.scanning}: ${selected}`);
    try {
      await scanPath(selected, []);
    } catch (error) {
      appendLog(`${t.scanFailed}: ${String(error)}`);
    } finally {
      setIsScanning(false);
    }
  }

  /** Merge explicit `.spine` files into the active session's file list. Shared by Browse + drag-drop. */
  function applyInputFiles(spineFiles: string[]) {
    if (!spineFiles.length) return;
    const id = ensureActiveSession();
    const combined = Array.from(new Set([...files, ...spineFiles])).sort();
    setFiles(combined);
    setSkippedFiles([]);
    setCurrentIndex(0);
    // Explicitly adding a file wins over a prior exclusion — un-exclude anything just added.
    const added = new Set(spineFiles);
    setSessions((list) =>
      list.map((s) =>
        s.id === id
          ? {
              ...s,
              config: {
                ...s.config,
                inputFiles: combined,
                excludedFiles: (s.config.excludedFiles ?? []).filter((p) => !added.has(p))
              },
              updatedAt: Date.now()
            }
          : s
      )
    );
    appendLog(`${t.scanned} ${spineFiles.length} Spine files.`);
  }

  async function chooseInputFolder() {
    if (isChoosingInputFolder || isScanning) return;
    setIsChoosingInputFolder(true);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t.browseFolder,
        defaultPath: merged.inputPath.trim() || undefined
      });
      if (typeof selected !== 'string') return;
      await applyInputFolder(selected);
    } finally {
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
        defaultPath: merged.inputPath.trim() || undefined,
        filters: [{ name: 'Spine Project', extensions: ['spine'] }]
      });
      if (!Array.isArray(selected)) return;
      applyInputFiles(selected.filter((path) => path.toLowerCase().endsWith('.spine')));
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
        title: t.browseOutput,
        defaultPath: merged.outputPath.trim() || undefined
      });
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
        outputPath:
          merged.outputPolicy === 'linkedProject' ? resolveLinkedTarget(merged)?.unityRoot ?? '' : merged.outputPath,
        outputPolicy: merged.outputPolicy,
        exportMode: merged.exportMode,
        globalJsonPath: merged.globalJsonPath
      });
      setValidation(result);
    } catch (error) {
      setValidation({ ok: false, warnings: [], errors: [String(error)] });
    }
  }

  // `statusFromValidation` is imported from ./validation (pure, unit-tested).

  // Per-session readiness dot. Based on config only (not ephemeral runtime files) so it is reload-stable.
  async function refreshSessionStatuses() {
    const entries = await Promise.all(
      sessions.map(async (s): Promise<[string, SessionStatus]> => {
        const cfg: MergedConfig = { ...appConfig, ...s.config };
        try {
          const result = await invoke<ValidateResult>('validate_settings', {
            spinePath: cfg.spinePath,
            outputPath:
              cfg.outputPolicy === 'linkedProject' ? resolveLinkedTarget(cfg)?.unityRoot ?? '' : cfg.outputPath,
            outputPolicy: cfg.outputPolicy,
            exportMode: cfg.exportMode,
            globalJsonPath: cfg.globalJsonPath
          });
          // Resolve how many .spine files this session would export: in-memory runtime →
          // saved inputFiles → scan the input folder. Mirrors the Export-all preflight.
          let fileCount = runtimeByIdRef.current[s.id]?.files.length ?? 0;
          if (fileCount === 0 && s.config.inputFiles.length > 0) fileCount = s.config.inputFiles.length;
          if (fileCount === 0 && s.config.inputPath.trim()) {
            try {
              const scan = await invoke<ScanResult>('scan_spine_files', { inputPath: s.config.inputPath });
              const excluded = new Set(s.config.excludedFiles ?? []);
              fileCount = scan.files.filter((f) => !excluded.has(f)).length;
            } catch {
              fileCount = 0;
            }
          }
          return [s.id, statusFromValidation(s, result, fileCount)];
        } catch {
          return [s.id, 'red'];
        }
      })
    );
    setSessionStatuses(Object.fromEntries(entries));
  }

  function buildExportRequestFrom(cfg: MergedConfig, sessionFiles: string[]) {
    // For the linkedProject policy the backend output root is the Unity root, and the
    // destination type folder is passed separately so resolve_output_dir can route into it.
    const linked = cfg.outputPolicy === 'linkedProject' ? resolveLinkedTarget(cfg) : null;
    return {
      spinePath: cfg.spinePath,
      inputRoot: cfg.inputPath,
      files: sessionFiles,
      outputPath: linked ? linked.unityRoot : cfg.outputPath,
      linkedDestType: linked ? linked.destName : '',
      outputPolicy: cfg.outputPolicy,
      targetVersion: cfg.targetVersion,
      exportMode: cfg.exportMode,
      fallbackMode: cfg.fallbackMode,
      globalJsonPath: cfg.globalJsonPath || null,
      builtInExport: cfg.builtInExport,
      generatedFormat: cfg.generatedFormat,
      generatedSkeletonExtension: cfg.generatedSkeletonExtension,
      generatedPackAtlas: cfg.generatedPackAtlas,
      generatedMaxWidth: cfg.generatedMaxWidth,
      generatedMaxHeight: cfg.generatedMaxHeight,
      generatedPremultiplyAlpha: cfg.generatedPremultiplyAlpha,
      generatedPot: cfg.generatedPot,
      generatedPaddingX: cfg.generatedPaddingX,
      generatedPaddingY: cfg.generatedPaddingY,
      generatedPrettyPrint: cfg.generatedPrettyPrint,
      generatedNonessential: cfg.generatedNonessential,
      generatedStripWhitespaceX: cfg.generatedStripWhitespaceX,
      generatedStripWhitespaceY: cfg.generatedStripWhitespaceY,
      generatedRotation: cfg.generatedRotation,
      generatedAlias: cfg.generatedAlias,
      generatedIgnoreBlankImages: cfg.generatedIgnoreBlankImages,
      generatedAlphaThreshold: cfg.generatedAlphaThreshold,
      generatedMinWidth: cfg.generatedMinWidth,
      generatedMinHeight: cfg.generatedMinHeight,
      generatedMultipleOfFour: cfg.generatedMultipleOfFour,
      generatedSquare: cfg.generatedSquare,
      generatedOutputFormat: cfg.generatedOutputFormat,
      generatedJpegQuality: cfg.generatedJpegQuality,
      generatedBleed: cfg.generatedBleed,
      generatedBleedIterations: cfg.generatedBleedIterations,
      generatedEdgePadding: cfg.generatedEdgePadding,
      generatedDuplicatePadding: cfg.generatedDuplicatePadding,
      generatedFilterMin: cfg.generatedFilterMin,
      generatedFilterMag: cfg.generatedFilterMag,
      generatedWrapX: cfg.generatedWrapX,
      generatedWrapY: cfg.generatedWrapY,
      generatedTextureFormat: cfg.generatedTextureFormat,
      generatedAtlasExtension: cfg.generatedAtlasExtension,
      generatedCombineSubdirectories: cfg.generatedCombineSubdirectories,
      generatedFlattenPaths: cfg.generatedFlattenPaths,
      generatedUseIndexes: cfg.generatedUseIndexes,
      generatedFast: cfg.generatedFast,
      generatedLimitMemory: cfg.generatedLimitMemory,
      generatedPacking: cfg.generatedPacking,
      generatedPackSource: cfg.generatedPackSource,
      generatedPackTarget: cfg.generatedPackTarget,
      generatedWarnings: cfg.generatedWarnings,
      generatedForceAll: cfg.generatedForceAll,
      clean: cfg.clean,
      parallelJobs: cfg.parallelJobs,
      maxMemory: cfg.maxMemory,
      timeoutSeconds: cfg.timeoutSeconds,
      preserveRelativePaths: cfg.preserveRelativePaths,
      cleanFolderName: cfg.cleanFolderName,
      unicodeWorkaround: cfg.unicodeWorkaround
    };
  }

  function buildExportRequest() {
    return buildExportRequestFrom(merged, files);
  }

  /** Open the export's output folder when enabled, skipping if it's the one we just opened. */
  async function maybeAutoOpenOutput(folders: string[]) {
    if (!merged.autoOpenOutputAfterExport || folders.length === 0) return;
    const target =
      folders.length === 1 ? folders[0] : commonParentPath(folders) || merged.outputPath.trim() || folders[0];
    if (!target || target === lastOpenedOutputRef.current) return;
    try {
      await invoke('open_path', { path: target });
      lastOpenedOutputRef.current = target;
    } catch (error) {
      appendLog(`${t.openOutputFailed}: ${String(error)}`);
    }
  }

  async function startExport() {
    if (!canStart || anyRunning) return;
    const sid = activeSessionId;
    if (!sid) return;

    // Pre-export reminder: in pack-folder mode unused images get packed into the
    // atlas. We only hint — cleaning is a deliberate manual action (no auto-move).
    if (isPackFolder && merged.inputPath.trim()) {
      appendLog(t.packFolderCleanHint);
    }

    // Warn before overwriting output folders that already exist.
    try {
      const existing = await invoke<string[]>('check_output_collisions', { request: buildExportRequest() });
      if (existing.length > 0) {
        const ok = await confirm(t.overwriteConfirmBody.replace('{count}', String(existing.length)), {
          title: t.overwriteConfirmTitle,
          kind: 'warning'
        });
        if (!ok) return;
      }
    } catch {
      // If the check fails, fall through and let the export proceed.
    }

    runningIdRef.current = sid;
    setRunningSessionId(sid);
    setCurrentIndex(0);
    setBatchProgress(null);
    setLiveProgress({ current: 0, total: files.length, file: '' });
    recordRunLog(stamp(`${t.starting}: ${files.length} files.`));

    try {
      const result = await invoke<BatchExportResult>('start_batch_export', { request: buildExportRequest() });
      recordRunOutput(result.outputFolders);
      recordLastExport(sid, result);
      if (result.stopped) {
        const body = formatSummary(t.exportStoppedSummary, result.completed, result.failed, result.skipped);
        recordRunLog(stamp(body));
        await message(body, { title: t.exportStoppedTitle, kind: 'warning' });
      } else {
        const body = formatSummary(t.exportSummary, result.completed, result.failed, result.skipped);
        recordRunLog(stamp(t.finished));
        await message(body, { title: t.exportSuccessTitle, kind: 'info' });
      }
      await maybeAutoOpenOutput(result.outputFolders);
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

  /** Export every ready session in a project, sequentially. Skips sessions that aren't ready. */
  async function exportProjectSessions(projectId: string) {
    if (anyRunning) return;
    const targets = sessions.filter((s) => s.projectId === projectId);
    setProjectMenuOpenId(null);
    if (targets.length === 0) {
      pushToast(t.exportAllNothing, 'warning');
      return;
    }
    captureActiveRuntime();

    // ----- Pre-flight: classify each session and resolve its files (no UI run yet) -----
    const plan: { session: Session; files: string[] }[] = [];
    let warned = 0;
    let skipped = 0;
    for (const s of targets) {
      const cfg: MergedConfig = { ...appConfig, ...s.config };
      let result: ValidateResult = { ok: false, warnings: [], errors: [] };
      try {
        result = await invoke<ValidateResult>('validate_settings', {
          spinePath: cfg.spinePath,
          outputPath:
            cfg.outputPolicy === 'linkedProject' ? resolveLinkedTarget(cfg)?.unityRoot ?? '' : cfg.outputPath,
          outputPolicy: cfg.outputPolicy,
          exportMode: cfg.exportMode,
          globalJsonPath: cfg.globalJsonPath
        });
      } catch {
        result = { ok: false, warnings: [], errors: [] };
      }
      const inputConfigured = s.config.inputPath.trim() !== '' || s.config.inputFiles.length > 0;
      if (!result.ok || !inputConfigured) {
        skipped += 1;
        continue;
      }

      // Resolve files: in-memory runtime → saved inputFiles → scan the input folder.
      let sessionFiles = runtimeByIdRef.current[s.id]?.files ?? [];
      if (sessionFiles.length === 0 && s.config.inputFiles.length > 0) sessionFiles = s.config.inputFiles;
      if (sessionFiles.length === 0 && s.config.inputPath.trim()) {
        try {
          const scan = await invoke<ScanResult>('scan_spine_files', { inputPath: s.config.inputPath });
          const excluded = new Set(s.config.excludedFiles ?? []);
          sessionFiles = scan.files.filter((f) => !excluded.has(f));
        } catch (error) {
          appendLog(`${t.scanFailed}: ${String(error)}`);
        }
      }
      if (sessionFiles.length === 0) {
        skipped += 1;
        continue;
      }

      if (result.warnings.length > 0) warned += 1;
      plan.push({ session: s, files: sessionFiles });
    }

    if (plan.length === 0) {
      pushToast(t.exportAllNothing, 'warning');
      return;
    }

    // Collision check across all sessions that will run.
    const existing = new Set<string>();
    for (const item of plan) {
      try {
        const cols = await invoke<string[]>('check_output_collisions', {
          request: buildExportRequestFrom({ ...appConfig, ...item.session.config }, item.files)
        });
        cols.forEach((dir) => existing.add(dir));
      } catch {
        // ignore; treat as no collision
      }
    }

    // Single combined confirm: summary + overwrite warning.
    let body = t.exportAllConfirmBody
      .replace('{total}', String(plan.length))
      .replace('{warn}', String(warned))
      .replace('{skip}', String(skipped));
    if (existing.size > 0) {
      body += `\n\n${t.overwriteConfirmBody.replace('{count}', String(existing.size))}`;
    }
    const proceed = await confirm(body, { title: t.exportAllConfirmTitle, kind: 'warning' });
    if (!proceed) return;

    // ----- Run phase -----
    setBatchProgress({ index: 0, count: plan.length });
    setLiveProgress({ current: 0, total: 0, file: '' });

    let exported = 0;
    const allOutputFolders: string[] = [];
    for (let i = 0; i < plan.length; i += 1) {
      const { session: s, files: sessionFiles } = plan[i];
      setBatchProgress({ index: i + 1, count: plan.length });

      runningIdRef.current = s.id;
      setRunningSessionId(s.id);
      recordRunProgress(0);
      setLiveProgress({ current: 0, total: sessionFiles.length, file: '' });
      recordRunLog(stamp(`${t.starting}: ${sessionFiles.length} files. (${s.name || t.untitledSession})`));

      let stopped = false;
      try {
        const result = await invoke<BatchExportResult>('start_batch_export', {
          request: buildExportRequestFrom({ ...appConfig, ...s.config }, sessionFiles)
        });
        recordRunOutput(result.outputFolders);
        recordLastExport(s.id, result);
        allOutputFolders.push(...result.outputFolders);
        recordRunLog(
          stamp(
            result.stopped
              ? formatSummary(t.exportStoppedSummary, result.completed, result.failed, result.skipped)
              : formatSummary(t.exportSummary, result.completed, result.failed, result.skipped)
          )
        );
        exported += 1;
        stopped = result.stopped;
      } catch (error) {
        recordRunLog(stamp(`${t.batchFailed}: ${String(error)}`));
      } finally {
        runningIdRef.current = null;
        setRunningSessionId(null);
      }
      if (stopped) break;
    }

    setBatchProgress(null);
    await maybeAutoOpenOutput(allOutputFolders);
    pushToast(
      t.exportAllDone.replace('{exported}', String(exported)).replace('{skipped}', String(targets.length - exported)),
      'success'
    );
  }

  function removeFile(path: string) {
    setFiles((items) => items.filter((item) => item !== path));
    if (!activeSessionId) return;
    if (sessionConfig.inputFiles.includes(path)) {
      // Browse-files item: drop it from the explicit list.
      patchSession(activeSessionId, { inputFiles: sessionConfig.inputFiles.filter((item) => item !== path) });
    } else {
      // Folder-scan result: remember the exclusion so a re-scan keeps it removed (survives restart).
      const excluded = sessionConfig.excludedFiles ?? [];
      if (!excluded.includes(path)) {
        patchSession(activeSessionId, { excludedFiles: [...excluded, path] });
      }
    }
  }

  /** Un-exclude a single file: drop it from excludedFiles and add it back to the visible list. */
  function restoreExcludedFile(path: string) {
    if (!activeSessionId) return;
    const excluded = sessionConfig.excludedFiles ?? [];
    if (!excluded.includes(path)) return;
    patchSession(activeSessionId, { excludedFiles: excluded.filter((p) => p !== path) });
    setFiles((items) => (items.includes(path) ? items : [...items, path].sort()));
  }

  /** Clear all exclusions and re-scan the folder so every file comes back. */
  async function restoreAllExcluded() {
    if (!activeSessionId) return;
    if ((sessionConfig.excludedFiles ?? []).length === 0) return;
    patchSession(activeSessionId, { excludedFiles: [] });
    if (merged.inputPath.trim()) {
      setIsScanning(true);
      appendLog(`${t.scanning}: ${merged.inputPath}`);
      try {
        await scanPath(merged.inputPath, []);
      } catch (error) {
        appendLog(`${t.scanFailed}: ${String(error)}`);
      } finally {
        setIsScanning(false);
      }
    }
  }

  function resolveOpenOutputTarget() {
    if (lastOutputFolders.length === 1) return lastOutputFolders[0];
    if (lastOutputFolders.length > 1) {
      // Open the shared parent of all exported folders (e.g. unityRoot/Heroes), not just the
      // first child. In linkedProject mode outputPath is empty, so derive it from the folders.
      const parent = commonParentPath(lastOutputFolders);
      if (parent) return parent;
      if (merged.outputPath.trim()) return merged.outputPath;
      return lastOutputFolders[0];
    }
    // No run recorded yet: prefer the linked destination folder over the raw input path.
    const linkedFolder = linkedDestFolder(merged);
    if (linkedFolder) return linkedFolder;
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
      lastOpenedOutputRef.current = target;
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

    projects,
    activeProject,
    activeProjectId,
    newProject,
    renameProject,
    deleteProject,
    addSessionToProject,
    renamingProjectId,
    setRenamingProjectId,
    projectMenuOpenId,
    setProjectMenuOpenId,
    collapsedProjectIds,
    toggleProjectCollapsed,
    exportProjectSessions,
    sessionStatuses,
    projectDialogOpen,
    setProjectDialogOpen,

    sessions,
    activeSession,
    activeSessionId,
    selectSession,
    newSession,
    sessionDialogOpen,
    setSessionDialogOpen,
    openNewSessionDialog,
    confirmNewSession,
    deleteSession,
    renameSession,
    duplicateSession,
    renamingId,
    setRenamingId,
    menuOpenId,
    setMenuOpenId,

    settingsOpen,
    setSettingsOpen,

    // Clean source folder
    cleanSourceFolderOpen,
    setCleanSourceFolderOpen,
    dashboardOpen,
    setDashboardOpen,
    isDragOver,
    dragPosition,
    outputDropEnabled,
    isCleaningSourceFolder,
    scanSourceFolders,
    countCleanUnits,
    listCleanUnits,
    cleanSourceFolders,
    moveFolderUnused,
    readImageDataUrl,
    cleanScanRoot,
    setCleanScanRoot,
    cleanScanSummary,
    setCleanScanSummary,

    // Linked Projects
    linkedProjects: appConfig.linkedProjects,
    linkedModalOpen,
    setLinkedModalOpen,
    addLinkedProject,
    updateLinkedProject,
    deleteLinkedProject,
    listSubdirectories,
    idToken,
    autoDetectLinkedType,
    linkedTypeWarning,
    completeWizard,

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
    liveProgress,
    batchProgress,
    canStart,
    activeStatus,

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
    isPackFolder,
    presetPreview,
    isPresetBusy,
    presetImportedTick,
    presetEditorOpen,
    editingPreset,
    openPresetEditor,
    closePresetEditor,
    saveUserPreset,
    newPreset,
    duplicateSelectedPreset,

    validation,
    updateUi,
    getAppWindow,
    maxMemoryValid,
    outputRootMissingForSourceFolder,
    outputHelper,

    // actions
    checkForAppUpdate,
    installPendingUpdate,
    openReleasesPage,
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
    restoreExcludedFile,
    restoreAllExcluded,
    openOutputFolder,
    saveLogToFile,
    resolveOpenOutputTarget,
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
