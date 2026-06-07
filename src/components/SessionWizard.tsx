import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, FolderOpen, RotateCw, Search } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { FieldStatus } from './common';
import { useApp } from '../useAppController';
import { InputSection } from './workspace/InputSection';
import { ExportStrategySection } from './workspace/ExportStrategySection';
import { OutputSection } from './workspace/OutputSection';

type StepKey = 'spine' | 'input' | 'export' | 'output';

const STEPS: StepKey[] = ['spine', 'input', 'export', 'output'];

/** Forced step-by-step setup shown for a brand-new session until it is completed. */
export function SessionWizard() {
  const {
    t,
    activeSession,
    merged,
    validation,
    files,
    completeWizard,
    autoDetectSpine,
    isAutoDetecting,
    updateAppConfig
  } = useApp();

  const titles: Record<StepKey, string> = {
    spine: t.wizardSpineTitle,
    input: t.wizardInputTitle,
    export: t.wizardExportTitle,
    output: t.wizardOutputTitle
  };

  function isValid(key: StepKey): boolean {
    switch (key) {
      case 'spine':
        return Boolean(validation.spineOk);
      case 'input':
        return files.length > 0;
      case 'export':
        return merged.globalJsonPath.trim() !== '' && merged.targetVersion.trim() !== '';
      case 'output':
        return merged.outputPolicy === 'linkedProject'
          ? merged.linkedProjectId.trim() !== '' && merged.linkedTypeName.trim() !== ''
          : merged.outputPath.trim() !== '';
    }
  }

  // Start on the first step that still needs attention (so a pre-configured Spine isn't a dead stop).
  const [step, setStep] = useState(() => {
    const firstInvalid = STEPS.findIndex((k) => !isValid(k));
    return firstInvalid === -1 ? 0 : firstInvalid;
  });

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const canNext = isValid(current);

  // A step is reachable by click only when every step before it is already valid.
  function canGoTo(target: number): boolean {
    return STEPS.slice(0, target).every((k) => isValid(k));
  }

  async function browseSpine() {
    const selected = await open({ directory: false, multiple: false, defaultPath: merged.spinePath.trim() || undefined });
    if (typeof selected === 'string') updateAppConfig('spinePath', selected);
  }

  function next() {
    if (!canNext) return;
    if (isLast) {
      if (activeSession) completeWizard(activeSession.id);
      return;
    }
    setStep(step + 1);
  }

  return (
    <div className="wizard">
      <ol className="wizard-progress">
        {STEPS.map((key, i) => {
          const done = isValid(key);
          const active = i === step;
          const reachable = canGoTo(i);
          return (
            <li key={key} className={`wizard-step${active ? ' active' : ''}${done ? ' done' : ''}`}>
              <button
                className="wizard-step-btn"
                disabled={!reachable && !active}
                onClick={() => reachable && setStep(i)}
                title={titles[key]}
              >
                <span className="wizard-step-num">{done && !active ? <Check size={14} /> : i + 1}</span>
                <span className="wizard-step-name">{titles[key]}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="wizard-body">
        {current === 'spine' && (
          <div className="section">
            <div className="section-body">
              <p className="helper-text">{t.wizardSpineHelp}</p>
              <div className="form-row">
                <label>{t.executablePath}</label>
                <input
                  value={merged.spinePath}
                  onChange={(event) => updateAppConfig('spinePath', event.target.value)}
                  placeholder="C:\Program Files\Spine\Spine.com"
                />
                <FieldStatus
                  ok={Boolean(validation.spineOk)}
                  warning={Boolean(validation.spineWarning)}
                  message={
                    !merged.spinePath.trim()
                      ? t.executableEmpty
                      : validation.spineOk
                        ? t.executableValid
                        : validation.spineWarning
                          ? t.executableComWarning
                          : t.executableMissing
                  }
                />
              </div>
              <div className="button-row offset-row">
                <button className="secondary-button" disabled={isAutoDetecting} onClick={() => autoDetectSpine(false)}>
                  {isAutoDetecting ? <RotateCw className="spin" size={18} /> : <Search size={18} />}
                  {t.autoDetect}
                </button>
                <button className="secondary-button" onClick={browseSpine}>
                  <FolderOpen size={18} />
                  {t.browse}
                </button>
              </div>
            </div>
          </div>
        )}
        {current === 'input' && <InputSection />}
        {current === 'export' && <ExportStrategySection />}
        {current === 'output' && <OutputSection />}
      </div>

      <div className="wizard-footer">
        <button className="secondary-button lg" disabled={step === 0} onClick={() => setStep(step - 1)}>
          <ArrowLeft size={18} /> {t.wizardBack}
        </button>
        <span className="wizard-step-label">
          {t.wizardStep} {step + 1}/{STEPS.length}
        </span>
        <button className="primary-button lg" disabled={!canNext} onClick={next}>
          {isLast ? (
            <>
              <Check size={18} /> {t.wizardFinish}
            </>
          ) : (
            <>
              {t.wizardNext} <ArrowRight size={18} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
