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

/**
 * Render `text` with every case-insensitive occurrence of the search term wrapped in a `<mark>`.
 * Only highlights when the term applies to the path/name facet (`scope` is `all` or `path`) — the
 * `anim:`/`skin:` scopes are already surfaced by the highlighted chips, so we leave the name/path
 * plain there. Returns the raw string (no markup) when there's nothing to highlight.
 */
export function HighlightText({
  text,
  parsedQuery
}: {
  text: string;
  parsedQuery: ReturnType<typeof parseQuery>;
}): ReactNode {
  const needle = parsedQuery.term.trim().toLowerCase();
  if (!needle || (parsedQuery.scope !== 'all' && parsedQuery.scope !== 'path')) return text;
  const lower = text.toLowerCase();
  if (!lower.includes(needle)) return text;
  const parts: ReactNode[] = [];
  let from = 0;
  let key = 0;
  for (let idx = lower.indexOf(needle); idx !== -1; idx = lower.indexOf(needle, from)) {
    if (idx > from) parts.push(text.slice(from, idx));
    parts.push(
      <mark className="library-hl" key={key++}>
        {text.slice(idx, idx + needle.length)}
      </mark>
    );
    from = idx + needle.length;
  }
  if (from < text.length) parts.push(text.slice(from));
  return <>{parts}</>;
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

/**
 * Folder/group select-all checkbox for a section header (shared by table + grid). Checked when every
 * entry in the group is selected, indeterminate when only some are; toggling adds/removes the whole
 * group. `stopPropagation` keeps a click from also toggling the section's collapse.
 */
export function GroupSelectCheckbox({
  entries,
  selected,
  setManySelected,
  t
}: {
  entries: LibraryEntry[];
  selected: Set<string>;
  setManySelected: (spineFiles: string[], on: boolean) => void;
  t: Translations;
}): ReactNode {
  const keys = entries.map((e) => e.spineFile);
  const all = keys.length > 0 && keys.every((k) => selected.has(k));
  const some = !all && keys.some((k) => selected.has(k));
  return (
    <label className="library-group-check" title={t.librarySelectAll} onClick={(e) => e.stopPropagation()}>
      <input
        type="checkbox"
        checked={all}
        ref={(el) => {
          if (el) el.indeterminate = some;
        }}
        onChange={() => setManySelected(keys, !all)}
        aria-label={t.librarySelectAll}
      />
    </label>
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
  /** Note count for `key` driving the badge + row/section highlight: open notes only, or all notes
   *  when the "show resolved" filter is on (host decides). */
  noteCount: (key: string) => number;
  basicFor: DriveApi['basicFor'];
  /** Open the standalone Drive owner/history modal for one entry (host renders the modal). */
  onDriveHistory: (entry: LibraryEntry) => void;
  cleanStatus: (entry: LibraryEntry) => LibraryCleanStatus;
  openFolder: (entry: LibraryEntry) => void;
  openInSpine: (entry: LibraryEntry) => void;
  createSessionForEntry: (entry: LibraryEntry) => void;
  createSessionForSection: (section: Section) => void;
  onPrepareCleanScan: (spineFiles: string[]) => void;
  onPreview: (entry: LibraryEntry) => void;
  /** Open the export health-check modal for one entry. */
  onHealthCheck: (entry: LibraryEntry) => void;
  /** Quick-export the given .spine files using the active session's preset + output. */
  onQuickExport: (spineFiles: string[]) => void;
  /** Disable Quick export while another run is in progress. */
  quickExportBusy: boolean;
  /** Move an entry to the library trash (hidden from inventory + scans until restored). */
  onMoveToTrash: (entry: LibraryEntry) => void;
  /** Move a whole folder group to trash. Only set under the "folder" facet (sections are folders
   *  there); the section menu hides the action when undefined. Receives the folder name (section key). */
  onMoveSectionToTrash?: (folderName: string) => void;
  /** Multi-select working set, keyed by `spineFile`. Drives the card/row checkbox + selected style. */
  selected: Set<string>;
  /** Toggle one entry's membership in the selection. */
  toggleSelected: (spineFile: string) => void;
  /** Add or remove a batch of entries from the selection (drives the folder/group select-all). */
  setManySelected: (spineFiles: string[], on: boolean) => void;
}
