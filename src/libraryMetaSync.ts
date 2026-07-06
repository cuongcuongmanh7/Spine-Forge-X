// Firestore transport for the 3 remaining Library sidecars that still live as plain files on the
// Shared Drive: `spineforge-library-meta.json` (tags/owner), `spineforge-library-notes.json`
// (notes), `spineforge-drive-meta.json` (Drive owner/modified cache). Design:
// docs/library-sidecar-firestore.md. This is PR1 of that spec — infrastructure only; the hooks
// (useLibraryTags.ts / useLibraryNotes.ts / drive.ts + useLibraryDrive.ts) still read/write the old
// file sidecars until PR2-4 swap their transport to the functions below.
//
// Unlike the leader-curated `library/list|clean|trash` docs in sync.ts, every signed-in org member
// may write here (their own tag/note/drive-cache edit) — see firestore.rules.
//
// Writes use `setDoc(ref, patch, {merge:true})` with a genuinely NESTED JS object, never a
// flattened "a.b.c" field-path STRING — a flattened string would misparse a `.` inside a relPath
// (e.g. `Heroes/3001/x.spine`) as a path separator and corrupt the merge. Firestore deep-merges
// nested map fields under `merge:true`, so patching one entry never disturbs a teammate's
// concurrent edit to a different key or a different library — no read-before-write race for tags or
// the drive-cache. Notes still need a read first, because Firestore can't union array *contents*
// for you: callers read the current array for their one key, union it locally (`mergeNoteArrays` in
// library.ts), then write the result back.
//
// `libraryId` namespacing (new — the old file sidecars keyed by `relPath` alone, global across every
// library) also fixes a known bug: two libraries that happen to share a relPath used to collide on
// the same tag/note/drive-cache entry (see spine-hub-tier-c.md §4).

import { deleteField, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { envDoc } from './firebase';
import { tsToMillis } from './sync';
import type { DriveBasic } from './drive';
import type { EntryMeta, LibraryMeta, LibraryNote, LibraryNotes } from './library';

const SCHEMA = 1;

// ---- shared primitives -------------------------------------------------------------------------

/** One library's map out of a shared `byLibrary`-keyed doc (`{}` if the doc or library is absent). */
async function readByLibraryMap<T>(docName: string, libraryId: string): Promise<Record<string, T>> {
  const snap = await getDoc(envDoc('library', docName));
  if (!snap.exists()) return {};
  const byLibrary = snap.get('byLibrary');
  if (!byLibrary || typeof byLibrary !== 'object') return {};
  const mine = (byLibrary as Record<string, unknown>)[libraryId];
  return mine && typeof mine === 'object' ? (mine as Record<string, T>) : {};
}

/**
 * Merges `{key: value}` into `byLibrary[libraryId]` on a shared doc (`envs/{env}/library/{docName}`).
 * `value === undefined` deletes that key via `deleteField()` instead of writing it. Returns the
 * server-resolved `updatedAt` in millis, matching the `write*Profile` functions in sync.ts.
 */
async function writeByLibraryPatch<T>(docName: string, libraryId: string, patch: Record<string, T | undefined>): Promise<number> {
  const ref = envDoc('library', docName);
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) fields[key] = value === undefined ? deleteField() : value;
  await setDoc(ref, { schema: SCHEMA, byLibrary: { [libraryId]: fields }, updatedAt: serverTimestamp() }, { merge: true });
  const snap = await getDoc(ref);
  return tsToMillis(snap.get('updatedAt')) ?? Date.now();
}

// ---- tags / owner (`envs/{env}/library/tags`) --------------------------------------------------

/** Reads one library's tag/owner map (`spineforge-library-meta.json` successor). */
export function readLibraryTagsRemote(libraryId: string): Promise<LibraryMeta> {
  return readByLibraryMap<EntryMeta>('tags', libraryId);
}

/** Upserts (or, when `value` is undefined, deletes) one asset's tag/owner entry. */
export function writeLibraryTagsEntry(libraryId: string, key: string, value: EntryMeta | undefined): Promise<number> {
  return writeByLibraryPatch<EntryMeta>('tags', libraryId, { [key]: value });
}

// ---- notes (`envs/{env}/library/notes`) --------------------------------------------------------

/** Reads one library's notes map (`spineforge-library-notes.json` successor). */
export function readLibraryNotesRemote(libraryId: string): Promise<LibraryNotes> {
  return readByLibraryMap<LibraryNote[]>('notes', libraryId);
}

/**
 * Upserts (or, when `value` is empty/undefined, deletes) one key's note array. Callers must union
 * the array with the latest remote themselves (`mergeNoteArrays` in library.ts, fed by
 * `readLibraryNotesRemote`) before calling this — Firestore can't merge array contents for you.
 */
export function writeLibraryNotesEntry(libraryId: string, key: string, value: LibraryNote[] | undefined): Promise<number> {
  return writeByLibraryPatch<LibraryNote[]>('notes', libraryId, { [key]: value && value.length > 0 ? value : undefined });
}

// ---- drive-meta cache (`envs/{env}/library/drive_<libraryId>`) ---------------------------------
// One doc per library instead of a shared `byLibrary` map — this cache has one entry per file in
// the library (the largest of the three sidecars), so a per-library doc bounds document size and
// lets two machines refresh different libraries without contending on the same doc.

/** Reads one library's Drive owner/modified cache (`spineforge-drive-meta.json` successor). */
export async function readLibraryDriveRemote(libraryId: string): Promise<Record<string, DriveBasic>> {
  const snap = await getDoc(envDoc('library', `drive_${libraryId}`));
  if (!snap.exists()) return {};
  const entries = snap.get('entries');
  return entries && typeof entries === 'object' ? (entries as Record<string, DriveBasic>) : {};
}

/** Merges a batch of freshly-fetched `{relPath: DriveBasic}` entries into the library's cache doc. */
export async function writeLibraryDriveEntries(libraryId: string, patch: Record<string, DriveBasic>): Promise<number> {
  const ref = envDoc('library', `drive_${libraryId}`);
  await setDoc(ref, { schema: SCHEMA, entries: patch, updatedAt: serverTimestamp() }, { merge: true });
  const snap = await getDoc(ref);
  return tsToMillis(snap.get('updatedAt')) ?? Date.now();
}
