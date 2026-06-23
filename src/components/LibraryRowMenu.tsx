import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FolderOpen, FolderPlus, History, ListChecks, MoreHorizontal, Stethoscope, Zap } from 'lucide-react';
import type { Translations } from '../i18n';
import type { LibraryEntry } from '../config';
import { SpineFileIcon } from './SpineFileIcon';

/** Renders the dropdown in a body portal, fixed-positioned under (or above) its anchor. This
 *  escapes the scroll container's `overflow` clipping so the menu floats over the rest of the
 *  app — including the bottom bar — instead of being cut off on the last rows. */
function MenuPopover({ anchor, onClose, children }: { anchor: HTMLElement | null; onClose: () => void; children: ReactNode }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const menu = menuRef.current;
      const mw = menu?.offsetWidth ?? 168;
      const mh = menu?.offsetHeight ?? 0;
      const gap = 4;
      const margin = 8;
      // Default below the trigger; flip above if it would overflow the viewport bottom.
      let top = a.bottom + gap;
      if (mh && top + mh > window.innerHeight - margin) {
        top = Math.max(margin, a.top - gap - mh);
      }
      // Right-align to the trigger, clamped to the viewport.
      let left = a.right - mw;
      left = Math.min(Math.max(margin, left), window.innerWidth - mw - margin);
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor]);

  return createPortal(
    <>
      <div
        className="menu-backdrop"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      />
      <div
        ref={menuRef}
        className="session-menu library-row-menu library-row-menu--portal"
        style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>,
    document.body
  );
}

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
