import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Translations } from './i18n';
import type { ToastKind } from './types';
import type { LibraryEntry } from './config';
import {
  downloadDriveRevision,
  fetchDriveBasics,
  fetchDriveFileMetadata,
  readDriveMetaSidecar,
  toDriveRelPath,
  writeDriveMetaSidecar,
  type DriveBasic,
  type DriveFileInfo,
  type DriveRevision
} from './drive';

// Machine-local cache of the dashboard's Drive columns (owner/last-modified), keyed by the
// machine-independent Drive relPath so it survives restarts AND works across machines (the synced
// sidecar file in the Drive folder carries it between office/home).
const DRIVE_BASICS_KEY = 'spineforge.library.driveBasics';
// When the user last pressed "Load Drive data" on this machine (shown under "Last scan").
const DRIVE_BASICS_AT_KEY = 'spineforge.library.driveBasicsLoadedAt';

function loadBasicsLoadedAt(): number | null {
  const raw = localStorage.getItem(DRIVE_BASICS_AT_KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

function loadDriveBasicsCache(): Record<string, DriveBasic> {
  try {
    const raw = localStorage.getItem(DRIVE_BASICS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, DriveBasic>) : {};
  } catch {
    return {};
  }
}

function persistBasics(map: Record<string, DriveBasic>) {
  try {
    localStorage.setItem(DRIVE_BASICS_KEY, JSON.stringify(map));
  } catch {
    /* local cache is best-effort */
  }
}

type Args = {
  t: Translations;
  pushToast: (text: string, kind?: ToastKind) => void;
  driveAccount: unknown | null;
  /** Shared `…\spine_app_data\library` folder — holds the drive-meta sidecar AND anchors the Drive
   *  relPath (deriveAnchor walks up to the Shared drives mount). Empty when the drive isn't mounted. */
  libraryDir: string;
  spinePath: string;
  openSettings: () => void;
};

type DriveInfoState = Record<
  string,
  { loading?: boolean; error?: string; notOnDrive?: boolean; data?: DriveFileInfo }
>;

/**
 * Library ▸ Drive metadata: the lazy per-row owner/history panel, the batch dashboard columns
 * (owner/last-modified, cached locally + synced via a sidecar in the Drive folder), and opening a
 * past revision in Spine. Kept out of LibraryInventory to keep that component thin.
 */
export function useLibraryDrive({ t, pushToast, driveAccount, libraryDir, spinePath, openSettings }: Args) {
  const [driveInfo, setDriveInfo] = useState<DriveInfoState>({});
  const [expandedInfo, setExpandedInfo] = useState<Set<string>>(new Set());
  const [driveBasics, setDriveBasics] = useState<Record<string, DriveBasic>>(loadDriveBasicsCache);
  const [loadingBasics, setLoadingBasics] = useState(false);
  const [basicsProgress, setBasicsProgress] = useState<{ done: number; total: number } | null>(null);
  const [basicsLoadedAt, setBasicsLoadedAt] = useState<number | null>(loadBasicsLoadedAt);

  // Merge the cross-machine snapshot from the Drive sidecar on open / when the folder changes.
  useEffect(() => {
    if (!libraryDir) return;
    let cancelled = false;
    void readDriveMetaSidecar(libraryDir).then((remote) => {
      if (cancelled || Object.keys(remote).length === 0) return;
      setDriveBasics((prev) => {
        const next = { ...prev, ...remote };
        persistBasics(next);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [libraryDir]);

  const basicFor = useCallback(
    (entry: LibraryEntry): DriveBasic | undefined => {
      const rel = toDriveRelPath(entry.spineFile, libraryDir);
      return rel ? driveBasics[rel] : undefined;
    },
    [driveBasics, libraryDir]
  );

  // Toggle the per-row Drive panel, fetching owner/history on first open.
  function toggleDriveInfo(entry: LibraryEntry) {
    const key = entry.spineFile;
    const willOpen = !expandedInfo.has(key);
    setExpandedInfo((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (!willOpen || driveInfo[key]?.data || driveInfo[key]?.loading) return;

    if (!driveAccount) {
      pushToast(t.driveSignInPrompt, 'warning');
      openSettings();
      return;
    }
    const relPath = toDriveRelPath(entry.spineFile, libraryDir);
    if (!relPath) {
      setDriveInfo((prev) => ({ ...prev, [key]: { notOnDrive: true } }));
      return;
    }
    setDriveInfo((prev) => ({ ...prev, [key]: { loading: true } }));
    fetchDriveFileMetadata(relPath)
      .then((data) => setDriveInfo((prev) => ({ ...prev, [key]: { data } })))
      .catch((e) => setDriveInfo((prev) => ({ ...prev, [key]: { error: String(e) } })));
  }

  // Batch-fetch owner + last-modified for the given rows; cache locally + sync via the sidecar.
  async function loadDriveBasics(entries: LibraryEntry[]) {
    if (!driveAccount) {
      pushToast(t.driveSignInPrompt, 'warning');
      openSettings();
      return;
    }
    const relPaths = entries
      .map((e) => toDriveRelPath(e.spineFile, libraryDir))
      .filter((r): r is string => Boolean(r));
    if (relPaths.length === 0) {
      pushToast(t.driveNotOnDrive, 'warning');
      return;
    }
    setLoadingBasics(true);
    setBasicsProgress({ done: 0, total: relPaths.length });
    // Live N/total feedback from the backend so a long batch isn't a silent spinner.
    const unlisten = await listen<{ done: number; total: number }>('drive-basics-progress', (e) => {
      setBasicsProgress(e.payload);
    });
    try {
      const results = await fetchDriveBasics(relPaths);
      const fresh: Record<string, DriveBasic> = {};
      for (const r of results) fresh[r.relPath] = r;
      setDriveBasics((prev) => {
        const next = { ...prev, ...fresh };
        persistBasics(next);
        return next;
      });
      // Sync to the shared sidecar. Re-read + merge so a concurrent writer's entries aren't dropped
      // (our just-fetched values win for the files we refreshed).
      if (libraryDir) {
        const remote = await readDriveMetaSidecar(libraryDir).catch(() => ({}) as Record<string, DriveBasic>);
        await writeDriveMetaSidecar(libraryDir, { ...remote, ...fresh }).catch(() => undefined);
      }
      const now = Date.now();
      setBasicsLoadedAt(now);
      localStorage.setItem(DRIVE_BASICS_AT_KEY, String(now));
    } catch (e) {
      pushToast(String(e), 'error');
    } finally {
      unlisten();
      setBasicsProgress(null);
      setLoadingBasics(false);
    }
  }

  // Download a past revision to temp and open it in Spine (regression review).
  async function openRevisionInSpine(entry: LibraryEntry, rev: DriveRevision) {
    const relPath = toDriveRelPath(entry.spineFile, libraryDir);
    if (!relPath) return;
    try {
      const localPath = await downloadDriveRevision(relPath, rev.id);
      await invoke('open_in_spine', { spinePath, file: localPath });
    } catch (e) {
      pushToast(`${t.libraryOpenFailed}: ${String(e)}`, 'error');
    }
  }

  return {
    driveInfo,
    expandedInfo,
    loadingBasics,
    basicsProgress,
    basicsLoadedAt,
    basicFor,
    toggleDriveInfo,
    loadDriveBasics,
    openRevisionInSpine
  };
}
