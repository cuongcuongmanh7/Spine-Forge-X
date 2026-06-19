import { useState } from 'react';
import { UserCircle2 } from 'lucide-react';
import { useApp } from '../useAppController';

/**
 * Persistent Google Drive account chip in the sidebar footer (VS Code style). Shows the
 * signed-in avatar + email, or a muted "sign in" prompt. Clicking opens Settings ▸ Sync,
 * where the full sign-in/out controls live — the footer is just a shortcut + status.
 */
export function AccountBadge() {
  const { t, driveAccount, setSettingsOpen } = useApp();
  const [imgFailed, setImgFailed] = useState(false);

  const label = driveAccount ? driveAccount.email : t.driveSignIn;
  const showPhoto = driveAccount?.photoLink && !imgFailed;

  return (
    <button
      className="sidebar-settings account-badge"
      onClick={() => setSettingsOpen(true)}
      title={driveAccount ? `${t.driveSignedInAs}: ${driveAccount.email}` : t.driveSignInHelp}
    >
      {showPhoto ? (
        <img className="account-avatar" src={driveAccount!.photoLink!} alt="" onError={() => setImgFailed(true)} />
      ) : (
        <UserCircle2 size={18} className={driveAccount ? undefined : 'muted'} />
      )}
      <span className={`account-email ${driveAccount ? '' : 'muted'}`}>{label}</span>
    </button>
  );
}
