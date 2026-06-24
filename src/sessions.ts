import {
  defaultAppConfig,
  defaultSessionConfig,
  type AppConfig,
  type Library,
  type LibraryCleanState,
  type LibraryScan,
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
  legacySettings: 'spineforge.settings',
  libraries: 'spineforge.libraries',
  activeLibraryId: 'spineforge.activeLibraryId',
  libraryScanPrefix: 'spineforge.libraryScan.',
  libraryCleanPrefix: 'spineforge.libraryClean.',
  libraryTrashPrefix: 'spineforge.libraryTrash.',
  viewMode: 'spineforge.viewMode'
} as const;

export type ViewMode = 'workspace' | 'library';

export function loadViewMode(): ViewMode {
  return localStorage.getItem(KEYS.viewMode) === 'library' ? 'library' : 'workspace';
}

export function persistViewMode(mode: ViewMode) {
  localStorage.setItem(KEYS.viewMode, mode);
}

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
  // The app supports the global-preset flow plus the per-project override mode
  // (lastExportSettings = global preset + pack settings parsed from each .spine).
  if (config.exportMode !== 'lastExportSettings') config.exportMode = 'globalJson';
  // The 'timestamp' output policy is temporarily hidden; migrate any stored session off it
  // so it doesn't land on an option the UI no longer shows.
  if (config.outputPolicy === 'timestamp') config.outputPolicy = 'sourceFolderName';
  // Normalize legacy lowercase patch-agnostic versions ("4.3.xx" → "4.3.XX") to match presets.
  if (typeof config.targetVersion === 'string') {
    config.targetVersion = config.targetVersion.replace(/\.xx$/, '.XX');
  }
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
    // Stored sessions are already configured → don't force them through the wizard.
    wizardCompleted: source.wizardCompleted !== false,
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

/**
 * `clean` and `preserveRelativePaths` used to be global (app-level) settings; they are now
 * per-session. Read any explicit values left in the stored global config so we can seed
 * existing sessions with them — otherwise a user who toggled them globally would silently
 * lose that choice. Returns {} once the global config has been rewritten without these keys.
 */
function readLegacyGlobalSessionDefaults(): Partial<SessionConfig> {
  const stored = localStorage.getItem(KEYS.appConfig);
  if (!stored) return {};
  try {
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    const out: Partial<SessionConfig> = {};
    if (typeof parsed.clean === 'boolean') out.clean = parsed.clean;
    if (typeof parsed.preserveRelativePaths === 'boolean') {
      out.preserveRelativePaths = parsed.preserveRelativePaths;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Apply the legacy global defaults to every already-stored session (all of which predate the
 * per-session migration), then persist so the values stick. No-op once the global config no
 * longer carries the keys.
 */
function migrateGlobalSessionDefaults(sessions: Session[]): void {
  const legacy = readLegacyGlobalSessionDefaults();
  if (Object.keys(legacy).length === 0 || sessions.length === 0) return;
  for (const s of sessions) {
    s.config = { ...s.config, ...legacy };
  }
  persistSessions(sessions);
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
        wizardCompleted: true,
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
    migrateGlobalSessionDefaults(sessions);
    return { appConfig, language, theme, projects, sessions, activeSessionId, activeProjectId, collapsedProjectIds };
  }

  // Case B — flat sessions, no projects (existing users): wrap all into one default project.
  const flatSessionsRaw = localStorage.getItem(KEYS.sessions);
  if (flatSessionsRaw !== null) {
    const sessions = readSessions();
    const project = createDefaultProject(language);
    for (const s of sessions) s.projectId = project.id;
    migrateGlobalSessionDefaults(sessions);
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
    wizardCompleted: false,
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Numbered duplicate name, e.g. "Enemy" → "Enemy (copy) (1)", then "(2)", ... Strips any existing
 * " (copy)" / " (copy) (N)" tail first so repeated duplicates don't nest ("(copy) (copy)").
 */
function uniqueDuplicateName(sourceName: string, suffix: string, existing: Session[]): string {
  const suf = escapeRegExp(suffix);
  const root = sourceName.replace(new RegExp(`\\s*\\(${suf}\\)(\\s*\\(\\d+\\))?\\s*$`), '').trim() || sourceName.trim();
  const base = `${root} (${suffix})`;
  const used = new Set(existing.map((s) => s.name));
  let n = 1;
  while (used.has(`${base} (${n})`)) n += 1;
  return `${base} (${n})`;
}

/** Deep-clone a session's config into a new session in the same project (runtime is not copied). */
export function cloneSession(source: Session, t: Translations, existing: Session[] = []): Session {
  return {
    id: makeId(),
    projectId: source.projectId,
    name: uniqueDuplicateName(source.name, t.duplicateSuffix, existing),
    autoNamed: false,
    // Inherit: duplicating an already-set-up session skips the wizard; duplicating an
    // unfinished one keeps it in the wizard.
    wizardCompleted: source.wizardCompleted,
    config: {
      ...source.config,
      inputFiles: [...source.config.inputFiles],
      excludedFiles: [...(source.config.excludedFiles ?? [])]
    },
    createdAt: now(),
    updatedAt: now()
  };
}

export function touch(session: Session, patch: Partial<SessionConfig>): Session {
  return { ...session, config: { ...session.config, ...patch }, updatedAt: now() };
}

// ---- Asset Library persistence --------------------------------------------

export function loadLibraries(): Library[] {
  const stored = localStorage.getItem(KEYS.libraries);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((raw): Library | null => {
        if (!raw || typeof raw !== 'object') return null;
        const s = raw as Record<string, unknown>;
        if (typeof s.rootPath !== 'string' || !s.rootPath) return null;
        return {
          id: typeof s.id === 'string' && s.id ? s.id : makeId(),
          name: typeof s.name === 'string' ? s.name : basename(s.rootPath),
          rootPath: s.rootPath,
          createdAt: typeof s.createdAt === 'number' ? s.createdAt : now(),
          lastScanAt: typeof s.lastScanAt === 'number' ? s.lastScanAt : null
        };
      })
      .filter((l): l is Library => l !== null);
  } catch {
    return [];
  }
}

export function persistLibraries(libraries: Library[]) {
  localStorage.setItem(KEYS.libraries, JSON.stringify(libraries));
}

export function loadActiveLibraryId(): string | null {
  return localStorage.getItem(KEYS.activeLibraryId);
}

export function persistActiveLibraryId(id: string | null) {
  if (id) localStorage.setItem(KEYS.activeLibraryId, id);
  else localStorage.removeItem(KEYS.activeLibraryId);
}

/** Cached scan result per library — keyed so only the active library's scan is read at a time. */
export function loadLibraryScan(id: string): LibraryScan | null {
  const stored = localStorage.getItem(KEYS.libraryScanPrefix + id);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as LibraryScan;
  } catch {
    return null;
  }
}

export function persistLibraryScan(id: string, scan: LibraryScan) {
  localStorage.setItem(KEYS.libraryScanPrefix + id, JSON.stringify(scan));
}

export function loadLibraryCleanState(id: string): LibraryCleanState {
  const stored = localStorage.getItem(KEYS.libraryCleanPrefix + id);
  if (!stored) return {};
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as LibraryCleanState;
  } catch {
    return {};
  }
}

export function persistLibraryCleanState(id: string, state: LibraryCleanState) {
  localStorage.setItem(KEYS.libraryCleanPrefix + id, JSON.stringify(state));
}

/** Per-library trash: relPaths the user excluded from the inventory. Hidden from the inventory + clean
 *  scans and skipped on rescan, until restored. Synced across the team (see sync.ts). */
export function loadLibraryTrash(id: string): string[] {
  const stored = localStorage.getItem(KEYS.libraryTrashPrefix + id);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored) as unknown;
    return Array.isArray(parsed) ? (parsed.filter((p) => typeof p === 'string') as string[]) : [];
  } catch {
    return [];
  }
}

export function persistLibraryTrash(id: string, relPaths: string[]) {
  localStorage.setItem(KEYS.libraryTrashPrefix + id, JSON.stringify(relPaths));
}

export function clearLibraryScan(id: string) {
  localStorage.removeItem(KEYS.libraryScanPrefix + id);
  localStorage.removeItem(KEYS.libraryCleanPrefix + id);
  localStorage.removeItem(KEYS.libraryTrashPrefix + id);
}
