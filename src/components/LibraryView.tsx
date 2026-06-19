import { useState } from 'react';
import { Plus, RotateCw, Trash2 } from 'lucide-react';
import { useApp } from '../useAppController';
import { useSidebarWidth, SIDEBAR_MIN, SIDEBAR_MAX, SIDEBAR_DEFAULT, clampWidth } from '../useSidebarWidth';
import { useLibraryFilter } from '../useLibraryFilter';
import { ModeToggle } from './ModeToggle';
import { SidebarFooter } from './SidebarFooter';
import { LibraryInventory } from './LibraryInventory';
import { LibraryClean } from './LibraryClean';
import './LibraryView.css';

type Tab = 'inventory' | 'clean' | 'coverage';
type CleanScopeRequest = { id: number; spineFiles: string[] };

/** Asset Library main view: master-folder list (left) + tabbed inventory/clean (right). */
export function LibraryView() {
  const {
    t,
    libraries,
    activeLibrary,
    activeLibraryId,
    libraryScan,
    isScanningLibrary,
    importLibrary,
    rescanLibrary,
    selectLibrary,
    deleteLibrary
  } = useApp();

  const [tab, setTab] = useState<Tab>('inventory');
  const [cleanScopeRequest, setCleanScopeRequest] = useState<CleanScopeRequest | null>(null);
  const { width, setWidth, startResize } = useSidebarWidth();
  const filter = useLibraryFilter();
  const entries = libraryScan?.entries ?? [];

  function prepareCleanScan(spineFiles: string[]) {
    setCleanScopeRequest({ id: Date.now(), spineFiles });
    setTab('clean');
  }

  return (
    <div className="library-view">
      <aside className="library-sidebar" style={{ width }}>
        <ModeToggle />
        <div className="library-sidebar-head">
          <span>{t.libraryFolder}</span>
          <button
            className="icon-button"
            onClick={() => void importLibrary()}
            disabled={isScanningLibrary}
            title={t.libraryImport}
            aria-label={t.libraryImport}
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="library-sidebar-list">
          {libraries.length === 0 ? (
            <p className="helper-text">{t.libraryEmpty}</p>
          ) : (
            libraries.map((l) => (
              <div
                key={l.id}
                className={`library-lib-row ${l.id === activeLibraryId ? 'active' : ''}`}
                onClick={() => selectLibrary(l.id)}
                role="button"
                tabIndex={0}
                title={l.rootPath}
              >
                <span className="library-lib-name">{l.name}</span>
                <button
                  className="icon-button library-lib-del"
                  title={t.libraryDeleteLib}
                  aria-label={t.libraryDeleteLib}
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteLibrary(l.id);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>
        <SidebarFooter />
        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label={t.resizeSidebar}
          aria-valuenow={width}
          aria-valuemin={SIDEBAR_MIN}
          aria-valuemax={SIDEBAR_MAX}
          tabIndex={0}
          title={t.resizeSidebar}
          onPointerDown={startResize}
          onDoubleClick={() => setWidth(SIDEBAR_DEFAULT)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              setWidth((w) => clampWidth(w - 16));
            } else if (event.key === 'ArrowRight') {
              event.preventDefault();
              setWidth((w) => clampWidth(w + 16));
            }
          }}
        />
      </aside>

      <div className="library-main">
        {!activeLibrary ? (
          <div className="library-empty">
            <p className="helper-text">{t.libraryEmpty}</p>
          </div>
        ) : isScanningLibrary && entries.length === 0 ? (
          <div className="library-empty">
            <p className="helper-text">{t.libraryScanning}</p>
          </div>
        ) : (
          <>
            <div className="library-tabbar">
              <div className="library-tabs">
                <button className={`library-tab ${tab === 'inventory' ? 'active' : ''}`} onClick={() => setTab('inventory')}>
                  {t.libraryTabInventory}
                </button>
                <button className={`library-tab ${tab === 'clean' ? 'active' : ''}`} onClick={() => setTab('clean')}>
                  {t.libraryTabClean}
                </button>
                <button className="library-tab" disabled title={t.libraryTabCoverageSoon}>
                  {t.libraryTabCoverage}
                </button>
              </div>
              <div className="library-tabbar-actions">
                <span className="muted">
                  {t.libraryLastScan}:{' '}
                  {activeLibrary.lastScanAt ? new Date(activeLibrary.lastScanAt).toLocaleDateString() : t.libraryNeverScanned}
                </span>
                <button className="secondary-button small" onClick={() => void rescanLibrary()} disabled={isScanningLibrary}>
                  <RotateCw size={14} className={isScanningLibrary ? 'spin' : undefined} /> {t.libraryRescan}
                </button>
              </div>
            </div>

            <div className="library-panel">
              {/* Both panes stay mounted so Inventory filters + Clean scan survive a tab switch. */}
              <div className="library-tabpane" style={{ display: tab === 'inventory' ? 'block' : 'none' }}>
                <LibraryInventory filter={filter} onPrepareCleanScan={prepareCleanScan} />
              </div>
              <div className="library-tabpane" style={{ display: tab === 'clean' ? 'block' : 'none' }}>
                <LibraryClean filter={filter} scopeRequest={cleanScopeRequest} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
