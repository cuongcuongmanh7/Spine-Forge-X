import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useApp } from '../useAppController';
import { SpinePreviewView } from './SpinePreviewView';
import type { LibraryEntry } from '../config';
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
 * Live skeleton preview modal — a thin resizable shell around {@link SpinePreviewView} (which owns
 * the player, toolbar, and event timeline). The modal only adds the backdrop, title header, and
 * size persistence.
 */
export function LibrarySpinePreviewModal({ entry, onClose }: { entry: LibraryEntry; onClose: () => void }) {
  const { t } = useApp();
  const modalRef = useRef<HTMLDivElement>(null);
  const downOnBackdrop = useRef(false);
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
          </div>
          <button className="modal-close" title={t.cancel} aria-label={t.cancel} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body spine-preview-body">
          <SpinePreviewView entry={entry} />
        </div>
      </div>
    </div>
  );
}
