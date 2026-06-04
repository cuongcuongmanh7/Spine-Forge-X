import { useEffect, useRef, useState } from 'react';
import { Copy, FileText, MoreHorizontal, Pencil, Plus, Settings, Trash2 } from 'lucide-react';
import { basename } from '../sessions';
import type { Session } from '../config';
import { useApp } from '../useAppController';

function sessionSubtitle(session: Session): string {
  const path = session.config.inputPath.trim();
  if (path) return path;
  if (session.config.inputFiles.length) return `${session.config.inputFiles.length} files`;
  return '';
}

function SessionRow({ session }: { session: Session }) {
  const {
    t,
    activeSessionId,
    selectSession,
    deleteSession,
    duplicateSession,
    renameSession,
    renamingId,
    setRenamingId,
    menuOpenId,
    setMenuOpenId,
    runningSessionId
  } = useApp();

  const isActive = session.id === activeSessionId;
  const isRenaming = renamingId === session.id;
  const isMenuOpen = menuOpenId === session.id;
  const [draft, setDraft] = useState(session.name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isRenaming) {
      setDraft(session.name);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [isRenaming, session.name]);

  const label = session.name || basename(session.config.inputPath) || t.untitledSession;
  const subtitle = sessionSubtitle(session);

  return (
    <div
      className={`session-row${isActive ? ' active' : ''}${isMenuOpen ? ' menu-open' : ''}`}
      onClick={() => !isRenaming && selectSession(session.id)}
      role="button"
      tabIndex={0}
    >
      <FileText className="session-icon" size={15} />
      {isRenaming ? (
        <input
          ref={inputRef}
          className="session-rename-input"
          value={draft}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') renameSession(session.id, draft);
            if (event.key === 'Escape') setRenamingId(null);
          }}
          onBlur={() => renameSession(session.id, draft)}
        />
      ) : (
        <span className="session-text">
          <span className="session-name" title={label}>
            {label}
          </span>
          {subtitle && <span className="session-subtitle" title={subtitle}>{subtitle}</span>}
        </span>
      )}

      {runningSessionId === session.id && <span className="session-running-dot" title={t.running} />}

      {!isRenaming && (
        <button
          className="session-menu-trigger"
          title="..."
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpenId(isMenuOpen ? null : session.id);
          }}
        >
          <MoreHorizontal size={16} />
        </button>
      )}

      {isMenuOpen && (
        <>
          <div className="menu-backdrop" onClick={(event) => { event.stopPropagation(); setMenuOpenId(null); }} />
          <div className="session-menu" onClick={(event) => event.stopPropagation()}>
            <button
              onClick={() => {
                setMenuOpenId(null);
                setRenamingId(session.id);
              }}
            >
              <Pencil size={14} />
              {t.renameSession}
            </button>
            <button onClick={() => duplicateSession(session.id)}>
              <Copy size={14} />
              {t.duplicateSession}
            </button>
            <button className="danger" onClick={() => void deleteSession(session.id)}>
              <Trash2 size={14} />
              {t.deleteSession}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function Sidebar() {
  const { t, sessions, newSession, setSettingsOpen } = useApp();

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">{t.recents}</span>
        <button className="sidebar-new" title={t.newSession} onClick={() => newSession()}>
          <Plus size={16} />
        </button>
      </div>
      <div className="session-list">
        {sessions.length === 0 ? (
          <p className="session-list-empty">{t.emptyTitle}</p>
        ) : (
          sessions.map((session) => <SessionRow key={session.id} session={session} />)
        )}
      </div>
      <div className="sidebar-footer">
        <button className="sidebar-settings" onClick={() => setSettingsOpen(true)}>
          <Settings size={16} />
          <span>{t.settings}</span>
        </button>
      </div>
    </aside>
  );
}
