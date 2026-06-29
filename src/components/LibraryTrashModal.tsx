import { Folder, RotateCcw, Trash2, X } from 'lucide-react';
import type { Translations } from '../i18n';
import type { LibraryEntry } from '../config';
import { SpineFileIcon } from './SpineFileIcon';

/** Modal listing the active library's trashed folders + files, with per-row + bulk restore. The trash
 *  is a low-traffic surface (most users never open it), so it lives in its own small module. */
export function LibraryTrashModal({
  t,
  folders,
  files,
  onRestoreFolder,
  onRestore,
  onRestoreAll,
  onClose
}: {
  t: Translations;
  /** Top-level folders in trash, with how many scanned entries each hides. */
  folders: { name: string; count: number }[];
  /** Individually-trashed files (not covered by a trashed folder). */
  files: LibraryEntry[];
  onRestoreFolder: (name: string) => void;
  onRestore: (relPath: string) => void;
  onRestoreAll: () => void;
  onClose: () => void;
}) {
  const total = folders.length + files.length;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal library-trash-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            <Trash2 size={16} /> {t.libraryTrashTitle} <span className="muted">({total})</span>
          </h2>
          <button className="modal-close" title={t.cancel} aria-label={t.cancel} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <p className="helper-text">{t.libraryTrashHint}</p>
          {total === 0 ? (
            <p className="helper-text">{t.libraryTrashEmpty}</p>
          ) : (
            <div className="library-trash-list">
              {folders.map((f) => (
                <div key={`dir:${f.name}`} className="library-trash-row">
                  <Folder size={14} />
                  <span className="library-trash-path" title={f.name}>
                    {f.name} <span className="muted">({f.count})</span>
                  </span>
                  <button className="secondary-button small" onClick={() => onRestoreFolder(f.name)}>
                    <RotateCcw size={13} /> {t.libraryTrashRestore}
                  </button>
                </div>
              ))}
              {files.map((e) => (
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
        {total > 0 && (
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
