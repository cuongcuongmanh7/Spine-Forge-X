import { describe, expect, it } from 'vitest';
import type { LibraryEntry } from './config';
import {
  entryWarnings,
  groupByFolder,
  groupByIdBand,
  idBand,
  isMixedVersion,
  majorVersion,
  topFolder,
  versionSummary
} from './library';
import { formatBytes } from './time';

const MB = 1024 * 1024;

function entry(partial: Partial<LibraryEntry>): LibraryEntry {
  return {
    relPath: 'a/b.spine',
    spineFile: 'C:/root/a/b.spine',
    folder: 'C:/root/a',
    imagesDir: 'C:/root/a/images',
    spineBytes: 0,
    imageBytes: 0,
    imageCount: 0,
    version: null,
    exported: false,
    animations: [],
    skins: [],
    animationCount: 0,
    error: null,
    ...partial
  };
}

describe('majorVersion', () => {
  it('buckets by leading major number', () => {
    expect(majorVersion('3.8.99')).toBe('3');
    expect(majorVersion('4.3.17')).toBe('4');
  });
  it('returns "unknown" for null or malformed', () => {
    expect(majorVersion(null)).toBe('unknown');
    expect(majorVersion('beta')).toBe('unknown');
  });
});

describe('isMixedVersion', () => {
  it('flags a group spanning two major.minor versions', () => {
    expect(isMixedVersion([entry({ version: '3.8.99' }), entry({ version: '4.3.17' })])).toBe(true);
  });
  it('ignores unknown-only differences', () => {
    expect(isMixedVersion([entry({ version: '4.3.17' }), entry({ version: null })])).toBe(false);
  });
  it('treats one consistent version as not mixed', () => {
    expect(isMixedVersion([entry({ version: '4.3.17' }), entry({ version: '4.3.10' })])).toBe(false);
  });
});

describe('entryWarnings', () => {
  const thresholds = { imageFolderWarnMB: 50, spineFileWarnMB: 10 };
  it('flags heavy image folders and spine files over the threshold', () => {
    const w = entryWarnings(entry({ imageBytes: 60 * MB, spineBytes: 12 * MB }), thresholds);
    expect(w.heavyImages).toBe(true);
    expect(w.heavySpine).toBe(true);
  });
  it('does not flag sizes under the threshold', () => {
    const w = entryWarnings(entry({ imageBytes: 10 * MB, spineBytes: 1 * MB }), thresholds);
    expect(w.heavyImages).toBe(false);
    expect(w.heavySpine).toBe(false);
  });
});

describe('topFolder / groupByFolder', () => {
  it('groups by the first path segment', () => {
    expect(topFolder(entry({ relPath: 'Heroes/3001/x.spine' }))).toBe('Heroes');
    const groups = groupByFolder([
      entry({ relPath: 'Heroes/a.spine', version: '4.3.17' }),
      entry({ relPath: 'Heroes/b.spine', version: '3.8.99' }),
      entry({ relPath: 'Enemies/c.spine', version: '4.3.17' })
    ]);
    expect(groups.map((g) => g.key)).toEqual(['Enemies', 'Heroes']);
    expect(groups.find((g) => g.key === 'Heroes')?.mixedVersion).toBe(true);
  });
});

describe('idBand / groupByIdBand', () => {
  it('derives the numeric band from the path', () => {
    expect(idBand(entry({ relPath: 'Heroes/3001_Lucius/Lucius.spine' }))).toBe('3xxx');
    expect(idBand(entry({ relPath: 'Enemies/7012_Goblin/x.spine' }))).toBe('7xxx');
    expect(idBand(entry({ relPath: 'Eidolons/9003/x.spine' }))).toBe('9xxx');
    expect(idBand(entry({ relPath: 'misc/noid.spine' }))).toBe('no-id');
  });
  it('groups heroes/enemies/eidolons into separate bands', () => {
    const groups = groupByIdBand([
      entry({ relPath: 'Heroes/3001_A/a.spine' }),
      entry({ relPath: 'Heroes/3002_B/b.spine' }),
      entry({ relPath: 'Enemies/7001_C/c.spine' }),
      entry({ relPath: 'Eidolons/9001_D/d.spine' })
    ]);
    expect(groups.map((g) => g.key)).toEqual(['3xxx', '7xxx', '9xxx']);
    expect(groups.find((g) => g.key === '3xxx')?.entries).toHaveLength(2);
  });
});

describe('versionSummary', () => {
  it('rolls up per-major counts and sizes, unknown last', () => {
    const buckets = versionSummary([
      entry({ version: '4.3.17', spineBytes: 100 }),
      entry({ version: '4.3.10', spineBytes: 50 }),
      entry({ version: '3.8.99', spineBytes: 10 }),
      entry({ version: null, spineBytes: 5 })
    ]);
    expect(buckets.map((b) => b.major)).toEqual(['3', '4', 'unknown']);
    expect(buckets.find((b) => b.major === '4')?.count).toBe(2);
    expect(buckets.find((b) => b.major === '4')?.spineBytes).toBe(150);
  });
});

describe('formatBytes', () => {
  it('formats common magnitudes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(5 * MB)).toBe('5.0 MB');
  });
});
