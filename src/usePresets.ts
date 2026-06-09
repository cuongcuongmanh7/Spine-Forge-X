import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { confirm, open } from '@tauri-apps/plugin-dialog';
import { defaultExportPreset } from './config';
import type { Translations } from './i18n';
import type { ExportPreset, ToastKind } from './types';

type Options = {
  /** Path of the preset currently selected for export (merged.globalJsonPath). */
  globalJsonPath: string;
  /** Persist the selected preset path back onto the active session. */
  setGlobalJsonPath: (path: string) => void;
  t: Translations;
  appendLog: (text: string) => void;
  pushToast: (text: string, kind?: ToastKind) => void;
};

/**
 * Export-preset management: list/import/delete user presets, the preset editor, and the
 * live preview of the selected preset's JSON (also used to detect pack-folder mode).
 * Extracted from useAppController; the controller passes the selected path + a setter and
 * spreads the returned API back into its context value.
 */
export function usePresets({ globalJsonPath, setGlobalJsonPath, t, appendLog, pushToast }: Options) {
  const [exportPresets, setExportPresets] = useState<ExportPreset[]>([]);
  const [presetPreview, setPresetPreview] = useState('');
  const [isPresetBusy, setIsPresetBusy] = useState(false);
  const [presetImportedTick, setPresetImportedTick] = useState(false);
  const [presetEditorOpen, setPresetEditorOpen] = useState(false);
  const [isChoosingGlobalJson, setIsChoosingGlobalJson] = useState(false);
  const [editingPreset, setEditingPreset] = useState<{ name: string; content: string; builtIn: boolean } | null>(null);
  const presetTickTimerRef = useRef<number | null>(null);

  const selectedExportPreset = useMemo(
    () => exportPresets.find((preset) => preset.path === globalJsonPath),
    [exportPresets, globalJsonPath]
  );

  async function loadExportPresets() {
    try {
      const presets = await invoke<ExportPreset[]>('list_export_presets');
      setExportPresets(presets);
    } catch (error) {
      appendLog(`${t.presetLoadFailed}: ${String(error)}`);
    }
  }

  async function loadPresetContent(path: string) {
    try {
      const content = await invoke<string>('read_export_preset', { path });
      setPresetPreview(content);
    } catch (error) {
      setPresetPreview('');
      appendLog(`${t.presetLoadFailed}: ${String(error)}`);
    }
  }

  function flashPresetTick() {
    setPresetImportedTick(true);
    if (presetTickTimerRef.current !== null) window.clearTimeout(presetTickTimerRef.current);
    presetTickTimerRef.current = window.setTimeout(() => {
      setPresetImportedTick(false);
      presetTickTimerRef.current = null;
    }, 2500);
  }

  async function chooseGlobalJsonFile() {
    if (isChoosingGlobalJson) return;
    setIsChoosingGlobalJson(true);
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        title: t.globalExportJson,
        filters: [{ name: 'Spine export settings', extensions: ['export.json'] }]
      });
      if (typeof selected !== 'string') return;
      if (!selected.toLowerCase().endsWith('.export.json')) {
        appendLog(t.invalidExportJsonFile);
        return;
      }
      setGlobalJsonPath(selected);
    } finally {
      setIsChoosingGlobalJson(false);
    }
  }

  async function importGlobalJsonPreset() {
    if (isPresetBusy) return;
    setIsPresetBusy(true);
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        title: t.importPreset,
        filters: [{ name: 'Spine export settings', extensions: ['export.json'] }]
      });
      if (typeof selected !== 'string') return;
      if (!selected.toLowerCase().endsWith('.export.json')) {
        appendLog(t.invalidExportJsonFile);
        return;
      }
      const preset = await invoke<ExportPreset>('import_user_export_preset', { sourcePath: selected });
      await loadExportPresets();
      setGlobalJsonPath(preset.path);
      await loadPresetContent(preset.path);
      appendLog(`${t.presetImported}: ${preset.name}`);
      pushToast(`${t.presetImported}: ${preset.name}`, 'success');
      flashPresetTick();
    } catch (error) {
      appendLog(`${t.presetImportFailed}: ${String(error)}`);
      pushToast(t.presetImportFailed, 'error');
    } finally {
      setIsPresetBusy(false);
    }
  }

  async function deleteUserPreset() {
    if (isPresetBusy || !selectedExportPreset || selectedExportPreset.builtIn) return;
    const ok = await confirm(`${t.deletePreset}: ${selectedExportPreset.name}?`, { title: t.deletePreset });
    if (!ok) return;
    setIsPresetBusy(true);
    try {
      await invoke('delete_user_export_preset', { name: selectedExportPreset.name });
      setGlobalJsonPath('');
      setPresetPreview('');
      await loadExportPresets();
      appendLog(`${t.presetDeleted}: ${selectedExportPreset.name}`);
      pushToast(`${t.presetDeleted}: ${selectedExportPreset.name}`, 'success');
    } catch (error) {
      appendLog(`${t.presetDeleteFailed}: ${String(error)}`);
      pushToast(t.presetDeleteFailed, 'error');
    } finally {
      setIsPresetBusy(false);
    }
  }

  function presetDisplayName(fileName: string): string {
    return fileName.replace(/\.export\.json$/i, '');
  }

  function uniquePresetFileName(base: string): string {
    const used = new Set(exportPresets.map((p) => p.name.toLowerCase()));
    let candidate = `${base}.export.json`;
    let index = 2;
    while (used.has(candidate.toLowerCase())) {
      candidate = `${base}-${index}.export.json`;
      index += 1;
    }
    return candidate;
  }

  async function openPresetEditor(preset?: ExportPreset) {
    try {
      let content: string;
      let name: string;
      let builtIn = false;
      if (preset) {
        content = await invoke<string>('read_export_preset', { path: preset.path });
        name = presetDisplayName(preset.name);
        builtIn = preset.builtIn;
      } else {
        content = JSON.stringify(defaultExportPreset, null, 2);
        name = '';
      }
      setEditingPreset({ name, content, builtIn });
      setPresetEditorOpen(true);
    } catch (error) {
      appendLog(`${t.presetLoadFailed}: ${String(error)}`);
      pushToast(t.presetLoadFailed, 'error');
    }
  }

  function closePresetEditor() {
    setPresetEditorOpen(false);
    setEditingPreset(null);
  }

  /** Save edited content as a user preset file (name without extension), then select it. */
  async function saveUserPreset(name: string, content: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const preset = await invoke<ExportPreset>('save_user_export_preset', {
        name: `${trimmed}.export.json`,
        content
      });
      await loadExportPresets();
      setGlobalJsonPath(preset.path);
      await loadPresetContent(preset.path);
      closePresetEditor();
      appendLog(`${t.presetSaved}: ${preset.name}`);
      pushToast(`${t.presetSaved}: ${presetDisplayName(preset.name)}`, 'success');
    } catch (error) {
      appendLog(`${t.presetSaveFailed}: ${String(error)}`);
      pushToast(t.presetSaveFailed, 'error');
    }
  }

  /** New blank preset from the default template. */
  function newPreset() {
    void openPresetEditor();
  }

  /** Duplicate the selected preset (built-in or user) into a new user copy. */
  async function duplicateSelectedPreset() {
    if (isPresetBusy || !selectedExportPreset) return;
    setIsPresetBusy(true);
    try {
      const content = await invoke<string>('read_export_preset', { path: selectedExportPreset.path });
      const base = `${presetDisplayName(selectedExportPreset.name)}-${t.presetCopySuffix}`;
      const fileName = uniquePresetFileName(base);
      const preset = await invoke<ExportPreset>('save_user_export_preset', { name: fileName, content });
      await loadExportPresets();
      setGlobalJsonPath(preset.path);
      appendLog(`${t.presetSaved}: ${preset.name}`);
      pushToast(`${t.presetSaved}: ${presetDisplayName(preset.name)}`, 'success');
    } catch (error) {
      appendLog(`${t.presetSaveFailed}: ${String(error)}`);
      pushToast(t.presetSaveFailed, 'error');
    } finally {
      setIsPresetBusy(false);
    }
  }

  // Load presets once on mount.
  useEffect(() => {
    void loadExportPresets();
    return () => {
      if (presetTickTimerRef.current !== null) window.clearTimeout(presetTickTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the preview in sync with the selected preset (built-in or user); also drives the
  // pack-folder detection in the controller.
  useEffect(() => {
    if (!selectedExportPreset) {
      setPresetPreview('');
      return;
    }
    void loadPresetContent(selectedExportPreset.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExportPreset?.path]);

  return {
    exportPresets,
    selectedExportPreset,
    presetPreview,
    isPresetBusy,
    presetImportedTick,
    presetEditorOpen,
    editingPreset,
    isChoosingGlobalJson,
    chooseGlobalJsonFile,
    importGlobalJsonPreset,
    deleteUserPreset,
    openPresetEditor,
    closePresetEditor,
    saveUserPreset,
    newPreset,
    duplicateSelectedPreset
  };
}
