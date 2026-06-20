import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ExportAssets, LibraryEntry } from './config';
import { type DisposablePlayer, basename, buildRawDataURIs, loadSpine38, loadSpine4 } from './spineRuntime';

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

/** Filesystem-safe cache key: a stable hash of the asset's identity. Re-export (new bytes)
 *  or an editor-version bump changes the key, so the old thumbnail is naturally superseded. */
function thumbKey(entry: LibraryEntry): string {
  const seed = `${entry.spineFile}|${entry.spineBytes}|${entry.version ?? ''}`;
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

      const common = {
        rawDataURIs,
        showControls: false,
        alpha: true,
        // Required so the drawing buffer survives compositing and toDataURL isn't blank.
        preserveDrawingBuffer: true,
        backgroundColor: '#00000000',
        success: capture,
        error: onError,
      };

      const mount = async () => {
        if (assets.version === '3.8') {
          const spine = await loadSpine38();
          const cfg: Record<string, unknown> = { ...common, atlasUrl: atlasName };
          cfg[assets.skeletonFormat === 'json' ? 'jsonUrl' : 'skelUrl'] = skelName;
          player = new spine.SpinePlayer(host, cfg);
        } else {
          const { SpinePlayer } = await loadSpine4();
          player = new SpinePlayer(host, { ...common, skeleton: skelName, atlas: atlasName });
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
      // Cache hit is cheap and shouldn't wait behind the render queue — check it first.
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

      // Everything expensive (asset reads + WebGL render) runs INSIDE the single-slot queue and
      // bails the moment the card has scrolled out of view — so fast scrolling past dozens of
      // cards doesn't flood IPC with base64 reads or churn through renders nobody is looking at.
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
        // Persist for next time; failures here are non-fatal (we already showed the image).
        void invoke('thumb_cache_put', { key, data: url }).catch(() => undefined);
      } catch {
        fail();
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.spineFile, entry?.spineBytes, entry?.version, entry?.exported, enabled]);

  return { status, dataUrl };
}
