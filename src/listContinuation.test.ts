import { describe, expect, it } from 'vitest';
import { continueList } from './listContinuation';

// caret is placed at end of `value` unless a `|` marks it (then we split there).
function at(value: string): { value: string; caret: number } {
  const i = value.indexOf('|');
  return i === -1 ? { value, caret: value.length } : { value: value.replace('|', ''), caret: i };
}

describe('continueList', () => {
  it('returns null on a non-list line', () => {
    const { value, caret } = at('just some text');
    expect(continueList(value, caret)).toBeNull();
  });

  it('continues an ordered list, incrementing the number', () => {
    const { value, caret } = at('1. first');
    expect(continueList(value, caret)).toEqual({ value: '1. first\n2. ', caret: '1. first\n2. '.length });
  });

  it('continues an unordered list, preserving the bullet + indent', () => {
    const { value, caret } = at('  - item');
    expect(continueList(value, caret)).toEqual({ value: '  - item\n  - ', caret: '  - item\n  - '.length });
  });

  it('ends the list when Enter is pressed on an empty item (drops the bare marker)', () => {
    const { value, caret } = at('1. a\n2. ');
    expect(continueList(value, caret)).toEqual({ value: '1. a\n', caret: '1. a\n'.length });
  });

  it('continues from the line the caret is on, not the last line', () => {
    const { value, caret } = at('1. one|\n9. nine');
    const r = continueList(value, caret)!;
    expect(r.value).toBe('1. one\n2. \n9. nine');
    expect(r.caret).toBe('1. one\n2. '.length);
  });

  it('supports ")" delimiter and "*"/"+" bullets', () => {
    expect(continueList('3) x', 4)!.value).toBe('3) x\n4) ');
    expect(continueList('* x', 3)!.value).toBe('* x\n* ');
    expect(continueList('+ x', 3)!.value).toBe('+ x\n+ ');
  });
});
