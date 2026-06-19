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
