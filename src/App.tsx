import { AppProvider, useAppControllerValue, useApp } from './useAppController';
import { Titlebar } from './components/Titlebar';
import { Sidebar } from './components/Sidebar';
import { SessionMain } from './components/SessionMain';
import { SettingsModal } from './components/SettingsModal';
import { NameProjectModal } from './components/NameProjectModal';
import { PresetEditorModal } from './components/PresetEditorModal';
import { RunOverlay } from './components/RunOverlay';
import { Toasts } from './components/Toasts';

function Shell() {
  const { settingsOpen, projectDialogOpen, presetEditorOpen, editingPreset, anyRunning, batchProgress } = useApp();
  // Keep the overlay up for the whole "Export all" batch, even between sessions.
  const showRunOverlay = anyRunning || batchProgress !== null;
  return (
    <div className="window-frame">
      <Titlebar />
      <div className="app-body">
        <Sidebar />
        <SessionMain />
      </div>
      {settingsOpen && <SettingsModal />}
      {projectDialogOpen && <NameProjectModal />}
      {presetEditorOpen && editingPreset && <PresetEditorModal />}
      {showRunOverlay && <RunOverlay />}
      <Toasts />
    </div>
  );
}

function App() {
  const controller = useAppControllerValue();
  return (
    <AppProvider value={controller}>
      <Shell />
    </AppProvider>
  );
}

export default App;
