import { RotateCcw, Trash2, X } from 'lucide-react';
import type { Translations } from '../i18n';
import type { LibraryEntry } from '../config';
import { SpineFileIcon } from './SpineFileIcon';

/** Modal listing the active library's trashed entries, with per-row + bulk restore. The trash is a
 *  low-traffic surface (most users never open it), so it lives in its own small module. */
export function LibraryTrashModal({
  t,
  entries,
  onRestore,
  onRestoreAll,
  onClose
}: {
  t: Translations;
  entries: LibraryEntry[];
  onRestore: (relPath: string) => void;
  onRestoreAll: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal library-trash-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            <Trash2 size={16} /> {t.libraryTrashTitle} <span className="muted">({entries.length})</span>
          </h2>
          <button className="modal-close" title={t.cancel} aria-label={t.cancel} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <p className="helper-text">{t.libraryTrashHint}</p>
          {entries.length === 0 ? (
            <p className="helper-text">{t.libraryTrashEmpty}</p>
          ) : (
            <div className="library-trash-list">
              {entries.map((e) => (
                <div key={e.relPath} className="library-trash-row">
                  <SpineFileIcon size={14} />
                  <span className="library-trash-path" title={e.relPath}>{e.relPath}</span>
                  <button className="secondary-button small" onClick={() => onRestore(e.relPath)}>
                    <RotateCcw size={13} /> {t.libraryTrashRestore}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        {entries.length > 0 && (
          <div className="modal-footer">
            <button className="secondary-button" onClick={onRestoreAll}>
              <RotateCcw size={14} /> {t.libraryTrashRestoreAll}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
