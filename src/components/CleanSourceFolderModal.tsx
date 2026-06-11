import { useEffect, useMemo, useState } from 'react';
import { FolderOpen, Trash2, X, Search, RotateCw, CircleStop } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { confirm } from '@tauri-apps/plugin-dialog';
import { useApp } from '../useAppController';
import type { CleanUnitInfo } from '../types';
import { CleanFolderDetailModal } from './CleanFolderDetailModal';

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Reduce a full path to its last two segments, e.g. "3001_Lucius/hero.spine". */
function shortenPath(path: string): string {
  const segments = path.split(/[\\/]+/).filter(Boolean);
  return segments.slice(-2).join('/');
}

/**
 * Folder path relative to the scanned root, so sibling sub-trees with the same
 * leaf name stay distinct (e.g. "Chibi/9901" vs "Splash/9901"). Falls back to
 * the leaf when the folder isn't under the root.
 */
function relativeToRoot(folder: string, root: string): string {
  const f = folder.replace(/\\/g, '/').replace(/\/+$/, '');
  const r = root.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (r && f.toLowerCase().startsWith(r.toLowerCase() + '/')) {
    return f.slice(r.length + 1);
  }
  return f.split('/').filter(Boolean).pop() || folder;
}

export function CleanSourceFolderModal() {
  const {
    t,
    merged,
    isCleaningSourceFolder,
    scanSourceFolders,
    countCleanUnits,
    stopExport,
    isStopping,
    liveProgress,
    cleanSourceFolders,
    moveFolderUnused,
    listCleanUnits,
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
  // Cheap pre-scan list of .spine units (no export), so the user can see the
  // scope and pick which sub-folders to scan. null = not listed yet.
  const [units, setUnits] = useState<CleanUnitInfo[] | null>(null);
  // `.spine` paths the user unchecked — passed as `excluded` to scan/clean so
  // only the ticked folders are processed. Reset whenever the root changes, then
  // pre-unchecked for any unit already in this session's export-set exclusions.
  const [deselected, setDeselected] = useState<Set<string>>(new Set());

  const unitCount = units?.length ?? null;
  const selectedUnits = useMemo(
    () => (units ?? []).filter((u) => !deselected.has(u.spineFile)),
    [units, deselected]
  );
  const excludedSpine = useMemo(
    () => (units ?? []).filter((u) => deselected.has(u.spineFile)).map((u) => u.spineFile),
    [units, deselected]
  );

  // Above this many skeletons, confirm before scanning — a large folder can take
  // minutes and spawn Spine once per file.
  const LARGE_SCAN_THRESHOLD = 50;

  // First open with no cached root yet → default to the session input path.
  useEffect(() => {
    if (!cleanScanRoot && merged.inputPath) setCleanScanRoot(merged.inputPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-list units whenever the target folder changes (debounced — the user may
  // be typing a path). Changing the root resets the selection, then defaults any
  // unit already excluded from this session's export set to unchecked, so the
  // picker matches what an export of this session would actually process.
  useEffect(() => {
    const target = root.trim();
    setDeselected(new Set());
    if (!target) {
      setUnits(null);
      return;
    }
    let cancelled = false;
    const id = setTimeout(async () => {
      const found = await listCleanUnits(target);
      if (cancelled) return;
      setUnits(found);
      const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();
      const excluded = new Set((merged.excludedFiles ?? []).map(norm));
      setDeselected(
        new Set(found.filter((u) => excluded.has(norm(u.spineFile))).map((u) => u.spineFile))
      );
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  function toggleUnit(spineFile: string) {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(spineFile)) next.delete(spineFile);
      else next.add(spineFile);
      return next;
    });
  }

  function selectAll() {
    setDeselected(new Set());
  }

  function selectNone() {
    setDeselected(new Set((units ?? []).map((u) => u.spineFile)));
  }

  function close() {
    // Don't let the user dismiss the modal mid-scan — the scan runs in the
    // backend and closing would orphan it. They must Stop or wait.
    if (scanning) return;
    setCleanSourceFolderOpen(false);
  }

  async function browse() {
    const picked = await open({ directory: true, multiple: false, defaultPath: root.trim() || undefined });
    if (typeof picked === 'string') setRoot(picked);
  }

  async function scan() {
    if (scanning || !root.trim()) return;
    // Only the ticked folders are scanned (unchecked → excluded).
    const count = units ? selectedUnits.length : await countCleanUnits(root);
    if (units && count === 0) return; // nothing selected; button is disabled anyway
    // Confirm before launching a scan that would export a large number of skeletons.
    if (count > LARGE_SCAN_THRESHOLD) {
      const ok = await confirm(t.cleanSourceLargeWarn.replace('{count}', String(count)), {
        title: t.cleanSourceTitle,
        kind: 'warning'
      });
      if (!ok) return;
    }
    setScanning(true);
    setSummary(null);
    try {
      const result = await scanSourceFolders(root, excludedSpine);
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
    const result = await cleanSourceFolders(root, excludedSpine);
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

  // Progress for the scan overlay. Falls back to the pre-scan count until the
  // first progress event arrives so the bar isn't stuck at 0/0.
  const scanTotal = liveProgress.total || selectedUnits.length || unitCount || 0;
  const scanCurrent = liveProgress.current;
  const scanPercent = scanTotal > 0 ? Math.min(100, Math.round((scanCurrent / scanTotal) * 100)) : 0;

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
            <button
              className="secondary-button"
              disabled={busy || !root.trim() || (units !== null && selectedUnits.length === 0)}
              onClick={scan}
            >
              <Search size={16} /> {scanning ? t.cleanSourceScanning : t.cleanSourceScan}
            </button>
          </div>

          {!scanning && root.trim() && unitCount !== null && (
            unitCount === 0 ? (
              <p className="helper-text">{t.cleanSourceCountNone}</p>
            ) : unitCount === 1 ? (
              <p className="helper-text">{t.cleanSourceCount.replace('{count}', '1')}</p>
            ) : (
              <div className="clean-source-picker">
                <div className="clean-source-picker-head">
                  <span
                    className={`helper-text ${
                      selectedUnits.length > LARGE_SCAN_THRESHOLD ? 'field-status warning' : ''
                    }`}
                  >
                    {t.cleanSourceSelected
                      .replace('{count}', String(selectedUnits.length))
                      .replace('{total}', String(unitCount))}
                  </span>
                  <span className="clean-source-picker-actions">
                    <button type="button" className="link-button" onClick={selectAll}>
                      {t.cleanSourceSelectAll}
                    </button>
                    <button type="button" className="link-button" onClick={selectNone}>
                      {t.cleanSourceSelectNone}
                    </button>
                  </span>
                </div>
                <ul className="clean-source-picker-list">
                  {(units ?? []).map((u) => {
                    const rel = relativeToRoot(u.folder, root);
                    const slash = rel.lastIndexOf('/');
                    const prefix = slash >= 0 ? rel.slice(0, slash) : '';
                    const leaf = slash >= 0 ? rel.slice(slash + 1) : rel;
                    return (
                      <li key={u.spineFile}>
                        <label title={u.folder}>
                          <input
                            type="checkbox"
                            checked={!deselected.has(u.spineFile)}
                            onChange={() => toggleUnit(u.spineFile)}
                          />
                          <span className="clean-source-picker-name">
                            {prefix && <span className="cs-prefix">{prefix}</span>}
                            <span className="cs-leaf">
                              {prefix ? '/' : ''}
                              {leaf}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )
          )}

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
    {scanning && (
      <div className="run-overlay scan-overlay" role="alertdialog" aria-modal="true" aria-busy="true">
        <div className="run-overlay-card">
          <RotateCw className="spin run-overlay-spinner" size={26} />
          <h2 className="run-overlay-title">{t.cleanSourceScanning}</h2>
          <div className="run-overlay-progress">
            <progress value={scanPercent} max={100} />
            <span>{scanCurrent} / {scanTotal}</span>
          </div>
          {liveProgress.file && (
            <p className="run-overlay-file" title={liveProgress.file}>{shortenPath(liveProgress.file)}</p>
          )}
          <button className="secondary-button" disabled={isStopping} onClick={() => void stopExport()}>
            {isStopping ? <RotateCw className="spin" size={16} /> : <CircleStop size={16} />}
            {isStopping ? t.stopRequested : t.stop}
          </button>
        </div>
      </div>
    )}
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
