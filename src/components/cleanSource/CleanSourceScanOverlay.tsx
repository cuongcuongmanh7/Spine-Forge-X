import { RotateCw, CircleStop, Check, Circle } from 'lucide-react';
import type { Translations } from '../../i18n';
import type { CleanUnitInfo } from '../../types';
import { normFolder, relativeToRoot, shortenPath } from './helpers';

interface CleanSourceScanOverlayProps {
  t: Translations;
  scanPercent: number;
  scanCurrent: number;
  scanTotal: number;
  selectedUnits: CleanUnitInfo[];
  scannedFolders: Set<string>;
  root: string;
  progressFile: string;
  isStopping: boolean;
  onStop: () => void;
}

/**
 * Full-screen overlay shown while a scan runs: progress bar plus a live
 * per-folder done/pending checklist (falls back to the current file when the
 * unit list isn't available).
 */
export function CleanSourceScanOverlay({
  t,
  scanPercent,
  scanCurrent,
  scanTotal,
  selectedUnits,
  scannedFolders,
  root,
  progressFile,
  isStopping,
  onStop
}: CleanSourceScanOverlayProps) {
  return (
    <div className="run-overlay scan-overlay" role="alertdialog" aria-modal="true" aria-busy="true">
      <div className="run-overlay-card">
        <RotateCw className="spin run-overlay-spinner" size={26} />
        <h2 className="run-overlay-title">{t.cleanSourceScanning}</h2>
        <div className="run-overlay-progress">
          <progress value={scanPercent} max={100} />
          <span>
            {scanCurrent} / {scanTotal} · {scanPercent}%
          </span>
        </div>
        {selectedUnits.length > 0 ? (
          <ul className="scan-overlay-list">
            {selectedUnits.map((u) => {
              const done = scannedFolders.has(normFolder(u.folder));
              return (
                <li key={u.spineFile} className={done ? 'done' : 'pending'}>
                  {done ? (
                    <Check size={14} className="scan-overlay-check" />
                  ) : (
                    <Circle size={14} className="scan-overlay-pending" />
                  )}
                  <span className="scan-overlay-name" title={u.folder}>
                    {relativeToRoot(u.folder, root)}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          progressFile && (
            <p className="run-overlay-file" title={progressFile}>
              {shortenPath(progressFile)}
            </p>
          )
        )}
        <button className="secondary-button" disabled={isStopping} onClick={onStop}>
          {isStopping ? <RotateCw className="spin" size={16} /> : <CircleStop size={16} />}
          {isStopping ? t.stopRequested : t.stop}
        </button>
      </div>
    </div>
  );
}
