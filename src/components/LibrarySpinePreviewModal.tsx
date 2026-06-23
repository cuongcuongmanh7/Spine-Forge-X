import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Maximize2, Minimize2, RotateCcw, RotateCw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useApp } from '../useAppController';
import { useSpinePreview } from '../useSpinePreview';
import { StatIcon } from './StatIcon';
import eventIconUrl from '../assets/stat-event.png';
import type { LibraryEntry } from '../config';
import '@esotericsoftware/spine-player/dist/spine-player.css';
import './LibrarySpinePreviewModal.css';

/** Persisted modal size (px) so the user's resized window survives reopen. */
const SIZE_KEY = 'spinePreview.size';
const loadSize = (): { width: number; height: number } | null => {
  try {
    const raw = localStorage.getItem(SIZE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return typeof v?.width === 'number' && typeof v?.height === 'number' ? v : null;
  } catch {
    return null;
  }
};

/**
 * Live skeleton preview modal: renders a unit's exported skeleton with the Spine web
 * player (animation + skin pickers come built into the widget). All loading/runtime
 * logic lives in {@link useSpinePreview} so this stays a thin shell.
 */
export function LibrarySpinePreviewModal({ entry, onClose }: { entry: LibraryEntry; onClose: () => void }) {
  const { t } = useApp();
  const containerRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const statsTextRef = useRef<HTMLSpanElement>(null);
  const eventListRef = useRef<HTMLUListElement>(null);
  const downOnBackdrop = useRef(false);
  const { status, error, assets, events, animDuration, statsRef, controls } = useSpinePreview(entry, containerRef);
  const [fullscreen, setFullscreen] = useState(false);
  const [savedSize] = useState(loadSize);
  const name = entry.relPath.replace(/\\/g, '/').split('/').pop() || entry.spineFile;

  // Close only when a click both starts and ends on the backdrop — a resize drag that
  // happens to release outside the modal must NOT dismiss it.
  const onBackdropClick = (e: React.MouseEvent) => {
    if (downOnBackdrop.current && e.target === e.currentTarget) onClose();
  };

  // Persist the modal's size whenever the user drags the resize grip (skip while fullscreen).
  useEffect(() => {
    const el = modalRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(() => {
      if (document.fullscreenElement) return;
      try {
        localStorage.setItem(SIZE_KEY, JSON.stringify({ width: el.offsetWidth, height: el.offsetHeight }));
      } catch {
        /* storage may be unavailable — sizing is non-critical */
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Native fullscreen on the modal element; the player auto-refits to the larger canvas.
  const toggleFullscreen = () => {
    const el = modalRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  };
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Paint the live stats readout + highlight the event the playhead has reached,
  // straight from the shared ref each frame (no React re-render). The "active" event
  // is the last one whose time the playback has passed in the current loop.
  useEffect(() => {
    if (status !== 'ready') return;
    let raf = 0;
    let lastActiveTime = NaN;
    const tick = () => {
      const { fps, time, duration, frame } = statsRef.current;
      const el = statsTextRef.current;
      if (el) {
        el.textContent = `${Math.round(fps)} FPS · ${time.toFixed(2)} / ${duration.toFixed(2)} s · f${frame}`;
      }
      // The reached event(s): the latest event time the playhead has passed. Events
      // sharing that exact time all light up together (so co-timed events aren't missed).
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
  }, [status, events, statsRef]);

  // Pin the active animation's events onto the player's own timeline scrubber, so a
  // single (always-visible, scrubbable) bar carries both playback and event markers.
  // The player builds the slider once and only mutates its value, so injected marker
  // nodes survive — we just rebuild them whenever the animation (events) changes.
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
  }, [status, events, animDuration, containerRef]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={onBackdropClick}
    >
      <div
        ref={modalRef}
        className="modal spine-preview-modal"
        role="dialog"
        aria-modal="true"
        style={savedSize ? { width: savedSize.width, height: savedSize.height } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="detail-title">
            <h2 title={entry.spineFile}>{name}</h2>
            {assets?.version && <span className="stat-chip">{assets.version}</span>}
          </div>
          <div className="spine-preview-actions">
            {status === 'ready' && (
              <>
                <button
                  className="modal-close"
                  title={t.libraryPreviewZoomIn}
                  aria-label={t.libraryPreviewZoomIn}
                  onClick={controls.zoomIn}
                >
                  <ZoomIn size={18} />
                </button>
                <button
                  className="modal-close"
                  title={t.libraryPreviewZoomOut}
                  aria-label={t.libraryPreviewZoomOut}
                  onClick={controls.zoomOut}
                >
                  <ZoomOut size={18} />
                </button>
                <button
                  className="modal-close"
                  title={t.libraryPreviewResetView}
                  aria-label={t.libraryPreviewResetView}
                  onClick={controls.resetView}
                >
                  <RotateCcw size={18} />
                </button>
              </>
            )}
            <button
              className="modal-close"
              title={fullscreen ? t.libraryPreviewExitFullscreen : t.libraryPreviewFullscreen}
              aria-label={fullscreen ? t.libraryPreviewExitFullscreen : t.libraryPreviewFullscreen}
              onClick={toggleFullscreen}
            >
              {fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
            <button className="modal-close" title={t.cancel} aria-label={t.cancel} onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="modal-body spine-preview-body">
          <div ref={containerRef} className="spine-preview-canvas" />
          {status === 'ready' && (
            <span ref={statsTextRef} className="spine-preview-stats" aria-hidden="true" />
          )}
          {status === 'ready' && events.length > 0 && (
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
              <span>{t.libraryPreviewLoading}</span>
            </div>
          )}
          {status === 'error' && (
            <div className="spine-preview-overlay error" role="alert">
              <AlertTriangle size={22} aria-hidden="true" />
              <div className="spine-preview-error-text">
                <strong>{t.libraryPreviewErrorTitle}</strong>
                {error && <p>{error}</p>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
