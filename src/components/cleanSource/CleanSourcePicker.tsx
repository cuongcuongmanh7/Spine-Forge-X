import type { Translations } from '../../i18n';
import type { CleanUnitInfo } from '../../types';
import { relativeToRoot } from './helpers';

interface CleanSourcePickerProps {
  t: Translations;
  units: CleanUnitInfo[];
  root: string;
  deselected: Set<string>;
  selectedCount: number;
  unitCount: number;
  largeThreshold: number;
  onToggle: (spineFile: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
}

/**
 * Pre-scan folder picker: the user ticks which discovered `.spine` units to
 * scan. Purely presentational — all selection state lives in the coordinator.
 */
export function CleanSourcePicker({
  t,
  units,
  root,
  deselected,
  selectedCount,
  unitCount,
  largeThreshold,
  onToggle,
  onSelectAll,
  onSelectNone
}: CleanSourcePickerProps) {
  return (
    <div className="clean-source-picker">
      <div className="clean-source-picker-head">
        <span className={`helper-text ${selectedCount > largeThreshold ? 'field-status warning' : ''}`}>
          {t.cleanSourceSelected
            .replace('{count}', String(selectedCount))
            .replace('{total}', String(unitCount))}
        </span>
        <span className="clean-source-picker-actions">
          <button type="button" className="link-button" onClick={onSelectAll}>
            {t.cleanSourceSelectAll}
          </button>
          <button type="button" className="link-button" onClick={onSelectNone}>
            {t.cleanSourceSelectNone}
          </button>
        </span>
      </div>
      <ul className="clean-source-picker-list">
        {units.map((u) => {
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
                  onChange={() => onToggle(u.spineFile)}
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
  );
}
