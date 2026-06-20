import { Cloud, CloudOff, RefreshCw } from 'lucide-react';
import { useApp } from '../useAppController';
import { formatDateTime } from '../time';
import './SyncStatusDot.css';

/**
 * Global sync indicator (lives in the titlebar). Color + icon + tooltip per Tier-A sync state:
 * grey = off/unconfigured, amber = pending/syncing, green = synced, red = error. Click opens
 * Settings so the user can configure the Drive folder / Spine root or hit "Sync now".
 */
export function SyncStatusDot() {
  const { syncStatus, syncEnabled, syncLastSyncedAt, syncError, t, openSettings } = useApp();

  // Don't show anything until the user has turned sync on (keeps the titlebar quiet by default).
  if (!syncEnabled) return null;

  const label = (() => {
    switch (syncStatus) {
      case 'synced':
        return t.syncStatusSynced;
      case 'pending':
        return t.syncStatusPending;
      case 'syncing':
        return t.syncStatusSyncing;
      case 'error':
        return syncError || t.syncStatusError;
      default:
        return t.syncStatusIdle;
    }
  })();

  const lastLine =
    syncLastSyncedAt && syncStatus !== 'error'
      ? `\n${t.syncLastSynced}: ${formatDateTime(syncLastSyncedAt)}`
      : '';
  const title = `${t.syncTitle} — ${label}${lastLine}`;

  const Icon = syncStatus === 'error' ? CloudOff : syncStatus === 'syncing' ? RefreshCw : Cloud;

  return (
    <button
      className={`sync-status-dot status-${syncStatus}`}
      title={title}
      aria-label={title}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={() => openSettings(true)}
    >
      <Icon className={syncStatus === 'syncing' ? 'spin' : undefined} size={13} />
      <span className="sync-status-pip" aria-hidden="true" />
    </button>
  );
}
