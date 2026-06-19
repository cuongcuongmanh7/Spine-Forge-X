import { Fragment, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FolderPlus,
  Layers,
  Search
} from 'lucide-react';
import { useApp } from '../useAppController';
import { SpineFileIcon } from './SpineFileIcon';
import { basename } from '../sessions';
import { formatBytes } from '../time';
import type { LibraryEntry } from '../config';
import {
  entryMatchesFilter,
  entryWarnings,
  groupByFolder,
  groupByIdBand,
  hasAnyWarning,
  versionLabel,
  versionSummary,
  versionTags,
  type LibraryThresholds
} from '../library';
import type { LibraryFilterApi } from '../useLibraryFilter';

type Section = { key: string; label: string; entries: LibraryEntry[]; mixedVersion: boolean };

/** Inventory tab: stats, chip filters, search, and the per-skeleton table (with animation list). */
export function LibraryInventory({ filter }: { filter: LibraryFilterApi }) {
  const {
    t,
    appConfig,
    merged,
    activeLibrary,
    libraryScan,
    createSessionFromLibrary,
    createProjectFromLibrary,
    setViewMode,
    pushToast
  } = useApp();

  const { facet, selectedCats, selectedVersions, query } = filter;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expandedAnims, setExpandedAnims] = useState<Set<string>>(new Set());

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

  const warningCount = useMemo(
    () => filtered.filter((e) => hasAnyWarning(e, thresholds)).length,
    [filtered, thresholds]
  );

  const sections = useMemo<Section[]>(() => {
    const groups = facet === 'id' ? groupByIdBand(filtered) : groupByFolder(filtered);
    return groups.map((g) => ({ key: g.key, label: g.key, entries: g.entries, mixedVersion: g.mixedVersion }));
  }, [filtered, facet]);

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

  return (
    <div className="library-pane">
      <div className="library-pane-head">
      <div className="library-stats">
        <div className="library-stat">
          <span className="library-stat-value">{entries.length}</span>
          <span className="library-stat-label">{t.libraryTotalEntries}</span>
        </div>
        {buckets.map((b) => (
          <div className="library-stat" key={b.major}>
            <span className="library-stat-value">{b.count}</span>
            <span className="library-stat-label">{versionLabel(b.major)}</span>
          </div>
        ))}
        <div className="library-stat">
          <span className="library-stat-value">{formatBytes(libraryScan?.totalImageBytes ?? 0)}</span>
          <span className="library-stat-label">{t.libraryTotalImages}</span>
        </div>
        <div className={`library-stat ${warningCount > 0 ? 'warn' : ''}`}>
          <span className="library-stat-value">{warningCount}</span>
          <span className="library-stat-label">{t.libraryWarnings}</span>
        </div>
      </div>

      <div className="form-row library-search-row">
        <Search size={15} />
        <input
          className="library-search"
          value={query}
          placeholder={t.librarySearchPlaceholder}
          onChange={(e) => filter.setQuery(e.target.value)}
        />
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
              <th>
                <button
                  className="library-th-toggle"
                  onClick={toggleCollapseAll}
                  disabled={sections.length === 0}
                  title={allCollapsed ? t.libraryExpandAll : t.libraryCollapseAll}
                >
                  {allCollapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
                  {t.libraryColEntry}
                </button>
              </th>
              <th>{t.libraryColVersion}</th>
              <th className="num">{t.libraryColSpine}</th>
              <th className="num">{t.libraryColImages}</th>
              <th className="num">{t.libraryColAnims}</th>
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
                      {section.label} <span className="muted">({section.entries.length})</span>
                    </button>
                    {section.mixedVersion && (
                      <span className="library-warn-badge" title={t.libraryWarnMixed}>
                        <AlertTriangle size={13} /> {t.libraryWarnMixed}
                      </span>
                    )}
                  </td>
                  <td className="library-actions">
                    <button className="icon-button" onClick={() => createSessionForSection(section)} title={t.libraryCreateSession} aria-label={t.libraryCreateSession}>
                      <FolderPlus size={15} />
                    </button>
                  </td>
                </tr>
                {!isCollapsed &&
                  section.entries.map((entry) => {
                    const w = entryWarnings(entry, thresholds);
                    const animOpen = expandedAnims.has(entry.spineFile);
                    return (
                      <Fragment key={entry.spineFile}>
                        <tr>
                          <td className="library-path" title={entry.spineFile}>
                            {entry.relPath}
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
