import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';
import { initialUpdateUi, releasesUrl } from './config';
import type { UpdateStatus, UpdateUiState } from './types';

/**
 * App auto-update lifecycle: check on mount, download with progress, install + relaunch.
 * Extracted from useAppController to keep that hook focused on session/export logic.
 * `appendLog` routes update status into the same log stream the rest of the app uses.
 */
export function useAppUpdater(appendLog: (text: string) => void) {
  const [updateUi, setUpdateUi] = useState<UpdateUiState>(initialUpdateUi);
  const pendingUpdateRef = useRef<Update | null>(null);
  const updateStatusTimerRef = useRef<number | null>(null);

  function showTemporaryUpdateStatus(status: UpdateStatus, durationMs = 3000, text = '') {
    if (updateStatusTimerRef.current !== null) window.clearTimeout(updateStatusTimerRef.current);
    setUpdateUi({ ...initialUpdateUi, status, message: text });
    updateStatusTimerRef.current = window.setTimeout(() => {
      setUpdateUi(initialUpdateUi);
      updateStatusTimerRef.current = null;
    }, durationMs);
  }

  async function checkForAppUpdate(manual = false) {
    try {
      setUpdateUi((current) => ({ ...current, status: 'checking', message: '' }));
      if (manual) appendLog('Checking for app update...');
      const update = await check({ timeout: 30000 });
      if (!update) {
        if (manual) {
          showTemporaryUpdateStatus('upToDate');
          appendLog('App is up to date.');
        } else {
          setUpdateUi(initialUpdateUi);
        }
        return;
      }

      pendingUpdateRef.current = update;
      let downloaded = 0;
      let contentLength = 0;
      const notes = update.body?.trim() ?? '';

      setUpdateUi({ status: 'downloading', version: update.version, progress: 0, progressKnown: false, message: '', notes });
      appendLog(`Downloading app update v${update.version}...`);

      await update.download((event: DownloadEvent) => {
        if (event.event === 'Started') {
          downloaded = 0;
          contentLength = event.data.contentLength ?? 0;
          setUpdateUi({ status: 'downloading', version: update.version, progress: 0, progressKnown: contentLength > 0, message: '', notes });
          return;
        }
        if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          const value = contentLength > 0 ? Math.min(100, Math.round((downloaded / contentLength) * 100)) : 0;
          setUpdateUi({ status: 'downloading', version: update.version, progress: value, progressKnown: contentLength > 0, message: '', notes });
          return;
        }
        setUpdateUi({ status: 'ready', version: update.version, progress: 100, progressKnown: true, message: '', notes });
        appendLog(`App update v${update.version} is ready to install.`);
      });
    } catch (error) {
      const body = String(error);
      pendingUpdateRef.current = null;
      console.warn('Update check failed:', error);
      appendLog(`Update check failed: ${body}`);
      showTemporaryUpdateStatus('error', 6000, body);
    }
  }

  async function installPendingUpdate() {
    const update = pendingUpdateRef.current;
    if (!update) return;
    try {
      await update.install();
      await relaunch();
    } catch (error) {
      const body = String(error);
      setUpdateUi({ ...initialUpdateUi, status: 'error', message: body });
      appendLog(`Update install failed: ${body}`);
      showTemporaryUpdateStatus('error', 6000, body);
    }
  }

  async function openReleasesPage() {
    try {
      await invoke('open_url', { url: releasesUrl });
    } catch (error) {
      appendLog(`Open releases page failed: ${String(error)}`);
    }
  }

  // Check for updates once on mount; clean up the status timer on unmount.
  useEffect(() => {
    void checkForAppUpdate();
    return () => {
      if (updateStatusTimerRef.current !== null) window.clearTimeout(updateStatusTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { updateUi, checkForAppUpdate, installPendingUpdate, openReleasesPage };
}
