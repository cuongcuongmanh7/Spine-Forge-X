import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AlertTriangle, Copy, Eraser, FileWarning, GitCompare, RotateCw, Weight } from 'lucide-react';
import { useApp } from '../useAppController';
import { LibraryClean } from './LibraryClean';
import { SpineFileIcon } from './SpineFileIcon';
import { StatIcon } from './StatIcon';
import { formatBytes } from '../time';
import {
  cleanStatusForEntry,
  entryMatchesFilter,
  entryWarnings,
  hasAnyWarning,
  selectionSummary,
  versionMixGroups,
  type LibraryThresholds
} from '../library';
import { splitRelPath } from './LibraryViewShared';
import type { LibraryFilterApi } from '../useLibraryFilter';
import type { HealthReport, LibraryEntry } from '../config';
import './LibraryReports.css';

type CleanScopeRequest = { id: number; spineFiles: string[] } | null;
type ReportKey = 'unused' | 'missing' | 'duplicate' | 'version' | 'oversized';

/**
 * Reports tab: a sub-sidebar of analyses (left) + the active report (right). Every report reads its
 * scope from the shared Inventory filter (facet / chips / search) — there is no folder picker here.
 * "Unused assets" re-homes the cleanup flow; Version mismatch + Oversized are derived from the scan;
 * Missing attachments + Duplicate atlases are stubs until a later pass.
 */
export function LibraryReports({
  filter,
  scopeRequest,
  onHealthCheck
}: {
  filter: LibraryFilterApi;
  scopeRequest: CleanScopeRequest;
  onHealthCheck: (entry: LibraryEntry) => void;
}) {
  const { t, appConfig, libraryScan, libraryCleanState } = useApp();
  const [report, setReport] = useState<ReportKey>('unused');

  // A "prepare clean scan" request from the Inventory jumps straight to Unused assets.
  useEffect(() => {
    if (scopeRequest) setReport('unused');
  }, [scopeRequest]);

  const entries = libraryScan?.entries ?? [];
  const { facet, selectedCats, selectedVersions, query, invert } = filter;
  const thresholds: LibraryThresholds = {
    imageFolderWarnMB: appConfig.libraryImageFolderWarnMB,
    spineFileWarnMB: appConfig.librarySpineFileWarnMB
  };
  const statusOf = (e: LibraryEntry): string => cleanStatusForEntry(e, libraryCleanState[e.spineFile]);

  const included = useMemo(
    () => entries.filter((e) => entryMatchesFilter(e, { facet, selectedCats, selectedVersions, query, invert, statusOf })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, facet, selectedCats, selectedVersions, query, invert, libraryCleanState]
  );

  const mixGroups = useMemo(() => versionMixGroups(included), [included]);
  const divergingCount = useMemo(() => mixGroups.reduce((n, g) => n + g.entries.filter((e) => e.diverges).length, 0), [mixGroups]);
  const oversized = useMemo(() => included.filter((e) => hasAnyWarning(e, thresholds)), [included, thresholds]);

  const scopeText = selectionSummary({ facet, selectedCats, selectedVersions, query });
  const scope = scopeText
    ? `${scopeText} — ${included.length}/${entries.length}`
    : `${t.libraryReportScopeAll} — ${included.length}/${entries.length}`;

  const items: { key: ReportKey; label: string; icon: JSX.Element; count?: number; soon?: boolean }[] = [
    { key: 'unused', label: t.libraryReportUnused, icon: <Eraser size={15} /> },
    { key: 'missing', label: t.libraryReportMissing, icon: <FileWarning size={15} /> },
    { key: 'duplicate', label: t.libraryReportDuplicate, icon: <Copy size={15} /> },
    { key: 'version', label: t.libraryReportVersion, icon: <GitCompare size={15} />, count: divergingCount },
    { key: 'oversized', label: t.libraryReportOversized, icon: <Weight size={15} />, count: oversized.length }
  ];

  return (
    <div className="library-reports">
      <nav className="library-reports-nav" aria-label={t.libraryTabReports}>
        {items.map((it) => (
          <button
            key={it.key}
            className={`library-reports-nav-item ${report === it.key ? 'active' : ''}`}
            onClick={() => setReport(it.key)}
            aria-current={report === it.key}
          >
            {it.icon}
            <span className="library-reports-nav-label">{it.label}</span>
            {it.soon ? (
              <span className="library-reports-soon">{t.libraryReportComingSoon}</span>
            ) : (
              it.count != null && it.count > 0 && <em className="library-reports-count">{it.count}</em>
            )}
          </button>
        ))}
      </nav>

      <div className="library-reports-content">
        {report === 'unused' ? (
          <LibraryClean filter={filter} scopeRequest={scopeRequest} />
        ) : report === 'version' ? (
          <VersionReport groups={mixGroups} scope={scope} />
        ) : report === 'oversized' ? (
          <OversizedReport entries={oversized} thresholds={thresholds} scope={scope} />
        ) : report === 'missing' ? (
          <MissingAttachmentsReport entries={included} scope={scope} onHealthCheck={onHealthCheck} />
        ) : (
          <DuplicateAtlasesReport entries={included} scope={scope} onHealthCheck={onHealthCheck} />
        )}
      </div>
    </div>
  );
}

/** Shared shell: scope header (+ optional action) + a scrolling body, mirroring the pane look. */
function ReportPane({ scope, action, children }: { scope: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="library-pane">
      <div className="library-pane-head">
        <div className="library-report-head-row">
          <p className="helper-text library-clean-scope">{scope}</p>
          {action}
        </div>
      </div>
      <div className="library-pane-scroll">{children}</div>
    </div>
  );
}

/**
 * On-demand batch of the offline health check over the in-scope entries (concurrency-capped — it
 * reads each export folder from disk). Shared by the Missing-attachments and Duplicate-atlases
 * reports; results reset when the scope changes and the scan stops on unmount.
 */
function useHealthBatch(entries: LibraryEntry[]) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [reports, setReports] = useState<{ entry: LibraryEntry; report: HealthReport }[] | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    setReports(null);
  }, [entries]);
  useEffect(
    () => () => {
      cancelled.current = true;
    },
    []
  );

  async function run() {
    cancelled.current = false;
    setRunning(true);
    setProgress({ done: 0, total: entries.length });
    const out: { entry: LibraryEntry; report: HealthReport }[] = [];
    const queue = [...entries];
    let done = 0;
    const workers = Array.from({ length: Math.min(8, queue.length) }, async () => {
      while (queue.length) {
        if (cancelled.current) return;
        const e = queue.shift()!;
        try {
          const report = await invoke<HealthReport>('health_check_entry', {
            folder: e.folder,
            spineFile: e.spineFile,
            relPath: e.relPath,
            editorVersion: e.version
          });
          out.push({ entry: e, report });
        } catch {
          /* a single failed check shouldn't abort the batch */
        }
        done += 1;
        if (!cancelled.current) setProgress({ done, total: entries.length });
      }
    });
    await Promise.all(workers);
    if (cancelled.current) return;
    setReports(out);
    setRunning(false);
    setProgress(null);
  }

  return { running, progress, reports, run };
}

/** The "Run check" button rendered in a report's head; shows live progress while scanning. */
function RunCheckAction({
  running,
  progress,
  disabled,
  onRun
}: {
  running: boolean;
  progress: { done: number; total: number } | null;
  disabled: boolean;
  onRun: () => void;
}) {
  const { t } = useApp();
  return (
    <button className="secondary-button small" onClick={onRun} disabled={disabled}>
      <RotateCw size={14} className={running ? 'spin' : undefined} />{' '}
      {running && progress
        ? t.libraryReportChecking.replace('{done}', String(progress.done)).replace('{total}', String(progress.total))
        : t.libraryReportRunCheck}
    </button>
  );
}

/** Missing-pieces report: in-scope entries whose health check reports problems (no atlas/skeleton,
 *  missing texture pages, …). Clicking a row opens the full health-check modal. */
function MissingAttachmentsReport({
  entries,
  scope,
  onHealthCheck
}: {
  entries: LibraryEntry[];
  scope: string;
  onHealthCheck: (entry: LibraryEntry) => void;
}) {
  const { t } = useApp();
  const { running, progress, reports, run } = useHealthBatch(entries);
  const results = useMemo(
    () =>
      reports
        ?.filter((r) => !r.report.ok)
        .sort((a, b) => a.entry.relPath.localeCompare(b.entry.relPath)) ?? null,
    [reports]
  );

  const action = <RunCheckAction running={running} progress={progress} disabled={running || entries.length === 0} onRun={() => void run()} />;

  return (
    <ReportPane scope={scope} action={action}>
      {results === null ? (
        <p className="helper-text">{t.libraryReportMissingHint}</p>
      ) : results.length === 0 ? (
        <p className="helper-text">{t.libraryReportNone}</p>
      ) : (
        <table className="library-table library-report-table">
          <thead>
            <tr>
              <th>{t.libraryColEntry}</th>
              <th>{t.libraryReportProblems}</th>
            </tr>
          </thead>
          <tbody>
            {results.map(({ entry, report }) => (
              <tr key={entry.spineFile} className="library-report-clickable" onClick={() => onHealthCheck(entry)}>
                <td className="library-path" title={entry.spineFile}>
                  <AlertTriangle size={12} className="library-warn-cell" /> {splitRelPath(entry.relPath).name}
                </td>
                <td title={report.problems.join('\n')}>{report.problems.join('; ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ReportPane>
  );
}

/** Duplicate-atlases report: groups in-scope entries that share a byte-identical atlas (the atlas
 *  content is used directly as the group key, so there are no false positives — only renamed/edited
 *  copies are missed). Clicking a row opens the health-check modal. */
function DuplicateAtlasesReport({
  entries,
  scope,
  onHealthCheck
}: {
  entries: LibraryEntry[];
  scope: string;
  onHealthCheck: (entry: LibraryEntry) => void;
}) {
  const { t } = useApp();
  const { running, progress, reports, run } = useHealthBatch(entries);
  const groups = useMemo(() => {
    if (!reports) return null;
    const byAtlas = new Map<string, LibraryEntry[]>();
    for (const { entry, report } of reports) {
      const key = report.atlasContent?.trim();
      if (!key) continue;
      const list = byAtlas.get(key);
      if (list) list.push(entry);
      else byAtlas.set(key, [entry]);
    }
    return [...byAtlas.values()]
      .filter((g) => g.length > 1)
      .map((g) => [...g].sort((a, b) => a.relPath.localeCompare(b.relPath)))
      .sort((a, b) => b.length - a.length);
  }, [reports]);

  const action = <RunCheckAction running={running} progress={progress} disabled={running || entries.length === 0} onRun={() => void run()} />;

  return (
    <ReportPane scope={scope} action={action}>
      {groups === null ? (
        <p className="helper-text">{t.libraryReportDuplicateHint}</p>
      ) : groups.length === 0 ? (
        <p className="helper-text">{t.libraryReportNone}</p>
      ) : (
        groups.map((group) => (
          <section className="library-report-group" key={group[0].spineFile}>
            <div className="library-report-group-head">
              <span>{t.libraryReportDuplicateGroup.replace('{count}', String(group.length))}</span>
            </div>
            <table className="library-table library-report-table">
              <tbody>
                {group.map((entry) => (
                  <tr key={entry.spineFile} className="library-report-clickable" onClick={() => onHealthCheck(entry)}>
                    <td className="library-path" title={entry.spineFile}>
                      <Copy size={12} /> {splitRelPath(entry.relPath).name}
                    </td>
                    <td className="muted" title={entry.relPath}>
                      {splitRelPath(entry.relPath).dir}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}
    </ReportPane>
  );
}

/** Entries that diverge from their folder's majority editor version, grouped by folder. */
function VersionReport({ groups, scope }: { groups: ReturnType<typeof versionMixGroups>; scope: string }) {
  const { t } = useApp();
  const hasAny = groups.some((g) => g.entries.some((e) => e.diverges));
  return (
    <ReportPane scope={scope}>
      {!hasAny ? (
        <p className="helper-text">{t.libraryReportNone}</p>
      ) : (
        groups
          .filter((g) => g.entries.some((e) => e.diverges))
          .map((g) => (
            <section className="library-report-group" key={g.key}>
              <div className="library-report-group-head">
                <span>{g.key}</span>
                <span className="muted">
                  {t.libraryReportFolderVersion}: {g.majority || '—'}
                </span>
              </div>
              <table className="library-table library-report-table">
                <tbody>
                  {g.entries
                    .filter((e) => e.diverges)
                    .map(({ entry }) => (
                      <tr key={entry.spineFile}>
                        <td className="library-path" title={entry.spineFile}>
                          <SpineFileIcon size={13} /> {splitRelPath(entry.relPath).name}
                        </td>
                        <td className="num library-warn-cell">
                          <AlertTriangle size={12} /> {entry.version ?? t.libraryUnknownVersion}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </section>
          ))
      )}
    </ReportPane>
  );
}

/** Entries over the configured .spine / image-folder size thresholds. */
function OversizedReport({ entries, thresholds, scope }: { entries: LibraryEntry[]; thresholds: LibraryThresholds; scope: string }) {
  const { t } = useApp();
  return (
    <ReportPane scope={scope}>
      {entries.length === 0 ? (
        <p className="helper-text">{t.libraryReportNone}</p>
      ) : (
        <table className="library-table library-report-table">
          <thead>
            <tr>
              <th>{t.libraryColEntry}</th>
              <th className="num">
                <SpineFileIcon size={13} /> {t.libraryColSpine}
              </th>
              <th className="num">
                <StatIcon kind="image" size={13} /> {t.libraryColImages}
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const w = entryWarnings(e, thresholds);
              return (
                <tr key={e.spineFile}>
                  <td className="library-path" title={e.spineFile}>
                    {splitRelPath(e.relPath).name}
                  </td>
                  <td className={`num ${w.heavySpine ? 'library-warn-cell' : ''}`} title={w.heavySpine ? t.libraryWarnHeavySpine : undefined}>
                    {w.heavySpine && <AlertTriangle size={12} />} {formatBytes(e.spineBytes)}
                  </td>
                  <td className={`num ${w.heavyImages ? 'library-warn-cell' : ''}`} title={w.heavyImages ? t.libraryWarnHeavyImages : undefined}>
                    {w.heavyImages && <AlertTriangle size={12} />} {formatBytes(e.imageBytes)} <span className="muted">· {e.imageCount}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </ReportPane>
  );
}

