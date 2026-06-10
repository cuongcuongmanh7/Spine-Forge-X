import { FolderOutput, Upload } from 'lucide-react';
import { useApp } from '../useAppController';
import { dropZoneAt } from '../useDragDrop';
import './DropOverlay.css';

/**
 * Full-window overlay shown while an OS drag hovers the app. With an editable output
 * path it splits into an input zone (left) and an output zone (right) matching the
 * 50/50 hit-test in dropZoneAt; under the linkedProject policy only input is shown.
 */
export function DropOverlay() {
  const { t, dragPosition, outputDropEnabled } = useApp();

  if (!outputDropEnabled) {
    return (
      <div className="drop-overlay" aria-hidden="true">
        <div className="drop-overlay-card">
          <Upload size={32} />
          <h2 className="drop-overlay-title">{t.dropTitle}</h2>
          <p className="drop-overlay-hint">{t.dropHint}</p>
        </div>
      </div>
    );
  }

  const active = dropZoneAt(dragPosition, true);
  return (
    <div className="drop-overlay drop-overlay-split" aria-hidden="true">
      <div className={`drop-overlay-zone${active === 'input' ? ' active' : ''}`}>
        <div className="drop-overlay-card">
          <Upload size={32} />
          <h2 className="drop-overlay-title">{t.dropTitle}</h2>
          <p className="drop-overlay-hint">{t.dropHint}</p>
        </div>
      </div>
      <div className={`drop-overlay-zone${active === 'output' ? ' active' : ''}`}>
        <div className="drop-overlay-card">
          <FolderOutput size={32} />
          <h2 className="drop-overlay-title">{t.dropOutputTitle}</h2>
          <p className="drop-overlay-hint">{t.dropOutputHint}</p>
        </div>
      </div>
    </div>
  );
}
