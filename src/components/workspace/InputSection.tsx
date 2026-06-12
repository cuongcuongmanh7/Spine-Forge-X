import { useMemo } from 'react';
import { AlertTriangle, FileText, FolderOpen, Info, RotateCw, Trash2 } from 'lucide-react';
import { Section } from '../common';
import { SpineFileIcon } from '../SpineFileIcon';
import { basename } from '../../sessions';
import { useApp } from '../../useAppController';
import './InputSection.css';

/** Display name for a spine file: the file name without the .spine extension. */
function spineName(path: string): string {
  return basename(path).replace(/\.spine$/i, '');
}

/** Nearest containing folder name, used to disambiguate duplicate file names. */
function parentName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  return idx >= 0 ? basename(trimmed.slice(0, idx)) : '';
}

export function InputSection() {
  const {
    t,
    merged,
    updateInputPath,
    files,
    skippedFiles,
    removeFile,
    restoreExcludedFile,
    restoreAllExcluded,
    scanInput,
    chooseInputFolder,
    chooseInputFiles,
    isChoosingInputFiles,
    isChoosingInputFolder,
    isScanning,
    scannedPath,
    activeSessionId,
    sessions,
    sharedInputFiles
  } = useApp();

  // Which files in this session are also used by another session, and the names of those
  // sessions (for the per-row tooltip). Empty when nothing overlaps.
  const sharedHere = (activeSessionId && sharedInputFiles[activeSessionId]) || {};
  const sessionName = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sessions) map.set(s.id, s.name || basename(s.config.inputPath) || t.untitledSession);
    return map;
  }, [sessions, t.untitledSession]);

  // "Scanned this exact path and found nothing" (error, red border) vs
  // "path was edited but not rescanned yet" (neutral hint, no alarm).
  const pathPending = merged.inputPath.trim() !== '' && !isScanning && files.length === 0;
  const scanCameUpEmpty = pathPending && scannedPath === merged.inputPath;
  const needsRescan = pathPending && scannedPath !== merged.inputPath;
  // Empty path with nothing loaded — a gentle nudge, not an error (no red border).
  const isEmpty = merged.inputPath.trim() === '' && !isScanning && files.length === 0;

  // Count display names so we only show the disambiguating folder when names collide.
  const nameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const file of files) {
      const name = spineName(file);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return counts;
  }, [files]);

  return (
    <Section title={t.inputFiles}>
      <div className="form-row">
        <label>{t.inputPath}</label>
        <input
          className={scanCameUpEmpty ? 'field-invalid' : undefined}
          value={merged.inputPath}
          onChange={(event) => updateInputPath(event.target.value)}
          placeholder="D:\Project\SpineAssets"
        />
        <button className="icon-button" title={t.scan} aria-label={t.scan} disabled={isScanning || !merged.inputPath.trim()} onClick={scanInput}>
          <RotateCw className={isScanning ? 'spin' : undefined} size={18} />
        </button>
      </div>
      <div className="button-row offset-row">
        <button className="secondary-button" disabled={isChoosingInputFolder || isScanning} onClick={chooseInputFolder}>
          {isChoosingInputFolder ? <RotateCw className="spin" size={18} /> : <FolderOpen size={18} />}
          {t.browseFolder}
        </button>
        <button className="secondary-button" disabled={isChoosingInputFiles} onClick={chooseInputFiles}>
          {isChoosingInputFiles ? <RotateCw className="spin" size={18} /> : <FileText size={18} />}
          {t.browseFiles}
        </button>
      </div>
      <div className="file-summary">
        <span>{files.length.toLocaleString()} {t.spineFiles}</span>
        <span>{skippedFiles.length.toLocaleString()} {t.skipped}</span>
      </div>
      {scanCameUpEmpty && (
        <div className="notice warning" role="status" aria-live="polite">
          <AlertTriangle size={18} />
          <span>{t.noSpineFiles}</span>
        </div>
      )}
      {needsRescan && (
        <div className="notice info" role="status" aria-live="polite">
          <Info size={18} />
          <span>{t.inputNeedsScan}</span>
        </div>
      )}
      {isEmpty && (
        <div className="notice info" role="status" aria-live="polite">
          <Info size={18} />
          <span>{t.inputEmptyHint}</span>
        </div>
      )}
      {files.length > 0 && (
        <div className="file-list">
          {files.map((file) => {
            const name = spineName(file);
            const duplicated = (nameCounts.get(name) ?? 0) > 1;
            const folder = parentName(file);
            const sharedWith = sharedHere[file];
            const sharedTitle = sharedWith?.length
              ? t.sharedWithSessions.replace('{names}', sharedWith.map((id) => sessionName.get(id) ?? id).join(', '))
              : undefined;
            return (
              <div className="file-pill" key={file} title={file}>
                <SpineFileIcon size={16} />
                <span className="file-pill-name">
                  {name}
                  {duplicated && folder && <span className="file-path-note"> · {folder}</span>}
                </span>
                {sharedTitle && (
                  <span className="file-pill-shared" title={sharedTitle} role="img" aria-label={sharedTitle}>
                    <AlertTriangle size={13} />
                  </span>
                )}
                <button className="file-pill-remove" title={t.remove} aria-label={`${t.remove}: ${name}`} onClick={() => removeFile(file)}>
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {(merged.excludedFiles?.length ?? 0) > 0 && (
        <div className="excluded-block">
          <div className="excluded-head">
            <span>{merged.excludedFiles.length.toLocaleString()} {t.hiddenFiles}</span>
            <button className="link-button" onClick={() => void restoreAllExcluded()}>{t.restoreAll}</button>
          </div>
          <div className="excluded-list">
            {merged.excludedFiles.map((file) => (
              <div className="excluded-item" key={file} title={file}>
                <span className="file-pill-name">{spineName(file)}</span>
                <button className="link-button" onClick={() => restoreExcludedFile(file)}>{t.restore}</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}
