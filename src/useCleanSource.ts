import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Translations } from './i18n';
import type { BatchCleanResult, BatchScanSummary, CleanUnitInfo, ToastKind } from './types';

type Options = {
  spinePath: string;
  targetVersion: string;
  /** Used to key the scan cache per session. */
  activeSessionId: string | null;
  t: Translations;
  appendLog: (text: string) => void;
  pushToast: (text: string, kind?: ToastKind) => void;
  /** Reset shared export progress so the scan overlay starts fresh. */
  resetProgress: () => void;
};

/**
 * Clean Source Folder: scan source folders for unused images and move them to backup.
 * Owns the modal open/busy state and a per-session cache of the last scan (root + summary)
 * so reopening the modal doesn't re-run the slow per-folder CLI scan. Extracted from
 * useAppController to keep that hook focused.
 */
export function useCleanSource({
  spinePath,
  targetVersion,
  activeSessionId,
  t,
  appendLog,
  pushToast,
  resetProgress
}: Options) {
  const [cleanSourceFolderOpen, setCleanSourceFolderOpen] = useState(false);
  const [isCleaningSourceFolder, setIsCleaningSourceFolder] = useState(false);
  // Per-session cache: reopening the modal shows that session's last scan instead of rescanning.
  const [cleanScanBySession, setCleanScanBySession] = useState<
    Record<string, { root: string; summary: BatchScanSummary | null }>
  >({});

  const cleanScanKey = activeSessionId ?? '__global__';
  const cleanScanEntry = cleanScanBySession[cleanScanKey] ?? { root: '', summary: null };
  const cleanScanRoot = cleanScanEntry.root;
  const cleanScanSummary = cleanScanEntry.summary;

  function setCleanScanRoot(value: string | ((prev: string) => string)) {
    setCleanScanBySession((map) => {
      const prev = map[cleanScanKey] ?? { root: '', summary: null };
      const root = typeof value === 'function' ? value(prev.root) : value;
      return { ...map, [cleanScanKey]: { ...prev, root } };
    });
  }

  function setCleanScanSummary(
    value: BatchScanSummary | null | ((prev: BatchScanSummary | null) => BatchScanSummary | null)
  ) {
    setCleanScanBySession((map) => {
      const prev = map[cleanScanKey] ?? { root: '', summary: null };
      const summary = typeof value === 'function' ? value(prev.summary) : value;
      return { ...map, [cleanScanKey]: { ...prev, summary } };
    });
  }

  // `extraExcluded` is the modal picker's full list of unchecked `.spine` paths.
  // The picker is the single source of truth: it defaults session export-set
  // exclusions to unchecked, but the user may re-check them to scan anyway.
  async function scanSourceFolders(
    root: string,
    extraExcluded: string[] = []
  ): Promise<BatchScanSummary | null> {
    const target = root.trim();
    if (!target) {
      pushToast(t.inputEmpty, 'warning');
      return null;
    }
    if (!spinePath.trim()) {
      pushToast(t.cleanSourceNoSpine, 'warning');
      return null;
    }
    // Clear any leftover progress from a prior export so the scan overlay starts fresh.
    resetProgress();
    try {
      return await invoke<BatchScanSummary>('scan_source_folders', {
        spinePath,
        targetVersion,
        root: target,
        excluded: extraExcluded
      });
    } catch (error) {
      const body = String(error);
      appendLog(`${t.cleanSourceFailed}: ${body}`);
      pushToast(`${t.cleanSourceFailed}: ${body}`, 'error');
      return null;
    }
  }

  /** Count `.spine` units under `root` without exporting. Cheap; used to preview/warn before a scan. */
  async function countCleanUnits(root: string, extraExcluded: string[] = []): Promise<number> {
    const target = root.trim();
    if (!target) return 0;
    try {
      return await invoke<number>('count_clean_units', {
        root: target,
        excluded: extraExcluded
      });
    } catch {
      return 0;
    }
  }

  /** List `.spine` units under `root` without exporting, for the folder picker. */
  async function listCleanUnits(root: string): Promise<CleanUnitInfo[]> {
    const target = root.trim();
    if (!target) return [];
    try {
      return await invoke<CleanUnitInfo[]>('list_clean_units', { root: target });
    } catch {
      return [];
    }
  }

  /** Scan + move unused images under `root` to a per-folder timestamped backup. */
  async function cleanSourceFolders(
    root: string,
    extraExcluded: string[] = []
  ): Promise<BatchCleanResult | null> {
    const target = root.trim();
    if (!target || !spinePath.trim() || isCleaningSourceFolder) return null;
    setIsCleaningSourceFolder(true);
    try {
      const result = await invoke<BatchCleanResult>('clean_source_folders', {
        spinePath,
        targetVersion,
        root: target,
        excluded: extraExcluded
      });
      const body = t.cleanSourceDone.replace('{count}', String(result.totalMoved));
      appendLog(body);
      pushToast(body, 'success');
      return result;
    } catch (error) {
      const body = String(error);
      appendLog(`${t.cleanSourceFailed}: ${body}`);
      pushToast(`${t.cleanSourceFailed}: ${body}`, 'error');
      return null;
    } finally {
      setIsCleaningSourceFolder(false);
    }
  }

  /** Move one folder's already-scanned unused images to its _unused_backup. Returns backup dir or null. */
  async function moveFolderUnused(imagesDir: string, files: string[]): Promise<string | null> {
    if (!files.length || isCleaningSourceFolder) return null;
    setIsCleaningSourceFolder(true);
    try {
      const backupDir = await invoke<string>('move_unused_images', { imagesDir, files });
      const body = t.cleanSourceDone.replace('{count}', String(files.length));
      appendLog(body);
      pushToast(body, 'success');
      return backupDir;
    } catch (error) {
      const body = String(error);
      appendLog(`${t.cleanSourceFailed}: ${body}`);
      pushToast(`${t.cleanSourceFailed}: ${body}`, 'error');
      return null;
    } finally {
      setIsCleaningSourceFolder(false);
    }
  }

  /** Read a local image as a base64 data URL for thumbnail display. Null on failure. */
  async function readImageDataUrl(path: string): Promise<string | null> {
    try {
      return await invoke<string>('read_image_data_url', { path });
    } catch {
      return null;
    }
  }

  return {
    cleanSourceFolderOpen,
    setCleanSourceFolderOpen,
    isCleaningSourceFolder,
    cleanScanRoot,
    setCleanScanRoot,
    cleanScanSummary,
    setCleanScanSummary,
    scanSourceFolders,
    countCleanUnits,
    listCleanUnits,
    cleanSourceFolders,
    moveFolderUnused,
    readImageDataUrl
  };
}
