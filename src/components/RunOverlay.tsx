import { CircleStop, RotateCw } from 'lucide-react';
import { useApp } from '../useAppController';

export function RunOverlay() {
  const { t, sessions, runningSessionId, liveProgress, batchProgress, isStopping, stopExport } = useApp();

  const runningSession = sessions.find((s) => s.id === runningSessionId) ?? null;
  const { current, total, file } = liveProgress;
  const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const sessionLabel = runningSession?.name || t.untitledSession;

  return (
    <div className="run-overlay" role="alertdialog" aria-modal="true" aria-busy="true">
      <div className="run-overlay-card">
        <RotateCw className="spin run-overlay-spinner" size={26} />
        <h2 className="run-overlay-title">{t.processing}</h2>
        <p className="run-overlay-session" title={sessionLabel}>{sessionLabel}</p>
        {batchProgress && (
          <p className="run-overlay-batch">
            {t.exportAllProgress
              .replace('{index}', String(batchProgress.index))
              .replace('{count}', String(batchProgress.count))}
          </p>
        )}
        <div className="run-overlay-progress">
          <progress value={percent} max={100} />
          <span>{current} / {total}</span>
        </div>
        {file && <p className="run-overlay-file" title={file}>{file}</p>}
        <p className="run-overlay-hint">{t.processingHint}</p>
        <button className="secondary-button" disabled={isStopping} onClick={stopExport}>
          {isStopping ? <RotateCw className="spin" size={16} /> : <CircleStop size={16} />}
          {t.stop}
        </button>
      </div>
    </div>
  );
}
