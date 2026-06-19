import { describe, expect, it } from 'vitest';
import { toDriveRelPath } from './drive';

describe('toDriveRelPath', () => {
  // Sync folder picked inside a shared drive; anchor derives to the Shared drives mount, so the
  // first path segment is the shared-drive name the Drive API resolves against.
  const syncRoot = 'G:\\Shared drives\\FD';

  it('strips the anchor to a shared-drive-relative, forward-slash path', () => {
    expect(toDriveRelPath('G:\\Shared drives\\FD\\[FD] Animation\\hero\\hero.spine', syncRoot)).toBe(
      'FD/[FD] Animation/hero/hero.spine'
    );
  });

  it('rebases against the whole mount, so sibling drives (DH) keep their drive name', () => {
    expect(toDriveRelPath('G:\\Shared drives\\DH\\[DH] Animation\\boss\\boss.spine', syncRoot)).toBe(
      'DH/[DH] Animation/boss/boss.spine'
    );
  });

  it('is case-insensitive on the anchor (Windows)', () => {
    expect(toDriveRelPath('g:\\shared drives\\FD\\unit\\a.spine', syncRoot)).toBe('FD/unit/a.spine');
  });

  it('returns null for a file outside the anchor (not on Drive / not portable)', () => {
    expect(toDriveRelPath('D:\\Local\\Spine\\a.spine', syncRoot)).toBeNull();
  });

  it('returns null when inputs are missing', () => {
    expect(toDriveRelPath('', syncRoot)).toBeNull();
    expect(toDriveRelPath('G:\\Shared drives\\FD\\a.spine', '')).toBeNull();
  });
});
