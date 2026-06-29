import { History, X } from 'lucide-react';
import type { Translations } from '../i18n';
import type { LibraryEntry } from '../config';
import type { DriveFileInfo, DriveRevision } from '../drive';
import { LibraryDriveInfoPanel } from './LibraryDriveInfoRow';
import { basename } from '../sessions';

type DriveInfo = { loading?: boolean; error?: string; notOnDrive?: boolean; data?: DriveFileInfo };

/** Standalone modal for an entry's Google Drive owner + revision history. Reuses {@link
 *  LibraryDriveInfoPanel} (shared with the inspector) so the content stays in one place; this just
 *  wraps it in the standard modal chrome instead of an inline card/row expansion. */
export function LibraryDriveHistoryModal({
  t,
  entry,
  info,
  onOpenRevision,
  onClose
}: {
  t: Translations;
  entry: LibraryEntry;
  info: DriveInfo | undefined;
  onOpenRevision: (entry: LibraryEntry, rev: DriveRevision) => void;
  onClose: () => void;
}) {
  const label = basename(entry.spineFile).replace(/\.spine$/i, '');
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal library-drive-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            <History size={16} /> {t.driveInfoTitle} <span className="muted">· {label}</span>
          </h2>
          <button className="modal-close" title={t.cancel} aria-label={t.cancel} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body library-drive-modal-body">
          <LibraryDriveInfoPanel entry={entry} info={info} t={t} onOpenRevision={onOpenRevision} onClose={onClose} />
        </div>
      </div>
    </div>
  );
}
