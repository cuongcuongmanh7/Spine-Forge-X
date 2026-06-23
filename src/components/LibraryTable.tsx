import { Fragment, useLayoutEffect, useRef } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FolderPlus,
  ListChecks,
  Users
} from 'lucide-react';
import { formatBytes, formatDate } from '../time';
import { entryWarnings, matchedNames, metaKeyForEntry, metaKeyForFolder } from '../library';
import { LibraryDriveInfoRow } from './LibraryDriveInfoRow';
import { LibraryRowMenu, LibrarySectionMenu } from './LibraryRowMenu';
import { LibraryPreviewCell } from './LibraryPreviewCell';
import { LibraryTagCell } from './LibraryTagCell';
import { LibraryOwnerCell } from './LibraryOwnerCell';
import { SpineFileIcon } from './SpineFileIcon';
import { StatIcon } from './StatIcon';
import {
  DAY_MS,
  NotesIndicator,
  cleanStatusIcon,
  sectionCleanStatus,
  splitRelPath,
  type LibraryViewProps
} from './LibraryViewShared';

/** Inventory table view: per-skeleton rows grouped by folder/id band, with sortable columns. */
export function LibraryTable(props: LibraryViewProps) {
  const {
    t,
    sections,
    thresholds,
    parsedQuery,
    collapsed,
    toggleCollapsed,
    expandedAnims,
    toggleAnim,
    menuOpen,
    setMenuOpen,
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
    openFolder,
    openInSpine,
    createSessionForEntry,
    createSessionForSection,
    onPrepareCleanScan,
    onPreview,
    openNotes,
    noteCount,
    onQuickExport,
    quickExportBusy
  } = props;

  const tableRef = useRef<HTMLTableElement>(null);
  const theadRef = useRef<HTMLTableSectionElement>(null);

  // The group rows pin just below the sticky header at `top: var(--lib-thead-h)`. The real header
  // height varies with font/zoom/i18n, so a hardcoded value leaves a gap that scrolling rows peek
  // through — measure the actual thead and feed it back into the CSS var.
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

  return (
    <table className="library-table" ref={tableRef}>
      <colgroup>
        <col className="lib-col-entry" />
        <col className="lib-col-version" />
        <col className="lib-col-size" />
        <col className="lib-col-images" />
        <col className="lib-col-anims" />
        <col className="lib-col-tags" />
        <col className="lib-col-owner" />
        <col className="lib-col-modified" />
        <col className="lib-col-preview" />
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
              <SpineFileIcon size={14} /> {t.libraryColSpine}
              {sortMark('spine')}
            </button>
          </th>
          <th className="num" aria-sort={ariaSort('images')}>
            <button className="library-th-sort" onClick={() => toggleSort('images')}>
              <StatIcon kind="image" size={14} /> {t.libraryColImages}
              {sortMark('images')}
            </button>
          </th>
          <th className="num" aria-sort={ariaSort('anims')}>
            <button className="library-th-sort" onClick={() => toggleSort('anims')}>
              <StatIcon kind="anim" size={14} /> {t.libraryColAnims}
              {sortMark('anims')}
            </button>
          </th>
          <th>{t.libraryColTags}</th>
          <th aria-sort={ariaSort('owner')}>
            <button className="library-th-sort" onClick={() => toggleSort('owner')}>
              {t.libraryColOwner}
              {sortMark('owner')}
            </button>
          </th>
          <th aria-sort={ariaSort('modified')}>
            <button className="library-th-sort" onClick={() => toggleSort('modified')}>
              {t.driveColModified}
              {sortMark('modified')}
            </button>
          </th>
          <th aria-label={t.libraryPreview} />
          <th />
        </tr>
      </thead>
      {sections.map((section) => {
        const isCollapsed = collapsed.has(section.key);
        const secStatus = sectionCleanStatus(section.entries, cleanStatus);
        const folderKey = metaKeyForFolder(section.key);
        const folderNotes = noteCount(folderKey);
        return (
          <tbody key={section.key}>
            <tr className={`library-group-row${folderNotes > 0 ? ' library-has-notes' : ''}`}>
              <td colSpan={10}>
                <div className="library-group-head-row">
                  <span className="library-group-head-left">
                    <button className="library-group-toggle" onClick={() => toggleCollapsed(section.key)} aria-expanded={!isCollapsed}>
                      {isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                      {secStatus && cleanStatusIcon(secStatus, t)}
                      {section.label} <span className="muted">({section.entries.length})</span>
                    </button>
                    {section.mixedVersion && (
                      <span className="library-warn-badge" title={t.libraryWarnMixed}>
                        <AlertTriangle size={13} /> {t.libraryWarnMixed}
                      </span>
                    )}
                    <NotesIndicator count={folderNotes} onOpen={() => openNotes(folderKey, section.label)} t={t} />
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
                    <LibrarySectionMenu
                      open={menuOpen === `sec:${section.key}`}
                      onToggle={() => setMenuOpen(menuOpen === `sec:${section.key}` ? null : `sec:${section.key}`)}
                      onClose={() => setMenuOpen(null)}
                      onQuickExport={() => onQuickExport(section.entries.map((entry) => entry.spineFile))}
                      quickExportBusy={quickExportBusy}
                      t={t}
                    />
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
                const entryKey = metaKeyForEntry(entry);
                const entryNotes = noteCount(entryKey);
                return (
                  <Fragment key={entry.spineFile}>
                    <tr className={entryNotes > 0 ? 'library-has-notes' : undefined}>
                      <td className="library-path" title={entry.spineFile}>
                        <span className="library-path-line">
                          {cleanStatusIcon(cleanStatus(entry), t)}
                          {(() => {
                            const { dir, name } = splitRelPath(entry.relPath);
                            return (
                              <>
                                {dir && <span className="library-path-dir">{dir}</span>}
                                <span className="library-path-name">{name}</span>
                              </>
                            );
                          })()}
                          {(() => {
                            const u = usage.get(entry.spineFile);
                            const count = u?.projectIds.length ?? 0;
                            if (count === 0) {
                              return (
                                <span className="library-usage-badge unused" title={t.libraryUsedByNone}>
                                  <Users size={11} /> 0
                                </span>
                              );
                            }
                            return (
                              <button
                                type="button"
                                className="library-usage-badge"
                                title={`${t.libraryUsedByCount.replace('{count}', String(count))}\n${usageTooltip(entry.spineFile)}`}
                                onClick={() => goToSession(u!.sessionIds[0])}
                              >
                                <Users size={11} /> {count}
                              </button>
                            );
                          })()}
                          <NotesIndicator count={entryNotes} onOpen={() => openNotes(entryKey, splitRelPath(entry.relPath).name)} t={t} />
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
                          <button className="library-anim-toggle" onClick={() => toggleAnim(entry.spineFile)}>
                            {entry.animationCount} {animOpen ? '▴' : '▾'}
                          </button>
                        ) : (
                          <span className="muted" title={t.libraryBinExport}>—</span>
                        )}
                      </td>
                      <td className="library-tags">
                        <LibraryTagCell
                          tags={metaFor(entry)?.tags ?? []}
                          onAdd={(tag) => addEntryTag(entry, tag)}
                          onRemove={(tag) => removeEntryTag(entry, tag)}
                          t={t}
                        />
                      </td>
                      <td className="library-owner">
                        <LibraryOwnerCell
                          manualOwner={metaFor(entry)?.owner}
                          driveName={basic?.ownerName || basic?.ownerEmail || basic?.lastEditorName || basic?.lastEditorEmail || ''}
                          driveEmail={basic?.ownerEmail ?? basic?.lastEditorEmail ?? undefined}
                          onSet={(owner) => setEntryOwner(entry, owner)}
                          t={t}
                        />
                      </td>
                      <td className={`library-modified ${recent ? 'library-modified-recent' : ''}`}>
                        {basic?.modifiedTime ? formatDate(basic.modifiedTime) : <span className="muted">—</span>}
                      </td>
                      <LibraryPreviewCell entry={entry} onPreview={onPreview} t={t} />
                      <LibraryRowMenu
                        entry={entry}
                        open={menuOpen === entry.spineFile}
                        onToggle={() => setMenuOpen(menuOpen === entry.spineFile ? null : entry.spineFile)}
                        onClose={() => setMenuOpen(null)}
                        onDriveInfo={toggleDriveInfo}
                        onCleanScan={(e) => onPrepareCleanScan([e.spineFile])}
                        onOpenFolder={(e) => openFolder(e)}
                        onOpenInSpine={(e) => openInSpine(e)}
                        onCreateSession={createSessionForEntry}
                        onQuickExport={(e) => onQuickExport([e.spineFile])}
                        quickExportBusy={quickExportBusy}
                        t={t}
                      />
                    </tr>
                    {animOpen && entry.exported && (
                      <tr className="library-anim-list">
                        <td colSpan={10}>
                          {entry.skins.length > 0 && (
                            <div>
                              <strong><StatIcon kind="skin" size={13} /> {t.librarySkins}:</strong>{' '}
                              {entry.skins.map((s) => (
                                <span className={`library-anim-chip ${matches.skins.has(s) ? 'matched' : ''}`} key={s}>
                                  {s}
                                </span>
                              ))}
                            </div>
                          )}
                          <div>
                            <strong><StatIcon kind="anim" size={13} /> {t.libraryAnimations}:</strong>{' '}
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
                      <LibraryDriveInfoRow
                        entry={entry}
                        info={info}
                        t={t}
                        onOpenRevision={openRevisionInSpine}
                        onClose={() => toggleDriveInfo(entry)}
                      />
                    )}
                  </Fragment>
                );
              })}
          </tbody>
        );
      })}
    </table>
  );
}
