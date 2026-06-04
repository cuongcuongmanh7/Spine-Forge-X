import { AlertTriangle, CheckCircle2, FolderOpen, RotateCw, Search, Trash2, Upload } from 'lucide-react';
import { Section } from '../common';
import { useApp } from '../../useAppController';
import type { MergedConfig } from '../../config';
import type { ExportMode, FallbackMode } from '../../types';

export function ExportStrategySection() {
  const {
    t,
    merged,
    updateSetting,
    updateGeneratedFormat,
    targetVersions,
    detectVersion,
    isDetectingVersion,
    exportPresets,
    selectedExportPreset,
    presetPreview,
    isPresetBusy,
    presetImportedTick,
    importGlobalJsonPreset,
    deleteUserPreset,
    chooseGlobalJsonFile,
    isChoosingGlobalJson
  } = useApp();

  return (
    <Section title={t.exportStrategy}>
      <div className="mode-grid">
        {(
          [
            ['perProjectJson', t.perProjectJson],
            ['globalJson', t.globalJson],
            ['builtIn', t.builtIn],
            ['generatedSettings', t.generatedSettings]
          ] as [ExportMode, string][]
        ).map(([value, label]) => (
          <label className="mode-option" key={value}>
            <input type="radio" checked={merged.exportMode === value} onChange={() => updateSetting('exportMode', value)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
      {merged.exportMode === 'generatedSettings' && (
        <>
          <div className="notice warning">
            <AlertTriangle size={18} />
            <span>{t.generatedSettingsHelp}</span>
          </div>
          <div className="generated-settings-grid">
            <h3>{t.generatedSkeleton}</h3>
            <div className="form-grid">
              <label>
                {t.generatedFormat}
                <select value={merged.generatedFormat} onChange={(event) => updateGeneratedFormat(event.target.value)}>
                  <option value="json">JSON</option>
                  <option value="binary">Binary</option>
                </select>
              </label>
              <label>
                {t.generatedSkeletonExtension}
                <select value={merged.generatedSkeletonExtension} onChange={(event) => updateSetting('generatedSkeletonExtension', event.target.value)}>
                  {merged.generatedFormat === 'binary' ? (
                    <>
                      <option value=".skel">.skel</option>
                      <option value=".skel.bytes">.skel.bytes</option>
                    </>
                  ) : (
                    <option value=".json">.json</option>
                  )}
                </select>
              </label>
              <label className="checkbox-line">
                <input type="checkbox" checked={merged.generatedPrettyPrint} onChange={(event) => updateSetting('generatedPrettyPrint', event.target.checked)} />
                {t.generatedPrettyPrint}
              </label>
              <label className="checkbox-line">
                <input type="checkbox" checked={merged.generatedNonessential} onChange={(event) => updateSetting('generatedNonessential', event.target.checked)} />
                {t.generatedNonessential}
              </label>
              <label className="checkbox-line">
                <input type="checkbox" checked={merged.generatedWarnings} onChange={(event) => updateSetting('generatedWarnings', event.target.checked)} />
                {t.generatedWarnings}
              </label>
              <label className="checkbox-line">
                <input type="checkbox" checked={merged.generatedForceAll} onChange={(event) => updateSetting('generatedForceAll', event.target.checked)} />
                {t.generatedForceAll}
              </label>
            </div>

            <h3>{t.generatedAtlas}</h3>
            <div className="form-grid">
              <label className="checkbox-line">
                <input type="checkbox" checked={merged.generatedPackAtlas} onChange={(event) => updateSetting('generatedPackAtlas', event.target.checked)} />
                {t.generatedPackAtlas}
              </label>
              <label>
                {t.generatedMaxWidth}
                <select value={merged.generatedMaxWidth} onChange={(event) => updateSetting('generatedMaxWidth', Number(event.target.value))}>
                  {[512, 1024, 2048, 4096].map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label>
                {t.generatedMaxHeight}
                <select value={merged.generatedMaxHeight} onChange={(event) => updateSetting('generatedMaxHeight', Number(event.target.value))}>
                  {[512, 1024, 2048, 4096].map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label>
                {t.generatedMinWidth}
                <input type="number" min={1} value={merged.generatedMinWidth} onChange={(event) => updateSetting('generatedMinWidth', Number(event.target.value))} />
              </label>
              <label>
                {t.generatedMinHeight}
                <input type="number" min={1} value={merged.generatedMinHeight} onChange={(event) => updateSetting('generatedMinHeight', Number(event.target.value))} />
              </label>
              <label>
                {t.generatedPaddingX}
                <input type="number" min={0} value={merged.generatedPaddingX} onChange={(event) => updateSetting('generatedPaddingX', Number(event.target.value))} />
              </label>
              <label>
                {t.generatedPaddingY}
                <input type="number" min={0} value={merged.generatedPaddingY} onChange={(event) => updateSetting('generatedPaddingY', Number(event.target.value))} />
              </label>
              <label>
                {t.generatedAlphaThreshold}
                <input type="number" min={0} max={255} value={merged.generatedAlphaThreshold} onChange={(event) => updateSetting('generatedAlphaThreshold', Number(event.target.value))} />
              </label>
              <label>
                {t.generatedBleedIterations}
                <input type="number" min={0} value={merged.generatedBleedIterations} onChange={(event) => updateSetting('generatedBleedIterations', Number(event.target.value))} />
              </label>
              <label>
                {t.generatedJpegQuality}
                <input type="number" min={0} max={1} step={0.05} value={merged.generatedJpegQuality} onChange={(event) => updateSetting('generatedJpegQuality', Number(event.target.value))} />
              </label>
              <label>
                {t.generatedOutputFormat}
                <select value={merged.generatedOutputFormat} onChange={(event) => updateSetting('generatedOutputFormat', event.target.value)}>
                  <option value="png">png</option>
                  <option value="jpg">jpg</option>
                  <option value="webp">webp</option>
                </select>
              </label>
              <label>
                {t.generatedTextureFormat}
                <select value={merged.generatedTextureFormat} onChange={(event) => updateSetting('generatedTextureFormat', event.target.value)}>
                  <option value="RGBA8888">RGBA8888</option>
                  <option value="RGBA4444">RGBA4444</option>
                  <option value="RGB888">RGB888</option>
                  <option value="RGB565">RGB565</option>
                  <option value="Alpha">Alpha</option>
                  <option value="LuminanceAlpha">LuminanceAlpha</option>
                </select>
              </label>
              <label>
                {t.generatedFilterMin}
                <select value={merged.generatedFilterMin} onChange={(event) => updateSetting('generatedFilterMin', event.target.value)}>
                  {['Nearest', 'Linear', 'MipMap', 'MipMapNearestNearest', 'MipMapLinearNearest', 'MipMapNearestLinear', 'MipMapLinearLinear'].map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label>
                {t.generatedFilterMag}
                <select value={merged.generatedFilterMag} onChange={(event) => updateSetting('generatedFilterMag', event.target.value)}>
                  {['Nearest', 'Linear'].map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label>
                {t.generatedWrapX}
                <select value={merged.generatedWrapX} onChange={(event) => updateSetting('generatedWrapX', event.target.value)}>
                  {['ClampToEdge', 'Repeat', 'MirroredRepeat'].map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label>
                {t.generatedWrapY}
                <select value={merged.generatedWrapY} onChange={(event) => updateSetting('generatedWrapY', event.target.value)}>
                  {['ClampToEdge', 'Repeat', 'MirroredRepeat'].map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label>
                {t.generatedPacking}
                <select value={merged.generatedPacking} onChange={(event) => updateSetting('generatedPacking', event.target.value)}>
                  <option value="polygons">polygons</option>
                  <option value="rectangles">rectangles</option>
                </select>
              </label>
              {(
                [
                  ['generatedPremultiplyAlpha', t.generatedPremultiplyAlpha],
                  ['generatedPot', t.generatedPot],
                  ['generatedMultipleOfFour', t.generatedMultipleOfFour],
                  ['generatedSquare', t.generatedSquare],
                  ['generatedStripWhitespaceX', t.generatedStripWhitespaceX],
                  ['generatedStripWhitespaceY', t.generatedStripWhitespaceY],
                  ['generatedRotation', t.generatedRotation],
                  ['generatedAlias', t.generatedAlias],
                  ['generatedIgnoreBlankImages', t.generatedIgnoreBlankImages],
                  ['generatedBleed', t.generatedBleed],
                  ['generatedEdgePadding', t.generatedEdgePadding],
                  ['generatedDuplicatePadding', t.generatedDuplicatePadding],
                  ['generatedFast', t.generatedFast],
                  ['generatedLimitMemory', t.generatedLimitMemory]
                ] as [keyof MergedConfig, string][]
              ).map(([key, label]) => (
                <label className="checkbox-line" key={key}>
                  <input type="checkbox" checked={Boolean(merged[key])} onChange={(event) => updateSetting(key, event.target.checked as never)} />
                  {label}
                </label>
              ))}
            </div>

            <h3>{t.generatedPaths}</h3>
            <div className="form-grid">
              <label>
                {t.generatedAtlasExtension}
                <input value={merged.generatedAtlasExtension} onChange={(event) => updateSetting('generatedAtlasExtension', event.target.value)} />
              </label>
              <label>
                {t.generatedPackSource}
                <select value={merged.generatedPackSource} onChange={(event) => updateSetting('generatedPackSource', event.target.value)}>
                  <option value="attachments">attachments</option>
                  <option value="folder">folder</option>
                </select>
              </label>
              <label>
                {t.generatedPackTarget}
                <select value={merged.generatedPackTarget} onChange={(event) => updateSetting('generatedPackTarget', event.target.value)}>
                  <option value="perskeleton">perskeleton</option>
                  <option value="single">single</option>
                </select>
              </label>
              <label className="checkbox-line">
                <input type="checkbox" checked={merged.generatedCombineSubdirectories} onChange={(event) => updateSetting('generatedCombineSubdirectories', event.target.checked)} />
                {t.generatedCombineSubdirectories}
              </label>
              <label className="checkbox-line">
                <input type="checkbox" checked={merged.generatedFlattenPaths} onChange={(event) => updateSetting('generatedFlattenPaths', event.target.checked)} />
                {t.generatedFlattenPaths}
              </label>
              <label className="checkbox-line">
                <input type="checkbox" checked={merged.generatedUseIndexes} onChange={(event) => updateSetting('generatedUseIndexes', event.target.checked)} />
                {t.generatedUseIndexes}
              </label>
            </div>
          </div>
        </>
      )}
      <div className="form-grid">
        <label>
          {t.targetVersion}
          <div className="inline-field">
            <select value={merged.targetVersion} onChange={(event) => updateSetting('targetVersion', event.target.value)}>
              {targetVersions.map((version) => (
                <option key={version} value={version}>{version}</option>
              ))}
            </select>
            <button className="icon-button" title={t.detectVersion} disabled={isDetectingVersion} onClick={() => detectVersion()}>
              {isDetectingVersion ? <RotateCw className="spin" size={18} /> : <Search size={18} />}
            </button>
          </div>
        </label>
        <label>
          {t.builtInExport}
          <select value={merged.builtInExport} onChange={(event) => updateSetting('builtInExport', event.target.value)}>
            <option value="binary+pack">binary+pack</option>
            <option value="json+pack">json+pack</option>
            <option value="binary">binary</option>
            <option value="json">json</option>
          </select>
        </label>
        <label>
          {t.missingJson}
          <select value={merged.fallbackMode} onChange={(event) => updateSetting('fallbackMode', event.target.value as FallbackMode)}>
            <option value="builtIn">{t.useBuiltIn}</option>
            <option value="globalJson">{t.useGlobalJson}</option>
            <option value="skip">{t.skipFile}</option>
          </select>
        </label>
        <label>
          {t.globalExportJson}
          <div className="inline-field">
            <input value={merged.globalJsonPath} onChange={(event) => updateSetting('globalJsonPath', event.target.value)} />
            <button className="icon-button" title={t.globalExportJson} disabled={isChoosingGlobalJson} onClick={chooseGlobalJsonFile}>
              <FolderOpen size={16} />
            </button>
          </div>
        </label>
        <label>
          {t.globalPreset}
          <select value={selectedExportPreset?.path ?? ''} onChange={(event) => updateSetting('globalJsonPath', event.target.value)}>
            <option value="">{t.noPreset}</option>
            {exportPresets.map((preset) => (
              <option key={`${preset.builtIn ? 'built-in' : 'user'}:${preset.name}`} value={preset.path}>
                {preset.builtIn ? t.builtInPreset : t.userPreset}: {preset.name}
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
          <button className="secondary-button" disabled={isPresetBusy || !selectedExportPreset || selectedExportPreset.builtIn} onClick={deleteUserPreset}>
            <Trash2 size={16} />
            {t.deletePreset}
          </button>
          {presetImportedTick && (
            <span className="preset-tick" role="status">
              <CheckCircle2 size={16} />
              {t.presetImported}
            </span>
          )}
        </div>
        <p className="helper-text">{t.presetImportHelp}</p>
        {selectedExportPreset ? (
          <label>
            {`${t.presetPreview} — ${selectedExportPreset.builtIn ? t.builtInPreset : t.userPreset}: ${selectedExportPreset.name}`}
            <textarea
              value={selectedExportPreset.builtIn ? '' : presetPreview}
              readOnly
              rows={8}
              spellCheck={false}
              placeholder={selectedExportPreset.builtIn ? t.presetReadOnly : ''}
            />
          </label>
        ) : (
          <p className="helper-text">{t.presetNoneSelected}</p>
        )}
      </div>
    </Section>
  );
}
