import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { confirm } from '@tauri-apps/plugin-dialog';
import {
  defaultSessionConfig,
  emptyRuntime,
  type Project,
  type Session,
  type SessionConfig,
  type SessionRuntime
} from './config';
import type { Translations } from './i18n';
import type { Language } from './types';
import { normalizePathKey, snapshotRuntime, stamp } from './controllerHelpers';
import {
  basename,
  cloneSession,
  createDefaultProject,
  createProject,
  createSession,
  persistActiveId,
  persistActiveProjectId,
  persistCollapsedProjects,
  persistProjects,
  persistSessions
} from './sessions';

type Options = {
  t: Translations;
  language: Language;
  /** Initial persisted workspace state (read once at module scope by the controller). */
  initial: {
    projects: Project[];
    sessions: Session[];
    activeSessionId: string | null;
    activeProjectId: string | null;
    collapsedProjectIds: string[];
  };
  /** Running-session state lives in the controller (shared with the export engine). */
  runningSessionId: string | null;
  setRunningSessionId: (id: string | null) => void;
  runningIdRef: React.MutableRefObject<string | null>;
  /** Close the Settings modal after creating a session/project. */
  setSettingsOpen: (open: boolean) => void;
};

/**
 * Projects + sessions + per-session runtime: the workspace core. Owns the entity lists, the
 * active selection, the ephemeral active-session runtime (files/logs/output/index), the
 * sidebar's rename/menu/dialog UI state, and the session/project lifecycle (create, delete,
 * rename, duplicate, switch). Also owns the config-updaters that mutate the active session
 * and the run-output routing helpers (recordRun*) that send a running session's logs/progress
 * to the right slot even after the user switches away. Extracted from useAppController; the
 * controller passes shared running state in and spreads the returned API into its context.
 */
export function useWorkspace({
  t,
  language,
  initial,
  runningSessionId,
  setRunningSessionId,
  runningIdRef,
  setSettingsOpen
}: Options) {
  const [projects, setProjects] = useState<Project[]>(initial.projects);
  const [sessions, setSessions] = useState<Session[]>(initial.sessions);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(initial.activeSessionId);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(initial.activeProjectId);
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(
    new Set(initial.collapsedProjectIds)
  );
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  // Project that a popup-created session should land in (resolved when the dialog opens).
  const [pendingSessionProjectId, setPendingSessionProjectId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [projectMenuOpenId, setProjectMenuOpenId] = useState<string | null>(null);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  // Active-session runtime (ephemeral). Other sessions' runtime lives in runtimeByIdRef.
  const [files, setFiles] = useState<string[]>(activeSession?.config.inputFiles ?? []);
  const [skippedFiles, setSkippedFiles] = useState<string[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [lastOutputFolders, setLastOutputFolders] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const runtimeByIdRef = useRef<Record<string, SessionRuntime>>({});
  const activeIdRef = useRef<string | null>(activeSessionId);

  const sessionConfig: SessionConfig = activeSession?.config ?? defaultSessionConfig;

  useEffect(() => {
    activeIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    persistSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    persistProjects(projects);
  }, [projects]);

  useEffect(() => {
    persistActiveId(activeSessionId);
  }, [activeSessionId]);

  useEffect(() => {
    persistActiveProjectId(activeProjectId);
  }, [activeProjectId]);

  useEffect(() => {
    persistCollapsedProjects([...collapsedProjectIds]);
  }, [collapsedProjectIds]);

  function appendLog(text: string) {
    setLogs((items) => [...items, stamp(text)]);
  }

  // Route async run output to the originating session even if the user switched away.
  function recordRunLog(line: string) {
    const runId = runningIdRef.current;
    if (!runId || runId === activeIdRef.current) {
      setLogs((items) => [...items, line]);
      return;
    }
    const rt = runtimeByIdRef.current[runId] ?? emptyRuntime();
    rt.logs = [...rt.logs, line];
    runtimeByIdRef.current[runId] = rt;
  }

  function recordRunProgress(current: number) {
    const runId = runningIdRef.current;
    if (!runId || runId === activeIdRef.current) {
      setCurrentIndex(current);
      return;
    }
    const rt = runtimeByIdRef.current[runId] ?? emptyRuntime();
    rt.currentIndex = current;
    runtimeByIdRef.current[runId] = rt;
  }

  function recordRunOutput(folders: string[]) {
    const runId = runningIdRef.current;
    if (!runId || runId === activeIdRef.current) {
      setLastOutputFolders(folders);
      return;
    }
    const rt = runtimeByIdRef.current[runId] ?? emptyRuntime();
    rt.lastOutputFolders = folders;
    runtimeByIdRef.current[runId] = rt;
  }

  function patchSession(id: string, patch: Partial<SessionConfig>) {
    setSessions((list) =>
      list.map((s) => (s.id === id ? { ...s, config: { ...s.config, ...patch }, updatedAt: Date.now() } : s))
    );
  }

  function updateSessionConfig<K extends keyof SessionConfig>(key: K, value: SessionConfig[K]) {
    if (!activeSessionId) return;
    patchSession(activeSessionId, { [key]: value } as Partial<SessionConfig>);
  }

  function updateInputPath(value: string) {
    updateSessionConfig('inputPath', value);
    // Folder-scan mode: the scanned list belongs to the previous path, so any edit
    // invalidates it — clear instead of letting a stale list be exported. An explicit
    // Browse-files list (inputFiles) is independent of the path field and is kept.
    if (sessionConfig.inputFiles.length === 0) {
      setFiles([]);
      setSkippedFiles([]);
      setCurrentIndex(0);
    }
    // Exclusions are absolute paths: keep only the ones still under the new path
    // (so trimming/expanding the same tree keeps them; switching folders drops them).
    const excluded = sessionConfig.excludedFiles ?? [];
    if (excluded.length > 0) {
      const root = normalizePathKey(value);
      const kept = root ? excluded.filter((p) => normalizePathKey(p).startsWith(`${root}\\`)) : [];
      if (kept.length !== excluded.length) updateSessionConfig('excludedFiles', kept);
    }
  }

  function updateOutputPath(value: string) {
    updateSessionConfig('outputPath', value);
    if (!value.trim()) setLastOutputFolders([]);
  }

  function updateGeneratedFormat(value: string) {
    if (!activeSessionId) return;
    patchSession(activeSessionId, {
      generatedFormat: value,
      generatedSkeletonExtension: value === 'binary' ? '.skel' : '.json'
    });
  }

  /** Mark a session's setup wizard finished → it switches to the full editing view. */
  function completeWizard(id: string) {
    setSessions((list) => list.map((s) => (s.id === id ? { ...s, wizardCompleted: true, updatedAt: Date.now() } : s)));
  }

  function captureActiveRuntime() {
    if (activeSessionId) {
      runtimeByIdRef.current[activeSessionId] = snapshotRuntime(files, skippedFiles, logs, lastOutputFolders, currentIndex);
    }
  }

  function loadRuntime(session: Session | null) {
    if (!session) {
      setFiles([]);
      setSkippedFiles([]);
      setLogs([]);
      setLastOutputFolders([]);
      setCurrentIndex(0);
      return;
    }
    const rt = runtimeByIdRef.current[session.id] ?? { ...emptyRuntime(), files: [...session.config.inputFiles] };
    setFiles(rt.files);
    setSkippedFiles(rt.skippedFiles);
    setLogs(rt.logs);
    setLastOutputFolders(rt.lastOutputFolders);
    setCurrentIndex(rt.currentIndex);
  }

  /** Resolve which project a new session should land in, creating a default one if needed. */
  function resolveTargetProject(): Project {
    const fromActive = projects.find((p) => p.id === activeProjectId);
    if (fromActive) return fromActive;
    const fromSession = activeSession ? projects.find((p) => p.id === activeSession.projectId) : undefined;
    if (fromSession) return fromSession;
    if (projects[0]) return projects[0];
    const project = createDefaultProject(language);
    setProjects((list) => [project, ...list]);
    return project;
  }

  function selectSession(id: string) {
    if (id === activeSessionId) return;
    captureActiveRuntime();
    const next = sessions.find((s) => s.id === id) ?? null;
    setActiveSessionId(id);
    if (next) setActiveProjectId(next.projectId);
    loadRuntime(next);
    setMenuOpenId(null);
    setRenamingId(null);
  }

  function newSession() {
    captureActiveRuntime();
    const project = resolveTargetProject();
    const session = createSession(t, sessions, project.id);
    setSessions((list) => [session, ...list]);
    setActiveProjectId(project.id);
    setActiveSessionId(session.id);
    loadRuntime(session);
    setMenuOpenId(null);
    setSettingsOpen(false);
    return session.id;
  }

  /** Open the "name session" popup, targeting an explicit project (or the resolved default). */
  function openNewSessionDialog(projectId?: string) {
    const targetId = projectId ?? resolveTargetProject().id;
    setPendingSessionProjectId(targetId);
    setSessionDialogOpen(true);
    setProjectMenuOpenId(null);
    setMenuOpenId(null);
  }

  /** Create a session with the name from the popup, in the pending target project. */
  function confirmNewSession(name: string) {
    captureActiveRuntime();
    const projectId = pendingSessionProjectId ?? resolveTargetProject().id;
    const base = createSession(t, sessions, projectId);
    const trimmed = name.trim();
    const session = trimmed ? { ...base, name: trimmed, autoNamed: false } : base;
    setSessions((list) => [session, ...list]);
    setActiveProjectId(projectId);
    setActiveSessionId(session.id);
    loadRuntime(session);
    setCollapsedProjectIds((set) => {
      if (!set.has(projectId)) return set;
      const next = new Set(set);
      next.delete(projectId);
      return next;
    });
    setSettingsOpen(false);
    setSessionDialogOpen(false);
    setPendingSessionProjectId(null);
    return session.id;
  }

  /** Returns a session id to operate on, creating one (and a project if needed) if the workspace is empty. */
  function ensureActiveSession(): string {
    if (activeSessionId && sessions.some((s) => s.id === activeSessionId)) return activeSessionId;
    const project = resolveTargetProject();
    const session = createSession(t, sessions, project.id);
    setSessions((list) => [session, ...list]);
    setActiveProjectId(project.id);
    setActiveSessionId(session.id);
    return session.id;
  }

  async function deleteSession(id: string) {
    const target = sessions.find((s) => s.id === id);
    if (!target) return;
    const ok = await confirm(t.deleteSessionConfirm.replace('{name}', target.name || t.untitledSession), {
      title: t.deleteSession,
      kind: 'warning'
    });
    if (!ok) return;

    if (runningSessionId === id) {
      try {
        await invoke('stop_batch_export');
      } catch (error) {
        appendLog(`${t.stopFailed}: ${String(error)}`);
      }
      runningIdRef.current = null;
      setRunningSessionId(null);
    }

    delete runtimeByIdRef.current[id];
    const remaining = sessions.filter((s) => s.id !== id);
    setSessions(remaining);
    setMenuOpenId(null);

    if (activeSessionId === id) {
      // Prefer another session in the same project, then any session, then none.
      const sameProject = remaining.filter((s) => s.projectId === target.projectId);
      const fallback = sameProject[0] ?? remaining[0] ?? null;
      setActiveSessionId(fallback ? fallback.id : null);
      if (fallback) setActiveProjectId(fallback.projectId);
      loadRuntime(fallback);
    }
  }

  function renameSession(id: string, name: string) {
    const trimmed = name.trim();
    setSessions((list) =>
      list.map((s) => (s.id === id ? { ...s, name: trimmed || s.name || t.untitledSession, autoNamed: false, updatedAt: Date.now() } : s))
    );
    setRenamingId(null);
  }

  function duplicateSession(id: string) {
    const source = sessions.find((s) => s.id === id);
    if (!source) return;
    captureActiveRuntime();
    const copy = cloneSession(source, t, sessions);
    // Scanned files live in the ephemeral runtime, not in config — carry them over so the
    // duplicate shows the same files without needing a re-scan. (captureActiveRuntime above
    // ensures the source's runtime is up to date if it was the active session.)
    const sourceRuntime = runtimeByIdRef.current[source.id];
    if (sourceRuntime) {
      runtimeByIdRef.current[copy.id] = {
        files: [...sourceRuntime.files],
        skippedFiles: [...sourceRuntime.skippedFiles],
        logs: [],
        lastOutputFolders: [],
        currentIndex: 0
      };
    }
    setSessions((list) => {
      const index = list.findIndex((s) => s.id === id);
      const next = [...list];
      next.splice(index + 1, 0, copy);
      return next;
    });
    setActiveProjectId(copy.projectId);
    setActiveSessionId(copy.id);
    loadRuntime(copy);
    setMenuOpenId(null);
  }

  function newProject(name?: string) {
    captureActiveRuntime();
    const base = createProject(t, projects);
    const trimmed = (name ?? '').trim();
    const project = trimmed ? { ...base, name: trimmed, autoNamed: false } : base;
    const session = createSession(t, sessions, project.id);
    setProjects((list) => [project, ...list]);
    setSessions((list) => [session, ...list]);
    setActiveProjectId(project.id);
    setActiveSessionId(session.id);
    loadRuntime(session);
    setProjectMenuOpenId(null);
    setProjectDialogOpen(false);
    setSettingsOpen(false);
    return project.id;
  }

  function renameProject(id: string, name: string) {
    const trimmed = name.trim();
    setProjects((list) =>
      list.map((p) => (p.id === id ? { ...p, name: trimmed || p.name || t.untitledProject, autoNamed: false, updatedAt: Date.now() } : p))
    );
    setRenamingProjectId(null);
  }

  function addSessionToProject(projectId: string) {
    captureActiveRuntime();
    const session = createSession(t, sessions, projectId);
    setSessions((list) => [session, ...list]);
    setActiveProjectId(projectId);
    setActiveSessionId(session.id);
    loadRuntime(session);
    setProjectMenuOpenId(null);
    setCollapsedProjectIds((set) => {
      if (!set.has(projectId)) return set;
      const next = new Set(set);
      next.delete(projectId);
      return next;
    });
    return session.id;
  }

  /** Build a session pre-filled with explicit `.spine` files, skipping the setup wizard. */
  function makeFilledSession(projectId: string, name: string, spineFiles: string[], inputPath: string): Session {
    const base = createSession(t, sessions, projectId);
    const trimmed = name.trim();
    return {
      ...base,
      name: trimmed || base.name,
      autoNamed: !trimmed,
      wizardCompleted: true,
      config: { ...base.config, inputPath, inputFiles: [...spineFiles] }
    };
  }

  /** Create one export session in the target project from a library entry/group's spine files. */
  function createSessionFromLibrary(name: string, spineFiles: string[], inputPath: string): string {
    captureActiveRuntime();
    const project = resolveTargetProject();
    const session = makeFilledSession(project.id, name, spineFiles, inputPath);
    runtimeByIdRef.current[session.id] = { ...emptyRuntime(), files: [...spineFiles] };
    setSessions((list) => [session, ...list]);
    setActiveProjectId(project.id);
    setActiveSessionId(session.id);
    loadRuntime(session);
    return session.id;
  }

  /** Create a brand-new project from a whole library, one session per entry. */
  function createProjectFromLibrary(
    projectName: string,
    items: { name: string; spineFiles: string[]; inputPath: string }[]
  ): string {
    captureActiveRuntime();
    const base = createProject(t, projects);
    const trimmed = projectName.trim();
    const project = trimmed ? { ...base, name: trimmed, autoNamed: false } : base;
    const created = items.map((item) => makeFilledSession(project.id, item.name, item.spineFiles, item.inputPath));
    for (const s of created) runtimeByIdRef.current[s.id] = { ...emptyRuntime(), files: [...s.config.inputFiles] };
    setProjects((list) => [project, ...list]);
    setSessions((list) => [...created, ...list]);
    setActiveProjectId(project.id);
    const first = created[0];
    if (first) {
      setActiveSessionId(first.id);
      loadRuntime(first);
    }
    return project.id;
  }

  function toggleProjectCollapsed(id: string) {
    setCollapsedProjectIds((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function deleteProject(id: string) {
    const target = projects.find((p) => p.id === id);
    if (!target) return;
    const childIds = sessions.filter((s) => s.projectId === id).map((s) => s.id);
    const ok = await confirm(
      t.deleteProjectConfirm.replace('{name}', target.name || t.untitledProject).replace('{count}', String(childIds.length)),
      { title: t.deleteProject, kind: 'warning' }
    );
    if (!ok) return;

    if (runningSessionId && childIds.includes(runningSessionId)) {
      try {
        await invoke('stop_batch_export');
      } catch (error) {
        appendLog(`${t.stopFailed}: ${String(error)}`);
      }
      runningIdRef.current = null;
      setRunningSessionId(null);
    }

    for (const childId of childIds) delete runtimeByIdRef.current[childId];

    const remainingProjects = projects.filter((p) => p.id !== id);
    const remainingSessions = sessions.filter((s) => s.projectId !== id);
    setProjects(remainingProjects);
    setSessions(remainingSessions);
    setProjectMenuOpenId(null);
    setCollapsedProjectIds((set) => {
      if (!set.has(id)) return set;
      const next = new Set(set);
      next.delete(id);
      return next;
    });

    if (activeProjectId === id || (activeSessionId && childIds.includes(activeSessionId))) {
      const fallbackProject = remainingProjects[0] ?? null;
      const fallbackSession = fallbackProject
        ? remainingSessions.find((s) => s.projectId === fallbackProject.id) ?? null
        : null;
      setActiveProjectId(fallbackProject ? fallbackProject.id : null);
      setActiveSessionId(fallbackSession ? fallbackSession.id : null);
      loadRuntime(fallbackSession);
    }
  }

  return {
    // entities + selection
    projects,
    setProjects,
    sessions,
    setSessions,
    activeSessionId,
    activeProjectId,
    activeSession,
    activeProject,
    collapsedProjectIds,
    sessionConfig,

    // ephemeral runtime
    files,
    setFiles,
    skippedFiles,
    setSkippedFiles,
    logs,
    setLogs,
    lastOutputFolders,
    setLastOutputFolders,
    currentIndex,
    setCurrentIndex,
    runtimeByIdRef,
    activeIdRef,

    // sidebar UI state
    renamingId,
    setRenamingId,
    menuOpenId,
    setMenuOpenId,
    renamingProjectId,
    setRenamingProjectId,
    projectMenuOpenId,
    setProjectMenuOpenId,
    projectDialogOpen,
    setProjectDialogOpen,
    sessionDialogOpen,
    setSessionDialogOpen,

    // helpers shared with scan/export
    appendLog,
    recordRunLog,
    recordRunProgress,
    recordRunOutput,
    patchSession,
    updateSessionConfig,
    updateInputPath,
    updateOutputPath,
    updateGeneratedFormat,
    captureActiveRuntime,
    loadRuntime,
    resolveTargetProject,
    ensureActiveSession,
    completeWizard,

    // lifecycle
    selectSession,
    newSession,
    openNewSessionDialog,
    confirmNewSession,
    deleteSession,
    renameSession,
    duplicateSession,
    newProject,
    renameProject,
    addSessionToProject,
    createSessionFromLibrary,
    createProjectFromLibrary,
    toggleProjectCollapsed,
    deleteProject
  };
}
