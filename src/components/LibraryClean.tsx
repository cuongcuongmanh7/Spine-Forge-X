import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChevronDown, ChevronRight, Eraser, RotateCw } from 'lucide-react';
import { useApp } from '../useAppController';
import { formatBytes } from '../time';
import { entryMatchesFilter, selectionSummary } from '../library';
import type { LibraryFilterApi } from '../useLibraryFilter';
import type { BatchScanSummary, FolderScan, ImageEntry } from '../types';

/** Load `paths` to data URLs with a small concurrency cap; reports each result as it lands. */
async function loadThumbs(
  paths: string[],
  read: (path: string) => Promise<string | null>,
  onLoaded: (path: string, url: string | null) => void,
  shouldStop: () => boolean
) {
  const queue = [...paths];
  const workers = Array.from({ length: Math.min(8, queue.length) }, async () => {
    while (queue.length) {
      if (shouldStop()) return;
      const path = queue.shift()!;
      const url = await read(path);
      if (shouldStop()) return;
      onLoaded(path, url);
    }
  });
  await Promise.all(workers);
}

function Thumb({ entry, url }: { entry: ImageEntry; url: string | null | undefined }) {
  const name = entry.relativePath.split('/').pop() || entry.relativePath;
  return (
    <div className="thumb-card" title={`${entry.relativePath} (${formatBytes(entry.sizeBytes)})`}>
      <div className="thumb-img">
        {url ? (
          <img src={url} alt={name} loading="lazy" />
        ) : url === null ? (
          <span className="empty-thumb" />
        ) : (
          <span className="thumb-loading" aria-label="Loading" />
        )}
      </div>
      <span className="thumb-name">{name}</span>
    </div>
  );
}

/**
 * Clean tab. Default scan is OFFLINE: it reads the used-image list from each unit's already
 * exported `.atlas` (in an export/ex folder) — no Spine CLI, no editor launch. A secondary
 * button re-scans via Spine CLI for a fresh atlas. Per-unit checkboxes pick what to move.
 * Scope follows the shared chip/search filter.
 */
export function LibraryClean({ filter }: { filter: LibraryFilterApi }) {
  const {
    t,
    activeLibrary,
    libraryScan,
    merged,
    scanSourceFolders,
    cleanScanSummary,
    setCleanScanSummary,
    readImageDataUrl,
    pushToast
  } = useApp();

  const [working, setWorking] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  // Which unit's unused-image thumbnails are expanded, keyed by .spine path.
  const [expanded, setExpanded] = useState<string | null>(null);
  // Thumbnail cache keyed by absolute path — kept across expand/collapse.
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const cancelledRef = useRef(false);
  const root = activeLibrary?.rootPath ?? '';

  const { facet, selectedCats, selectedVersions, query } = filter;
  const entries = libraryScan?.entries ?? [];
  const included = useMemo(
    () => entries.filter((e) => entryMatchesFilter(e, { facet, selectedCats, selectedVersions, query })),
    [entries, facet, selectedCats, selectedVersions, query]
  );
  const summaryText = selectionSummary({ facet, selectedCats, selectedVersions, query });
  const scopeAll = included.length === entries.length;

  // Units with unused images (or an error worth surfacing), keyed by .spine path.
  const units = cleanScanSummary?.units.filter((u) => u.unused.length > 0 || u.error) ?? [];
  const cleanable = units.filter((u) => !u.error && u.unused.length > 0);

  function applySummary(result: BatchScanSummary | null) {
    if (!result) return;
    setCleanScanSummary(result);
    // Pre-check every unit that has unused images.
    setChecked(new Set(result.units.filter((u) => u.unused.length > 0 && !u.error).map((u) => u.spineFile)));
  }

  async function scanOffline() {
    setWorking(true);
    try {
      const result = await invoke<BatchScanSummary>('scan_library_unused', {
        root,
        selected: included.map((e) => e.spineFile)
      });
      applySummary(result);
    } catch (error) {
      pushToast(`${t.cleanSourceFailed}: ${String(error)}`, 'error');
    } finally {
      setWorking(false);
    }
  }

  async function scanCli() {
    setWorking(true);
    try {
      const excluded = entries.filter((e) => !included.includes(e)).map((e) => e.spineFile);
      const result = await scanSourceFolders(root, excluded);
      applySummary(result);
    } finally {
      setWorking(false);
    }
  }

  function toggle(spineFile: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(spineFile)) next.delete(spineFile);
      else next.add(spineFile);
      return next;
    });
  }
  const allChecked = cleanable.length > 0 && cleanable.every((u) => checked.has(u.spineFile));
  function toggleAll() {
    setChecked(allChecked ? new Set() : new Set(cleanable.map((u) => u.spineFile)));
  }

  const selectedUnits = cleanable.filter((u) => checked.has(u.spineFile));
  async function cleanSelected() {
    if (selectedUnits.length === 0) return;
    setWorking(true);
    let moved = 0;
    try {
      for (const u of selectedUnits) {
        try {
          await invoke<string>('move_unused_images', { imagesDir: u.imagesDir, files: u.unused.map((i) => i.absolutePath) });
          moved += u.unused.length;
        } catch (error) {
          pushToast(`${t.cleanSourceFailed}: ${String(error)}`, 'error');
        }
      }
      pushToast(t.cleanSourceDone.replace('{count}', String(moved)), 'success');
      await scanOffline();
    } finally {
      setWorking(false);
    }
  }

  const noSpine = !merged.spinePath.trim();

  function toggleExpand(unit: FolderScan) {
    setExpanded((cur) => (cur === unit.spineFile ? null : unit.spineFile));
  }

  // Lazily load the expanded unit's unused-image thumbnails (cached across re-expands).
  useEffect(() => {
    cancelledRef.current = false;
    const unit = units.find((u) => u.spineFile === expanded);
    const paths = [...(unit?.unused ?? []), ...(unit?.usedImages ?? [])]
      .map((e) => e.absolutePath)
      .filter((p) => !(p in thumbs));
    if (paths.length) {
      void loadThumbs(
        paths,
        readImageDataUrl,
        (path, url) => setThumbs((current) => ({ ...current, [path]: url })),
        () => cancelledRef.current
      );
    }
    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  return (
    <div className="library-pane">
      <div className="library-pane-head">
        <div className="library-meta">
          <span className="muted" title={root}>
            {root}
          </span>
          <span className="library-tabbar-actions">
            <button className="primary-button" onClick={() => void scanOffline()} disabled={working || included.length === 0}>
              <RotateCw size={15} className={working ? 'spin' : undefined} /> {t.cleanSourceScan}
            </button>
            <button className="secondary-button" onClick={() => void scanCli()} disabled={working || noSpine || included.length === 0} title={t.libraryCleanCliHint}>
              {t.libraryCleanCli}
            </button>
          </span>
        </div>
        <p className="helper-text">
          {t.libraryCleanScope.replace('{n}', String(included.length)).replace('{total}', String(entries.length))}
          {scopeAll ? ` (${t.libraryScopeAll})` : summaryText ? ` — ${summaryText}` : ''}
          {' · '}
          {t.libraryCleanOfflineNote}
        </p>
        {cleanScanSummary && (
          <div className="library-stats">
            <div className={`library-stat ${cleanScanSummary.totalUnused > 0 ? 'warn' : ''}`}>
              <span className="library-stat-value">{cleanScanSummary.totalUnused}</span>
              <span className="library-stat-label">{t.cleanSourceColUnused}</span>
            </div>
            <div className="library-stat">
              <span className="library-stat-value">{formatBytes(cleanScanSummary.totalUnusedBytes)}</span>
              <span className="library-stat-label">{t.libraryTotalImages}</span>
            </div>
          </div>
        )}
      </div>

      <div className="library-pane-scroll">
        {!cleanScanSummary ? (
          <p className="helper-text">{t.libraryCleanHint}</p>
        ) : units.length === 0 ? (
          <p className="helper-text">{t.cleanSourceNoUnused}</p>
        ) : (
          <table className="library-table">
            <colgroup>
              <col className="lib-col-check" />
              <col className="lib-col-entry" />
              <col className="lib-col-images" />
            </colgroup>
            <thead>
              <tr>
                <th>
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label={t.cleanSourceSelectAll} disabled={cleanable.length === 0} />
                </th>
                <th>{t.cleanSourceColFolder}</th>
                <th className="num">{t.cleanSourceColUnused}</th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) => {
                const canExpand = !u.error && u.unused.length > 0;
                const isOpen = expanded === u.spineFile;
                return (
                  <Fragment key={u.spineFile}>
                    <tr className={u.error ? 'library-warn-cell' : ''}>
                      <td>
                        {canExpand && (
                          <input type="checkbox" checked={checked.has(u.spineFile)} onChange={() => toggle(u.spineFile)} />
                        )}
                      </td>
                      <td
                        className={`library-path ${canExpand ? 'expandable' : ''}`}
                        title={u.error ?? u.folder}
                        onClick={canExpand ? () => toggleExpand(u) : undefined}
                      >
                        {canExpand &&
                          (isOpen ? <ChevronDown size={13} className="expand-caret" /> : <ChevronRight size={13} className="expand-caret" />)}
                        {u.folder}
                      </td>
                      <td className="num">{u.error ? '—' : `${u.unused.length} · ${formatBytes(u.unusedBytes)}`}</td>
                    </tr>
                    {isOpen && canExpand && (
                      <tr className="library-thumb-row">
                        <td colSpan={3}>
                          <section className="thumb-section">
                            <h3 className="thumb-section-title unused">
                              {t.cleanSourceColUnused} ({u.unused.length})
                            </h3>
                            <div className="thumb-grid">
                              {u.unused.map((entry) => (
                                <Thumb key={entry.absolutePath} entry={entry} url={thumbs[entry.absolutePath]} />
                              ))}
                            </div>
                          </section>
                          <section className="thumb-section">
                            <h3 className="thumb-section-title used">
                              {t.cleanSourceColUsed} ({u.usedImages.length})
                            </h3>
                            {u.usedImages.length === 0 ? (
                              <p className="helper-text">—</p>
                            ) : (
                              <div className="thumb-grid">
                                {u.usedImages.map((entry) => (
                                  <Thumb key={entry.absolutePath} entry={entry} url={thumbs[entry.absolutePath]} />
                                ))}
                              </div>
                            )}
                          </section>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {units.length > 0 && (
        <div className="library-pane-foot">
          <span className="helper-text">{t.cleanSourceMoveHint}</span>
          <button className="primary-button" onClick={() => void cleanSelected()} disabled={working || selectedUnits.length === 0}>
            <Eraser size={15} /> {t.libraryCleanSelected.replace('{n}', String(selectedUnits.length))}
          </button>
        </div>
      )}
    </div>
  );
}
