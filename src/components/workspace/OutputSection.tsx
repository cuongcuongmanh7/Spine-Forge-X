import { useEffect, useState } from 'react';
import { AlertTriangle, FolderOpen, RotateCw, Link2, Wand2, Trash2 } from 'lucide-react';
import { Section, FieldStatus, Hint } from '../common';
import { useApp } from '../../useAppController';
import { basename } from '../../sessions';
import type { OutputPolicy } from '../../types';

/** Live preview of where the linkedProject policy will route the first scanned file. */
function LinkedDestPreview() {
  const { t, merged, files, linkedProjects, listSubdirectories, idToken } = useApp();
  const [line, setLine] = useState<{ path: string; reuse: boolean } | null>(null);

  const project = linkedProjects.find((p) => p.id === merged.linkedProjectId);
  const type = project?.types.find((ty) => ty.sourceName === merged.linkedTypeName);
  const sampleFolder = files.length > 0 ? basename(files[0].replace(/[\\/][^\\/]*$/, '')) : '';

  useEffect(() => {
    let cancelled = false;
    if (!project || !type || !project.unityRoot.trim() || !sampleFolder) {
      setLine(null);
      return;
    }
    const base = `${project.unityRoot.replace(/[\\/]+$/, '')}/${type.destName}`;
    const id = idToken(sampleFolder);
    void (async () => {
      const subdirs = await listSubdirectories(base);
      if (cancelled) return;
      const exact = subdirs.find((d) => d === id);
      const prefixed = subdirs.find((d) => d.startsWith(`${id}_`));
      const folder = exact ?? prefixed;
      setLine({ path: `${base}/${folder ?? sampleFolder}`, reuse: Boolean(folder) });
    })();
    return () => {
      cancelled = true;
    };
  }, [project, type, sampleFolder, idToken, listSubdirectories]);

  if (!project || !type) {
    return <small className="helper-text">{t.linkedNoSelection}</small>;
  }
  if (!line) {
    return <small className="helper-text">{t.linkedDestPreview}: {project.unityRoot || '—'}/{type.destName}/…</small>;
  }
  return (
    <small className="helper-text">
      {t.linkedDestPreview}: <code>{line.path}</code> {line.reuse ? t.linkedWillReuse : t.linkedWillCreate}
    </small>
  );
}

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
    isChoosingOutputFolder,
    linkedProjects,
    setLinkedModalOpen,
    files,
    autoDetectLinkedType,
    linkedTypeWarning,
    setCleanSourceFolderOpen
  } = useApp();

  const isPackFolder = merged.generatedPackSource === 'imagefolders' || merged.generatedPackSource === 'folder';

  const selectedLinked = linkedProjects.find((p) => p.id === merged.linkedProjectId);
  const isLinked = merged.outputPolicy === 'linkedProject';

  // Auto-pick the Type from input paths when a Project is chosen but no Type is set yet.
  useEffect(() => {
    if (isLinked && merged.linkedProjectId && !merged.linkedTypeName) autoDetectLinkedType();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLinked, merged.linkedProjectId, files.length]);

  return (
    <Section title={t.outputDirectory}>
      {!isLinked && (
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
          <button className="icon-button" title={t.browseOutput} aria-label={t.browseOutput} disabled={isChoosingOutputFolder} onClick={chooseOutputFolder}>
            {isChoosingOutputFolder ? <RotateCw className="spin" size={18} /> : <FolderOpen size={18} />}
          </button>
        </div>
      )}
      <div className="form-row">
        <label>{t.outputPolicy}</label>
        <div className="mode-grid output-policy-grid">
          {(
            [
              // Note: the 'timestamp' policy is temporarily hidden (still supported by the backend).
              ['sourceFolderName', t.sourceFolderPolicy, t.sourceFolderPolicyHelp],
              ['linkedProject', t.linkedProjectPolicy, t.linkedProjectPolicyHelp]
            ] as [OutputPolicy, string, string][]
          ).map(([value, label, description]) => (
            <label className="mode-option detailed" key={value}>
              <input type="radio" checked={merged.outputPolicy === value} onChange={() => updateSetting('outputPolicy', value)} />
              <span className="mode-option-content">
                <strong>{label}<Hint text={description} /></strong>
              </span>
            </label>
          ))}
        </div>
      </div>
      {isLinked && (
        <div className="linked-config">
          <div className="form-row">
            <label>{t.linkedProjectLabel}</label>
            <select
              value={merged.linkedProjectId}
              onChange={(event) => {
                updateSetting('linkedProjectId', event.target.value);
                updateSetting('linkedTypeName', '');
              }}
            >
              <option value="">{t.linkedSelectProject}</option>
              {linkedProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || p.unityRoot || p.id}
                </option>
              ))}
            </select>
            <button className="icon-button" title={t.manageLinkedProjects} aria-label={t.manageLinkedProjects} onClick={() => setLinkedModalOpen(true)}>
              <Link2 size={18} />
            </button>
          </div>
          <div className="form-row">
            <label>{t.linkedTypeLabel}</label>
            <select
              value={merged.linkedTypeName}
              disabled={!selectedLinked}
              onChange={(event) => updateSetting('linkedTypeName', event.target.value)}
            >
              <option value="">{t.linkedSelectType}</option>
              {selectedLinked?.types.map((ty) => (
                <option key={ty.sourceName} value={ty.sourceName}>
                  {ty.sourceName} → {ty.destName}
                </option>
              ))}
            </select>
            <button
              className="icon-button"
              title={t.autoDetectType}
              aria-label={t.autoDetectType}
              disabled={!selectedLinked || files.length === 0}
              onClick={() => autoDetectLinkedType()}
            >
              <Wand2 size={18} />
            </button>
          </div>
          {linkedTypeWarning && (
            <div className="notice warning" role="status" aria-live="polite">
              <AlertTriangle size={18} />
              <span>{linkedTypeWarning}</span>
            </div>
          )}
          <button className="secondary-button" onClick={() => setLinkedModalOpen(true)}>
            {t.manageLinkedProjects}
          </button>
          <LinkedDestPreview />
        </div>
      )}
      <div className="output-options">
        <div className="output-option">
          <label className="checkbox-line">
            <input type="checkbox" checked={merged.clean} onChange={(event) => updateSetting('clean', event.target.checked)} />
            {t.cleanAnimation}
            <Hint text={t.cleanAnimationHelp} />
          </label>
        </div>
        <div className="output-option">
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={merged.unicodeWorkaround}
              onChange={(event) => updateSetting('unicodeWorkaround', event.target.checked)}
            />
            {t.unicodeWorkaround}
            <Hint text={t.unicodeWorkaroundHelp} />
          </label>
        </div>
        {merged.outputPolicy === 'sourceFolderName' && (
          <div className="output-option">
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={merged.cleanFolderName}
                onChange={(event) => updateSetting('cleanFolderName', event.target.checked)}
              />
              {t.cleanFolderName}
              <Hint text={t.cleanFolderNameHelp} />
            </label>
          </div>
        )}
        {isPackFolder && (
          <div className="output-option">
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={merged.autoCleanSourceFolderBeforeExport}
                onChange={(event) => updateSetting('autoCleanSourceFolderBeforeExport', event.target.checked)}
              />
              {t.autoCleanBeforeExport}
              <Hint text={t.packFolderCleanHint} />
            </label>
          </div>
        )}
      </div>
      <button className="secondary-button" onClick={() => setCleanSourceFolderOpen(true)}>
        <Trash2 size={16} /> {t.cleanSourceFolder}
      </button>
    </Section>
  );
}
