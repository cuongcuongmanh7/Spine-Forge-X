import { AlertTriangle, Boxes, CheckCircle2, Circle } from 'lucide-react';
import { StatCard } from './StatCard';
import { StatIcon } from './StatIcon';
import { SpineFileIcon } from './SpineFileIcon';
import { formatBytes } from '../time';
import type { Translations } from '../i18n';

/** Header stat cards for the Inventory tab: totals, image footprint, and clean-scan coverage. */
export function LibraryStatCards({
  t,
  totalEntries,
  totalImageBytes,
  scanCounts
}: {
  t: Translations;
  totalEntries: number;
  totalImageBytes: number;
  scanCounts: { clean: number; warning: number; unknown: number };
}) {
  return (
    <div className="stat-cards">
      <StatCard icon={<Boxes size={18} />} label={t.libraryStatTotalAssets} value={totalEntries} />
      <StatCard icon={<SpineFileIcon size={18} />} label={t.libraryTotalEntries} value={totalEntries} />
      <StatCard icon={<StatIcon kind="image" size={18} />} label={t.libraryTotalImages} value={formatBytes(totalImageBytes)} />
      <StatCard icon={<Circle size={18} />} label={t.libraryStatNotScanned} value={scanCounts.unknown} />
      <StatCard icon={<CheckCircle2 size={18} />} label={t.libraryStatClean} value={scanCounts.clean} tone={scanCounts.clean > 0 ? 'ok' : 'default'} />
      <StatCard
        icon={<AlertTriangle size={18} />}
        label={t.libraryStatNeedsReview}
        value={scanCounts.warning}
        tone={scanCounts.warning > 0 ? 'warn' : 'default'}
      />
    </div>
  );
}
