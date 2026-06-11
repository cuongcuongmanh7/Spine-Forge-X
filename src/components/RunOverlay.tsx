import { useEffect, useState } from 'react';
import { CircleStop, Loader2, RotateCw } from 'lucide-react';
import { useApp } from '../useAppController';
import { formatDuration } from '../time';
import './RunOverlay.css';

/** Reduce a full path to its last two segments, e.g. "3001_Lucius/hero.spine". */
function shortenPath(path: string): string {
  const segments = path.split(/[\\/]+/).filter(Boolean);
  return segments.slice(-2).join('/');
}

export function RunOverlay() {
  const { t, sessions, runningSessionId, liveProgress, batchProgress, activeJobs, runStartedAt, isStopping, stopExport } = useApp();

  // 1s tick so the elapsed timers advance while the overlay is up.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const runningSession = sessions.find((s) => s.id === runningSessionId) ?? null;
  const { current, total } = liveProgress;
  const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const sessionLabel = runningSession?.name || t.untitledSession;
  const jobs = Object.entries(activeJobs).sort((a, b) => a[1] - b[1]);

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
        {runStartedAt !== null && (
          <p className="run-overlay-elapsed">{t.elapsedTime.replace('{time}', formatDuration(now - runStartedAt))}</p>
        )}
        {jobs.length > 0 && (
          <div className="run-overlay-jobs">
            <span className="run-overlay-jobs-title">{t.runningJobs}</span>
            {jobs.map(([file, startedAt]) => (
              <div className="run-overlay-job" key={file} title={file}>
                <Loader2 className="spin" size={13} />
                <span className="run-overlay-job-name">{shortenPath(file)}</span>
                <span className="run-overlay-job-time">{formatDuration(now - startedAt)}</span>
              </div>
            ))}
          </div>
        )}
        <p className="run-overlay-hint">{t.processingHint}</p>
        <button className="secondary-button" disabled={isStopping} onClick={stopExport}>
          {isStopping ? <RotateCw className="spin" size={16} /> : <CircleStop size={16} />}
          {t.stop}
        </button>
      </div>
    </div>
  );
}
