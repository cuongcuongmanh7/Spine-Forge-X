import { useState } from 'react';
import { X } from 'lucide-react';
import { useApp } from '../useAppController';
import { formatDuration } from '../time';

/** Per-project export dashboard: last-run summary for each session, plus project totals. */
export function ProjectDashboardModal() {
  const { t, projects, sessions, activeProjectId, language, setDashboardOpen } = useApp();

  // Default to the active project, but let the user inspect any project.
  const [projectId, setProjectId] = useState(activeProjectId ?? projects[0]?.id ?? '');
  const close = () => setDashboardOpen(false);

  const projectSessions = sessions.filter((s) => s.projectId === projectId);
  const locale = language === 'vi' ? 'vi-VN' : 'en-US';
  const fmtTime = (at: number) => new Date(at).toLocaleString(locale);

  const totals = projectSessions.reduce(
    (acc, s) => {
      const r = s.config.lastExport;
      if (r) {
        acc.completed += r.completed;
        acc.failed += r.failed;
        acc.skipped += r.skipped;
        acc.total += r.total;
        acc.runs += 1;
        acc.durationMs += r.durationMs ?? 0;
      }
      return acc;
    },
    { completed: 0, failed: 0, skipped: 0, total: 0, runs: 0, durationMs: 0 }
  );

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal linked-modal dashboard-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t.dashboardTitle}</h2>
          <button className="modal-close" title={t.cancel} aria-label={t.cancel} onClick={close}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="form-row">
            <label>{t.dashboardProject}</label>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || t.untitledProject}
                </option>
              ))}
            </select>
          </div>

          {projectSessions.length === 0 ? (
            <p className="helper-text">{t.dashboardEmpty}</p>
          ) : (
            <>
              <table className="clean-source-table dashboard-table">
                <thead>
                  <tr>
                    <th>{t.dashboardColSession}</th>
                    <th>{t.dashboardColLastRun}</th>
                    <th>{t.dashboardColDone}</th>
                    <th>{t.dashboardColFailed}</th>
                    <th>{t.dashboardColSkipped}</th>
                    <th>{t.dashboardColTotal}</th>
                    <th>{t.dashboardColDuration}</th>
                  </tr>
                </thead>
                <tbody>
                  {projectSessions.map((s) => {
                    const r = s.config.lastExport;
                    return (
                      <tr key={s.id} className={r && r.failed > 0 ? 'has-error' : ''}>
                        <td title={s.name}>
                          <span className={`status-dot ${!r ? 'neutral' : r.failed > 0 ? 'red' : 'green'}`} />
                          {s.name || t.untitledSession}
                        </td>
                        <td className="muted">{r ? fmtTime(r.at) : t.dashboardNever}</td>
                        <td>{r ? r.completed : '—'}</td>
                        <td>{r ? r.failed : '—'}</td>
                        <td>{r ? r.skipped : '—'}</td>
                        <td>{r ? r.total : '—'}</td>
                        <td className="muted">{r?.durationMs != null ? formatDuration(r.durationMs) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td>
                      {t.dashboardTotals} ({totals.runs})
                    </td>
                    <td />
                    <td>{totals.completed}</td>
                    <td>{totals.failed}</td>
                    <td>{totals.skipped}</td>
                    <td>{totals.total}</td>
                    <td className="muted">{totals.durationMs > 0 ? formatDuration(totals.durationMs) : '—'}</td>
                  </tr>
                </tfoot>
              </table>
              <p className="helper-text">{t.dashboardHelp}</p>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="primary-button" onClick={close}>
            {t.done}
          </button>
        </div>
      </div>
    </div>
  );
}
