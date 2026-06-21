// Tier-A app-data sync (v2): mirror data to JSON files under the team's shared app-data root
// (`…\Shared drives\Pamvis\spine_app_data`, auto-detected — see useAppData). Two scopes:
//   • per-user WORKSPACE (`workspaces/<emailSlug>/profile.json`) — appConfig/projects/sessions,
//     keyed by the signed-in Google account so users don't clobber each other.
//   • shared LIBRARY (`library/libraries.json` + the tag/owner & drive-meta sidecars + thumbs) —
//     one source of truth for the whole team.
// Paths under the shared source tree are stored relative to `${SPINE_ROOT}` and rebased to each
// machine's drive letter on load. This module is pure logic + thin IPC; orchestration lives in
// useSync.ts. Machine-local settings (Spine.exe path) are NEVER written into a profile.

import { invoke } from '@tauri-apps/api/core';
import {
  defaultAppConfig,
  type AppConfig,
  type Library,
  type Project,
  type Session,
  type SessionConfig
} from './config';
import { persistAppConfig, persistLibraries, persistProjects, persistSessions } from './sessions';

const WORKSPACE_FILE = 'profile.json';
const WORKSPACE_BACKUP = 'profile.bak.json';
const LIBRARY_LIST_FILE = 'libraries.json';
const LIBRARY_LIST_BACKUP = 'libraries.bak.json';
const SCHEMA = 1;
const TOKEN = '${SPINE_ROOT}';

const SYNC_KEYS = {
  enabled: 'spineforge.sync.enabled',
  workspaceSyncedAt: 'spineforge.sync.workspaceSyncedAt',
  librarySyncedAt: 'spineforge.sync.librarySyncedAt'
} as const;

export type SyncSettings = {
  enabled: boolean;
  /** updatedAt of the workspace/library profile we last read or wrote; drives newer-wins. */
  workspaceSyncedAt: number | null;
  librarySyncedAt: number | null;
};

/** Live app data the profiles are built from (passed in by the controller). */
export type SyncData = {
  appConfig: AppConfig;
  projects: Project[];
  sessions: Session[];
  libraries: Library[];
};

/** Per-user workspace profile. `appConfig` omits the machine-local `spinePath`. */
export type WorkspaceProfile = {
  schema: number;
  updatedAt: number;
  appConfig: Omit<AppConfig, 'spinePath'>;
  projects: Project[];
  sessions: Session[];
};

/** Shared library list (team-wide). */
export type LibraryProfile = {
  schema: number;
  updatedAt: number;
  libraries: Library[];
};

// ---- machine-local settings -------------------------------------------------

export function loadSyncSettings(): SyncSettings {
  const num = (key: string): number | null => {
    const raw = localStorage.getItem(key);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  // Default ON: the team works off a shared Drive, so sync is the expected mode.
  const enabledRaw = localStorage.getItem(SYNC_KEYS.enabled);
  return {
    enabled: enabledRaw === null ? true : enabledRaw === 'true',
    workspaceSyncedAt: num(SYNC_KEYS.workspaceSyncedAt),
    librarySyncedAt: num(SYNC_KEYS.librarySyncedAt)
  };
}

export function persistSyncSettings(patch: Partial<SyncSettings>): void {
  const stamp = (key: string, value: number | null | undefined) => {
    if (value === undefined) return;
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  };
  if (patch.enabled !== undefined) localStorage.setItem(SYNC_KEYS.enabled, String(patch.enabled));
  stamp(SYNC_KEYS.workspaceSyncedAt, patch.workspaceSyncedAt);
  stamp(SYNC_KEYS.librarySyncedAt, patch.librarySyncedAt);
}

// ---- path helpers -----------------------------------------------------------

function normSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

function stripTrailing(p: string): string {
  return p.replace(/[\\/]+$/, '');
}

function looksWindows(p: string): boolean {
  return p.includes('\\') || /^[a-zA-Z]:/.test(p);
}

function joinPath(folder: string, file: string): string {
  const sep = looksWindows(folder) ? '\\' : '/';
  return stripTrailing(folder) + sep + file;
}

/** Filesystem-safe folder name for a user's workspace, derived from their Google account email. */
export function slugifyEmail(email: string): string {
  return email.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '_');
}

/** `<appDataDir>/library` — the shared library data folder (list + sidecars + thumbs live here). */
export function libraryDataDir(appDataDir: string): string {
  return joinPath(appDataDir, 'library');
}

export function workspaceProfilePath(appDataDir: string, email: string): string {
  return joinPath(joinPath(joinPath(appDataDir, 'workspaces'), slugifyEmail(email)), WORKSPACE_FILE);
}
export function workspaceBackupPath(appDataDir: string, email: string): string {
  return joinPath(joinPath(joinPath(appDataDir, 'workspaces'), slugifyEmail(email)), WORKSPACE_BACKUP);
}
export function libraryListPath(appDataDir: string): string {
  return joinPath(libraryDataDir(appDataDir), LIBRARY_LIST_FILE);
}
export function libraryListBackupPath(appDataDir: string): string {
  return joinPath(libraryDataDir(appDataDir), LIBRARY_LIST_BACKUP);
}

// ---- path tokenize / rebase -------------------------------------------------

/** Absolute path → `${SPINE_ROOT}/rel` when it lives under `spineRoot` (case-insensitive,
 *  Windows-friendly); otherwise the path is left absolute. */
export function tokenizePath(abs: string, spineRoot: string): string {
  if (!abs || !spineRoot) return abs;
  const root = stripTrailing(normSlashes(spineRoot));
  const path = normSlashes(abs);
  const lowerRoot = root.toLowerCase();
  const lowerPath = path.toLowerCase();
  if (lowerPath === lowerRoot) return TOKEN;
  if (lowerPath.startsWith(lowerRoot + '/')) return TOKEN + path.slice(root.length); // keeps leading '/'
  return abs;
}

/**
 * The rebasing anchor: the Google Drive "Shared drives" mount (`G:\Shared drives`). When a path
 * sits under such a mount, anchor at the mount so projects in sibling drives stay portable across
 * machines (drive letters differ: G:\ vs F:\); otherwise the path itself is the anchor.
 */
export function deriveAnchor(root: string): string {
  if (!root) return root;
  const match = normSlashes(root).match(/^(.*?\/Shared drives)(?:\/.*)?$/i);
  if (!match) return root;
  return looksWindows(root) ? match[1].replace(/\//g, '\\') : match[1];
}

/** Reverse of tokenizePath against the local machine's Spine root. */
export function resolvePath(token: string, spineRoot: string): string {
  if (!token || !token.startsWith(TOKEN)) return token;
  const root = stripTrailing(spineRoot);
  const joined = root + token.slice(TOKEN.length); // slice keeps leading '/'
  return looksWindows(root) ? joined.replace(/\//g, '\\') : joined;
}

function mapConfigPaths(config: SessionConfig, fn: (p: string) => string): SessionConfig {
  return {
    ...config,
    inputPath: fn(config.inputPath),
    inputFiles: config.inputFiles.map(fn),
    excludedFiles: (config.excludedFiles ?? []).map(fn)
    // outputPath / linked Unity roots stay absolute for now (flagged for a later ${UNITY_ROOT}).
  };
}

// ---- build / apply ----------------------------------------------------------

export function buildWorkspaceProfile(data: SyncData, anchor: string, updatedAt: number): WorkspaceProfile {
  const { spinePath: _omit, ...appConfig } = data.appConfig;
  return {
    schema: SCHEMA,
    updatedAt,
    appConfig,
    projects: data.projects,
    sessions: data.sessions.map((s) => ({ ...s, config: mapConfigPaths(s.config, (p) => tokenizePath(p, anchor)) }))
  };
}

/** Write a workspace profile into localStorage (preserving the machine-local spinePath). Caller reloads. */
export function applyWorkspaceProfile(profile: WorkspaceProfile, anchor: string, localSpinePath: string): void {
  const appConfig = { ...defaultAppConfig, ...profile.appConfig, spinePath: localSpinePath } as AppConfig;
  persistAppConfig(appConfig);
  persistProjects(profile.projects);
  persistSessions(profile.sessions.map((s) => ({ ...s, config: mapConfigPaths(s.config, (p) => resolvePath(p, anchor)) })));
}

export function buildLibraryProfile(libraries: Library[], anchor: string, updatedAt: number): LibraryProfile {
  return {
    schema: SCHEMA,
    updatedAt,
    libraries: libraries.map((l) => ({ ...l, rootPath: tokenizePath(l.rootPath, anchor) }))
  };
}

/** Write the shared library list into localStorage. Caller reloads. */
export function applyLibraryProfile(profile: LibraryProfile, anchor: string): void {
  persistLibraries(profile.libraries.map((l) => ({ ...l, rootPath: resolvePath(l.rootPath, anchor) })));
}

/** Stable comparison ignoring `updatedAt` — used to skip no-op writes. */
export function sameWorkspaceBody(a: WorkspaceProfile, b: WorkspaceProfile): boolean {
  const body = (p: WorkspaceProfile) => JSON.stringify({ appConfig: p.appConfig, projects: p.projects, sessions: p.sessions });
  return body(a) === body(b);
}
export function sameLibraryBody(a: LibraryProfile, b: LibraryProfile): boolean {
  return JSON.stringify(a.libraries) === JSON.stringify(b.libraries);
}

// ---- IPC: read / write profile files ---------------------------------------

async function readJson<T>(path: string): Promise<T | null> {
  if (!path) return null;
  const content = await invoke<string | null>('read_text_file', { path }).catch(() => null);
  if (!content) return null;
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function writeJson(path: string, data: unknown, backupPath?: string): Promise<void> {
  const body = JSON.stringify(data, null, 2);
  if (backupPath) {
    const existing = await invoke<string | null>('read_text_file', { path }).catch(() => null);
    if (existing) await invoke('write_text_file', { path: backupPath, content: existing }).catch(() => undefined);
  }
  await invoke('write_text_file', { path, content: body });
}

export async function readWorkspaceProfile(path: string): Promise<WorkspaceProfile | null> {
  const parsed = await readJson<WorkspaceProfile>(path);
  if (!parsed || typeof parsed.updatedAt !== 'number') return null;
  if (!Array.isArray(parsed.projects) || !Array.isArray(parsed.sessions)) return null;
  return parsed;
}
export function writeWorkspaceProfile(path: string, backupPath: string, profile: WorkspaceProfile): Promise<void> {
  return writeJson(path, profile, backupPath);
}

export async function readLibraryProfile(path: string): Promise<LibraryProfile | null> {
  const parsed = await readJson<LibraryProfile>(path);
  if (!parsed || typeof parsed.updatedAt !== 'number' || !Array.isArray(parsed.libraries)) return null;
  return parsed;
}
export function writeLibraryProfile(path: string, backupPath: string, profile: LibraryProfile): Promise<void> {
  return writeJson(path, profile, backupPath);
}
