import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  appendNotifications,
  changeToFeedItem,
  groupFeed,
  mergeFeed,
  subscribeNotificationFeed,
  subscribeNotificationReads,
  writeNotificationReads,
  type FeedItem,
  type NotifReads
} from './notifications';

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

// A notification as the bell renders it — either a single change or a bulk roll-up (count > 1). The
// bell renders the localized text from these fields at display time (so it follows the language).
// These are DERIVED (by `groupFeed`) from the shared feed; they are not what's stored.
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
  /** Folder the change happened in (Drive relPath, '/'-separated); common ancestor for a roll-up. */
  folder?: string;
  /** For click-to-locate in the Library (single tracked-file changes only). */
  relPath?: string;
  at: number;
  read: boolean;
};

// Local fallback (signed out / Firebase unconfigured): the same feed model, kept in localStorage so
// the bell still works offline. When signed in, the shared Firestore feed is the source of truth.
const KEY = 'spineforge.notifications.v2';

type LocalState = { items: FeedItem[]; reads: NotifReads };

function loadLocal(): LocalState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as Partial<LocalState>;
      return {
        items: Array.isArray(d.items) ? d.items : [],
        reads: { readAt: d.reads?.readAt ?? 0, clearedAt: d.reads?.clearedAt ?? 0 }
      };
    }
  } catch {
    /* fall through */
  }
  return { items: [], reads: { readAt: 0, clearedAt: 0 } };
}

function persistLocal(state: LocalState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* best-effort */
  }
}

type Args = {
  /** Signed-in Firebase uid — keys this user's read watermarks and gates the shared feed. When
   *  null we fall back to a localStorage-only feed (no cross-machine sync). */
  uid: string | null;
};

/**
 * App-level store for the notification bell. When signed in, it mirrors the shared team feed from
 * Firestore (so the same notifications appear on every machine) with per-user read state synced via
 * the `read_{uid}` doc. When signed out it degrades to a localStorage-only feed. Either way the bell
 * renders `notifications` (derived by `groupFeed`) and never sees the storage details.
 */
export function useDriveNotifications({ uid }: Args) {
  // Synced (Firestore) state.
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [reads, setReads] = useState<NotifReads>({ readAt: 0, clearedAt: 0 });
  // Local fallback state (only used when signed out).
  const [local, setLocal] = useState<LocalState>(loadLocal);

  const synced = Boolean(uid);
  const feedItemsRef = useRef(feedItems);
  feedItemsRef.current = feedItems;

  // Subscribe to the shared feed + this user's watermarks while signed in.
  useEffect(() => {
    if (!uid) {
      setFeedItems([]);
      setReads({ readAt: 0, clearedAt: 0 });
      return;
    }
    const unsubFeed = subscribeNotificationFeed(setFeedItems);
    const unsubReads = subscribeNotificationReads(uid, setReads);
    return () => {
      unsubFeed();
      unsubReads();
    };
  }, [uid]);

  const notifications = useMemo(
    () => (synced ? groupFeed(feedItems, reads) : groupFeed(local.items, local.reads)),
    [synced, feedItems, reads, local]
  );

  const addChanges = useCallback(
    (changes: DriveChange[]) => {
      if (!changes.length) return;
      const items = changes.map(changeToFeedItem);
      if (uid) {
        void appendNotifications(items); // feed subscription reflects it back
      } else {
        setLocal((prev) => {
          const next = { ...prev, items: mergeFeed(prev.items, items) };
          persistLocal(next);
          return next;
        });
      }
    },
    [uid]
  );

  const markAllRead = useCallback(() => {
    if (uid) {
      const maxAt = feedItemsRef.current.reduce((m, i) => Math.max(m, i.at), 0);
      const readAt = Math.max(Date.now(), maxAt);
      if (readAt > reads.readAt) void writeNotificationReads(uid, { readAt });
    } else {
      setLocal((prev) => {
        const maxAt = prev.items.reduce((m, i) => Math.max(m, i.at), 0);
        const readAt = Math.max(Date.now(), maxAt);
        if (readAt <= prev.reads.readAt) return prev;
        const next = { ...prev, reads: { ...prev.reads, readAt } };
        persistLocal(next);
        return next;
      });
    }
  }, [uid, reads.readAt]);

  const clearAll = useCallback(() => {
    // "Clear" hides the user's own view by advancing their watermark — it never deletes the shared
    // team history (another teammate may not have seen those changes yet).
    const clearedAt = Date.now();
    if (uid) {
      void writeNotificationReads(uid, { clearedAt });
    } else {
      setLocal((prev) => {
        const next = { ...prev, reads: { ...prev.reads, clearedAt } };
        persistLocal(next);
        return next;
      });
    }
  }, [uid]);

  const unreadCount = notifications.reduce((n, x) => (x.read ? n : n + 1), 0);

  return { notifications, unreadCount, addChanges, markAllRead, clearAll };
}
