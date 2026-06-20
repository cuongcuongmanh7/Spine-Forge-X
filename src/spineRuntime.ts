import { invoke } from '@tauri-apps/api/core';
import type { ExportAssets } from './config';

/**
 * Shared Spine web-player runtime loaders + asset plumbing, used by both the live
 * preview modal ({@link import('./useSpinePreview')}) and the grid thumbnail renderer
 * ({@link import('./useSpineThumbnail')}). Version-picks the runtime — vendored 3.8 player
 * (public/spine-player-3.8) vs the 4.x npm package — and both are loaded lazily so the heavy
 * runtime only ships when something actually previews.
 */

/** Minimal shape shared by both runtime versions of SpinePlayer. */
export type DisposablePlayer = { dispose: () => void };

export const basename = (p: string): string => p.replace(/\\/g, '/').split('/').pop() ?? p;

// --- lazy runtime loaders (memoized so each runtime loads at most once) ---------

let spine38Promise: Promise<{ SpinePlayer: new (el: HTMLElement, cfg: unknown) => DisposablePlayer }> | null = null;

/** Load the vendored 3.8 player as a classic script — it sets the global `spine`. */
export function loadSpine38(): Promise<{ SpinePlayer: new (el: HTMLElement, cfg: unknown) => DisposablePlayer }> {
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
export function loadSpine4(): Promise<typeof import('@esotericsoftware/spine-player')> {
  if (!spine4Promise) spine4Promise = import('@esotericsoftware/spine-player');
  return spine4Promise;
}

/** Read every export file into a `name → dataURI` map for the player to resolve locally. */
export async function buildRawDataURIs(assets: ExportAssets): Promise<Record<string, string>> {
  const read = (path: string) => invoke<string>('read_file_data_url', { path });
  const entries = await Promise.all([
    read(assets.skeletonPath).then((uri) => [basename(assets.skeletonPath), uri] as const),
    read(assets.atlasPath).then((uri) => [basename(assets.atlasPath), uri] as const),
    ...assets.pages.map((page) => read(page.path).then((uri) => [page.name, uri] as const)),
  ]);
  return Object.fromEntries(entries);
}
