import { X } from 'lucide-react';
import type { Translations } from '../i18n';
import type { LibraryEntry } from '../config';
import type { LibraryNotesApi } from '../useLibraryNotes';
import type { useLibraryDrive } from '../useLibraryDrive';
import { MenuPopover } from './MenuPopover';
import { NotesModal } from './NotesModal';
import { LibraryTrashModal } from './LibraryTrashModal';
import { LibraryDriveHistoryModal } from './LibraryDriveHistoryModal';
import './NotesModal.css';

type DriveApi = ReturnType<typeof useLibraryDrive>;

/** All of the Inventory's overlay surfaces (notes, filter-overflow popover, trash, Drive history) in
 *  one module, so LibraryInventory stays under the file-size guard. Pure presentation — every bit of
 *  state lives in the host and is driven through these props. */
export function LibraryInventoryModals({
  t,
  notesTarget,
  notes,
  showResolved,
  onToggleShowResolved,
  onCloseNotes,
  overflowAnchor,
  overflowChips,
  onCloseOverflow,
  trashOpen,
  trashedFolders,
  trashedFiles,
  onRestoreFolder,
  onRestore,
  onCloseTrash,
  driveModalEntry,
  driveInfo,
  onOpenRevision,
  onCloseDrive
}: {
  t: Translations;
  notesTarget: { key: string; label: string } | null;
  notes: LibraryNotesApi;
  showResolved: boolean;
  onToggleShowResolved: () => void;
  onCloseNotes: () => void;
  overflowAnchor: HTMLElement | null;
  overflowChips: { id: string; label: string; remove: () => void }[];
  onCloseOverflow: () => void;
  trashOpen: boolean;
  trashedFolders: { name: string; count: number }[];
  trashedFiles: LibraryEntry[];
  onRestoreFolder: (name: string) => void;
  onRestore: (relPath: string) => void;
  onCloseTrash: () => void;
  driveModalEntry: LibraryEntry | null;
  driveInfo: DriveApi['driveInfo'];
  onOpenRevision: DriveApi['openRevisionInSpine'];
  onCloseDrive: () => void;
}) {
  return (
    <>
      {notesTarget && (
        <NotesModal
          t={t}
          targetLabel={notesTarget.label}
          notes={notes.notesForKey(notesTarget.key)}
          showResolved={showResolved}
          onToggleShowResolved={onToggleShowResolved}
          onAdd={(text) => notes.addNoteByKey(notesTarget.key, text)}
          onToggleResolved={(id) => notes.toggleResolved(notesTarget.key, id)}
          onDelete={(id) => notes.deleteNote(notesTarget.key, id)}
          canDelete={notes.canDelete}
          onClose={onCloseNotes}
        />
      )}

      {/* Overflow chips from the collapsed Filters preview — each removable from here. */}
      {overflowAnchor && (
        <MenuPopover
          anchor={overflowAnchor}
          onClose={onCloseOverflow}
          className="session-menu library-row-menu library-row-menu--portal library-chip-overflow"
        >
          {overflowChips.map((c) => (
            <button key={c.id} type="button" onClick={() => c.remove()}>
              <X size={13} /> {c.label}
            </button>
          ))}
        </MenuPopover>
      )}

      {trashOpen && (
        <LibraryTrashModal
          t={t}
          folders={trashedFolders}
          files={trashedFiles}
          onRestoreFolder={onRestoreFolder}
          onRestore={onRestore}
          onRestoreAll={() => {
            trashedFolders.forEach((f) => onRestoreFolder(f.name));
            trashedFiles.forEach((e) => onRestore(e.relPath));
          }}
          onClose={onCloseTrash}
        />
      )}

      {driveModalEntry && (
        <LibraryDriveHistoryModal
          t={t}
          entry={driveModalEntry}
          info={driveInfo[driveModalEntry.spineFile]}
          onOpenRevision={onOpenRevision}
          onClose={onCloseDrive}
        />
      )}
    </>
  );
}
