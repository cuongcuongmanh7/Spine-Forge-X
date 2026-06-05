import { AlertTriangle, FolderOpen, Play, RotateCw, Trash2, XCircle } from 'lucide-react';
import { useApp } from '../../useAppController';

export function RunDock() {
  const {
    t,
    merged,
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

  return (
    <div className="run-dock">
      <div className="run-dock-inner">
        {validation.errors.length > 0 && (
          <div className="notice danger">
            <XCircle size={18} />
            <span>{validation.errors.join(' ')}</span>
          </div>
        )}
        {validation.warnings.length > 0 && (
          <div className="notice warning">
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
