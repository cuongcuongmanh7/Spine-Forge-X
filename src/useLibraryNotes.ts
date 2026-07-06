import { useCallback, useEffect, useState } from 'react';
import {
  addNote,
  mergeNoteArrays,
  noteCount,
  notesFor,
  removeNote,
  setNoteResolved,
  unresolvedCount,
  type LibraryNote,
  type LibraryNotes
} from './library';
import { readLibraryNotesRemote, subscribeLibraryNotesRemote, writeLibraryNotesEntry } from './libraryMetaSync';

// Notes/comments on Library files & folders. Same shape as useLibraryTags: storage lives in
// Firestore (`envs/{env}/library/notes`, namespaced by libraryId — see
// docs/library-sidecar-firestore.md), fronted by a local mirror. Difference vs tags: notes are
// arrays, so on push we *union by note id* (mergeNoteArrays) with the latest remote for that one key
// instead of overwriting — two leaders annotating the same target don't clobber. Firestore can't
// union array contents itself, so we read the key's current array first, then write the merged
// result back (a read-before-write scoped to one key).

function mirrorKey(libraryId: string): string {
  return `spineforge.library.notes.${libraryId}`;
}

function loadLocalNotes(libraryId: string): LibraryNotes {
  try {
    const raw = localStorage.getItem(mirrorKey(libraryId));
    return raw ? (JSON.parse(raw) as LibraryNotes) : {};
  } catch {
    return {};
  }
}

function persistLocalNotes(libraryId: string, notes: LibraryNotes) {
  try {
    localStorage.setItem(mirrorKey(libraryId), JSON.stringify(notes));
  } catch {
    /* local mirror is best-effort */
  }
}

type Args = { libraryId: string; userUid: string | null; authorEmail: string; isLeader: boolean };

/**
 * Library ▸ file/folder notes state. Kept out of LibraryInventory so that component stays thin.
 * `libraryId` namespaces the Firestore doc + mirror; `userUid` gates Firestore (null → local-only).
 * `authorEmail`/`isLeader` decide authorship and who may delete a note (UI gate only — rules don't
 * enforce it).
 */
export function useLibraryNotes({ libraryId, userUid, authorEmail, isLeader }: Args) {
  const [notes, setNotes] = useState<LibraryNotes>(() => loadLocalNotes(libraryId));

  // Subscribe to the shared doc so a teammate's note (add, delete, resolve) shows live without
  // reopening the tab. `byLibrary[libraryId]` is the full authoritative notes map — replace state
  // with it; the localStorage mirror only fronts the first paint. Our own edits round-trip through
  // the same snapshot (latency-compensated), and the commit path unions by id before writing so a
  // concurrent writer isn't clobbered.
  useEffect(() => {
    if (!userUid) return; // signed out → local mirror only
    return subscribeLibraryNotesRemote(libraryId, (remote) => {
      setNotes(remote);
      persistLocalNotes(libraryId, remote);
    });
  }, [libraryId, userUid]);

  // Apply a pure edit, persist the mirror, then push just the touched key to Firestore — unioning
  // our array with the latest remote (by id) so concurrent edits survive. An emptied key is deleted.
  function commit(key: string, next: LibraryNotes) {
    setNotes(next);
    persistLocalNotes(libraryId, next);
    if (!userUid) return; // local-only when signed out
    void (async () => {
      const mine = next[key];
      if (mine && mine.length > 0) {
        const remote = await readLibraryNotesRemote(libraryId).catch(() => ({}) as LibraryNotes);
        await writeLibraryNotesEntry(libraryId, key, mergeNoteArrays(remote[key], mine)).catch(() => undefined);
      } else {
        await writeLibraryNotesEntry(libraryId, key, undefined).catch(() => undefined);
      }
    })();
  }

  // Add a note to an already-computed key (file relPath via metaKeyForEntry, or a `dir:`-folder
  // key via metaKeyForFolder — the views compute the right key before opening the modal).
  function addNoteByKey(key: string, text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const now = Date.now();
    const note: LibraryNote = {
      id: crypto.randomUUID(),
      text: trimmed,
      authorEmail,
      createdAt: now,
      updatedAt: now,
      resolved: false
    };
    commit(key, addNote(notes, key, note));
  }

  function deleteNote(key: string, id: string) {
    commit(key, removeNote(notes, key, id));
  }

  function toggleResolved(key: string, id: string) {
    const current = (notes[key] ?? []).find((n) => n.id === id);
    if (!current) return;
    commit(key, setNoteResolved(notes, key, id, !current.resolved, authorEmail, Date.now()));
  }

  // A note is deletable by its author or by a leader (UI gate; rules aren't enforced — like tags).
  const canDelete = useCallback((note: LibraryNote) => isLeader || note.authorEmail === authorEmail, [isLeader, authorEmail]);

  const notesForKey = useCallback((key: string) => notesFor(notes, key), [notes]);
  const unresolvedForKey = useCallback((key: string) => unresolvedCount(notes, key), [notes]);
  const countForKey = useCallback((key: string) => noteCount(notes, key), [notes]);

  return {
    notes,
    notesForKey,
    unresolvedForKey,
    countForKey,
    addNoteByKey,
    deleteNote,
    toggleResolved,
    canDelete
  };
}

export type LibraryNotesApi = ReturnType<typeof useLibraryNotes>;
