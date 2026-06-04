import {
  defaultAppConfig,
  defaultSessionConfig,
  type AppConfig,
  type Session,
  type SessionConfig
} from './config';
import type { Language, ThemeMode } from './types';
import type { Translations } from './i18n';

const KEYS = {
  appConfig: 'spineforge.appConfig',
  sessions: 'spineforge.sessions',
  activeId: 'spineforge.activeSessionId',
  language: 'spineforge.language',
  theme: 'spineforge.theme',
  legacySettings: 'spineforge.settings'
} as const;

export type PersistedState = {
  appConfig: AppConfig;
  language: Language;
  theme: ThemeMode;
  sessions: Session[];
  activeSessionId: string | null;
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
  if ((config.exportMode as string) === 'internalExperimental') {
    config.exportMode = 'perProjectJson';
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
    name: typeof source.name === 'string' ? source.name : '',
    autoNamed: source.autoNamed !== false,
    config,
    createdAt: typeof source.createdAt === 'number' ? source.createdAt : now(),
    updatedAt: typeof source.updatedAt === 'number' ? source.updatedAt : now()
  };
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

function migrateLegacy(): { appConfig: AppConfig; session: Session } | null {
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

export function loadPersistedState(): PersistedState {
  const language = readLanguage();
  const theme = readTheme();

  const sessionsRaw = localStorage.getItem(KEYS.sessions);
  if (sessionsRaw !== null) {
    let sessions: Session[] = [];
    try {
      const parsed = JSON.parse(sessionsRaw);
      if (Array.isArray(parsed)) {
        sessions = parsed.map(sanitizeSession).filter((s): s is Session => s !== null);
      }
    } catch {
      sessions = [];
    }
    let activeSessionId = localStorage.getItem(KEYS.activeId);
    if (!activeSessionId || !sessions.some((s) => s.id === activeSessionId)) {
      activeSessionId = sessions[0]?.id ?? null;
    }
    return { appConfig: readAppConfig(), language, theme, sessions, activeSessionId };
  }

  const migrated = migrateLegacy();
  if (migrated) {
    return {
      appConfig: migrated.appConfig,
      language,
      theme,
      sessions: [migrated.session],
      activeSessionId: migrated.session.id
    };
  }

  return { appConfig: { ...defaultAppConfig }, language, theme, sessions: [], activeSessionId: null };
}

export function persistAppConfig(config: AppConfig) {
  localStorage.setItem(KEYS.appConfig, JSON.stringify(config));
}

export function persistSessions(sessions: Session[]) {
  localStorage.setItem(KEYS.sessions, JSON.stringify(sessions));
}

export function persistActiveId(id: string | null) {
  if (id) localStorage.setItem(KEYS.activeId, id);
  else localStorage.removeItem(KEYS.activeId);
}

export function persistLanguage(language: Language) {
  localStorage.setItem(KEYS.language, language);
}

export function persistTheme(theme: ThemeMode) {
  localStorage.setItem(KEYS.theme, theme);
}

/** Build a fresh, blank session with a numbered auto name. */
export function createSession(t: Translations, existing: Session[]): Session {
  const used = new Set(existing.map((s) => s.name));
  let index = existing.length + 1;
  let name = `${t.untitledSession} ${index}`;
  while (used.has(name)) {
    index += 1;
    name = `${t.untitledSession} ${index}`;
  }
  return {
    id: makeId(),
    name,
    autoNamed: true,
    config: { ...defaultSessionConfig, inputFiles: [] },
    createdAt: now(),
    updatedAt: now()
  };
}

/** Deep-clone a session's config into a new session (runtime is not copied). */
export function cloneSession(source: Session, t: Translations): Session {
  return {
    id: makeId(),
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
