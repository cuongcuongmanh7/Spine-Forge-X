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
import { readLibraryTagsRemote, seedLibraryTags, writeLibraryTagsEntry } from './libraryMetaSync';

// Tags + manual owner per asset. Storage moved from a plain-file sidecar on the Shared Drive to
// Firestore (`envs/{env}/library/tags`, namespaced by libraryId) — see
// docs/library-sidecar-firestore.md. A machine-local localStorage mirror still fronts it (instant
// paint, survives restart, readable offline). On open we pull the library's map from Firestore;
// each edit writes just the touched key back with a server-side merge, so a teammate's concurrent
// edit to a different asset is preserved without a read-before-write race.
//
// Signed out (or Firebase unconfigured): tags fall back to the local mirror only — like the shared
// library list, cross-machine tag sync now requires sign-in. The one time a signed-in machine finds
// the Firestore doc empty but the legacy file sidecar still on the mounted Drive, we seed it once so
// existing tags migrate with no manual step (the old file is left in place; PR5 removes it).

const LEGACY_META_FILE = 'spineforge-library-meta.json';

function mirrorKey(libraryId: string): string {
  return `spineforge.library.meta.${libraryId}`;
}

function loadLocalMeta(libraryId: string): LibraryMeta {
  try {
    const raw = localStorage.getItem(mirrorKey(libraryId));
    return raw ? (JSON.parse(raw) as LibraryMeta) : {};
  } catch {
    return {};
  }
}

function persistLocalMeta(libraryId: string, meta: LibraryMeta) {
  try {
    localStorage.setItem(mirrorKey(libraryId), JSON.stringify(meta));
  } catch {
    /* local mirror is best-effort */
  }
}

/** Read the legacy file sidecar (only for the one-time migration seed while it still exists). */
async function readLegacySidecar(folder: string): Promise<LibraryMeta> {
  if (!folder) return {};
  const win = folder.includes('\\') || /^[a-zA-Z]:/.test(folder);
  const path = folder.replace(/[\\/]+$/, '') + (win ? '\\' : '/') + LEGACY_META_FILE;
  const content = await invoke<string | null>('read_text_file', { path }).catch(() => null);
  if (!content) return {};
  try {
    const parsed = JSON.parse(content) as LibraryMeta;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

type Args = { libraryId: string; libraryDir: string; userUid: string | null };

/**
 * Library ▸ tags/ownership state. Kept out of LibraryInventory so that component stays thin.
 * `libraryId` namespaces the Firestore doc (and the local mirror); `userUid` gates Firestore access
 * (null → local-only); `libraryDir` is only used to locate the legacy file sidecar for the one-time
 * migration seed.
 */
export function useLibraryTags({ libraryId, libraryDir, userUid }: Args) {
  const [meta, setMeta] = useState<LibraryMeta>(() => loadLocalMeta(libraryId));

  // Pull the shared snapshot on open / when identity (library or signed-in user) changes.
  useEffect(() => {
    if (!userUid) return; // signed out → local mirror only
    let cancelled = false;
    void (async () => {
      let remote = await readLibraryTagsRemote(libraryId).catch(() => ({}) as LibraryMeta);
      // First signed-in machine after the migration: seed Firestore from the legacy file sidecar.
      if (Object.keys(remote).length === 0 && libraryDir) {
        const legacy = await readLegacySidecar(libraryDir);
        if (Object.keys(legacy).length > 0) {
          await seedLibraryTags(libraryId, legacy).catch(() => undefined);
          remote = legacy;
        }
      }
      if (cancelled || Object.keys(remote).length === 0) return;
      setMeta((prev) => {
        const next = { ...prev, ...remote }; // remote wins per key (shared source of truth)
        persistLocalMeta(libraryId, next);
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [libraryId, libraryDir, userUid]);

  // Apply a pure edit, persist the local mirror, then push just the touched key to Firestore.
  function commit(key: string, next: LibraryMeta) {
    setMeta(next);
    persistLocalMeta(libraryId, next);
    if (!userUid) return; // local-only when signed out
    void writeLibraryTagsEntry(libraryId, key, next[key]).catch(() => undefined);
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
