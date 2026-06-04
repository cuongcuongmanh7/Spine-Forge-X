import { AppProvider, useAppControllerValue, useApp } from './useAppController';
import { Titlebar } from './components/Titlebar';
import { Sidebar } from './components/Sidebar';
import { SessionMain } from './components/SessionMain';
import { SettingsModal } from './components/SettingsModal';
import { Toasts } from './components/Toasts';

function Shell() {
  const { settingsOpen } = useApp();
  return (
    <div className="window-frame">
      <Titlebar />
      <div className="app-body">
        <Sidebar />
        <SessionMain />
      </div>
      {settingsOpen && <SettingsModal />}
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
