import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { defaultExportPreset } from '../config';
import { useApp } from '../useAppController';

type AnyObj = Record<string, unknown>;

const TEXTURE_FORMATS = ['RGBA8888', 'RGBA4444', 'RGB888', 'RGB565', 'Alpha', 'LuminanceAlpha'];
const FILTER_MIN = ['Nearest', 'Linear', 'MipMap', 'MipMapNearestNearest', 'MipMapLinearNearest', 'MipMapNearestLinear', 'MipMapLinearLinear'];
const FILTER_MAG = ['Nearest', 'Linear'];
const WRAP = ['ClampToEdge', 'Repeat', 'MirroredRepeat'];

/** Boolean atlas flags rendered as a checkbox grid (key → i18n label key). */
const ATLAS_FLAGS: [string, string][] = [
  ['premultiplyAlpha', 'generatedPremultiplyAlpha'],
  ['pot', 'generatedPot'],
  ['multipleOfFour', 'generatedMultipleOfFour'],
  ['square', 'generatedSquare'],
  ['stripWhitespaceX', 'generatedStripWhitespaceX'],
  ['stripWhitespaceY', 'generatedStripWhitespaceY'],
  ['rotation', 'generatedRotation'],
  ['alias', 'generatedAlias'],
  ['ignoreBlankImages', 'generatedIgnoreBlankImages'],
  ['bleed', 'generatedBleed'],
  ['edgePadding', 'generatedEdgePadding'],
  ['duplicatePadding', 'generatedDuplicatePadding'],
  ['fast', 'generatedFast'],
  ['limitMemory', 'generatedLimitMemory']
];

export function PresetEditorModal() {
  const { t, editingPreset, saveUserPreset, closePresetEditor } = useApp();

  const initial = editingPreset!;
  const [name, setName] = useState(initial.builtIn ? '' : initial.name);
  const [tab, setTab] = useState<'form' | 'json'>('form');
  const [obj, setObj] = useState<AnyObj>(() => {
    try {
      return JSON.parse(initial.content) as AnyObj;
    } catch {
      return {};
    }
  });
  const [rawText, setRawText] = useState(initial.content);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const atlas = (obj.packAtlas && typeof obj.packAtlas === 'object' ? (obj.packAtlas as AnyObj) : null);
  const atlasEnabled = atlas !== null;

  const tt = t as unknown as Record<string, string>;

  function setTop(key: string, value: unknown) {
    setObj((current) => ({ ...current, [key]: value }));
  }

  function setFormat(value: string) {
    const binary = value === 'Binary';
    setObj((current) => ({
      ...current,
      format: value,
      class: binary ? 'export-binary' : 'export-json',
      extension: binary ? '.skel' : '.json'
    }));
  }

  function setAtlas(key: string, value: unknown) {
    setObj((current) => {
      const a = (current.packAtlas && typeof current.packAtlas === 'object' ? { ...(current.packAtlas as AnyObj) } : {}) as AnyObj;
      a[key] = value;
      return { ...current, packAtlas: a };
    });
  }

  // Spine stores scale as parallel arrays (scale / scaleSuffix / scaleResampling). The form edits a
  // single scale; the JSON tab remains for multi-resolution setups. Keep all three arrays length-1.
  function setScale(value: number) {
    setObj((current) => {
      const a = (current.packAtlas && typeof current.packAtlas === 'object' ? { ...(current.packAtlas as AnyObj) } : {}) as AnyObj;
      const suffix = Array.isArray(a.scaleSuffix) ? a.scaleSuffix : [];
      const resampling = Array.isArray(a.scaleResampling) ? a.scaleResampling : [];
      a.scale = [value];
      a.scaleSuffix = [typeof suffix[0] === 'string' ? suffix[0] : ''];
      a.scaleResampling = [typeof resampling[0] === 'string' ? resampling[0] : 'bicubic'];
      return { ...current, packAtlas: a };
    });
  }

  function toggleAtlas(enabled: boolean) {
    setObj((current) => ({
      ...current,
      packAtlas: enabled ? { ...(defaultExportPreset.packAtlas as AnyObj) } : null
    }));
  }

  function onRawChange(text: string) {
    setRawText(text);
    try {
      const parsed = JSON.parse(text) as AnyObj;
      setObj(parsed);
      setJsonError(null);
    } catch (error) {
      setJsonError(String(error));
    }
  }

  function switchTab(next: 'form' | 'json') {
    if (next === 'json') {
      setRawText(JSON.stringify(obj, null, 2));
      setJsonError(null);
    }
    setTab(next);
  }

  const canSave = useMemo(() => name.trim() !== '' && !jsonError, [name, jsonError]);

  function save() {
    if (!canSave) return;
    saveUserPreset(name, JSON.stringify(obj, null, 2));
  }

  const av = (key: string): unknown => (atlas ? atlas[key] : undefined);
  const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const bool = (v: unknown) => Boolean(v);
  const scaleValue = () => {
    const s = av('scale');
    return Array.isArray(s) && s.length ? num(s[0]) : 1;
  };

  return (
    <div className="modal-backdrop" onClick={closePresetEditor}>
      <div className="modal preset-editor" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{initial.builtIn || initial.name === '' ? t.presetEditorNew : t.presetEditorTitle}</h2>
          <button className="modal-close" title={t.cancel} aria-label={t.cancel} onClick={closePresetEditor}>
            <X size={18} />
          </button>
        </div>
        <div className="preset-toolbar">
          <label>
            {t.presetName}
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-preset" />
          </label>
          {initial.builtIn && <p className="helper-text">{t.presetSaveAsHint}</p>}

          <div className="preset-tabs">
            <button className={tab === 'form' ? 'active' : ''} onClick={() => switchTab('form')}>{t.tabForm}</button>
            <button className={tab === 'json' ? 'active' : ''} onClick={() => switchTab('json')}>{t.tabJson}</button>
          </div>
        </div>
        <div className="modal-body">
          {tab === 'form' ? (
            <>
              <h3 className="preset-section-title">{t.presetSkeleton}</h3>
              <div className="form-grid">
                <label>
                  {t.generatedFormat}
                  <select value={str(obj.format) || 'JSON'} onChange={(e) => setFormat(e.target.value)}>
                    <option value="JSON">JSON</option>
                    <option value="Binary">Binary</option>
                  </select>
                </label>
                <label>
                  {t.generatedSkeletonExtension}
                  <input value={str(obj.extension)} onChange={(e) => setTop('extension', e.target.value)} />
                </label>
                <label className="checkbox-line">
                  <input type="checkbox" checked={bool(obj.prettyPrint)} onChange={(e) => setTop('prettyPrint', e.target.checked)} />
                  {t.generatedPrettyPrint}
                </label>
                <label className="checkbox-line">
                  <input type="checkbox" checked={bool(obj.nonessential)} onChange={(e) => setTop('nonessential', e.target.checked)} />
                  {t.generatedNonessential}
                </label>
                <label className="checkbox-line">
                  <input type="checkbox" checked={bool(obj.warnings)} onChange={(e) => setTop('warnings', e.target.checked)} />
                  {t.generatedWarnings}
                </label>
                <label className="checkbox-line">
                  <input type="checkbox" checked={bool(obj.forceAll)} onChange={(e) => setTop('forceAll', e.target.checked)} />
                  {t.generatedForceAll}
                </label>
              </div>

              <h3 className="preset-section-title">{t.presetAtlas}</h3>
              <label className="checkbox-line">
                <input type="checkbox" checked={atlasEnabled} onChange={(e) => toggleAtlas(e.target.checked)} />
                {t.generatedPackAtlas}
              </label>
              {atlasEnabled && (
                <div className="form-grid">
                  <label>
                    {t.generatedMaxWidth}
                    <select value={num(av('maxWidth'))} onChange={(e) => setAtlas('maxWidth', Number(e.target.value))}>
                      {[512, 1024, 2048, 4096].map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </label>
                  <label>
                    {t.generatedMaxHeight}
                    <select value={num(av('maxHeight'))} onChange={(e) => setAtlas('maxHeight', Number(e.target.value))}>
                      {[512, 1024, 2048, 4096].map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </label>
                  <label>
                    {t.generatedMinWidth}
                    <input type="number" min={1} value={num(av('minWidth'))} onChange={(e) => setAtlas('minWidth', Number(e.target.value))} />
                  </label>
                  <label>
                    {t.generatedMinHeight}
                    <input type="number" min={1} value={num(av('minHeight'))} onChange={(e) => setAtlas('minHeight', Number(e.target.value))} />
                  </label>
                  <label>
                    {t.generatedPaddingX}
                    <input type="number" min={0} value={num(av('paddingX'))} onChange={(e) => setAtlas('paddingX', Number(e.target.value))} />
                  </label>
                  <label>
                    {t.generatedPaddingY}
                    <input type="number" min={0} value={num(av('paddingY'))} onChange={(e) => setAtlas('paddingY', Number(e.target.value))} />
                  </label>
                  <label>
                    {t.generatedAlphaThreshold}
                    <input type="number" min={0} max={255} value={num(av('alphaThreshold'))} onChange={(e) => setAtlas('alphaThreshold', Number(e.target.value))} />
                  </label>
                  <label>
                    {t.generatedBleedIterations}
                    <input type="number" min={0} value={num(av('bleedIterations'))} onChange={(e) => setAtlas('bleedIterations', Number(e.target.value))} />
                  </label>
                  {str(av('outputFormat')) === 'jpg' && (
                    <label>
                      {t.generatedJpegQuality}
                      <input type="number" min={0} max={1} step={0.05} value={num(av('jpegQuality'))} onChange={(e) => setAtlas('jpegQuality', Number(e.target.value))} />
                    </label>
                  )}
                  <label>
                    {t.generatedOutputFormat}
                    <select value={str(av('outputFormat'))} onChange={(e) => setAtlas('outputFormat', e.target.value)}>
                      <option value="png">png</option>
                      <option value="jpg">jpg</option>
                      <option value="webp">webp</option>
                    </select>
                  </label>
                  <label>
                    {t.generatedTextureFormat}
                    <select value={str(av('format'))} onChange={(e) => setAtlas('format', e.target.value)}>
                      {TEXTURE_FORMATS.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </label>
                  <label>
                    {t.generatedFilterMin}
                    <select value={str(av('filterMin'))} onChange={(e) => setAtlas('filterMin', e.target.value)}>
                      {FILTER_MIN.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </label>
                  <label>
                    {t.generatedFilterMag}
                    <select value={str(av('filterMag'))} onChange={(e) => setAtlas('filterMag', e.target.value)}>
                      {FILTER_MAG.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </label>
                  <label>
                    {t.generatedWrapX}
                    <select value={str(av('wrapX'))} onChange={(e) => setAtlas('wrapX', e.target.value)}>
                      {WRAP.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </label>
                  <label>
                    {t.generatedWrapY}
                    <select value={str(av('wrapY'))} onChange={(e) => setAtlas('wrapY', e.target.value)}>
                      {WRAP.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </label>
                  <label>
                    {t.generatedScale}
                    <input type="number" min={0.1} step={0.1} value={scaleValue()} onChange={(e) => setScale(Number(e.target.value))} />
                  </label>
                  <label>
                    {t.generatedPacking}
                    <select value={str(av('packing'))} onChange={(e) => setAtlas('packing', e.target.value)}>
                      <option value="polygons">polygons</option>
                      <option value="rectangles">rectangles</option>
                    </select>
                  </label>
                  {ATLAS_FLAGS.map(([key, labelKey]) => (
                    <label className="checkbox-line" key={key}>
                      <input type="checkbox" checked={bool(av(key))} onChange={(e) => setAtlas(key, e.target.checked)} />
                      {tt[labelKey]}
                    </label>
                  ))}
                </div>
              )}

              <h3 className="preset-section-title">{t.presetPaths}</h3>
              <div className="form-grid">
                <label>
                  {t.generatedPackSource}
                  <select
                    value={str(obj.packSource) === 'folder' ? 'imagefolders' : str(obj.packSource)}
                    onChange={(e) => setTop('packSource', e.target.value)}
                  >
                    <option value="attachments">attachments</option>
                    <option value="imagefolders">folder</option>
                  </select>
                </label>
                <label>
                  {t.generatedPackTarget}
                  <select value={str(obj.packTarget)} onChange={(e) => setTop('packTarget', e.target.value)}>
                    <option value="perskeleton">perskeleton</option>
                    <option value="single">single</option>
                  </select>
                </label>
                {atlasEnabled && (
                  <>
                    <label>
                      {t.generatedAtlasExtension}
                      <input value={str(av('atlasExtension'))} onChange={(e) => setAtlas('atlasExtension', e.target.value)} />
                    </label>
                    <label className="checkbox-line">
                      <input type="checkbox" checked={bool(av('combineSubdirectories'))} onChange={(e) => setAtlas('combineSubdirectories', e.target.checked)} />
                      {t.generatedCombineSubdirectories}
                    </label>
                    <label className="checkbox-line">
                      <input type="checkbox" checked={bool(av('flattenPaths'))} onChange={(e) => setAtlas('flattenPaths', e.target.checked)} />
                      {t.generatedFlattenPaths}
                    </label>
                    <label className="checkbox-line">
                      <input type="checkbox" checked={bool(av('useIndexes'))} onChange={(e) => setAtlas('useIndexes', e.target.checked)} />
                      {t.generatedUseIndexes}
                    </label>
                  </>
                )}
              </div>
            </>
          ) : (
            <label className="preset-json-edit">
              {t.presetContent}
              <textarea
                value={rawText}
                rows={18}
                spellCheck={false}
                onChange={(e) => onRawChange(e.target.value)}
              />
              {jsonError && <small className="field-error-text">{t.presetJsonInvalid}: {jsonError}</small>}
            </label>
          )}
        </div>
        <div className="modal-footer">
          <button className="secondary-button" onClick={closePresetEditor}>{t.cancel}</button>
          <button className="primary-button" disabled={!canSave} onClick={save}>{t.savePreset}</button>
        </div>
      </div>
    </div>
  );
}
