import { AlertTriangle, Boxes, CheckCircle2, Circle, Images, Tag } from 'lucide-react';
import { StatCard } from './StatCard';
import { formatBytes } from '../time';
import { versionLabel, type VersionBucket } from '../library';
import type { Translations } from '../i18n';

/** Header stat cards for the Inventory tab: totals, per-major-version counts, and clean-scan coverage. */
export function LibraryStatCards({
  t,
  totalEntries,
  buckets,
  totalImageBytes,
  scanCounts
}: {
  t: Translations;
  totalEntries: number;
  buckets: VersionBucket[];
  totalImageBytes: number;
  scanCounts: { clean: number; warning: number; unknown: number };
}) {
  return (
    <div className="stat-cards">
      <StatCard icon={<Boxes size={18} />} label={t.libraryTotalEntries} value={totalEntries} />
      {buckets.map((b) => (
        <StatCard key={b.major} icon={<Tag size={18} />} label={versionLabel(b.major)} value={b.count} />
      ))}
      <StatCard icon={<Images size={18} />} label={t.libraryTotalImages} value={formatBytes(totalImageBytes)} />
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
