import { FileClock, History, RotateCw, User, X } from 'lucide-react';
import type { Translations } from '../i18n';
import type { LibraryEntry } from '../config';
import type { DriveFileInfo, DriveRevision } from '../drive';
import { formatBytes, formatDateTime } from '../time';

type DriveInfo = { loading?: boolean; error?: string; notOnDrive?: boolean; data?: DriveFileInfo };

/** The expandable per-row Google Drive panel (owner / last-modified / revision history). Split out
 *  of LibraryInventory to keep that component thin. */
type Props = {
  entry: LibraryEntry;
  info: DriveInfo | undefined;
  t: Translations;
  onOpenRevision: (entry: LibraryEntry, rev: DriveRevision) => void;
  onClose: () => void;
};

/** The Drive panel content (no row/cell wrapper) — reused by the table row and the grid card. */
export function LibraryDriveInfoPanel({ entry, info, t, onOpenRevision, onClose }: Props) {
  return (
    <>
      <button className="library-drive-close" title={t.libraryCollapse} aria-label={t.libraryCollapse} onClick={onClose}>
          <X size={14} />
        </button>
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
                  {info.data.lastEditorName ? <span className="muted"> · {info.data.lastEditorName}</span> : null}
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
                        onClick={() => onOpenRevision(entry, rev)}
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
    </>
  );
}

export function LibraryDriveInfoRow(props: Props) {
  return (
    <tr className="library-anim-list library-drive-row">
      <td colSpan={11}>
        <LibraryDriveInfoPanel {...props} />
      </td>
    </tr>
  );
}
