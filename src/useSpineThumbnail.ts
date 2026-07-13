import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ExportAssets, LibraryEntry } from './config';
import {
  firebaseConfigured,
  getThumbDownloadUrl,
  getThumbSize,
  onFirebaseAuth,
  publishThumbCapture,
  subscribeThumbCaptures,
  uploadThumb
} from './firebase';
import { reportL2Failure } from './l2log';
import {
  type DisposablePlayer,
  type PreferredSetupPlayer,
  type ThumbPose,
  applyPose,
  applyPreferredSetup,
  basename,
  buildRawDataURIs,
  detectPremultipliedAlpha,
  loadSpine38,
  loadSpine4x,
} from './spineRuntime';

/**
 * Renders a small static thumbnail of a Library unit's exported skeleton for the grid
 * card, reusing the same runtime/asset pipeline as the live preview. The player is mounted
 * into an off-screen host with `preserveDrawingBuffer` so its canvas can be read back via
 * `toDataURL`, then disposed immediately. Results are cached on disk (thumb_cache_* Tauri
 * commands) keyed by file+size+version, so a thumbnail renders at most once per asset
 * revision and survives restarts.
 *
 * WebGL contexts are scarce (~16), so renders run through a single-slot queue: at most one
 * skeleton is mounted at a time and its context is released before the next starts.
 */

export type ThumbStatus = 'idle' | 'loading' | 'ready' | 'error';

export const THUMB_W = 240;
export const THUMB_H = 180;
const RENDER_TIMEOUT_MS = 8000;

/** Bumped whenever the thumbnail RENDERER changes in a way that should supersede every cached
 *  image (local L1 + shared L2), independent of the asset bytes. v2: prefer `skin_default` over an
 *  empty `default` skin so rigs that hid their art under `skin_default` stop thumbnailing blank.
 *  v3: load 4.2 exports with the matching 4.2 runtime (the 4.3 reader misaligned → blank/failed).
 *  v4: pick the skin with the most attachments (skin-folder rigs left `default` near-empty → blank).
 *  v5: frame instantly + hide the loading screen so the 4.x capture isn't an unframed blank.
 *  v6: detect straight-alpha (non-PMA) 3.8 exports so they don't render with bright fringes;
 *      also fixes 3.8 binary skeletons with non-ASCII names (signed-byte UTF-8 decode in the player).
 *  v7: pass the same straight-alpha hint to the 4.x player too — it defaults premultipliedAlpha=true
 *      and ignores the atlas `pma` flag for blending, so 4.x straight-alpha exports had bright fringes.
 *  v8: resolve shared-folder exports from the source `.spine` name instead of the folder name. */
const THUMB_RENDER_VERSION = 8;

/** Filesystem-safe cache key: a stable hash of the asset's identity. Uses the library-relative
 *  path (NOT the absolute path) so the key matches across machines sharing the same Drive folder.
 *  Re-export (new bytes), an editor-version bump, or a renderer-version bump changes the key,
 *  superseding the old thumbnail. */
export function thumbKey(entry: LibraryEntry): string {
  const seed = `${entry.relPath.replace(/\\/g, '/')}|${entry.spineBytes}|${entry.version ?? ''}|r${THUMB_RENDER_VERSION}`;
  // cyrb53 — small, fast, good-enough distribution for a cache key.
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

// --- L2 presence memo + legacy backfill ------------------------------------------------
// Which thumb keys THIS machine already knows live on shared Cloud Storage (L2). The backfill below
// checks L2 for every locally-cached thumbnail so images captured BEFORE cross-machine sync existed
// (they live only in each machine's L1) get pushed up and shared. Without this memo that existence
// check would be a network round-trip on every card view forever; we persist the confirmed set so
// each key is reconciled at most once per machine (uploaded, downloaded, or verified present).
const L2_PRESENT_KEY = 'spineforge.thumbL2Present';
const l2Present: Set<string> = (() => {
  try {
    const raw = localStorage.getItem(L2_PRESENT_KEY);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set<string>();
  }
})();
function markL2Present(key: string) {
  if (l2Present.has(key)) return;
  l2Present.add(key);
  try {
    localStorage.setItem(L2_PRESENT_KEY, JSON.stringify([...l2Present]));
  } catch {
    /* quota / private mode — the memo is a best-effort optimisation, safe to skip persisting */
  }
}

/** Decoded byte length of a `data:…;base64,…` URL, without allocating the bytes. */
function base64ByteLength(dataUrl: string): number {
  const b64 = dataUrl.split(',')[1] ?? '';
  if (!b64) return 0;
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/** Reconcile a locally-cached thumbnail with shared Cloud Storage. Runs from the L1-hit fast path
 *  (which otherwise returns before ever touching L2) and only when the registry doesn't already own
 *  this key. Three cases, in order:
 *   • WE hold a capture the registry doesn't know about (its upload/publish failed at capture time —
 *     offline / signed out / the billing outage — leaving a `syncedCaptures` marker but nothing on the
 *     cloud). FLUSH it up and announce it, and never let the auto-render reconciliation clobber it.
 *     This is authoritative: a local capture must win over whatever stale auto sits on L2.
 *   • L2 has nothing → PUSH our copy up (legacy/offline thumbnails that predate sync get shared).
 *   • L2 has a DIFFERENT image (different byte size ⇒ a divergent render, or a legacy capture with no
 *     registry entry made on ANOTHER machine) → PULL it down and adopt it, swapping the on-screen card.
 *     Same size ⇒ identical deterministic auto-render, leave L1 as-is.
 *  Fully background and best-effort; on failure we leave the key unmarked so a later view retries. */
async function backfillThumbToL2(key: string, dataUrl: string): Promise<void> {
  if (!firebaseConfigured()) return;
  try {
    // (1) A stranded local capture. `backfillThumbToL2` is only called when the registry lacks this
    // key, so a `syncedCaptures` marker here means WE captured it locally and it never reached the
    // cloud — flush it now (bypassing the l2Present memo, which a pre-capture auto view may have set).
    const myCapture = syncedCaptures()[key];
    if (myCapture != null) {
      await uploadThumb(key, dataUrl);
      await publishThumbCapture(key, myCapture);
      markL2Present(key);
      return;
    }
    if (l2Present.has(key)) return; // auto-render already reconciled with L2 on this machine
    const remoteSize = await getThumbSize(key);
    if (remoteSize == null) {
      await uploadThumb(key, dataUrl); // not on L2 yet → share ours
      markL2Present(key);
      return;
    }
    if (remoteSize !== base64ByteLength(dataUrl)) {
      // The shared copy differs from ours → adopt it (overwrites L1) and swap the visible card.
      const url = await getThumbDownloadUrl(key);
      if (url) {
        const localized = await invoke<string>('thumb_cache_fetch', { key, url });
        overrides.set(key, localized);
        notifyThumb(key);
      }
    }
    markL2Present(key); // reconciled — don't check again this machine
  } catch (e) {
    /* offline / transient → stay unmarked so the next view of this card retries; surface a real
       outage (auth/rules/billing) to the Log panel instead of leaving it silent */
    reportL2Failure('backfill', e);
  }
}

// --- manual captures: user-picked thumbnails from the live preview --------------------
// A user can frame a skeleton in the preview modal and "capture" it as the thumbnail. The captured
// image is keyed by the same `thumbKey`, so it overrides the auto-render everywhere. We keep it in a
// module map (so a card already on screen swaps instantly) AND persist it to the L1/L2 caches (so it
// survives a reload and reaches other machines).
const overrides = new Map<string, string>();
const overrideSubs = new Set<(key: string) => void>();
function notifyThumb(key: string) {
  for (const cb of overrideSubs) cb(key);
}

// --- shared capture registry: make a capture reach every machine, not just the one that made it ----
// A capture reuses the asset's content-addressed `thumbKey`, so a machine that already rendered+cached
// the auto thumbnail under that key would stay pinned to it forever — the L1 disk hit returns before
// L2 is ever consulted, and the key never changes (only a re-export/renderer bump changes it). The
// registry (Firestore, mirrored here) maps `thumbKey → captureId`; when it names a captureId this
// machine hasn't pulled yet, we bypass L1 and re-fetch the capture from Cloud Storage (L2). A
// per-machine `synced` record (localStorage) tracks the captureId whose bytes currently sit in L1, so
// we only re-pull when it actually changed — not on every registry emit.

const captureRegistry = new Map<string, string>();
type RegistrySub = (changed: Set<string>) => void;
const registrySubs = new Set<RegistrySub>();
let authWatchStarted = false;
let registryUnsub: (() => void) | null = null;

/** Replace the in-memory registry with a fresh snapshot, then notify subscribers with the set of keys
 *  whose captureId changed (added / removed / different) so only affected cards re-pull. */
function applyRegistrySnapshot(map: Record<string, string>): void {
  const changed = new Set<string>();
  for (const [k, v] of Object.entries(map)) if (captureRegistry.get(k) !== v) changed.add(k);
  for (const k of captureRegistry.keys()) if (!(k in map)) changed.add(k);
  captureRegistry.clear();
  for (const [k, v] of Object.entries(map)) captureRegistry.set(k, v);
  for (const cb of registrySubs) cb(changed);
}

/** Watch the capture registry (idempotent). The registry is `onSnapshot`-backed, and Firestore
 *  TERMINATES a listener that hits `permission-denied` — e.g. one attached before the Firebase session
 *  is ready on a cold launch — and NEVER retries it. Subscribing once on mount therefore dies silently
 *  for the whole session, so no capture is ever pulled and every machine stays pinned to its cached
 *  auto-render. Instead we watch auth and (re)attach the listener each time a session appears, dropping
 *  it on sign-out — mirroring how `subscribeLeaderEmails` re-subscribes on uid. */
function ensureCaptureRegistry(): void {
  if (authWatchStarted || !firebaseConfigured()) return;
  authWatchStarted = true;
  onFirebaseAuth((user) => {
    if (user && !registryUnsub) {
      registryUnsub = subscribeThumbCaptures(applyRegistrySnapshot);
    } else if (!user && registryUnsub) {
      registryUnsub();
      registryUnsub = null;
      applyRegistrySnapshot({}); // signed out → can't read L2 anyway; drop stale entries
    }
  });
}

// Per-machine record of which captureId's bytes are in L1, mirrored to localStorage so it survives a
// reload. Cached in-memory to avoid re-parsing JSON on every card.
const SYNCED_STORE_KEY = 'sfx.thumbCaptures.synced';
let syncedCache: Record<string, string> | null = null;
function syncedCaptures(): Record<string, string> {
  if (!syncedCache) {
    try {
      syncedCache = JSON.parse(localStorage.getItem(SYNCED_STORE_KEY) ?? '{}') as Record<string, string>;
    } catch {
      syncedCache = {};
    }
  }
  return syncedCache;
}
function markCaptureSynced(key: string, captureId: string): void {
  const store = syncedCaptures();
  store[key] = captureId;
  try {
    localStorage.setItem(SYNCED_STORE_KEY, JSON.stringify(store));
  } catch {
    /* storage quota — the in-memory copy still prevents redundant re-pulls this session */
  }
}
/** True when the registry names a capture for `key` that this machine hasn't pulled into L1 yet — i.e.
 *  the L1 image (if any) is stale and must be re-fetched from L2. */
function captureIsStale(key: string): boolean {
  const want = captureRegistry.get(key);
  return want != null && syncedCaptures()[key] !== want;
}

function newCaptureId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Re-render an entry's thumbnail off-screen (the proven capture pipeline) framed to `viewport` —
 *  used by the preview modal's "capture" button. Reading the on-screen preview canvas back is
 *  unreliable in WebView2 (the drawing buffer isn't preserved for reads outside the render loop, so
 *  toDataURL comes back blank); an off-screen render with the same camera box is not. */
export async function renderFramedThumbnail(
  assets: ExportAssets,
  rawDataURIs: Record<string, string>,
  viewport?: ThumbViewport,
  pose?: ThumbPose
): Promise<string> {
  return enqueue(() => renderThumbnail(assets, rawDataURIs, viewport, pose));
}

/** Replace an entry's thumbnail with a user-captured image: update on-screen cards immediately, then
 *  persist to the local disk cache (L1) and share to Cloud Storage (L2, best-effort). Rejects a
 *  blank/transparent capture (e.g. a WebGL context that didn't preserve its drawing buffer) so we
 *  never cache — or falsely report success for — an empty thumbnail. */
export async function setCapturedThumbnail(entry: LibraryEntry, dataUrl: string): Promise<void> {
  // A blank 240×180 PNG compresses to a few hundred bytes; a real capture is far larger.
  if ((dataUrl.split(',')[1] ?? '').length < 1000) throw new Error('blank thumbnail capture');
  const key = thumbKey(entry);
  overrides.set(key, dataUrl);
  notifyThumb(key);
  await invoke('thumb_cache_put', { key, data: dataUrl });
  if (firebaseConfigured()) {
    // This machine holds these exact bytes in L1, so record them as synced up-front — even if the
    // upload below fails offline, we must not later re-pull our own capture over the top of itself.
    const captureId = newCaptureId();
    markCaptureSynced(key, captureId);
    // Best-effort, fire-and-forget so the capture toast stays instant. Upload the PNG to L2 FIRST,
    // then announce it in the registry — so by the time a teammate sees the captureId, the object it
    // points at already exists (otherwise their download misses and they'd fall back to auto-render).
    void (async () => {
      try {
        await uploadThumb(key, dataUrl);
        markL2Present(key); // now on L2 → the legacy backfill never needs to touch this key
        await publishThumbCapture(key, captureId);
      } catch (e) {
        /* offline / signed out → capture stays local; re-announced on the next capture or reconnect */
        reportL2Failure('upload', e);
      }
    })();
  }
}

// --- single-slot render queue: one live WebGL context at a time ------------------
let chain: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run as Promise<T>;
}

/** Yield to the browser before the next queued render so scrolling stays smooth — the heavy
 *  WebGL work waits for an idle slot instead of running back-to-back on the main thread. */
function idle(): Promise<void> {
  return new Promise((resolve) => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void })
      .requestIdleCallback;
    if (ric) ric(() => resolve(), { timeout: 500 });
    else setTimeout(resolve, 32);
  });
}

/** A camera framing box (world units) to reproduce in an off-screen render — the live preview's
 *  `currentViewport`, so a user "capture" thumbnails exactly the pose/zoom/pan they framed. */
export type ThumbViewport = {
  x: number;
  y: number;
  width: number;
  height: number;
  padLeft?: number;
  padRight?: number;
  padTop?: number;
  padBottom?: number;
};

/** Mount the player off-screen, capture its canvas to a PNG data URL, then tear it down. When a
 *  `viewport` is given, frame that exact box instead of auto-fitting the skeleton; when a `pose` is
 *  given, reproduce that exact skin/animation/time instead of the default preferred setup. */
async function renderThumbnail(
  assets: ExportAssets,
  rawDataURIs: Record<string, string>,
  viewport?: ThumbViewport,
  pose?: ThumbPose
): Promise<string> {
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${THUMB_W}px;height:${THUMB_H}px;pointer-events:none;opacity:0;`;
  document.body.appendChild(host);
  const skelName = basename(assets.skeletonPath);
  const atlasName = basename(assets.atlasPath);
  let player: DisposablePlayer | null = null;

  try {
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('thumbnail render timed out')), RENDER_TIMEOUT_MS);
      const settle = (fn: () => void) => {
        clearTimeout(timer);
        fn();
      };
      // Capture after two frames so the first skeleton draw has landed in the buffer.
      const capture = () =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const canvas = host.querySelector('canvas');
            if (!canvas) {
              settle(() => reject(new Error('no canvas after render')));
              return;
            }
            try {
              const url = canvas.toDataURL('image/png');
              // A blank/transparent capture (e.g. a runtime that ignores preserveDrawingBuffer)
              // compresses to a tiny PNG; treat that as a failure so we never cache an empty thumb.
              const payload = url.split(',')[1] ?? '';
              if (payload.length < 1000) {
                settle(() => reject(new Error('empty thumbnail capture')));
                return;
              }
              settle(() => resolve(url));
            } catch (e) {
              settle(() => reject(e instanceof Error ? e : new Error(String(e))));
            }
          })
        );
      const onError = (_p: unknown, msg: string) => settle(() => reject(new Error(msg || 'spine player error')));

      // Reproduce the requested pose (a user capture) if given; otherwise choose the skin/anim that
      // actually has art (matching the live preview), BEFORE capturing — else many rigs thumbnail blank.
      const onSuccess = (player: unknown) => {
        try {
          if (pose?.animation) applyPose(player as Parameters<typeof applyPose>[0], pose);
          else applyPreferredSetup(player as PreferredSetupPlayer);
        } catch {
          /* minimal skeletons may lack named skins/anims — keep the player's defaults */
        }
        capture();
      };

      const common = {
        rawDataURIs,
        showControls: false,
        // No loading-screen spinner — it would composite over the skeleton in the capture.
        showLoading: false,
        alpha: true,
        // Required so the drawing buffer survives compositing and toDataURL isn't blank.
        preserveDrawingBuffer: true,
        // Frame the skeleton INSTANTLY. The 4.x player otherwise animates the camera to fit over
        // ~0.25s, so a capture two frames after load grabs an unframed (near-empty) canvas that the
        // blank-capture guard then rejects — which is why 4.x thumbnails came out empty. A supplied
        // `viewport` reproduces the live preview's exact framing (a user-captured thumbnail).
        viewport: { transitionTime: 0, ...(viewport ?? {}) },
        backgroundColor: '#00000000',
        success: onSuccess,
        error: onError,
      };

      const mount = async () => {
        // Match the live preview: BOTH runtimes blend with `premultipliedAlpha` (default true) and
        // upload the texture un-premultiplied, so a straight-alpha export needs the detected hint or
        // it renders with bright fringes. The 4.x player ignores the atlas `pma` flag for blending.
        const premultipliedAlpha = await detectPremultipliedAlpha(assets, rawDataURIs);
        if (assets.version === '3.8') {
          const spine = await loadSpine38();
          const cfg: Record<string, unknown> = { ...common, atlasUrl: atlasName, premultipliedAlpha };
          cfg[assets.skeletonFormat === 'json' ? 'jsonUrl' : 'skelUrl'] = skelName;
          player = new spine.SpinePlayer(host, cfg);
        } else {
          const { SpinePlayer } = await loadSpine4x(assets.version);
          // `premultipliedAlpha` is a real runtime config field (Player.js reads it) the 4.x .d.ts omits.
          const cfg4x = { ...common, skeleton: skelName, atlas: atlasName, premultipliedAlpha } as unknown;
          player = new SpinePlayer(host, cfg4x as ConstructorParameters<typeof SpinePlayer>[1]);
        }
      };
      mount().catch((e) => settle(() => reject(e instanceof Error ? e : new Error(String(e)))));
    });
  } finally {
    // `player` is only assigned inside async callbacks, so TS narrows it to `never` here;
    // cast back to the real type to release the WebGL context.
    const p = player as DisposablePlayer | null;
    try {
      p?.dispose();
    } catch {
      /* player may not have finished initializing */
    }
    host.remove();
  }
}

export function useSpineThumbnail(entry: LibraryEntry | null, enabled: boolean) {
  const [status, setStatus] = useState<ThumbStatus>('idle');
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  // Bumps when a capture for THIS entry's key appears/changes in the shared registry, re-running the
  // loader below so a teammate's capture reaches this already-open card (not just on next Library open).
  const [registryTick, setRegistryTick] = useState(0);

  useEffect(() => {
    ensureCaptureRegistry();
    const onReg: RegistrySub = (changed) => {
      if (entry && changed.has(thumbKey(entry))) setRegistryTick((n) => n + 1);
    };
    registrySubs.add(onReg);
    return () => {
      registrySubs.delete(onReg);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.relPath, entry?.spineBytes, entry?.version]);

  useEffect(() => {
    if (!enabled || !entry || !entry.exported) {
      setStatus('idle');
      return;
    }
    let cancelled = false;
    const key = thumbKey(entry);
    setStatus('loading');
    setDataUrl(null);

    const fail = () => {
      if (!cancelled) setStatus('error');
    };
    const done = (url: string) => {
      if (cancelled) return;
      setDataUrl(url);
      setStatus('ready');
    };

    const folder = entry.folder;
    const spineFile = entry.spineFile;

    (async () => {
      // A user-captured thumbnail (this session) wins over everything — show it without any IPC.
      const override = overrides.get(key);
      if (override) {
        done(override);
        return;
      }

      // Does the shared registry name a capture this machine hasn't pulled yet? If so the L1 image is
      // stale (an older auto-render or capture) and we skip straight to L2 to fetch the current one.
      const wantCapture = captureRegistry.get(key);
      const staleL1 = captureIsStale(key);

      // L1 — per-machine LOCAL disk cache (OS app-cache dir; no Drive mount, no network). Check first,
      // unless a newer capture is announced (then L1 is known-stale and we must re-pull from L2).
      if (!staleL1) {
        try {
          const cached = await invoke<string | null>('thumb_cache_get', { key });
          if (cancelled) return;
          if (cached) {
            done(cached);
            // Legacy backfill: this thumbnail sits on our disk but may predate sync (or was rendered
            // offline/logged out) and never reached L2. Push it up (once per key) so other machines
            // share it — but only for a plain auto thumbnail; when the registry owns this key the
            // capture flow handles L2, so we leave it alone.
            if (!captureRegistry.has(key)) void backfillThumbToL2(key, cached);
            return;
          }
        } catch {
          /* cache miss path below */
        }
      }
      if (cancelled) return;

      // L2 — shared Cloud Storage (the cross-machine source of truth; works without Drive, and for a
      // future web/mobile client). On a hit, download the bytes into L1 (in Rust → no bucket CORS) so
      // the next view is an instant local read; fall back to the URL as an <img> src if that fails.
      if (firebaseConfigured()) {
        const remoteUrl = await getThumbDownloadUrl(key);
        if (cancelled) return;
        if (remoteUrl) {
          markL2Present(key); // confirmed on L2 → skip the backfill existence-check next time
          try {
            const localized = await invoke<string>('thumb_cache_fetch', { key, url: remoteUrl });
            if (cancelled) return;
            // The bytes we just pulled ARE the announced capture — record it so we don't re-pull it.
            if (wantCapture != null) markCaptureSynced(key, wantCapture);
            done(localized);
          } catch {
            if (cancelled) return;
            done(remoteUrl);
          }
          return;
        }
      }
      if (cancelled) return;

      // Miss everywhere → render. Everything expensive (asset reads + WebGL render) runs INSIDE the
      // single-slot queue and bails the moment the card has scrolled out of view — so fast scrolling
      // past dozens of cards doesn't flood IPC with base64 reads or churn through renders nobody is
      // looking at.
      try {
        const url = await enqueue(async () => {
          if (cancelled) return null;
          await idle();
          if (cancelled) return null;
          const assets = await invoke<ExportAssets>('list_export_assets', { folder, spineFile });
          if (cancelled) return null;
          const raw = await buildRawDataURIs(assets);
          if (cancelled) return null;
          return renderThumbnail(assets, raw);
        });
        if (cancelled || url == null) return;
        done(url);
        // Persist to the local disk cache for next time; non-fatal (we already showed the image).
        void invoke('thumb_cache_put', { key, data: url }).catch(() => undefined);
        // Share with the team so other machines skip the render. Best-effort (offline → skipped).
        // Skip when the registry says this key carries a user capture whose PNG just hasn't reached
        // L2 yet (a brief announce-before-upload race) — else we'd overwrite the capture with an auto.
        if (firebaseConfigured() && !captureRegistry.has(key))
          void uploadThumb(key, url)
            .then(() => markL2Present(key))
            .catch((e) => reportL2Failure('upload', e));
      } catch {
        fail();
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.relPath, entry?.spineBytes, entry?.version, entry?.exported, enabled, registryTick]);

  // Swap to a freshly captured thumbnail the instant it's set (same-session), without re-fetching.
  useEffect(() => {
    if (!entry) return;
    const key = thumbKey(entry);
    const onUpdate = (changed: string) => {
      if (changed !== key) return;
      const url = overrides.get(key);
      if (url) {
        setDataUrl(url);
        setStatus('ready');
      }
    };
    overrideSubs.add(onUpdate);
    return () => {
      overrideSubs.delete(onUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.relPath, entry?.spineBytes, entry?.version]);

  return { status, dataUrl };
}

// --- parallel prefetch: warm the local cache from Cloud Storage on Library open -----------------
const PREFETCH_CONCURRENCY = 8;

/** Run `worker` over `items` with at most `limit` in flight; best-effort, bails when cancelled. */
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>, cancelled: () => boolean) {
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length && !cancelled()) {
      const item = items[i++];
      try {
        await worker(item);
      } catch {
        /* best effort — a single failure shouldn't stall the pool */
      }
    }
  });
  await Promise.all(runners);
}

/**
 * Prefetch thumbnails into the per-machine L1 disk cache in parallel when the Library grid opens,
 * instead of waiting for each card to scroll into view and fetch serially. Only PULLS already-shared
 * thumbnails from Cloud Storage (L2) — it never renders (WebGL contexts are scarce; cards that miss
 * L2 are rendered lazily by `useSpineThumbnail` when shown). Bounded concurrency keeps it background.
 */
export function useThumbnailWarm(entries: LibraryEntry[], enabled: boolean) {
  // Re-warm only when the actual set changes (not on every render / unrelated state churn). Keys
  // fold in size+version, so a re-export (new key) re-warms; a pure re-render does not.
  const signature = enabled ? entries.filter((e) => e.exported).map(thumbKey).join('|') : '';
  // Re-run the warm pass when the shared capture registry changes so a teammate's new capture is
  // pulled proactively (visible cards also react via useSpineThumbnail; this covers the rest).
  const [registryVersion, setRegistryVersion] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    ensureCaptureRegistry();
    const onReg: RegistrySub = () => setRegistryVersion((n) => n + 1);
    registrySubs.add(onReg);
    return () => {
      registrySubs.delete(onReg);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !firebaseConfigured()) return;
    const targets = entries.filter((e) => e.exported);
    if (targets.length === 0) return;
    let cancelled = false;

    const warmOne = async (entry: LibraryEntry) => {
      if (cancelled) return;
      const key = thumbKey(entry);
      const wantCapture = captureRegistry.get(key);
      // Skip the L1 short-circuit when a newer capture is announced — that image is stale and must be
      // re-pulled from L2 even though a (stale) copy is already on disk.
      if (!captureIsStale(key)) {
        try {
          const cached = await invoke<string | null>('thumb_cache_get', { key });
          if (cancelled) return;
          if (cached) {
            // Already local & current. May be a legacy/offline auto thumb that never reached L2 →
            // backfill (once per key) so it's shared; registry-owned keys are handled by capture flow.
            if (!captureRegistry.has(key)) void backfillThumbToL2(key, cached);
            return; // nothing to pull down
          }
        } catch {
          /* treat as miss */
        }
      }
      if (cancelled) return;
      const url = await getThumbDownloadUrl(key);
      if (cancelled || !url) return; // not on L2 yet → leave it to the lazy render path
      markL2Present(key); // confirmed on L2 (and about to be in L1 too)
      await invoke('thumb_cache_fetch', { key, url });
      if (wantCapture != null) markCaptureSynced(key, wantCapture);
    };

    void runPool(targets, PREFETCH_CONCURRENCY, warmOne, () => cancelled);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, enabled, registryVersion]);
}
