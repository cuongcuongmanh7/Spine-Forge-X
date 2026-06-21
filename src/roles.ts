// App roles. The shared Library list is leader-curated: only a leader may add/remove libraries
// ("projects") in the Library; members get a read-only list and consume it. Enforced both in the UI
// (import/delete hidden for members) and server-side in `firestore.rules` (library write = leader
// only) — the rule is the real boundary; the UI gate is just UX.
//
// Leaders are NOT hardcoded: they live in a Firestore doc `config/roles` ({ leaderEmails: [...] }),
// managed in the Firebase Console (client read-only). The app reads that list and the rules read the
// same doc, so changing leaders is a one-document edit — no code change, no redeploy. See
// `src/firebase.ts` ▸ subscribeLeaderEmails and docs/sync.md.

/** True when `email` is in the leader list (emails are compared case-insensitively). */
export function computeIsLeader(email: string | null | undefined, leaderEmails: string[]): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  return leaderEmails.some((l) => l.trim().toLowerCase() === e);
}
