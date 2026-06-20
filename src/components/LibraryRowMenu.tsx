import { FolderOpen, FolderPlus, History, ListChecks, MoreHorizontal } from 'lucide-react';
import type { Translations } from '../i18n';
import type { LibraryEntry } from '../config';
import { SpineFileIcon } from './SpineFileIcon';

/** The per-row "⋯" action menu cell (Drive history / clean scan / open / create session). Split out
 *  of LibraryInventory to keep that component under the line-size guard. */
export function LibraryRowMenu({
  entry,
  open,
  onToggle,
  onClose,
  onDriveInfo,
  onCleanScan,
  onOpenFolder,
  onOpenInSpine,
  onCreateSession,
  t
}: {
  entry: LibraryEntry;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onDriveInfo: (entry: LibraryEntry) => void;
  onCleanScan: (entry: LibraryEntry) => void;
  onOpenFolder: (entry: LibraryEntry) => void;
  onOpenInSpine: (entry: LibraryEntry) => void;
  onCreateSession: (entry: LibraryEntry) => void;
  t: Translations;
}) {
  const act = (fn: (entry: LibraryEntry) => void) => {
    onClose();
    fn(entry);
  };
  return (
    <td className="library-menu-cell">
      <button
        className={`session-menu-trigger ${open ? 'open' : ''}`}
        title={t.options}
        aria-label={t.options}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <>
          <div
            className="menu-backdrop"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          />
          <div className="session-menu library-row-menu" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => act(onDriveInfo)}>
              <History size={14} /> {t.driveInfoTitle}
            </button>
            <button onClick={() => act(onCleanScan)}>
              <ListChecks size={14} /> {t.libraryPrepareCleanScan}
            </button>
            <button onClick={() => act(onOpenFolder)}>
              <FolderOpen size={14} /> {t.libraryOpenFolder}
            </button>
            <button onClick={() => act(onOpenInSpine)}>
              <SpineFileIcon size={14} /> {t.libraryOpenInSpine}
            </button>
            <button onClick={() => act(onCreateSession)}>
              <FolderPlus size={14} /> {t.libraryCreateSession}
            </button>
          </div>
        </>
      )}
    </td>
  );
}
