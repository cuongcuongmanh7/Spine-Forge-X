import { describe, expect, it } from 'vitest';
import { changeToFeedItem, groupFeed, mergeFeed, type FeedItem } from './notifications';
import type { DriveChange } from './useDriveNotifications';

const change = (over: Partial<DriveChange> = {}): DriveChange => ({
  action: 'edit',
  kind: 'spine',
  relPath: 'Heroes/Knight/Knight.spine',
  actorName: 'Alice',
  actorEmail: 'alice@ondigames.com',
  time: '2026-06-24T10:00:00.000Z',
  ...over
});

describe('changeToFeedItem', () => {
  it('derives a deterministic id from time + path + action + actor (same on every machine)', () => {
    const a = changeToFeedItem(change());
    const b = changeToFeedItem(change()); // a second machine seeing the identical Drive change
    expect(a.id).toBe(b.id);
    expect(a.at).toBe(Date.parse('2026-06-24T10:00:00.000Z'));
  });

  it('distinguishes different changes (path / action / time)', () => {
    const base = changeToFeedItem(change()).id;
    expect(changeToFeedItem(change({ relPath: 'Heroes/Mage/Mage.spine' })).id).not.toBe(base);
    expect(changeToFeedItem(change({ action: 'delete' })).id).not.toBe(base);
    expect(changeToFeedItem(change({ time: '2026-06-24T11:00:00.000Z' })).id).not.toBe(base);
  });

  it('omits undefined fields (Firestore rejects them)', () => {
    const item = changeToFeedItem(change());
    expect('oldName' in item).toBe(false);
    expect(item.newName).toBeUndefined();
  });
});

describe('mergeFeed', () => {
  it('dedups by id so two machines reporting the same change collapse to one', () => {
    const one = changeToFeedItem(change());
    const merged = mergeFeed([one], [changeToFeedItem(change())]);
    expect(merged).toHaveLength(1);
  });

  it('keeps items newest-first', () => {
    const older = changeToFeedItem(change({ time: '2026-06-24T09:00:00.000Z', relPath: 'a/A.spine' }));
    const newer = changeToFeedItem(change({ time: '2026-06-24T10:00:00.000Z', relPath: 'b/B.spine' }));
    expect(mergeFeed([older], [newer])[0].id).toBe(newer.id);
  });
});

describe('groupFeed', () => {
  const items = (n: number): FeedItem[] =>
    Array.from({ length: n }, (_, i) =>
      changeToFeedItem(change({ action: 'delete', relPath: `Heroes/Pack/file${i}.spine`, time: `2026-06-24T10:00:0${i}.000Z` }))
    );

  it('rolls up more than the threshold of same-actor/action changes into one entry', () => {
    const out = groupFeed(items(5), { readAt: 0, clearedAt: 0 });
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(5);
    expect(out[0].folder).toBe('Heroes/Pack');
  });

  it('keeps small bursts as individual entries', () => {
    const out = groupFeed(items(2), { readAt: 0, clearedAt: 0 });
    expect(out).toHaveLength(2);
    expect(out.every((n) => n.count === 1)).toBe(true);
  });

  it('marks items at/older than readAt as read', () => {
    const list = items(2);
    const newest = Math.max(...list.map((i) => i.at));
    const out = groupFeed(list, { readAt: newest, clearedAt: 0 });
    expect(out.every((n) => n.read)).toBe(true);
  });

  it('hides items at/older than clearedAt', () => {
    const list = items(3); // times :00 :01 :02
    const newest = Math.max(...list.map((i) => i.at));
    const out = groupFeed(list, { readAt: 0, clearedAt: newest }); // clear up to the newest
    expect(out).toHaveLength(0);
  });
});
