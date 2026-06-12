import { invoke } from '@tauri-apps/api/core';
import type { AppConfig, MergedConfig, Session, SessionOverlap, SessionStatus } from './config';
import type { ScanResult, ValidateResult } from './types';
import { statusFromValidation } from './validation';
import { buildExportRequestFrom, resolveLinkedTarget } from './exportRequest';

type SessionProbe = {
  id: string;
  projectId: string;
  status: SessionStatus;
  files: string[];
  outDirs: string[];
};

/**
 * Resolve, for one session, the readiness status plus the concrete input files and
 * output directories it would produce. Files come from the in-memory runtime →
 * saved inputFiles → a folder scan, mirroring the Export-all preflight.
 */
async function probeSession(
  session: Session,
  appConfig: AppConfig,
  runtimeFiles: string[] | undefined
): Promise<SessionProbe> {
  const cfg: MergedConfig = { ...appConfig, ...session.config };
  let files = runtimeFiles ?? [];
  if (files.length === 0 && session.config.inputFiles.length > 0) files = session.config.inputFiles;
  if (files.length === 0 && session.config.inputPath.trim()) {
    try {
      const scan = await invoke<ScanResult>('scan_spine_files', { inputPath: session.config.inputPath });
      files = scan.files;
    } catch {
      files = [];
    }
  }
  // Drop files the user moved to "not exported" — Export all skips them, so they must not
  // count toward overlap. Applied to every source: the runtime cache can hold a pre-exclusion
  // snapshot of the active session, so filtering only the fresh scan branch leaked excluded files.
  const excluded = new Set(session.config.excludedFiles ?? []);
  if (excluded.size > 0) files = files.filter((f) => !excluded.has(f));

  let status: SessionStatus = 'red';
  try {
    const result = await invoke<ValidateResult>('validate_settings', {
      spinePath: cfg.spinePath,
      outputPath: cfg.outputPolicy === 'linkedProject' ? resolveLinkedTarget(cfg)?.unityRoot ?? '' : cfg.outputPath,
      outputPolicy: cfg.outputPolicy,
      exportMode: cfg.exportMode,
      globalJsonPath: cfg.globalJsonPath
    });
    status = statusFromValidation(session, result, files.length);
  } catch {
    status = 'red';
  }

  // Best-effort: resolve where these files land so we can flag two sessions sharing a folder.
  let outDirs: string[] = [];
  if (files.length > 0) {
    try {
      outDirs = await invoke<string[]>('resolve_output_dirs', { request: buildExportRequestFrom(cfg, files) });
    } catch {
      outDirs = [];
    }
  }

  return { id: session.id, projectId: session.projectId, status, files, outDirs };
}

/**
 * Per-session, per-file map of which OTHER sessions also include that input file.
 * Shape: `{ [sessionId]: { [filePath]: otherSessionIds[] } }`. Only shared files appear,
 * so the input list can flag the exact rows that overlap (and name the other sessions).
 */
export type SharedInputMap = Record<string, Record<string, string[]>>;

/**
 * Cross-session overlap, scoped per project (Export all runs one project at a time, so only
 * same-project sessions can collide in a single batch). A file or output dir owned by more
 * than one session marks every owner: sharedInput (attention) and/or outputCollision (danger).
 * Also returns the per-file sharing map for the input-list badges.
 */
function computeOverlaps(probes: SessionProbe[]): {
  overlaps: Record<string, SessionOverlap>;
  sharedInputFiles: SharedInputMap;
} {
  const overlaps: Record<string, SessionOverlap> = {};
  const sharedInputFiles: SharedInputMap = {};
  const byProject = new Map<string, SessionProbe[]>();
  for (const p of probes) {
    const list = byProject.get(p.projectId) ?? [];
    list.push(p);
    byProject.set(p.projectId, list);
  }
  for (const group of byProject.values()) {
    const fileOwners = new Map<string, Set<string>>();
    const dirOwners = new Map<string, Set<string>>();
    for (const p of group) {
      for (const f of p.files) {
        const owners = fileOwners.get(f) ?? new Set<string>();
        owners.add(p.id);
        fileOwners.set(f, owners);
      }
      for (const d of p.outDirs) {
        const owners = dirOwners.get(d) ?? new Set<string>();
        owners.add(p.id);
        dirOwners.set(d, owners);
      }
    }
    const sharedInput = new Set<string>();
    for (const [file, owners] of fileOwners) {
      if (owners.size <= 1) continue;
      const ids = [...owners];
      ids.forEach((id) => sharedInput.add(id));
      // For each owner, record the OTHER owners of this exact file.
      for (const id of ids) {
        (sharedInputFiles[id] ??= {})[file] = ids.filter((other) => other !== id);
      }
    }
    const outputCollision = new Set<string>();
    for (const owners of dirOwners.values()) if (owners.size > 1) owners.forEach((id) => outputCollision.add(id));
    for (const p of group) {
      overlaps[p.id] = { sharedInput: sharedInput.has(p.id), outputCollision: outputCollision.has(p.id) };
    }
  }
  return { overlaps, sharedInputFiles };
}

/**
 * Probe every session for its readiness dot and cross-session overlap badge, in one pass.
 * `runtimeFilesById` supplies the in-memory scanned file list for sessions that have one.
 */
export async function computeSessionStatuses(
  sessions: Session[],
  appConfig: AppConfig,
  runtimeFilesById: Record<string, string[]>
): Promise<{
  statuses: Record<string, SessionStatus>;
  overlaps: Record<string, SessionOverlap>;
  sharedInputFiles: SharedInputMap;
}> {
  const probes = await Promise.all(sessions.map((s) => probeSession(s, appConfig, runtimeFilesById[s.id])));
  const statuses = Object.fromEntries(probes.map((p) => [p.id, p.status]));
  const { overlaps, sharedInputFiles } = computeOverlaps(probes);
  return { statuses, overlaps, sharedInputFiles };
}
