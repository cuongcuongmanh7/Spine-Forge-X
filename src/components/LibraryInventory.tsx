import { useCallback, useMemo, useState } from 'react';
import { usePersistentState, usePersistentSet } from '../usePersistentState';
import { invoke } from '@tauri-apps/api/core';
import { AlertTriangle, CheckCircle2, CloudDownload, Layers, MessageSquare, RotateCw, Search, SearchX, Tag, Trash2, Users, X } from 'lucide-react';
import { SpineFileIcon } from './SpineFileIcon';
import { MenuPopover } from './MenuPopover';
import { LibraryTrashModal } from './LibraryTrashModal';
import { useApp } from '../useAppController';
import { Section as CollapsibleSection } from './common';
import { LibraryStatCards } from './LibraryStatCards';
import { LibrarySelectBar } from './LibrarySelectBar';
import { basename } from '../sessions';
import { formatDate } from '../time';
import type { LibraryEntry } from '../config';
import { useLibraryDrive } from '../useLibraryDrive';
import { useDriveWatch } from '../useDriveWatch';
import { useThumbnailWarm } from '../useSpineThumbnail';
import { useLibraryTags } from '../useLibraryTags';
import type { LibraryNotesApi } from '../useLibraryNotes';
import { LibraryTable } from './LibraryTable';
import { LibraryGrid } from './LibraryGrid';
import { NotesModal } from './NotesModal';
import './NotesModal.css';
import './LibraryMeta.css';
import './LibraryFilters.css';
import {
  entryMatchesFilter,
  groupByFolder,
  groupByIdBand,
  groupByStatus,
  cleanStatusForEntry,
  type LibraryCleanStatus,
  entryMatchesTags,
  metaKeyForEntry,
  parseQuery,
  usageByEntry,
  divergingFileSet,
  versionTags,
  type LibraryThresholds
} from '../library';
import type { LibraryFilterApi } from '../useLibraryFilter';
import type { LibraryViewProps, Section, SortKey, SortState } from './LibraryViewShared';

const SORT_TIEBREAKER = { numeric: true, sensitivity: 'base' } as const;

// Persisted collapse state for the inventory header sections (stats / filters).
const STATS_KEY = 'libraryInventory.statsCollapsed';
const FILTERS_KEY = 'libraryInventory.filtersCollapsed';

/** Inventory tab host: stats, chip filters, search, view toggle — renders the table or grid view. */
export function LibraryInventory({
  filter,
  tags,
  drive,
  notes,
  onPrepareCleanScan,
  onPreview,
  onHealthCheck
}: {
  filter: LibraryFilterApi;
  tags: ReturnType<typeof useLibraryTags>;
  drive: ReturnType<typeof useLibraryDrive>;
  notes: LibraryNotesApi;
  onPrepareCleanScan: (spineFiles: string[]) => void;
  onPreview: (entry: LibraryEntry) => void;
  onHealthCheck: (entry: LibraryEntry) => void;
}) {
  const {
    t,
    appConfig,
    updateAppConfig,
    merged,
    activeLibrary,
    libraryScan,
    libraryCleanState,
    isScanningLibrary,
    rescanLibrary,
    createSessionFromLibrary,
    createProjectFromLibrary,
    setViewMode,
    pushToast,
    driveAccount,
    libraryDir,
    sessions,
    projects,
    selectSession,
    addDriveChanges,
    quickExport,
    anyRunning,
    addToTrash,
    restoreFromTrash,
    trashedEntries
  } = useApp();

  const { facet, selectedCats, selectedVersions, query, invert, clearFilters, selected, toggleSelected, setManySelected, clearSelected } = filter;
  const viewMode = appConfig.libraryViewMode;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expandedAnims, setExpandedAnims] = useState<Set<string>>(new Set());
  // Which row's "⋯" action menu is open (keyed by `.spine` path); null = none.
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ key: 'entry', direction: 'asc' });
  // "Used-by-projects": show only assets no session references — cleanup candidates.
  // These filter chips are persisted (like the shared filter) so they survive a tab switch.
  const [unusedOnly, setUnusedOnly] = usePersistentState('libraryInventory.unusedOnly', false);
  // Tags/ownership: tag-chip filter selection.
  const [selectedTags, setSelectedTags] = usePersistentSet('libraryInventory.tags');
  // Filter by responsible person: manual owner OR Drive owner/last-editor name.
  const [selectedUsers, setSelectedUsers] = usePersistentSet('libraryInventory.users');
  // Version-mix triage: show only files that diverge from their folder group's majority version.
  const [divergingOnly, setDivergingOnly] = usePersistentState('libraryInventory.divergingOnly', false);
  // Status filter (export + clean-scan), independent of the facet so it composes with any grouping
  // (e.g. group by type "pet" AND show only not-exported / needs-review). Keys match statusOf:
  // 'not-exported' | 'unknown' (not scanned) | 'warning' (needs review) | 'clean'. Empty = all.
  const [selectedStatuses, setSelectedStatuses] = usePersistentSet('libraryInventory.statuses');
  // Notes/comments: which target's notes modal is open, and whether resolved notes are shown.
  const [notesTarget, setNotesTarget] = useState<{ key: string; label: string } | null>(null);
  const [showResolved, setShowResolved] = usePersistentState('libraryInventory.showResolved', false);
  // Collapsed-filter chip preview: anchor for the overflow ("… +k") popover, and the trash modal.
  const [chipsOverflowAnchor, setChipsOverflowAnchor] = useState<HTMLElement | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  // Count of active chip filters — surfaced as a badge on the collapsible Filters section header.
  const activeFilterCount =
    selectedCats.size + selectedVersions.size + selectedUsers.size + selectedTags.size +
    (unusedOnly ? 1 : 0) + (showResolved ? 1 : 0) + (divergingOnly ? 1 : 0) + (facet === 'status' ? 0 : selectedStatuses.size);

  // Reset every filter at once — the shared chips/search (via the hook) plus the chip sets owned here.
  function clearAllFilters() {
    clearFilters();
    setSelectedTags(new Set());
    setSelectedUsers(new Set());
    setSelectedStatuses(new Set());
    setUnusedOnly(false);
    setDivergingOnly(false);
    setShowResolved(false);
  }

  const { tagList, metaFor, addEntryTag, removeEntryTag, setEntryOwner } = tags;

  const { driveInfo, expandedInfo, loadingBasics, basicsProgress, basicsLoadedAt, basicFor, toggleDriveInfo, loadDriveBasics, refreshBasicsSilently, openRevisionInSpine } =
    drive;

  const thresholds: LibraryThresholds = {
    imageFolderWarnMB: appConfig.libraryImageFolderWarnMB,
    spineFileWarnMB: appConfig.librarySpineFileWarnMB
  };

  const entries = libraryScan?.entries ?? [];

  // Auto-detect Drive changes while this tab is open: Changes-API poll (edit/rename/add/delete) +
  // filesystem watch (add/remove). Edits refresh silently; add/remove rescan; all surface as a
  // notification on the top-bar bell. Stops when the tab unmounts or the window loses focus.
  useDriveWatch({
    enabled: !!driveAccount,
    libraryDir,
    rootPath: activeLibrary?.rootPath ?? '',
    entries,
    refreshBasics: refreshBasicsSilently,
    rescanLibrary,
    onChanges: addDriveChanges
  });

  // Clean-scan status of an entry as a stable group key ('not-exported' | 'unknown' | 'warning' | 'clean');
  // the host owns `libraryCleanState`, so we inject this into the "By status" grouping/filter. Entries that
  // were never exported can't be clean-scanned (no atlas), so they get their own bucket ahead of the scan states.
  const statusOf = useCallback(
    (e: LibraryEntry): string => (e.exported ? cleanStatusForEntry(e, libraryCleanState[e.spineFile]) : 'not-exported'),
    [libraryCleanState]
  );
  // Localized label for a status group key (chips + section headers under the "By status" facet).
  const statusLabel = useCallback(
    (key: string): string =>
      key === 'clean'
        ? t.libraryStatClean
        : key === 'warning'
          ? t.libraryStatNeedsReview
          : key === 'not-exported'
            ? t.libraryStatNotExported
            : t.libraryStatNotScanned,
    [t]
  );

  const catChips = useMemo(
    () => (facet === 'status' ? groupByStatus(entries, statusOf) : facet === 'id' ? groupByIdBand(entries) : groupByFolder(entries)),
    [entries, facet, statusOf]
  );
  const versions = useMemo(() => versionTags(entries), [entries]);
  // Status filter chips (export + clean-scan), always available regardless of the active facet,
  // in triage order (not-exported → not-scanned → needs-review → clean) with per-status counts.
  const statusChips = useMemo(() => groupByStatus(entries, statusOf), [entries, statusOf]);

  const usage = useMemo(() => usageByEntry(entries, sessions), [entries, sessions]);
  const projectName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const sessionById = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);

  // Files that diverge from their folder group's majority version — drives the "diverging only" chip.
  const divergingSet = useMemo(() => divergingFileSet(entries), [entries]);

  // Effective person for a file: manual owner first, else the Drive owner/last-editor name.
  // (Drive names need "Load Drive data" pressed; manual owners are always available.)
  const effectiveOwner = useCallback(
    (e: LibraryEntry): string => {
      const d = basicFor(e);
      return metaFor(e)?.owner || d?.ownerName || d?.ownerEmail || d?.lastEditorName || d?.lastEditorEmail || '';
    },
    [metaFor, basicFor]
  );

  // Distinct users present across the library, with counts — sorted by count desc then name.
  const userChips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries) {
      const owner = effectiveOwner(e);
      if (owner) counts.set(owner, (counts.get(owner) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [entries, effectiveOwner]);

  const filtered = useMemo(() => {
    let base = entries.filter((e) => entryMatchesFilter(e, { facet, selectedCats, selectedVersions, query, invert, statusOf }));
    // Skipped under the Status facet — the category chips above already filter by status there.
    if (facet !== 'status' && selectedStatuses.size > 0) base = base.filter((e) => selectedStatuses.has(statusOf(e)));
    if (unusedOnly) base = base.filter((e) => (usage.get(e.spineFile)?.projectIds.length ?? 0) === 0);
    if (divergingOnly) base = base.filter((e) => divergingSet.has(e.spineFile));
    if (selectedTags.size > 0) base = base.filter((e) => entryMatchesTags(metaFor(e), selectedTags));
    if (selectedUsers.size > 0) base = base.filter((e) => selectedUsers.has(effectiveOwner(e)));
    return base;
  }, [entries, facet, selectedCats, selectedVersions, query, invert, statusOf, selectedStatuses, unusedOnly, usage, divergingOnly, divergingSet, selectedTags, metaFor, selectedUsers, effectiveOwner]);

  const parsedQuery = useMemo(() => parseQuery(query), [query]);

  const sorted = useMemo(() => {
    function compareString(a: string, b: string) {
      return a.localeCompare(b, undefined, SORT_TIEBREAKER);
    }
    function compareVersion(a: string | null, b: string | null) {
      if (a === b) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return compareString(a, b);
    }
    function compareMaybeEmpty(a: string, b: string) {
      if (a === b) return 0;
      if (!a) return 1;
      if (!b) return -1;
      return compareString(a, b);
    }
    const ownerOf = (e: LibraryEntry) => {
      const d = basicFor(e);
      return d?.ownerName || d?.ownerEmail || d?.lastEditorName || d?.lastEditorEmail || '';
    };
    const modifiedOf = (e: LibraryEntry) => basicFor(e)?.modifiedTime || '';

    function compareEntry(a: LibraryEntry, b: LibraryEntry) {
      let result = 0;
      if (sort.key === 'entry') result = compareString(a.relPath, b.relPath);
      else if (sort.key === 'version') result = compareVersion(a.version, b.version);
      else if (sort.key === 'spine') result = a.spineBytes - b.spineBytes;
      else if (sort.key === 'images') result = a.imageBytes - b.imageBytes;
      else if (sort.key === 'owner') result = compareMaybeEmpty(ownerOf(a), ownerOf(b));
      else if (sort.key === 'modified') result = compareMaybeEmpty(modifiedOf(a), modifiedOf(b));
      else result = a.animationCount - b.animationCount;

      if (result === 0) result = compareString(a.relPath, b.relPath);
      return sort.direction === 'asc' ? result : -result;
    }

    return [...filtered].sort(compareEntry);
  }, [filtered, sort, basicFor]);

  const scanCounts = useMemo(() => {
    let clean = 0;
    let warning = 0;
    let unknown = 0;
    for (const e of entries) {
      const status = cleanStatusForEntry(e, libraryCleanState[e.spineFile]);
      if (status === 'clean') clean += 1;
      else if (status === 'warning') warning += 1;
      else unknown += 1;
    }
    return { clean, warning, unknown };
  }, [entries, libraryCleanState]);

  // Grid open → pull all shared thumbnails into the local cache in parallel so scrolling is instant,
  // instead of each card fetching from Cloud Storage one-by-one as it appears.
  useThumbnailWarm(sorted, viewMode === 'grid');

  const sections = useMemo<Section[]>(() => {
    const groups = facet === 'status' ? groupByStatus(sorted, statusOf) : facet === 'id' ? groupByIdBand(sorted) : groupByFolder(sorted);
    return groups.map((g) => ({
      key: g.key,
      label: facet === 'status' ? statusLabel(g.key) : g.key,
      entries: g.entries,
      mixedVersion: g.mixedVersion
    }));
  }, [sorted, facet, statusOf, statusLabel]);

  function toggleSet(setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const allCollapsed = sections.length > 0 && sections.every((s) => collapsed.has(s.key));
  function toggleCollapseAll() {
    setCollapsed(allCollapsed ? new Set() : new Set(sections.map((s) => s.key)));
  }

  function entryName(entry: LibraryEntry): string {
    return basename(entry.spineFile).replace(/\.spine$/i, '');
  }

  async function openInSpine(entry: LibraryEntry) {
    try {
      await invoke('open_in_spine', { spinePath: merged.spinePath, file: entry.spineFile });
    } catch (error) {
      pushToast(`${t.libraryOpenFailed}: ${String(error)}`, 'error');
    }
  }

  async function openFolder(entry: LibraryEntry) {
    try {
      await invoke('open_path', { path: entry.folder });
    } catch (error) {
      pushToast(`${t.libraryOpenFolderFailed}: ${String(error)}`, 'error');
    }
  }

  function goToSession(sessionId: string) {
    selectSession(sessionId);
    setViewMode('workspace');
  }

  function usageTooltip(spineFile: string): string {
    const ids = usage.get(spineFile)?.sessionIds ?? [];
    return ids
      .map((id) => {
        const s = sessionById.get(id);
        return s ? `${projectName.get(s.projectId) ?? '?'} › ${s.name}` : id;
      })
      .join('\n');
  }

  function createSessionForEntry(entry: LibraryEntry) {
    createSessionFromLibrary(entryName(entry), [entry.spineFile], entry.folder);
    pushToast(t.librarySessionCreated.replace('{name}', entryName(entry)), 'success');
  }

  function createSessionForSection(section: Section) {
    const root = activeLibrary?.rootPath ?? section.entries[0]?.folder ?? '';
    createSessionFromLibrary(section.label, section.entries.map((e) => e.spineFile), root);
    pushToast(t.librarySessionCreated.replace('{name}', section.label), 'success');
  }

  function createProjectFromLib() {
    if (!activeLibrary || sections.length === 0) return;
    const root = activeLibrary.rootPath;
    const items = sections.map((s) => ({ name: s.label, spineFiles: s.entries.map((e) => e.spineFile), inputPath: root }));
    createProjectFromLibrary(activeLibrary.name, items);
    pushToast(t.libraryProjectCreated.replace('{name}', activeLibrary.name).replace('{count}', String(items.length)), 'success');
    setViewMode('workspace');
  }

  function toggleSort(key: SortKey) {
    setSort((prev) => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }));
  }

  function ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    if (sort.key !== key) return 'none';
    return sort.direction === 'asc' ? 'ascending' : 'descending';
  }

  function sortMark(key: SortKey) {
    if (sort.key !== key) return null;
    return (
      <span className="library-sort-mark" aria-hidden="true">
        {sort.direction === 'asc' ? '^' : 'v'}
      </span>
    );
  }

  function cleanStatus(entry: LibraryEntry): LibraryCleanStatus {
    return cleanStatusForEntry(entry, libraryCleanState[entry.spineFile]);
  }

  const sortLabels: Record<SortKey, string> = {
    entry: t.libraryColEntry,
    version: t.libraryColVersion,
    spine: t.libraryColSpine,
    images: t.libraryColImages,
    anims: t.libraryColAnims,
    owner: t.libraryColOwner,
    modified: t.driveColModified
  };

  // The single source of truth handed to whichever view is active — keeps both layouts in sync.
  const view: LibraryViewProps = {
    t,
    sections,
    thresholds,
    parsedQuery,
    collapsed,
    toggleCollapsed: (key) => toggleSet(setCollapsed, key),
    expandedAnims,
    toggleAnim: (spineFile) => toggleSet(setExpandedAnims, spineFile),
    menuOpen,
    setMenuOpen,
    sort,
    toggleSort,
    ariaSort,
    sortMark,
    allCollapsed,
    toggleCollapseAll,
    usage,
    usageTooltip,
    goToSession,
    metaFor,
    addEntryTag,
    removeEntryTag,
    setEntryOwner,
    openNotes: (key, label) => setNotesTarget({ key, label }),
    // Badge/highlight count: open notes only, unless "show resolved" is on (then count all).
    noteCount: (key: string) => (showResolved ? notes.countForKey(key) : notes.unresolvedForKey(key)),
    driveInfo,
    expandedInfo,
    basicFor,
    toggleDriveInfo,
    openRevisionInSpine,
    cleanStatus,
    openFolder: (e) => void openFolder(e),
    openInSpine: (e) => void openInSpine(e),
    createSessionForEntry,
    createSessionForSection,
    onPrepareCleanScan,
    onPreview,
    onHealthCheck,
    onQuickExport: (spineFiles) => void quickExport(spineFiles),
    quickExportBusy: anyRunning,
    onMoveToTrash: (e: LibraryEntry) => addToTrash(e),
    selected,
    toggleSelected,
    setManySelected
  };

  // Essential facet (folder / id / status) toggle — shared by the Filters body and its collapsed preview.
  const facetControl = (
    <span className="segmented-control">
      <button className={facet === 'folder' ? 'active' : ''} onClick={() => filter.setFacet('folder')}>
        {t.libraryFacetFolder}
      </button>
      <button className={facet === 'id' ? 'active' : ''} onClick={() => filter.setFacet('id')}>
        {t.libraryFacetId}
      </button>
      <button className={facet === 'status' ? 'active' : ''} onClick={() => filter.setFacet('status')}>
        {t.libraryFacetStatus}
      </button>
    </span>
  );

  // Filters header accessory: a "Clear all" link beside the active-filter count badge.
  const filtersAccessory =
    activeFilterCount > 0 ? (
      <>
        <button className="library-clear-filters" onClick={clearAllFilters} title={t.libraryClearFilters}>
          <X size={13} /> {t.libraryClearFilters}
        </button>
        <span className="section-badge">{activeFilterCount}</span>
      </>
    ) : undefined;

  // Key metrics surfaced when the Stats card is collapsed: total entries, clean, needs-review.
  const statsPreview = (
    <div className="section-mini-cards">
      <span className="mini-card">
        <SpineFileIcon size={14} /> <b>{entries.length}</b> {t.libraryTotalEntries}
      </span>
      <span className="mini-card ok">
        <CheckCircle2 size={14} /> <b>{scanCounts.clean}</b> {t.libraryStatClean}
      </span>
      <span className="mini-card warn">
        <AlertTriangle size={14} /> <b>{scanCounts.warning}</b> {t.libraryStatNeedsReview}
      </span>
    </div>
  );

  // Flat list of every active filter as a removable chip — drives the collapsed-card preview and its
  // overflow popover. Each chip's `remove` toggles exactly the selection it represents back off.
  const activeChips: { id: string; label: string; remove: () => void }[] = [
    ...[...selectedCats].map((key) => ({
      id: `cat:${key}`,
      label: facet === 'status' ? statusLabel(key) : key,
      remove: () => filter.toggleCat(key)
    })),
    ...[...selectedVersions].map((key) => ({
      id: `ver:${key}`,
      label: key || t.libraryUnknownVersion,
      remove: () => filter.toggleVersion(key)
    })),
    ...(facet !== 'status'
      ? [...selectedStatuses].map((key) => ({ id: `st:${key}`, label: statusLabel(key), remove: () => toggleSet(setSelectedStatuses, key) }))
      : []),
    ...[...selectedUsers].map((name) => ({ id: `usr:${name}`, label: name, remove: () => toggleSet(setSelectedUsers, name) })),
    ...[...selectedTags].map((tag) => ({ id: `tag:${tag}`, label: tag, remove: () => toggleSet(setSelectedTags, tag) })),
    ...(unusedOnly ? [{ id: 'unused', label: t.libraryUnusedOnly, remove: () => setUnusedOnly(false) }] : []),
    ...(divergingOnly ? [{ id: 'diverging', label: t.libraryVersionOnlyDiverging, remove: () => setDivergingOnly(false) }] : []),
    ...(showResolved ? [{ id: 'resolved', label: t.notesShowResolved, remove: () => setShowResolved(false) }] : []),
    ...(query.trim() ? [{ id: 'query', label: `${invert ? '≠ ' : ''}"${query.trim()}"`, remove: () => filter.setQuery('') }] : [])
  ];
  const CHIP_PREVIEW_MAX = 4;
  const previewChips = activeChips.slice(0, CHIP_PREVIEW_MAX);
  const overflowChips = activeChips.slice(CHIP_PREVIEW_MAX);

  // Essential controls surfaced when the Filters card is collapsed: facet group + active-filter chips
  // (overflow folded into a popover) + view toggle.
  const filtersPreview = (
    <>
      {facetControl}
      {activeChips.length > 0 && (
        <span className="library-preview-chips">
          {previewChips.map((c) => (
            <button key={c.id} type="button" className="library-preview-chip" onClick={(e) => { e.stopPropagation(); c.remove(); }} title={c.label}>
              {c.label} <span className="library-preview-chip-x">×</span>
            </button>
          ))}
          {overflowChips.length > 0 && (
            <button
              type="button"
              className="library-preview-chip more"
              onClick={(e) => { e.stopPropagation(); setChipsOverflowAnchor(chipsOverflowAnchor ? null : (e.currentTarget as HTMLElement)); }}
            >
              … +{overflowChips.length}
            </button>
          )}
        </span>
      )}
    </>
  );

  return (
    <div className="library-pane">
      <div className="library-pane-head">
        <CollapsibleSection title={t.libraryStatsTitle} storageKey={STATS_KEY} collapsedPreview={statsPreview}>
          <LibraryStatCards t={t} totalEntries={entries.length} totalImageBytes={libraryScan?.totalImageBytes ?? 0} scanCounts={scanCounts} />
        </CollapsibleSection>

        <CollapsibleSection
          title={t.libraryFiltersTitle}
          storageKey={FILTERS_KEY}
          accessory={filtersAccessory}
          collapsedPreview={filtersPreview}
        >
        <div className="library-chip-row">
          <span className="library-chip-label">{t.libraryFacetLabel}</span>
          <div className="library-chip-set">{facetControl}</div>
        </div>

        <div className="library-chip-row">
          <span className="library-chip-label">{t.libraryFilterCategory}</span>
          <div className="library-chip-set">
            {catChips.map((c) => (
              <button
                key={c.key}
                className={`library-chip ${selectedCats.has(c.key) ? 'active' : ''} ${c.mixedVersion ? 'mixed' : ''}`}
                onClick={() => filter.toggleCat(c.key)}
                title={c.mixedVersion ? t.libraryWarnMixed : undefined}
              >
                {c.mixedVersion && <AlertTriangle size={12} />}
                {facet === 'status' ? statusLabel(c.key) : c.key} <em>{c.entries.length}</em>
              </button>
            ))}
          </div>
        </div>

        <div className="library-chip-row">
          <span className="library-chip-label">{t.libraryFilterVersion}</span>
          <div className="library-chip-set">
            {versions.map((v) => {
              const key = v.version ?? '';
              return (
                <button
                  key={key || 'unknown'}
                  className={`library-chip ${selectedVersions.has(key) ? 'active' : ''}`}
                  onClick={() => filter.toggleVersion(key)}
                >
                  {v.version ?? t.libraryUnknownVersion} <em>{v.count}</em>
                </button>
              );
            })}
            {divergingSet.size > 0 && (
              <button
                className={`library-chip mixed ${divergingOnly ? 'active' : ''}`}
                onClick={() => setDivergingOnly((v) => !v)}
                aria-pressed={divergingOnly}
                title={t.libraryWarnMixed}
              >
                <AlertTriangle size={12} /> {t.libraryVersionOnlyDiverging} <em>{divergingSet.size}</em>
              </button>
            )}
          </div>
        </div>

        {/* When grouping by Status, the category chips above already are the status buckets — hide
            this row to avoid two identical chip sets. */}
        {facet !== 'status' && (
        <div className="library-chip-row">
          <span className="library-chip-label">{t.libraryFilterStatus}</span>
          <div className="library-chip-set">
            {statusChips.map((s) => (
              <button
                key={s.key}
                className={`library-chip ${selectedStatuses.has(s.key) ? 'active' : ''}`}
                onClick={() => toggleSet(setSelectedStatuses, s.key)}
                aria-pressed={selectedStatuses.has(s.key)}
              >
                {statusLabel(s.key)} <em>{s.entries.length}</em>
              </button>
            ))}
          </div>
        </div>
        )}

        <div className="library-chip-row">
          <span className="library-chip-label">{t.libraryColUsedBy}</span>
          <div className="library-chip-set">
            <button className={`library-chip ${unusedOnly ? 'active' : ''}`} onClick={() => setUnusedOnly((v) => !v)} aria-pressed={unusedOnly}>
              <Users size={12} /> {t.libraryUnusedOnly}
            </button>
            <button className={`library-chip ${showResolved ? 'active' : ''}`} onClick={() => setShowResolved((v) => !v)} aria-pressed={showResolved}>
              <MessageSquare size={12} /> {t.notesShowResolved}
            </button>
            {trashedEntries.length > 0 && (
              <button className="library-chip" onClick={() => setTrashOpen(true)} title={t.libraryTrashTitle}>
                <Trash2 size={12} /> {t.libraryTrashFilter} <em>{trashedEntries.length}</em>
              </button>
            )}
          </div>
        </div>

        {userChips.length > 0 && (
          <div className="library-chip-row">
            <span className="library-chip-label">{t.libraryFilterUser}</span>
            <div className="library-chip-set">
              {userChips.map(([name, count]) => (
                <button
                  key={name}
                  className={`library-chip ${selectedUsers.has(name) ? 'active' : ''}`}
                  onClick={() => toggleSet(setSelectedUsers, name)}
                  aria-pressed={selectedUsers.has(name)}
                >
                  <Users size={11} /> {name} <em>{count}</em>
                </button>
              ))}
            </div>
          </div>
        )}

        {tagList.length > 0 && (
          <div className="library-chip-row">
            <span className="library-chip-label">{t.libraryFilterTag}</span>
            <div className="library-chip-set">
              {tagList.map((tag) => (
                <button key={tag} className={`library-chip ${selectedTags.has(tag) ? 'active' : ''}`} onClick={() => toggleSet(setSelectedTags, tag)}>
                  <Tag size={11} /> {tag}
                </button>
              ))}
            </div>
          </div>
        )}
        </CollapsibleSection>

        <div className="library-search-row">
          <div className="library-search-field">
            <Search size={15} className="library-search-icon" />
            <input
              className="library-search"
              value={query}
              aria-label={t.librarySearchPlaceholder}
              placeholder={t.librarySearchPlaceholder}
              onChange={(e) => filter.setQuery(e.target.value)}
            />
            <button
              type="button"
              className={`library-search-invert ${invert ? 'active' : ''}`}
              onClick={() => filter.setInvert((v) => !v)}
              aria-pressed={invert}
              title={t.libraryInvertSearch}
              aria-label={t.libraryInvertSearch}
            >
              <SearchX size={15} />
            </button>
          </div>
          <span className="muted library-lastscan">
            <span>
              {t.libraryLastScan}: {activeLibrary?.lastScanAt ? formatDate(activeLibrary.lastScanAt) : t.libraryNeverScanned}
            </span>
            {basicsLoadedAt && <span>{t.libraryLastDriveLoad}: {formatDate(basicsLoadedAt)}</span>}
          </span>
          <button className="secondary-button small" onClick={() => void rescanLibrary()} disabled={isScanningLibrary}>
            <RotateCw size={14} className={isScanningLibrary ? 'spin' : undefined} /> {t.libraryRescan}
          </button>
          <button className="secondary-button small" onClick={() => void loadDriveBasics(filtered)} disabled={loadingBasics} title={t.driveLoadDataHelp}>
            {loadingBasics ? <RotateCw size={14} className="spin" /> : <CloudDownload size={14} />} {t.driveLoadData}
            {loadingBasics && basicsProgress ? ` ${basicsProgress.done}/${basicsProgress.total}` : ''}
          </button>
        </div>
      </div>

      {sections.length > 0 && (
        <LibrarySelectBar
          filtered={filtered}
          selected={selected}
          setManySelected={setManySelected}
          clearSelected={clearSelected}
          viewMode={viewMode}
          setViewMode={(mode) => updateAppConfig('libraryViewMode', mode)}
          sort={sort}
          setSort={setSort}
          sortLabels={sortLabels}
          t={t}
        />
      )}

      <div className="library-pane-scroll">
        {sections.length === 0 ? (
          // `libraryScan === null` → no inventory cached on this machine (scan never succeeded,
          // e.g. master path not mounted); a non-null scan with no sections genuinely has no .spine.
          <p className="helper-text">{libraryScan === null ? t.libraryNotScanned : t.libraryNoSpine}</p>
        ) : viewMode === 'grid' ? (
          <LibraryGrid {...view} />
        ) : (
          <LibraryTable {...view} />
        )}
      </div>

      <div className="library-pane-foot">
        <span className="helper-text">{t.libraryHelp}</span>
        <button className="primary-button" onClick={createProjectFromLib} disabled={sections.length === 0}>
          <Layers size={15} /> {t.libraryCreateProject}
        </button>
      </div>

      {notesTarget && (
        <NotesModal
          t={t}
          targetLabel={notesTarget.label}
          notes={notes.notesForKey(notesTarget.key)}
          showResolved={showResolved}
          onToggleShowResolved={() => setShowResolved((v) => !v)}
          onAdd={(text) => notes.addNoteByKey(notesTarget.key, text)}
          onToggleResolved={(id) => notes.toggleResolved(notesTarget.key, id)}
          onDelete={(id) => notes.deleteNote(notesTarget.key, id)}
          canDelete={notes.canDelete}
          onClose={() => setNotesTarget(null)}
        />
      )}

      {/* Overflow chips from the collapsed Filters preview — each removable from here. */}
      {chipsOverflowAnchor && (
        <MenuPopover
          anchor={chipsOverflowAnchor}
          onClose={() => setChipsOverflowAnchor(null)}
          className="session-menu library-row-menu library-row-menu--portal library-chip-overflow"
        >
          {overflowChips.map((c) => (
            <button key={c.id} type="button" onClick={() => c.remove()}>
              <X size={13} /> {c.label}
            </button>
          ))}
        </MenuPopover>
      )}

      {trashOpen && (
        <LibraryTrashModal
          t={t}
          entries={trashedEntries}
          onRestore={(relPath) => restoreFromTrash(relPath)}
          onRestoreAll={() => trashedEntries.forEach((e) => restoreFromTrash(e.relPath))}
          onClose={() => setTrashOpen(false)}
        />
      )}
    </div>
  );
}
