import { AlertTriangle, CheckCircle2, FolderOpen, Plus } from 'lucide-react';
import { basename } from '../sessions';
import { useApp } from '../useAppController';
import { InputSection } from './workspace/InputSection';
import { ExportStrategySection } from './workspace/ExportStrategySection';
import { OutputSection } from './workspace/OutputSection';
import { LogSection } from './workspace/LogSection';
import { RunDock } from './workspace/RunDock';

function EmptyState() {
  const { t, newSession, chooseInputFolder } = useApp();
  return (
    <div className="empty-state">
      <div className="empty-card">
        <h2>{t.emptyTitle}</h2>
        <p>{t.emptyBody}</p>
        <div className="empty-actions">
          <button className="primary-button" onClick={() => newSession()}>
            <Plus size={18} />
            {t.newSession}
          </button>
          <button className="secondary-button" onClick={() => void chooseInputFolder()}>
            <FolderOpen size={18} />
            {t.browseFolder}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SessionMain() {
  const { t, activeSession, validation } = useApp();

  if (!activeSession) {
    return (
      <div className="session-main">
        <EmptyState />
      </div>
    );
  }

  const title = activeSession.name || basename(activeSession.config.inputPath) || t.untitledSession;

  return (
    <div className="session-main">
      <div className="session-toolbar">
        <h1 className="session-title" title={title}>{title}</h1>
        <div className={`status-pill ${validation.ok ? 'ready' : 'needs-setup'}`}>
          {validation.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          {validation.ok ? t.ready : t.needsSetup}
        </div>
      </div>
      <main className="app-shell">
        <InputSection />
        <ExportStrategySection />
        <OutputSection />
        <LogSection />
      </main>
      <RunDock />
    </div>
  );
}
