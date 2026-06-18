import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  Folder,
  MoreHorizontal,
  Pencil,
  Eraser,
  LayoutDashboard,
  Library,
  Play,
  Plus,
  Settings,
  Trash2
} from 'lucide-react';
import { basename } from '../sessions';
import type { Project, Session } from '../config';
import { useApp } from '../useAppController';
import './Sidebar.css';

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 420;
const SIDEBAR_DEFAULT = 240;
const SIDEBAR_KEY = 'spineforge.sidebarWidth';

function clampWidth(value: number): number {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, value));
}

function readSidebarWidth(): number {
  const raw = Number(localStorage.getItem(SIDEBAR_KEY));
  return Number.isFinite(raw) && raw > 0 ? clampWidth(raw) : SIDEBAR_DEFAULT;
}

function sessionSubtitle(session: Session): string {
  const path = session.config.inputPath.trim();
  if (path) return path;
  if (session.config.inputFiles.length) return `${session.config.inputFiles.length} files`;
  return '';
}

/** Compact "23h", "1d", "3w" label from a timestamp. Language-neutral suffixes. */
function relativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const year = 365 * day;
  if (diff < minute) return 'now';
  if (diff < hour) return `${Math.floor(diff / minute)}m`;
  if (diff < day) return `${Math.floor(diff / hour)}h`;
  if (diff < week) return `${Math.floor(diff / day)}d`;
  if (diff < year) return `${Math.floor(diff / week)}w`;
  return `${Math.floor(diff / year)}y`;
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
    runningSessionId,
    sessionStatuses,
    sessionOverlaps
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
  const status = sessionStatuses[session.id] ?? 'red';
  const statusTitle = status === 'green' ? t.statusReady : status === 'yellow' ? t.statusWarning : t.statusBlocked;
  // Cross-session overlap badge: output collision (danger) outranks shared input (attention).
  const overlap = sessionOverlaps[session.id];
  const overlapKind = overlap?.outputCollision ? 'danger' : overlap?.sharedInput ? 'warn' : null;
  const overlapTitle = overlap?.outputCollision ? t.overlapOutputBadge : t.overlapInputBadge;

  return (
    <div
      className={`session-row${isActive ? ' active' : ''}${isMenuOpen ? ' menu-open' : ''}`}
      onClick={() => !isRenaming && selectSession(session.id)}
      onKeyDown={(event) => {
        // Only when the row itself is focused (not a child input), so keyboard users can activate it.
        if (isRenaming || event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectSession(session.id);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <span className={`session-status-dot status-${status}`} title={statusTitle} role="img" aria-label={statusTitle} />
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

      {!isRenaming && overlapKind && (
        <span
          className={`session-overlap-badge ${overlapKind}`}
          title={overlapTitle}
          role="img"
          aria-label={overlapTitle}
        >
          <AlertTriangle size={13} />
        </span>
      )}

      {!isRenaming && <span className="session-time">{relativeTime(session.updatedAt)}</span>}

      {runningSessionId === session.id && <span className="session-running-dot" title={t.running} />}

      {!isRenaming && (
        <button
          className="session-menu-trigger"
          title={t.options}
          aria-label={t.options}
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

function ProjectGroup({ project }: { project: Project }) {
  const {
    t,
    sessions,
    openNewSessionDialog,
    renameProject,
    deleteProject,
    exportProjectSessions,
    collapsedProjectIds,
    toggleProjectCollapsed,
    renamingProjectId,
    setRenamingProjectId,
    projectMenuOpenId,
    setProjectMenuOpenId,
    anyRunning
  } = useApp();

  const projectSessions = sessions.filter((s) => s.projectId === project.id);
  const isCollapsed = collapsedProjectIds.has(project.id);
  const isRenaming = renamingProjectId === project.id;
  const isMenuOpen = projectMenuOpenId === project.id;
  const [draft, setDraft] = useState(project.name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isRenaming) {
      setDraft(project.name);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [isRenaming, project.name]);

  return (
    <div className={`project-group${isMenuOpen ? ' menu-open' : ''}`}>
      <div
        className="project-header"
        onClick={() => !isRenaming && toggleProjectCollapsed(project.id)}
        onKeyDown={(event) => {
          if (isRenaming || event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleProjectCollapsed(project.id);
          }
        }}
        role="button"
        tabIndex={0}
      >
        {isCollapsed ? <ChevronRight className="project-chevron" size={14} /> : <ChevronDown className="project-chevron" size={14} />}
        <Folder className="project-icon" size={15} />
        {isRenaming ? (
          <input
            ref={inputRef}
            className="project-rename-input"
            value={draft}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') renameProject(project.id, draft);
              if (event.key === 'Escape') setRenamingProjectId(null);
            }}
            onBlur={() => renameProject(project.id, draft)}
          />
        ) : (
          <span className="project-name" title={project.name || t.untitledProject}>
            {project.name || t.untitledProject}
          </span>
        )}

        {!isRenaming && (
          <button
            className="project-add"
            title={t.addSession}
            aria-label={t.addSession}
            onClick={(event) => {
              event.stopPropagation();
              openNewSessionDialog(project.id);
            }}
          >
            <Plus size={15} />
          </button>
        )}

        {!isRenaming && (
          <button
            className="project-menu-trigger"
            title={t.options}
            aria-label={t.options}
            onClick={(event) => {
              event.stopPropagation();
              setProjectMenuOpenId(isMenuOpen ? null : project.id);
            }}
          >
            <MoreHorizontal size={16} />
          </button>
        )}

        {isMenuOpen && (
          <>
            <div className="menu-backdrop" onClick={(event) => { event.stopPropagation(); setProjectMenuOpenId(null); }} />
            <div className="session-menu project-menu" onClick={(event) => event.stopPropagation()}>
              <button
                onClick={() => {
                  openNewSessionDialog(project.id);
                }}
              >
                <Plus size={14} />
                {t.addSession}
              </button>
              <button
                disabled={anyRunning}
                onClick={() => void exportProjectSessions(project.id)}
              >
                <Play size={14} />
                {t.exportAll}
              </button>
              <button
                onClick={() => {
                  setProjectMenuOpenId(null);
                  setRenamingProjectId(project.id);
                }}
              >
                <Pencil size={14} />
                {t.renameProject}
              </button>
              <button className="danger" onClick={() => void deleteProject(project.id)}>
                <Trash2 size={14} />
                {t.deleteProject}
              </button>
            </div>
          </>
        )}
      </div>

      {!isCollapsed && (
        <div className="project-sessions">
          {projectSessions.length === 0 ? (
            <p className="project-empty">{t.projectEmpty}</p>
          ) : (
            projectSessions.map((session) => <SessionRow key={session.id} session={session} />)
          )}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const { t, projects, setProjectDialogOpen, setSettingsOpen, setCleanSourceFolderOpen, setDashboardOpen, setLibraryOpen } = useApp();
  const [width, setWidth] = useState(readSidebarWidth);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, String(width));
  }, [width]);

  // Drag the right-edge handle to resize; width is clamped to [MIN, MAX] and persisted.
  function startResize(event: React.PointerEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startW = width;
    document.body.classList.add('col-resizing');
    const onMove = (e: PointerEvent) => setWidth(clampWidth(startW + (e.clientX - startX)));
    const onUp = () => {
      document.body.classList.remove('col-resizing');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  return (
    <aside className="sidebar" style={{ width }}>
      <div className="sidebar-header">
        <span className="sidebar-title">{t.projects}</span>
        <button className="sidebar-new" title={t.newProject} aria-label={t.newProject} onClick={() => setProjectDialogOpen(true)}>
          <Plus size={16} />
        </button>
      </div>
      <div className="session-list">
        {projects.length === 0 ? (
          <p className="session-list-empty">{t.emptyTitle}</p>
        ) : (
          projects.map((project) => <ProjectGroup key={project.id} project={project} />)
        )}
      </div>
      <div className="sidebar-footer">
        <button className="sidebar-settings" onClick={() => setLibraryOpen(true)}>
          <Library size={16} />
          <span>{t.libraryFolder}</span>
        </button>
        <button className="sidebar-settings" onClick={() => setDashboardOpen(true)}>
          <LayoutDashboard size={16} />
          <span>{t.dashboardFolder}</span>
        </button>
        <button className="sidebar-settings" onClick={() => setCleanSourceFolderOpen(true)}>
          <Eraser size={16} />
          <span>{t.cleanSourceFolder}</span>
        </button>
        <button className="sidebar-settings" onClick={() => setSettingsOpen(true)}>
          <Settings size={16} />
          <span>{t.settings}</span>
        </button>
      </div>
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
  );
}
