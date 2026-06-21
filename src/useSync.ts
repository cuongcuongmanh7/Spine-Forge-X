import { useCallback, useEffect, useRef, useState } from 'react';
import type { Translations } from './i18n';
import type { ToastKind } from './types';
import {
  applyLibraryProfile,
  applyWorkspaceProfile,
  buildLibraryProfile,
  buildWorkspaceProfile,
  deriveAnchor,
  libraryListBackupPath,
  libraryListPath,
  loadSyncSettings,
  persistSyncSettings,
  readLibraryProfile,
  readWorkspaceProfile,
  sameLibraryBody,
  sameWorkspaceBody,
  workspaceBackupPath,
  workspaceProfilePath,
  writeLibraryProfile,
  writeWorkspaceProfile,
  type SyncData
} from './sync';

export type SyncStatus = 'idle' | 'pending' | 'syncing' | 'synced' | 'error';

const DEBOUNCE_MS = 1500;

type Args = {
  data: SyncData;
  t: Translations;
  pushToast: (text: string, kind?: ToastKind) => void;
  /** Shared app-data root (`…\Pamvis\spine_app_data`), auto-detected; null if the drive isn't mounted. */
  appDataDir: string | null;
  /** Signed-in Google account email — identifies this user's workspace folder; null if signed out. */
  userEmail: string | null;
};

/**
 * Orchestrates Tier-A sync v2. The base folder is the auto-detected shared app-data root (no user
 * picker). Two scopes reconcile independently (newer-wins): the per-user WORKSPACE profile (keyed by
 * the signed-in email) and the shared LIBRARY list. Reconciles at startup / on identity change, and
 * debounce-writes local edits; adopting a newer remote reloads the window so module-scope
 * `loadPersistedState` re-runs with it.
 */
export function useSync({ data, t, pushToast, appDataDir, userEmail }: Args) {
  const initial = loadSyncSettings();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [workspaceSyncedAt, setWorkspaceSyncedAt] = useState<number | null>(initial.workspaceSyncedAt);
  const [librarySyncedAt, setLibrarySyncedAt] = useState<number | null>(initial.librarySyncedAt);

  // Workspace sync needs both the shared drive AND a signed-in identity; the library list only needs the drive.
  const connected = enabled && Boolean(appDataDir);
  const workspaceReady = connected && Boolean(userEmail);

  // Async callbacks read live values through refs so they never close over stale state.
  const dataRef = useRef(data);
  dataRef.current = data;
  const settingsRef = useRef({ enabled, appDataDir, userEmail, workspaceSyncedAt, librarySyncedAt });
  settingsRef.current = { enabled, appDataDir, userEmail, workspaceSyncedAt, librarySyncedAt };
  // t/pushToast are recreated each render; read through refs so the callbacks keep a STABLE identity
  // (otherwise the debounce effect re-subscribes every render and cancels the pending timer).
  const tRef = useRef(t);
  tRef.current = t;
  const pushToastRef = useRef(pushToast);
  pushToastRef.current = pushToast;
  // Bodies we last read/wrote — let the debounced writer skip no-op pushes.
  const lastWsBodyRef = useRef<string | null>(null);
  const lastLibBodyRef = useRef<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  // Gate pushes until the first reconcile establishes a baseline (else a fresh machine clobbers remote).
  const reconcilingRef = useRef(false);
  const syncedOnceRef = useRef(false);

  const wsBody = (p: { appConfig: unknown; projects: unknown; sessions: unknown }) =>
    JSON.stringify({ appConfig: p.appConfig, projects: p.projects, sessions: p.sessions });

  const markWorkspace = useCallback((at: number, body: string | null) => {
    persistSyncSettings({ workspaceSyncedAt: at });
    setWorkspaceSyncedAt(at);
    settingsRef.current = { ...settingsRef.current, workspaceSyncedAt: at };
    if (body !== null) lastWsBodyRef.current = body;
  }, []);

  const markLibrary = useCallback((at: number, body: string | null) => {
    persistSyncSettings({ librarySyncedAt: at });
    setLibrarySyncedAt(at);
    settingsRef.current = { ...settingsRef.current, librarySyncedAt: at };
    if (body !== null) lastLibBodyRef.current = body;
  }, []);

  // Push local edits up (no reload). Writes only the scope(s) whose body changed.
  const pushLocal = useCallback(async () => {
    const { appDataDir: dir, userEmail: email } = settingsRef.current;
    if (!dir) return;
    if (reconcilingRef.current || !syncedOnceRef.current) return;
    const anchor = deriveAnchor(dir);
    try {
      if (email) {
        const ws = buildWorkspaceProfile(dataRef.current, anchor, Date.now());
        const body = wsBody(ws);
        if (body !== lastWsBodyRef.current) {
          setStatus('syncing');
          await writeWorkspaceProfile(workspaceProfilePath(dir, email), workspaceBackupPath(dir, email), ws);
          markWorkspace(ws.updatedAt, body);
        }
      }
      const lib = buildLibraryProfile(dataRef.current.libraries, anchor, Date.now());
      const libBody = JSON.stringify(lib.libraries);
      if (libBody !== lastLibBodyRef.current) {
        setStatus('syncing');
        await writeLibraryProfile(libraryListPath(dir), libraryListBackupPath(dir), lib);
        markLibrary(lib.updatedAt, libBody);
      }
      setStatus('synced');
    } catch (e) {
      setError(String(e));
      setStatus('error');
      pushToastRef.current(tRef.current.syncErrorWrite, 'error');
    }
  }, [markWorkspace, markLibrary]);

  // Startup / manual reconcile: newer of (local, remote) wins, per scope.
  const reconcile = useCallback(async () => {
    const { enabled: on, appDataDir: dir, userEmail: email, workspaceSyncedAt: wsAt, librarySyncedAt: libAt } =
      settingsRef.current;
    if (!on || !dir) {
      setStatus('idle');
      return;
    }
    reconcilingRef.current = true;
    setStatus('syncing');
    const anchor = deriveAnchor(dir);
    const spinePath = dataRef.current.appConfig.spinePath;
    let needReload = false;
    try {
      // --- workspace (per-user) — only when signed in ---
      if (email) {
        const wsPath = workspaceProfilePath(dir, email);
        const remote = await readWorkspaceProfile(wsPath);
        const local = buildWorkspaceProfile(dataRef.current, anchor, Date.now());
        const localBody = wsBody(local);
        if (!remote) {
          await writeWorkspaceProfile(wsPath, workspaceBackupPath(dir, email), local);
          markWorkspace(local.updatedAt, localBody);
        } else if (sameWorkspaceBody(remote, local)) {
          markWorkspace(remote.updatedAt, localBody);
        } else if (remote.updatedAt > (wsAt ?? 0)) {
          persistSyncSettings({ workspaceSyncedAt: remote.updatedAt });
          applyWorkspaceProfile(remote, anchor, spinePath);
          needReload = true;
        } else {
          await writeWorkspaceProfile(wsPath, workspaceBackupPath(dir, email), local);
          markWorkspace(local.updatedAt, localBody);
        }
      }

      // --- library list (shared) ---
      const libPath = libraryListPath(dir);
      const remoteLib = await readLibraryProfile(libPath);
      const localLib = buildLibraryProfile(dataRef.current.libraries, anchor, Date.now());
      const localLibBody = JSON.stringify(localLib.libraries);
      if (!remoteLib) {
        await writeLibraryProfile(libPath, libraryListBackupPath(dir), localLib);
        markLibrary(localLib.updatedAt, localLibBody);
      } else if (sameLibraryBody(remoteLib, localLib)) {
        markLibrary(remoteLib.updatedAt, localLibBody);
      } else if (remoteLib.updatedAt > (libAt ?? 0)) {
        persistSyncSettings({ librarySyncedAt: remoteLib.updatedAt });
        applyLibraryProfile(remoteLib, anchor);
        needReload = true;
      } else {
        await writeLibraryProfile(libPath, libraryListBackupPath(dir), localLib);
        markLibrary(localLib.updatedAt, localLibBody);
      }

      syncedOnceRef.current = true;
      setError(null);
      if (needReload) window.location.reload();
      else setStatus('synced');
    } catch (e) {
      setError(String(e));
      setStatus('error');
      pushToastRef.current(tRef.current.syncErrorRead, 'error');
    } finally {
      reconcilingRef.current = false;
    }
  }, [markWorkspace, markLibrary]);

  // Reconcile when sync becomes usable, and again whenever the identity (drive/email) changes.
  useEffect(() => {
    if (!connected) {
      setStatus('idle');
      return;
    }
    // New identity → re-establish baseline before any push can fire.
    syncedOnceRef.current = false;
    lastWsBodyRef.current = null;
    lastLibBodyRef.current = null;
    void reconcile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, appDataDir, userEmail]);

  // Debounce-write whenever the synced data changes (skip the initial mount render).
  const skipWriteRef = useRef(true);
  useEffect(() => {
    if (skipWriteRef.current) {
      skipWriteRef.current = false;
      return;
    }
    if (!connected) return;
    setStatus('pending');
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => void pushLocal(), DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [data.appConfig, data.projects, data.sessions, data.libraries, connected, pushLocal]);

  const setSyncEnabled = useCallback((value: boolean) => {
    setEnabled(value);
    persistSyncSettings({ enabled: value });
    settingsRef.current = { ...settingsRef.current, enabled: value };
    if (!value) setStatus('idle');
    else void reconcile();
  }, [reconcile]);

  const syncNow = useCallback(() => void reconcile(), [reconcile]);

  return {
    syncEnabled: enabled,
    syncLastSyncedAt: Math.max(workspaceSyncedAt ?? 0, librarySyncedAt ?? 0) || null,
    syncStatus: status,
    syncError: error,
    syncConnected: connected,
    /** Sync is on and the drive is mounted, but the user hasn't signed in → workspace can't sync. */
    syncNeedsSignIn: connected && !workspaceReady,
    setSyncEnabled,
    syncNow
  };
}
