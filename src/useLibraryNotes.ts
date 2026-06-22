import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
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

// Notes/comments on Library files & folders. Same shape as useLibraryTags: a machine-local
// localStorage mirror (offline, survives restart) PLUS a sidecar in the synced Drive folder so the
// same notes show up for every teammate. Keyed by the machine-independent relPath (files) /
// `dir:`-prefixed folder key. Difference vs tags: on push we *union by note id* with the latest
// remote instead of overwriting, so two leaders annotating the same target don't clobber.

const LIBRARY_NOTES_KEY = 'spineforge.library.notes';
const LIBRARY_NOTES_FILE = 'spineforge-library-notes.json';

function loadLocalNotes(): LibraryNotes {
  try {
    const raw = localStorage.getItem(LIBRARY_NOTES_KEY);
    return raw ? (JSON.parse(raw) as LibraryNotes) : {};
  } catch {
    return {};
  }
}

function persistLocalNotes(notes: LibraryNotes) {
  try {
    localStorage.setItem(LIBRARY_NOTES_KEY, JSON.stringify(notes));
  } catch {
    /* local mirror is best-effort */
  }
}

function notesFilePath(folder: string): string {
  const win = folder.includes('\\') || /^[a-zA-Z]:/.test(folder);
  const sep = win ? '\\' : '/';
  return folder.replace(/[\\/]+$/, '') + sep + LIBRARY_NOTES_FILE;
}

async function readNotesSidecar(folder: string): Promise<LibraryNotes> {
  if (!folder) return {};
  const content = await invoke<string | null>('read_text_file', { path: notesFilePath(folder) }).catch(() => null);
  if (!content) return {};
  try {
    const parsed = JSON.parse(content) as LibraryNotes;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeNotesSidecar(folder: string, notes: LibraryNotes): Promise<void> {
  if (!folder) return;
  await invoke('write_text_file', { path: notesFilePath(folder), content: JSON.stringify(notes) });
}

type Args = { libraryDir: string; authorEmail: string; isLeader: boolean };

/**
 * Library ▸ file/folder notes state. Kept out of LibraryInventory so that component stays thin.
 * `libraryDir` is the shared `…\spine_app_data\library` folder (empty when the drive isn't mounted);
 * `authorEmail`/`isLeader` come from the signed-in Drive account + Firestore roles, and decide
 * authorship and who may delete a note (UI gate only — the sidecar doesn't enforce, like tags).
 */
export function useLibraryNotes({ libraryDir, authorEmail, isLeader }: Args) {
  const [notes, setNotes] = useState<LibraryNotes>(loadLocalNotes);

  // Merge the cross-machine snapshot from the sidecar on open / when the folder changes. Unlike
  // tags, notes are arrays — union per key by id so we don't drop a teammate's note for a key we
  // also hold locally.
  useEffect(() => {
    if (!libraryDir) return;
    let cancelled = false;
    void readNotesSidecar(libraryDir).then((remote) => {
      if (cancelled || Object.keys(remote).length === 0) return;
      setNotes((prev) => {
        const next: LibraryNotes = { ...prev };
        for (const [key, list] of Object.entries(remote)) {
          next[key] = mergeNoteArrays(prev[key], list);
        }
        persistLocalNotes(next);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [libraryDir]);

  // Apply a pure edit, persist locally, then push just the touched key to the shared sidecar —
  // merging our key's notes onto the latest remote (union by id) so concurrent edits survive.
  function commit(key: string, next: LibraryNotes) {
    setNotes(next);
    persistLocalNotes(next);
    if (!libraryDir) return;
    void (async () => {
      const remote = await readNotesSidecar(libraryDir).catch(() => ({}) as LibraryNotes);
      const merged = { ...remote };
      const mine = next[key];
      if (mine && mine.length > 0) merged[key] = mergeNoteArrays(remote[key], mine);
      else delete merged[key];
      await writeNotesSidecar(libraryDir, merged).catch(() => undefined);
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

  // A note is deletable by its author or by a leader (UI gate; sidecar isn't enforced — like tags).
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
