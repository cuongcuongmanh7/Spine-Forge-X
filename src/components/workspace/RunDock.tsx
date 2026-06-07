import { AlertTriangle, FolderOpen, Info, Play, RotateCw, Trash2, XCircle } from 'lucide-react';
import { useApp } from '../../useAppController';

/** True when any string contains a non-ASCII character (matches backend has_non_ascii). */
function containsNonAscii(...values: string[]): boolean {
  // eslint-disable-next-line no-control-regex
  return values.some((value) => /[^\x00-\x7F]/.test(value));
}

export function RunDock() {
  const {
    t,
    merged,
    files,
    validation,
    canStart,
    isRunning,
    isOpeningOutput,
    isCleaningTimestamp,
    startExport,
    openOutputFolder,
    cleanTimestampExports,
    resolveOpenOutputTarget
  } = useApp();

  // Warn (once) when input/output paths have non-ASCII characters and the workaround is off.
  const nonAscii = containsNonAscii(merged.inputPath, merged.outputPath, files[0] ?? '');
  const showUnicodeWarning = nonAscii && !merged.unicodeWorkaround;

  return (
    <div className="run-dock">
      <div className="run-dock-inner">
        {showUnicodeWarning && (
          <div className="notice info" role="status" aria-live="polite">
            <Info size={18} />
            <span>{t.unicodeWarning}</span>
          </div>
        )}
        {validation.errors.length > 0 && (
          <div className="notice danger" role="alert">
            <XCircle size={18} />
            <span>{validation.errors.join(' ')}</span>
          </div>
        )}
        {validation.warnings.length > 0 && (
          <div className="notice warning" role="status" aria-live="polite">
            <AlertTriangle size={18} />
            <span>{validation.warnings.join(' ')}</span>
          </div>
        )}
        <div className="run-actions">
          <button className="primary-button" disabled={!canStart || isRunning} onClick={startExport}>
            {isRunning ? <RotateCw className="spin" size={18} /> : <Play size={18} />}
            {isRunning ? t.running : t.start}
          </button>
          <button className="secondary-button" disabled={!resolveOpenOutputTarget() || isOpeningOutput} onClick={openOutputFolder}>
            {isOpeningOutput ? <RotateCw className="spin" size={18} /> : <FolderOpen size={18} />}
            {t.openOutput}
          </button>
          <button className="secondary-button" disabled={!merged.inputPath || isCleaningTimestamp} onClick={cleanTimestampExports}>
            {isCleaningTimestamp ? <RotateCw className="spin" size={18} /> : <Trash2 size={18} />}
            {t.cleanTimestamp}
          </button>
        </div>
      </div>
    </div>
  );
}
