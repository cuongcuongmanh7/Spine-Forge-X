import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  firebaseConfigured,
  firebaseSignInWithGoogle,
  firebaseSignOut,
  onFirebaseAuth,
  subscribeLeaderEmails
} from './firebase';
import { computeIsLeader } from './roles';

type Args = {
  /** Signed-in Google account email from the Tier-B Drive flow; null when signed out. */
  driveEmail: string | null;
};

/**
 * Bridges the existing Google Drive OAuth session (Tier B) into a Firebase Auth session — no second
 * login. When the Drive account appears, we ask the Rust backend for a Google `id_token` (minted by
 * the same OAuth flow, refresh token in Windows Credential Manager) and exchange it for a Firebase
 * session. When Drive signs out, Firebase follows. `firebaseUid` keys the user's workspace doc.
 *
 * If the build wasn't given Firebase config, this is a no-op (uid stays null) and the metadata sync
 * simply reports "needs sign-in" rather than crashing.
 */
export function useFirebaseAuth({ driveEmail }: Args) {
  const [uid, setUid] = useState<string | null>(null);
  const [leaderEmails, setLeaderEmails] = useState<string[]>([]);
  // One in-flight sign-in at a time; avoids a double exchange if the effect re-runs before it lands.
  const signingRef = useRef(false);

  useEffect(() => {
    if (!firebaseConfigured()) return;
    return onFirebaseAuth((user) => setUid(user?.uid ?? null));
  }, []);

  // Live leader list from Firestore `config/roles` (readable only once signed in). Re-subscribes when
  // the session appears so a Console edit to the roles doc takes effect without an app restart.
  useEffect(() => {
    if (!firebaseConfigured() || !uid) {
      setLeaderEmails([]);
      return;
    }
    return subscribeLeaderEmails(setLeaderEmails);
  }, [uid]);

  useEffect(() => {
    if (!firebaseConfigured()) return;
    if (!driveEmail) {
      if (uid) void firebaseSignOut();
      return;
    }
    if (uid || signingRef.current) return;
    signingRef.current = true;
    void (async () => {
      try {
        const idToken = await invoke<string | null>('drive_id_token');
        if (idToken) await firebaseSignInWithGoogle(idToken);
        // No id_token (e.g. account predates the openid scope) → user re-signs in to Drive to grant it.
      } catch {
        // Network down / token revoked → stay signed out; reconcile reports needs-sign-in.
      } finally {
        signingRef.current = false;
      }
    })();
  }, [driveEmail, uid]);

  return { firebaseUid: uid, isLeader: computeIsLeader(driveEmail, leaderEmails) };
}
