import { FolderOpen, RotateCw } from 'lucide-react';
import { Section, FieldStatus } from '../common';
import { useApp } from '../../useAppController';
import type { OutputPolicy } from '../../types';

export function OutputSection() {
  const {
    t,
    merged,
    updateSetting,
    updateOutputPath,
    validation,
    outputHelper,
    outputRootMissingForSourceFolder,
    chooseOutputFolder,
    isChoosingOutputFolder
  } = useApp();

  return (
    <Section title={t.outputDirectory}>
      <div className="form-row">
        <label>{t.outputRoot}</label>
        <input
          className={outputRootMissingForSourceFolder ? 'field-invalid' : undefined}
          value={merged.outputPath}
          onChange={(event) => updateOutputPath(event.target.value)}
          placeholder="Optional: D:\Project\Output"
        />
        <FieldStatus
          ok={Boolean(validation.outputOk)}
          warning={Boolean(validation.outputWarning)}
          message={merged.outputPath.trim() ? (validation.outputOk ? t.outputExists : t.outputMissing) : outputHelper}
        />
        <button className="icon-button" title={t.browseOutput} disabled={isChoosingOutputFolder} onClick={chooseOutputFolder}>
          {isChoosingOutputFolder ? <RotateCw className="spin" size={18} /> : <FolderOpen size={18} />}
        </button>
      </div>
      <div className="form-row">
        <label>{t.outputPolicy}</label>
        <div className="mode-grid output-policy-grid">
          {(
            [
              ['timestamp', t.timestampPolicy, t.timestampPolicyHelp],
              ['sourceFolderName', t.sourceFolderPolicy, t.sourceFolderPolicyHelp]
            ] as [OutputPolicy, string, string][]
          ).map(([value, label, description]) => (
            <label className="mode-option detailed" key={value}>
              <input type="radio" checked={merged.outputPolicy === value} onChange={() => updateSetting('outputPolicy', value)} />
              <span className="mode-option-content">
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
            </label>
          ))}
        </div>
      </div>
      <p className="helper-text">{outputHelper}</p>
    </Section>
  );
}
