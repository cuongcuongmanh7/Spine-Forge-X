// Shared Drive-change notification feed (the bell). Unlike the per-user workspace, this is a
// team-wide activity log living in Firestore so the SAME notifications surface on every machine —
// `envs/{env}/notifications/feed`. Each user's read/cleared watermarks live in their own
// `read_{uid}` doc so marking-read on one machine clears the badge on their others without touching
// anyone else's state. See docs/sync.md and firestore.rules ▸ notifications.
//
// Cross-machine dedup: any member's machine that detects a Drive change appends to the feed, so the
// same change can be reported by several machines. We give each change a DETERMINISTIC id (derived
// from the Drive change time + path + action + actor) and merge by id inside a transaction, so
// concurrent appends collapse to one item. The "N files" roll-up is therefore NOT baked into
// storage (batch boundaries differ per machine) — it's recomputed at display time by `groupFeed`.

import { onSnapshot, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore';
import { currentUid, envDoc, firebaseConfigured } from './firebase';
import type { DriveChange, DriveChangeAction, DriveChangeKind, DriveNotification } from './useDriveNotifications';

const SCHEMA = 1;
/** Cap the shared feed; a burst of single-file changes still rolls up at display time. */
const MAX_FEED = 100;
// More than this many adjacent same-actor + same-action changes collapse into one roll-up.
const BULK_THRESHOLD = 3;

/** One stored change in the shared feed. Deterministic `id` is the dedup key across machines;
 *  `at` is the Drive change time (also deterministic) so two machines produce identical ids. */
export type FeedItem = {
  id: string;
  action: DriveChangeAction;
  kind: DriveChangeKind;
  actorName: string;
  actorEmail: string;
  name?: string;
  oldName?: string;
  newName?: string;
  relPath?: string;
  at: number;
};

/** Per-user watermarks: unread = items newer than `readAt`; hidden = items at/older than `clearedAt`. */
export type NotifReads = { readAt: number; clearedAt: number };

// ---- pure helpers (also reused by the localStorage fallback in the hook) -----

function numOr0(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Drive change time (RFC3339) → epoch ms; 0 when absent so the id stays stable across machines. */
function changeTimeMs(c: DriveChange): number {
  const t = c.time ? Date.parse(c.time) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/** Best single-file label (the leaf the user recognizes). Deletes carry it in oldName, others newName. */
function singleName(c: DriveChange): string | undefined {
  if (c.action === 'delete') return c.oldName ?? c.newName ?? undefined;
  return c.newName ?? c.oldName ?? undefined;
}

function folderSegs(relPath: string): string[] {
  return relPath.split('/').filter(Boolean).slice(0, -1);
}

/** Folder of a single change ('/'-separated). */
function folderOf(relPath: string): string {
  return folderSegs(relPath).join('/');
}

/** Deepest folder shared by all affected files — what a roll-up shows. */
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

/** Drop undefined keys — Firestore rejects `undefined` values. */
function compact(item: FeedItem): FeedItem {
  const out = {} as Record<string, unknown>;
  for (const [k, v] of Object.entries(item)) if (v !== undefined) out[k] = v;
  return out as unknown as FeedItem;
}

/** A classified Drive change → a deterministic feed item (same on every machine that sees it). */
export function changeToFeedItem(c: DriveChange): FeedItem {
  const at = changeTimeMs(c);
  const actorEmail = c.actorEmail ?? '';
  return compact({
    id: `${at}|${c.action}|${c.kind}|${actorEmail}|${c.relPath}`,
    action: c.action,
    kind: c.kind,
    actorName: c.actorName || actorEmail || '',
    actorEmail,
    name: singleName(c),
    oldName: c.oldName ?? undefined,
    newName: c.newName ?? undefined,
    relPath: c.relPath,
    at
  });
}

/** Merge fresh items into an existing list by id (dedup), newest-first, capped to MAX_FEED. */
export function mergeFeed(existing: FeedItem[], fresh: FeedItem[]): FeedItem[] {
  const byId = new Map<string, FeedItem>();
  for (const it of existing) byId.set(it.id, it);
  for (const it of fresh) if (!byId.has(it.id)) byId.set(it.id, it);
  return Array.from(byId.values())
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_FEED);
}

/**
 * Collapse the raw feed into the notifications the bell renders: adjacent items sharing
 * (actor, action, kind) roll up into one "N files" entry past BULK_THRESHOLD; the rest stay
 * single. `read` is derived from the per-user `readAt`; items at/older than `clearedAt` are hidden.
 */
export function groupFeed(items: FeedItem[], reads: NotifReads): DriveNotification[] {
  const visible = items.filter((i) => i.at > reads.clearedAt).sort((a, b) => b.at - a.at);
  const out: DriveNotification[] = [];
  let i = 0;
  while (i < visible.length) {
    const first = visible[i];
    const key = `${first.actorEmail}|${first.action}|${first.kind}`;
    let j = i + 1;
    while (j < visible.length && `${visible[j].actorEmail}|${visible[j].action}|${visible[j].kind}` === key) j += 1;
    const group = visible.slice(i, j);
    if (group.length > BULK_THRESHOLD) {
      out.push({
        id: `bulk:${first.id}:${group.length}`,
        action: first.action,
        kind: first.kind,
        actorName: first.actorName,
        actorEmail: first.actorEmail,
        count: group.length,
        folder: commonFolder(group.map((g) => g.relPath ?? '')),
        at: group[0].at,
        read: group[0].at <= reads.readAt
      });
    } else {
      for (const g of group) {
        out.push({
          id: g.id,
          action: g.action,
          kind: g.kind,
          actorName: g.actorName,
          actorEmail: g.actorEmail,
          count: 1,
          name: g.name,
          oldName: g.oldName,
          newName: g.newName,
          folder: folderOf(g.relPath ?? ''),
          relPath: g.relPath,
          at: g.at,
          read: g.at <= reads.readAt
        });
      }
    }
    i = j;
  }
  return out;
}

// ---- Firestore IO -----------------------------------------------------------

function feedDoc() {
  return envDoc('notifications', 'feed');
}
function readsDoc(uid: string) {
  return envDoc('notifications', `read_${uid}`);
}

/** Validate the stored `items` field into typed FeedItems (tolerant of partial/legacy docs). */
function parseItems(raw: unknown): FeedItem[] {
  if (!Array.isArray(raw)) return [];
  const out: FeedItem[] = [];
  for (const r of raw) {
    if (r && typeof r === 'object' && typeof (r as FeedItem).id === 'string') out.push(r as FeedItem);
  }
  return out;
}

/** Append classified changes to the shared feed, merging by deterministic id (idempotent across
 *  machines). No-op when signed out / Firebase unconfigured (the hook falls back to localStorage). */
export async function appendNotifications(items: FeedItem[]): Promise<void> {
  if (!firebaseConfigured() || !currentUid() || !items.length) return;
  const ref = feedDoc();
  await runTransaction(ref.firestore, async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists() ? parseItems(snap.get('items')) : [];
    const merged = mergeFeed(existing, items);
    // Skip a no-op write (every fresh item was already present) to avoid a pointless updatedAt bump.
    if (snap.exists() && merged.length === existing.length && merged.every((m, i) => m.id === existing[i].id)) return;
    tx.set(ref, { schema: SCHEMA, items: merged.map(compact), updatedAt: serverTimestamp() });
  });
}

/** Live subscription to the shared feed. Emits `[]` when missing/unreadable. */
export function subscribeNotificationFeed(cb: (items: FeedItem[]) => void): () => void {
  return onSnapshot(
    feedDoc(),
    (snap) => cb(snap.exists() ? parseItems(snap.get('items')) : []),
    () => cb([])
  );
}

/** Live subscription to this user's read/cleared watermarks. */
export function subscribeNotificationReads(uid: string, cb: (reads: NotifReads) => void): () => void {
  return onSnapshot(
    readsDoc(uid),
    (snap) => cb({ readAt: numOr0(snap.exists() ? snap.get('readAt') : 0), clearedAt: numOr0(snap.exists() ? snap.get('clearedAt') : 0) }),
    () => cb({ readAt: 0, clearedAt: 0 })
  );
}

/** Patch this user's watermarks (merge — leaves the other field untouched). */
export async function writeNotificationReads(uid: string, patch: Partial<NotifReads>): Promise<void> {
  if (!firebaseConfigured()) return;
  await setDoc(readsDoc(uid), patch, { merge: true });
}
