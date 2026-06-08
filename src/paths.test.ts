import { describe, expect, it } from 'vitest';
import { commonParentPath } from './paths';

describe('commonParentPath', () => {
  it('returns the shared parent of Windows linked-export folders', () => {
    expect(
      commonParentPath([
        'C:\\Unity\\Assets\\Heroes\\3004_Gale',
        'C:\\Unity\\Assets\\Heroes\\3005_Bolt'
      ])
    ).toBe('C:\\Unity\\Assets\\Heroes');
  });

  it('ignores a trailing slash on inputs', () => {
    expect(
      commonParentPath(['D:\\out\\A\\', 'D:\\out\\B'])
    ).toBe('D:\\out');
  });

  it('handles POSIX separators', () => {
    expect(
      commonParentPath(['/u/assets/Heroes/3004', '/u/assets/Heroes/3005'])
    ).toBe('/u/assets/Heroes');
  });

  it('returns the folder itself for a single path', () => {
    expect(commonParentPath(['C:\\Unity\\Heroes\\3004_Gale'])).toBe('C:\\Unity\\Heroes\\3004_Gale');
  });

  it('returns empty when only a bare drive/root is shared', () => {
    expect(commonParentPath(['C:\\a', 'C:\\b'])).toBe('');
  });

  it('returns empty for no paths', () => {
    expect(commonParentPath([])).toBe('');
  });
});
