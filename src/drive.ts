// Tier-B Google Drive metadata: owner / last-modified / revision history for `.spine` files,
// read on demand through the Rust backend (which owns the OAuth + Drive REST calls). This module
// is pure types + thin IPC, plus the local→Drive path mapping that reuses Tier-A's anchor logic.

import { invoke } from '@tauri-apps/api/core';
import { deriveAnchor, tokenizePath } from './sync';

const TOKEN = '${SPINE_ROOT}';

export type DriveAccount = {
  email: string;
  displayName: string;
  photoLink: string | null;
};

export type DriveRevision = {
  id: string;
  modifiedTime: string | null;
  editorName: string | null;
  editorEmail: string | null;
  size: string | null;
};

export type DriveFileInfo = {
  ownerEmail: string | null;
  ownerName: string | null;
  modifiedTime: string | null;
  lastEditorEmail: string | null;
  lastEditorName: string | null;
  size: string | null;
  revisions: DriveRevision[];
};

/**
 * Turn an absolute `.spine` path into the form the backend resolves against the Drive API:
 * `<shared-drive-name>/<folder>/.../file.spine` (forward slashes). Anchored at the same
 * `…\Shared drives` mount Tier-A rebases against, so the first segment is the shared-drive name.
 * Returns `null` when the file lives outside the synced Drive root (→ "not on Drive").
 */
export function toDriveRelPath(absFile: string, syncRoot: string): string | null {
  if (!absFile || !syncRoot) return null;
  const anchor = deriveAnchor(syncRoot);
  const token = tokenizePath(absFile, anchor);
  if (!token.startsWith(TOKEN)) return null; // outside the anchor — not portable / not on Drive
  const rel = token.slice(TOKEN.length).replace(/\\/g, '/').replace(/^\/+/, '');
  return rel || null;
}

export function getDriveAccount(): Promise<DriveAccount | null> {
  return invoke<DriveAccount | null>('drive_account');
}

export function driveSignIn(): Promise<DriveAccount> {
  return invoke<DriveAccount>('drive_sign_in');
}

export function driveSignOut(): Promise<void> {
  return invoke('drive_sign_out');
}

export function fetchDriveFileMetadata(relPath: string): Promise<DriveFileInfo> {
  return invoke<DriveFileInfo>('drive_file_metadata', { relPath });
}

/** Lightweight owner + last-modified for the Library dashboard columns. */
export type DriveBasic = {
  relPath: string;
  ownerEmail: string | null;
  ownerName: string | null;
  /** Fallback for the Owner column on shared drives (which have no per-file owner). */
  lastEditorEmail: string | null;
  lastEditorName: string | null;
  modifiedTime: string | null;
  error: string | null;
};

export function fetchDriveBasics(relPaths: string[]): Promise<DriveBasic[]> {
  return invoke<DriveBasic[]>('drive_files_basic', { relPaths });
}

/** Download a past revision to a temp file; returns its local path (open it in Spine). */
export function downloadDriveRevision(relPath: string, revisionId: string): Promise<string> {
  return invoke<string>('drive_open_revision', { relPath, revisionId });
}

// ---- cross-machine dashboard cache (sidecar in the synced Drive folder) -----
// Stored next to the Tier-A profile, keyed by machine-independent Drive relPath, so the
// owner/last-modified you loaded at the office shows up at home (Google Drive syncs the file).

const DRIVE_META_FILE = 'spineforge-drive-meta.json';

function metaFilePath(folder: string): string {
  const win = folder.includes('\\') || /^[a-zA-Z]:/.test(folder);
  const sep = win ? '\\' : '/';
  return folder.replace(/[\\/]+$/, '') + sep + DRIVE_META_FILE;
}

export async function readDriveMetaSidecar(folder: string): Promise<Record<string, DriveBasic>> {
  if (!folder) return {};
  const content = await invoke<string | null>('read_text_file', { path: metaFilePath(folder) }).catch(() => null);
  if (!content) return {};
  try {
    const parsed = JSON.parse(content) as Record<string, DriveBasic>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function writeDriveMetaSidecar(folder: string, map: Record<string, DriveBasic>): Promise<void> {
  if (!folder) return;
  await invoke('write_text_file', { path: metaFilePath(folder), content: JSON.stringify(map) });
}
