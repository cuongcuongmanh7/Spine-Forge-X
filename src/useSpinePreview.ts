import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ExportAssets, LibraryEntry } from './config';

/**
 * Live skeleton preview for a Library unit's exported skeleton, rendered with the
 * official Spine web player. Resolves the export file set via `list_export_assets`,
 * feeds the bytes to the player as `rawDataURIs` (no network), and picks the runtime
 * by detected version: vendored 3.8 player (public/spine-player-3.8) vs the 4.x npm
 * package. Both are loaded lazily so the heavy runtime only ships when a preview opens.
 */

export type PreviewStatus = 'loading' | 'ready' | 'error';

/** Minimal shape shared by both runtime versions of SpinePlayer. */
type DisposablePlayer = { dispose: () => void };

const basename = (p: string): string => p.replace(/\\/g, '/').split('/').pop() ?? p;

// --- lazy runtime loaders (memoized so each runtime loads at most once) ---------

let spine38Promise: Promise<{ SpinePlayer: new (el: HTMLElement, cfg: unknown) => DisposablePlayer }> | null = null;

/** Load the vendored 3.8 player as a classic script — it sets the global `spine`. */
function loadSpine38(): Promise<{ SpinePlayer: new (el: HTMLElement, cfg: unknown) => DisposablePlayer }> {
  const existing = (window as unknown as { spine?: { SpinePlayer?: unknown } }).spine;
  if (existing?.SpinePlayer) return Promise.resolve(existing as never);
  if (spine38Promise) return spine38Promise;
  spine38Promise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-spine38]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/spine-player-3.8/spine-player.css';
      link.setAttribute('data-spine38', '');
      document.head.appendChild(link);
    }
    const script = document.createElement('script');
    script.src = '/spine-player-3.8/spine-player.js';
    script.onload = () => {
      const s = (window as unknown as { spine?: { SpinePlayer?: unknown } }).spine;
      if (s?.SpinePlayer) resolve(s as never);
      else reject(new Error('spine 3.8 runtime loaded but SpinePlayer is missing'));
    };
    script.onerror = () => reject(new Error('failed to load the vendored spine 3.8 runtime'));
    document.head.appendChild(script);
  });
  return spine38Promise;
}

let spine4Promise: Promise<typeof import('@esotericsoftware/spine-player')> | null = null;

/** Lazily import the 4.x npm player (keeps the runtime out of the main bundle). */
function loadSpine4(): Promise<typeof import('@esotericsoftware/spine-player')> {
  if (!spine4Promise) spine4Promise = import('@esotericsoftware/spine-player');
  return spine4Promise;
}

/** Read every export file into a `name → dataURI` map for the player to resolve locally. */
async function buildRawDataURIs(assets: ExportAssets): Promise<Record<string, string>> {
  const read = (path: string) => invoke<string>('read_file_data_url', { path });
  const entries = await Promise.all([
    read(assets.skeletonPath).then((uri) => [basename(assets.skeletonPath), uri] as const),
    read(assets.atlasPath).then((uri) => [basename(assets.atlasPath), uri] as const),
    ...assets.pages.map((page) => read(page.path).then((uri) => [page.name, uri] as const)),
  ]);
  return Object.fromEntries(entries);
}

export function useSpinePreview(entry: LibraryEntry | null, containerRef: React.RefObject<HTMLDivElement>) {
  const [status, setStatus] = useState<PreviewStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [assets, setAssets] = useState<ExportAssets | null>(null);
  const playerRef = useRef<DisposablePlayer | null>(null);

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    setStatus('loading');
    setError(null);
    setAssets(null);

    const fail = (msg: string) => {
      if (cancelled) return;
      setError(msg);
      setStatus('error');
    };

    (async () => {
      let resolved: ExportAssets;
      try {
        resolved = await invoke<ExportAssets>('list_export_assets', { folder: entry.folder });
      } catch (e) {
        fail(String(e));
        return;
      }
      if (cancelled) return;
      setAssets(resolved);

      let rawDataURIs: Record<string, string>;
      try {
        rawDataURIs = await buildRawDataURIs(resolved);
      } catch (e) {
        fail(String(e));
        return;
      }
      if (cancelled) return;

      const container = containerRef.current;
      if (!container) return;

      const skelName = basename(resolved.skeletonPath);
      const atlasName = basename(resolved.atlasPath);
      const onSuccess = () => {
        if (!cancelled) setStatus('ready');
      };
      const onError = (_p: unknown, msg: string) => fail(msg);

      try {
        if (resolved.version === '3.8') {
          const spine = await loadSpine38();
          if (cancelled) return;
          const cfg: Record<string, unknown> = {
            atlasUrl: atlasName,
            rawDataURIs,
            showControls: true,
            alpha: true,
            backgroundColor: '#00000000',
            success: onSuccess,
            error: onError,
          };
          cfg[resolved.skeletonFormat === 'json' ? 'jsonUrl' : 'skelUrl'] = skelName;
          playerRef.current = new spine.SpinePlayer(container, cfg);
        } else {
          const { SpinePlayer } = await loadSpine4();
          if (cancelled) return;
          playerRef.current = new SpinePlayer(container, {
            skeleton: skelName,
            atlas: atlasName,
            rawDataURIs,
            showControls: true,
            alpha: true,
            preserveDrawingBuffer: false,
            backgroundColor: '#00000000',
            success: onSuccess,
            error: onError,
          });
        }
      } catch (e) {
        fail(String(e));
      }
    })();

    return () => {
      cancelled = true;
      try {
        playerRef.current?.dispose();
      } catch {
        /* player may not have finished initializing */
      }
      playerRef.current = null;
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry]);

  return { status, error, assets };
}
