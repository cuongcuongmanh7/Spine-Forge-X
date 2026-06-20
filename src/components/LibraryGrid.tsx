import { AlertTriangle, ChevronDown, ChevronRight, FolderPlus, ListChecks, Users } from 'lucide-react';
import { formatBytes, formatDate } from '../time';
import { entryWarnings, matchedNames } from '../library';
import { LibraryCardThumb } from './LibraryCardThumb';
import { LibraryTagCell } from './LibraryTagCell';
import { LibraryOwnerCell } from './LibraryOwnerCell';
import { LibraryPreviewButton } from './LibraryPreviewCell';
import { LibraryRowMenuButton } from './LibraryRowMenu';
import { LibraryDriveInfoPanel } from './LibraryDriveInfoRow';
import {
  DAY_MS,
  cleanStatusIcon,
  sectionCleanStatus,
  splitRelPath,
  type LibraryViewProps
} from './LibraryViewShared';
import './LibraryGrid.css';

/** Inventory grid view: one card per unit, grouped by folder/id band. Same data as the table view,
 *  plus a lazy real-skeleton thumbnail per card ({@link LibraryCardThumb}). */
export function LibraryGrid(props: LibraryViewProps) {
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
    onPreview
  } = props;

  return (
    <div className="library-grid-groups">
      {sections.map((section) => {
        const isCollapsed = collapsed.has(section.key);
        const secStatus = sectionCleanStatus(section.entries, cleanStatus);
        return (
          <section className="library-grid-group" key={section.key}>
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

            {!isCollapsed && (
              <div className="library-grid">
                {section.entries.map((entry) => {
                  const w = entryWarnings(entry, thresholds);
                  const matches = matchedNames(entry, parsedQuery);
                  const hasChipMatch = matches.animations.size > 0 || matches.skins.size > 0;
                  const animOpen = expandedAnims.has(entry.spineFile) || hasChipMatch;
                  const infoOpen = expandedInfo.has(entry.spineFile);
                  const info = driveInfo[entry.spineFile];
                  const basic = basicFor(entry);
                  const modifiedMs = basic?.modifiedTime ? Date.parse(basic.modifiedTime) : NaN;
                  const recent = Number.isFinite(modifiedMs) && Date.now() - modifiedMs < 7 * DAY_MS;
                  const { dir, name } = splitRelPath(entry.relPath);
                  const u = usage.get(entry.spineFile);
                  const usedCount = u?.projectIds.length ?? 0;
                  return (
                    <article className="library-card" key={entry.spineFile}>
                      <div className="library-card-thumb-wrap">
                        <LibraryCardThumb entry={entry} />
                        <LibraryPreviewButton entry={entry} onPreview={onPreview} t={t} />
                      </div>

                      <div className="library-card-head">
                        {cleanStatusIcon(cleanStatus(entry), t)}
                        <span className="library-card-name" title={entry.spineFile}>
                          {name}
                        </span>
                        <span className="library-card-actions">
                          <span className="library-card-menu">
                            <LibraryRowMenuButton
                              entry={entry}
                              open={menuOpen === entry.spineFile}
                              onToggle={() => setMenuOpen(menuOpen === entry.spineFile ? null : entry.spineFile)}
                              onClose={() => setMenuOpen(null)}
                              onDriveInfo={toggleDriveInfo}
                              onCleanScan={(e) => onPrepareCleanScan([e.spineFile])}
                              onOpenFolder={(e) => openFolder(e)}
                              onOpenInSpine={(e) => openInSpine(e)}
                              onCreateSession={createSessionForEntry}
                              t={t}
                            />
                          </span>
                        </span>
                      </div>

                      {dir && <div className="library-card-dir muted" title={entry.relPath}>{dir}</div>}

                      <div className="library-card-metastats">
                        <span className="library-badge">{entry.version ?? t.libraryUnknownVersion}</span>
                        {usedCount === 0 ? (
                          <span className="library-usage-badge unused" title={t.libraryUsedByNone}>
                            <Users size={11} /> 0
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="library-usage-badge"
                            title={`${t.libraryUsedByCount.replace('{count}', String(usedCount))}\n${usageTooltip(entry.spineFile)}`}
                            onClick={() => goToSession(u!.sessionIds[0])}
                          >
                            <Users size={11} /> {usedCount}
                          </button>
                        )}
                        <span className={`library-card-stat ${w.heavySpine ? 'library-warn-cell' : ''}`} title={w.heavySpine ? t.libraryWarnHeavySpine : t.libraryColSpine}>
                          {w.heavySpine && <AlertTriangle size={12} />} {formatBytes(entry.spineBytes)}
                        </span>
                        <span className={`library-card-stat ${w.heavyImages ? 'library-warn-cell' : ''}`} title={w.heavyImages ? t.libraryWarnHeavyImages : t.libraryColImages}>
                          {w.heavyImages && <AlertTriangle size={12} />} {formatBytes(entry.imageBytes)} <span className="muted">· {entry.imageCount}</span>
                        </span>
                        {!entry.exported ? (
                          <span className="library-badge-muted">{t.libraryNotExported}</span>
                        ) : entry.animationCount > 0 ? (
                          <button className="library-anim-toggle" onClick={() => toggleAnim(entry.spineFile)}>
                            {entry.animationCount} {t.libraryColAnims} {animOpen ? '▴' : '▾'}
                          </button>
                        ) : (
                          <span className="muted" title={t.libraryBinExport}>—</span>
                        )}
                      </div>

                      {animOpen && entry.exported && (
                        <div className="library-card-anims">
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
                        </div>
                      )}

                      <div className="library-card-tags">
                        <LibraryTagCell
                          tags={metaFor(entry)?.tags ?? []}
                          onAdd={(tag) => addEntryTag(entry, tag)}
                          onRemove={(tag) => removeEntryTag(entry, tag)}
                          t={t}
                        />
                      </div>

                      <div className="library-card-foot">
                        <span className="library-card-owner">
                          <LibraryOwnerCell
                            manualOwner={metaFor(entry)?.owner}
                            driveName={basic?.ownerName || basic?.ownerEmail || basic?.lastEditorName || basic?.lastEditorEmail || ''}
                            driveEmail={basic?.ownerEmail ?? basic?.lastEditorEmail ?? undefined}
                            onSet={(owner) => setEntryOwner(entry, owner)}
                            t={t}
                          />
                        </span>
                        <span className={`library-card-modified muted ${recent ? 'library-modified-recent' : ''}`}>
                          {basic?.modifiedTime ? formatDate(basic.modifiedTime) : '—'}
                        </span>
                      </div>

                      {infoOpen && (
                        <div className="library-card-drive">
                          <LibraryDriveInfoPanel
                            entry={entry}
                            info={info}
                            t={t}
                            onOpenRevision={openRevisionInSpine}
                            onClose={() => toggleDriveInfo(entry)}
                          />
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
