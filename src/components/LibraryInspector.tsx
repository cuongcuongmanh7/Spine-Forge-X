import { useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, Clock, FolderPlus, Hash, MessageSquare, Stethoscope, Trash2, User, X, Zap } from 'lucide-react';
import { useApp } from '../useAppController';
import { cleanStatusForEntry, metaKeyForEntry } from '../library';
import { formatBytes, formatDate } from '../time';
import { SpinePreviewView } from './SpinePreviewView';
import { SpineFileIcon } from './SpineFileIcon';
import { StatIcon } from './StatIcon';
import { LibraryDriveHistoryModal } from './LibraryDriveHistoryModal';
import { GoogleDriveIcon } from './GoogleDriveIcon';
import { NotesModal } from './NotesModal';
import { splitRelPath } from './LibraryViewShared';
import { commonParentPath } from '../paths';
import type { LibraryFilterApi } from '../useLibraryFilter';
import type { useLibraryTags } from '../useLibraryTags';
import type { useLibraryDrive } from '../useLibraryDrive';
import type { LibraryNotesApi } from '../useLibraryNotes';
import type { LibraryEntry } from '../config';
import './LibraryInspector.css';
import './NotesModal.css';

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
  notes,
  onPreview,
  onHealthCheck
}: {
  filter: LibraryFilterApi;
  tags: TagsApi;
  drive: DriveApi;
  notes: LibraryNotesApi;
  onPreview: (entry: LibraryEntry) => void;
  onHealthCheck: (entry: LibraryEntry) => void;
}) {
  const { t, libraryScan } = useApp();
  const entries = libraryScan?.entries ?? [];
  const selectedEntries = useMemo(
    () => entries.filter((e) => filter.selected.has(e.spineFile)),
    [entries, filter.selected]
  );
  // The card the user last clicked (preview focus) drives the single-asset panel; the checkbox
  // selection only takes over when 2+ are ticked (bulk summary).
  const focusedEntry = useMemo(
    () => entries.find((e) => e.spineFile === filter.focused) ?? null,
    [entries, filter.focused]
  );

  // Bulk selection wins when it's a real multi-select; otherwise fall back to the focused card, then
  // to a lone checkbox selection (keeps the table's click-to-select behaviour showing a panel).
  const single = selectedEntries.length > 1 ? null : (focusedEntry ?? selectedEntries[0] ?? null);
  if (!single && selectedEntries.length <= 1) return null;

  return (
    <aside className="library-inspector" aria-label={t.libraryInspectorTitle}>
      {single ? (
        <SingleInspector entry={single} filter={filter} tags={tags} drive={drive} notes={notes} onPreview={onPreview} onHealthCheck={onHealthCheck} />
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
  notes,
  onPreview,
  onHealthCheck
}: {
  entry: LibraryEntry;
  filter: LibraryFilterApi;
  tags: TagsApi;
  drive: DriveApi;
  notes: LibraryNotesApi;
  onPreview: (entry: LibraryEntry) => void;
  onHealthCheck: (entry: LibraryEntry) => void;
}) {
  const { t, quickExport, anyRunning, addToTrash, createSessionFromLibrary, pushToast } = useApp();
  const { name } = splitRelPath(entry.relPath);
  const basic = drive.basicFor(entry);
  const owner = tags.metaFor(entry)?.owner || basic?.ownerName || basic?.ownerEmail || basic?.lastEditorName || basic?.lastEditorEmail || '';
  const [historyOpen, setHistoryOpen] = useState(false);

  // Notes for this asset (read-only here; the full add/resolve flow opens in the shared NotesModal).
  const noteKey = metaKeyForEntry(entry);
  const noteList = notes.notesForKey(noteKey);
  const [notesOpen, setNotesOpen] = useState(false);
  const [showResolved, setShowResolved] = useState(true);

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

      <dl className="library-inspector-meta library-inspector-card">
        <Row icon={<Hash size={13} />} label={t.libraryColVersion} value={entry.version ?? t.libraryUnknownVersion} />
        <Row icon={<SpineFileIcon size={13} />} label={t.libraryColSpine} value={formatBytes(entry.spineBytes)} />
        <Row icon={<StatIcon kind="image" size={13} />} label={t.libraryColImages} value={`${formatBytes(entry.imageBytes)} · ${entry.imageCount}`} />
        <Row icon={<StatIcon kind="anim" size={13} />} label={t.libraryColAnims} value={String(entry.animationCount)} />
        <Row icon={<StatIcon kind="skin" size={13} />} label={t.librarySkins} value={String(entry.skins.length)} />
        <Row icon={<Clock size={13} />} label={t.driveColModified} value={basic?.modifiedTime ? formatDate(basic.modifiedTime) : '—'} />
        <Row icon={<User size={13} />} label={t.libraryColOwner} value={owner || '—'} />
      </dl>

      <div className="library-inspector-notes library-inspector-card">
        <div className="library-inspector-notes-head">
          <span className="library-inspector-notes-title">
            {t.notes}
            {noteList.length > 0 && <span className="library-inspector-notes-count">{noteList.length}</span>}
          </span>
          <button className="icon-button" title={t.notesOpenIndicator} aria-label={t.notesOpenIndicator} onClick={() => setNotesOpen(true)}>
            <MessageSquare size={14} />
          </button>
        </div>
        {noteList.length === 0 ? (
          <p className="library-inspector-notes-empty">{t.notesEmpty}</p>
        ) : (
          <ul className="library-inspector-notes-list">
            {[...noteList]
              .sort((a, b) => b.createdAt - a.createdAt)
              .map((note) => (
                <li key={note.id} className={note.resolved ? 'is-resolved' : undefined}>
                  <p className="library-inspector-note-text">{note.text}</p>
                  <span className="library-inspector-note-meta">
                    {note.resolved && <CheckCircle2 size={11} className="library-inspector-note-check" />}
                    {t.notesBy.replace('{author}', note.authorEmail)} · {formatDate(note.createdAt)}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </div>

      <div className="library-inspector-history">
        <button
          className="ghost-button small"
          onClick={() => {
            drive.loadDriveInfo(entry);
            setHistoryOpen(true);
          }}
        >
          <GoogleDriveIcon size={14} /> {t.driveInfoTitle}
        </button>
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

      {notesOpen && (
        <NotesModal
          t={t}
          targetLabel={name}
          notes={noteList}
          showResolved={showResolved}
          onToggleShowResolved={() => setShowResolved((v) => !v)}
          onAdd={(text) => notes.addNoteByKey(noteKey, text)}
          onToggleResolved={(id) => notes.toggleResolved(noteKey, id)}
          onDelete={(id) => notes.deleteNote(noteKey, id)}
          canDelete={notes.canDelete}
          onClose={() => setNotesOpen(false)}
        />
      )}

      {historyOpen && (
        <LibraryDriveHistoryModal
          t={t}
          entry={entry}
          info={drive.driveInfo[entry.spineFile]}
          onOpenRevision={drive.openRevisionInSpine}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </div>
  );
}

/** Multiple assets selected: aggregate overview + status breakdown + bulk actions. */
function MultiInspector({ entries, filter }: { entries: LibraryEntry[]; filter: LibraryFilterApi }) {
  const { t, libraryCleanState, quickExport, anyRunning, addManyToTrash, createSessionFromLibrary, pushToast } = useApp();

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

  // Bundle the whole selection into one export session (input = their common parent folder, named
  // after it). Files may span folders — inputFiles keeps them explicit so the session exports all.
  function createSession() {
    const spineFiles = entries.map((e) => e.spineFile);
    const root = commonParentPath(spineFiles);
    const folderName = root ? root.split(/[\\/]/).pop() ?? '' : '';
    const name = folderName || t.librarySelectedCount.replace('{count}', String(total));
    createSessionFromLibrary(name, spineFiles, root || entries[0]?.folder || '');
    pushToast(t.librarySessionCreated.replace('{name}', name), 'success');
  }

  function moveToTrash() {
    addManyToTrash(entries);
    filter.clearSelected();
    pushToast(t.libraryInspectorMovedToTrash.replace('{count}', String(total)), 'success');
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
        <button className="secondary-button small" onClick={createSession}>
          <FolderPlus size={14} /> {t.libraryCreateSession}
        </button>
        <button className="secondary-button small danger" onClick={moveToTrash}>
          <Trash2 size={14} /> {t.libraryMoveToTrash}
        </button>
      </div>
    </div>
  );
}

function Row({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="library-inspector-row">
      <dt>
        <span className="library-inspector-row-icon" aria-hidden="true">{icon}</span>
        {label}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}
