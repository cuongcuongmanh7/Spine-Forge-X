import type { ReactNode } from 'react';
import './StatCard.css';

/**
 * Dashboard-style metric card: an icon chip on the left, a big tabular value and an
 * uppercase label on the right. Used for every stat row in the app (Library inventory /
 * clean tabs). `tone="warn"` tints the card when the metric needs attention.
 */
export function StatCard({
  icon,
  label,
  value,
  tone = 'default'
}: {
  icon?: ReactNode;
  label: string;
  value: ReactNode;
  tone?: 'default' | 'ok' | 'warn' | 'info';
}) {
  return (
    <div className={`stat-card${tone !== 'default' ? ` ${tone}` : ''}`}>
      {icon && (
        <span className="stat-card-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="stat-card-body">
        <span className="stat-card-value">{value}</span>
        <span className="stat-card-label">{label}</span>
      </span>
    </div>
  );
}
