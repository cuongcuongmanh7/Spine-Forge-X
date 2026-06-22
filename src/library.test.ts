import { describe, expect, it } from 'vitest';
import type { LibraryEntry } from './config';
import {
  entryMatchesQuery,
  entryWarnings,
  groupByFolder,
  groupByIdBand,
  groupByStatus,
  idBand,
  isMixedVersion,
  majorVersion,
  addTag,
  allTags,
  entryMatchesTags,
  matchedNames,
  metaKeyForEntry,
  normalizePath,
  parseQuery,
  removeTag,
  setOwner,
  topFolder,
  usageByEntry,
  versionMixGroups,
  versionSummary,
  type LibraryMeta
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

describe('groupByStatus', () => {
  it('orders groups by triage rank: unknown → warning → clean', () => {
    const statusOf = (e: LibraryEntry) => e.relPath; // relPath doubles as the status key here
    const groups = groupByStatus(
      [
        entry({ relPath: 'clean', spineFile: 'c1' }),
        entry({ relPath: 'unknown', spineFile: 'u1' }),
        entry({ relPath: 'warning', spineFile: 'w1' }),
        entry({ relPath: 'clean', spineFile: 'c2' })
      ],
      statusOf
    );
    expect(groups.map((g) => g.key)).toEqual(['unknown', 'warning', 'clean']);
    expect(groups.find((g) => g.key === 'clean')?.entries).toHaveLength(2);
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

describe('versionMixGroups', () => {
  it('returns only folders that mix versions, flagging entries off the majority', () => {
    const groups = versionMixGroups([
      entry({ relPath: 'Heroes/a.spine', version: '4.3.17' }),
      entry({ relPath: 'Heroes/b.spine', version: '4.3.10' }),
      entry({ relPath: 'Heroes/c.spine', version: '3.8.99' }),
      entry({ relPath: 'Enemies/d.spine', version: '4.3.17' }), // single version → not mixed
      entry({ relPath: 'Enemies/e.spine', version: '4.3.10' })
    ]);
    expect(groups.map((g) => g.key)).toEqual(['Heroes']);
    const heroes = groups[0];
    expect(heroes.majority).toBe('4.3'); // two 4.3 entries beat one 3.8
    const diverging = heroes.entries.filter((r) => r.diverges).map((r) => r.entry.relPath);
    expect(diverging).toEqual(['Heroes/c.spine']);
  });
  it('never flags or counts unknown-version entries as the majority', () => {
    const groups = versionMixGroups([
      entry({ relPath: 'X/a.spine', version: '4.3.17' }),
      entry({ relPath: 'X/b.spine', version: '3.8.99' }),
      entry({ relPath: 'X/c.spine', version: null })
    ]);
    expect(groups).toHaveLength(1);
    const unknown = groups[0].entries.find((r) => r.entry.relPath === 'X/c.spine');
    expect(unknown?.diverges).toBe(false);
  });
});

describe('parseQuery', () => {
  it('defaults to "all" scope with a lower-cased term', () => {
    expect(parseQuery('  Attack ')).toEqual({ scope: 'all', term: 'attack' });
  });
  it('parses anim:/animation: prefix into anim scope', () => {
    expect(parseQuery('anim:attack')).toEqual({ scope: 'anim', term: 'attack' });
    expect(parseQuery('Animation: Idle')).toEqual({ scope: 'anim', term: 'idle' });
  });
  it('parses skin: prefix into skin scope', () => {
    expect(parseQuery('skin: Red')).toEqual({ scope: 'skin', term: 'red' });
  });
  it('treats a colon mid-word as a plain term', () => {
    expect(parseQuery('boss:fight')).toEqual({ scope: 'all', term: 'boss:fight' });
  });
});

describe('entryMatchesQuery', () => {
  const e = entry({ relPath: 'Heroes/Lucius.spine', animations: ['attack', 'idle'], skins: ['red', 'blue'] });
  it('matches path, anim, or skin for an "all" query', () => {
    expect(entryMatchesQuery(e, parseQuery('lucius'))).toBe(true);
    expect(entryMatchesQuery(e, parseQuery('attack'))).toBe(true);
    expect(entryMatchesQuery(e, parseQuery('red'))).toBe(true);
    expect(entryMatchesQuery(e, parseQuery('missing'))).toBe(false);
  });
  it('scopes anim:/skin: to that facet only', () => {
    expect(entryMatchesQuery(e, parseQuery('anim:attack'))).toBe(true);
    expect(entryMatchesQuery(e, parseQuery('anim:red'))).toBe(false); // red is a skin, not an anim
    expect(entryMatchesQuery(e, parseQuery('skin:blue'))).toBe(true);
    expect(entryMatchesQuery(e, parseQuery('skin:attack'))).toBe(false);
  });
  it('an empty term matches everything', () => {
    expect(entryMatchesQuery(e, parseQuery(''))).toBe(true);
    expect(entryMatchesQuery(e, parseQuery('anim:'))).toBe(true);
  });
});

describe('matchedNames', () => {
  const e = entry({ animations: ['attack', 'attack_combo', 'idle'], skins: ['attack_skin', 'red'] });
  it('collects matching anim and skin names for an "all" query', () => {
    const m = matchedNames(e, parseQuery('attack'));
    expect([...m.animations]).toEqual(['attack', 'attack_combo']);
    expect([...m.skins]).toEqual(['attack_skin']);
  });
  it('does not light up skins for an anim: query', () => {
    const m = matchedNames(e, parseQuery('anim:attack'));
    expect([...m.animations]).toEqual(['attack', 'attack_combo']);
    expect(m.skins.size).toBe(0);
  });
  it('returns empty sets for an empty term', () => {
    const m = matchedNames(e, parseQuery(''));
    expect(m.animations.size).toBe(0);
    expect(m.skins.size).toBe(0);
  });
});

describe('usageByEntry', () => {
  const session = (id: string, projectId: string, inputFiles: string[]) => ({
    id,
    projectId,
    config: { inputFiles }
  });

  it('attributes an entry to every session that lists its .spine', () => {
    const e = entry({ spineFile: 'C:/root/a/b.spine' });
    const usage = usageByEntry(
      [e],
      [session('s1', 'p1', ['C:/root/a/b.spine']), session('s2', 'p1', ['C:/root/a/b.spine'])]
    );
    const u = usage.get(e.spineFile)!;
    expect(u.sessionIds.sort()).toEqual(['s1', 's2']);
    expect(u.projectIds).toEqual(['p1']);
  });

  it('matches case-insensitively across slash styles', () => {
    const e = entry({ spineFile: 'C:/root/a/b.spine' });
    const usage = usageByEntry([e], [session('s1', 'p1', ['c:\\ROOT\\a\\b.spine'])]);
    expect(usage.get(e.spineFile)!.sessionIds).toEqual(['s1']);
  });

  it('collects distinct projects across sessions', () => {
    const e = entry({ spineFile: 'C:/root/a/b.spine' });
    const usage = usageByEntry(
      [e],
      [session('s1', 'p1', ['C:/root/a/b.spine']), session('s2', 'p2', ['C:/root/a/b.spine'])]
    );
    expect(usage.get(e.spineFile)!.projectIds.sort()).toEqual(['p1', 'p2']);
  });

  it('reports an unreferenced entry as orphan (empty arrays)', () => {
    const e = entry({ spineFile: 'C:/root/a/b.spine' });
    const usage = usageByEntry([e], [session('s1', 'p1', ['C:/root/other.spine'])]);
    expect(usage.get(e.spineFile)).toEqual({ sessionIds: [], projectIds: [] });
  });
});

describe('normalizePath', () => {
  it('lower-cases, forward-slashes, and trims trailing separators', () => {
    expect(normalizePath('C:\\Root\\A\\')).toBe('c:/root/a');
    expect(normalizePath('C:/Root/A/B.spine')).toBe('c:/root/a/b.spine');
  });
});

describe('library tags / ownership', () => {
  const key = 'Heroes/3001/x.spine';

  it('builds a forward-slashed key from an entry relPath', () => {
    expect(metaKeyForEntry(entry({ relPath: 'Heroes\\3001\\x.spine' }))).toBe('Heroes/3001/x.spine');
  });

  it('adds tags, deduping case-insensitively and ignoring blanks', () => {
    let meta: LibraryMeta = {};
    meta = addTag(meta, key, 'boss');
    meta = addTag(meta, key, 'BOSS'); // dupe
    meta = addTag(meta, key, '   '); // blank
    meta = addTag(meta, key, ' cần  review '); // normalized whitespace
    expect(meta[key].tags).toEqual(['boss', 'cần review']);
  });

  it('removes a tag case-insensitively and prunes empty entries', () => {
    let meta: LibraryMeta = addTag({}, key, 'wip');
    meta = removeTag(meta, key, 'WIP');
    expect(meta[key]).toBeUndefined();
  });

  it('keeps an entry when it still has an owner after losing its last tag', () => {
    let meta: LibraryMeta = addTag({}, key, 'wip');
    meta = setOwner(meta, key, 'Anh');
    meta = removeTag(meta, key, 'wip');
    expect(meta[key]).toEqual({ tags: [], owner: 'Anh' });
  });

  it('sets and clears the manual owner', () => {
    let meta: LibraryMeta = setOwner({}, key, '  Anh  ');
    expect(meta[key].owner).toBe('Anh');
    meta = setOwner(meta, key, '');
    expect(meta[key]).toBeUndefined();
  });

  it('lists distinct tags sorted for the filter row', () => {
    let meta: LibraryMeta = addTag({}, 'a', 'zeta');
    meta = addTag(meta, 'b', 'Alpha');
    meta = addTag(meta, 'c', 'alpha'); // dupe of Alpha
    expect(allTags(meta)).toEqual(['Alpha', 'zeta']);
  });

  it('matches entries with any selected tag (OR), empty selection matches all', () => {
    const m = { tags: ['boss', 'wip'] };
    expect(entryMatchesTags(m, new Set())).toBe(true);
    expect(entryMatchesTags(m, new Set(['WIP']))).toBe(true);
    expect(entryMatchesTags(m, new Set(['done']))).toBe(false);
    expect(entryMatchesTags(undefined, new Set(['boss']))).toBe(false);
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
