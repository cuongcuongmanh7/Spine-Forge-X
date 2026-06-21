// Tier-A app-data sync: mirror projects/sessions/config to a single JSON profile in a
// Google-Drive-backed folder so the same workspace shows up on another machine. Paths that
// live under the shared source tree are stored relative to a `${SPINE_ROOT}` token and
// rebased to each machine's own Spine root on load (drive letters differ: G:\ vs F:\).
//
// This module is pure logic + thin IPC; the orchestration (when to read/write) lives in
// useSync.ts. Machine-local settings (sync folder, Spine root, Spine.exe path) are NEVER
// written into the profile — they differ per machine.

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

const PROFILE_FILE = 'spineforge-profile.json';
const BACKUP_FILE = 'spineforge-profile.bak.json';
const SCHEMA = 1;
const TOKEN = '${SPINE_ROOT}';

const SYNC_KEYS = {
  enabled: 'spineforge.sync.enabled',
  root: 'spineforge.sync.root',
  lastSyncedAt: 'spineforge.sync.lastSyncedAt',
  // Legacy keys (pre-merge) read once for migration into `root`.
  legacyFolder: 'spineforge.sync.folder',
  legacySpineRoot: 'spineforge.sync.spineRoot'
} as const;

export type SyncSettings = {
  enabled: boolean;
  /** The shared Google Drive root: BOTH where the profile file lives AND the `${SPINE_ROOT}`
   *  rebasing anchor. A common parent like `G:\Shared drives` so every project's source sits
   *  under it. */
  root: string;
  /** updatedAt of the profile we last read or wrote; drives newer-wins reconciliation. */
  lastSyncedAt: number | null;
};

/** Live app data the profile is built from (passed in by the controller). */
export type SyncData = {
  appConfig: AppConfig;
  projects: Project[];
  sessions: Session[];
  libraries: Library[];
};

/** On-disk profile. `appConfig` omits the machine-local `spinePath`. */
export type SyncProfile = {
  schema: number;
  updatedAt: number;
  appConfig: Omit<AppConfig, 'spinePath'>;
  projects: Project[];
  sessions: Session[];
  libraries: Library[];
};

// ---- machine-local settings -------------------------------------------------

export function loadSyncSettings(): SyncSettings {
  const lastRaw = localStorage.getItem(SYNC_KEYS.lastSyncedAt);
  const last = lastRaw ? Number(lastRaw) : NaN;
  // Default ON: the team works off a shared Drive, so sync is the expected mode.
  const enabledRaw = localStorage.getItem(SYNC_KEYS.enabled);
  // Merged `root` falls back to the legacy spineRoot (the rebasing anchor mattered most), then folder.
  const root =
    localStorage.getItem(SYNC_KEYS.root) ??
    localStorage.getItem(SYNC_KEYS.legacySpineRoot) ??
    localStorage.getItem(SYNC_KEYS.legacyFolder) ??
    '';
  return {
    enabled: enabledRaw === null ? true : enabledRaw === 'true',
    root,
    lastSyncedAt: Number.isFinite(last) ? last : null
  };
}

export function persistSyncSettings(patch: Partial<SyncSettings>): void {
  if (patch.enabled !== undefined) localStorage.setItem(SYNC_KEYS.enabled, String(patch.enabled));
  if (patch.root !== undefined) localStorage.setItem(SYNC_KEYS.root, patch.root);
  if (patch.lastSyncedAt !== undefined) {
    if (patch.lastSyncedAt === null) localStorage.removeItem(SYNC_KEYS.lastSyncedAt);
    else localStorage.setItem(SYNC_KEYS.lastSyncedAt, String(patch.lastSyncedAt));
  }
}

// ---- path tokenize / rebase -------------------------------------------------

function normSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

function stripTrailing(p: string): string {
  return p.replace(/[\\/]+$/, '');
}

function looksWindows(p: string): boolean {
  return p.includes('\\') || /^[a-zA-Z]:/.test(p);
}

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
 * The rebasing anchor derived from the chosen sync folder. The Google Drive "Shared drives" mount
 * (`G:\Shared drives`) is a virtual listing — you can't write files at that level, only inside a
 * specific shared drive. So the user points the sync FILE at a writable folder (e.g.
 * `G:\Shared drives\FD`), while paths must still rebase against the whole mount so projects in
 * sibling drives (FD, DH) stay portable. When `root` sits under a `Shared drives` mount, anchor at
 * that mount; otherwise the folder itself is the anchor.
 */
/** True for the bare `G:\Shared drives` mount — a virtual listing you can't write files into,
 *  so it must not be used as the sync folder (treated as "unconfigured"). */
export function isVirtualMount(root: string): boolean {
  return /^[A-Za-z]:[\\/]Shared drives[\\/]*$/i.test(root.trim());
}

export function deriveAnchor(root: string): string {
  if (!root) return root;
  const match = normSlashes(root).match(/^(.*?\/Shared drives)(?:\/.*)?$/i);
  if (!match) return root;
  return looksWindows(root) ? match[1].replace(/\//g, '\\') : match[1];
}

/** Shared folder (relative to the Shared drives mount) where skeleton thumbnails are cached so the
 *  whole team reuses them instead of each machine re-rendering. */
const THUMBS_DRIVE_SUBPATH = 'Pamvis/spine_app_data/thumbs';

/**
 * Absolute thumbnail-cache folder on THIS machine's Drive mount, or '' when we can't resolve a
 * Shared drives mount (then the caller falls back to the per-machine app cache). Anchored at the
 * mount via {@link deriveAnchor}, so it lands at `<letter>:\Shared drives\Pamvis\spine_app_data\thumbs`
 * regardless of which shared drive the sync root points at or which letter the mount uses.
 */
export function driveThumbsDir(syncRoot: string): string {
  if (!syncRoot) return '';
  const anchor = deriveAnchor(syncRoot);
  // Only meaningful when anchored at a real "Shared drives" mount.
  if (!/\/Shared drives$/i.test(normSlashes(anchor))) return '';
  const joined = `${stripTrailing(normSlashes(anchor))}/${THUMBS_DRIVE_SUBPATH}`;
  return looksWindows(anchor) ? joined.replace(/\//g, '\\') : joined;
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

export function buildProfile(data: SyncData, spineRoot: string, updatedAt: number): SyncProfile {
  const { spinePath: _omit, ...appConfig } = data.appConfig;
  return {
    schema: SCHEMA,
    updatedAt,
    appConfig,
    projects: data.projects,
    sessions: data.sessions.map((s) => ({ ...s, config: mapConfigPaths(s.config, (p) => tokenizePath(p, spineRoot)) })),
    libraries: data.libraries.map((l) => ({ ...l, rootPath: tokenizePath(l.rootPath, spineRoot) }))
  };
}

/** Write a profile into localStorage (preserving the machine-local spinePath). Caller reloads. */
export function applyProfile(profile: SyncProfile, spineRoot: string, localSpinePath: string): void {
  const appConfig = { ...defaultAppConfig, ...profile.appConfig, spinePath: localSpinePath } as AppConfig;
  persistAppConfig(appConfig);
  persistProjects(profile.projects);
  persistSessions(profile.sessions.map((s) => ({ ...s, config: mapConfigPaths(s.config, (p) => resolvePath(p, spineRoot)) })));
  persistLibraries(profile.libraries.map((l) => ({ ...l, rootPath: resolvePath(l.rootPath, spineRoot) })));
}

/** Stable comparison of two profiles ignoring `updatedAt` — used to skip no-op writes. */
export function sameProfileBody(a: SyncProfile, b: SyncProfile): boolean {
  const body = (p: SyncProfile) =>
    JSON.stringify({ appConfig: p.appConfig, projects: p.projects, sessions: p.sessions, libraries: p.libraries });
  return body(a) === body(b);
}

// ---- IPC: read / write the profile file ------------------------------------

function joinPath(folder: string, file: string): string {
  const sep = looksWindows(folder) ? '\\' : '/';
  return stripTrailing(folder) + sep + file;
}

export async function readProfileFile(folder: string): Promise<SyncProfile | null> {
  if (!folder) return null;
  const content = await invoke<string | null>('read_text_file', { path: joinPath(folder, PROFILE_FILE) });
  if (!content) return null;
  try {
    const parsed = JSON.parse(content) as SyncProfile;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.updatedAt !== 'number') return null;
    if (!Array.isArray(parsed.projects) || !Array.isArray(parsed.sessions)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeProfileFile(folder: string, profile: SyncProfile): Promise<void> {
  const body = JSON.stringify(profile, null, 2);
  // Best-effort backup of the previous profile before overwriting.
  const existing = await invoke<string | null>('read_text_file', { path: joinPath(folder, PROFILE_FILE) }).catch(() => null);
  if (existing) {
    await invoke('write_text_file', { path: joinPath(folder, BACKUP_FILE), content: existing }).catch(() => undefined);
  }
  await invoke('write_text_file', { path: joinPath(folder, PROFILE_FILE), content: body });
}
