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

/** Triage order for clean-scan status groups: Not scanned → Needs review → Clean. */
const STATUS_RANK: Record<string, number> = { unknown: 0, warning: 1, clean: 2 };

/**
 * Group entries by clean-scan status ('unknown' | 'warning' | 'clean'). `statusOf` resolves the
 * status (the host owns `libraryCleanState`); groups are ordered by triage rank, not alphabetically.
 */
export function groupByStatus(entries: LibraryEntry[], statusOf: (entry: LibraryEntry) => string): LibraryGroup[] {
  return groupBy(entries, statusOf).sort((a, b) => (STATUS_RANK[a.key] ?? 99) - (STATUS_RANK[b.key] ?? 99));
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
  facet: 'folder' | 'id' | 'status';
  selectedCats: Set<string>;
  selectedVersions: Set<string>;
  query: string;
  /** Clean-scan status of an entry — required when `facet === 'status'` (cleanState lives in the host,
   *  not here). Returns the raw status key ('unknown' | 'warning' | 'clean'). */
  statusOf?: (entry: LibraryEntry) => string;
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
  const catKey =
    sel.facet === 'status' ? (sel.statusOf?.(entry) ?? 'unknown') : sel.facet === 'id' ? idBand(entry) : topFolder(entry);
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

/** Set of `.spine` files that diverge from their folder group's majority version (flat filter helper). */
export function divergingFileSet(entries: LibraryEntry[]): Set<string> {
  const set = new Set<string>();
  for (const g of versionMixGroups(entries)) {
    for (const { entry, diverges } of g.entries) {
      if (diverges) set.add(entry.spineFile);
    }
  }
  return set;
}

/** Normalize a path for cross-source comparison: forward slashes, lower-cased, no trailing sep. */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** Which sessions (and the projects they belong to) reference a given library entry. */
export type EntryUsage = {
  sessionIds: string[];
  projectIds: string[];
};

/** Minimal session shape needed to attribute usage — keeps the helper decoupled from the full type. */
export type UsageSession = { id: string; projectId: string; config: { inputFiles: string[] } };

/**
 * Map each library entry's `.spine` to the sessions/projects that list it among their input files —
 * "used by N project". Matching is on the normalized full path (case-insensitive, slash-agnostic) so
 * Windows back-slashes and casing don't cause false misses. Entries no session references come back
 * with empty arrays (the "orphan"/unused candidates for cleanup). Keyed by `entry.spineFile`.
 */
export function usageByEntry(entries: LibraryEntry[], sessions: UsageSession[]): Map<string, EntryUsage> {
  // normalized .spine path → the sessions/projects referencing it.
  const byPath = new Map<string, { sessionIds: Set<string>; projectIds: Set<string> }>();
  for (const s of sessions) {
    for (const file of s.config.inputFiles) {
      const key = normalizePath(file);
      let rec = byPath.get(key);
      if (!rec) {
        rec = { sessionIds: new Set(), projectIds: new Set() };
        byPath.set(key, rec);
      }
      rec.sessionIds.add(s.id);
      rec.projectIds.add(s.projectId);
    }
  }
  const result = new Map<string, EntryUsage>();
  for (const entry of entries) {
    const rec = byPath.get(normalizePath(entry.spineFile));
    result.set(entry.spineFile, {
      sessionIds: rec ? [...rec.sessionIds] : [],
      projectIds: rec ? [...rec.projectIds] : []
    });
  }
  return result;
}

// ---- tags / ownership (Tier C #4) ------------------------------------------
// Free-form tags + an optional manual owner per asset. Stored in a sidecar in the sync root
// (merge-before-write, like the Drive-meta cache) and keyed by the machine-independent relPath so
// the same tags show up on every machine / for every teammate sharing the Drive folder.

export type EntryMeta = { tags: string[]; owner?: string };
/** relPath (forward-slashed) → its tags/owner. Absent keys carry no metadata. */
export type LibraryMeta = Record<string, EntryMeta>;

/** Stable, machine-independent metadata key for an entry (library-root-relative, forward slashes). */
export function metaKeyForEntry(entry: LibraryEntry): string {
  return entry.relPath.replace(/\\/g, '/');
}

/** Collapse surrounding/inner whitespace so "  cần  review " and "cần review" are the same tag. */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** Apply an edit to one key, pruning the entry entirely when it ends up with no tags and no owner. */
function withMetaEntry(meta: LibraryMeta, key: string, fn: (e: EntryMeta) => EntryMeta): LibraryMeta {
  const current = meta[key] ?? { tags: [] };
  const next = fn({ tags: [...current.tags], owner: current.owner });
  if (next.tags.length === 0 && !next.owner) {
    const { [key]: _drop, ...rest } = meta;
    return rest;
  }
  return { ...meta, [key]: next };
}

/** Add a tag (deduped case-insensitively; blank tags ignored). Returns a new map. */
export function addTag(meta: LibraryMeta, key: string, rawTag: string): LibraryMeta {
  const tag = normalizeTag(rawTag);
  if (!tag) return meta;
  return withMetaEntry(meta, key, (e) => {
    if (!e.tags.some((x) => x.toLowerCase() === tag.toLowerCase())) e.tags.push(tag);
    return e;
  });
}

/** Remove a tag (case-insensitive match). Returns a new map. */
export function removeTag(meta: LibraryMeta, key: string, tag: string): LibraryMeta {
  return withMetaEntry(meta, key, (e) => {
    e.tags = e.tags.filter((x) => x.toLowerCase() !== tag.toLowerCase());
    return e;
  });
}

/** Set (or clear, when blank) the manual owner. Returns a new map. */
export function setOwner(meta: LibraryMeta, key: string, owner: string): LibraryMeta {
  const trimmed = owner.trim();
  return withMetaEntry(meta, key, (e) => {
    e.owner = trimmed || undefined;
    return e;
  });
}

/** Distinct tags across the whole map, sorted — for the filter chip row. */
export function allTags(meta: LibraryMeta): string[] {
  const byLower = new Map<string, string>();
  for (const e of Object.values(meta)) {
    for (const tag of e.tags) {
      const lower = tag.toLowerCase();
      if (!byLower.has(lower)) byLower.set(lower, tag);
    }
  }
  return [...byLower.values()].sort((a, b) => a.localeCompare(b));
}

/** True when an entry carries at least one of the selected tags (OR semantics; empty = match all). */
export function entryMatchesTags(metaEntry: EntryMeta | undefined, selected: Set<string>): boolean {
  if (selected.size === 0) return true;
  if (!metaEntry || metaEntry.tags.length === 0) return false;
  const have = new Set(metaEntry.tags.map((t) => t.toLowerCase()));
  for (const s of selected) if (have.has(s.toLowerCase())) return true;
  return false;
}

// ---- notes / comments (file & folder) -------------------------------------
// Free-form multi-line notes a leader (or anyone) leaves on a Library file or folder — e.g.
// "missing attack anim, re-export". Stored in their own sidecar (spineforge-library-notes.json),
// keyed by the machine-independent relPath for files and a `dir:`-prefixed key for folders so the
// two namespaces never collide. Merge-before-write unions by note id (not last-writer-wins) so two
// leaders annotating the same target don't clobber each other.

export type LibraryNote = {
  id: string; // crypto.randomUUID()
  text: string;
  authorEmail: string; // denormalized so the author shows without a Drive lookup
  createdAt: number; // Date.now()
  updatedAt: number;
  resolved: boolean;
  resolvedBy?: string;
};
/** note key (relPath for a file, `dir:<sectionKey>` for a folder) → its notes. */
export type LibraryNotes = Record<string, LibraryNote[]>;

/** Folder note key — `dir:` prefix keeps it out of the file (relPath) namespace. */
export function metaKeyForFolder(folderKey: string): string {
  return `dir:${folderKey}`;
}

/** Apply an edit to one key's note array, pruning the key entirely when it ends up empty. */
function withNotesEntry(notes: LibraryNotes, key: string, fn: (list: LibraryNote[]) => LibraryNote[]): LibraryNotes {
  const next = fn([...(notes[key] ?? [])]);
  if (next.length === 0) {
    const { [key]: _drop, ...rest } = notes;
    return rest;
  }
  return { ...notes, [key]: next };
}

/** Append a note to a key. Returns a new map. */
export function addNote(notes: LibraryNotes, key: string, note: LibraryNote): LibraryNotes {
  return withNotesEntry(notes, key, (list) => [...list, note]);
}

/** Remove a note by id. Returns a new map (key pruned when it empties). */
export function removeNote(notes: LibraryNotes, key: string, id: string): LibraryNotes {
  return withNotesEntry(notes, key, (list) => list.filter((n) => n.id !== id));
}

/** Mark a note resolved/unresolved, stamping `resolvedBy` + `updatedAt`. Returns a new map. */
export function setNoteResolved(notes: LibraryNotes, key: string, id: string, resolved: boolean, by: string, now: number): LibraryNotes {
  return withNotesEntry(notes, key, (list) =>
    list.map((n) => (n.id === id ? { ...n, resolved, resolvedBy: resolved ? by : undefined, updatedAt: now } : n))
  );
}

/** Notes for a key (empty array when none). */
export function notesFor(notes: LibraryNotes, key: string): LibraryNote[] {
  return notes[key] ?? [];
}

/** How many of a key's notes are still open (unresolved) — drives the badge/highlight. */
export function unresolvedCount(notes: LibraryNotes, key: string): number {
  return (notes[key] ?? []).reduce((n, note) => n + (note.resolved ? 0 : 1), 0);
}

/** Total notes on a key, including resolved — used for the badge when "show resolved" is on. */
export function noteCount(notes: LibraryNotes, key: string): number {
  return (notes[key] ?? []).length;
}

/** Union two note arrays by id, keeping the newer `updatedAt` for each id — for merge-before-write. */
export function mergeNoteArrays(a: LibraryNote[] = [], b: LibraryNote[] = []): LibraryNote[] {
  const byId = new Map<string, LibraryNote>();
  for (const note of a) byId.set(note.id, note);
  for (const note of b) {
    const existing = byId.get(note.id);
    if (!existing || note.updatedAt >= existing.updatedAt) byId.set(note.id, note);
  }
  return [...byId.values()];
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
