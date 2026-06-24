import { useMemo } from 'react';
import { FolderPlus, History, Stethoscope, Trash2, X, Zap } from 'lucide-react';
import { useApp } from '../useAppController';
import { cleanStatusForEntry } from '../library';
import { formatBytes, formatDate } from '../time';
import { SpinePreviewView } from './SpinePreviewView';
import { SpineFileIcon } from './SpineFileIcon';
import { LibraryDriveInfoPanel } from './LibraryDriveInfoRow';
import { splitRelPath } from './LibraryViewShared';
import type { LibraryFilterApi } from '../useLibraryFilter';
import type { useLibraryTags } from '../useLibraryTags';
import type { useLibraryDrive } from '../useLibraryDrive';
import type { LibraryEntry } from '../config';
import './LibraryInspector.css';

type TagsApi = ReturnType<typeof useLibraryTags>;
type DriveApi = ReturnType<typeof useLibraryDrive>;

/**
 * Right-hand inspector for the Inventory tab, driven by the current selection:
 *   - exactly one asset selected → details + warnings + a Preview action (opens the player modal)
 *   - more than one             → an aggregate summary (size / animations / status) + bulk actions
 * Hidden (renders null) when nothing is selected. The live in-panel player lands in a later stage;
 * for now single-select previews via the existing {@link onPreview} modal.
 */
export function LibraryInspector({
  filter,
  tags,
  drive,
  onPreview,
  onHealthCheck
}: {
  filter: LibraryFilterApi;
  tags: TagsApi;
  drive: DriveApi;
  onPreview: (entry: LibraryEntry) => void;
  onHealthCheck: (entry: LibraryEntry) => void;
}) {
  const { t, libraryScan } = useApp();
  const entries = libraryScan?.entries ?? [];
  const selectedEntries = useMemo(
    () => entries.filter((e) => filter.selected.has(e.spineFile)),
    [entries, filter.selected]
  );

  if (selectedEntries.length === 0) return null;

  return (
    <aside className="library-inspector" aria-label={t.libraryInspectorTitle}>
      {selectedEntries.length === 1 ? (
        <SingleInspector entry={selectedEntries[0]} filter={filter} tags={tags} drive={drive} onPreview={onPreview} onHealthCheck={onHealthCheck} />
      ) : (
        <MultiInspector entries={selectedEntries} filter={filter} />
      )}
    </aside>
  );
}

/** One asset selected: header, thumbnail + preview, key details, per-asset actions. */
function SingleInspector({
  entry,
  filter,
  tags,
  drive,
  onPreview,
  onHealthCheck
}: {
  entry: LibraryEntry;
  filter: LibraryFilterApi;
  tags: TagsApi;
  drive: DriveApi;
  onPreview: (entry: LibraryEntry) => void;
  onHealthCheck: (entry: LibraryEntry) => void;
}) {
  const { t, quickExport, anyRunning, addToTrash, createSessionFromLibrary, pushToast } = useApp();
  const { name } = splitRelPath(entry.relPath);
  const basic = drive.basicFor(entry);
  const owner = tags.metaFor(entry)?.owner || basic?.ownerName || basic?.ownerEmail || basic?.lastEditorName || basic?.lastEditorEmail || '';
  const historyOpen = drive.expandedInfo.has(entry.spineFile);

  function createSession() {
    const base = name.replace(/\.spine$/i, '');
    createSessionFromLibrary(base, [entry.spineFile], entry.folder);
    pushToast(t.librarySessionCreated.replace('{name}', base), 'success');
  }

  return (
    <div className="library-inspector-body">
      <div className="library-inspector-head">
        <h3 title={entry.spineFile}>{name}</h3>
        <button className="icon-button" title={t.libraryClearSelection} aria-label={t.libraryClearSelection} onClick={filter.clearSelected}>
          <X size={15} />
        </button>
      </div>

      <div className="library-inspector-player">
        <SpinePreviewView key={entry.spineFile} entry={entry} compact onExpand={() => onPreview(entry)} />
      </div>

      <dl className="library-inspector-meta">
        <Row label={t.libraryColVersion} value={entry.version ?? t.libraryUnknownVersion} />
        <Row label={t.libraryColSpine} value={formatBytes(entry.spineBytes)} />
        <Row label={t.libraryColImages} value={`${formatBytes(entry.imageBytes)} · ${entry.imageCount}`} />
        <Row label={t.libraryColAnims} value={String(entry.animationCount)} />
        <Row label={t.librarySkins} value={String(entry.skins.length)} />
        <Row label={t.driveColModified} value={basic?.modifiedTime ? formatDate(basic.modifiedTime) : '—'} />
        <Row label={t.libraryColOwner} value={owner || '—'} />
      </dl>

      <div className="library-inspector-history">
        <button className="ghost-button small" onClick={() => drive.toggleDriveInfo(entry)} aria-expanded={historyOpen}>
          <History size={14} /> {t.driveInfoTitle}
        </button>
        {historyOpen && (
          <div className="library-card-drive">
            <LibraryDriveInfoPanel
              entry={entry}
              info={drive.driveInfo[entry.spineFile]}
              t={t}
              onOpenRevision={drive.openRevisionInSpine}
              onClose={() => drive.toggleDriveInfo(entry)}
            />
          </div>
        )}
      </div>

      <div className="library-inspector-actions">
        <button className="secondary-button small" onClick={() => void quickExport([entry.spineFile])} disabled={anyRunning}>
          <Zap size={14} /> {t.libraryQuickExport}
        </button>
        <button className="secondary-button small" onClick={createSession}>
          <FolderPlus size={14} /> {t.libraryCreateSession}
        </button>
        <button className="secondary-button small" onClick={() => onHealthCheck(entry)}>
          <Stethoscope size={14} /> {t.libraryHealthCheck}
        </button>
        <button className="secondary-button small danger" onClick={() => addToTrash(entry)}>
          <Trash2 size={14} /> {t.libraryMoveToTrash}
        </button>
      </div>
    </div>
  );
}

/** Multiple assets selected: aggregate overview + status breakdown + bulk actions. */
function MultiInspector({ entries, filter }: { entries: LibraryEntry[]; filter: LibraryFilterApi }) {
  const { t, libraryCleanState, quickExport, anyRunning } = useApp();

  const stats = useMemo(() => {
    let bytes = 0;
    let anims = 0;
    let clean = 0;
    let warning = 0;
    let unknown = 0;
    for (const e of entries) {
      bytes += e.spineBytes + e.imageBytes;
      anims += e.animationCount;
      const status = cleanStatusForEntry(e, libraryCleanState[e.spineFile]);
      if (status === 'clean') clean += 1;
      else if (status === 'warning') warning += 1;
      else unknown += 1;
    }
    return { bytes, anims, clean, warning, unknown };
  }, [entries, libraryCleanState]);

  const total = entries.length;

  function exportSelected() {
    void quickExport(entries.map((e) => e.spineFile));
  }

  return (
    <div className="library-inspector-body">
      <div className="library-inspector-head">
        <h3>{t.librarySelectedCount.replace('{count}', String(total))}</h3>
        <button className="icon-button" title={t.libraryClearSelection} aria-label={t.libraryClearSelection} onClick={filter.clearSelected}>
          <X size={15} />
        </button>
      </div>

      <div className="library-inspector-overview">
        <div className="library-inspector-stat">
          <span className="library-inspector-stat-value">{formatBytes(stats.bytes)}</span>
          <span className="library-inspector-stat-label">{t.libraryInspectorTotalSize}</span>
        </div>
        <div className="library-inspector-stat">
          <span className="library-inspector-stat-value">{stats.anims}</span>
          <span className="library-inspector-stat-label">{t.libraryInspectorTotalAnims}</span>
        </div>
      </div>

      <div className="library-inspector-breakdown">
        <div className="library-inspector-bar" role="img" aria-label={`${stats.clean} ${t.libraryStatClean}, ${stats.warning} ${t.libraryStatNeedsReview}`}>
          {stats.clean > 0 && <span className="seg clean" style={{ flexGrow: stats.clean }} />}
          {stats.warning > 0 && <span className="seg warn" style={{ flexGrow: stats.warning }} />}
          {stats.unknown > 0 && <span className="seg unknown" style={{ flexGrow: stats.unknown }} />}
        </div>
        <div className="library-inspector-legend">
          <span><i className="dot clean" /> {stats.clean} {t.libraryStatClean}</span>
          <span><i className="dot warn" /> {stats.warning} {t.libraryStatNeedsReview}</span>
          {stats.unknown > 0 && <span><i className="dot unknown" /> {stats.unknown} {t.libraryStatNotScanned}</span>}
        </div>
      </div>

      <div className="library-inspector-list">
        <span className="library-inspector-section-label">{t.libraryInspectorInSelection} ({total})</span>
        <ul>
          {entries.slice(0, 50).map((e) => {
            return (
              <li key={e.spineFile}>
                <SpineFileIcon size={12} />
                <span className="library-inspector-list-name" title={e.relPath}>{splitRelPath(e.relPath).name}</span>
                <button className="icon-button tiny" title={t.libraryClearSelection} aria-label={t.libraryClearSelection} onClick={() => filter.toggleSelected(e.spineFile)}>
                  <X size={12} />
                </button>
              </li>
            );
          })}
          {total > 50 && <li className="muted">+{total - 50}…</li>}
        </ul>
      </div>

      <div className="library-inspector-actions">
        <button className="secondary-button small" onClick={exportSelected} disabled={anyRunning}>
          <Zap size={14} /> {t.libraryInspectorExportSelected}
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="library-inspector-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
