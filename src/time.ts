/** Format a duration in ms as a compact human string: "45s", "1m 23s", "1h 02m". */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

function toDate(input: number | string | Date): Date | null {
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Format a date as `dd/mm/yyyy` (day/month/year). Empty string for invalid input. */
export function formatDate(input: number | string | Date): string {
  const d = toDate(input);
  return d ? `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}` : '';
}

/** Format a date+time as `dd/mm/yyyy HH:mm` (24h). Empty string for invalid input. */
export function formatDateTime(input: number | string | Date): string {
  const d = toDate(input);
  return d ? `${formatDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : '';
}

/** Format a byte count as a compact human string: "0 B", "12.0 KB", "3.4 MB", "1.2 GB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exp = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exp;
  return `${exp === 0 ? value : value.toFixed(1)} ${units[exp]}`;
}
