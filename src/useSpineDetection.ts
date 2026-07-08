import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { targetVersionPresets } from './config';
import type { Translations } from './i18n';
import type { ToastKind } from './types';

type Options = {
  /** Current Spine executable path (merged.spinePath). */
  spinePath: string;
  /** Persist a detected executable path back onto the app config. */
  setSpinePath: (path: string) => void;
  /** Persist a detected/added target version onto the active session. */
  setTargetVersion: (version: string) => void;
  t: Translations;
  appendLog: (text: string) => void;
  pushToast: (text: string, kind?: ToastKind) => void;
};

/**
 * Spine executable + version detection: auto-detect the installed Spine binary on mount,
 * detect its version, and maintain the list of known target versions for the dropdown.
 * Extracted from useAppController; the controller spreads the returned API into its context.
 */
export function useSpineDetection({ spinePath, setSpinePath, setTargetVersion, t, appendLog, pushToast }: Options) {
  const [targetVersions, setTargetVersions] = useState<string[]>(targetVersionPresets);
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);
  const [isDetectingVersion, setIsDetectingVersion] = useState(false);

  function addTargetVersion(version: string) {
    setTargetVersions((versions) => (versions.includes(version) ? versions : [version, ...versions]));
    setTargetVersion(version);
  }

  async function detectVersion(path = spinePath) {
    if (isDetectingVersion) return;
    if (!path.trim()) {
      appendLog(`${t.versionDetectFailed}: Spine executable path is empty.`);
      return;
    }
    setIsDetectingVersion(true);
    try {
      const version = await invoke<string>('detect_spine_version', { spinePath: path });
      addTargetVersion(version);
      appendLog(`${t.detectedVersion}: ${version}`);
      pushToast(`${t.detectedVersion}: ${version}`, 'success');
    } catch (error) {
      appendLog(`${t.versionDetectFailed}: ${String(error)}`);
      pushToast(t.versionDetectFailed, 'error');
    } finally {
      setIsDetectingVersion(false);
    }
  }

  async function autoDetectSpine(silent = false) {
    if (isAutoDetecting) return;
    setIsAutoDetecting(true);
    try {
      const detected = await invoke<string>('auto_detect_spine');
      setSpinePath(detected);
      appendLog(`${t.detectedSpine}: ${detected}`);
      pushToast(`${t.detectedSpine}: ${detected}`, 'success');
      await detectVersion(detected);
    } catch (error) {
      if (!silent) {
        appendLog(`${t.autoDetectFailed}: ${String(error)}`);
        pushToast(t.autoDetectFailed, 'error');
      }
    } finally {
      setIsAutoDetecting(false);
    }
  }

  // Auto-detect the Spine binary once on mount — but ONLY when no path is saved yet. Re-detecting on
  // every launch spawns `Spine.com --version` (a cold subprocess measured at ~17s on the shared
  // drive) for no benefit when the path hasn't changed; validate_settings already flags a missing
  // exe separately, and the user can re-detect manually from Settings. This also removes the extra
  // session-status re-probe that a startup spinePath change used to trigger.
  useEffect(() => {
    if (spinePath.trim()) return;
    void autoDetectSpine(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { targetVersions, addTargetVersion, detectVersion, autoDetectSpine, isAutoDetecting, isDetectingVersion };
}
