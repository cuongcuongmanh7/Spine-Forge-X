import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { confirm, message, save } from '@tauri-apps/plugin-dialog';
import type { AppConfig, ExportRecord, MergedConfig, Session, SessionRuntime } from './config';
import { formatSummary, type Translations } from './i18n';
import { buildExportRequestFrom, resolveLinkedTarget } from './exportRequest';
import { commonParentPath } from './paths';
import { linkedDestFolder, stamp } from './controllerHelpers';
import type { BatchExportResult, ScanResult, ToastKind, ValidateResult } from './types';

type Options = {
  merged: MergedConfig;
  appConfig: AppConfig;
  sessions: Session[];
  activeSessionId: string | null;
  files: string[];
  logs: string[];
  lastOutputFolders: string[];
  /** Computed by the controller from validation + files + running state. */
  canStart: boolean;
  anyRunning: boolean;
  isPackFolder: boolean;
  // Live overlay progress lives in the controller (shared with the clean-source scan reset).
  setLiveProgress: React.Dispatch<React.SetStateAction<{ current: number; total: number; file: string }>>;
  // Shared running state (owned by the controller, also touched by workspace lifecycle).
  setRunningSessionId: (id: string | null) => void;
  runningIdRef: React.MutableRefObject<string | null>;
  activeIdRef: React.MutableRefObject<string | null>;
  runtimeByIdRef: React.MutableRefObject<Record<string, SessionRuntime>>;
  // Runtime mutators (owned by workspace).
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
  setCurrentIndex: React.Dispatch<React.SetStateAction<number>>;
  captureActiveRuntime: () => void;
  recordRunLog: (line: string) => void;
  recordRunProgress: (current: number) => void;
  recordRunOutput: (folders: string[]) => void;
  setProjectMenuOpenId: (id: string | null) => void;
  appendLog: (text: string) => void;
  pushToast: (text: string, kind?: ToastKind) => void;
  t: Translations;
};

/**
 * Export engine: single-session and project-wide ("Export all") batch export, the blocking-run
 * overlay state (live/batch progress, active jobs, elapsed timer), output-folder opening, and
 * log saving. Listens to the backend's spine-log/error/progress/job-start events and routes
 * them to the running session via the workspace's recordRun* helpers. Extracted from
 * useAppController; the controller passes shared state in and spreads the API back into context.
 */
export function useExportEngine({
  merged,
  appConfig,
  sessions,
  activeSessionId,
  files,
  logs,
  lastOutputFolders,
  canStart,
  anyRunning,
  isPackFolder,
  setLiveProgress,
  setRunningSessionId,
  runningIdRef,
  activeIdRef,
  runtimeByIdRef,
  setSessions,
  setCurrentIndex,
  captureActiveRuntime,
  recordRunLog,
  recordRunProgress,
  recordRunOutput,
  setProjectMenuOpenId,
  appendLog,
  pushToast,
  t
}: Options) {
  // Set during "Export all" so the overlay can show "session X / Y".
  const [batchProgress, setBatchProgress] = useState<{ index: number; count: number } | null>(null);
  // Files currently being exported (file → epoch ms the job started), for the overlay job list.
  const [activeJobs, setActiveJobs] = useState<Record<string, number>>({});
  // Epoch ms the current run (or Export-all batch) started, for the overlay elapsed timer.
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [isOpeningOutput, setIsOpeningOutput] = useState(false);
  // Last output folder the app opened (auto or manual) — used to avoid re-opening
  // the same folder right after another export.
  const lastOpenedOutputRef = useRef<string | null>(null);

  useEffect(() => {
    let unlisten: Promise<Array<() => void>> | null = null;
    try {
      unlisten = Promise.all([
        listen<string>('spine-log', (event) => recordRunLog(stamp(event.payload))),
        listen<string>('spine-error', (event) => recordRunLog(stamp(`[ERROR] ${event.payload}`))),
        listen<string>('spine-job-start', (event) => {
          setActiveJobs((jobs) => ({ ...jobs, [event.payload]: Date.now() }));
        }),
        listen<{ current: number; total: number; file: string }>('spine-progress', (event) => {
          recordRunProgress(event.payload.current);
          setLiveProgress({ current: event.payload.current, total: event.payload.total, file: event.payload.file });
          setActiveJobs((jobs) => {
            if (!(event.payload.file in jobs)) return jobs;
            const { [event.payload.file]: _done, ...rest } = jobs;
            return rest;
          });
          recordRunLog(stamp(`[PROGRESS] ${event.payload.current}/${event.payload.total} ${event.payload.file}`));
        })
      ]);
    } catch (error) {
      console.warn('Event listeners unavailable:', error);
    }
    return () => {
      unlisten?.then((callbacks) => callbacks.forEach((callback) => callback())).catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Persist a session's latest export summary (counts + time) for the project dashboard. */
  function recordLastExport(sessionId: string, result: BatchExportResult, durationMs: number) {
    const record: ExportRecord = {
      at: Date.now(),
      completed: result.completed,
      failed: result.failed,
      skipped: result.skipped,
      total: result.total,
      stopped: result.stopped,
      durationMs
    };
    setSessions((list) =>
      list.map((s) =>
        s.id === sessionId ? { ...s, config: { ...s.config, lastExport: record }, updatedAt: Date.now() } : s
      )
    );
  }

  function buildExportRequest() {
    return buildExportRequestFrom(merged, files);
  }

  /** Open the export's output folder when enabled, skipping if it's the one we just opened. */
  async function maybeAutoOpenOutput(folders: string[]) {
    if (!merged.autoOpenOutputAfterExport || folders.length === 0) return;
    const target =
      folders.length === 1 ? folders[0] : commonParentPath(folders) || merged.outputPath.trim() || folders[0];
    if (!target || target === lastOpenedOutputRef.current) return;
    try {
      await invoke('open_path', { path: target });
      lastOpenedOutputRef.current = target;
    } catch (error) {
      appendLog(`${t.openOutputFailed}: ${String(error)}`);
    }
  }

  async function startExport() {
    if (!canStart || anyRunning) return;
    const sid = activeSessionId;
    if (!sid) return;

    // Pre-export reminder: in pack-folder mode unused images get packed into the
    // atlas. We only hint — cleaning is a deliberate manual action (no auto-move).
    if (isPackFolder && merged.inputPath.trim()) {
      appendLog(t.packFolderCleanHint);
    }

    // Warn before overwriting output folders that already exist.
    try {
      const existing = await invoke<string[]>('check_output_collisions', { request: buildExportRequest() });
      if (existing.length > 0) {
        const ok = await confirm(t.overwriteConfirmBody.replace('{count}', String(existing.length)), {
          title: t.overwriteConfirmTitle,
          kind: 'warning'
        });
        if (!ok) return;
      }
    } catch {
      // If the check fails, fall through and let the export proceed.
    }

    runningIdRef.current = sid;
    setRunningSessionId(sid);
    setCurrentIndex(0);
    setBatchProgress(null);
    setLiveProgress({ current: 0, total: files.length, file: '' });
    setActiveJobs({});
    const startedAt = Date.now();
    setRunStartedAt(startedAt);
    recordRunLog(stamp(`${t.starting}: ${files.length} files.`));

    try {
      const result = await invoke<BatchExportResult>('start_batch_export', { request: buildExportRequest() });
      recordRunOutput(result.outputFolders);
      recordLastExport(sid, result, Date.now() - startedAt);
      if (result.stopped) {
        const body = formatSummary(t.exportStoppedSummary, result.completed, result.failed, result.skipped);
        recordRunLog(stamp(body));
        await message(body, { title: t.exportStoppedTitle, kind: 'warning' });
      } else {
        const body = formatSummary(t.exportSummary, result.completed, result.failed, result.skipped);
        recordRunLog(stamp(t.finished));
        await message(body, { title: t.exportSuccessTitle, kind: 'info' });
      }
      await maybeAutoOpenOutput(result.outputFolders);
    } catch (error) {
      const body = String(error);
      recordRunLog(stamp(`${t.batchFailed}: ${body}`));
      await message(body, { title: t.exportFailedTitle, kind: 'error' });
    } finally {
      runningIdRef.current = null;
      setRunningSessionId(null);
      setActiveJobs({});
      setRunStartedAt(null);
    }
  }

  async function stopExport() {
    if (isStopping) return;
    setIsStopping(true);
    try {
      await invoke('stop_batch_export');
      appendLog(t.stopRequested);
    } catch (error) {
      appendLog(`${t.stopFailed}: ${String(error)}`);
    } finally {
      setIsStopping(false);
    }
  }

  /** Export every ready session in a project, sequentially. Skips sessions that aren't ready. */
  async function exportProjectSessions(projectId: string) {
    if (anyRunning) return;
    const targets = sessions.filter((s) => s.projectId === projectId);
    setProjectMenuOpenId(null);
    if (targets.length === 0) {
      pushToast(t.exportAllNothing, 'warning');
      return;
    }
    captureActiveRuntime();

    // ----- Pre-flight: classify each session and resolve its files (no UI run yet) -----
    const plan: { session: Session; files: string[] }[] = [];
    let warned = 0;
    let skipped = 0;
    for (const s of targets) {
      const cfg: MergedConfig = { ...appConfig, ...s.config };
      let result: ValidateResult = { ok: false, warnings: [], errors: [] };
      try {
        result = await invoke<ValidateResult>('validate_settings', {
          spinePath: cfg.spinePath,
          outputPath:
            cfg.outputPolicy === 'linkedProject' ? resolveLinkedTarget(cfg)?.unityRoot ?? '' : cfg.outputPath,
          outputPolicy: cfg.outputPolicy,
          exportMode: cfg.exportMode,
          globalJsonPath: cfg.globalJsonPath
        });
      } catch {
        result = { ok: false, warnings: [], errors: [] };
      }
      const inputConfigured = s.config.inputPath.trim() !== '' || s.config.inputFiles.length > 0;
      if (!result.ok || !inputConfigured) {
        skipped += 1;
        continue;
      }

      // Resolve files: in-memory runtime → saved inputFiles → scan the input folder.
      let sessionFiles = runtimeByIdRef.current[s.id]?.files ?? [];
      if (sessionFiles.length === 0 && s.config.inputFiles.length > 0) sessionFiles = s.config.inputFiles;
      if (sessionFiles.length === 0 && s.config.inputPath.trim()) {
        try {
          const scan = await invoke<ScanResult>('scan_spine_files', { inputPath: s.config.inputPath });
          const excluded = new Set(s.config.excludedFiles ?? []);
          sessionFiles = scan.files.filter((f) => !excluded.has(f));
        } catch (error) {
          appendLog(`${t.scanFailed}: ${String(error)}`);
        }
      }
      if (sessionFiles.length === 0) {
        skipped += 1;
        continue;
      }

      if (result.warnings.length > 0) warned += 1;
      plan.push({ session: s, files: sessionFiles });
    }

    if (plan.length === 0) {
      pushToast(t.exportAllNothing, 'warning');
      return;
    }

    // Collision check across all sessions that will run.
    // - `existing`: target dirs that already hold files on disk (will be overwritten).
    // - `dirOwners`: which sessions resolve to each dir, so we can flag two sessions in
    //   THIS batch that write to the same folder — a silent overwrite check_output_collisions
    //   misses when the target doesn't pre-exist (e.g. same .spine added to two sessions).
    const existing = new Set<string>();
    const dirOwners = new Map<string, Set<string>>();
    for (const item of plan) {
      const request = buildExportRequestFrom({ ...appConfig, ...item.session.config }, item.files);
      try {
        const cols = await invoke<string[]>('check_output_collisions', { request });
        cols.forEach((dir) => existing.add(dir));
      } catch {
        // ignore; treat as no collision
      }
      try {
        const dirs = await invoke<string[]>('resolve_output_dirs', { request });
        for (const dir of dirs) {
          const owners = dirOwners.get(dir) ?? new Set<string>();
          owners.add(item.session.id);
          dirOwners.set(dir, owners);
        }
      } catch {
        // ignore; can't resolve → skip overlap detection for this session
      }
    }
    // Folders that more than one session in this batch would write to.
    const overlapDirs = [...dirOwners.values()].filter((owners) => owners.size > 1).length;
    const overlapSessions = new Set<string>();
    for (const owners of dirOwners.values()) {
      if (owners.size > 1) owners.forEach((id) => overlapSessions.add(id));
    }

    // Single combined confirm: summary + overlap + overwrite warning.
    let body = t.exportAllConfirmBody
      .replace('{total}', String(plan.length))
      .replace('{warn}', String(warned))
      .replace('{skip}', String(skipped));
    if (overlapDirs > 0) {
      body += `\n\n${t.sessionOverlapConfirmBody
        .replace('{count}', String(overlapDirs))
        .replace('{sessions}', String(overlapSessions.size))}`;
    }
    if (existing.size > 0) {
      body += `\n\n${t.overwriteConfirmBody.replace('{count}', String(existing.size))}`;
    }
    const proceed = await confirm(body, { title: t.exportAllConfirmTitle, kind: 'warning' });
    if (!proceed) return;

    // ----- Run phase -----
    setBatchProgress({ index: 0, count: plan.length });
    setLiveProgress({ current: 0, total: 0, file: '' });
    // The overlay's elapsed timer covers the whole batch, not each session.
    setRunStartedAt(Date.now());

    let exported = 0;
    const allOutputFolders: string[] = [];
    for (let i = 0; i < plan.length; i += 1) {
      const { session: s, files: sessionFiles } = plan[i];
      setBatchProgress({ index: i + 1, count: plan.length });

      runningIdRef.current = s.id;
      setRunningSessionId(s.id);
      recordRunProgress(0);
      setLiveProgress({ current: 0, total: sessionFiles.length, file: '' });
      setActiveJobs({});
      const sessionStartedAt = Date.now();
      recordRunLog(stamp(`${t.starting}: ${sessionFiles.length} files. (${s.name || t.untitledSession})`));

      let stopped = false;
      try {
        const result = await invoke<BatchExportResult>('start_batch_export', {
          request: buildExportRequestFrom({ ...appConfig, ...s.config }, sessionFiles)
        });
        recordRunOutput(result.outputFolders);
        recordLastExport(s.id, result, Date.now() - sessionStartedAt);
        allOutputFolders.push(...result.outputFolders);
        recordRunLog(
          stamp(
            result.stopped
              ? formatSummary(t.exportStoppedSummary, result.completed, result.failed, result.skipped)
              : formatSummary(t.exportSummary, result.completed, result.failed, result.skipped)
          )
        );
        exported += 1;
        stopped = result.stopped;
      } catch (error) {
        recordRunLog(stamp(`${t.batchFailed}: ${String(error)}`));
      } finally {
        runningIdRef.current = null;
        setRunningSessionId(null);
      }
      if (stopped) break;
    }

    setBatchProgress(null);
    setActiveJobs({});
    setRunStartedAt(null);
    await maybeAutoOpenOutput(allOutputFolders);
    pushToast(
      t.exportAllDone.replace('{exported}', String(exported)).replace('{skipped}', String(targets.length - exported)),
      'success'
    );
  }

  function resolveOpenOutputTarget() {
    if (lastOutputFolders.length === 1) return lastOutputFolders[0];
    if (lastOutputFolders.length > 1) {
      // Open the shared parent of all exported folders (e.g. unityRoot/Heroes), not just the
      // first child. In linkedProject mode outputPath is empty, so derive it from the folders.
      const parent = commonParentPath(lastOutputFolders);
      if (parent) return parent;
      if (merged.outputPath.trim()) return merged.outputPath;
      return lastOutputFolders[0];
    }
    // No run recorded yet: prefer the linked destination folder over the raw input path.
    const linkedFolder = linkedDestFolder(merged);
    if (linkedFolder) return linkedFolder;
    if (merged.outputPath.trim()) return merged.outputPath;
    return merged.inputPath.trim() || '';
  }

  async function openOutputFolder() {
    if (isOpeningOutput) return;
    const target = resolveOpenOutputTarget();
    if (!target) {
      appendLog(t.openOutputEmpty);
      pushToast(t.openOutputEmpty, 'warning');
      return;
    }
    setIsOpeningOutput(true);
    try {
      await invoke('open_path', { path: target });
      lastOpenedOutputRef.current = target;
    } catch (error) {
      appendLog(`${t.openOutputFailed}: ${String(error)}`);
      pushToast(`${t.openOutputFailed}: ${String(error)}`, 'error');
    } finally {
      setIsOpeningOutput(false);
    }
  }

  async function saveLogToFile() {
    if (logs.length === 0) {
      pushToast(t.logEmpty, 'warning');
      return;
    }
    try {
      const target = await save({ title: t.save, defaultPath: 'spineforge-log.txt', filters: [{ name: 'Log', extensions: ['txt', 'log'] }] });
      if (typeof target !== 'string') return;
      await invoke('write_text_file', { path: target, content: logs.join('\n') });
      appendLog(`${t.logSaved}: ${target}`);
      pushToast(t.logSaved, 'success');
    } catch (error) {
      appendLog(`${t.logSaveFailed}: ${String(error)}`);
      pushToast(t.logSaveFailed, 'error');
    }
  }

  return {
    batchProgress,
    activeJobs,
    runStartedAt,
    isStopping,
    isOpeningOutput,
    buildExportRequest,
    startExport,
    stopExport,
    exportProjectSessions,
    resolveOpenOutputTarget,
    openOutputFolder,
    saveLogToFile
  };
}
