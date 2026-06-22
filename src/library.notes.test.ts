import { describe, expect, it } from 'vitest';
import {
  addNote,
  mergeNoteArrays,
  metaKeyForFolder,
  notesFor,
  removeNote,
  setNoteResolved,
  unresolvedCount,
  type LibraryNote,
  type LibraryNotes
} from './library';

function note(id: string, over: Partial<LibraryNote> = {}): LibraryNote {
  return {
    id,
    text: `note ${id}`,
    authorEmail: 'a@x.com',
    createdAt: 1000,
    updatedAt: 1000,
    resolved: false,
    ...over
  };
}

describe('library notes helpers', () => {
  it('metaKeyForFolder namespaces folder keys away from file relPaths', () => {
    expect(metaKeyForFolder('char/hero')).toBe('dir:char/hero');
  });

  it('addNote appends immutably and notesFor reads back', () => {
    const a: LibraryNotes = {};
    const b = addNote(a, 'k', note('1'));
    expect(a).toEqual({}); // original untouched
    expect(notesFor(b, 'k').map((n) => n.id)).toEqual(['1']);
    const c = addNote(b, 'k', note('2'));
    expect(notesFor(c, 'k').map((n) => n.id)).toEqual(['1', '2']);
  });

  it('removeNote drops the note and prunes the key when it empties', () => {
    const start = addNote(addNote({}, 'k', note('1')), 'k', note('2'));
    const afterOne = removeNote(start, 'k', '1');
    expect(notesFor(afterOne, 'k').map((n) => n.id)).toEqual(['2']);
    const afterAll = removeNote(afterOne, 'k', '2');
    expect(Object.prototype.hasOwnProperty.call(afterAll, 'k')).toBe(false);
  });

  it('setNoteResolved stamps resolvedBy/updatedAt and unresolvedCount tracks open notes', () => {
    const start = addNote(addNote({}, 'k', note('1')), 'k', note('2'));
    expect(unresolvedCount(start, 'k')).toBe(2);
    const resolved = setNoteResolved(start, 'k', '1', true, 'leader@x.com', 5000);
    const n1 = notesFor(resolved, 'k').find((n) => n.id === '1')!;
    expect(n1.resolved).toBe(true);
    expect(n1.resolvedBy).toBe('leader@x.com');
    expect(n1.updatedAt).toBe(5000);
    expect(unresolvedCount(resolved, 'k')).toBe(1);
    const reopened = setNoteResolved(resolved, 'k', '1', false, 'leader@x.com', 6000);
    const n1b = notesFor(reopened, 'k').find((n) => n.id === '1')!;
    expect(n1b.resolved).toBe(false);
    expect(n1b.resolvedBy).toBeUndefined();
    expect(unresolvedCount(reopened, 'k')).toBe(2);
  });

  it('mergeNoteArrays unions by id, keeping the newer updatedAt per id', () => {
    const mine = [note('1', { updatedAt: 1000, text: 'old' }), note('2')];
    const theirs = [note('1', { updatedAt: 2000, text: 'new' }), note('3')];
    const merged = mergeNoteArrays(mine, theirs);
    const byId = new Map(merged.map((n) => [n.id, n]));
    expect([...byId.keys()].sort()).toEqual(['1', '2', '3']); // no dropped notes
    expect(byId.get('1')!.text).toBe('new'); // newer updatedAt wins
  });

  it('mergeNoteArrays handles missing/empty sides', () => {
    expect(mergeNoteArrays(undefined, [note('1')]).map((n) => n.id)).toEqual(['1']);
    expect(mergeNoteArrays([note('1')], undefined).map((n) => n.id)).toEqual(['1']);
    expect(mergeNoteArrays()).toEqual([]);
  });
});
