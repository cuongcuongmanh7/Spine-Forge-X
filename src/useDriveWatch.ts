import { useEffect, useMemo, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { LibraryEntry } from './config';
import { toDriveRelPath } from './drive';
import type { DriveChange } from './useDriveNotifications';

type Args = {
  /** Signed in to Google Drive — watching is pointless otherwise. */
  enabled: boolean;
  /** Anchors `toDriveRelPath`; the folder under the Shared drives mount. */
  libraryDir: string;
  /** Local library root to filesystem-watch for added/removed `.spine` files. */
  rootPath: string;
  /** Current inventory rows — used to map a change's relPath back to a row. */
  entries: LibraryEntry[];
  /** Silently refresh owner/last-modified for the given rows (edit/rename). */
  refreshBasics: (rows: LibraryEntry[]) => void;
  /** Re-scan the inventory (a `.spine` was added/removed on disk). */
  rescanLibrary: () => void;
  /** Push classified changes into the notification store. */
  onChanges: (changes: DriveChange[]) => void;
};

/**
 * Auto-detect Drive changes while the Library tab is open: a Changes-API poller (owner/last-modified
 * edits, renames, deletes, adds) plus a filesystem watcher (added/removed `.spine`). Starts the
 * backend watchers on mount, pauses them while the window is unfocused, and stops on unmount.
 * Edits/renames trigger a silent metadata refresh; add/remove trigger a rescan; everything surfaces
 * as a notification. Mounted only inside the Library tab, so it naturally runs only there.
 */
export function useDriveWatch({
  enabled,
  libraryDir,
  rootPath,
  entries,
  refreshBasics,
  rescanLibrary,
  onChanges
}: Args) {
  // Latest values for the long-lived event listeners (so we don't re-subscribe every render).
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const refreshRef = useRef(refreshBasics);
  refreshRef.current = refreshBasics;
  const rescanRef = useRef(rescanLibrary);
  rescanRef.current = rescanLibrary;
  const changesRef = useRef(onChanges);
  changesRef.current = onChanges;

  // Distinct shared-drive names the inventory spans (the first path segment of each Drive relPath).
  const driveNamesKey = useMemo(() => {
    if (!libraryDir) return '';
    const names = new Set<string>();
    for (const e of entries) {
      const seg = toDriveRelPath(e.spineFile, libraryDir)?.split('/')[0];
      if (seg) names.add(seg);
    }
    return Array.from(names).sort().join('|');
  }, [entries, libraryDir]);

  // Subscribe to backend events for the lifetime of the tab; closures read refs for fresh data.
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const unlistens: Array<() => void> = [];
    const keep = (u: () => void) => (disposed ? u() : unlistens.push(u));

    void listen<{ changes: DriveChange[] }>('drive-changes', (e) => {
      const changes = e.payload?.changes ?? [];
      if (!changes.length) return;
      changesRef.current(changes);
      // Silently refresh owner/last-modified for the affected tracked rows (edit/rename only).
      const affected = new Set(
        changes.filter((c) => c.action === 'edit' || c.action === 'rename').map((c) => c.relPath)
      );
      if (!affected.size) return;
      const rows = entriesRef.current.filter((row) => {
        const rel = toDriveRelPath(row.spineFile, libraryDir);
        return rel ? affected.has(rel) : false;
      });
      if (rows.length) refreshRef.current(rows);
    }).then(keep);

    let rescanTimer: number | undefined;
    void listen('library-fs-changed', () => {
      // Backend already debounced ~2s; a short extra debounce coalesces any residual bursts.
      window.clearTimeout(rescanTimer);
      rescanTimer = window.setTimeout(() => rescanRef.current(), 500);
    }).then(keep);

    return () => {
      disposed = true;
      window.clearTimeout(rescanTimer);
      for (const u of unlistens) u();
    };
  }, [enabled, libraryDir]);

  // Start/stop the backend watchers; pause while the window is unfocused (option: only while open).
  useEffect(() => {
    if (!enabled) return;
    let active = false;

    const start = () => {
      if (active) return;
      active = true;
      const names = driveNamesKey ? driveNamesKey.split('|') : [];
      if (names.length) void invoke('drive_watch_start', { driveNames: names }).catch(() => {});
      if (rootPath) void invoke('library_watch_start', { root: rootPath }).catch(() => {});
    };
    const stop = () => {
      if (!active) return;
      active = false;
      void invoke('drive_watch_stop').catch(() => {});
      void invoke('library_watch_stop').catch(() => {});
    };

    start();
    let unfocus: (() => void) | undefined;
    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => (focused ? start() : stop()))
      .then((u) => (unfocus = u));

    return () => {
      stop();
      unfocus?.();
    };
  }, [enabled, driveNamesKey, rootPath]);
}
