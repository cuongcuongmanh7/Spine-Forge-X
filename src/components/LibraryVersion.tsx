import { useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AlertTriangle, Boxes, FolderOpen, Layers, Tag } from 'lucide-react';
import { useApp } from '../useAppController';
import { SpineFileIcon } from './SpineFileIcon';
import { StatCard } from './StatCard';
import { formatBytes } from '../time';
import type { LibraryEntry } from '../config';
import { versionLabel, versionMixGroups, versionSummary } from '../library';
import './LibraryVersion.css';

function compactRelPath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 3) return path;
  return `.../${parts.slice(-3).join('/')}`;
}

/** Version tab: library-wide version distribution + folder groups that mix editor versions. */
export function LibraryVersion() {
  const { t, libraryScan, merged, pushToast } = useApp();
  const [onlyDiverging, setOnlyDiverging] = useState(false);

  const entries = libraryScan?.entries ?? [];
  const buckets = useMemo(() => versionSummary(entries), [entries]);
  const groups = useMemo(() => versionMixGroups(entries), [entries]);
  const mixedCount = groups.length;

  async function openInSpine(entry: LibraryEntry) {
    try {
      await invoke('open_in_spine', { spinePath: merged.spinePath, file: entry.spineFile });
    } catch (error) {
      pushToast(`${t.libraryOpenFailed}: ${String(error)}`, 'error');
    }
  }

  async function openFolder(entry: LibraryEntry) {
    try {
      await invoke('open_path', { path: entry.folder });
    } catch (error) {
      pushToast(`${t.libraryOpenFolderFailed}: ${String(error)}`, 'error');
    }
  }

  return (
    <div className="library-pane">
      <div className="library-pane-head">
        <div className="stat-cards">
          <StatCard icon={<Boxes size={18} />} label={t.libraryTotalEntries} value={entries.length} />
          {buckets.map((b) => (
            <StatCard key={b.major} icon={<Tag size={18} />} label={versionLabel(b.major)} value={b.count} />
          ))}
          <StatCard
            icon={<AlertTriangle size={18} />}
            label={t.libraryVersionMixedGroups}
            value={mixedCount}
            tone={mixedCount > 0 ? 'warn' : 'ok'}
          />
        </div>

        <div className="library-chip-row">
          <span className="helper-text">{t.libraryVersionMixHelp}</span>
          <label className="checkbox-line library-version-filter">
            <input type="checkbox" checked={onlyDiverging} onChange={(e) => setOnlyDiverging(e.target.checked)} />
            {t.libraryVersionOnlyDiverging}
          </label>
        </div>
      </div>

      <div className="library-pane-scroll">
        {mixedCount === 0 ? (
          <p className="helper-text">{entries.length === 0 ? t.libraryNoSpine : t.libraryVersionNoMix}</p>
        ) : (
          <div className="library-version-groups">
            {groups.map((g) => {
              const rows = onlyDiverging ? g.entries.filter((r) => r.diverges) : g.entries;
              return (
                <div className="library-version-group" key={g.key}>
                  <div className="library-version-group-head">
                    <Layers size={15} />
                    <strong>{g.key}</strong>
                    <span className="library-warn-badge" title={t.libraryWarnMixed}>
                      <AlertTriangle size={13} /> {t.libraryWarnMixed}
                    </span>
                    {g.majority && (
                      <span className="muted library-version-majority">
                        {t.libraryVersionMajority}: {g.majority}.x
                      </span>
                    )}
                  </div>
                  <table className="library-version-table">
                    <tbody>
                      {rows.map(({ entry, diverges }) => (
                        <tr key={entry.spineFile} className={diverges ? 'diverges' : ''}>
                          <td className="library-path" title={entry.spineFile}>
                            {compactRelPath(entry.relPath)}
                          </td>
                          <td className="library-version-cell">
                            {diverges && <AlertTriangle size={12} />}
                            {entry.version ?? <span className="muted">{t.libraryUnknownVersion}</span>}
                          </td>
                          <td className="num">{formatBytes(entry.spineBytes)}</td>
                          <td className="library-actions">
                            <button
                              className="icon-button"
                              onClick={() => void openFolder(entry)}
                              title={t.libraryOpenFolder}
                              aria-label={t.libraryOpenFolder}
                            >
                              <FolderOpen size={15} />
                            </button>
                            <button
                              className="icon-button"
                              onClick={() => void openInSpine(entry)}
                              title={t.libraryOpenInSpine}
                              aria-label={t.libraryOpenInSpine}
                            >
                              <SpineFileIcon size={15} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
