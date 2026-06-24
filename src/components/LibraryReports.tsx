import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Copy, Eraser, FileWarning, GitCompare, Weight } from 'lucide-react';
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
import type { LibraryEntry } from '../config';
import './LibraryReports.css';

type CleanScopeRequest = { id: number; spineFiles: string[] } | null;
type ReportKey = 'unused' | 'missing' | 'duplicate' | 'version' | 'oversized';

/**
 * Reports tab: a sub-sidebar of analyses (left) + the active report (right). Every report reads its
 * scope from the shared Inventory filter (facet / chips / search) — there is no folder picker here.
 * "Unused assets" re-homes the cleanup flow; Version mismatch + Oversized are derived from the scan;
 * Missing attachments + Duplicate atlases are stubs until a later pass.
 */
export function LibraryReports({ filter, scopeRequest }: { filter: LibraryFilterApi; scopeRequest: CleanScopeRequest }) {
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
    { key: 'missing', label: t.libraryReportMissing, icon: <FileWarning size={15} />, soon: true },
    { key: 'duplicate', label: t.libraryReportDuplicate, icon: <Copy size={15} />, soon: true },
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
        ) : (
          <ReportStub label={report === 'missing' ? t.libraryReportMissing : t.libraryReportDuplicate} />
        )}
      </div>
    </div>
  );
}

/** Shared shell: scope header + a scrolling body, mirroring the Inventory/Clean pane look. */
function ReportPane({ scope, children }: { scope: string; children: React.ReactNode }) {
  return (
    <div className="library-pane">
      <div className="library-pane-head">
        <p className="helper-text library-clean-scope">{scope}</p>
      </div>
      <div className="library-pane-scroll">{children}</div>
    </div>
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

/** Placeholder for analyses not built yet (Missing attachments / Duplicate atlases). */
function ReportStub({ label }: { label: string }) {
  const { t } = useApp();
  return (
    <div className="library-pane">
      <div className="library-empty">
        <p className="helper-text">
          {label} — {t.libraryReportComingSoon}
        </p>
      </div>
    </div>
  );
}
