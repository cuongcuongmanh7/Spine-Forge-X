import { useCallback, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AlertTriangle, CloudDownload, Layers, RotateCw, Search, Tag, Users } from 'lucide-react';
import { useApp } from '../useAppController';
import { LibraryStatCards } from './LibraryStatCards';
import { basename } from '../sessions';
import { formatDate } from '../time';
import type { LibraryEntry } from '../config';
import { useLibraryDrive } from '../useLibraryDrive';
import { useLibraryTags } from '../useLibraryTags';
import { LibraryTable } from './LibraryTable';
import { LibraryGrid } from './LibraryGrid';
import './LibraryMeta.css';
import './LibraryFilters.css';
import {
  entryMatchesFilter,
  groupByFolder,
  groupByIdBand,
  cleanStatusForEntry,
  type LibraryCleanStatus,
  entryMatchesTags,
  parseQuery,
  usageByEntry,
  divergingFileSet,
  versionSummary,
  versionTags,
  type LibraryThresholds
} from '../library';
import type { LibraryFilterApi } from '../useLibraryFilter';
import type { LibraryViewProps, Section, SortKey, SortState } from './LibraryViewShared';

const SORT_TIEBREAKER = { numeric: true, sensitivity: 'base' } as const;
const SORT_KEYS: SortKey[] = ['entry', 'version', 'spine', 'images', 'anims', 'owner', 'modified'];

/** Inventory tab host: stats, chip filters, search, view toggle — renders the table or grid view. */
export function LibraryInventory({
  filter,
  onPrepareCleanScan,
  onPreview
}: {
  filter: LibraryFilterApi;
  onPrepareCleanScan: (spineFiles: string[]) => void;
  onPreview: (entry: LibraryEntry) => void;
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
    openSettings,
    sessions,
    projects,
    selectSession
  } = useApp();

  const { facet, selectedCats, selectedVersions, query } = filter;
  const viewMode = appConfig.libraryViewMode;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expandedAnims, setExpandedAnims] = useState<Set<string>>(new Set());
  // Which row's "⋯" action menu is open (keyed by `.spine` path); null = none.
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ key: 'entry', direction: 'asc' });
  // "Used-by-projects": show only assets no session references — cleanup candidates.
  const [unusedOnly, setUnusedOnly] = useState(false);
  // Tags/ownership: tag-chip filter selection.
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  // Filter by responsible person: manual owner OR Drive owner/last-editor name.
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  // Version-mix triage: show only files that diverge from their folder group's majority version.
  const [divergingOnly, setDivergingOnly] = useState(false);

  const { tagList, metaFor, addEntryTag, removeEntryTag, setEntryOwner } = useLibraryTags({ libraryDir });

  const { driveInfo, expandedInfo, loadingBasics, basicsLoadedAt, basicFor, toggleDriveInfo, loadDriveBasics, openRevisionInSpine } =
    useLibraryDrive({
      t,
      pushToast,
      driveAccount,
      libraryDir,
      spinePath: merged.spinePath,
      openSettings: () => openSettings(true)
    });

  const thresholds: LibraryThresholds = {
    imageFolderWarnMB: appConfig.libraryImageFolderWarnMB,
    spineFileWarnMB: appConfig.librarySpineFileWarnMB
  };

  const entries = libraryScan?.entries ?? [];

  const buckets = useMemo(() => versionSummary(entries), [entries]);
  const catChips = useMemo(() => (facet === 'id' ? groupByIdBand(entries) : groupByFolder(entries)), [entries, facet]);
  const versions = useMemo(() => versionTags(entries), [entries]);

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
    let base = entries.filter((e) => entryMatchesFilter(e, { facet, selectedCats, selectedVersions, query }));
    if (unusedOnly) base = base.filter((e) => (usage.get(e.spineFile)?.projectIds.length ?? 0) === 0);
    if (divergingOnly) base = base.filter((e) => divergingSet.has(e.spineFile));
    if (selectedTags.size > 0) base = base.filter((e) => entryMatchesTags(metaFor(e), selectedTags));
    if (selectedUsers.size > 0) base = base.filter((e) => selectedUsers.has(effectiveOwner(e)));
    return base;
  }, [entries, facet, selectedCats, selectedVersions, query, unusedOnly, usage, divergingOnly, divergingSet, selectedTags, metaFor, selectedUsers, effectiveOwner]);

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

  const sections = useMemo<Section[]>(() => {
    const groups = facet === 'id' ? groupByIdBand(sorted) : groupByFolder(sorted);
    return groups.map((g) => ({ key: g.key, label: g.key, entries: g.entries, mixedVersion: g.mixedVersion }));
  }, [sorted, facet]);

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
    onPreview
  };

  return (
    <div className="library-pane">
      <div className="library-pane-head">
        <LibraryStatCards t={t} totalEntries={entries.length} buckets={buckets} totalImageBytes={libraryScan?.totalImageBytes ?? 0} scanCounts={scanCounts} />

        <div className="library-search-row">
          <Search size={15} />
          <input
            className="library-search"
            value={query}
            aria-label={t.librarySearchPlaceholder}
            placeholder={t.librarySearchPlaceholder}
            onChange={(e) => filter.setQuery(e.target.value)}
          />
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
          </button>
        </div>

        <div className="library-chip-row">
          <span className="library-chip-label">{t.libraryFacetLabel}</span>
          <div className="library-chip-set">
            <span className="segmented-control">
              <button className={facet === 'folder' ? 'active' : ''} onClick={() => filter.setFacet('folder')}>
                {t.libraryFacetFolder}
              </button>
              <button className={facet === 'id' ? 'active' : ''} onClick={() => filter.setFacet('id')}>
                {t.libraryFacetId}
              </button>
            </span>
          </div>
          <span className="library-view-controls">
            {viewMode === 'grid' && (
              <span className="library-sort-control">
                <span className="library-chip-label">{t.librarySortBy}</span>
                <select value={sort.key} onChange={(e) => setSort((s) => ({ ...s, key: e.target.value as SortKey }))}>
                  {SORT_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {sortLabels[k]}
                    </option>
                  ))}
                </select>
                <button
                  className="icon-button"
                  onClick={() => setSort((s) => ({ ...s, direction: s.direction === 'asc' ? 'desc' : 'asc' }))}
                  title={sort.direction === 'asc' ? t.libraryCollapseAll : t.libraryExpandAll}
                  aria-label="sort direction"
                >
                  {sort.direction === 'asc' ? '↑' : '↓'}
                </button>
              </span>
            )}
            <span className="segmented-control">
              <button className={viewMode === 'table' ? 'active' : ''} onClick={() => updateAppConfig('libraryViewMode', 'table')}>
                {t.libraryViewTable}
              </button>
              <button className={viewMode === 'grid' ? 'active' : ''} onClick={() => updateAppConfig('libraryViewMode', 'grid')}>
                {t.libraryViewGrid}
              </button>
            </span>
          </span>
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
                {c.key} <em>{c.entries.length}</em>
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

        <div className="library-chip-row">
          <span className="library-chip-label">{t.libraryColUsedBy}</span>
          <div className="library-chip-set">
            <button className={`library-chip ${unusedOnly ? 'active' : ''}`} onClick={() => setUnusedOnly((v) => !v)} aria-pressed={unusedOnly}>
              <Users size={12} /> {t.libraryUnusedOnly}
            </button>
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
      </div>

      <div className="library-pane-scroll">
        {sections.length === 0 ? (
          <p className="helper-text">{t.libraryNoSpine}</p>
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
    </div>
  );
}
