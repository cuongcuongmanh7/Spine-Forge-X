import { useCallback, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ExternalLink,
  FolderPlus,
  Layers,
  Plus,
  RotateCw,
  Trash2,
  X
} from 'lucide-react';
import { useApp } from '../useAppController';
import { basename } from '../sessions';
import { formatBytes } from '../time';
import type { LibraryEntry } from '../config';
import {
  entryWarnings,
  groupByFolder,
  groupByIdBand,
  hasAnyWarning,
  idBand,
  topFolder,
  versionLabel,
  versionSummary,
  versionTags,
  type LibraryThresholds
} from '../library';
import './LibraryDashboardModal.css';

type Section = { key: string; label: string; entries: LibraryEntry[]; mixedVersion: boolean };

/** Asset-library inventory: browse a scanned master folder, classify by version, surface warnings. */
export function LibraryDashboardModal() {
  const {
    t,
    language,
    appConfig,
    merged,
    libraries,
    activeLibrary,
    activeLibraryId,
    libraryScan,
    isScanningLibrary,
    importLibrary,
    rescanLibrary,
    selectLibrary,
    deleteLibrary,
    setLibraryOpen,
    createSessionFromLibrary,
    createProjectFromLibrary,
    pushToast
  } = useApp();

  // Category facet (folder/type names vs ID bands) + multi-select chip filters.
  const [facet, setFacet] = useState<'folder' | 'id'>('folder');
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set());
  const [selectedVersions, setSelectedVersions] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const close = () => setLibraryOpen(false);

  const thresholds: LibraryThresholds = {
    imageFolderWarnMB: appConfig.libraryImageFolderWarnMB,
    spineFileWarnMB: appConfig.librarySpineFileWarnMB
  };
  const locale = language === 'vi' ? 'vi-VN' : 'en-US';

  const entries = libraryScan?.entries ?? [];
  const catKeyOf = useCallback((e: LibraryEntry) => (facet === 'id' ? idBand(e) : topFolder(e)), [facet]);

  const buckets = useMemo(() => versionSummary(entries), [entries]);
  const catChips = useMemo(() => (facet === 'id' ? groupByIdBand(entries) : groupByFolder(entries)), [entries, facet]);
  const versions = useMemo(() => versionTags(entries), [entries]);

  const filtered = useMemo(
    () =>
      entries.filter(
        (e) =>
          (selectedCats.size === 0 || selectedCats.has(catKeyOf(e))) &&
          (selectedVersions.size === 0 || selectedVersions.has(e.version ?? ''))
      ),
    [entries, selectedCats, selectedVersions, catKeyOf]
  );
  const warningCount = useMemo(
    () => filtered.filter((e) => hasAnyWarning(e, thresholds)).length,
    [filtered, thresholds]
  );

  const sections = useMemo<Section[]>(() => {
    const groups = facet === 'id' ? groupByIdBand(filtered) : groupByFolder(filtered);
    return groups.map((g) => ({ key: g.key, label: g.key, entries: g.entries, mixedVersion: g.mixedVersion }));
  }, [filtered, facet]);

  function switchFacet(next: 'folder' | 'id') {
    setFacet(next);
    setSelectedCats(new Set());
  }
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

  /** Session name for a single entry: the .spine basename without extension. */
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
    // One session per current group (folder / ID band / version) — a session gathers a related
    // set of skeletons, not a single file. Respects the active grouping + version filter.
    const root = activeLibrary.rootPath;
    const items = sections.map((s) => ({
      name: s.label,
      spineFiles: s.entries.map((e) => e.spineFile),
      inputPath: root
    }));
    createProjectFromLibrary(activeLibrary.name, items);
    pushToast(t.libraryProjectCreated.replace('{name}', activeLibrary.name).replace('{count}', String(items.length)), 'success');
    close();
  }

  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        className="modal linked-modal library-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{t.libraryTitle}</h2>
          <button className="modal-close" title={t.cancel} aria-label={t.cancel} onClick={close}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body library-body">
          <aside className="library-sidebar">
            <div className="library-sidebar-head">
              <span>{t.libraryFolder}</span>
              <button
                className="icon-button"
                onClick={() => void importLibrary()}
                disabled={isScanningLibrary}
                title={t.libraryImport}
                aria-label={t.libraryImport}
              >
                <Plus size={16} />
              </button>
            </div>
            <div className="library-sidebar-list">
              {libraries.length === 0 ? (
                <p className="helper-text">{t.libraryEmpty}</p>
              ) : (
                libraries.map((l) => (
                  <div
                    key={l.id}
                    className={`library-lib-row ${l.id === activeLibraryId ? 'active' : ''}`}
                    onClick={() => selectLibrary(l.id)}
                    role="button"
                    tabIndex={0}
                    title={l.rootPath}
                  >
                    <span className="library-lib-name">{l.name}</span>
                    <button
                      className="icon-button library-lib-del"
                      title={t.libraryDeleteLib}
                      aria-label={t.libraryDeleteLib}
                      onClick={(e) => {
                        e.stopPropagation();
                        void deleteLibrary(l.id);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </aside>

          <div className="library-main">
            {!activeLibrary ? (
              <p className="helper-text">{t.libraryEmpty}</p>
            ) : isScanningLibrary && entries.length === 0 ? (
              <p className="helper-text">{t.libraryScanning}</p>
            ) : (
              <>
              <div className="library-meta">
                <span className="muted" title={activeLibrary.rootPath}>
                  {activeLibrary.rootPath}
                </span>
                <span className="muted">
                  {t.libraryLastScan}:{' '}
                  {activeLibrary.lastScanAt ? new Date(activeLibrary.lastScanAt).toLocaleString(locale) : t.libraryNeverScanned}
                </span>
              </div>

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
                  <span className="library-stat-value">{formatBytes(libraryScan?.totalSpineBytes ?? 0)}</span>
                  <span className="library-stat-label">{t.libraryTotalSpine}</span>
                </div>
                <div className="library-stat">
                  <span className="library-stat-value">{formatBytes(libraryScan?.totalImageBytes ?? 0)}</span>
                  <span className="library-stat-label">{t.libraryTotalImages}</span>
                </div>
                <div className={`library-stat ${warningCount > 0 ? 'warn' : ''}`}>
                  <span className="library-stat-value">{warningCount}</span>
                  <span className="library-stat-label">{t.libraryWarnings}</span>
                </div>
              </div>

              <div className="library-chip-row">
                <span className="library-chip-label">{t.libraryFacetLabel}</span>
                <div className="library-chip-set">
                  <span className="segmented-control">
                    <button className={facet === 'folder' ? 'active' : ''} onClick={() => switchFacet('folder')}>
                      {t.libraryFacetFolder}
                    </button>
                    <button className={facet === 'id' ? 'active' : ''} onClick={() => switchFacet('id')}>
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
                      onClick={() => toggleSet(setSelectedCats, c.key)}
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
                        onClick={() => toggleSet(setSelectedVersions, key)}
                      >
                        {v.version ?? t.libraryUnknownVersion} <em>{v.count}</em>
                      </button>
                    );
                  })}
                </div>
              </div>

              {entries.length === 0 ? (
                <p className="helper-text">{t.libraryNoSpine}</p>
              ) : (
                <table className="library-table">
                  <colgroup>
                    <col className="lib-col-entry" />
                    <col className="lib-col-version" />
                    <col className="lib-col-size" />
                    <col className="lib-col-images" />
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
                      <th />
                    </tr>
                  </thead>
                  {sections.map((section) => {
                    const isCollapsed = collapsed.has(section.key);
                    return (
                    <tbody key={section.key}>
                      <tr className="library-group-row">
                        <td colSpan={4}>
                          <button
                            className="library-group-toggle"
                            onClick={() => toggleSet(setCollapsed, section.key)}
                            aria-expanded={!isCollapsed}
                          >
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
                          <button
                            className="icon-button"
                            onClick={() => createSessionForSection(section)}
                            title={t.libraryCreateSession}
                            aria-label={t.libraryCreateSession}
                          >
                            <FolderPlus size={15} />
                          </button>
                        </td>
                      </tr>
                      {!isCollapsed && section.entries.map((entry) => {
                        const w = entryWarnings(entry, thresholds);
                        return (
                          <tr key={entry.spineFile}>
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
                            <td className="library-actions">
                              <button className="icon-button" title={t.libraryOpenInSpine} aria-label={t.libraryOpenInSpine} onClick={() => void openInSpine(entry)}>
                                <ExternalLink size={15} />
                              </button>
                              <button className="icon-button" title={t.libraryCreateSession} aria-label={t.libraryCreateSession} onClick={() => createSessionForEntry(entry)}>
                                <FolderPlus size={15} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    );
                  })}
                </table>
              )}
              <p className="helper-text">{t.libraryHelp}</p>
              </>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <div className="library-footer-actions">
            <button
              className="secondary-button"
              onClick={() => void rescanLibrary()}
              disabled={!activeLibrary || isScanningLibrary}
            >
              <RotateCw size={15} className={isScanningLibrary ? 'spin' : undefined} /> {t.libraryRescan}
            </button>
            <button className="primary-button" onClick={createProjectFromLib} disabled={sections.length === 0}>
              <Layers size={15} /> {t.libraryCreateProject}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
