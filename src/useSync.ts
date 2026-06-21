import { useCallback, useEffect, useRef, useState } from 'react';
import type { Translations } from './i18n';
import type { ToastKind } from './types';
import {
  applyLibraryProfile,
  applyWorkspaceProfile,
  buildLibraryProfile,
  buildWorkspaceProfile,
  deriveAnchor,
  loadSyncSettings,
  persistSyncSettings,
  readLibraryProfile,
  readWorkspaceProfile,
  sameLibraryBody,
  sameWorkspaceBody,
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
  /** Shared app-data root (`…\Pamvis\spine_app_data`), auto-detected; null if the drive isn't
   *  mounted. Still required: it's where the `${SPINE_ROOT}` rebase anchor is derived from. */
  appDataDir: string | null;
  /** Firebase Auth uid of the signed-in user — keys this user's workspace doc; null if signed out. */
  userUid: string | null;
  /** Whether this user may curate the shared library list. Members are pull-only on that scope. */
  isLeader: boolean;
};

/**
 * Orchestrates Tier-A sync v2 over Firestore. Two scopes reconcile independently (newer-wins): the
 * per-user WORKSPACE doc (keyed by the signed-in Firebase uid) and the shared LIBRARY list doc.
 * Reconciles at startup / on identity change, and debounce-writes local edits; adopting a newer
 * remote reloads the window so module-scope `loadPersistedState` re-runs with it. The app-data root
 * is still needed to derive the `${SPINE_ROOT}` rebase anchor for source paths.
 */
export function useSync({ data, t, pushToast, appDataDir, userUid, isLeader }: Args) {
  const initial = loadSyncSettings();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [workspaceSyncedAt, setWorkspaceSyncedAt] = useState<number | null>(initial.workspaceSyncedAt);
  const [librarySyncedAt, setLibrarySyncedAt] = useState<number | null>(initial.librarySyncedAt);

  // Workspace sync needs both the shared drive (for the rebase anchor) AND a signed-in Firebase
  // identity; the library list only needs the drive.
  const connected = enabled && Boolean(appDataDir);
  const workspaceReady = connected && Boolean(userUid);

  // Async callbacks read live values through refs so they never close over stale state.
  const dataRef = useRef(data);
  dataRef.current = data;
  const settingsRef = useRef({ enabled, appDataDir, userUid, isLeader, workspaceSyncedAt, librarySyncedAt });
  settingsRef.current = { enabled, appDataDir, userUid, isLeader, workspaceSyncedAt, librarySyncedAt };
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
  // Set while we're about to reload after adopting a newer remote — blocks pushLocal in the brief
  // window before the page navigates away (we show a toast first so the reload isn't a surprise).
  const reloadingRef = useRef(false);

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
    const { appDataDir: dir, userUid: uid, isLeader: leader } = settingsRef.current;
    // Firestore writes require a Firebase session (rules), so both scopes need sign-in now.
    if (!dir || !uid) return;
    if (reconcilingRef.current || reloadingRef.current || !syncedOnceRef.current) return;
    const anchor = deriveAnchor(dir);
    try {
      {
        const ws = buildWorkspaceProfile(dataRef.current, anchor, Date.now());
        const body = wsBody(ws);
        if (body !== lastWsBodyRef.current) {
          setStatus('syncing');
          const at = await writeWorkspaceProfile(ws);
          markWorkspace(at, body);
        }
      }
      // Library list is leader-curated: only a leader writes it (members are pull-only, and the
      // Firestore rule would reject their write anyway).
      if (leader) {
        const lib = buildLibraryProfile(dataRef.current.libraries, anchor, Date.now());
        const libBody = JSON.stringify(lib.libraries);
        if (libBody !== lastLibBodyRef.current) {
          setStatus('syncing');
          const at = await writeLibraryProfile(lib);
          markLibrary(at, libBody);
        }
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
    const { enabled: on, appDataDir: dir, userUid: uid, isLeader: leader, workspaceSyncedAt: wsAt, librarySyncedAt: libAt } =
      settingsRef.current;
    // Firestore needs the shared drive (for the rebase anchor) AND a Firebase session (rules gate
    // every read/write). Signed out → nothing to reconcile; the badge shows "needs sign-in".
    if (!on || !dir || !uid) {
      setStatus('idle');
      return;
    }
    reconcilingRef.current = true;
    setStatus('syncing');
    const anchor = deriveAnchor(dir);
    const spinePath = dataRef.current.appConfig.spinePath;
    let needReload = false;
    try {
      // --- workspace (per-user) ---
      {
        const remote = await readWorkspaceProfile();
        const local = buildWorkspaceProfile(dataRef.current, anchor, Date.now());
        const localBody = wsBody(local);
        if (!remote) {
          const at = await writeWorkspaceProfile(local);
          markWorkspace(at, localBody);
        } else if (sameWorkspaceBody(remote, local)) {
          markWorkspace(remote.updatedAt, localBody);
        } else if (remote.updatedAt > (wsAt ?? 0)) {
          persistSyncSettings({ workspaceSyncedAt: remote.updatedAt });
          applyWorkspaceProfile(remote, anchor, spinePath);
          needReload = true;
        } else {
          const at = await writeWorkspaceProfile(local);
          markWorkspace(at, localBody);
        }
      }

      // --- library list (shared, leader-curated) ---
      const remoteLib = await readLibraryProfile();
      const localLib = buildLibraryProfile(dataRef.current.libraries, anchor, Date.now());
      const localLibBody = JSON.stringify(localLib.libraries);
      if (leader) {
        // Leader: full newer-wins (seed / push / pull).
        if (!remoteLib) {
          const at = await writeLibraryProfile(localLib);
          markLibrary(at, localLibBody);
        } else if (sameLibraryBody(remoteLib, localLib)) {
          markLibrary(remoteLib.updatedAt, localLibBody);
        } else if (remoteLib.updatedAt > (libAt ?? 0)) {
          persistSyncSettings({ librarySyncedAt: remoteLib.updatedAt });
          applyLibraryProfile(remoteLib, anchor);
          needReload = true;
        } else {
          const at = await writeLibraryProfile(localLib);
          markLibrary(at, localLibBody);
        }
      } else if (remoteLib) {
        // Member: pull-only — the leader's list is authoritative; never write.
        if (sameLibraryBody(remoteLib, localLib)) {
          markLibrary(remoteLib.updatedAt, localLibBody);
        } else if (remoteLib.updatedAt > (libAt ?? 0)) {
          persistSyncSettings({ librarySyncedAt: remoteLib.updatedAt });
          applyLibraryProfile(remoteLib, anchor);
          needReload = true;
        }
        // else: local diverges but remote isn't newer (e.g. member's stale lastScanAt) → leave it.
      }
      // Member with no remote yet → nothing to do until the leader seeds the list.

      syncedOnceRef.current = true;
      setError(null);
      if (needReload) {
        // Adopted a newer remote → re-hydrate via reload. Flag it + toast first so the user knows
        // why the window refreshes, then reload after a beat (long enough to read the toast).
        reloadingRef.current = true;
        setStatus('syncing');
        pushToastRef.current(tRef.current.syncPullingRemote);
        window.setTimeout(() => window.location.reload(), 800);
      } else {
        setStatus('synced');
      }
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
  }, [connected, appDataDir, userUid]);

  // Debounce-write whenever the synced data changes (skip the initial mount render).
  const skipWriteRef = useRef(true);
  useEffect(() => {
    if (skipWriteRef.current) {
      skipWriteRef.current = false;
      return;
    }
    if (!workspaceReady) return; // can't write to Firestore without a Firebase session
    setStatus('pending');
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => void pushLocal(), DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [data.appConfig, data.projects, data.sessions, data.libraries, workspaceReady, pushLocal]);

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
