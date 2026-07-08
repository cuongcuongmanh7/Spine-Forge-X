import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { confirm, open } from '@tauri-apps/plugin-dialog';
import type { ExportAssets, Library, LibraryCleanState, LibraryEntry, LibraryScan } from './config';
import { readSkeletonNames } from './spineRuntime';
import type { Translations } from './i18n';
import type { FolderScan, ToastKind } from './types';
import { cleanRecordForEntry, scanRecordForEntry, topFolder } from './library';
import {
  basename,
  clearLibraryScan,
  loadActiveLibraryId,
  loadLibraries,
  loadLibraryCleanState,
  loadLibraryScan,
  loadLibraryTrash,
  makeId,
  persistActiveLibraryId,
  persistLibraryCleanState,
  persistLibraries,
  persistLibraryScan,
  persistLibraryTrash
} from './sessions';

type Options = {
  t: Translations;
  pushToast: (text: string, kind?: ToastKind) => void;
};

// Trash holds two kinds of keys in one set (so it rides the existing string[] sync untouched):
// a plain `relPath` hides a single file; a `dir:{topFolder}` key hides a whole top-level folder
// (and any files added to it later). Notes use the same `dir:` convention for folder targets.
const FOLDER_TRASH_PREFIX = 'dir:';
const folderTrashKey = (folderName: string) => FOLDER_TRASH_PREFIX + folderName;

/** Is this entry hidden — either trashed by its own relPath, or because its top folder is trashed? */
function isEntryTrashed(entry: LibraryEntry, trash: Set<string>): boolean {
  return trash.has(entry.relPath) || trash.has(folderTrashKey(topFolder(entry)));
}

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
  // Per-library "trash": relPaths the user excluded. Hidden from inventory/clean + skipped on rescan,
  // until restored. Synced across the team (see sync.ts / useSync).
  const [trash, setTrash] = useState<Set<string>>(() => {
    const id = loadActiveLibraryId();
    return new Set(id ? loadLibraryTrash(id) : []);
  });

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
    setTrash(new Set(activeLibraryId ? loadLibraryTrash(activeLibraryId) : []));
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

  // Backfill anim/skin names for 4.x BINARY exports. The Rust scanner only reads names from JSON
  // or 3.8 binary, so 4.x `.skel`/`.skel.bytes` units come back with empty lists — we parse them
  // here with the version-matched runtime (no WebGL) and patch the cached scan so counts, sort,
  // search and the expand panels all work. Each unit is attempted once per session; results are
  // persisted into the scan cache, so an enriched unit (now has names) is skipped next time.
  const enrichedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!scan || !activeLibraryId) return;
    const libId = activeLibraryId;
    const pending = scan.entries.filter(
      (e) =>
        e.exported &&
        e.animations.length === 0 &&
        (e.version?.startsWith('4') ?? false) &&
        !enrichedRef.current.has(e.spineFile)
    );
    if (pending.length === 0) return;
    pending.forEach((e) => enrichedRef.current.add(e.spineFile));

    let cancelled = false;
    void (async () => {
      const patch = new Map<string, { animations: string[]; skins: string[] }>();
      // Bounded concurrency so a big library doesn't open hundreds of parses at once.
      const queue = [...pending];
      const worker = async () => {
        for (let entry = queue.shift(); entry; entry = queue.shift()) {
          try {
            const assets = await invoke<ExportAssets>('list_export_assets', { folder: entry.folder });
            const names = await readSkeletonNames(assets);
            if (names.animations.length || names.skins.length) patch.set(entry.spineFile, names);
          } catch {
            /* unreadable/odd export — leave it empty, it just won't list anims */
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(5, queue.length) }, worker));
      if (cancelled || patch.size === 0) return;
      setScan((prev) => {
        if (!prev) return prev;
        const entries = prev.entries.map((e) => {
          const names = patch.get(e.spineFile);
          return names ? { ...e, animations: names.animations, skins: names.skins, animationCount: names.animations.length } : e;
        });
        const next = { ...prev, entries };
        persistLibraryScan(libId, next);
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [scan, activeLibraryId]);

  // `silent` suppresses the success toast — used by automatic rescans (the Drive/FS watcher and the
  // post-clean refresh) so they don't pop a "Scanned N files" toast over a finished action. Errors
  // still surface. Only the manual Rescan button leaves it false.
  async function runScan(library: Library, silent = false): Promise<LibraryScan | null> {
    setIsScanning(true);
    try {
      const result = await invoke<LibraryScan>('scan_library', { root: library.rootPath });
      persistLibraryScan(library.id, result);
      setScan(result);
      setLibraries((list) => list.map((l) => (l.id === library.id ? { ...l, lastScanAt: Date.now() } : l)));
      if (!silent) {
        pushToast(t.libraryScanDone.replace('{count}', String(result.entries.length)), 'success');
        // Light notice: how many freshly-scanned entries are auto-hidden by the trash list. Read trash
        // straight from storage so the count is right even when `library` isn't the active one yet.
        const trashed = new Set(loadLibraryTrash(library.id));
        const hidden = result.entries.filter((e) => isEntryTrashed(e, trashed)).length;
        if (hidden > 0) pushToast(t.libraryTrashHidden.replace('{n}', String(hidden)), 'info');
      }
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

  async function rescan(silent = false) {
    if (activeLibrary) return runScan(activeLibrary, silent);
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

  // Exclude an entry from the inventory (move to trash). Identity is `relPath` so it survives rescans.
  function addToTrash(entry: LibraryEntry) {
    if (!activeLibraryId) return;
    setTrash((prev) => {
      if (prev.has(entry.relPath)) return prev;
      const next = new Set(prev);
      next.add(entry.relPath);
      persistLibraryTrash(activeLibraryId, [...next]);
      return next;
    });
  }

  // Exclude several entries at once (bulk "move to trash" from the multi-select inspector). One state
  // update + one persist for the whole batch, so it stays atomic even for large selections.
  function addManyToTrash(entries: LibraryEntry[]) {
    if (!activeLibraryId || entries.length === 0) return;
    setTrash((prev) => {
      const next = new Set(prev);
      for (const e of entries) next.add(e.relPath);
      if (next.size === prev.size) return prev;
      persistLibraryTrash(activeLibraryId, [...next]);
      return next;
    });
  }

  // Exclude a whole top-level folder from the inventory. Stored as a `dir:` key so files added to the
  // folder later are hidden too, and the folder restores as a single unit.
  function addFolderToTrash(folderName: string) {
    if (!activeLibraryId) return;
    const key = folderTrashKey(folderName);
    setTrash((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      persistLibraryTrash(activeLibraryId, [...next]);
      return next;
    });
  }

  // Remove a key (file relPath OR `dir:` folder key) from the trash, un-hiding what it covered.
  function restoreFromTrash(key: string) {
    if (!activeLibraryId) return;
    setTrash((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      persistLibraryTrash(activeLibraryId, [...next]);
      return next;
    });
  }

  function restoreFolderFromTrash(folderName: string) {
    restoreFromTrash(folderTrashKey(folderName));
  }

  // Re-read the active library's trash from localStorage (after sync adopts a teammate's newer list).
  function reloadTrash() {
    setTrash(new Set(activeLibraryId ? loadLibraryTrash(activeLibraryId) : []));
  }

  // Inventory/clean see the scan with trashed entries removed; the full list stays in `scan` for the
  // restore view and internal bookkeeping.
  const visibleScan = useMemo<LibraryScan | null>(() => {
    if (!scan || trash.size === 0) return scan;
    return { ...scan, entries: scan.entries.filter((e) => !isEntryTrashed(e, trash)) };
  }, [scan, trash]);
  const trashedEntries = useMemo(
    () => (scan ? scan.entries.filter((e) => isEntryTrashed(e, trash)) : []),
    [scan, trash]
  );
  // Folders currently in trash, with how many scanned entries each hides — drives the folder rows in
  // the trash modal. A `dir:` key can outlive its files (folder emptied/renamed), so count may be 0.
  const trashedFolders = useMemo(
    () =>
      [...trash]
        .filter((k) => k.startsWith(FOLDER_TRASH_PREFIX))
        .map((k) => k.slice(FOLDER_TRASH_PREFIX.length))
        .map((name) => ({ name, count: scan ? scan.entries.filter((e) => topFolder(e) === name).length : 0 }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [scan, trash]
  );
  // Individually-trashed files, excluding any whose folder is also trashed (those restore via the folder
  // row instead, so we don't list them twice).
  const trashedFiles = useMemo(
    () => (scan ? scan.entries.filter((e) => trash.has(e.relPath) && !trash.has(folderTrashKey(topFolder(e)))) : []),
    [scan, trash]
  );

  // Re-read the active library's clean-state from localStorage into memory. Used after sync adopts a
  // teammate's newer clean-state (written to localStorage by `applyLibraryCleanProfile`) so the
  // inventory stats recompute without a window reload. Mirrors the active-library load effect above.
  function reloadCleanState() {
    setCleanState(activeLibraryId ? loadLibraryCleanState(activeLibraryId) : {});
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
    libraryScan: visibleScan,
    libraryCleanState: cleanState,
    isScanningLibrary: isScanning,
    importLibrary,
    rescanLibrary: rescan,
    markLibraryEntriesClean,
    markLibraryEntriesScanned,
    selectLibrary,
    deleteLibrary,
    reloadCleanState,
    libraryTrash: trash,
    trashedEntries,
    trashedFolders,
    trashedFiles,
    addToTrash,
    addManyToTrash,
    addFolderToTrash,
    restoreFromTrash,
    restoreFolderFromTrash,
    reloadTrash
  };
}
