import { useCallback, useState } from 'react';

// One classified change as emitted by the backend `drive-changes` event (see drive/changes.rs).
export type DriveChangeAction = 'edit' | 'rename' | 'add' | 'delete';

export type DriveChangeKind = 'spine' | 'image' | 'export';

export type DriveChange = {
  action: DriveChangeAction;
  kind: DriveChangeKind;
  relPath: string;
  oldName?: string | null;
  newName?: string | null;
  actorName?: string | null;
  actorEmail?: string | null;
  time?: string | null;
};

// A stored notification — either a single change or a bulk roll-up (count > 1). The bell renders
// the localized text from these fields at display time (so it follows the current language).
export type DriveNotification = {
  id: string;
  action: DriveChangeAction;
  kind: DriveChangeKind;
  actorName: string;
  actorEmail: string;
  /** >1 ⇒ bulk roll-up; 1 ⇒ a single file. */
  count: number;
  /** Single-file label (leaf name): the new name for add/edit/rename, the old name for delete. */
  name?: string;
  oldName?: string;
  newName?: string;
  /** Folder the change happened in (Drive relPath, '/'-separated). For a bulk roll-up it's the
   *  common ancestor folder of all affected files. Empty when it can't be determined. */
  folder?: string;
  /** For click-to-locate in the Library (single tracked-file changes only). */
  relPath?: string;
  at: number;
  read: boolean;
};

const KEY = 'spineforge.library.notifications';
const MAX = 20;
// More than this many same-actor + same-action changes in one batch collapse into a single
// "user A deleted 15 files" roll-up instead of spamming one notification per file.
const BULK_THRESHOLD = 3;

function loadStored(): DriveNotification[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DriveNotification[]) : [];
  } catch {
    return [];
  }
}

function persist(list: DriveNotification[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* best-effort */
  }
}

let seq = 0;
function makeId(): string {
  seq += 1;
  return `${Date.now()}-${seq}`;
}

/** Best single-file label for a change (the leaf name the user recognizes). Tracked deletes carry
 *  the name in oldName; untracked (image) deletes carry it in newName — fall back across both. */
function singleName(c: DriveChange): string | undefined {
  if (c.action === 'delete') return c.oldName ?? c.newName ?? undefined;
  return c.newName ?? c.oldName ?? undefined;
}

/** Folder segments of a relPath (everything before the filename). */
function folderSegs(relPath: string): string[] {
  return relPath.split('/').filter(Boolean).slice(0, -1);
}

/** Folder of a single change ('/'-separated). */
function folderOf(relPath: string): string {
  return folderSegs(relPath).join('/');
}

/** Deepest folder shared by all affected files — what a bulk roll-up shows. */
function commonFolder(relPaths: string[]): string {
  const all = relPaths.map(folderSegs);
  if (!all.length) return '';
  let prefix = all[0];
  for (const segs of all.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < segs.length && prefix[i] === segs[i]) i += 1;
    prefix = prefix.slice(0, i);
  }
  return prefix.join('/');
}

/**
 * App-level store for the notification bell: turns batches of Drive changes into notifications,
 * collapsing bursts by (actor, action), capping the list, and persisting across restarts.
 */
export function useDriveNotifications() {
  const [notifications, setNotifications] = useState<DriveNotification[]>(loadStored);

  const addChanges = useCallback((changes: DriveChange[]) => {
    if (!changes.length) return;
    // Group by who + what (incl. kind, so spine vs image never merge) → a burst becomes one roll-up.
    const groups = new Map<string, DriveChange[]>();
    for (const c of changes) {
      const key = `${c.actorEmail ?? ''}|${c.action}|${c.kind}`;
      const arr = groups.get(key);
      if (arr) arr.push(c);
      else groups.set(key, [c]);
    }

    const fresh: DriveNotification[] = [];
    for (const arr of groups.values()) {
      const first = arr[0];
      const actorName = first.actorName || first.actorEmail || '';
      const actorEmail = first.actorEmail ?? '';
      if (arr.length > BULK_THRESHOLD) {
        fresh.push({
          id: makeId(),
          action: first.action,
          kind: first.kind,
          actorName,
          actorEmail,
          count: arr.length,
          folder: commonFolder(arr.map((c) => c.relPath)),
          at: Date.now(),
          read: false
        });
      } else {
        for (const c of arr) {
          fresh.push({
            id: makeId(),
            action: c.action,
            kind: c.kind,
            actorName: c.actorName || c.actorEmail || '',
            actorEmail: c.actorEmail ?? '',
            count: 1,
            name: singleName(c),
            oldName: c.oldName ?? undefined,
            newName: c.newName ?? undefined,
            folder: folderOf(c.relPath),
            relPath: c.relPath,
            at: Date.now(),
            read: false
          });
        }
      }
    }
    if (!fresh.length) return;
    setNotifications((prev) => {
      const next = [...fresh, ...prev].slice(0, MAX); // newest first
      persist(next);
      return next;
    });
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => {
      if (prev.every((n) => n.read)) return prev;
      const next = prev.map((n) => ({ ...n, read: true }));
      persist(next);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    persist([]);
    setNotifications([]);
  }, []);

  const unreadCount = notifications.reduce((n, x) => (x.read ? n : n + 1), 0);

  return { notifications, unreadCount, addChanges, markAllRead, clearAll };
}
