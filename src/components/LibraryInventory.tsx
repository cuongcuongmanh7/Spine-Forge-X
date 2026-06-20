import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CloudDownload,
  FileClock,
  FolderOpen,
  FolderPlus,
  History,
  Images,
  Layers,
  ListChecks,
  MoreHorizontal,
  Circle,
  RotateCw,
  Search,
  Tag,
  User
} from 'lucide-react';
import { useApp } from '../useAppController';
import { SpineFileIcon } from './SpineFileIcon';
import { StatCard } from './StatCard';
import { basename } from '../sessions';
import { formatBytes, formatDate, formatDateTime } from '../time';
import type { LibraryEntry } from '../config';
import { useLibraryDrive } from '../useLibraryDrive';
import {
  entryMatchesFilter,
  entryWarnings,
  groupByFolder,
  groupByIdBand,
  cleanStatusForEntry,
  type LibraryCleanStatus,
  matchedNames,
  parseQuery,
  versionLabel,
  versionSummary,
  versionTags,
  type LibraryThresholds
} from '../library';
import type { LibraryFilterApi } from '../useLibraryFilter';

const DAY_MS = 24 * 60 * 60 * 1000;

type Section = { key: string; label: string; entries: LibraryEntry[]; mixedVersion: boolean };
type SortKey = 'entry' | 'version' | 'spine' | 'images' | 'anims' | 'owner' | 'modified';
type SortDirection = 'asc' | 'desc';
type SortState = { key: SortKey; direction: SortDirection };

const SORT_TIEBREAKER = { numeric: true, sensitivity: 'base' } as const;

/**
 * Split a relative path into a shrinkable directory prefix and the file name. The name is rendered
 * separately so it stays fully visible while only the prefix gets ellipsized in a narrow column —
 * otherwise a plain end-ellipsis hides the most important part (the file name).
 */
function splitRelPath(path: string): { dir: string; name: string } {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  const name = parts.length > 0 ? parts[parts.length - 1] : path;
  let dirs = parts.slice(0, -1);
  if (dirs.length > 2) dirs = ['...', ...dirs.slice(-2)];
  return { dir: dirs.length > 0 ? `${dirs.join('/')}/` : '', name };
}

/** Inventory tab: stats, chip filters, search, and the per-skeleton table (with animation list). */
export function LibraryInventory({
  filter,
  onPrepareCleanScan
}: {
  filter: LibraryFilterApi;
  onPrepareCleanScan: (spineFiles: string[]) => void;
}) {
  const {
    t,
    appConfig,
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
    syncRoot,
    syncConnected,
    setSettingsOpen
  } = useApp();

  const { facet, selectedCats, selectedVersions, query } = filter;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expandedAnims, setExpandedAnims] = useState<Set<string>>(new Set());
  // Which row's "⋯" action menu is open (keyed by `.spine` path); null = none.
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ key: 'entry', direction: 'asc' });

  // Drive metadata (per-row owner/history panel, dashboard columns, open-revision) lives in its own
  // hook to keep this component thin — see useLibraryDrive.
  const { driveInfo, expandedInfo, loadingBasics, basicFor, toggleDriveInfo, loadDriveBasics, openRevisionInSpine } =
    useLibraryDrive({
      t,
      pushToast,
      driveAccount,
      syncRoot,
      syncConnected,
      spinePath: merged.spinePath,
      openSettings: () => setSettingsOpen(true)
    });

  const thresholds: LibraryThresholds = {
    imageFolderWarnMB: appConfig.libraryImageFolderWarnMB,
    spineFileWarnMB: appConfig.librarySpineFileWarnMB
  };

  const entries = libraryScan?.entries ?? [];

  const buckets = useMemo(() => versionSummary(entries), [entries]);
  const catChips = useMemo(() => (facet === 'id' ? groupByIdBand(entries) : groupByFolder(entries)), [entries, facet]);
  const versions = useMemo(() => versionTags(entries), [entries]);

  const filtered = useMemo(
    () => entries.filter((e) => entryMatchesFilter(e, { facet, selectedCats, selectedVersions, query })),
    [entries, facet, selectedCats, selectedVersions, query]
  );

  // Parsed search (scope + term) drives chip highlighting and auto-expanding the anim/skin panel.
  const parsedQuery = useMemo(() => parseQuery(query), [query]);

  const tableRef = useRef<HTMLTableElement>(null);
  const theadRef = useRef<HTMLTableSectionElement>(null);

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

    // Drive-backed values sort missing entries last (regardless of direction handled by caller).
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

  // Clean-scan coverage across the whole library: never-scanned vs. clean vs. needs-review.
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

  // The group rows pin just below the sticky header at `top: var(--lib-thead-h)`. The real header
  // height varies with font/zoom/i18n, so a hardcoded value leaves a gap that scrolling rows peek
  // through — measure the actual thead and feed it back into the CSS var. Re-runs when the table
  // mounts (sections appear) and whenever the header resizes.
  useLayoutEffect(() => {
    const table = tableRef.current;
    const thead = theadRef.current;
    if (!table || !thead) return;
    const apply = () => table.style.setProperty('--lib-thead-h', `${thead.offsetHeight}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(thead);
    return () => observer.disconnect();
  }, [sections.length]);

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
    setSort((prev) => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
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

  function isEntryClean(entry: LibraryEntry) {
    return cleanStatus(entry) === 'clean';
  }

  function isEntryCleanWarning(entry: LibraryEntry) {
    return cleanStatus(entry) === 'warning';
  }

  function isEntryCleanUnknown(entry: LibraryEntry) {
    return cleanStatus(entry) === 'unknown';
  }

  function cleanStatus(entry: LibraryEntry): LibraryCleanStatus {
    return cleanStatusForEntry(entry, libraryCleanState[entry.spineFile]);
  }

  function isSectionClean(section: Section) {
    return section.entries.length > 0 && section.entries.every(isEntryClean);
  }

  function isSectionCleanWarning(section: Section) {
    return !isSectionClean(section) && section.entries.some(isEntryCleanWarning);
  }

  function isSectionCleanUnknown(section: Section) {
    return !isSectionClean(section) && !isSectionCleanWarning(section) && section.entries.some(isEntryCleanUnknown);
  }

  function cleanStatusIcon(status: LibraryCleanStatus) {
    if (status === 'clean') {
      return (
        <span className="library-clean-icon" role="img" aria-label={t.libraryCleanCurrent} title={t.libraryCleanCurrent}>
          <CheckCircle2 size={14} />
        </span>
      );
    }
    if (status === 'warning') {
      return (
        <span className="library-clean-icon warning" role="img" aria-label={t.libraryCleanNeedsReview} title={t.libraryCleanNeedsReview}>
          <AlertTriangle size={14} />
        </span>
      );
    }
    return (
      <span className="library-clean-icon unknown" role="img" aria-label={t.libraryCleanUnknown} title={t.libraryCleanUnknown}>
        <Circle size={14} />
      </span>
    );
  }

  return (
    <div className="library-pane">
      <div className="library-pane-head">
      <div className="stat-cards">
        <StatCard icon={<Boxes size={18} />} label={t.libraryTotalEntries} value={entries.length} />
        {buckets.map((b) => (
          <StatCard key={b.major} icon={<Tag size={18} />} label={versionLabel(b.major)} value={b.count} />
        ))}
        <StatCard icon={<Images size={18} />} label={t.libraryTotalImages} value={formatBytes(libraryScan?.totalImageBytes ?? 0)} />
        <StatCard icon={<Circle size={18} />} label={t.libraryStatNotScanned} value={scanCounts.unknown} />
        <StatCard icon={<CheckCircle2 size={18} />} label={t.libraryStatClean} value={scanCounts.clean} tone={scanCounts.clean > 0 ? 'ok' : 'default'} />
        <StatCard
          icon={<AlertTriangle size={18} />}
          label={t.libraryStatNeedsReview}
          value={scanCounts.warning}
          tone={scanCounts.warning > 0 ? 'warn' : 'default'}
        />
      </div>

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
          {t.libraryLastScan}:{' '}
          {activeLibrary?.lastScanAt ? formatDate(activeLibrary.lastScanAt) : t.libraryNeverScanned}
        </span>
        <button className="secondary-button small" onClick={() => void rescanLibrary()} disabled={isScanningLibrary}>
          <RotateCw size={14} className={isScanningLibrary ? 'spin' : undefined} /> {t.libraryRescan}
        </button>
        <button
          className="secondary-button small"
          onClick={() => void loadDriveBasics(filtered)}
          disabled={loadingBasics}
          title={t.driveLoadDataHelp}
        >
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
        </div>
      </div>

      </div>

      <div className="library-pane-scroll">
      {sections.length === 0 ? (
        <p className="helper-text">{t.libraryNoSpine}</p>
      ) : (
        <table className="library-table" ref={tableRef}>
          <colgroup>
            <col className="lib-col-entry" />
            <col className="lib-col-version" />
            <col className="lib-col-size" />
            <col className="lib-col-images" />
            <col className="lib-col-anims" />
            <col className="lib-col-owner" />
            <col className="lib-col-modified" />
            <col className="lib-col-actions" />
          </colgroup>
          <thead ref={theadRef}>
            <tr>
              <th aria-sort={ariaSort('entry')}>
                <span className="library-th-actions">
                  <button
                    className="library-th-toggle"
                    onClick={toggleCollapseAll}
                    disabled={sections.length === 0}
                    title={allCollapsed ? t.libraryExpandAll : t.libraryCollapseAll}
                    aria-label={allCollapsed ? t.libraryExpandAll : t.libraryCollapseAll}
                  >
                    {allCollapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
                  </button>
                  <button className="library-th-sort" onClick={() => toggleSort('entry')}>
                    {t.libraryColEntry}
                    {sortMark('entry')}
                  </button>
                </span>
              </th>
              <th aria-sort={ariaSort('version')}>
                <button className="library-th-sort" onClick={() => toggleSort('version')}>
                  {t.libraryColVersion}
                  {sortMark('version')}
                </button>
              </th>
              <th className="num" aria-sort={ariaSort('spine')}>
                <button className="library-th-sort" onClick={() => toggleSort('spine')}>
                  {t.libraryColSpine}
                  {sortMark('spine')}
                </button>
              </th>
              <th className="num" aria-sort={ariaSort('images')}>
                <button className="library-th-sort" onClick={() => toggleSort('images')}>
                  {t.libraryColImages}
                  {sortMark('images')}
                </button>
              </th>
              <th className="num" aria-sort={ariaSort('anims')}>
                <button className="library-th-sort" onClick={() => toggleSort('anims')}>
                  {t.libraryColAnims}
                  {sortMark('anims')}
                </button>
              </th>
              <th aria-sort={ariaSort('owner')}>
                <button className="library-th-sort" onClick={() => toggleSort('owner')}>
                  {t.driveColOwner}
                  {sortMark('owner')}
                </button>
              </th>
              <th aria-sort={ariaSort('modified')}>
                <button className="library-th-sort" onClick={() => toggleSort('modified')}>
                  {t.driveColModified}
                  {sortMark('modified')}
                </button>
              </th>
              <th />
            </tr>
          </thead>
          {sections.map((section) => {
            const isCollapsed = collapsed.has(section.key);
            return (
              <tbody key={section.key}>
                <tr className="library-group-row">
                  {/* Single spanning cell: one sticky background fills the whole row. A flex
                      wrapper keeps the toggle on the left and the actions on the right (a flex
                      <td> would shrink its painted box and leave a gap in the action column). */}
                  <td colSpan={8}>
                    <div className="library-group-head-row">
                      <span className="library-group-head-left">
                        <button className="library-group-toggle" onClick={() => toggleSet(setCollapsed, section.key)} aria-expanded={!isCollapsed}>
                          {isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                          {isSectionClean(section) && cleanStatusIcon('clean')}
                          {isSectionCleanWarning(section) && cleanStatusIcon('warning')}
                          {isSectionCleanUnknown(section) && cleanStatusIcon('unknown')}
                          {section.label} <span className="muted">({section.entries.length})</span>
                        </button>
                        {section.mixedVersion && (
                          <span className="library-warn-badge" title={t.libraryWarnMixed}>
                            <AlertTriangle size={13} /> {t.libraryWarnMixed}
                          </span>
                        )}
                      </span>
                      <span className="library-actions">
                        <button
                          className="icon-button"
                          onClick={() => onPrepareCleanScan(section.entries.map((entry) => entry.spineFile))}
                          title={t.libraryPrepareCleanScan}
                          aria-label={t.libraryPrepareCleanScan}
                        >
                          <ListChecks size={15} />
                        </button>
                        <button className="icon-button" onClick={() => createSessionForSection(section)} title={t.libraryCreateSession} aria-label={t.libraryCreateSession}>
                          <FolderPlus size={15} />
                        </button>
                      </span>
                    </div>
                  </td>
                </tr>
                {!isCollapsed &&
                  section.entries.map((entry) => {
                    const w = entryWarnings(entry, thresholds);
                    const matches = matchedNames(entry, parsedQuery);
                    const hasChipMatch = matches.animations.size > 0 || matches.skins.size > 0;
                    const animOpen = expandedAnims.has(entry.spineFile) || hasChipMatch;
                    const infoOpen = expandedInfo.has(entry.spineFile);
                    const info = driveInfo[entry.spineFile];
                    const basic = basicFor(entry);
                    const modifiedMs = basic?.modifiedTime ? Date.parse(basic.modifiedTime) : NaN;
                    const recent = Number.isFinite(modifiedMs) && Date.now() - modifiedMs < 7 * DAY_MS;
                    return (
                      <Fragment key={entry.spineFile}>
                        <tr>
                          <td className="library-path" title={entry.spineFile}>
                            <span className="library-path-line">
                              {cleanStatusIcon(cleanStatus(entry))}
                              {(() => {
                                const { dir, name } = splitRelPath(entry.relPath);
                                return (
                                  <>
                                    {dir && <span className="library-path-dir">{dir}</span>}
                                    <span className="library-path-name">{name}</span>
                                  </>
                                );
                              })()}
                            </span>
                          </td>
                          <td>{entry.version ?? <span className="muted">{t.libraryUnknownVersion}</span>}</td>
                          <td className={`num ${w.heavySpine ? 'library-warn-cell' : ''}`} title={w.heavySpine ? t.libraryWarnHeavySpine : undefined}>
                            {w.heavySpine && <AlertTriangle size={12} />} {formatBytes(entry.spineBytes)}
                          </td>
                          <td className={`num ${w.heavyImages ? 'library-warn-cell' : ''}`} title={w.heavyImages ? t.libraryWarnHeavyImages : undefined}>
                            {w.heavyImages && <AlertTriangle size={12} />} {formatBytes(entry.imageBytes)}{' '}
                            <span className="muted">· {entry.imageCount}</span>
                          </td>
                          <td className="num">
                            {!entry.exported ? (
                              <span className="library-badge-muted">{t.libraryNotExported}</span>
                            ) : entry.animationCount > 0 ? (
                              <button className="library-anim-toggle" onClick={() => toggleSet(setExpandedAnims, entry.spineFile)}>
                                {entry.animationCount} {animOpen ? '▴' : '▾'}
                              </button>
                            ) : (
                              <span className="muted" title={t.libraryBinExport}>—</span>
                            )}
                          </td>
                          <td
                            className="library-owner"
                            title={basic?.ownerEmail ?? basic?.lastEditorEmail ?? undefined}
                          >
                            {basic?.ownerName || basic?.ownerEmail || basic?.lastEditorName || basic?.lastEditorEmail || (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td className={`library-modified ${recent ? 'library-modified-recent' : ''}`}>
                            {basic?.modifiedTime ? (
                              formatDate(basic.modifiedTime)
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td className="library-actions library-menu-cell">
                            <button
                              className={`session-menu-trigger ${menuOpen === entry.spineFile ? 'open' : ''}`}
                              title={t.options}
                              aria-label={t.options}
                              onClick={(e) => {
                                e.stopPropagation();
                                setMenuOpen(menuOpen === entry.spineFile ? null : entry.spineFile);
                              }}
                            >
                              <MoreHorizontal size={16} />
                            </button>
                            {menuOpen === entry.spineFile && (
                              <>
                                <div
                                  className="menu-backdrop"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setMenuOpen(null);
                                  }}
                                />
                                <div className="session-menu library-row-menu" onClick={(e) => e.stopPropagation()}>
                                  <button onClick={() => { setMenuOpen(null); toggleDriveInfo(entry); }}>
                                    <History size={14} /> {t.driveInfoTitle}
                                  </button>
                                  <button onClick={() => { setMenuOpen(null); onPrepareCleanScan([entry.spineFile]); }}>
                                    <ListChecks size={14} /> {t.libraryPrepareCleanScan}
                                  </button>
                                  <button onClick={() => { setMenuOpen(null); void openFolder(entry); }}>
                                    <FolderOpen size={14} /> {t.libraryOpenFolder}
                                  </button>
                                  <button onClick={() => { setMenuOpen(null); void openInSpine(entry); }}>
                                    <SpineFileIcon size={14} /> {t.libraryOpenInSpine}
                                  </button>
                                  <button onClick={() => { setMenuOpen(null); createSessionForEntry(entry); }}>
                                    <FolderPlus size={14} /> {t.libraryCreateSession}
                                  </button>
                                </div>
                              </>
                            )}
                          </td>
                        </tr>
                        {animOpen && entry.exported && (
                          <tr className="library-anim-list">
                            <td colSpan={8}>
                              {entry.skins.length > 0 && (
                                <div>
                                  <strong>{t.librarySkins}:</strong>{' '}
                                  {entry.skins.map((s) => (
                                    <span className={`library-anim-chip ${matches.skins.has(s) ? 'matched' : ''}`} key={s}>
                                      {s}
                                    </span>
                                  ))}
                                </div>
                              )}
                              <div>
                                <strong>{t.libraryAnimations}:</strong>{' '}
                                {entry.animations.length === 0 ? (
                                  <span className="muted">—</span>
                                ) : (
                                  entry.animations.map((a) => (
                                    <span className={`library-anim-chip ${matches.animations.has(a) ? 'matched' : ''}`} key={a}>
                                      {a}
                                    </span>
                                  ))
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                        {infoOpen && (
                          <tr className="library-anim-list library-drive-row">
                            <td colSpan={8}>
                              {info?.loading && (
                                <span className="muted">
                                  <RotateCw size={13} className="spin" /> {t.driveLoading}
                                </span>
                              )}
                              {info?.notOnDrive && <span className="muted">{t.driveNotOnDrive}</span>}
                              {info?.error && <span className="library-drive-error">{info.error}</span>}
                              {info?.data && (
                                <div className="library-drive-info">
                                  <div className="library-drive-meta">
                                    <span>
                                      <User size={13} /> <strong>{t.driveOwner}:</strong>{' '}
                                      {info.data.ownerName ?? info.data.ownerEmail ?? '—'}
                                      {info.data.ownerEmail ? <span className="muted"> ({info.data.ownerEmail})</span> : null}
                                    </span>
                                    {info.data.modifiedTime && (
                                      <span>
                                        <strong>{t.driveModified}:</strong> {formatDateTime(info.data.modifiedTime)}
                                        {info.data.lastEditorName ? (
                                          <span className="muted"> · {info.data.lastEditorName}</span>
                                        ) : null}
                                      </span>
                                    )}
                                  </div>
                                  <div className="library-drive-revs">
                                    <strong>
                                      <History size={13} /> {t.driveRevisions} ({info.data.revisions.length}):
                                    </strong>
                                    {info.data.revisions.length === 0 ? (
                                      <span className="muted"> —</span>
                                    ) : (
                                      <ul>
                                        {info.data.revisions.slice(0, 20).map((rev) => (
                                          <li key={rev.id}>
                                            <span>{rev.modifiedTime ? formatDateTime(rev.modifiedTime) : '—'}</span>
                                            <span className="muted">{rev.editorName ?? rev.editorEmail ?? ''}</span>
                                            {rev.size ? <span className="muted">{formatBytes(Number(rev.size))}</span> : null}
                                            <button
                                              className="icon-button"
                                              title={t.driveOpenRevision}
                                              aria-label={t.driveOpenRevision}
                                              onClick={() => void openRevisionInSpine(entry, rev)}
                                            >
                                              <FileClock size={14} />
                                            </button>
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </div>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
              </tbody>
            );
          })}
        </table>
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
