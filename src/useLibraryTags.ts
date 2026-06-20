import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { LibraryEntry } from './config';
import {
  addTag,
  allTags,
  metaKeyForEntry,
  removeTag,
  setOwner,
  type EntryMeta,
  type LibraryMeta
} from './library';

// Tags + manual owner per asset. Mirrors useLibraryDrive: a machine-local localStorage mirror
// (survives restart, works offline) PLUS a sidecar file in the synced Drive folder so the same
// tags appear on every machine and for every teammate. The sidecar is keyed by the
// machine-independent relPath and written merge-before-write so concurrent editors don't clobber.

const LIBRARY_META_KEY = 'spineforge.library.meta';
const LIBRARY_META_FILE = 'spineforge-library-meta.json';

function loadLocalMeta(): LibraryMeta {
  try {
    const raw = localStorage.getItem(LIBRARY_META_KEY);
    return raw ? (JSON.parse(raw) as LibraryMeta) : {};
  } catch {
    return {};
  }
}

function persistLocalMeta(meta: LibraryMeta) {
  try {
    localStorage.setItem(LIBRARY_META_KEY, JSON.stringify(meta));
  } catch {
    /* local mirror is best-effort */
  }
}

function metaFilePath(folder: string): string {
  const win = folder.includes('\\') || /^[a-zA-Z]:/.test(folder);
  const sep = win ? '\\' : '/';
  return folder.replace(/[\\/]+$/, '') + sep + LIBRARY_META_FILE;
}

async function readMetaSidecar(folder: string): Promise<LibraryMeta> {
  if (!folder) return {};
  const content = await invoke<string | null>('read_text_file', { path: metaFilePath(folder) }).catch(() => null);
  if (!content) return {};
  try {
    const parsed = JSON.parse(content) as LibraryMeta;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeMetaSidecar(folder: string, meta: LibraryMeta): Promise<void> {
  if (!folder) return;
  await invoke('write_text_file', { path: metaFilePath(folder), content: JSON.stringify(meta) });
}

type Args = { syncRoot: string; syncConnected: boolean };

/**
 * Library ▸ tags/ownership state. Kept out of LibraryInventory so that component stays thin.
 * Every edit updates the local mirror immediately, then (when synced) re-reads the sidecar and
 * writes back only the touched key on top of the latest remote — so a teammate's concurrent edit
 * to a different asset is preserved.
 */
export function useLibraryTags({ syncRoot, syncConnected }: Args) {
  const [meta, setMeta] = useState<LibraryMeta>(loadLocalMeta);

  // Merge the cross-machine snapshot from the sidecar on open / when the folder changes.
  useEffect(() => {
    if (!syncConnected || !syncRoot) return;
    let cancelled = false;
    void readMetaSidecar(syncRoot).then((remote) => {
      if (cancelled || Object.keys(remote).length === 0) return;
      setMeta((prev) => {
        // Remote wins for keys it carries (it's the shared source of truth across the team).
        const next = { ...prev, ...remote };
        persistLocalMeta(next);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [syncConnected, syncRoot]);

  // Apply a pure edit, persist locally, then push just the touched key to the shared sidecar.
  function commit(key: string, next: LibraryMeta) {
    setMeta(next);
    persistLocalMeta(next);
    if (!syncConnected || !syncRoot) return;
    void (async () => {
      const remote = await readMetaSidecar(syncRoot).catch(() => ({}) as LibraryMeta);
      const merged = { ...remote };
      if (next[key]) merged[key] = next[key];
      else delete merged[key];
      await writeMetaSidecar(syncRoot, merged).catch(() => undefined);
    })();
  }

  function addEntryTag(entry: LibraryEntry, tag: string) {
    const key = metaKeyForEntry(entry);
    commit(key, addTag(meta, key, tag));
  }

  function removeEntryTag(entry: LibraryEntry, tag: string) {
    const key = metaKeyForEntry(entry);
    commit(key, removeTag(meta, key, tag));
  }

  function setEntryOwner(entry: LibraryEntry, owner: string) {
    const key = metaKeyForEntry(entry);
    commit(key, setOwner(meta, key, owner));
  }

  // Stable across renders (until meta changes) so callers can safely list it in effect/memo deps.
  const metaFor = useCallback((entry: LibraryEntry): EntryMeta | undefined => meta[metaKeyForEntry(entry)], [meta]);

  return {
    meta,
    tagList: allTags(meta),
    metaFor,
    addEntryTag,
    removeEntryTag,
    setEntryOwner
  };
}

export type LibraryTagsApi = ReturnType<typeof useLibraryTags>;
