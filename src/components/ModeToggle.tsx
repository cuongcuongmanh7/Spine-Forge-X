import { Library, PanelsTopLeft } from 'lucide-react';
import { useApp } from '../useAppController';
import './ModeToggle.css';

/** Top-of-sidebar segmented switch between the Workspace and Library modes. */
export function ModeToggle() {
  const { t, viewMode, setViewMode } = useApp();
  return (
    <div className="mode-toggle" role="tablist" aria-label={t.navTitle}>
      <button
        role="tab"
        className={viewMode === 'workspace' ? 'active' : ''}
        aria-selected={viewMode === 'workspace'}
        onClick={() => setViewMode('workspace')}
      >
        <PanelsTopLeft size={15} />
        {t.navWorkspace}
      </button>
      <button
        role="tab"
        className={viewMode === 'library' ? 'active' : ''}
        aria-selected={viewMode === 'library'}
        onClick={() => setViewMode('library')}
      >
        <Library size={15} />
        {t.navLibrary}
      </button>
    </div>
  );
}
