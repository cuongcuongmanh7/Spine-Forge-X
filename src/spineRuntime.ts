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

/** Lazily import the latest bundled 4.x npm player (4.3). */
export function loadSpine4(): Promise<typeof import('@esotericsoftware/spine-player')> {
  if (!spine4Promise) spine4Promise = import('@esotericsoftware/spine-player');
  return spine4Promise;
}

let spine42Promise: Promise<typeof import('@esotericsoftware/spine-player')> | null = null;

/** Lazily import the 4.2 player (npm alias) — its binary/JSON format differs from 4.3. */
export function loadSpine42(): Promise<typeof import('@esotericsoftware/spine-player')> {
  if (!spine42Promise) spine42Promise = import('spine-player-42');
  return spine42Promise;
}

/**
 * Pick the 4.x player whose format matches the skeleton's minor version. Spine runtimes are not
 * cross-minor compatible: a 4.2 export read by the 4.3 reader misaligns ("Bone name must not be
 * null"). `version` here is the runtime key from `list_export_assets` ("4.2", "4.3", "4.x").
 */
export function loadSpine4x(version: string | null): Promise<typeof import('@esotericsoftware/spine-player')> {
  return version === '4.2' ? loadSpine42() : loadSpine4();
}

/** A skin as seen on either runtime: a name plus the per-slot attachment maps we count. */
type SkinLike = { name: string; attachments?: unknown };

/** Minimal version-agnostic player surface needed to choose a skin + starting animation. */
export type PreferredSetupPlayer = {
  skeleton?: {
    data?: { skins?: SkinLike[]; animations?: { name: string; duration: number }[] };
    setSkinByName?: (name: string) => void;
    setSlotsToSetupPose?: () => void;
  } | null;
  animationState?: { setAnimation?: (track: number, name: string, loop: boolean) => unknown } | null;
  setAnimation?: (name: string, loop?: boolean) => unknown;
};

/** How many attachments a skin defines, across both runtimes (`attachments` is a per-slot array
 *  of `{ name → attachment }` maps on 3.8 and 4.x alike). Used to find the skin with real art. */
function skinAttachmentCount(skin: SkinLike): number {
  const a = skin.attachments;
  if (!Array.isArray(a)) return 0;
  let n = 0;
  for (const slot of a) {
    if (!slot) continue;
    n += slot instanceof Map ? slot.size : Object.keys(slot as object).length;
  }
  return n;
}

/**
 * Pick the skin most likely to actually show the rig's art: the one with the most attachments.
 * Plain name priority (`skin_default` → `default` → first) is wrong for two common patterns — an
 * EMPTY `default` skin with the art under `skin_default`, and "skin-folder" rigs (`A/Body_0`, …)
 * where `default` holds almost nothing and each costume part is its own skin. Counting attachments
 * covers both; we fall back to name priority only when no skin reports any (no count info).
 */
function pickPreferredSkin(skins: SkinLike[]): string | undefined {
  if (skins.length === 0) return undefined;
  const names = skins.map((s) => s.name);
  const byName = names.includes('skin_default') ? 'skin_default' : names.includes('default') ? 'default' : names[0];
  let best = byName;
  let bestCount = 0;
  for (const s of skins) {
    const c = skinAttachmentCount(s);
    if (c > bestCount) {
      bestCount = c;
      best = s.name;
    }
  }
  return bestCount > 0 ? best : byName;
}

/**
 * Pick the most representative skin + animation and apply them to a freshly loaded player.
 * Skin is chosen by attachment count (see {@link pickPreferredSkin}); animation priority is
 * `idle` → first.
 *
 * Shared by the live preview and the grid thumbnail so both frame the asset identically.
 */
export function applyPreferredSetup(player: PreferredSetupPlayer): void {
  const data = player.skeleton?.data;

  const skin = pickPreferredSkin(data?.skins ?? []);
  if (skin && player.skeleton?.setSkinByName) {
    player.skeleton.setSkinByName(skin);
    player.skeleton.setSlotsToSetupPose?.();
  }

  const anims = (data?.animations ?? []).map((a) => a.name);
  const anim = anims.includes('idle') ? 'idle' : anims[0];
  if (anim) {
    // Prefer the player's setAnimation — it also reframes the viewport to the new clip.
    if (typeof player.setAnimation === 'function') player.setAnimation(anim, true);
    else player.animationState?.setAnimation?.(0, anim, true);
  }
}

/**
 * Parse a 4.x export's skeleton with the matching bundled runtime and return its animation +
 * skin names — no WebGL, no rendering. The Rust scanner can only read names from JSON or 3.8
 * binary skeletons; 4.x binary exports (e.g. Unity `.skel.bytes`) come back empty, so the
 * inventory enriches them with this. A throwaway atlas (fake textures) satisfies the attachment
 * loader well enough to walk the structure; we only read names off the parsed `SkeletonData`.
 */
export async function readSkeletonNames(assets: ExportAssets): Promise<{ animations: string[]; skins: string[] }> {
  // spine-player re-exports all of spine-core, so the version-matched module has the parsers.
  const mod = (await loadSpine4x(assets.version)) as unknown as {
    TextureAtlas: new (text: string) => { pages: { setTexture: (t: unknown) => void }[] };
    AtlasAttachmentLoader: new (atlas: unknown) => unknown;
    SkeletonBinary: new (loader: unknown) => { readSkeletonData: (data: Uint8Array) => SkeletonNameData };
    SkeletonJson: new (loader: unknown) => { readSkeletonData: (json: unknown) => SkeletonNameData };
  };
  const read = (path: string) => invoke<string>('read_file_data_url', { path });

  const atlas = new mod.TextureAtlas(await (await fetch(await read(assets.atlasPath))).text());
  const fakeTexture = {
    setFilters() {},
    setWraps() {},
    dispose() {},
    getImage() {
      return { width: 2048, height: 2048 };
    },
    width: 2048,
    height: 2048,
  };
  for (const page of atlas.pages) page.setTexture(fakeTexture);
  const loader = new mod.AtlasAttachmentLoader(atlas);

  const skelUrl = await read(assets.skeletonPath);
  let data: SkeletonNameData;
  if (assets.skeletonFormat === 'json') {
    const json = JSON.parse(await (await fetch(skelUrl)).text());
    data = new mod.SkeletonJson(loader).readSkeletonData(json);
  } else {
    const bytes = new Uint8Array(await (await fetch(skelUrl)).arrayBuffer());
    data = new mod.SkeletonBinary(loader).readSkeletonData(bytes);
  }
  return {
    animations: (data.animations ?? []).map((a) => a.name),
    skins: (data.skins ?? []).map((s) => s.name),
  };
}

type SkeletonNameData = { animations?: { name: string }[]; skins?: { name: string }[] };

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

/**
 * Detect whether the export's texture is premultiplied-alpha (PMA), by sampling the first page.
 * The vendored 3.8 player blindly assumes PMA (blend `ONE, 1-SRC_ALPHA`); a straight-alpha export
 * then renders with bright/glowing fringes on feathered edges. The browser decodes every image as
 * straight alpha, so a stored colour channel that exceeds its own alpha — impossible once
 * premultiplied — proves the texture is NOT premultiplied. Returns `true` (the player's default)
 * when it can't tell (decode failure, no semi-transparent pixels, opaque formats like JPEG).
 */
export async function detectPremultipliedAlpha(
  assets: ExportAssets,
  rawDataURIs: Record<string, string>
): Promise<boolean> {
  const page = assets.pages[0];
  const uri = page && rawDataURIs[page.name];
  if (!uri) return true;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('image decode failed'));
      el.src = uri;
    });
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return true;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return true;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, w, h);
    // Only semi-transparent pixels are decisive (where PMA vs straight actually differ). The
    // tolerance absorbs the canvas's own premultiply round-tripping.
    const TOL = 2;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a === 0 || a === 255) continue;
      if (data[i] > a + TOL || data[i + 1] > a + TOL || data[i + 2] > a + TOL) return false;
    }
    return true;
  } catch {
    return true;
  }
}
