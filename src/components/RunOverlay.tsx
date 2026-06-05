import { CircleStop, RotateCw } from 'lucide-react';
import { useApp } from '../useAppController';

/** Reduce a full path to its last two segments, e.g. "3001_Lucius/hero.spine". */
function shortenPath(path: string): string {
  const segments = path.split(/[\\/]+/).filter(Boolean);
  return segments.slice(-2).join('/');
}

export function RunOverlay() {
  const { t, sessions, runningSessionId, liveProgress, batchProgress, isStopping, stopExport } = useApp();

  const runningSession = sessions.find((s) => s.id === runningSessionId) ?? null;
  const { current, total, file } = liveProgress;
  const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const sessionLabel = runningSession?.name || t.untitledSession;
  // Show a compact <folder>/<file> path instead of the full absolute path.
  const shortFile = shortenPath(file);

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
        {file && <p className="run-overlay-file" title={file}>{shortFile}</p>}
        <p className="run-overlay-hint">{t.processingHint}</p>
        <button className="secondary-button" disabled={isStopping} onClick={stopExport}>
          {isStopping ? <RotateCw className="spin" size={16} /> : <CircleStop size={16} />}
          {t.stop}
        </button>
      </div>
    </div>
  );
}
