import type { LinkedProject, MergedConfig, SessionRuntime } from './config';
import { resolveLinkedTarget } from './exportRequest';

/** Bundle the active session's ephemeral runtime into a SessionRuntime snapshot. */
export function snapshotRuntime(
  files: string[],
  skippedFiles: string[],
  logs: string[],
  lastOutputFolders: string[],
  currentIndex: number
): SessionRuntime {
  return { files, skippedFiles, logs, lastOutputFolders, currentIndex };
}

/** Prefix a log line with the current local time, e.g. "14:03:21 - scanning". */
export function stamp(text: string): string {
  return `${new Date().toLocaleTimeString()} - ${text}`;
}

/** Resolve the destination type folder ("unityRoot/destType") for a linked-project config, or ''. */
export function linkedDestFolder(cfg: MergedConfig): string {
  const linked = cfg.outputPolicy === 'linkedProject' ? resolveLinkedTarget(cfg) : null;
  if (!linked || !linked.unityRoot.trim()) return '';
  const root = linked.unityRoot.replace(/[\\/]+$/, '');
  const sep = root.includes('\\') ? '\\' : '/';
  return linked.destName.trim() ? `${root}${sep}${linked.destName.trim()}` : root;
}

/** Token before the first underscore, e.g. "0001_Fighter" -> "0001". Mirrors backend clean_source_folder_name. */
export function idToken(folderName: string): string {
  const idx = folderName.indexOf('_');
  return idx > 0 ? folderName.slice(0, idx) : folderName;
}

/** Normalize a Windows-ish path for prefix comparison: backslashes, lowercase, no trailing separator. */
export function normalizePathKey(p: string): string {
  return p.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

/**
 * For each input file, find which LinkedProject type its path belongs to: a path segment that
 * matches a type's `sourceName` (case-insensitive). Returns per-type match counts and how many
 * files matched no type — used to auto-pick the session's single Type and warn on a mix.
 */
export function detectTypesFromFiles(
  files: string[],
  project: LinkedProject
): { counts: Map<string, number>; unmatched: number } {
  const bySource = new Map(project.types.map((t) => [t.sourceName.toLowerCase(), t.sourceName]));
  const counts = new Map<string, number>();
  let unmatched = 0;
  for (const file of files) {
    const segments = file.split(/[\\/]+/).map((s) => s.toLowerCase());
    const hit = segments.map((s) => bySource.get(s)).find((name): name is string => Boolean(name));
    if (hit) counts.set(hit, (counts.get(hit) ?? 0) + 1);
    else unmatched += 1;
  }
  return { counts, unmatched };
}
