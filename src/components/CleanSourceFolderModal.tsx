import { useEffect, useState } from 'react';
import { FolderOpen, Trash2, X, Search } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { confirm } from '@tauri-apps/plugin-dialog';
import { useApp } from '../useAppController';
import { CleanFolderDetailModal } from './CleanFolderDetailModal';

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function CleanSourceFolderModal() {
  const {
    t,
    merged,
    isCleaningSourceFolder,
    scanSourceFolders,
    cleanSourceFolders,
    moveFolderUnused,
    setCleanSourceFolderOpen,
    cleanScanRoot,
    setCleanScanRoot,
    cleanScanSummary,
    setCleanScanSummary
  } = useApp();

  // Root + scan result are cached in the controller, so they survive closing/reopening
  // the modal — the user re-scans manually with the Scan button when they want fresh data.
  const root = cleanScanRoot;
  const setRoot = setCleanScanRoot;
  const summary = cleanScanSummary;
  const setSummary = setCleanScanSummary;
  const [scanning, setScanning] = useState(false);
  const [detailIndex, setDetailIndex] = useState<number | null>(null);

  // First open with no cached root yet → default to the session input path.
  useEffect(() => {
    if (!cleanScanRoot && merged.inputPath) setCleanScanRoot(merged.inputPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function close() {
    setCleanSourceFolderOpen(false);
  }

  async function browse() {
    const picked = await open({ directory: true, multiple: false, defaultPath: root.trim() || undefined });
    if (typeof picked === 'string') setRoot(picked);
  }

  async function scan() {
    if (scanning || !root.trim()) return;
    setScanning(true);
    setSummary(null);
    try {
      const result = await scanSourceFolders(root);
      setSummary(result);
    } finally {
      setScanning(false);
    }
  }

  async function move() {
    if (!summary || summary.totalUnused === 0 || isCleaningSourceFolder) return;
    const ok = await confirm(t.cleanSourceConfirm.replace('{count}', String(summary.totalUnused)), {
      title: t.cleanSourceTitle,
      kind: 'warning'
    });
    if (!ok) return;
    const result = await cleanSourceFolders(root);
    if (result) {
      // Re-scan so the table reflects the cleaned state (now 0 unused).
      await scan();
    }
  }

  /** Mark a folder as cleaned in local state so its dot/counts update without a re-scan. */
  function markFolderCleaned(rowIndex: number) {
    setSummary((prev) => {
      if (!prev) return prev;
      const units = prev.units.map((u, i) => (i === rowIndex ? { ...u, unused: [], unusedBytes: 0 } : u));
      return {
        ...prev,
        units,
        totalUnused: units.reduce((sum, u) => sum + u.unused.length, 0),
        totalUnusedBytes: units.reduce((sum, u) => sum + u.unusedBytes, 0)
      };
    });
  }

  /** Move just one folder's unused images (uses the already-scanned paths). */
  async function moveFolder(rowIndex: number) {
    if (!summary || isCleaningSourceFolder) return;
    const unit = summary.units[rowIndex];
    if (!unit || unit.error || unit.unused.length === 0) return;
    const ok = await confirm(t.cleanSourceConfirm.replace('{count}', String(unit.unused.length)), {
      title: t.cleanSourceTitle,
      kind: 'warning'
    });
    if (!ok) return;
    const backup = await moveFolderUnused(unit.imagesDir, unit.unused.map((u) => u.absolutePath));
    if (backup) markFolderCleaned(rowIndex);
  }

  const busy = scanning || isCleaningSourceFolder;

  return (
    <>
    <div className="modal-backdrop" onClick={close}>
      <div className="modal linked-modal clean-source-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t.cleanSourceTitle}</h2>
          <button className="modal-close" title={t.cancel} aria-label={t.cancel} onClick={close}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <p className="helper-text">{t.cleanSourceHelp}</p>

          <div className="form-row">
            <label>{t.cleanSourceColFolder}</label>
            <input
              value={root}
              title={root}
              onChange={(e) => setRoot(e.target.value)}
              placeholder="…/Heroes/Chibi_3xxx"
            />
            <button className="icon-button" title={t.browse} aria-label={t.browse} onClick={browse}>
              <FolderOpen size={18} />
            </button>
            <button className="secondary-button" disabled={busy || !root.trim()} onClick={scan}>
              <Search size={16} /> {scanning ? t.cleanSourceScanning : t.cleanSourceScan}
            </button>
          </div>

          {summary && (
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
                        onClick={() => !unit.error && setDetailIndex(rowIndex)}
                        title={unit.error ? unit.folder : t.cleanSourceViewDetail}
                      >
                        <td title={unit.folder}>
                          <span
                            className={`status-dot ${unit.error ? 'neutral' : unit.unused.length ? 'red' : 'green'}`}
                          />
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
                              className="icon-button danger"
                              title={t.cleanSourceMove}
                              aria-label={t.cleanSourceMove}
                              disabled={busy}
                              onClick={(e) => {
                                e.stopPropagation();
                                void moveFolder(rowIndex);
                              }}
                            >
                              <Trash2 size={16} />
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
          )}
        </div>

        <div className="modal-footer">
          <button
            className="danger-button"
            disabled={busy || !summary || summary.totalUnused === 0}
            onClick={move}
          >
            <Trash2 size={16} /> {t.cleanSourceMove}
          </button>
          <button className="primary-button" onClick={close}>
            {t.done}
          </button>
        </div>
      </div>
    </div>
    {detailIndex !== null && summary && summary.units[detailIndex] && (
      <CleanFolderDetailModal
        units={summary.units}
        index={detailIndex}
        onIndexChange={setDetailIndex}
        onMoved={markFolderCleaned}
        onClose={() => setDetailIndex(null)}
      />
    )}
    </>
  );
}
