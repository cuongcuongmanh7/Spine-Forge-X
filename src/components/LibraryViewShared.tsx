import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Circle, MessageSquare } from 'lucide-react';
import type { LibraryEntry } from '../config';
import type { Translations } from '../i18n';
import { parseQuery } from '../library';
import type { EntryUsage, LibraryCleanStatus, LibraryThresholds } from '../library';
import type { useLibraryTags } from '../useLibraryTags';
import type { useLibraryDrive } from '../useLibraryDrive';

/** Shared types + render helpers for the Inventory views (table + grid), so both stay in sync. */

export const DAY_MS = 24 * 60 * 60 * 1000;

export type Section = { key: string; label: string; entries: LibraryEntry[]; mixedVersion: boolean };
export type SortKey = 'entry' | 'version' | 'spine' | 'images' | 'anims' | 'owner' | 'modified';
export type SortDirection = 'asc' | 'desc';
export type SortState = { key: SortKey; direction: SortDirection };

/**
 * Split a relative path into a shrinkable directory prefix and the file name. The name is rendered
 * separately so it stays fully visible while only the prefix gets ellipsized in a narrow column.
 */
export function splitRelPath(path: string): { dir: string; name: string } {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  const name = parts.length > 0 ? parts[parts.length - 1] : path;
  let dirs = parts.slice(0, -1);
  if (dirs.length > 2) dirs = ['...', ...dirs.slice(-2)];
  return { dir: dirs.length > 0 ? `${dirs.join('/')}/` : '', name };
}

/** The clean-scan status badge (clean / needs-review / never-scanned) for a row or card. */
export function cleanStatusIcon(status: LibraryCleanStatus, t: Translations): ReactNode {
  if (status === 'clean') {
    return (
      <span className="library-clean-icon" role="img" aria-label={t.libraryCleanCurrent} title={t.libraryCleanCurrent}>
        <CheckCircle2 size={14} />
      </span>
    );
  }
  if (status === 'warning') {
    return (
      <span className="library-clean-icon warning" role="img" aria-label={t.libraryCleanNeedsReview} title={t.libraryCleanNeedsReview}>
        <AlertTriangle size={14} />
      </span>
    );
  }
  return (
    <span className="library-clean-icon unknown" role="img" aria-label={t.libraryCleanUnknown} title={t.libraryCleanUnknown}>
      <Circle size={14} />
    </span>
  );
}

/** Dominant clean status for a folder group: all-clean → any-warning → any-unknown. */
export function sectionCleanStatus(
  entries: LibraryEntry[],
  cleanStatus: (entry: LibraryEntry) => LibraryCleanStatus
): LibraryCleanStatus | null {
  if (entries.length === 0) return null;
  if (entries.every((e) => cleanStatus(e) === 'clean')) return 'clean';
  if (entries.some((e) => cleanStatus(e) === 'warning')) return 'warning';
  if (entries.some((e) => cleanStatus(e) === 'unknown')) return 'unknown';
  return null;
}

/**
 * Notes badge/opener for a file row or folder header. Shows the open-note count when > 0 and is
 * always clickable to open the notes modal (so you can add the first note). `has-notes` styles it
 * as active; the row/section also gets `.library-has-notes` to tint it.
 */
export function NotesIndicator({
  count,
  onOpen,
  t
}: {
  count: number;
  onOpen: () => void;
  t: Translations;
}): ReactNode {
  return (
    <button
      type="button"
      className={`notes-indicator${count > 0 ? ' has-notes' : ''}`}
      title={t.notesOpenIndicator}
      aria-label={t.notesOpenIndicator}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      <MessageSquare size={12} />
      {count > 0 && <span>{count}</span>}
    </button>
  );
}

type TagsApi = ReturnType<typeof useLibraryTags>;
type DriveApi = ReturnType<typeof useLibraryDrive>;

/**
 * Everything a Inventory view (table or grid) needs to render. The host (LibraryInventory) owns the
 * single source of truth and passes the same bundle to whichever view is active — so tag/owner/drive
 * edits stay consistent across both layouts.
 */
export interface LibraryViewProps {
  t: Translations;
  sections: Section[];
  thresholds: LibraryThresholds;
  parsedQuery: ReturnType<typeof parseQuery>;
  collapsed: Set<string>;
  toggleCollapsed: (key: string) => void;
  expandedAnims: Set<string>;
  toggleAnim: (spineFile: string) => void;
  menuOpen: string | null;
  setMenuOpen: (value: string | null) => void;
  sort: SortState;
  toggleSort: (key: SortKey) => void;
  ariaSort: (key: SortKey) => 'ascending' | 'descending' | 'none';
  sortMark: (key: SortKey) => ReactNode;
  allCollapsed: boolean;
  toggleCollapseAll: () => void;
  usage: Map<string, EntryUsage>;
  usageTooltip: (spineFile: string) => string;
  goToSession: (sessionId: string) => void;
  metaFor: TagsApi['metaFor'];
  addEntryTag: TagsApi['addEntryTag'];
  removeEntryTag: TagsApi['removeEntryTag'];
  setEntryOwner: TagsApi['setEntryOwner'];
  /** Open notes for `key` (file relPath or `dir:`-folder key); `label` is the modal title target. */
  openNotes: (key: string, label: string) => void;
  /** Count of still-open notes for `key` — drives the indicator badge + row/section highlight. */
  unresolvedNotes: (key: string) => number;
  driveInfo: DriveApi['driveInfo'];
  expandedInfo: DriveApi['expandedInfo'];
  basicFor: DriveApi['basicFor'];
  toggleDriveInfo: DriveApi['toggleDriveInfo'];
  openRevisionInSpine: DriveApi['openRevisionInSpine'];
  cleanStatus: (entry: LibraryEntry) => LibraryCleanStatus;
  openFolder: (entry: LibraryEntry) => void;
  openInSpine: (entry: LibraryEntry) => void;
  createSessionForEntry: (entry: LibraryEntry) => void;
  createSessionForSection: (section: Section) => void;
  onPrepareCleanScan: (spineFiles: string[]) => void;
  onPreview: (entry: LibraryEntry) => void;
}
