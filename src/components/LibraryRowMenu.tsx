import { useRef } from 'react';
import { FolderOpen, FolderPlus, History, ListChecks, MoreHorizontal, Stethoscope, Trash2, Zap } from 'lucide-react';
import type { Translations } from '../i18n';
import type { LibraryEntry } from '../config';
import { SpineFileIcon } from './SpineFileIcon';
import { MenuPopover } from './MenuPopover';

/** The per-row "⋯" action menu cell (Drive history / clean scan / open / create session). Split out
 *  of LibraryInventory to keep that component under the line-size guard. */
type Props = {
  entry: LibraryEntry;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onDriveInfo: (entry: LibraryEntry) => void;
  onCleanScan: (entry: LibraryEntry) => void;
  onOpenFolder: (entry: LibraryEntry) => void;
  onOpenInSpine: (entry: LibraryEntry) => void;
  onCreateSession: (entry: LibraryEntry) => void;
  onHealthCheck: (entry: LibraryEntry) => void;
  onQuickExport: (entry: LibraryEntry) => void;
  onMoveToTrash: (entry: LibraryEntry) => void;
  quickExportBusy: boolean;
  t: Translations;
};

/** Just the "⋯" trigger + dropdown (no cell wrapper) — reused by the table cell and the grid card. */
export function LibraryRowMenuButton({
  entry,
  open,
  onToggle,
  onClose,
  onDriveInfo,
  onCleanScan,
  onOpenFolder,
  onOpenInSpine,
  onCreateSession,
  onHealthCheck,
  onQuickExport,
  onMoveToTrash,
  quickExportBusy,
  t
}: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const act = (fn: (entry: LibraryEntry) => void) => {
    onClose();
    fn(entry);
  };
  return (
    <>
      <button
        ref={triggerRef}
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
        <MenuPopover anchor={triggerRef.current} onClose={onClose}>
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
          <button onClick={() => act(onHealthCheck)}>
            <Stethoscope size={14} /> {t.libraryHealthCheck}
          </button>
          <button disabled={quickExportBusy} onClick={() => act(onQuickExport)}>
            <Zap size={14} /> {t.libraryQuickExport}
          </button>
          <button className="danger" onClick={() => act(onMoveToTrash)}>
            <Trash2 size={14} /> {t.libraryMoveToTrash}
          </button>
        </MenuPopover>
      )}
    </>
  );
}

export function LibraryRowMenu(props: Props) {
  return (
    <td className="library-menu-cell">
      <LibraryRowMenuButton {...props} />
    </td>
  );
}

/** The folder-group "⋯" menu (currently just Quick export) shown in the section header. */
export function LibrarySectionMenu({
  open,
  onToggle,
  onClose,
  onQuickExport,
  quickExportBusy,
  t
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onQuickExport: () => void;
  quickExportBusy: boolean;
  t: Translations;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={triggerRef}
        className={`session-menu-trigger ${open ? 'open' : ''}`}
        title={t.options}
        aria-label={t.options}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        <MoreHorizontal size={15} />
      </button>
      {open && (
        <MenuPopover anchor={triggerRef.current} onClose={onClose}>
          <button
            disabled={quickExportBusy}
            onClick={() => {
              onClose();
              onQuickExport();
            }}
          >
            <Zap size={14} /> {t.libraryQuickExport}
          </button>
        </MenuPopover>
      )}
    </>
  );
}
