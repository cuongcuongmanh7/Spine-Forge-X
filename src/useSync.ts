import { useCallback, useEffect, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import type { Translations } from './i18n';
import type { ToastKind } from './types';
import {
  buildProfile,
  applyProfile,
  loadSyncSettings,
  persistSyncSettings,
  readProfileFile,
  sameProfileBody,
  writeProfileFile,
  type SyncData
} from './sync';

export type SyncStatus = 'idle' | 'pending' | 'syncing' | 'synced' | 'error';

const DEBOUNCE_MS = 1500;

type Args = {
  data: SyncData;
  t: Translations;
  pushToast: (text: string, kind?: ToastKind) => void;
};

/**
 * Orchestrates Tier-A app-data sync: reconciles with the profile file on the Drive folder at
 * startup (newer-wins) and debounce-writes local edits back. Reconciliation that adopts a newer
 * remote profile reloads the window so the module-scope `loadPersistedState` re-runs with it.
 */
export function useSync({ data, t, pushToast }: Args) {
  const initial = loadSyncSettings();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [folder, setFolder] = useState(initial.folder);
  const [spineRoot, setSpineRoot] = useState(initial.spineRoot);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(initial.lastSyncedAt);
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  // Async callbacks read live values through refs so they never close over stale state.
  const dataRef = useRef(data);
  dataRef.current = data;
  const settingsRef = useRef({ enabled, folder, spineRoot, lastSyncedAt });
  settingsRef.current = { enabled, folder, spineRoot, lastSyncedAt };
  // Body of the profile we last read/wrote — lets the debounced writer skip no-op pushes.
  const lastBodyRef = useRef<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  // True while a reconcile is in flight; gates pushLocal so a slow startup read can't be
  // overtaken by a debounced write. syncedOnce guards against pushing this machine's (possibly
  // empty) local data up BEFORE the first reconcile established a baseline — which on a freshly
  // set-up machine would clobber the remote profile with nothing.
  const reconcilingRef = useRef(false);
  const syncedOnceRef = useRef(false);

  const connected = enabled && Boolean(folder) && Boolean(spineRoot);

  const markSynced = useCallback((at: number, body: string | null) => {
    persistSyncSettings({ lastSyncedAt: at });
    setLastSyncedAt(at);
    if (body !== null) lastBodyRef.current = body;
    syncedOnceRef.current = true;
    setError(null);
    setStatus('synced');
  }, []);

  // Push the local workspace up to the profile file (no reload). Skips identical content.
  const pushLocal = useCallback(async () => {
    const { folder: f, spineRoot: root } = settingsRef.current;
    if (!f || !root) return;
    // Never write before the first reconcile set a baseline, nor while one is running.
    if (reconcilingRef.current || !syncedOnceRef.current) return;
    const profile = buildProfile(dataRef.current, root, Date.now());
    const body = JSON.stringify({
      appConfig: profile.appConfig,
      projects: profile.projects,
      sessions: profile.sessions,
      libraries: profile.libraries
    });
    if (body === lastBodyRef.current) {
      setStatus('synced');
      return;
    }
    setStatus('syncing');
    try {
      await writeProfileFile(f, profile);
      markSynced(profile.updatedAt, body);
    } catch (e) {
      setError(String(e));
      setStatus('error');
      pushToast(t.syncErrorWrite, 'error');
    }
  }, [markSynced, pushToast, t]);

  // Startup / manual reconcile: newer of (local edits, remote profile) wins.
  const reconcile = useCallback(async () => {
    const { folder: f, spineRoot: root, lastSyncedAt: last } = settingsRef.current;
    if (!settingsRef.current.enabled || !f || !root) {
      setStatus('idle');
      return;
    }
    reconcilingRef.current = true;
    setStatus('syncing');
    try {
      const remote = await readProfileFile(f);
      const local = buildProfile(dataRef.current, root, Date.now());
      const localBody = JSON.stringify({
        appConfig: local.appConfig,
        projects: local.projects,
        sessions: local.sessions,
        libraries: local.libraries
      });
      if (!remote) {
        // First time: seed the Drive folder with our local workspace.
        await writeProfileFile(f, local);
        markSynced(local.updatedAt, localBody);
        return;
      }
      if (sameProfileBody(remote, local)) {
        // Already in agreement — just adopt the remote stamp, no write, no reload.
        markSynced(remote.updatedAt, localBody);
        return;
      }
      if (remote.updatedAt > (last ?? 0)) {
        // Remote changed since we last synced → it wins. Apply and reload to re-hydrate.
        // Keep reconcilingRef set: the reload tears everything down, no push should slip in.
        persistSyncSettings({ lastSyncedAt: remote.updatedAt });
        applyProfile(remote, root, dataRef.current.appConfig.spinePath);
        window.location.reload();
        return;
      }
      // Local is ahead of the last sync → push it up.
      await writeProfileFile(f, local);
      markSynced(local.updatedAt, localBody);
    } catch (e) {
      setError(String(e));
      setStatus('error');
      pushToast(t.syncErrorRead, 'error');
    } finally {
      // Safe to clear on the reload path too: syncedOnce is still false there, so pushLocal
      // stays guarded in the brief window before the page actually navigates away.
      reconcilingRef.current = false;
    }
  }, [markSynced, pushToast, t]);

  // Reconcile once on mount when sync is already configured.
  const didMountRef = useRef(false);
  useEffect(() => {
    if (didMountRef.current) return;
    didMountRef.current = true;
    if (connected) void reconcile();
    else setStatus('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const setSyncEnabled = useCallback(
    (value: boolean) => {
      setEnabled(value);
      persistSyncSettings({ enabled: value });
      if (value && folder && spineRoot) void reconcile();
      else setStatus('idle');
    },
    [folder, spineRoot, reconcile]
  );

  const chooseSyncFolder = useCallback(async () => {
    const picked = await open({ directory: true, multiple: false, defaultPath: folder || undefined });
    if (typeof picked !== 'string') return;
    setFolder(picked);
    persistSyncSettings({ folder: picked });
    if (enabled && spineRoot) void reconcile();
  }, [folder, enabled, spineRoot, reconcile]);

  const chooseSpineRoot = useCallback(async () => {
    const picked = await open({ directory: true, multiple: false, defaultPath: spineRoot || undefined });
    if (typeof picked !== 'string') return;
    setSpineRoot(picked);
    persistSyncSettings({ spineRoot: picked });
    if (enabled && folder) void reconcile();
  }, [spineRoot, enabled, folder, reconcile]);

  const syncNow = useCallback(() => void reconcile(), [reconcile]);

  return {
    syncEnabled: enabled,
    syncFolder: folder,
    syncSpineRoot: spineRoot,
    syncLastSyncedAt: lastSyncedAt,
    syncStatus: status,
    syncError: error,
    syncConnected: connected,
    /** Configured but missing the Spine root anchor — UI shows a banner. */
    syncNeedsSpineRoot: enabled && Boolean(folder) && !spineRoot,
    setSyncEnabled,
    chooseSyncFolder,
    chooseSpineRoot,
    syncNow
  };
}
