import { Archive } from 'lucide-react';
import type { Translations } from '../../i18n';
import type { BatchScanSummary } from '../../types';
import { formatBytes } from './helpers';

interface CleanSourceTableProps {
  t: Translations;
  summary: BatchScanSummary;
  busy: boolean;
  onRowClick: (rowIndex: number) => void;
  onMoveFolder: (rowIndex: number) => void;
}

/** Per-folder scan results table with a per-row "move unused" action. */
export function CleanSourceTable({ t, summary, busy, onRowClick, onMoveFolder }: CleanSourceTableProps) {
  return (
    <>
      <table className="clean-source-table">
        <thead>
          <tr>
            <th>{t.cleanSourceColFolder}</th>
            <th>{t.cleanSourceColUsed}</th>
            <th>{t.cleanSourceColUnused}</th>
            <th>{t.cleanSourceColIssues}</th>
            <th aria-label={t.cleanSourceMove} />
          </tr>
        </thead>
        <tbody>
          {summary.units.map((unit, rowIndex) => {
            const issues = unit.missing.length + unit.ambiguous.length;
            const name = unit.folder.replace(/\\/g, '/').split('/').pop() || unit.folder;
            const cls = [unit.error ? 'has-error' : unit.unused.length ? 'has-unused' : '', unit.error ? '' : 'clickable']
              .filter(Boolean)
              .join(' ');
            return (
              <tr
                key={unit.folder}
                className={cls}
                onClick={() => !unit.error && onRowClick(rowIndex)}
                title={unit.error ? unit.folder : t.cleanSourceViewDetail}
              >
                <td title={unit.folder}>
                  <span className={`status-dot ${unit.error ? 'neutral' : unit.unused.length ? 'red' : 'green'}`} />
                  {name}
                </td>
                <td>{unit.error ? '—' : unit.used}</td>
                <td>
                  {unit.error ? '—' : unit.unused.length}
                  {!unit.error && unit.unused.length > 0 && (
                    <span className="muted"> ({formatBytes(unit.unusedBytes)})</span>
                  )}
                </td>
                <td title={[...unit.missing, ...unit.ambiguous].join(', ')}>
                  {unit.error ? <span className="field-status error">{unit.error}</span> : issues || ''}
                </td>
                <td>
                  {!unit.error && unit.unused.length > 0 && (
                    <button
                      className="icon-button warning"
                      title={t.cleanSourceMove}
                      aria-label={t.cleanSourceMove}
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        onMoveFolder(rowIndex);
                      }}
                    >
                      <Archive size={16} />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="helper-text">
        {t.cleanSourceTotal
          .replace('{count}', String(summary.totalUnused))
          .replace('{size}', formatBytes(summary.totalUnusedBytes))}
      </p>
    </>
  );
}
