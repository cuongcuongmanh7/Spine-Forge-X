import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ExportAssets, LibraryEntry } from './config';
import { firebaseConfigured, getThumbDownloadUrl, uploadThumb } from './firebase';
import {
  type DisposablePlayer,
  type PreferredSetupPlayer,
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

const THUMB_W = 240;
const THUMB_H = 180;
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
 *      and ignores the atlas `pma` flag for blending, so 4.x straight-alpha exports had bright fringes. */
const THUMB_RENDER_VERSION = 7;

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

/** Mount the player off-screen, capture its canvas to a PNG data URL, then tear it down. */
async function renderThumbnail(assets: ExportAssets, rawDataURIs: Record<string, string>): Promise<string> {
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

      // Choose the skin/anim that actually has art (skin_default over an often-empty `default`),
      // matching the live preview, BEFORE capturing — otherwise many rigs thumbnail blank.
      const onSuccess = (player: unknown) => {
        try {
          applyPreferredSetup(player as PreferredSetupPlayer);
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
        // blank-capture guard then rejects — which is why 4.x thumbnails came out empty.
        viewport: { transitionTime: 0 },
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

    (async () => {
      // L1 — per-machine LOCAL disk cache (OS app-cache dir; no Drive mount, no network). Check first.
      try {
        const cached = await invoke<string | null>('thumb_cache_get', { key });
        if (cancelled) return;
        if (cached) {
          done(cached);
          return;
        }
      } catch {
        /* cache miss path below */
      }
      if (cancelled) return;

      // L2 — shared Cloud Storage (the cross-machine source of truth; works without Drive, and for a
      // future web/mobile client). On a hit, download the bytes into L1 (in Rust → no bucket CORS) so
      // the next view is an instant local read; fall back to the URL as an <img> src if that fails.
      if (firebaseConfigured()) {
        const remoteUrl = await getThumbDownloadUrl(key);
        if (cancelled) return;
        if (remoteUrl) {
          try {
            const localized = await invoke<string>('thumb_cache_fetch', { key, url: remoteUrl });
            if (cancelled) return;
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
          const assets = await invoke<ExportAssets>('list_export_assets', { folder });
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
        if (firebaseConfigured()) void uploadThumb(key, url).catch(() => undefined);
      } catch {
        fail();
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.relPath, entry?.spineBytes, entry?.version, entry?.exported, enabled]);

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
  useEffect(() => {
    if (!enabled || !firebaseConfigured()) return;
    const targets = entries.filter((e) => e.exported);
    if (targets.length === 0) return;
    let cancelled = false;

    const warmOne = async (entry: LibraryEntry) => {
      if (cancelled) return;
      const key = thumbKey(entry);
      try {
        const cached = await invoke<string | null>('thumb_cache_get', { key });
        if (cancelled || cached) return; // already local → nothing to pull
      } catch {
        /* treat as miss */
      }
      if (cancelled) return;
      const url = await getThumbDownloadUrl(key);
      if (cancelled || !url) return; // not on L2 yet → leave it to the lazy render path
      await invoke('thumb_cache_fetch', { key, url });
    };

    void runPool(targets, PREFETCH_CONCURRENCY, warmOne, () => cancelled);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, enabled]);
}
