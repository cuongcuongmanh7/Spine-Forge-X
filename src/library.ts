import type { LibraryEntry } from './config';

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
