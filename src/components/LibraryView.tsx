import { useState } from 'react';
import { AlertTriangle, Folder, Plus, RotateCw, Trash2 } from 'lucide-react';
import { useApp } from '../useAppController';
import { useSidebarWidth, SIDEBAR_MIN, SIDEBAR_MAX, SIDEBAR_DEFAULT, clampWidth } from '../useSidebarWidth';
import { useLibraryFilter } from '../useLibraryFilter';
import { useLibraryTags } from '../useLibraryTags';
import { useLibraryDrive } from '../useLibraryDrive';
import { useLibraryNotes } from '../useLibraryNotes';
import { ModeToggle } from './ModeToggle';
import { SidebarFooter } from './SidebarFooter';
import { LibraryInventory } from './LibraryInventory';
import { LibraryInspector } from './LibraryInspector';
import { LibraryReports } from './LibraryReports';
import { LibrarySpinePreviewModal } from './LibrarySpinePreviewModal';
import { LibraryHealthCheckModal } from './LibraryHealthCheckModal';
import { LibraryScanningOverlay } from './LibraryScanningOverlay';
import type { LibraryEntry } from '../config';
import './LibraryView.css';

type Tab = 'inventory' | 'reports';
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
    selectLibrary,
    deleteLibrary,
    appDataMissing,
    isLeader
  } = useApp();

  const { width, setWidth, startResize } = useSidebarWidth();
  const entries = libraryScan?.entries ?? [];

  return (
    <div className="library-view">
      <aside className="library-sidebar" style={{ width }}>
        <ModeToggle />
        <div className="library-sidebar-head">
          <span className="sidebar-title">{t.libraryFolder}</span>
          {/* Only a leader curates the shared library list; members get a read-only list. */}
          {isLeader && (
            <button
              className="sidebar-new"
              onClick={() => void importLibrary()}
              disabled={isScanningLibrary}
              title={t.libraryImport}
              aria-label={t.libraryImport}
            >
              <Plus size={16} />
            </button>
          )}
        </div>
        <div className="library-sidebar-list">
          {libraries.length === 0 ? (
            <p className="session-list-empty">{t.libraryEmpty}</p>
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
                <Folder className="library-lib-icon" size={15} />
                <span className="library-lib-name">{l.name}</span>
                {isScanningLibrary && l.id === activeLibraryId && (
                  <RotateCw size={13} className="spin library-lib-scan" aria-hidden="true" />
                )}
                {isLeader && (
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
                )}
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
        {appDataMissing && (
          <div className="library-data-warning" role="alert">
            <AlertTriangle size={15} aria-hidden="true" />
            <span>{t.libraryDataPathMissing}</span>
          </div>
        )}
        {!activeLibrary ? (
          <div className="library-empty">
            <p className="helper-text">{t.libraryEmpty}</p>
          </div>
        ) : isScanningLibrary && entries.length === 0 ? (
          <div className="library-empty">
            <LibraryScanningOverlay title={t.libraryScanning} subtitle={activeLibrary?.rootPath} />
          </div>
        ) : (
          // Keyed by library id: remounting reloads the per-library filter namespace (useLibraryFilter
          // only reads localStorage on mount), so each library keeps its own filter setup.
          <LibraryContent key={activeLibrary.id} libraryId={activeLibrary.id} />
        )}
      </div>
    </div>
  );
}

/** Tabbed inventory/clean content for one library. Mounted fresh per library id so its filter
 *  selection (and the open tab / modals) reset cleanly when the user switches libraries. */
function LibraryContent({ libraryId }: { libraryId: string }) {
  const { t, libraryDir, pushToast, driveAccount, merged, openSettings, isLeader } = useApp();
  const [tab, setTab] = useState<Tab>('inventory');
  const [reportTotal, setReportTotal] = useState(0);
  const [cleanScopeRequest, setCleanScopeRequest] = useState<CleanScopeRequest | null>(null);
  const [previewEntry, setPreviewEntry] = useState<LibraryEntry | null>(null);
  const [healthEntry, setHealthEntry] = useState<LibraryEntry | null>(null);
  const filter = useLibraryFilter(libraryId);
  // Tags + Drive metadata live here (not in LibraryInventory) so the Inspector panel shares the same
  // loaded data — otherwise a second hook instance would have an empty cache until reloaded.
  const tags = useLibraryTags({ libraryDir });
  const drive = useLibraryDrive({
    t,
    pushToast,
    driveAccount,
    libraryDir,
    spinePath: merged.spinePath,
    openSettings: () => openSettings(true)
  });
  // Notes hook lives here (not in LibraryInventory) so the Inspector panel shares the same loaded
  // notes — otherwise a second instance would have an empty cache until the sidecar reloads.
  const notes = useLibraryNotes({ libraryDir, authorEmail: driveAccount?.email ?? '', isLeader });

  function prepareCleanScan(spineFiles: string[]) {
    setCleanScopeRequest({ id: Date.now(), spineFiles });
    setTab('reports');
  }

  return (
    <>
      <div className="library-tabbar">
        <div className="library-tabs">
          <button className={`library-tab ${tab === 'inventory' ? 'active' : ''}`} onClick={() => setTab('inventory')}>
            {t.libraryTabInventory}
          </button>
          <button className={`library-tab ${tab === 'reports' ? 'active' : ''}`} onClick={() => setTab('reports')}>
            {t.libraryTabReports}
            {reportTotal > 0 && <span className="library-tab-badge">{reportTotal}</span>}
          </button>
        </div>
      </div>

      <div className="library-panel">
        <div className="library-main-col">
          {/* Both panes stay mounted so Inventory filters + Clean scan survive a tab switch. */}
          <div className="library-tabpane" style={{ display: tab === 'inventory' ? 'block' : 'none' }}>
            <LibraryInventory
              filter={filter}
              tags={tags}
              drive={drive}
              notes={notes}
              onPrepareCleanScan={prepareCleanScan}
              onPreview={setPreviewEntry}
              onHealthCheck={setHealthEntry}
            />
          </div>
          <div className="library-tabpane" style={{ display: tab === 'reports' ? 'block' : 'none' }}>
            <LibraryReports filter={filter} scopeRequest={cleanScopeRequest} onHealthCheck={setHealthEntry} onReportTotal={setReportTotal} />
          </div>
        </div>
        {/* Inspector follows the Inventory selection; the Clean tab has its own scoped checkboxes. */}
        {tab === 'inventory' && (
          <LibraryInspector filter={filter} tags={tags} drive={drive} notes={notes} onPreview={setPreviewEntry} onHealthCheck={setHealthEntry} />
        )}
      </div>

      {previewEntry && <LibrarySpinePreviewModal entry={previewEntry} onClose={() => setPreviewEntry(null)} />}
      {healthEntry && <LibraryHealthCheckModal entry={healthEntry} onClose={() => setHealthEntry(null)} />}
    </>
  );
}
