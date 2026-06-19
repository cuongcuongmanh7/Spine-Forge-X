import { useCallback, useEffect, useRef, useState } from 'react';
import type { Translations } from './i18n';
import type { ToastKind } from './types';
import { driveSignIn, driveSignOut, getDriveAccount, type DriveAccount } from './drive';

type Args = {
  t: Translations;
  pushToast: (text: string, kind?: ToastKind) => void;
};

/**
 * Tier-B Google Drive auth state. Hydrates the signed-in account on mount and exposes
 * sign-in/out. Metadata fetching is lazy (per Library row), so it lives in the component,
 * not here — this hook only owns the account/session.
 */
export function useDrive({ t, pushToast }: Args) {
  const [account, setAccount] = useState<DriveAccount | null>(null);
  const [busy, setBusy] = useState(false);

  const tRef = useRef(t);
  tRef.current = t;
  const pushToastRef = useRef(pushToast);
  pushToastRef.current = pushToast;

  useEffect(() => {
    void getDriveAccount()
      .then(setAccount)
      .catch(() => setAccount(null));
  }, []);

  const signIn = useCallback(async () => {
    setBusy(true);
    try {
      const acc = await driveSignIn();
      setAccount(acc);
      pushToastRef.current(`${tRef.current.driveSignedInAs}: ${acc.email}`, 'success');
    } catch (e) {
      pushToastRef.current(`${tRef.current.driveSignInFailed}: ${String(e)}`, 'error');
    } finally {
      setBusy(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await driveSignOut();
      setAccount(null);
    } catch (e) {
      pushToastRef.current(String(e), 'error');
    }
  }, []);

  return {
    driveAccount: account,
    driveBusy: busy,
    driveSignIn: signIn,
    driveSignOut: signOut
  };
}
