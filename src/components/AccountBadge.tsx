import { useState } from 'react';
import { RotateCw, UserCircle2 } from 'lucide-react';
import { useApp } from '../useAppController';
import { formatDateTime } from '../time';
import './AccountBadge.css';

/**
 * Persistent Google Drive account chip in the sidebar footer (VS Code style). Signed out → clicking
 * starts sign-in directly. While waiting → spinner (click opens Settings, which has Cancel). Signed
 * in → shows avatar + email and opens Settings ▸ Sync (sign-out lives there).
 *
 * Doubles as the global sync indicator: when sync is on, a colored status pip (grey = idle,
 * amber = pending/syncing, green = synced, red = error) sits at the trailing edge — so the account
 * and sync state read as one control instead of a separate titlebar dot.
 */
export function AccountBadge() {
  const { t, driveAccount, driveBusy, driveSignIn, openSettings, syncEnabled, syncStatus, syncLastSyncedAt, syncError } =
    useApp();
  const [imgFailed, setImgFailed] = useState(false);

  const showPhoto = driveAccount?.photoLink && !imgFailed;
  const label = driveAccount ? driveAccount.email : driveBusy ? t.driveSignInWaiting : t.driveSignIn;

  const onClick = () => {
    if (driveAccount || driveBusy) {
      openSettings(true); // manage / cancel from Settings ▸ Sync
      return;
    }
    void driveSignIn();
  };

  const syncLabel = (() => {
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
    syncLastSyncedAt && syncStatus !== 'error' ? `\n${t.syncLastSynced}: ${formatDateTime(syncLastSyncedAt)}` : '';
  const syncTitle = `${t.syncTitle} — ${syncLabel}${lastLine}`;

  // Transient state shown as an inline line under the badge — visible only while something is
  // happening (saving / syncing / error), so the steady "synced" state stays quiet (pip only).
  const transient = syncEnabled && (syncStatus === 'pending' || syncStatus === 'syncing' || syncStatus === 'error');
  const lineLabel =
    syncStatus === 'syncing' ? t.syncStatusSyncing : syncStatus === 'pending' ? t.syncStatusPending : t.syncStatusError;

  return (
    <>
      <button
        className="sidebar-settings account-badge"
        onClick={onClick}
        title={driveAccount ? `${t.driveSignedInAs}: ${driveAccount.email}` : t.driveSignInHelp}
      >
        {showPhoto ? (
          <img className="account-avatar" src={driveAccount!.photoLink!} alt="" onError={() => setImgFailed(true)} />
        ) : driveBusy ? (
          <RotateCw className="spin" size={18} />
        ) : (
          <UserCircle2 size={18} className={driveAccount ? undefined : 'muted'} />
        )}
        <span className={`account-email ${driveAccount ? '' : 'muted'}`}>{label}</span>
        {syncEnabled && (
          <span className={`account-sync-pip status-${syncStatus}`} title={syncTitle} aria-label={syncTitle} />
        )}
      </button>
      {transient && (
        <span className={`account-sync-line status-${syncStatus}`} role="status" title={syncError ?? undefined}>
          {syncStatus === 'syncing' && <RotateCw className="spin" size={11} aria-hidden="true" />}
          {lineLabel}
        </span>
      )}
    </>
  );
}
