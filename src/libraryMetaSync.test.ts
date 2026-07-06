import { beforeEach, describe, expect, it, vi } from 'vitest';

// The mock below actually implements Firestore's `setDoc(ref, data, {merge:true})` semantics: a
// recursive merge of nested plain objects, with a `deleteField()` sentinel removing just the leaf
// it's placed at. This is the load-bearing assumption of the whole migration (see
// docs/library-sidecar-firestore.md §2) — everything in libraryMetaSync.ts relies on the real SDK
// deep-merging nested maps instead of clobbering the whole `byLibrary`/`entries` field, so this test
// exists to pin that behavior down rather than just exercise the read/write plumbing.

const store = new Map<string, Record<string, unknown>>();
const SERVER = Symbol('serverTimestamp');
const DELETE = Symbol('deleteField');

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && v.constructor === Object;
}

function deepMergeInto(target: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === DELETE) {
      delete target[key];
    } else if (isPlainObject(value) && isPlainObject(target[key])) {
      deepMergeInto(target[key] as Record<string, unknown>, value);
    } else {
      target[key] = value;
    }
  }
}

vi.mock('./firebase', () => ({
  envDoc: (...segments: string[]) => ({ key: segments.join('/') })
}));

type Snap = { exists: () => boolean; data: () => Record<string, unknown> | undefined; get: (k: string) => unknown };

function snapFor(key: string): Snap {
  const data = store.get(key);
  return { exists: () => data !== undefined, data: () => data, get: (k: string) => data?.[k] };
}

// Realtime listeners keyed by doc, so a setDoc notifies any active onSnapshot for that doc.
const listeners = new Map<string, Set<(snap: Snap) => void>>();

vi.mock('firebase/firestore', () => {
  class Timestamp {
    constructor(public ms: number) {}
    toMillis() {
      return this.ms;
    }
  }
  return {
    Timestamp,
    serverTimestamp: () => SERVER,
    deleteField: () => DELETE,
    setDoc: async (ref: { key: string }, data: Record<string, unknown>, opts?: { merge?: boolean }) => {
      const resolved = { ...data, updatedAt: data.updatedAt === SERVER ? new Timestamp(5000) : data.updatedAt };
      if (opts?.merge) {
        const existing = store.get(ref.key) ?? {};
        deepMergeInto(existing, resolved);
        store.set(ref.key, existing);
      } else {
        store.set(ref.key, resolved);
      }
      for (const cb of listeners.get(ref.key) ?? []) cb(snapFor(ref.key));
    },
    getDoc: async (ref: { key: string }) => snapFor(ref.key),
    onSnapshot: (ref: { key: string }, onNext: (snap: Snap) => void) => {
      const set = listeners.get(ref.key) ?? new Set();
      set.add(onNext);
      listeners.set(ref.key, set);
      onNext(snapFor(ref.key)); // fire immediately with the current value, like the real SDK
      return () => set.delete(onNext);
    }
  };
});

import {
  readLibraryDriveRemote,
  readLibraryNotesRemote,
  readLibraryTagsRemote,
  subscribeLibraryDriveRemote,
  subscribeLibraryTagsRemote,
  writeLibraryDriveEntries,
  writeLibraryNotesEntry,
  writeLibraryTagsEntry
} from './libraryMetaSync';
import type { EntryMeta, LibraryMeta, LibraryNote } from './library';
import type { DriveBasic } from './drive';

beforeEach(() => {
  store.clear();
  listeners.clear();
});

describe('tags: merge isolation across keys and libraries', () => {
  it('a relPath containing "." and "/" round-trips as a literal key, not a flattened field path', async () => {
    const key = 'Heroes/3001/x.spine';
    await writeLibraryTagsEntry('l1', key, { tags: ['boss'] });
    const remote = await readLibraryTagsRemote('l1');
    expect(remote[key]).toEqual({ tags: ['boss'] });
  });

  it('patching one key does not disturb a sibling key in the same library', async () => {
    await writeLibraryTagsEntry('l1', 'a.spine', { tags: ['a'] });
    await writeLibraryTagsEntry('l1', 'b.spine', { tags: ['b'] });
    const remote = await readLibraryTagsRemote('l1');
    expect(remote['a.spine']).toEqual({ tags: ['a'] });
    expect(remote['b.spine']).toEqual({ tags: ['b'] });
  });

  it('patching library l1 does not disturb library l2 (namespaced by libraryId)', async () => {
    await writeLibraryTagsEntry('l1', 'shared/relPath.spine', { tags: ['from-l1'] });
    await writeLibraryTagsEntry('l2', 'shared/relPath.spine', { tags: ['from-l2'] });
    expect((await readLibraryTagsRemote('l1'))['shared/relPath.spine']).toEqual({ tags: ['from-l1'] });
    expect((await readLibraryTagsRemote('l2'))['shared/relPath.spine']).toEqual({ tags: ['from-l2'] });
  });

  it('writing undefined deletes just that key, leaving siblings intact', async () => {
    await writeLibraryTagsEntry('l1', 'a.spine', { tags: ['a'] });
    await writeLibraryTagsEntry('l1', 'b.spine', { tags: ['b'] });
    await writeLibraryTagsEntry('l1', 'a.spine', undefined);
    const remote = await readLibraryTagsRemote('l1');
    expect(remote['a.spine']).toBeUndefined();
    expect(remote['b.spine']).toEqual({ tags: ['b'] });
  });

  it('resolves updatedAt from the server timestamp, not a client-provided value', async () => {
    const at = await writeLibraryTagsEntry('l1', 'a.spine', { tags: ['a'] });
    expect(at).toBe(5000);
  });

  it('reads {} for a library that has never been written', async () => {
    expect(await readLibraryTagsRemote('never-seen')).toEqual({});
  });
});

describe('notes: per-key patch (union happens in the caller)', () => {
  const note = (id: string): LibraryNote => ({ id, text: 't', authorEmail: 'a@ondigames.com', createdAt: 1, updatedAt: 1, resolved: false });

  it('round-trips a note array under a key without disturbing another key', async () => {
    await writeLibraryNotesEntry('l1', 'a.spine', [note('n1')]);
    await writeLibraryNotesEntry('l1', 'dir:folder', [note('n2')]);
    const remote = await readLibraryNotesRemote('l1');
    expect(remote['a.spine']).toEqual([note('n1')]);
    expect(remote['dir:folder']).toEqual([note('n2')]);
  });

  it('writing an empty array deletes the key (mirrors the old sidecar pruning empty entries)', async () => {
    await writeLibraryNotesEntry('l1', 'a.spine', [note('n1')]);
    await writeLibraryNotesEntry('l1', 'a.spine', []);
    expect((await readLibraryNotesRemote('l1'))['a.spine']).toBeUndefined();
  });
});

describe('realtime subscriptions', () => {
  const last = <T,>(a: T[]): T | undefined => a[a.length - 1];

  it('tags: fires with current value, then again live on a later write (authoritative — delete propagates)', async () => {
    await writeLibraryTagsEntry('l1', 'a.spine', { tags: ['a'] });
    const seen: LibraryMeta[] = [];
    const unsub = subscribeLibraryTagsRemote('l1', (m) => seen.push(m));
    expect(last(seen)).toEqual({ 'a.spine': { tags: ['a'] } }); // immediate

    await writeLibraryTagsEntry('l1', 'b.spine', { tags: ['b'] } as EntryMeta);
    expect(last(seen)).toEqual({ 'a.spine': { tags: ['a'] }, 'b.spine': { tags: ['b'] } }); // live add

    await writeLibraryTagsEntry('l1', 'a.spine', undefined);
    expect(last(seen)?.['a.spine']).toBeUndefined(); // live delete
    unsub();
  });

  it("tags: l1's slice stays isolated when l2 writes (shared doc wakes the sub, but never leaks l2's keys)", async () => {
    await writeLibraryTagsEntry('l1', 'own.spine', { tags: ['mine'] });
    const seen: LibraryMeta[] = [];
    const unsub = subscribeLibraryTagsRemote('l1', (m) => seen.push(m));
    // tags/notes share one `byLibrary` doc, so an l2 write does wake l1's subscription — but the
    // callback still only ever sees l1's slice (drive-meta avoids even the wake via per-library docs).
    await writeLibraryTagsEntry('l2', 'x.spine', { tags: ['x'] });
    expect(last(seen)).toEqual({ 'own.spine': { tags: ['mine'] } });
    expect(last(seen)?.['x.spine']).toBeUndefined();
    unsub();
  });

  it('drive: subscription reflects a later batch write on the per-library doc', async () => {
    const seen: Record<string, DriveBasic>[] = [];
    const unsub = subscribeLibraryDriveRemote('l1', (m) => seen.push(m));
    await writeLibraryDriveEntries('l1', {
      'a.spine': { relPath: 'a.spine', ownerEmail: 'x@ondigames.com', ownerName: null, lastEditorEmail: null, lastEditorName: null, modifiedTime: null, error: null }
    });
    expect(last(seen)?.['a.spine']?.ownerEmail).toBe('x@ondigames.com');
    unsub();
  });

  it('unsubscribe stops further callbacks', async () => {
    const seen: LibraryMeta[] = [];
    const unsub = subscribeLibraryTagsRemote('l1', (m) => seen.push(m));
    unsub();
    const after = seen.length;
    await writeLibraryTagsEntry('l1', 'a.spine', { tags: ['a'] });
    expect(seen.length).toBe(after);
  });
});

describe('drive-meta: one doc per library', () => {
  it('batches multiple relPath entries in one write and merges with a later batch', async () => {
    await writeLibraryDriveEntries('l1', {
      'a.spine': { relPath: 'a.spine', ownerEmail: 'x@ondigames.com', ownerName: 'X', lastEditorEmail: null, lastEditorName: null, modifiedTime: null, error: null }
    });
    await writeLibraryDriveEntries('l1', {
      'b.spine': { relPath: 'b.spine', ownerEmail: 'y@ondigames.com', ownerName: 'Y', lastEditorEmail: null, lastEditorName: null, modifiedTime: null, error: null }
    });
    const remote = await readLibraryDriveRemote('l1');
    expect(remote['a.spine']?.ownerEmail).toBe('x@ondigames.com');
    expect(remote['b.spine']?.ownerEmail).toBe('y@ondigames.com');
  });

  it('two libraries get independent docs (drive_l1 vs drive_l2), not a shared map', async () => {
    await writeLibraryDriveEntries('l1', {
      'shared.spine': { relPath: 'shared.spine', ownerEmail: 'l1-owner@ondigames.com', ownerName: null, lastEditorEmail: null, lastEditorName: null, modifiedTime: null, error: null }
    });
    await writeLibraryDriveEntries('l2', {
      'shared.spine': { relPath: 'shared.spine', ownerEmail: 'l2-owner@ondigames.com', ownerName: null, lastEditorEmail: null, lastEditorName: null, modifiedTime: null, error: null }
    });
    expect((await readLibraryDriveRemote('l1'))['shared.spine']?.ownerEmail).toBe('l1-owner@ondigames.com');
    expect((await readLibraryDriveRemote('l2'))['shared.spine']?.ownerEmail).toBe('l2-owner@ondigames.com');
  });
});
