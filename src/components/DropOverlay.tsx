import { Upload } from 'lucide-react';
import { useApp } from '../useAppController';

/** Full-window overlay shown while an OS drag hovers the app, hinting where the drop lands. */
export function DropOverlay() {
  const { t } = useApp();
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
