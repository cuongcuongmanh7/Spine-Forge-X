import type { Session, SessionStatus } from './config';
import type { ValidateResult } from './types';

/**
 * Pure readiness/status logic, extracted from `useAppController` so it can be unit-tested
 * without rendering the hook. The hook imports these instead of defining them inline, so the
 * sidebar dots and the main-panel pill always agree (Property 15).
 */

/** Inputs `computeCanStart` needs — a flattened slice of the merged config + runtime. */
export type CanStartInput = {
  validationOk: boolean;
  fileCount: number;
  globalJsonPath: string;
  anyRunning: boolean;
  activeSessionId: string | null;
};

/** Whether the Start button may be enabled. Mirrors the original inline `canStart` memo. */
export function computeCanStart(input: CanStartInput): boolean {
  return (
    input.validationOk &&
    input.fileCount > 0 &&
    input.globalJsonPath.trim() !== '' &&
    !input.anyRunning &&
    input.activeSessionId !== null
  );
}

/**
 * Per-session readiness dot, based on config + validation + how many .spine files the session
 * would export. Used both for the sidebar dots and the main-panel status pill.
 */
export function statusFromValidation(
  session: Session,
  result: ValidateResult,
  fileCount: number
): SessionStatus {
  const cfg = session.config;
  const inputConfigured = cfg.inputPath.trim() !== '' || cfg.inputFiles.length > 0;
  // A global preset is now mandatory (the only export flow).
  const presetConfigured = cfg.globalJsonPath.trim() !== '';
  if (!result.ok || !inputConfigured || !presetConfigured) return 'red';
  // Input is set but the scan found no .spine files — nothing to export.
  if (fileCount === 0) return 'red';
  if (result.warnings.length > 0) return 'yellow';
  return 'green';
}
