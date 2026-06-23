import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ExportAssets, LibraryEntry } from './config';
import { type DisposablePlayer, applyPreferredSetup, basename, buildRawDataURIs, loadSpine38, loadSpine4 } from './spineRuntime';

/**
 * Live skeleton preview for a Library unit's exported skeleton, rendered with the
 * official Spine web player. Resolves the export file set via `list_export_assets`,
 * feeds the bytes to the player as `rawDataURIs` (no network), and picks the runtime
 * by detected version (see {@link import('./spineRuntime')} for the shared loaders).
 *
 * The 3.8 and 4.x players expose slightly different surfaces, so everything here is
 * written defensively against both: stats are sampled from shared fields (`playTime`,
 * `currentViewport`) rather than the 4.x-only `frame` callback, and reset restores a
 * snapshot of the viewport rather than calling the 4.x-only `setViewport`.
 */

export type PreviewStatus = 'loading' | 'ready' | 'error';

/** Live playback readout, refreshed each animation frame (no React re-render). */
export type PreviewStats = { fps: number; time: number; duration: number; frame: number };

/** A keyed event inside an animation, with its trigger time in seconds + frames. */
export type AnimEvent = { name: string; time: number; frame: number };

/** Editor default export rate — Spine has no authoring fps in the runtime data. */
const ASSUMED_FPS = 30;

type AnimationLike = { name?: string; duration: number; timelines?: unknown[] };

/**
 * Pull the keyed events out of an animation by scanning its timelines for the
 * EventTimeline (the only one carrying an `events[]` of `{ time, data.name }`).
 * Works on both the 3.8 and 4.x runtimes — both store events the same way.
 */
function extractEvents(animation: AnimationLike | undefined | null): AnimEvent[] {
  const timelines = animation?.timelines;
  if (!Array.isArray(timelines)) return [];
  const out: AnimEvent[] = [];
  for (const tl of timelines) {
    const evs = (tl as { events?: unknown })?.events;
    if (!Array.isArray(evs)) continue;
    for (const ev of evs) {
      const name = ev?.data?.name ?? ev?.name;
      if (typeof name !== 'string') continue;
      const time = typeof ev?.time === 'number' ? ev.time : 0;
      out.push({ name, time, frame: Math.round(time * ASSUMED_FPS) });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}
type TrackLike = { animation?: AnimationLike; getAnimationTime?: () => number; trackTime?: number };
type ViewportBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
};

/** Minimal version-agnostic surface we poke on the live player after it loads. */
type LivePlayer = DisposablePlayer & {
  skeleton?: {
    data?: { skins?: { name: string }[]; animations?: { name: string; duration: number }[] };
    setSkinByName?: (name: string) => void;
    setSlotsToSetupPose?: () => void;
  } | null;
  animationState?: {
    setAnimation?: (track: number, name: string, loop: boolean) => unknown;
    tracks?: (TrackLike | null)[];
    getCurrent?: (track: number) => TrackLike | null;
  } | null;
  setAnimation?: (name: string, loop?: boolean) => unknown;
  // Live playback time, present on both runtimes.
  playTime?: number;
  // Viewport box the player turns into the camera each frame (private at the type level, live at runtime).
  currentViewport?: ViewportBox | null;
  previousViewport?: ViewportBox | null;
  canvas?: HTMLCanvasElement | null;
  sceneRenderer?: { camera?: { zoom: number } | null } | null;
};

/** Live camera controls (zoom / reset framing), exposed to the modal. */
export type PreviewControls = { zoomIn: () => void; zoomOut: () => void; resetView: () => void };

/** Current track on either runtime (4.x exposes `tracks[]`, 3.8 exposes `getCurrent`). */
function currentTrack(player: LivePlayer): TrackLike | null {
  const as = player.animationState;
  return as?.tracks?.[0] ?? as?.getCurrent?.(0) ?? null;
}

/** Sample playback position into the shared stats object (fps is measured by the caller). */
function sampleStats(player: LivePlayer, stats: PreviewStats) {
  const track = currentTrack(player);
  const duration = track?.animation?.duration ?? 0;
  const time =
    typeof player.playTime === 'number' ? player.playTime : (track?.getAnimationTime?.() ?? track?.trackTime ?? 0);
  stats.duration = duration;
  stats.time = duration > 0 ? Math.min(time, duration) : time;
  stats.frame = Math.round(stats.time * ASSUMED_FPS);
}

export function useSpinePreview(entry: LibraryEntry | null, containerRef: React.RefObject<HTMLDivElement>) {
  const [status, setStatus] = useState<PreviewStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [assets, setAssets] = useState<ExportAssets | null>(null);
  const [events, setEvents] = useState<AnimEvent[]>([]);
  // Active animation's total length (seconds), used to place markers along the timeline.
  const [animDuration, setAnimDuration] = useState(0);
  const playerRef = useRef<DisposablePlayer | null>(null);
  const statsRef = useRef<PreviewStats>({ fps: 0, time: 0, duration: 0, frame: 0 });
  const initialViewport = useRef<ViewportBox | null>(null);

  const livePlayer = () => playerRef.current as LivePlayer | null;

  // Zoom by scaling the viewport box around its centre (factor < 1 zooms in).
  const zoom = (factor: number) => {
    const p = livePlayer();
    const vp = p?.currentViewport;
    if (!p || !vp || vp.width == null) return;
    const cx = vp.x + vp.width / 2;
    const cy = vp.y + vp.height / 2;
    vp.width *= factor;
    vp.height *= factor;
    vp.x = cx - vp.width / 2;
    vp.y = cy - vp.height / 2;
    vp.padLeft *= factor;
    vp.padRight *= factor;
    vp.padTop *= factor;
    vp.padBottom *= factor;
    p.previousViewport = null; // skip the transition lerp so the change is immediate
  };

  // Pan the framing by a CSS-pixel delta (right-drag), 1:1 grab style. World-per-pixel is the
  // viewport's world size over the canvas's displayed size — no camera/DPR guesswork.
  const pan = (dxPx: number, dyPx: number) => {
    const p = livePlayer();
    const vp = p?.currentViewport;
    const canvas = p?.canvas;
    if (!p || !vp || vp.width == null || !canvas?.clientWidth || !canvas.clientHeight) return;
    const fullW = vp.width + vp.padLeft + vp.padRight;
    const fullH = vp.height + vp.padTop + vp.padBottom;
    vp.x -= (dxPx * fullW) / canvas.clientWidth; // drag right → content follows the cursor
    vp.y += (dyPx * fullH) / canvas.clientHeight; // screen Y is top-down, world Y is bottom-up
    p.previousViewport = null;
  };

  // Reset framing to the snapshot captured at load — clears both zoom and pan (works on 3.8 + 4.x).
  const resetView = () => {
    const p = livePlayer();
    const vp = p?.currentViewport;
    if (p && vp && initialViewport.current) {
      Object.assign(vp, initialViewport.current);
      p.previousViewport = null;
    }
  };

  const controls = useRef<PreviewControls>({
    zoomIn: () => zoom(0.8),
    zoomOut: () => zoom(1.25),
    resetView: () => resetView(),
  });

  // Wire wheel-zoom + right-drag-pan on the CONTAINER (an ancestor of the player canvas).
  // Pan uses Pointer Events + setPointerCapture so move/up are reliably delivered during a
  // right-button drag (plain mousemove is not delivered mid right-drag in WebView2). The
  // player's own pause toggle is mouse-based, so we suppress right-button mouse events
  // separately in the capture phase (our listener runs before the player's canvas input).
  const attachInteraction = (container: HTMLElement): (() => void) => {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom(e.deltaY > 0 ? 1.1 : 0.9);
    };
    let panning = false;
    let pointerId = -1;
    let lastX = 0;
    let lastY = 0;
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 2) return; // right button only
      e.preventDefault();
      e.stopPropagation();
      panning = true;
      pointerId = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      container.style.cursor = 'grabbing'; // hand cursor while panning
      try {
        container.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!panning || e.pointerId !== pointerId) return;
      pan(e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const endPan = (e: PointerEvent) => {
      if (!panning || e.pointerId !== pointerId) return;
      panning = false;
      container.style.cursor = '';
      try {
        container.releasePointerCapture(pointerId);
      } catch {
        /* may already be released */
      }
      pointerId = -1;
    };
    // Kill the player's right-button pause toggle + the native context menu.
    const suppressRightMouse = (e: MouseEvent) => {
      if (e.button === 2) {
        e.stopPropagation();
        e.preventDefault();
      }
    };
    const onContextMenu = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('pointerdown', onPointerDown, true);
    container.addEventListener('pointermove', onPointerMove, true);
    container.addEventListener('pointerup', endPan, true);
    container.addEventListener('pointercancel', endPan, true);
    container.addEventListener('mousedown', suppressRightMouse, true);
    container.addEventListener('mouseup', suppressRightMouse, true);
    container.addEventListener('contextmenu', onContextMenu, true);
    return () => {
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('pointerdown', onPointerDown, true);
      container.removeEventListener('pointermove', onPointerMove, true);
      container.removeEventListener('pointerup', endPan, true);
      container.removeEventListener('pointercancel', endPan, true);
      container.removeEventListener('mousedown', suppressRightMouse, true);
      container.removeEventListener('mouseup', suppressRightMouse, true);
      container.removeEventListener('contextmenu', onContextMenu, true);
      container.style.cursor = '';
    };
  };

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    setStatus('loading');
    setError(null);
    setAssets(null);
    setEvents([]);
    setAnimDuration(0);
    statsRef.current = { fps: 0, time: 0, duration: 0, frame: 0 };
    initialViewport.current = null;

    let detachInteraction: (() => void) | null = null;
    let statsRaf = 0;
    let lastSample = 0;
    let lastAnimName: string | null = null;

    // Self-driven stats loop: 3.8 has no `frame` callback, so sample the player directly.
    const startStats = () => {
      const loop = (now: number) => {
        statsRaf = requestAnimationFrame(loop);
        const p = livePlayer();
        if (!p) return;
        if (lastSample) {
          const dt = (now - lastSample) / 1000;
          if (dt > 0) {
            const instant = 1 / dt;
            statsRef.current.fps = statsRef.current.fps ? statsRef.current.fps * 0.9 + instant * 0.1 : instant;
          }
        }
        lastSample = now;
        sampleStats(p, statsRef.current);
        // Refresh the event list only when the active animation changes (the player's
        // own picker can switch it), keeping React re-renders off the hot path.
        const anim = currentTrack(p)?.animation;
        const animName = anim?.name ?? null;
        if (animName !== lastAnimName) {
          lastAnimName = animName;
          setEvents(extractEvents(anim));
          setAnimDuration(anim?.duration ?? 0);
        }
      };
      statsRaf = requestAnimationFrame(loop);
    };

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
      const onSuccess = (player: unknown) => {
        if (cancelled) return;
        const p = player as LivePlayer;
        try {
          applyPreferredSetup(p);
          // Snapshot the framing the player settled on, so Reset can restore it later.
          if (p.currentViewport) initialViewport.current = { ...p.currentViewport };
          detachInteraction = attachInteraction(container);
          startStats();
        } catch {
          /* skin/anim names may be absent on minimal skeletons — keep the player's defaults */
        }
        setStatus('ready');
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
      if (statsRaf) cancelAnimationFrame(statsRaf);
      detachInteraction?.();
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

  return { status, error, assets, events, animDuration, statsRef, controls: controls.current };
}
