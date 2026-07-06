import { useCallback, useEffect, useState } from 'react';
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
import { subscribeLibraryTagsRemote, writeLibraryTagsEntry } from './libraryMetaSync';

// Tags + manual owner per asset. Storage lives in Firestore (`envs/{env}/library/tags`, namespaced
// by libraryId) — see docs/library-sidecar-firestore.md. A machine-local localStorage mirror fronts
// it (instant paint, survives restart, readable offline). On open we pull the library's map from
// Firestore; each edit writes just the touched key back with a server-side merge, so a teammate's
// concurrent edit to a different asset is preserved without a read-before-write race.
//
// Signed out (or Firebase unconfigured): tags fall back to the local mirror only — like the shared
// library list, cross-machine tag sync requires sign-in.

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

type Args = { libraryId: string; userUid: string | null };

/**
 * Library ▸ tags/ownership state. Kept out of LibraryInventory so that component stays thin.
 * `libraryId` namespaces the Firestore doc (and the local mirror); `userUid` gates Firestore access
 * (null → local-only).
 */
export function useLibraryTags({ libraryId, userUid }: Args) {
  const [meta, setMeta] = useState<LibraryMeta>(() => loadLocalMeta(libraryId));

  // Subscribe to the shared doc so a teammate's tag/owner edit (add, remove, or reassign) shows live
  // without reopening the tab. The doc's `byLibrary[libraryId]` is the full authoritative map, so we
  // replace state with it (deletes propagate too); the localStorage mirror only fronts the first
  // paint before the snapshot arrives. Our own edits round-trip through the same snapshot (Firestore
  // latency-compensates pending writes, so no flicker).
  useEffect(() => {
    if (!userUid) return; // signed out → local mirror only
    return subscribeLibraryTagsRemote(libraryId, (remote) => {
      setMeta(remote);
      persistLocalMeta(libraryId, remote);
    });
  }, [libraryId, userUid]);

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
