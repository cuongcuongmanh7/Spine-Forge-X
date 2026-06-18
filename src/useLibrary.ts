import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { confirm, open } from '@tauri-apps/plugin-dialog';
import type { Library, LibraryScan } from './config';
import type { Translations } from './i18n';
import type { ToastKind } from './types';
import {
  basename,
  clearLibraryScan,
  loadActiveLibraryId,
  loadLibraries,
  loadLibraryScan,
  makeId,
  persistActiveLibraryId,
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
  const [libraryOpen, setLibraryOpen] = useState(false);
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
  }, [activeLibraryId]);

  async function runScan(library: Library) {
    setIsScanning(true);
    try {
      const result = await invoke<LibraryScan>('scan_library', { root: library.rootPath });
      persistLibraryScan(library.id, result);
      setScan(result);
      setLibraries((list) => list.map((l) => (l.id === library.id ? { ...l, lastScanAt: Date.now() } : l)));
      pushToast(t.libraryScanDone.replace('{count}', String(result.entries.length)), 'success');
    } catch (error) {
      pushToast(`${t.libraryScanFailed}: ${String(error)}`, 'error');
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
    if (activeLibrary) await runScan(activeLibrary);
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
    libraryOpen,
    setLibraryOpen,
    libraries,
    activeLibrary,
    activeLibraryId,
    libraryScan: scan,
    isScanningLibrary: isScanning,
    importLibrary,
    rescanLibrary: rescan,
    selectLibrary,
    deleteLibrary
  };
}
