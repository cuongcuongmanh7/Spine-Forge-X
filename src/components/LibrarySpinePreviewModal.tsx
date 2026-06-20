import { useRef } from 'react';
import { AlertTriangle, RotateCw, X } from 'lucide-react';
import { useApp } from '../useAppController';
import { useSpinePreview } from '../useSpinePreview';
import type { LibraryEntry } from '../config';
import '@esotericsoftware/spine-player/dist/spine-player.css';
import './LibrarySpinePreviewModal.css';

/**
 * Live skeleton preview modal: renders a unit's exported skeleton with the Spine web
 * player (animation + skin pickers come built into the widget). All loading/runtime
 * logic lives in {@link useSpinePreview} so this stays a thin shell.
 */
export function LibrarySpinePreviewModal({ entry, onClose }: { entry: LibraryEntry; onClose: () => void }) {
  const { t } = useApp();
  const containerRef = useRef<HTMLDivElement>(null);
  const { status, error, assets } = useSpinePreview(entry, containerRef);
  const name = entry.relPath.replace(/\\/g, '/').split('/').pop() || entry.spineFile;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal spine-preview-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="detail-title">
            <h2 title={entry.spineFile}>{name}</h2>
            {assets?.version && <span className="stat-chip">{assets.version}</span>}
          </div>
          <button className="modal-close" title={t.cancel} aria-label={t.cancel} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body spine-preview-body">
          <div ref={containerRef} className="spine-preview-canvas" />
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
