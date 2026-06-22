import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { confirm, open } from '@tauri-apps/plugin-dialog';
import type { Library, LibraryCleanState, LibraryEntry, LibraryScan } from './config';
import type { Translations } from './i18n';
import type { FolderScan, ToastKind } from './types';
import { cleanRecordForEntry, scanRecordForEntry } from './library';
import {
  basename,
  clearLibraryScan,
  loadActiveLibraryId,
  loadLibraries,
  loadLibraryCleanState,
  loadLibraryScan,
  makeId,
  persistActiveLibraryId,
  persistLibraryCleanState,
  persistLibraries,
  persistLibraryScan
} from './sessions';

type Options = {
  t: Translations;
  pushToast: (text: string, kind?: ToastKind) => void;
};

/**
 * Asset Library: import a master folder, scan it (offline) into an inventory, and keep the
 * result cached per library so the dashboard survives restarts. Pure grouping/warning logic
 * lives in `library.ts`; this hook only owns state, persistence, and the Tauri scan call.
 */
export function useLibrary({ t, pushToast }: Options) {
  const [libraries, setLibraries] = useState<Library[]>(() => loadLibraries());
  const [activeLibraryId, setActiveLibraryId] = useState<string | null>(() => {
    const stored = loadActiveLibraryId();
    const all = loadLibraries();
    return stored && all.some((l) => l.id === stored) ? stored : all[0]?.id ?? null;
  });
  const [scan, setScan] = useState<LibraryScan | null>(() => {
    const id = loadActiveLibraryId();
    return id ? loadLibraryScan(id) : null;
  });
  const [cleanState, setCleanState] = useState<LibraryCleanState>(() => {
    const id = loadActiveLibraryId();
    return id ? loadLibraryCleanState(id) : {};
  });
  const [isScanning, setIsScanning] = useState(false);

  const activeLibrary = libraries.find((l) => l.id === activeLibraryId) ?? null;

  useEffect(() => {
    persistLibraries(libraries);
  }, [libraries]);

  useEffect(() => {
    persistActiveLibraryId(activeLibraryId);
  }, [activeLibraryId]);

  // Load the cached scan whenever the active library changes (e.g. switching libraries).
  useEffect(() => {
    setScan(activeLibraryId ? loadLibraryScan(activeLibraryId) : null);
    setCleanState(activeLibraryId ? loadLibraryCleanState(activeLibraryId) : {});
  }, [activeLibraryId]);

  // Auto-scan a library that has no cached inventory on THIS machine yet. The library *list* syncs
  // across machines (Firestore), but the per-machine scan cache does not — so after signing in on a
  // fresh machine the sidebar shows the folder while the inventory is empty until a scan runs. Do it
  // once per library id per session; runScan persists an (empty) scan even on a genuine no-match, so
  // a reachable-but-empty folder won't loop, and a failure (path unreachable) surfaces a toast and
  // isn't retried.
  const autoScannedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!activeLibrary || isScanning) return;
    const id = activeLibrary.id;
    if (autoScannedRef.current.has(id)) return;
    if (loadLibraryScan(id)) return; // already have a cached inventory on this machine
    autoScannedRef.current.add(id);
    void runScan(activeLibrary);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLibraryId, activeLibrary]);

  async function runScan(library: Library): Promise<LibraryScan | null> {
    setIsScanning(true);
    try {
      const result = await invoke<LibraryScan>('scan_library', { root: library.rootPath });
      persistLibraryScan(library.id, result);
      setScan(result);
      setLibraries((list) => list.map((l) => (l.id === library.id ? { ...l, lastScanAt: Date.now() } : l)));
      pushToast(t.libraryScanDone.replace('{count}', String(result.entries.length)), 'success');
      return result;
    } catch (error) {
      pushToast(`${t.libraryScanFailed}: ${String(error)}`, 'error');
      return null;
    } finally {
      setIsScanning(false);
    }
  }

  async function importLibrary() {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked !== 'string' || !picked.trim()) return;
    const root = picked.trim();
    // Reuse an existing library for the same root rather than duplicating it.
    const existing = libraries.find((l) => l.rootPath === root);
    if (existing) {
      setActiveLibraryId(existing.id);
      await runScan(existing);
      return;
    }
    const library: Library = {
      id: makeId(),
      name: basename(root) || root,
      rootPath: root,
      createdAt: Date.now(),
      lastScanAt: null
    };
    setLibraries((list) => [library, ...list]);
    setActiveLibraryId(library.id);
    await runScan(library);
  }

  async function rescan() {
    if (activeLibrary) return runScan(activeLibrary);
    return null;
  }

  function markLibraryEntriesClean(spineFiles: string[], sourceEntries: LibraryEntry[] = scan?.entries ?? []) {
    if (!activeLibraryId || spineFiles.length === 0) return;
    const selected = new Set(spineFiles);
    const cleanedAt = Date.now();
    setCleanState((current) => {
      const next: LibraryCleanState = { ...current };
      for (const entry of sourceEntries) {
        if (selected.has(entry.spineFile)) {
          next[entry.spineFile] = cleanRecordForEntry(entry, cleanedAt);
        }
      }
      persistLibraryCleanState(activeLibraryId, next);
      return next;
    });
  }

  function markLibraryEntriesScanned(units: FolderScan[], sourceEntries: LibraryEntry[] = scan?.entries ?? []) {
    if (!activeLibraryId || units.length === 0) return;
    const entriesBySpine = new Map(sourceEntries.map((entry) => [entry.spineFile, entry]));
    const scannedAt = Date.now();
    setCleanState((current) => {
      const next: LibraryCleanState = { ...current };
      for (const unit of units) {
        const entry = entriesBySpine.get(unit.spineFile);
        if (entry) next[unit.spineFile] = scanRecordForEntry(entry, unit.unused.length, unit.unusedBytes, scannedAt);
      }
      persistLibraryCleanState(activeLibraryId, next);
      return next;
    });
  }

  function selectLibrary(id: string) {
    setActiveLibraryId(id);
  }

  async function deleteLibrary(id: string) {
    const lib = libraries.find((l) => l.id === id);
    if (!lib) return;
    const ok = await confirm(t.libraryDeleteConfirm.replace('{name}', lib.name), {
      title: t.libraryDeleteLib,
      kind: 'warning'
    });
    if (!ok) return;
    clearLibraryScan(id);
    setLibraries((list) => {
      const remaining = list.filter((l) => l.id !== id);
      if (activeLibraryId === id) {
        const next = remaining[0]?.id ?? null;
        setActiveLibraryId(next);
      }
      return remaining;
    });
  }

  return {
    libraries,
    activeLibrary,
    activeLibraryId,
    libraryScan: scan,
    libraryCleanState: cleanState,
    isScanningLibrary: isScanning,
    importLibrary,
    rescanLibrary: rescan,
    markLibraryEntriesClean,
    markLibraryEntriesScanned,
    selectLibrary,
    deleteLibrary
  };
}
