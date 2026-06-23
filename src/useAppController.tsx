import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  defaultAppConfig,
  type AppConfig,
  type MergedConfig,
  type SessionStatus,
  type SessionOverlap
} from './config';
import { getCopy, type Translations } from './i18n';
import { computeCanStart, statusFromValidation } from './validation';
import { resolveLinkedTarget } from './exportRequest';
import { computeSessionStatuses, type SharedInputMap } from './sessionStatus';
import { idToken } from './controllerHelpers';
import {
  loadPersistedState,
  loadViewMode,
  persistAppConfig,
  persistLanguage,
  persistTheme,
  persistViewMode,
  type ViewMode
} from './sessions';
import { useAppUpdater } from './useAppUpdater';
import { useDragDrop } from './useDragDrop';
import { useCleanSource } from './useCleanSource';
import { usePresets } from './usePresets';
import { useSpineDetection } from './useSpineDetection';
import { useLinkedProjects } from './useLinkedProjects';
import { useWorkspace } from './useWorkspace';
import { useLibrary } from './useLibrary';
import { useDriveNotifications } from './useDriveNotifications';
import { useSync } from './useSync';
import { useDrive } from './useDrive';
import { useFirebaseAuth } from './useFirebaseAuth';
import { useAppData } from './useAppData';
import { libraryDataDir, type SyncData } from './sync';
import { useScanInput } from './useScanInput';
import { useExportEngine } from './useExportEngine';
import type { Language, ThemeMode, Toast, ToastKind, ValidateResult } from './types';

const persisted = loadPersistedState();

export function useAppControllerValue() {
  const [language, setLanguage] = useState<Language>(persisted.language);
  const [theme, setTheme] = useState<ThemeMode>(persisted.theme);
  const [appConfig, setAppConfig] = useState<AppConfig>(persisted.appConfig);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // When Settings is opened from a sync/Drive entry point, expand the (default-collapsed)
  // Sync section so the user lands right on it.
  const [settingsFocusSync, setSettingsFocusSync] = useState(false);
  const openSettings = (focusSync = false) => {
    setSettingsFocusSync(focusSync);
    setSettingsOpen(true);
  };
  const [linkedModalOpen, setLinkedModalOpen] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  // Top-level mode shown in the left nav rail: export Workspace vs asset Library.
  const [viewMode, setViewModeState] = useState<ViewMode>(() => loadViewMode());
  function setViewMode(mode: ViewMode) {
    setViewModeState(mode);
    persistViewMode(mode);
  }
  const [sessionStatuses, setSessionStatuses] = useState<Record<string, SessionStatus>>({});
  const [sessionOverlaps, setSessionOverlaps] = useState<Record<string, SessionOverlap>>({});
  const [sharedInputFiles, setSharedInputFiles] = useState<SharedInputMap>({});
  const [runningSessionId, setRunningSessionId] = useState<string | null>(null);
  // Live progress for the blocking run overlay — set by the export engine, also reset before a
  // clean-source scan (which reuses the same spine-progress events). Kept here so both can reach it.
  const [liveProgress, setLiveProgress] = useState<{ current: number; total: number; file: string }>({
    current: 0,
    total: 0,
    file: ''
  });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [validation, setValidation] = useState<ValidateResult>({ ok: false, warnings: [], errors: [] });

  const toastIdRef = useRef(0);
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

  function dismissToast(id: number) {
    setToasts((items) => items.filter((item) => item.id !== id));
  }

  function pushToast(text: string, kind: ToastKind = 'info') {
    const id = (toastIdRef.current += 1);
    setToasts((items) => [...items, { id, message: text, kind }]);
    window.setTimeout(() => dismissToast(id), 3500);
  }

  // Projects + sessions + per-session runtime + lifecycle live in their own hook. The controller
  // keeps the shared running state and spreads the workspace API back into its context value.
  const {
    projects,
    setSessions,
    sessions,
    activeSessionId,
    activeProjectId,
    activeSession,
    activeProject,
    collapsedProjectIds,
    sessionConfig,
    files,
    setFiles,
    skippedFiles,
    setSkippedFiles,
    logs,
    setLogs,
    lastOutputFolders,
    currentIndex,
    setCurrentIndex,
    runtimeByIdRef,
    activeIdRef,
    renamingId,
    setRenamingId,
    menuOpenId,
    setMenuOpenId,
    renamingProjectId,
    setRenamingProjectId,
    projectMenuOpenId,
    setProjectMenuOpenId,
    projectDialogOpen,
    setProjectDialogOpen,
    sessionDialogOpen,
    setSessionDialogOpen,
    appendLog,
    recordRunLog,
    recordRunProgress,
    recordRunOutput,
    patchSession,
    updateSessionConfig,
    updateInputPath,
    updateOutputPath,
    updateGeneratedFormat,
    captureActiveRuntime,
    ensureActiveSession,
    completeWizard,
    selectSession,
    newSession,
    openNewSessionDialog,
    confirmNewSession,
    deleteSession,
    renameSession,
    duplicateSession,
    newProject,
    renameProject,
    addSessionToProject,
    createSessionFromLibrary,
    createProjectFromLibrary,
    toggleProjectCollapsed,
    deleteProject
  } = useWorkspace({
    t,
    language,
    initial: {
      projects: persisted.projects,
      sessions: persisted.sessions,
      activeSessionId: persisted.activeSessionId,
      activeProjectId: persisted.activeProjectId,
      collapsedProjectIds: persisted.collapsedProjectIds
    },
    runningSessionId,
    setRunningSessionId,
    runningIdRef,
    setSettingsOpen
  });

  // Asset Library: import a master folder, scan into an inventory, browse stats/warnings.
  const {
    libraries,
    activeLibrary,
    activeLibraryId,
    libraryScan,
    libraryCleanState,
    isScanningLibrary,
    importLibrary,
    rescanLibrary,
    markLibraryEntriesClean,
    markLibraryEntriesScanned,
    selectLibrary,
    deleteLibrary,
    reloadCleanState
  } = useLibrary({ t, pushToast });

  // App-data sync (Tier B): Google Drive account — identifies the user AND powers owner/history
  // metadata of `.spine` files.
  const { driveAccount, driveBusy, driveSignIn, driveCancelSignIn, driveSignOut } = useDrive({ t, pushToast });

  // Realtime Drive-change notifications (bell in the top bar). The Library tab's watcher feeds
  // classified changes in via `addDriveChanges`; the store lives here so the bell persists app-wide.
  const {
    notifications,
    unreadCount: notificationsUnread,
    addChanges: addDriveChanges,
    markAllRead: markNotificationsRead,
    clearAll: clearNotifications
  } = useDriveNotifications();

  // Bridge the Drive OAuth session into Firebase Auth (no second login); uid keys the workspace doc.
  // `isLeader` comes from the Firestore-managed `config/roles` list (not hardcoded) — leaders may
  // curate the shared library (add/remove); enforced in the UI + Firestore rules.
  const { firebaseUid, isLeader } = useFirebaseAuth({ driveEmail: driveAccount?.email ?? null });

  // Shared app-data root on the Pamvis drive (auto-detected); base for sync + library + thumbnails.
  const { appDataDir, appDataResolved, appDataMissing } = useAppData();
  // Shared library data folder (list + tag/owner & drive-meta sidecars live here).
  const libraryDir = appDataDir ? libraryDataDir(appDataDir) : '';

  // App-data sync (Tier A v2): per-user workspace + shared library list in Firestore, keyed by the
  // signed-in Firebase uid, with `${SPINE_ROOT}` path rebasing (anchor derived from appDataDir).
  const syncData = useMemo<SyncData>(
    () => ({ appConfig, projects, sessions, libraries, libraryCleanState }),
    [appConfig, projects, sessions, libraries, libraryCleanState]
  );
  const {
    syncEnabled,
    syncLastSyncedAt,
    syncStatus,
    syncError,
    syncConnected,
    syncNeedsSignIn,
    setSyncEnabled,
    syncNow
  } = useSync({
    data: syncData,
    t,
    pushToast,
    appDataDir,
    userUid: firebaseUid,
    isLeader,
    // A teammate's newer clean-state just landed: refresh in-memory stats, then silently rescan so
    // scan-entry metadata (bytes/version) realigns with the adopted records (covers the re-export case).
    onRemoteCleanApplied: () => {
      reloadCleanState();
      void rescanLibrary(true);
    }
  });

  const merged = useMemo<MergedConfig>(() => ({ ...appConfig, ...sessionConfig }), [appConfig, sessionConfig]);

  function updateAppConfig<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    setAppConfig((current) => ({ ...current, [key]: value }));
  }

  // Dispatcher used by the generated-settings grid: routes by which config owns the key.
  function updateSetting<K extends keyof MergedConfig>(key: K, value: MergedConfig[K]) {
    if (key in defaultAppConfig) {
      updateAppConfig(key as keyof AppConfig, value as never);
    } else {
      updateSessionConfig(key as keyof typeof sessionConfig, value as never);
    }
  }

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

  // Spine executable + version detection (auto-detect on mount, version dropdown list).
  const { targetVersions, addTargetVersion, detectVersion, autoDetectSpine, isAutoDetecting, isDetectingVersion } =
    useSpineDetection({
      spinePath: merged.spinePath,
      setSpinePath: (path) => updateAppConfig('spinePath', path),
      setTargetVersion: (version) => updateSessionConfig('targetVersion', version),
      t,
      appendLog,
      pushToast
    });

  // Linked Projects (Unity links) + auto-detect a session's Type from its input-file paths.
  const {
    linkedProjects,
    addLinkedProject,
    updateLinkedProject,
    deleteLinkedProject,
    autoDetectLinkedType,
    listSubdirectories,
    linkedTypeWarning
  } = useLinkedProjects({
    appConfig,
    setAppConfig,
    files,
    sessionConfig,
    activeSessionId,
    updateSessionConfig,
    t,
    appendLog
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

  // Input scanning + file-list management live in their own hook.
  const {
    isScanning,
    isChoosingInputFolder,
    isChoosingInputFiles,
    isChoosingOutputFolder,
    isCleaningTimestamp,
    scannedPath,
    scanInput,
    applyInputFolder,
    applyInputFiles,
    chooseInputFolder,
    chooseInputFiles,
    chooseOutputFolder,
    cleanTimestampExports,
    removeFile,
    restoreExcludedFile,
    restoreAllExcluded
  } = useScanInput({
    merged,
    sessionConfig,
    activeSessionId,
    activeSession,
    files,
    setFiles,
    setSkippedFiles,
    setCurrentIndex,
    setSessions,
    ensureActiveSession,
    patchSession,
    updateOutputPath,
    runtimeByIdRef,
    appendLog,
    pushToast,
    t
  });

  // App auto-update lifecycle lives in its own hook (checks on mount).
  const { updateUi, checkForAppUpdate, installPendingUpdate, openReleasesPage } = useAppUpdater(appendLog);
  // OS drag-drop: zone routing lives in useDragDrop. The output zone only exists while
  // the output path field is editable; the linkedProject policy hides it.
  // Only policies that show the output-root field accept a dropped output folder.
  const outputDropEnabled = merged.outputPolicy === 'sourceFolderName' || merged.outputPolicy === 'timestamp';
  const { isDragOver, dragPosition } = useDragDrop({
    enabled: !anyRunning,
    outputDropEnabled,
    onInputFiles: applyInputFiles,
    onInputFolder: applyInputFolder,
    onOutputFolder: updateOutputPath,
    onUnsupported: (zone) => pushToast(zone === 'output' ? t.dropOutputUnsupported : t.dropUnsupported, 'warning')
  });

  // Export engine: single + project-wide batch export, run-overlay state, output/log actions,
  // and the spine-log/progress event listeners. Lives in its own hook.
  const {
    batchProgress,
    activeJobs,
    runStartedAt,
    isStopping,
    isOpeningOutput,
    startExport,
    quickExport,
    stopExport,
    exportProjectSessions,
    resolveOpenOutputTarget,
    openOutputFolder,
    saveLogToFile
  } = useExportEngine({
    merged,
    appConfig,
    sessions,
    activeSessionId,
    files,
    logs,
    lastOutputFolders,
    canStart,
    anyRunning,
    isPackFolder,
    setLiveProgress,
    setRunningSessionId,
    runningIdRef,
    activeIdRef,
    runtimeByIdRef,
    setSessions,
    setCurrentIndex,
    captureActiveRuntime,
    recordRunLog,
    recordRunProgress,
    recordRunOutput,
    setProjectMenuOpenId,
    appendLog,
    pushToast,
    t
  });

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
    void validateSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appConfig.spinePath, appConfig.linkedProjects, sessionConfig.outputPath, sessionConfig.outputPolicy, sessionConfig.exportMode, sessionConfig.globalJsonPath, sessionConfig.linkedProjectId, sessionConfig.linkedTypeName, activeSessionId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshSessionStatuses(), 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, appConfig.spinePath]);

  // Keep the Rust side in sync with the "run in background" preference (close/minimize to tray).
  useEffect(() => {
    void invoke('set_run_in_background', { enabled: appConfig.runInBackground }).catch(() => undefined);
  }, [appConfig.runInBackground]);

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

  // Per-session readiness dot + cross-session overlap badge. The heavy lifting (validate,
  // resolve files/output dirs, compute overlap) lives in sessionStatus.ts; here we just feed
  // it the in-memory scanned files and store the result.
  async function refreshSessionStatuses() {
    const runtimeFilesById: Record<string, string[]> = {};
    for (const s of sessions) {
      const sessionFiles = runtimeByIdRef.current[s.id]?.files;
      if (sessionFiles && sessionFiles.length > 0) runtimeFilesById[s.id] = sessionFiles;
    }
    const { statuses, overlaps, sharedInputFiles: shared } = await computeSessionStatuses(
      sessions,
      appConfig,
      runtimeFilesById
    );
    setSessionStatuses(statuses);
    setSessionOverlaps(overlaps);
    setSharedInputFiles(shared);
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
    createSessionFromLibrary,
    createProjectFromLibrary,
    renamingProjectId,
    setRenamingProjectId,
    projectMenuOpenId,
    setProjectMenuOpenId,
    collapsedProjectIds,
    toggleProjectCollapsed,
    exportProjectSessions,
    sessionStatuses,
    sessionOverlaps,
    sharedInputFiles,
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
    settingsFocusSync,
    openSettings,

    // App-data sync (Tier A v2)
    syncEnabled,
    syncLastSyncedAt,
    syncStatus,
    syncError,
    syncConnected,
    syncNeedsSignIn,
    setSyncEnabled,
    syncNow,

    // Shared app-data root (Pamvis drive)
    appDataDir,
    libraryDir,
    appDataResolved,
    appDataMissing,

    // Google Drive (Tier B)
    driveAccount,
    driveBusy,
    driveSignIn,
    driveCancelSignIn,
    driveSignOut,
    /** Library leader (may add/remove libraries); members get a read-only list. */
    isLeader,

    // Realtime Drive-change notifications (top-bar bell)
    notifications,
    notificationsUnread,
    addDriveChanges,
    markNotificationsRead,
    clearNotifications,

    // Clean source folder
    cleanSourceFolderOpen,
    setCleanSourceFolderOpen,
    dashboardOpen,
    setDashboardOpen,

    // Asset Library
    viewMode,
    setViewMode,
    libraries,
    activeLibrary,
    activeLibraryId,
    libraryScan,
    libraryCleanState,
    isScanningLibrary,
    importLibrary,
    rescanLibrary,
    markLibraryEntriesClean,
    markLibraryEntriesScanned,
    selectLibrary,
    deleteLibrary,

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
    linkedProjects,
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
    activeJobs,
    runStartedAt,
    scannedPath,
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
    quickExport,
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
