import { AlertTriangle, CircleStop, FolderOpen, Play, RotateCw, Trash2, XCircle } from 'lucide-react';
import { useApp } from '../../useAppController';

export function RunDock() {
  const {
    t,
    merged,
    validation,
    canStart,
    isRunning,
    isStopping,
    isOpeningOutput,
    isCleaningTimestamp,
    progress,
    currentIndex,
    currentFile,
    files,
    startExport,
    stopExport,
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
          <button className="secondary-button" disabled={!isRunning || isStopping} onClick={stopExport}>
            {isStopping ? <RotateCw className="spin" size={18} /> : <CircleStop size={18} />}
            {t.stop}
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
        <div className="progress-row">
          <progress value={progress} max={100} />
          <span>{currentIndex} / {files.length}</span>
        </div>
        {currentFile && <div className="current-file">{currentFile}</div>}
      </div>
    </div>
  );
}
