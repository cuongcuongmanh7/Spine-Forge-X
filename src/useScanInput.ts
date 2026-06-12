import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { confirm, message, open } from '@tauri-apps/plugin-dialog';
import type { MergedConfig, Session, SessionConfig, SessionRuntime } from './config';
import type { Translations } from './i18n';
import type { CleanResult, ScanResult, ToastKind } from './types';
import { basename } from './sessions';

type Options = {
  merged: MergedConfig;
  sessionConfig: SessionConfig;
  activeSessionId: string | null;
  activeSession: Session | null;
  files: string[];
  setFiles: React.Dispatch<React.SetStateAction<string[]>>;
  setSkippedFiles: React.Dispatch<React.SetStateAction<string[]>>;
  setCurrentIndex: React.Dispatch<React.SetStateAction<number>>;
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
  ensureActiveSession: () => string;
  patchSession: (id: string, patch: Partial<SessionConfig>) => void;
  updateOutputPath: (value: string) => void;
  runtimeByIdRef: React.MutableRefObject<Record<string, SessionRuntime>>;
  appendLog: (text: string) => void;
  pushToast: (text: string, kind?: ToastKind) => void;
  t: Translations;
};

/**
 * Input scanning + file-list management: scan a folder for `.spine` files, browse for a
 * folder/file set, apply drag-dropped paths, and add/remove/restore individual files (with
 * folder-scan exclusions persisted on the session). Also auto-scans a folder session once on
 * open/first-switch. Extracted from useAppController; the controller spreads the API back in.
 */
export function useScanInput({
  merged,
  sessionConfig,
  activeSessionId,
  activeSession,
  files,
  setFiles,
  setSkippedFiles,
  setCurrentIndex,
  setSessions,
  ensureActiveSession,
  patchSession,
  updateOutputPath,
  runtimeByIdRef,
  appendLog,
  pushToast,
  t
}: Options) {
  const [isScanning, setIsScanning] = useState(false);
  const [isChoosingInputFolder, setIsChoosingInputFolder] = useState(false);
  const [isChoosingInputFiles, setIsChoosingInputFiles] = useState(false);
  const [isChoosingOutputFolder, setIsChoosingOutputFolder] = useState(false);
  const [isCleaningTimestamp, setIsCleaningTimestamp] = useState(false);
  // Input path that the current files/skipped lists were scanned from — lets the UI tell
  // "scanned and found nothing" (error) apart from "edited, not scanned yet" (hint).
  const [scannedPath, setScannedPath] = useState<string | null>(null);
  // Session ids already auto-scanned this app run, so we scan a folder session at most once automatically.
  const autoScannedRef = useRef<Set<string>>(new Set());

  async function scanPath(inputPath: string, excluded: string[] = []) {
    try {
      const result = await invoke<ScanResult>('scan_spine_files', { inputPath });
      const excludedSet = new Set(excluded);
      const kept = excludedSet.size ? result.files.filter((f) => !excludedSet.has(f)) : result.files;
      setFiles(kept);
      setSkippedFiles(result.skipped);
      setCurrentIndex(0);
      appendLog(`${t.scanned} ${kept.length} Spine files. ${t.skipped}: ${result.skipped.length}.`);
    } catch (error) {
      // A failed scan (e.g. path doesn't exist) leaves an empty list so the UI
      // flags the path instead of silently keeping a stale file list.
      setFiles([]);
      setSkippedFiles([]);
      setCurrentIndex(0);
      throw error;
    } finally {
      setScannedPath(inputPath);
    }
  }

  async function scanInput() {
    if (isScanning) return;
    if (!merged.inputPath.trim()) {
      appendLog(t.inputEmpty);
      return;
    }
    setIsScanning(true);
    appendLog(`${t.scanning}: ${merged.inputPath}`);
    try {
      await scanPath(merged.inputPath, sessionConfig.excludedFiles ?? []);
    } catch (error) {
      appendLog(`${t.scanFailed}: ${String(error)}`);
    } finally {
      setIsScanning(false);
    }
  }

  /** Point the active session at a folder and scan it. Shared by Browse + drag-drop. */
  async function applyInputFolder(selected: string) {
    const id = ensureActiveSession();
    setSessions((list) =>
      list.map((s) => {
        if (s.id !== id) return s;
        const name = s.autoNamed ? basename(selected) || s.name : s.name;
        // New folder → reset any exclusions from the previous folder.
        return { ...s, name, config: { ...s.config, inputPath: selected, inputFiles: [], excludedFiles: [] }, updatedAt: Date.now() };
      })
    );
    setIsScanning(true);
    appendLog(`${t.scanning}: ${selected}`);
    try {
      await scanPath(selected, []);
    } catch (error) {
      appendLog(`${t.scanFailed}: ${String(error)}`);
    } finally {
      setIsScanning(false);
    }
  }

  /** Merge explicit `.spine` files into the active session's file list. Shared by Browse + drag-drop. */
  function applyInputFiles(spineFiles: string[]) {
    if (!spineFiles.length) return;
    const id = ensureActiveSession();
    const combined = Array.from(new Set([...files, ...spineFiles])).sort();
    setFiles(combined);
    setSkippedFiles([]);
    setCurrentIndex(0);
    // Explicitly adding a file wins over a prior exclusion — un-exclude anything just added.
    const added = new Set(spineFiles);
    setSessions((list) =>
      list.map((s) =>
        s.id === id
          ? {
              ...s,
              config: {
                ...s.config,
                inputFiles: combined,
                excludedFiles: (s.config.excludedFiles ?? []).filter((p) => !added.has(p))
              },
              updatedAt: Date.now()
            }
          : s
      )
    );
    appendLog(`${t.scanned} ${spineFiles.length} Spine files.`);
  }

  async function chooseInputFolder() {
    if (isChoosingInputFolder || isScanning) return;
    setIsChoosingInputFolder(true);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t.browseFolder,
        defaultPath: merged.inputPath.trim() || undefined
      });
      if (typeof selected !== 'string') return;
      await applyInputFolder(selected);
    } finally {
      setIsChoosingInputFolder(false);
    }
  }

  async function chooseInputFiles() {
    if (isChoosingInputFiles) return;
    setIsChoosingInputFiles(true);
    try {
      const selected = await open({
        directory: false,
        multiple: true,
        title: t.browseFiles,
        defaultPath: merged.inputPath.trim() || undefined,
        filters: [{ name: 'Spine Project', extensions: ['spine'] }]
      });
      if (!Array.isArray(selected)) return;
      applyInputFiles(selected.filter((path) => path.toLowerCase().endsWith('.spine')));
    } finally {
      setIsChoosingInputFiles(false);
    }
  }

  async function chooseOutputFolder() {
    if (isChoosingOutputFolder) return;
    setIsChoosingOutputFolder(true);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t.browseOutput,
        defaultPath: merged.outputPath.trim() || undefined
      });
      if (typeof selected !== 'string') return;
      updateOutputPath(selected);
    } finally {
      setIsChoosingOutputFolder(false);
    }
  }

  async function cleanTimestampExports() {
    if (isCleaningTimestamp) return;
    if (!merged.inputPath.trim()) {
      appendLog(t.inputEmpty);
      return;
    }
    setIsCleaningTimestamp(true);
    try {
      const accepted = await confirm(t.cleanConfirmBody, { title: t.cleanConfirmTitle, kind: 'warning' });
      if (!accepted) return;
      const result = await invoke<CleanResult>('clean_timestamp_exports', { inputPath: merged.inputPath });
      const body = `${t.cleanDone}: ${result.deleted.length}. Failed: ${result.failed.length}.`;
      appendLog(body);
      result.failed.forEach((item) => appendLog(`[CLEAN FAILED] ${item}`));
      await message(body, { title: t.cleanResultTitle, kind: result.failed.length ? 'warning' : 'info' });
    } catch (error) {
      const body = String(error);
      appendLog(`${t.cleanFailed}: ${body}`);
      await message(body, { title: t.cleanFailed, kind: 'error' });
    } finally {
      setIsCleaningTimestamp(false);
    }
  }

  function removeFile(path: string) {
    setFiles((items) => items.filter((item) => item !== path));
    if (!activeSessionId) return;
    if (sessionConfig.inputFiles.includes(path)) {
      // Browse-files item: drop it from the explicit list.
      patchSession(activeSessionId, { inputFiles: sessionConfig.inputFiles.filter((item) => item !== path) });
    } else {
      // Folder-scan result: remember the exclusion so a re-scan keeps it removed (survives restart).
      const excluded = sessionConfig.excludedFiles ?? [];
      if (!excluded.includes(path)) {
        patchSession(activeSessionId, { excludedFiles: [...excluded, path] });
      }
    }
  }

  /** Un-exclude a single file: drop it from excludedFiles and add it back to the visible list. */
  function restoreExcludedFile(path: string) {
    if (!activeSessionId) return;
    const excluded = sessionConfig.excludedFiles ?? [];
    if (!excluded.includes(path)) return;
    patchSession(activeSessionId, { excludedFiles: excluded.filter((p) => p !== path) });
    setFiles((items) => (items.includes(path) ? items : [...items, path].sort()));
  }

  /** Clear all exclusions and re-scan the folder so every file comes back. */
  async function restoreAllExcluded() {
    if (!activeSessionId) return;
    if ((sessionConfig.excludedFiles ?? []).length === 0) return;
    patchSession(activeSessionId, { excludedFiles: [] });
    if (merged.inputPath.trim()) {
      setIsScanning(true);
      appendLog(`${t.scanning}: ${merged.inputPath}`);
      try {
        await scanPath(merged.inputPath, []);
      } catch (error) {
        appendLog(`${t.scanFailed}: ${String(error)}`);
      } finally {
        setIsScanning(false);
      }
    }
  }

  // Auto-scan the active folder session once (e.g. on open / first switch) so its file list shows
  // without a manual Scan. Only the active session is scanned; exclusions are respected.
  useEffect(() => {
    const session = activeSession;
    if (!session || isScanning) return;
    const id = session.id;
    if (autoScannedRef.current.has(id)) return;
    if (!session.config.inputPath.trim()) return;
    // Already have files (scanned earlier this run, or an explicit file list) → nothing to do.
    const rt = runtimeByIdRef.current[id];
    if ((rt && rt.files.length > 0) || session.config.inputFiles.length > 0 || files.length > 0) return;
    autoScannedRef.current.add(id);
    void (async () => {
      setIsScanning(true);
      appendLog(`${t.scanning}: ${session.config.inputPath}`);
      try {
        await scanPath(session.config.inputPath, session.config.excludedFiles ?? []);
      } catch (error) {
        appendLog(`${t.scanFailed}: ${String(error)}`);
      } finally {
        setIsScanning(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  return {
    isScanning,
    isChoosingInputFolder,
    isChoosingInputFiles,
    isChoosingOutputFolder,
    isCleaningTimestamp,
    scannedPath,
    scanInput,
    applyInputFolder,
    applyInputFiles,
    chooseInputFolder,
    chooseInputFiles,
    chooseOutputFolder,
    cleanTimestampExports,
    removeFile,
    restoreExcludedFile,
    restoreAllExcluded
  };
}
