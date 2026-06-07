import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FolderOpen, Plus } from 'lucide-react';
import { basename } from '../sessions';
import { useApp } from '../useAppController';
import { InputSection } from './workspace/InputSection';
import { ExportStrategySection } from './workspace/ExportStrategySection';
import { OutputSection } from './workspace/OutputSection';
import { LogSection } from './workspace/LogSection';
import { RunDock } from './workspace/RunDock';
import { SessionWizard } from './SessionWizard';

function EmptyState() {
  const { t, openNewSessionDialog, chooseInputFolder } = useApp();
  return (
    <div className="empty-state">
      <div className="empty-card">
        <h2>{t.emptyTitle}</h2>
        <p>{t.emptyBody}</p>
        <div className="empty-actions">
          <button className="primary-button" onClick={() => openNewSessionDialog()}>
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
  const { t, activeSession, activeStatus, renameSession } = useApp();
  const [editingTitle, setEditingTitle] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingTitle) requestAnimationFrame(() => inputRef.current?.select());
  }, [editingTitle]);

  // Drop edit mode when switching sessions.
  useEffect(() => {
    setEditingTitle(false);
  }, [activeSession?.id]);

  if (!activeSession) {
    return (
      <div className="session-main">
        <EmptyState />
      </div>
    );
  }

  const title = activeSession.name || basename(activeSession.config.inputPath) || t.untitledSession;

  function commitTitle() {
    if (activeSession) renameSession(activeSession.id, draft);
    setEditingTitle(false);
  }

  return (
    <div className="session-main">
      <div className="session-toolbar">
        {editingTitle ? (
          <input
            ref={inputRef}
            className="session-title-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitTitle();
              if (event.key === 'Escape') setEditingTitle(false);
            }}
            onBlur={commitTitle}
          />
        ) : (
          <h1
            className="session-title"
            title={title}
            onDoubleClick={() => {
              setDraft(activeSession.name || title);
              setEditingTitle(true);
            }}
          >
            {title}
          </h1>
        )}
        <div
          className={`status-pill ${activeStatus === 'green' ? 'ready' : activeStatus === 'yellow' ? 'warning' : 'blocked'}`}
        >
          {activeStatus === 'green' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          {activeStatus === 'green' ? t.ready : activeStatus === 'yellow' ? t.statusWarning : t.statusBlocked}
        </div>
      </div>
      {activeSession.wizardCompleted ? (
        <>
          <main className="app-shell">
            <InputSection />
            <ExportStrategySection />
            <OutputSection />
            <LogSection />
          </main>
          <RunDock />
        </>
      ) : (
        <SessionWizard key={activeSession.id} />
      )}
    </div>
  );
}
