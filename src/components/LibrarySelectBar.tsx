import type { Dispatch, SetStateAction } from 'react';
import { LayoutGrid, List } from 'lucide-react';
import type { Translations } from '../i18n';
import type { LibraryEntry } from '../config';
import type { SortKey, SortState } from './LibraryViewShared';
import './LibrarySelection.css';

/**
 * The bar above the inventory list: the select-all master checkbox + matched/selected count + a
 * clear-selection link on the left, and the sort pill (grid only) + table/grid toggle on the right.
 * Split out of LibraryInventory to keep that file under the line-size guard.
 */
export function LibrarySelectBar({
  filtered,
  selected,
  setManySelected,
  clearSelected,
  viewMode,
  setViewMode,
  sort,
  setSort,
  sortLabels,
  t
}: {
  filtered: LibraryEntry[];
  selected: Set<string>;
  setManySelected: (spineFiles: string[], on: boolean) => void;
  clearSelected: () => void;
  viewMode: 'table' | 'grid';
  setViewMode: (mode: 'table' | 'grid') => void;
  sort: SortState;
  setSort: Dispatch<SetStateAction<SortState>>;
  sortLabels: Record<SortKey, string>;
  t: Translations;
}) {
  const matchedKeys = filtered.map((e) => e.spineFile);
  const matchedCount = matchedKeys.length;
  const selectedCount = selected.size;
  const allMatchedSelected = matchedCount > 0 && matchedKeys.every((k) => selected.has(k));
  const someMatchedSelected = !allMatchedSelected && matchedKeys.some((k) => selected.has(k));

  return (
    <div className="library-select-bar">
      <label className="library-select-all">
        <input
          type="checkbox"
          checked={allMatchedSelected}
          ref={(el) => {
            if (el) el.indeterminate = someMatchedSelected;
          }}
          onChange={() => setManySelected(matchedKeys, !allMatchedSelected)}
          aria-label={t.librarySelectAll}
        />
        <span>{t.librarySelectAll}</span>
      </label>
      <span className="muted library-select-count">
        {selectedCount > 0
          ? t.librarySelectedCount.replace('{count}', String(selectedCount))
          : t.libraryMatchedCount.replace('{count}', String(matchedCount))}
      </span>
      {selectedCount > 0 && (
        <button type="button" className="link-button" onClick={clearSelected}>
          {t.libraryClearSelection}
        </button>
      )}
      <span className="library-view-controls">
        {viewMode === 'grid' && (
          <span className="library-sort-control">
            <span className="library-sort-label">{t.librarySortBy}:</span>
            <select value={sort.key} onChange={(e) => setSort((s) => ({ ...s, key: e.target.value as SortKey }))}>
              {(Object.keys(sortLabels) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {sortLabels[k]}
                </option>
              ))}
            </select>
            <button
              className="library-sort-dir"
              onClick={() => setSort((s) => ({ ...s, direction: s.direction === 'asc' ? 'desc' : 'asc' }))}
              title={sort.direction === 'asc' ? t.libraryCollapseAll : t.libraryExpandAll}
              aria-label="sort direction"
            >
              {sort.direction === 'asc' ? '↑' : '↓'}
            </button>
          </span>
        )}
        <span className="segmented-control">
          <button className={viewMode === 'table' ? 'active' : ''} onClick={() => setViewMode('table')}>
            <List size={14} /> {t.libraryViewTable}
          </button>
          <button className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')}>
            <LayoutGrid size={14} /> {t.libraryViewGrid}
          </button>
        </span>
      </span>
    </div>
  );
}
