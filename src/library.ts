import type { LibraryCleanRecord, LibraryEntry } from './config';

/** Warning thresholds (in MB) sourced from AppConfig. */
export type LibraryThresholds = {
  imageFolderWarnMB: number;
  spineFileWarnMB: number;
};

/** Per-entry warning flags, evaluated against the thresholds. */
export type EntryWarnings = {
  heavyImages: boolean;
  heavySpine: boolean;
};

const MB = 1024 * 1024;

/** Major version bucket for grouping: "3", "4", … or "unknown" when unparsed. */
export function majorVersion(version: string | null): string {
  if (!version) return 'unknown';
  const major = version.split('.')[0]?.trim();
  return major && /^\d+$/.test(major) ? major : 'unknown';
}

/** "major.minor" key used to detect mixed versions within a group ("3.8", "4.3"). */
function minorKey(version: string | null): string {
  if (!version) return 'unknown';
  const [major, minor] = version.split('.');
  return minor != null ? `${major}.${minor}` : major;
}

export function entryWarnings(entry: LibraryEntry, thresholds: LibraryThresholds): EntryWarnings {
  return {
    heavyImages: entry.imageBytes > thresholds.imageFolderWarnMB * MB,
    heavySpine: entry.spineBytes > thresholds.spineFileWarnMB * MB
  };
}

export function hasAnyWarning(entry: LibraryEntry, thresholds: LibraryThresholds): boolean {
  const w = entryWarnings(entry, thresholds);
  return w.heavyImages || w.heavySpine;
}

export function cleanRecordForEntry(entry: LibraryEntry, cleanedAt = Date.now()): LibraryCleanRecord {
  return {
    spineFile: entry.spineFile,
    scannedAt: cleanedAt,
    cleanedAt,
    unusedCount: 0,
    unusedBytes: 0,
    spineBytes: entry.spineBytes,
    imageBytes: entry.imageBytes,
    imageCount: entry.imageCount,
    version: entry.version,
    exported: entry.exported
  };
}

export function scanRecordForEntry(
  entry: LibraryEntry,
  unusedCount: number,
  unusedBytes: number,
  scannedAt = Date.now()
): LibraryCleanRecord {
  return {
    spineFile: entry.spineFile,
    scannedAt,
    unusedCount,
    unusedBytes,
    spineBytes: entry.spineBytes,
    imageBytes: entry.imageBytes,
    imageCount: entry.imageCount,
    version: entry.version,
    exported: entry.exported
  };
}

export function isCleanRecordCurrent(entry: LibraryEntry, record: LibraryCleanRecord | undefined): boolean {
  return (
    !!record &&
    record.spineFile === entry.spineFile &&
    record.spineBytes === entry.spineBytes &&
    record.imageBytes === entry.imageBytes &&
    record.imageCount === entry.imageCount &&
    record.version === entry.version &&
    record.exported === entry.exported
  );
}

export type LibraryCleanStatus = 'clean' | 'warning' | 'unknown';

export function cleanStatusForEntry(entry: LibraryEntry, record: LibraryCleanRecord | undefined): LibraryCleanStatus {
  if (!record) return 'unknown';
  if (!isCleanRecordCurrent(entry, record)) return 'warning';
  return record.unusedCount === 0 ? 'clean' : 'warning';
}

/** A group is "version-mixed" when its entries span more than one major.minor version. */
export function isMixedVersion(entries: LibraryEntry[]): boolean {
  const keys = new Set(entries.map((e) => minorKey(e.version)).filter((k) => k !== 'unknown'));
  return keys.size > 1;
}

/** Top-level folder/type segment of an entry's relative path ("Heroes/3001/x.spine" → "Heroes"). */
export function topFolder(entry: LibraryEntry): string {
  const segments = entry.relPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return segments.length > 1 ? segments[0] : '(root)';
}

/**
 * ID band of an entry, derived from the first run of ≥3 digits in its path: "3001_Lucius" → "3xxx",
 * "7012" → "7xxx". Lets a project group assets by numeric range (heroes 3xxx, enemies 7xxx,
 * eidolons 9xxx…). Returns "no-id" when no numeric id is present.
 */
export function idBand(entry: LibraryEntry): string {
  const match = entry.relPath.replace(/\\/g, '/').match(/(\d{3,})/);
  if (!match) return 'no-id';
  const digits = match[1];
  return `${digits[0]}${'x'.repeat(digits.length - 1)}`;
}

export type LibraryGroup = {
  key: string;
  entries: LibraryEntry[];
  mixedVersion: boolean;
};

/** Bucket entries by a key function, attaching a mixed-version flag, sorted by key. */
function groupBy(entries: LibraryEntry[], keyOf: (entry: LibraryEntry) => string): LibraryGroup[] {
  const map = new Map<string, LibraryEntry[]>();
  for (const entry of entries) {
    const key = keyOf(entry);
    const list = map.get(key);
    if (list) list.push(entry);
    else map.set(key, [entry]);
  }
  return [...map.entries()]
    .map(([key, groupEntries]) => ({ key, entries: groupEntries, mixedVersion: isMixedVersion(groupEntries) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** Group entries by their top-level folder/type, mirroring the master-folder structure. */
export function groupByFolder(entries: LibraryEntry[]): LibraryGroup[] {
  return groupBy(entries, topFolder);
}

/** Group entries by numeric ID band (3xxx / 7xxx / 9xxx …). */
export function groupByIdBand(entries: LibraryEntry[]): LibraryGroup[] {
  return groupBy(entries, idBand);
}

export type VersionBucket = {
  major: string;
  count: number;
  spineBytes: number;
  imageBytes: number;
};

/** Roll up entries into per-major-version buckets (3.x / 4.x / unknown) with sizes. */
export function versionSummary(entries: LibraryEntry[]): VersionBucket[] {
  const map = new Map<string, VersionBucket>();
  for (const entry of entries) {
    const major = majorVersion(entry.version);
    const bucket = map.get(major) ?? { major, count: 0, spineBytes: 0, imageBytes: 0 };
    bucket.count += 1;
    bucket.spineBytes += entry.spineBytes;
    bucket.imageBytes += entry.imageBytes;
    map.set(major, bucket);
  }
  // Numeric majors ascending, then "unknown" last.
  return [...map.values()].sort((a, b) => {
    if (a.major === 'unknown') return 1;
    if (b.major === 'unknown') return -1;
    return Number(a.major) - Number(b.major);
  });
}

/** Human label for a major bucket: "3" → "3.x", "unknown" → "unknown". */
export function versionLabel(major: string): string {
  return major === 'unknown' ? 'unknown' : `${major}.x`;
}

/** The shared chip/search selection that scopes both the Inventory view and the Clean scan. */
export type LibrarySelection = {
  facet: 'folder' | 'id';
  selectedCats: Set<string>;
  selectedVersions: Set<string>;
  query: string;
};

/** Which facet a search term is scoped to: path+anim+skin (default), or just one of them. */
export type SearchScope = 'all' | 'anim' | 'skin';

export type ParsedQuery = { scope: SearchScope; term: string };

/**
 * Parse the Library search box into a scope + term. A leading `anim:` / `animation:` or `skin:`
 * prefix narrows the search to that facet ("anim:attack" → only animation names); otherwise the
 * term matches path, animation, and skin names alike. Term is lower-cased for case-insensitive use.
 */
export function parseQuery(raw: string): ParsedQuery {
  const trimmed = raw.trim();
  const match = /^(anim|animation|skin)\s*:\s*(.*)$/i.exec(trimmed);
  if (match) {
    const scope: SearchScope = match[1].toLowerCase().startsWith('skin') ? 'skin' : 'anim';
    return { scope, term: match[2].trim().toLowerCase() };
  }
  return { scope: 'all', term: trimmed.toLowerCase() };
}

/** True when an entry's path/anim/skin satisfies a parsed query (empty term always matches). */
export function entryMatchesQuery(entry: LibraryEntry, parsed: ParsedQuery): boolean {
  const { scope, term } = parsed;
  if (!term) return true;
  const inAnims = entry.animations.some((a) => a.toLowerCase().includes(term));
  const inSkins = entry.skins.some((s) => s.toLowerCase().includes(term));
  if (scope === 'anim') return inAnims;
  if (scope === 'skin') return inSkins;
  return entry.relPath.toLowerCase().includes(term) || inAnims || inSkins;
}

/**
 * Names within an entry that match the query, for highlighting the matched chips in the panel.
 * Anim/skin facets are only populated when the scope allows them (an `anim:` query never lights
 * up skins). A path-only "all" match returns no chip highlights.
 */
export function matchedNames(entry: LibraryEntry, parsed: ParsedQuery): { animations: Set<string>; skins: Set<string> } {
  const animations = new Set<string>();
  const skins = new Set<string>();
  const { scope, term } = parsed;
  if (term) {
    if (scope === 'all' || scope === 'anim') {
      for (const a of entry.animations) if (a.toLowerCase().includes(term)) animations.add(a);
    }
    if (scope === 'all' || scope === 'skin') {
      for (const s of entry.skins) if (s.toLowerCase().includes(term)) skins.add(s);
    }
  }
  return { animations, skins };
}

/** True when an entry passes the current category-chip, version-chip, and search filters. */
export function entryMatchesFilter(entry: LibraryEntry, sel: LibrarySelection): boolean {
  const catKey = sel.facet === 'id' ? idBand(entry) : topFolder(entry);
  if (sel.selectedCats.size > 0 && !sel.selectedCats.has(catKey)) return false;
  if (sel.selectedVersions.size > 0 && !sel.selectedVersions.has(entry.version ?? '')) return false;
  return entryMatchesQuery(entry, parseQuery(sel.query));
}

/** Short human summary of the active selection, e.g. "Hero, NPC · 3.8.99" or "" when none. */
export function selectionSummary(sel: LibrarySelection): string {
  const parts: string[] = [];
  if (sel.selectedCats.size > 0) parts.push([...sel.selectedCats].join(', '));
  if (sel.selectedVersions.size > 0) {
    parts.push([...sel.selectedVersions].map((v) => v || 'unknown').join(', '));
  }
  if (sel.query.trim()) parts.push(`"${sel.query.trim()}"`);
  return parts.join(' · ');
}

/** One entry inside a version-mix report, flagged if it diverges from its group's majority version. */
export type VersionMixEntry = { entry: LibraryEntry; diverges: boolean };

/** A folder group that spans more than one editor minor version, with the majority highlighted. */
export type VersionMixGroup = {
  key: string;
  majority: string;
  entries: VersionMixEntry[];
};

/**
 * Folder groups whose entries span more than one editor `major.minor` version — the units a lead
 * must reconcile. Within each group the most common version is the "majority"; entries on any other
 * version are flagged `diverges` so a quick filter can surface just the odd ones out. Entries with an
 * unknown version are never counted as the majority and never flagged (we can't tell what they are).
 */
export function versionMixGroups(entries: LibraryEntry[]): VersionMixGroup[] {
  return groupByFolder(entries)
    .filter((g) => g.mixedVersion)
    .map((g) => {
      const counts = new Map<string, number>();
      for (const e of g.entries) {
        const key = minorKey(e.version);
        if (key === 'unknown') continue;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      // Majority = most frequent known version; ties break to the lexicographically smaller key.
      let majority = '';
      let best = -1;
      for (const [key, count] of counts) {
        if (count > best || (count === best && key.localeCompare(majority) < 0)) {
          majority = key;
          best = count;
        }
      }
      return {
        key: g.key,
        majority,
        entries: g.entries.map((entry) => {
          const key = minorKey(entry.version);
          return { entry, diverges: key !== 'unknown' && key !== majority };
        })
      };
    });
}

export type VersionTag = { version: string | null; count: number };

/** Distinct full editor versions with counts (e.g. 3.8.99, 4.3.11), unknown last — for filter chips. */
export function versionTags(entries: LibraryEntry[]): VersionTag[] {
  const map = new Map<string, VersionTag>();
  for (const entry of entries) {
    const key = entry.version ?? '';
    const tag = map.get(key) ?? { version: entry.version ?? null, count: 0 };
    tag.count += 1;
    map.set(key, tag);
  }
  return [...map.values()].sort((a, b) => {
    if (a.version === null) return 1;
    if (b.version === null) return -1;
    return a.version.localeCompare(b.version, undefined, { numeric: true });
  });
}
