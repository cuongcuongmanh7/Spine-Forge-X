// Diagnostics channel for the shared thumbnail cache (Cloud Storage "L2").
//
// The thumbnail pipeline deliberately SWALLOWS every L2 error so a failed upload/download never blocks
// the UI — a miss just falls back to a local render. The cost is that a real outage (expired auth, a
// storage-rule denial, a delinquent/closed billing account → HTTP 403) stays completely invisible: it
// looks identical to "nothing to sync". This bus surfaces those otherwise-silent failures to the
// in-app Log panel (release builds ship WITHOUT devtools, so `console` isn't reachable there) without
// threading a callback through every per-card thumbnail hook.
//
// Only anomalies are reported (per the product decision) — never per-card success noise. Identical
// (op, reason) pairs are logged at most once per session so a Library full of failing cards produces
// one line per distinct failure, not hundreds. See useSpineThumbnail.ts / firebase.ts for the call
// sites, and useWorkspace.ts for the subscriber that pipes these into the visible Log panel.

/** Which L2 operation failed. `download` also covers the metadata/getDownloadURL lookup. */
export type L2Op = 'upload' | 'download' | 'backfill';

export type L2Failure = { op: L2Op; reason: string };

type L2Sub = (ev: L2Failure) => void;

const subs = new Set<L2Sub>();
// (op|reason) pairs already surfaced this session — dedup so a bucket-wide outage logs once, not N×.
const logged = new Set<string>();

/** Best human-readable reason from a thrown value: a Firebase `StorageError.code`
 *  (e.g. `storage/unauthorized`), a Tauri invoke error string, or a plain message. */
function reasonOf(err: unknown): string {
  if (typeof err === 'string') return err;
  const e = err as { code?: unknown; message?: unknown };
  const code = typeof e?.code === 'string' ? e.code : '';
  const message = typeof e?.message === 'string' ? e.message : '';
  if (code) return message ? `${code} — ${message}` : code;
  if (message) return message;
  return String(err);
}

/** Subscribe to L2 failures (the workspace pipes these into the Log panel). Returns an unsubscribe. */
export function onL2Log(cb: L2Sub): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

/** Report a swallowed L2 failure. First occurrence of each (op, reason) reaches the Log panel and the
 *  console; repeats are dropped so failing cards don't flood the log. Safe to call from any catch. */
export function reportL2Failure(op: L2Op, err: unknown): void {
  const reason = reasonOf(err);
  const dedup = `${op}|${reason}`;
  if (logged.has(dedup)) return;
  logged.add(dedup);
  // Also emit to the console for dev/devtools builds; deduped alongside the panel line.
  console.warn(`[thumb-L2] ${op} failed:`, err);
  for (const cb of subs) cb({ op, reason });
}
