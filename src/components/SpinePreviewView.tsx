import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, Expand, Maximize2, Minimize2, RotateCcw, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import { useApp } from '../useAppController';
import { useSpinePreview } from '../useSpinePreview';
import { setCapturedThumbnail } from '../useSpineThumbnail';
import { StatIcon } from './StatIcon';
import eventIconUrl from '../assets/stat-event.png';
import type { LibraryEntry } from '../config';
import '@esotericsoftware/spine-player/dist/spine-player.css';
import './SpinePreviewView.css';

/**
 * Live skeleton preview body shared by the preview modal and the inventory inspector panel: the
 * player canvas plus its own floating toolbar (zoom / reset / optional expand / fullscreen), event
 * timeline markers, and a stats readout. All runtime/loading logic lives in {@link useSpinePreview}.
 *
 * `compact` (panel) hides the stats + event overlays to suit the narrow column; `onExpand` adds an
 * expand button (used by the panel to reopen the asset in the larger modal).
 */
export function SpinePreviewView({
  entry,
  onExpand,
  compact = false
}: {
  entry: LibraryEntry;
  onExpand?: () => void;
  compact?: boolean;
}) {
  const { t, pushToast } = useApp();
  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const statsTextRef = useRef<HTMLSpanElement>(null);
  const eventListRef = useRef<HTMLUListElement>(null);
  const { status, error, events, animDuration, statsRef, controls, captureThumbnail } = useSpinePreview(entry, containerRef);
  const [fullscreen, setFullscreen] = useState(false);

  // Capture the currently framed canvas as the entry's thumbnail — lets the user fix a bad
  // auto-thumbnail (too small / off-centre) by zooming/panning to a good pose, then snapping it.
  const onCaptureThumbnail = async () => {
    try {
      // Re-render the current framing off-screen (reading the live WebGL canvas back is blank in
      // WebView2), then persist it as this entry's thumbnail.
      const url = await captureThumbnail();
      if (!url) {
        pushToast(t.libraryThumbCaptureFailed, 'error');
        return;
      }
      await setCapturedThumbnail(entry, url);
      pushToast(t.libraryThumbCaptured, 'success');
    } catch {
      pushToast(t.libraryThumbCaptureFailed, 'error');
    }
  };

  // Native fullscreen on the view element; the player auto-refits to the larger canvas.
  const toggleFullscreen = () => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  };
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Paint the live stats readout + highlight the event the playhead has reached, straight from the
  // shared ref each frame (no React re-render). Skipped in compact mode (overlays hidden there).
  useEffect(() => {
    if (status !== 'ready' || compact) return;
    let raf = 0;
    let lastActiveTime = NaN;
    const tick = () => {
      const { fps, time, duration, frame } = statsRef.current;
      const el = statsTextRef.current;
      if (el) {
        el.textContent = `${Math.round(fps)} FPS · ${time.toFixed(2)} / ${duration.toFixed(2)} s · f${frame}`;
      }
      let activeTime = -1;
      for (let i = 0; i < events.length && events[i].time <= time; i++) activeTime = events[i].time;
      if (activeTime !== lastActiveTime) {
        lastActiveTime = activeTime;
        const rows = eventListRef.current?.children;
        const marks = containerRef.current?.querySelectorAll('.spine-event-marker');
        events.forEach((ev, i) => {
          rows?.[i]?.classList.toggle('is-active', ev.time === activeTime);
          marks?.[i]?.classList.toggle('is-active', ev.time === activeTime);
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [status, events, statsRef, compact]);

  // Pin the active animation's events onto the player's own timeline scrubber so a single
  // (always-visible) bar carries both playback and event markers.
  useEffect(() => {
    if (status !== 'ready') return;
    const timeline = containerRef.current?.querySelector('.spine-player-timeline');
    if (!timeline) return;
    const markers: HTMLElement[] = [];
    if (animDuration > 0) {
      for (const ev of events) {
        const pct = Math.min(100, (ev.time / animDuration) * 100);
        const marker = document.createElement('div');
        marker.className = 'spine-event-marker';
        marker.style.left = `${pct}%`;
        marker.title = `${ev.name} (${+ev.time.toFixed(2)}s - ${ev.frame}f)`;
        const label = document.createElement('span');
        label.className = 'spine-event-marker-label';
        const icon = document.createElement('img');
        icon.src = eventIconUrl;
        icon.alt = '';
        label.appendChild(icon);
        label.appendChild(document.createTextNode(ev.name));
        marker.appendChild(label);
        timeline.appendChild(marker);
        markers.push(marker);
      }
    }
    return () => markers.forEach((m) => m.remove());
  }, [status, events, animDuration]);

  return (
    <div ref={rootRef} className={`spine-preview-view${compact ? ' compact' : ''}`}>
      <div className="spine-preview-toolbar">
        {status === 'ready' && (
          <>
            <button className="spine-preview-tool" title={t.libraryPreviewZoomIn} aria-label={t.libraryPreviewZoomIn} onClick={controls.zoomIn}>
              <ZoomIn size={16} />
            </button>
            <button className="spine-preview-tool" title={t.libraryPreviewZoomOut} aria-label={t.libraryPreviewZoomOut} onClick={controls.zoomOut}>
              <ZoomOut size={16} />
            </button>
            <button className="spine-preview-tool" title={t.libraryPreviewResetView} aria-label={t.libraryPreviewResetView} onClick={controls.resetView}>
              <RotateCcw size={16} />
            </button>
            <button className="spine-preview-tool" title={t.libraryThumbCapture} aria-label={t.libraryThumbCapture} onClick={() => void onCaptureThumbnail()}>
              <Camera size={16} />
            </button>
          </>
        )}
        {onExpand && (
          <button className="spine-preview-tool" title={t.libraryPreviewExpand} aria-label={t.libraryPreviewExpand} onClick={onExpand}>
            <Expand size={16} />
          </button>
        )}
        <button
          className="spine-preview-tool"
          title={fullscreen ? t.libraryPreviewExitFullscreen : t.libraryPreviewFullscreen}
          aria-label={fullscreen ? t.libraryPreviewExitFullscreen : t.libraryPreviewFullscreen}
          onClick={toggleFullscreen}
        >
          {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </div>

      <div ref={containerRef} className="spine-preview-canvas" />

      {!compact && status === 'ready' && <span ref={statsTextRef} className="spine-preview-stats" aria-hidden="true" />}
      {!compact && status === 'ready' && events.length > 0 && (
        <ul ref={eventListRef} className="spine-preview-events">
          {events.map((ev, i) => (
            <li key={`${ev.name}-${ev.time}-${i}`}>
              <StatIcon kind="event" size={13} />
              <span className="spine-preview-event-name" title={ev.name}>
                {ev.name}
              </span>
              <span className="spine-preview-event-time">
                ({+ev.time.toFixed(2)}s - {ev.frame}f)
              </span>
            </li>
          ))}
        </ul>
      )}
      {status === 'loading' && (
        <div className="spine-preview-overlay" role="status" aria-live="polite">
          <RotateCw size={22} className="spin" aria-hidden="true" />
          {!compact && <span>{t.libraryPreviewLoading}</span>}
        </div>
      )}
      {status === 'error' && (
        <div className="spine-preview-overlay error" role="alert">
          <AlertTriangle size={22} aria-hidden="true" />
          <div className="spine-preview-error-text">
            <strong>{t.libraryPreviewErrorTitle}</strong>
            {!compact && error && <p>{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
