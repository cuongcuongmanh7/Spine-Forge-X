import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
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
 * Orchestrates Tier-A app-data sync. A single `root` (a shared Google Drive folder like
 * `G:\Shared drives`) is BOTH where the profile file lives AND the `${SPINE_ROOT}` rebasing
 * anchor. Sync defaults ON and auto-detects a "Shared drives" mount on first run. Reconciles
 * with the remote profile at startup (newer-wins) and debounce-writes local edits back; adopting
 * a newer remote reloads the window so module-scope `loadPersistedState` re-runs with it.
 */
export function useSync({ data, t, pushToast }: Args) {
  const initial = loadSyncSettings();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [root, setRoot] = useState(initial.root);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(initial.lastSyncedAt);
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  // Async callbacks read live values through refs so they never close over stale state.
  const dataRef = useRef(data);
  dataRef.current = data;
  const settingsRef = useRef({ enabled, root, lastSyncedAt });
  settingsRef.current = { enabled, root, lastSyncedAt };
  // t and pushToast are recreated every render by the controller; read them through refs so
  // pushLocal/reconcile keep a STABLE identity. Otherwise the debounce effect re-subscribes every
  // render and its cleanup cancels the pending timer before it can fire → stuck on "pending".
  const tRef = useRef(t);
  tRef.current = t;
  const pushToastRef = useRef(pushToast);
  pushToastRef.current = pushToast;
  // Body of the profile we last read/wrote — lets the debounced writer skip no-op pushes.
  const lastBodyRef = useRef<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  // True while a reconcile is in flight; gates pushLocal so a slow startup read can't be
  // overtaken by a debounced write. syncedOnce guards against pushing this machine's (possibly
  // empty) local data up BEFORE the first reconcile established a baseline — which on a freshly
  // set-up machine would clobber the remote profile with nothing.
  const reconcilingRef = useRef(false);
  const syncedOnceRef = useRef(false);

  const connected = enabled && Boolean(root);

  // Update state + storage + the ref synchronously, so a reconcile fired right after sees it.
  const applySetting = useCallback((patch: Partial<{ enabled: boolean; root: string }>) => {
    if (patch.enabled !== undefined) setEnabled(patch.enabled);
    if (patch.root !== undefined) setRoot(patch.root);
    persistSyncSettings(patch);
    settingsRef.current = { ...settingsRef.current, ...patch };
  }, []);

  const markSynced = useCallback((at: number, body: string | null) => {
    persistSyncSettings({ lastSyncedAt: at });
    setLastSyncedAt(at);
    settingsRef.current = { ...settingsRef.current, lastSyncedAt: at };
    if (body !== null) lastBodyRef.current = body;
    syncedOnceRef.current = true;
    setError(null);
    setStatus('synced');
  }, []);

  // Push the local workspace up to the profile file (no reload). Skips identical content.
  const pushLocal = useCallback(async () => {
    const { root: r } = settingsRef.current;
    if (!r) return;
    // Never write before the first reconcile set a baseline, nor while one is running.
    if (reconcilingRef.current || !syncedOnceRef.current) return;
    const profile = buildProfile(dataRef.current, r, Date.now());
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
      await writeProfileFile(r, profile);
      markSynced(profile.updatedAt, body);
    } catch (e) {
      setError(String(e));
      setStatus('error');
      pushToastRef.current(tRef.current.syncErrorWrite, 'error');
    }
  }, [markSynced]);

  // Startup / manual reconcile: newer of (local edits, remote profile) wins.
  const reconcile = useCallback(async () => {
    const { enabled: on, root: r, lastSyncedAt: last } = settingsRef.current;
    if (!on || !r) {
      setStatus('idle');
      return;
    }
    reconcilingRef.current = true;
    setStatus('syncing');
    try {
      const remote = await readProfileFile(r);
      const local = buildProfile(dataRef.current, r, Date.now());
      const localBody = JSON.stringify({
        appConfig: local.appConfig,
        projects: local.projects,
        sessions: local.sessions,
        libraries: local.libraries
      });
      if (!remote) {
        // First time: seed the Drive folder with our local workspace.
        await writeProfileFile(r, local);
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
        applyProfile(remote, r, dataRef.current.appConfig.spinePath);
        window.location.reload();
        return;
      }
      // Local is ahead of the last sync → push it up.
      await writeProfileFile(r, local);
      markSynced(local.updatedAt, localBody);
    } catch (e) {
      setError(String(e));
      setStatus('error');
      pushToastRef.current(tRef.current.syncErrorRead, 'error');
    } finally {
      // Safe to clear on the reload path too: syncedOnce is still false there, so pushLocal
      // stays guarded in the brief window before the page actually navigates away.
      reconcilingRef.current = false;
    }
  }, [markSynced]);

  // On mount: reconcile if a root is set, otherwise try to auto-detect a Shared drives mount.
  const didMountRef = useRef(false);
  useEffect(() => {
    if (didMountRef.current) return;
    didMountRef.current = true;
    if (!enabled) {
      setStatus('idle');
      return;
    }
    if (root) {
      void reconcile();
      return;
    }
    setStatus('idle');
    void (async () => {
      const detected = await invoke<string | null>('detect_drive_root').catch(() => null);
      if (detected) {
        applySetting({ root: detected });
        pushToastRef.current(`${tRef.current.syncAutoDetected}: ${detected}`);
        void reconcile();
      }
    })();
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
      applySetting({ enabled: value });
      if (value && settingsRef.current.root) void reconcile();
      else setStatus('idle');
    },
    [applySetting, reconcile]
  );

  const chooseRoot = useCallback(async () => {
    const picked = await open({ directory: true, multiple: false, defaultPath: root || undefined });
    if (typeof picked !== 'string') return;
    applySetting({ root: picked });
    if (settingsRef.current.enabled) void reconcile();
  }, [root, applySetting, reconcile]);

  const syncNow = useCallback(() => void reconcile(), [reconcile]);

  return {
    syncEnabled: enabled,
    syncRoot: root,
    syncLastSyncedAt: lastSyncedAt,
    syncStatus: status,
    syncError: error,
    syncConnected: connected,
    /** Enabled but no root resolved (auto-detect failed / not picked) — UI shows a banner. */
    syncNeedsRoot: enabled && !root,
    setSyncEnabled,
    chooseRoot,
    syncNow
  };
}
