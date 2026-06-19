import { Fragment, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FolderOpen,
  FolderPlus,
  History,
  Images,
  Layers,
  ListChecks,
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
import { formatBytes } from '../time';
import type { LibraryEntry } from '../config';
import { fetchDriveFileMetadata, toDriveRelPath, type DriveFileInfo } from '../drive';
import {
  entryMatchesFilter,
  entryWarnings,
  groupByFolder,
  groupByIdBand,
  cleanStatusForEntry,
  type LibraryCleanStatus,
  versionLabel,
  versionSummary,
  versionTags,
  type LibraryThresholds
} from '../library';
import type { LibraryFilterApi } from '../useLibraryFilter';

type Section = { key: string; label: string; entries: LibraryEntry[]; mixedVersion: boolean };
type SortKey = 'entry' | 'version' | 'spine' | 'images' | 'anims';
type SortDirection = 'asc' | 'desc';
type SortState = { key: SortKey; direction: SortDirection };

const SORT_TIEBREAKER = { numeric: true, sensitivity: 'base' } as const;

function compactRelPath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 3) return path;
  return `.../${parts.slice(-3).join('/')}`;
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
    setSettingsOpen
  } = useApp();

  const { facet, selectedCats, selectedVersions, query } = filter;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expandedAnims, setExpandedAnims] = useState<Set<string>>(new Set());
  const [expandedInfo, setExpandedInfo] = useState<Set<string>>(new Set());
  // Lazily-fetched Drive metadata, keyed by `.spine` path; held here (not persisted, not on scan).
  const [driveInfo, setDriveInfo] = useState<
    Record<string, { loading?: boolean; error?: string; notOnDrive?: boolean; data?: DriveFileInfo }>
  >({});
  const [sort, setSort] = useState<SortState>({ key: 'entry', direction: 'asc' });

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

    function compareEntry(a: LibraryEntry, b: LibraryEntry) {
      let result = 0;
      if (sort.key === 'entry') result = compareString(a.relPath, b.relPath);
      else if (sort.key === 'version') result = compareVersion(a.version, b.version);
      else if (sort.key === 'spine') result = a.spineBytes - b.spineBytes;
      else if (sort.key === 'images') result = a.imageBytes - b.imageBytes;
      else result = a.animationCount - b.animationCount;

      if (result === 0) result = compareString(a.relPath, b.relPath);
      return sort.direction === 'asc' ? result : -result;
    }

    return [...filtered].sort(compareEntry);
  }, [filtered, sort]);

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

  // Toggle the Drive metadata panel for a row, fetching owner/history on first open.
  function toggleDriveInfo(entry: LibraryEntry) {
    const key = entry.spineFile;
    const willOpen = !expandedInfo.has(key);
    toggleSet(setExpandedInfo, key);
    if (!willOpen || driveInfo[key]?.data || driveInfo[key]?.loading) return;

    if (!driveAccount) {
      pushToast(t.driveSignInPrompt, 'warning');
      setSettingsOpen(true);
      return;
    }
    const relPath = toDriveRelPath(entry.spineFile, syncRoot);
    if (!relPath) {
      setDriveInfo((prev) => ({ ...prev, [key]: { notOnDrive: true } }));
      return;
    }
    setDriveInfo((prev) => ({ ...prev, [key]: { loading: true } }));
    fetchDriveFileMetadata(relPath)
      .then((data) => setDriveInfo((prev) => ({ ...prev, [key]: { data } })))
      .catch((e) => setDriveInfo((prev) => ({ ...prev, [key]: { error: String(e) } })));
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
          {activeLibrary?.lastScanAt ? new Date(activeLibrary.lastScanAt).toLocaleDateString() : t.libraryNeverScanned}
        </span>
        <button className="secondary-button small" onClick={() => void rescanLibrary()} disabled={isScanningLibrary}>
          <RotateCw size={14} className={isScanningLibrary ? 'spin' : undefined} /> {t.libraryRescan}
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
        <table className="library-table">
          <colgroup>
            <col className="lib-col-entry" />
            <col className="lib-col-version" />
            <col className="lib-col-size" />
            <col className="lib-col-images" />
            <col className="lib-col-anims" />
            <col className="lib-col-actions" />
          </colgroup>
          <thead>
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
              <th />
            </tr>
          </thead>
          {sections.map((section) => {
            const isCollapsed = collapsed.has(section.key);
            return (
              <tbody key={section.key}>
                <tr className="library-group-row">
                  <td colSpan={5}>
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
                  </td>
                  <td className="library-actions">
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
                  </td>
                </tr>
                {!isCollapsed &&
                  section.entries.map((entry) => {
                    const w = entryWarnings(entry, thresholds);
                    const animOpen = expandedAnims.has(entry.spineFile);
                    const infoOpen = expandedInfo.has(entry.spineFile);
                    const info = driveInfo[entry.spineFile];
                    return (
                      <Fragment key={entry.spineFile}>
                        <tr>
                          <td className="library-path" title={entry.spineFile}>
                            {cleanStatusIcon(cleanStatus(entry))}
                            {compactRelPath(entry.relPath)}
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
                          <td className="library-actions">
                            <button
                              className={`icon-button ${infoOpen ? 'active' : ''}`}
                              title={t.driveInfoTitle}
                              aria-label={t.driveInfoTitle}
                              onClick={() => toggleDriveInfo(entry)}
                            >
                              <History size={15} />
                            </button>
                            <button className="icon-button" title={t.libraryPrepareCleanScan} aria-label={t.libraryPrepareCleanScan} onClick={() => onPrepareCleanScan([entry.spineFile])}>
                              <ListChecks size={15} />
                            </button>
                            <button className="icon-button" title={t.libraryOpenFolder} aria-label={t.libraryOpenFolder} onClick={() => void openFolder(entry)}>
                              <FolderOpen size={15} />
                            </button>
                            <button className="icon-button" title={t.libraryOpenInSpine} aria-label={t.libraryOpenInSpine} onClick={() => void openInSpine(entry)}>
                              <SpineFileIcon size={15} />
                            </button>
                            <button className="icon-button" title={t.libraryCreateSession} aria-label={t.libraryCreateSession} onClick={() => createSessionForEntry(entry)}>
                              <FolderPlus size={15} />
                            </button>
                          </td>
                        </tr>
                        {animOpen && entry.exported && (
                          <tr className="library-anim-list">
                            <td colSpan={6}>
                              {entry.skins.length > 0 && (
                                <div>
                                  <strong>{t.librarySkins}:</strong>{' '}
                                  {entry.skins.map((s) => (
                                    <span className="library-anim-chip" key={s}>
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
                                    <span className="library-anim-chip" key={a}>
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
                            <td colSpan={6}>
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
                                        <strong>{t.driveModified}:</strong> {new Date(info.data.modifiedTime).toLocaleString()}
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
                                            <span>{rev.modifiedTime ? new Date(rev.modifiedTime).toLocaleString() : '—'}</span>
                                            <span className="muted">{rev.editorName ?? rev.editorEmail ?? ''}</span>
                                            {rev.size ? <span className="muted">{formatBytes(Number(rev.size))}</span> : null}
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
