// Tier-A app-data sync (v2): mirror data to Firestore (the sync *metadata* layer). Two scopes:
//   • per-user WORKSPACE (`envs/{env}/workspaces/{uid}`) — appConfig/projects/sessions, keyed by the
//     signed-in user's Firebase uid so users don't clobber each other (and rules enforce it).
//   • shared LIBRARY (`envs/{env}/library/list`) — one source of truth for the whole team.
// Source `.spine` assets + thumbnails stay on the Shared Drive; only this small recreatable
// metadata lives in Firestore so security rules can block deletion. Paths under the shared source
// tree are still stored relative to `${SPINE_ROOT}` and rebased to each machine's drive letter on
// load (the anchor is derived from the mounted app-data root). This module is pure logic + thin
// Firestore IO; orchestration lives in useSync.ts. Machine-local settings (Spine.exe path) are
// NEVER written into a profile.

import { getDoc, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';
import { currentUid, envDoc } from './firebase';
import {
  defaultAppConfig,
  type AppConfig,
  type Library,
  type Project,
  type Session,
  type SessionConfig
} from './config';
import { persistAppConfig, persistLibraries, persistProjects, persistSessions } from './sessions';

// Legacy filesystem names kept only for the path helpers used by callers/tests (sidecars + tests).
const WORKSPACE_FILE = 'profile.json';
const LIBRARY_LIST_FILE = 'libraries.json';
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

// Legacy filesystem paths — retained for the one-time migration importer (reads the old JSON files)
// and the sidecars that still live under `library/`. The live sync IO now targets Firestore.
export function workspaceProfilePath(appDataDir: string, email: string): string {
  return joinPath(joinPath(joinPath(appDataDir, 'workspaces'), slugifyEmail(email)), WORKSPACE_FILE);
}
export function libraryListPath(appDataDir: string): string {
  return joinPath(libraryDataDir(appDataDir), LIBRARY_LIST_FILE);
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

// ---- Firestore IO: read / write profile documents --------------------------
// `updatedAt` is written with the server clock (`serverTimestamp()`) so newer-wins reconcile no
// longer depends on each machine's local clock; we read the resolved value back as millis and
// return it so the caller stamps the exact same value it'll later compare against (no drift →
// no spurious reload). Documents are never deleted — protection is via security rules + PITR.

/** Firestore `Timestamp` (or a legacy numeric) → epoch millis; null if neither. */
function tsToMillis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

/** Reads the signed-in user's own workspace doc (`envs/{env}/workspaces/{uid}`). */
export async function readWorkspaceProfile(): Promise<WorkspaceProfile | null> {
  const uid = currentUid();
  if (!uid) return null;
  const snap = await getDoc(envDoc('workspaces', uid));
  if (!snap.exists()) return null;
  const d = snap.data();
  const updatedAt = tsToMillis(d.updatedAt);
  if (updatedAt === null || !Array.isArray(d.projects) || !Array.isArray(d.sessions)) return null;
  return {
    schema: typeof d.schema === 'number' ? d.schema : SCHEMA,
    updatedAt,
    appConfig: d.appConfig,
    projects: d.projects,
    sessions: d.sessions
  };
}

/** Writes the workspace doc; returns the server-resolved `updatedAt` in millis. */
export async function writeWorkspaceProfile(profile: WorkspaceProfile): Promise<number> {
  const uid = currentUid();
  if (!uid) throw new Error('Chưa đăng nhập Firebase — không thể đồng bộ workspace.');
  const ref = envDoc('workspaces', uid);
  await setDoc(ref, {
    schema: profile.schema,
    appConfig: profile.appConfig,
    projects: profile.projects,
    sessions: profile.sessions,
    updatedAt: serverTimestamp()
  });
  const snap = await getDoc(ref);
  return tsToMillis(snap.get('updatedAt')) ?? profile.updatedAt;
}

/** Reads the shared library list doc (`envs/{env}/library/list`). */
export async function readLibraryProfile(): Promise<LibraryProfile | null> {
  const snap = await getDoc(envDoc('library', 'list'));
  if (!snap.exists()) return null;
  const d = snap.data();
  const updatedAt = tsToMillis(d.updatedAt);
  if (updatedAt === null || !Array.isArray(d.libraries)) return null;
  return { schema: typeof d.schema === 'number' ? d.schema : SCHEMA, updatedAt, libraries: d.libraries };
}

/** Writes the shared library list doc; returns the server-resolved `updatedAt` in millis. */
export async function writeLibraryProfile(profile: LibraryProfile): Promise<number> {
  const ref = envDoc('library', 'list');
  await setDoc(ref, { schema: profile.schema, libraries: profile.libraries, updatedAt: serverTimestamp() });
  const snap = await getDoc(ref);
  return tsToMillis(snap.get('updatedAt')) ?? profile.updatedAt;
}
