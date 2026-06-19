import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChevronDown, ChevronRight, Eraser, HardDrive, RotateCw, Trash2 } from 'lucide-react';
import { useApp } from '../useAppController';
import { StatCard } from './StatCard';
import { formatBytes } from '../time';
import { entryMatchesFilter, groupByFolder, groupByIdBand, selectionSummary } from '../library';
import type { LibraryFilterApi } from '../useLibraryFilter';
import type { BatchScanSummary, FolderScan, ImageEntry } from '../types';

type CleanScopeRequest = { id: number; spineFiles: string[] } | null;

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
export function LibraryClean({ filter, scopeRequest }: { filter: LibraryFilterApi; scopeRequest: CleanScopeRequest }) {
  const {
    t,
    activeLibrary,
    libraryScan,
    merged,
    scanSourceFolders,
    cleanScanSummary,
    setCleanScanSummary,
    rescanLibrary,
    markLibraryEntriesClean,
    markLibraryEntriesScanned,
    readImageDataUrl,
    pushToast
  } = useApp();

  const [working, setWorking] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [scanChecked, setScanChecked] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
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
  const includedKeys = useMemo(() => included.map((e) => e.spineFile).join('\n'), [included]);
  const scanGroups = useMemo(() => (facet === 'id' ? groupByIdBand(included) : groupByFolder(included)), [facet, included]);
  const summaryText = selectionSummary({ facet, selectedCats, selectedVersions, query });
  const scopeAll = included.length === entries.length;
  const selectedScanEntries = included.filter((e) => scanChecked.has(e.spineFile));
  const scanAllChecked = included.length > 0 && included.every((e) => scanChecked.has(e.spineFile));

  // Units with unused images (or an error worth surfacing), keyed by .spine path.
  const units = cleanScanSummary?.units.filter((u) => u.unused.length > 0 || u.error) ?? [];
  const cleanable = units.filter((u) => !u.error && u.unused.length > 0);

  function applySummary(result: BatchScanSummary | null) {
    if (!result) return;
    setCleanScanSummary(result);
    // Pre-check every unit that has unused images.
    setChecked(new Set(result.units.filter((u) => u.unused.length > 0 && !u.error).map((u) => u.spineFile)));
  }

  function toggleScanEntry(spineFile: string) {
    setScanChecked((prev) => {
      const next = new Set(prev);
      if (next.has(spineFile)) next.delete(spineFile);
      else next.add(spineFile);
      return next;
    });
  }

  function toggleScanGroup(groupEntries: typeof included) {
    setScanChecked((prev) => {
      const next = new Set(prev);
      const allInGroup = groupEntries.every((e) => next.has(e.spineFile));
      for (const entry of groupEntries) {
        if (allInGroup) next.delete(entry.spineFile);
        else next.add(entry.spineFile);
      }
      return next;
    });
  }

  function toggleScanAll() {
    setScanChecked(scanAllChecked ? new Set() : new Set(included.map((e) => e.spineFile)));
  }

  function toggleGroupCollapsed(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function scanOffline(sourceEntries = libraryScan?.entries) {
    if (selectedScanEntries.length === 0) return;
    setWorking(true);
    try {
      const result = await invoke<BatchScanSummary>('scan_library_unused', {
        root,
        selected: selectedScanEntries.map((e) => e.spineFile)
      });
      applySummary(result);
      markLibraryEntriesScanned(result.units, sourceEntries);
    } catch (error) {
      pushToast(`${t.cleanSourceFailed}: ${String(error)}`, 'error');
    } finally {
      setWorking(false);
    }
  }

  async function scanCli(sourceEntries = libraryScan?.entries) {
    if (selectedScanEntries.length === 0) return;
    setWorking(true);
    try {
      const selected = new Set(selectedScanEntries.map((e) => e.spineFile));
      const excluded = entries.filter((e) => !selected.has(e.spineFile)).map((e) => e.spineFile);
      const result = await scanSourceFolders(root, excluded);
      applySummary(result);
      if (result) markLibraryEntriesScanned(result.units, sourceEntries);
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
    const cleanedSpineFiles: string[] = [];
    try {
      for (const u of selectedUnits) {
        try {
          await invoke<string>('move_unused_images', { imagesDir: u.imagesDir, files: u.unused.map((i) => i.absolutePath) });
          moved += u.unused.length;
          cleanedSpineFiles.push(u.spineFile);
        } catch (error) {
          pushToast(`${t.cleanSourceFailed}: ${String(error)}`, 'error');
        }
      }
      pushToast(t.cleanSourceDone.replace('{count}', String(moved)), 'success');
      const refreshed = await rescanLibrary();
      if (cleanedSpineFiles.length > 0) markLibraryEntriesClean(cleanedSpineFiles, refreshed?.entries);
      await scanOffline(refreshed?.entries);
    } finally {
      setWorking(false);
    }
  }

  const noSpine = !merged.spinePath.trim();

  useEffect(() => {
    setScanChecked((prev) => {
      const includedSet = new Set(included.map((e) => e.spineFile));
      if (prev.size === 0) return new Set(included.map((e) => e.spineFile));
      return new Set([...prev].filter((spineFile) => includedSet.has(spineFile)));
    });
  }, [includedKeys, included]);

  useEffect(() => {
    if (!scopeRequest) return;
    const includedSet = new Set(included.map((e) => e.spineFile));
    setScanChecked(new Set(scopeRequest.spineFiles.filter((spineFile) => includedSet.has(spineFile))));
  }, [scopeRequest, included]);

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
        <div className="library-clean-toolbar">
          <span className="muted" title={root}>
            {root}
          </span>
          <span className="library-tabbar-actions">
            <button className="primary-button" onClick={() => void scanOffline()} disabled={working || selectedScanEntries.length === 0}>
              <RotateCw size={15} className={working ? 'spin' : undefined} /> {t.cleanSourceScan}
            </button>
            <button className="secondary-button" onClick={() => void scanCli()} disabled={working || noSpine || selectedScanEntries.length === 0} title={t.libraryCleanCliHint}>
              {t.libraryCleanCli}
            </button>
          </span>
        </div>
        <p className="helper-text library-clean-scope">
          {t.libraryCleanScope.replace('{n}', String(selectedScanEntries.length)).replace('{total}', String(entries.length))}
          {scopeAll ? ` (${t.libraryScopeAll})` : summaryText ? ` — ${summaryText}` : ''}
          {' · '}
          {t.libraryCleanOfflineNote}
        </p>
        {included.length > 0 && (
          <div className="library-scan-picker">
            <div className="library-scan-picker-head">
              <span className="library-chip-label">{t.cleanSourcePickFolders}</span>
              <button className="ghost-button small" onClick={toggleScanAll} disabled={working}>
                {scanAllChecked ? t.cleanSourceSelectNone : t.cleanSourceSelectAll}
              </button>
            </div>
            <div className="library-scan-groups">
              {scanGroups.map((group) => {
                const isCollapsed = collapsedGroups.has(group.key);
                const groupChecked = group.entries.every((e) => scanChecked.has(e.spineFile));
                const groupIndeterminate = !groupChecked && group.entries.some((e) => scanChecked.has(e.spineFile));
                return (
                  <div className="library-scan-group" key={group.key}>
                    <div className="library-scan-group-head">
                      <input
                        type="checkbox"
                        checked={groupChecked}
                        ref={(node) => {
                          if (node) node.indeterminate = groupIndeterminate;
                        }}
                        onChange={() => toggleScanGroup(group.entries)}
                        disabled={working}
                        aria-label={`${t.cleanSourcePickFolders}: ${group.key}`}
                      />
                      <button className="library-group-toggle" onClick={() => toggleGroupCollapsed(group.key)} aria-expanded={!isCollapsed}>
                        {isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                        {group.key} <span className="muted">({group.entries.length})</span>
                      </button>
                    </div>
                    {!isCollapsed && (
                      <div className="library-scan-unit-list">
                        {group.entries.map((entry) => (
                          <label className="library-scan-unit" key={entry.spineFile} title={entry.spineFile}>
                            <input
                              type="checkbox"
                              checked={scanChecked.has(entry.spineFile)}
                              onChange={() => toggleScanEntry(entry.spineFile)}
                              disabled={working}
                            />
                            <span>{entry.relPath}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {cleanScanSummary && (
          <div className="stat-cards">
            <StatCard
              icon={<Trash2 size={18} />}
              label={t.cleanSourceColUnused}
              value={cleanScanSummary.totalUnused}
              tone={cleanScanSummary.totalUnused > 0 ? 'warn' : 'default'}
            />
            <StatCard icon={<HardDrive size={18} />} label={t.libraryTotalImages} value={formatBytes(cleanScanSummary.totalUnusedBytes)} />
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
