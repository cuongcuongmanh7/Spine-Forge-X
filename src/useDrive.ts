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
  // Each sign-in attempt gets an id. If the user cancels (or starts a new attempt), the id bumps and
  // the stale in-flight `drive_sign_in` (which keeps blocking until its loopback timeout — e.g. the
  // browser was closed before consent) is ignored, so the UI never stays stuck on "loading".
  const attemptRef = useRef(0);

  useEffect(() => {
    void getDriveAccount()
      .then(setAccount)
      .catch(() => setAccount(null));
  }, []);

  const signIn = useCallback(async () => {
    const id = ++attemptRef.current;
    setBusy(true);
    try {
      const acc = await driveSignIn();
      if (id !== attemptRef.current) return; // cancelled or superseded
      setAccount(acc);
      pushToastRef.current(`${tRef.current.driveSignedInAs}: ${acc.email}`, 'success');
    } catch (e) {
      if (id !== attemptRef.current) return;
      pushToastRef.current(`${tRef.current.driveSignInFailed}: ${String(e)}`, 'error');
    } finally {
      if (id === attemptRef.current) setBusy(false);
    }
  }, []);

  // Give up waiting on the current attempt (e.g. the browser tab was closed) so the user can retry.
  const cancelSignIn = useCallback(() => {
    attemptRef.current += 1;
    setBusy(false);
  }, []);

  const signOut = useCallback(async () => {
    attemptRef.current += 1; // also drops any in-flight sign-in
    setBusy(false);
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
    driveCancelSignIn: cancelSignIn,
    driveSignOut: signOut
  };
}
