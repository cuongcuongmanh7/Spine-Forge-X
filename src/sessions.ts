import {
  defaultAppConfig,
  defaultSessionConfig,
  type AppConfig,
  type Project,
  type Session,
  type SessionConfig
} from './config';
import type { Language, ThemeMode } from './types';
import type { Translations } from './i18n';

const KEYS = {
  appConfig: 'spineforge.appConfig',
  projects: 'spineforge.projects',
  sessions: 'spineforge.sessions',
  activeId: 'spineforge.activeSessionId',
  activeProjectId: 'spineforge.activeProjectId',
  collapsedProjects: 'spineforge.collapsedProjects',
  language: 'spineforge.language',
  theme: 'spineforge.theme',
  legacySettings: 'spineforge.settings'
} as const;

export type PersistedState = {
  appConfig: AppConfig;
  language: Language;
  theme: ThemeMode;
  projects: Project[];
  sessions: Session[];
  activeSessionId: string | null;
  activeProjectId: string | null;
  collapsedProjectIds: string[];
};

function now(): number {
  return Date.now();
}

export function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `s_${now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] ?? '';
}

function readLanguage(): Language {
  return localStorage.getItem(KEYS.language) === 'en' ? 'en' : 'vi';
}

function readTheme(): ThemeMode {
  const stored = localStorage.getItem(KEYS.theme);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function pickKnown<T extends object>(template: T, source: Record<string, unknown>): T {
  const result = { ...template };
  for (const key of Object.keys(template) as (keyof T)[]) {
    if (key in source) {
      (result as Record<string, unknown>)[key as string] = source[key as string];
    }
  }
  return result;
}

function sanitizeConfig(raw: unknown): SessionConfig {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const config = pickKnown(defaultSessionConfig, source);
  // The app now only supports the global-preset flow, so every session uses globalJson.
  config.exportMode = 'globalJson';
  if (!Array.isArray(config.inputFiles)) {
    config.inputFiles = [];
  }
  return config;
}

function sanitizeSession(raw: unknown): Session | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const config = sanitizeConfig(source.config);
  return {
    id: typeof source.id === 'string' && source.id ? source.id : makeId(),
    // Empty string is a sentinel for "needs a project" — resolved in loadPersistedState.
    projectId: typeof source.projectId === 'string' && source.projectId ? source.projectId : '',
    name: typeof source.name === 'string' ? source.name : '',
    autoNamed: source.autoNamed !== false,
    config,
    createdAt: typeof source.createdAt === 'number' ? source.createdAt : now(),
    updatedAt: typeof source.updatedAt === 'number' ? source.updatedAt : now()
  };
}

function sanitizeProject(raw: unknown): Project | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  return {
    id: typeof source.id === 'string' && source.id ? source.id : makeId(),
    name: typeof source.name === 'string' ? source.name : '',
    autoNamed: source.autoNamed !== false,
    createdAt: typeof source.createdAt === 'number' ? source.createdAt : now(),
    updatedAt: typeof source.updatedAt === 'number' ? source.updatedAt : now()
  };
}

/** Migration runs before `t` exists, so the default project name is resolved from language directly. */
export function defaultProjectName(language: Language): string {
  return language === 'en' ? 'My Project' : 'Dự án của tôi';
}

export function createDefaultProject(language: Language): Project {
  return { id: makeId(), name: defaultProjectName(language), autoNamed: true, createdAt: now(), updatedAt: now() };
}

function readAppConfig(): AppConfig {
  const stored = localStorage.getItem(KEYS.appConfig);
  if (!stored) return { ...defaultAppConfig };
  try {
    return pickKnown(defaultAppConfig, JSON.parse(stored) as Record<string, unknown>);
  } catch {
    return { ...defaultAppConfig };
  }
}

function migrateLegacy(): { appConfig: AppConfig; session: Omit<Session, 'projectId'> } | null {
  const stored = localStorage.getItem(KEYS.legacySettings);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    const appConfig = pickKnown(defaultAppConfig, parsed);
    const config = sanitizeConfig(parsed);
    const inputPath = config.inputPath.trim();
    const name = basename(inputPath) || 'Session 1';
    return {
      appConfig,
      session: {
        id: makeId(),
        name,
        autoNamed: !inputPath,
        config,
        createdAt: now(),
        updatedAt: now()
      }
    };
  } catch {
    return null;
  }
}

function readProjects(): Project[] | null {
  const stored = localStorage.getItem(KEYS.projects);
  if (stored === null) return null;
  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeProject).filter((p): p is Project => p !== null);
  } catch {
    return [];
  }
}

function readSessions(): Session[] {
  const stored = localStorage.getItem(KEYS.sessions);
  if (stored === null) return [];
  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeSession).filter((s): s is Session => s !== null);
  } catch {
    return [];
  }
}

function readCollapsedProjectIds(): string[] {
  const stored = localStorage.getItem(KEYS.collapsedProjects);
  if (stored === null) return [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function loadPersistedState(): PersistedState {
  const language = readLanguage();
  const theme = readTheme();
  const appConfig = readAppConfig();

  const storedProjects = readProjects();

  // Case A — new format: projects key already present.
  if (storedProjects !== null) {
    const projects = storedProjects;
    const sessions = readSessions();

    // Ensure every session belongs to an existing project.
    const validIds = new Set(projects.map((p) => p.id));
    const needsHome = sessions.some((s) => !s.projectId || !validIds.has(s.projectId));
    if (needsHome) {
      let fallback = projects[0];
      if (!fallback) {
        fallback = createDefaultProject(language);
        projects.push(fallback);
        validIds.add(fallback.id);
      }
      for (const s of sessions) {
        if (!s.projectId || !validIds.has(s.projectId)) s.projectId = fallback.id;
      }
    }

    let activeSessionId = localStorage.getItem(KEYS.activeId);
    if (!activeSessionId || !sessions.some((s) => s.id === activeSessionId)) {
      activeSessionId = sessions[0]?.id ?? null;
    }

    const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
    let activeProjectId = localStorage.getItem(KEYS.activeProjectId);
    if (!activeProjectId || !validIds.has(activeProjectId)) {
      activeProjectId = activeSession?.projectId ?? projects[0]?.id ?? null;
    }

    const collapsedProjectIds = readCollapsedProjectIds().filter((id) => validIds.has(id));
    return { appConfig, language, theme, projects, sessions, activeSessionId, activeProjectId, collapsedProjectIds };
  }

  // Case B — flat sessions, no projects (existing users): wrap all into one default project.
  const flatSessionsRaw = localStorage.getItem(KEYS.sessions);
  if (flatSessionsRaw !== null) {
    const sessions = readSessions();
    const project = createDefaultProject(language);
    for (const s of sessions) s.projectId = project.id;
    let activeSessionId = localStorage.getItem(KEYS.activeId);
    if (!activeSessionId || !sessions.some((s) => s.id === activeSessionId)) {
      activeSessionId = sessions[0]?.id ?? null;
    }
    return {
      appConfig,
      language,
      theme,
      projects: [project],
      sessions,
      activeSessionId,
      activeProjectId: project.id,
      collapsedProjectIds: []
    };
  }

  // Case C — legacy single-session: wrap into a default project.
  const migrated = migrateLegacy();
  if (migrated) {
    const project = createDefaultProject(language);
    const session: Session = { ...migrated.session, projectId: project.id };
    return {
      appConfig: migrated.appConfig,
      language,
      theme,
      projects: [project],
      sessions: [session],
      activeSessionId: session.id,
      activeProjectId: project.id,
      collapsedProjectIds: []
    };
  }

  // Case D — nothing stored.
  return {
    appConfig: { ...defaultAppConfig },
    language,
    theme,
    projects: [],
    sessions: [],
    activeSessionId: null,
    activeProjectId: null,
    collapsedProjectIds: []
  };
}

export function persistAppConfig(config: AppConfig) {
  localStorage.setItem(KEYS.appConfig, JSON.stringify(config));
}

export function persistSessions(sessions: Session[]) {
  localStorage.setItem(KEYS.sessions, JSON.stringify(sessions));
}

export function persistProjects(projects: Project[]) {
  localStorage.setItem(KEYS.projects, JSON.stringify(projects));
}

export function persistActiveId(id: string | null) {
  if (id) localStorage.setItem(KEYS.activeId, id);
  else localStorage.removeItem(KEYS.activeId);
}

export function persistActiveProjectId(id: string | null) {
  if (id) localStorage.setItem(KEYS.activeProjectId, id);
  else localStorage.removeItem(KEYS.activeProjectId);
}

export function persistCollapsedProjects(ids: string[]) {
  localStorage.setItem(KEYS.collapsedProjects, JSON.stringify(ids));
}

export function persistLanguage(language: Language) {
  localStorage.setItem(KEYS.language, language);
}

export function persistTheme(theme: ThemeMode) {
  localStorage.setItem(KEYS.theme, theme);
}

/** Build a fresh, blank session with a numbered auto name, belonging to `projectId`. */
export function createSession(t: Translations, existing: Session[], projectId: string): Session {
  const used = new Set(existing.map((s) => s.name));
  let index = existing.length + 1;
  let name = `${t.untitledSession} ${index}`;
  while (used.has(name)) {
    index += 1;
    name = `${t.untitledSession} ${index}`;
  }
  return {
    id: makeId(),
    projectId,
    name,
    autoNamed: true,
    config: { ...defaultSessionConfig, inputFiles: [] },
    createdAt: now(),
    updatedAt: now()
  };
}

/** Build a new project with a numbered auto name. */
export function createProject(t: Translations, existing: Project[]): Project {
  const used = new Set(existing.map((p) => p.name));
  let index = existing.length + 1;
  let name = `${t.untitledProject} ${index}`;
  while (used.has(name)) {
    index += 1;
    name = `${t.untitledProject} ${index}`;
  }
  return { id: makeId(), name, autoNamed: true, createdAt: now(), updatedAt: now() };
}

/** Deep-clone a session's config into a new session in the same project (runtime is not copied). */
export function cloneSession(source: Session, t: Translations): Session {
  return {
    id: makeId(),
    projectId: source.projectId,
    name: `${source.name} (${t.duplicateSuffix})`,
    autoNamed: false,
    config: { ...source.config, inputFiles: [...source.config.inputFiles] },
    createdAt: now(),
    updatedAt: now()
  };
}

export function touch(session: Session, patch: Partial<SessionConfig>): Session {
  return { ...session, config: { ...session.config, ...patch }, updatedAt: now() };
}
