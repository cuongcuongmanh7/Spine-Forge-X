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
      const excluded = new Set(session.config.excludedFiles ?? []);
      files = scan.files.filter((f) => !excluded.has(f));
    } catch {
      files = [];
    }
  }

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
 * Cross-session overlap, scoped per project (Export all runs one project at a time, so only
 * same-project sessions can collide in a single batch). A file or output dir owned by more
 * than one session marks every owner: sharedInput (attention) and/or outputCollision (danger).
 */
function computeOverlaps(probes: SessionProbe[]): Record<string, SessionOverlap> {
  const overlaps: Record<string, SessionOverlap> = {};
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
    for (const owners of fileOwners.values()) if (owners.size > 1) owners.forEach((id) => sharedInput.add(id));
    const outputCollision = new Set<string>();
    for (const owners of dirOwners.values()) if (owners.size > 1) owners.forEach((id) => outputCollision.add(id));
    for (const p of group) {
      overlaps[p.id] = { sharedInput: sharedInput.has(p.id), outputCollision: outputCollision.has(p.id) };
    }
  }
  return overlaps;
}

/**
 * Probe every session for its readiness dot and cross-session overlap badge, in one pass.
 * `runtimeFilesById` supplies the in-memory scanned file list for sessions that have one.
 */
export async function computeSessionStatuses(
  sessions: Session[],
  appConfig: AppConfig,
  runtimeFilesById: Record<string, string[]>
): Promise<{ statuses: Record<string, SessionStatus>; overlaps: Record<string, SessionOverlap> }> {
  const probes = await Promise.all(sessions.map((s) => probeSession(s, appConfig, runtimeFilesById[s.id])));
  const statuses = Object.fromEntries(probes.map((p) => [p.id, p.status]));
  return { statuses, overlaps: computeOverlaps(probes) };
}
