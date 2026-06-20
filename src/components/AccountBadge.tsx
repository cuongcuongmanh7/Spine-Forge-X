import { useState } from 'react';
import { RotateCw, UserCircle2 } from 'lucide-react';
import { useApp } from '../useAppController';

/**
 * Persistent Google Drive account chip in the sidebar footer (VS Code style). Signed out → clicking
 * starts sign-in directly. While waiting → spinner (click opens Settings, which has Cancel). Signed
 * in → shows avatar + email and opens Settings ▸ Sync (sign-out lives there).
 */
export function AccountBadge() {
  const { t, driveAccount, driveBusy, driveSignIn, openSettings } = useApp();
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

  return (
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
    </button>
  );
}
