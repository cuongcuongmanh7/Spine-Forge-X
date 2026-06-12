import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { confirm } from '@tauri-apps/plugin-dialog';
import { useApp } from '../useAppController';
import { PresetFormTab } from './preset/PresetFormTab';

type AnyObj = Record<string, unknown>;

export function PresetEditorModal() {
  const { t, editingPreset, saveUserPreset, closePresetEditor } = useApp();

  const initial = editingPreset!;
  const initialName = initial.builtIn ? '' : initial.name;
  const [name, setName] = useState(initialName);
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

  // Baseline snapshot of the preset content as first loaded; `obj` starts as a parse of the same
  // string, so an untouched form serializes identically. A JSON-tab parse error also counts as dirty
  // because the raw text has diverged from `obj`.
  const initialObjJson = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(initial.content) as AnyObj);
    } catch {
      return JSON.stringify({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const isDirty = name !== initialName || JSON.stringify(obj) !== initialObjJson || jsonError !== null;

  async function requestClose() {
    if (isDirty) {
      const discard = await confirm(t.presetDiscardBody, { title: t.presetDiscardTitle, kind: 'warning' });
      if (!discard) return;
    }
    closePresetEditor();
  }

  function save() {
    if (!canSave) return;
    saveUserPreset(name, JSON.stringify(obj, null, 2));
  }

  return (
    <div className="modal-backdrop" onClick={() => void requestClose()}>
      <div className="modal preset-editor" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{initial.builtIn || initial.name === '' ? t.presetEditorNew : t.presetEditorTitle}</h2>
          <button className="modal-close" title={t.cancel} aria-label={t.cancel} onClick={() => void requestClose()}>
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
            <PresetFormTab t={t} obj={obj} setObj={setObj} />
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
          <button className="secondary-button" onClick={() => void requestClose()}>{t.cancel}</button>
          <button className="primary-button" disabled={!canSave} onClick={save}>{t.savePreset}</button>
        </div>
      </div>
    </div>
  );
}
