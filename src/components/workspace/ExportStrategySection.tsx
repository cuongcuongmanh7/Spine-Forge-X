import { CheckCircle2, Copy, Pencil, Plus, RotateCw, Search, Trash2, Upload } from 'lucide-react';
import { Section, Hint } from '../common';
import { useApp } from '../../useAppController';

export function ExportStrategySection() {
  const {
    t,
    merged,
    updateSetting,
    targetVersions,
    detectVersion,
    isDetectingVersion,
    exportPresets,
    selectedExportPreset,
    isPresetBusy,
    presetImportedTick,
    importGlobalJsonPreset,
    deleteUserPreset,
    openPresetEditor,
    newPreset,
    duplicateSelectedPreset
  } = useApp();

  // Show preset names without the .export.json extension.
  const presetLabel = (name: string) => name.replace(/\.export\.json$/i, '');
  const hasSelection = Boolean(selectedExportPreset);
  const canDelete = hasSelection && !selectedExportPreset!.builtIn;

  return (
    <Section title={t.exportStrategy}>
      <div className="form-grid">
        <label>
          {t.targetVersion}
          <div className="inline-field">
            <select value={merged.targetVersion} onChange={(event) => updateSetting('targetVersion', event.target.value)}>
              {/* Always include the current value so a session's saved version never renders blank. */}
              {Array.from(new Set([merged.targetVersion, ...targetVersions]))
                .filter((version) => version.trim() !== '')
                .map((version) => (
                  <option key={version} value={version}>{version}</option>
                ))}
            </select>
            <button className="icon-button" title={t.detectVersion} disabled={isDetectingVersion} onClick={() => detectVersion()}>
              {isDetectingVersion ? <RotateCw className="spin" size={18} /> : <Search size={18} />}
            </button>
          </div>
        </label>
        <label>
          {t.globalExportJson}
          <select value={merged.globalJsonPath || ''} onChange={(event) => updateSetting('globalJsonPath', event.target.value)}>
            <option value="">{t.noPreset}</option>
            {exportPresets.map((preset) => (
              <option key={`${preset.builtIn ? 'built-in' : 'user'}:${preset.name}`} value={preset.path}>
                {preset.builtIn ? t.builtInPreset : t.userPreset}: {presetLabel(preset.name)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="preset-manager">
        <div className="preset-toolbar">
          <button className="secondary-button" disabled={isPresetBusy} onClick={importGlobalJsonPreset}>
            {isPresetBusy ? <RotateCw className="spin" size={16} /> : <Upload size={16} />}
            {t.importPreset}
          </button>
          <button className="secondary-button" onClick={() => newPreset()}>
            <Plus size={16} />
            {t.newPreset}
          </button>
          <button className="secondary-button" disabled={!hasSelection} onClick={() => void openPresetEditor(selectedExportPreset)}>
            <Pencil size={16} />
            {t.editPreset}
          </button>
          <button className="secondary-button" disabled={!hasSelection || isPresetBusy} onClick={() => void duplicateSelectedPreset()}>
            <Copy size={16} />
            {t.duplicatePreset}
          </button>
          <button className="secondary-button" disabled={!canDelete || isPresetBusy} onClick={deleteUserPreset}>
            <Trash2 size={16} />
            {t.deletePreset}
          </button>
          {presetImportedTick && (
            <span className="preset-tick" role="status">
              <CheckCircle2 size={16} />
              {t.presetImported}
            </span>
          )}
          <Hint text={t.presetImportHelp} />
        </div>
        {selectedExportPreset && (
          <p className="preset-path" title={selectedExportPreset.path}>{selectedExportPreset.path}</p>
        )}
      </div>
    </Section>
  );
}
