import { AppProvider, useAppControllerValue, useApp } from './useAppController';
import { Titlebar } from './components/Titlebar';
import { Sidebar } from './components/Sidebar';
import { SessionMain } from './components/SessionMain';
import { SettingsModal } from './components/SettingsModal';
import { NameProjectModal } from './components/NameProjectModal';
import { NameSessionModal } from './components/NameSessionModal';
import { PresetEditorModal } from './components/PresetEditorModal';
import { LinkedProjectModal } from './components/LinkedProjectModal';
import { RunOverlay } from './components/RunOverlay';
import { Toasts } from './components/Toasts';

function Shell() {
  const { settingsOpen, projectDialogOpen, sessionDialogOpen, presetEditorOpen, editingPreset, linkedModalOpen, anyRunning, batchProgress } = useApp();
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
      {sessionDialogOpen && <NameSessionModal />}
      {presetEditorOpen && editingPreset && <PresetEditorModal />}
      {linkedModalOpen && <LinkedProjectModal />}
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
