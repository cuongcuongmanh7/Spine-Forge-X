// Firebase backend for the sync *metadata* layer (workspace profile + shared library list).
// Source `.spine` assets stay on the Google Shared Drive (filesystem, opened directly by Spine.exe);
// only the small recreatable JSON metadata moves here so it can be protected by Firestore security
// rules (server-enforced — no filesystem permission gaps), server timestamps, and point-in-time
// recovery. See docs/sync.md ▸ "Bảo vệ dữ liệu".
//
// Init is LAZY: nothing touches the network until a doc read/write or sign-in actually runs, so
// importing this module (e.g. from sync.ts under vitest) is side-effect free. Auth reuses the same
// Google account the Tier-B Drive OAuth already established — the Rust flow mints a Google id_token
// that we exchange for a Firebase session (no second login).

import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signOut as firebaseAuthSignOut,
  type Auth,
  type User
} from 'firebase/auth';
import {
  doc,
  initializeFirestore,
  onSnapshot,
  persistentLocalCache,
  persistentSingleTabManager,
  type DocumentReference,
  type Firestore
} from 'firebase/firestore';
import { getDownloadURL, getStorage, ref as storageRef, uploadString, type FirebaseStorage } from 'firebase/storage';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID
} as const;

/** Dev build (`vite dev` / `tauri dev`) writes under `envs/dev`; release under `envs/prod` — same
 *  Firestore project, isolated data, mirroring the `spine_app_data/dev` filesystem split. */
export const ENV = import.meta.env.DEV ? 'dev' : 'prod';

let app: FirebaseApp | null = null;
let firestore: Firestore | null = null;
let storage: FirebaseStorage | null = null;

/** False when the build wasn't given Firebase config (env vars unset) — sync then stays signed-out
 *  and the metadata layer simply doesn't run, rather than crashing on a bad init. */
export function firebaseConfigured(): boolean {
  return Boolean(config.apiKey && config.projectId && config.appId);
}

function getApp(): FirebaseApp {
  if (!app) app = initializeApp(config);
  return app;
}

function getDb(): Firestore {
  if (!firestore) {
    // Offline persistence (IndexedDB) so animators keep working when the network drops; writes
    // queue and flush on reconnect. Single-tab is correct for a desktop webview (one window).
    firestore = initializeFirestore(getApp(), {
      localCache: persistentLocalCache({ tabManager: persistentSingleTabManager(undefined) })
    });
  }
  return firestore;
}

function getAuthInstance(): Auth {
  return getAuth(getApp());
}

/** Reference to `envs/{dev|prod}/<segments…>` (segment count must land on a document). */
export function envDoc(...segments: string[]): DocumentReference {
  return doc(getDb(), 'envs', ENV, ...segments);
}

/**
 * Live subscription to the leader list in `config/roles` (`{ leaderEmails: string[] }`). The doc is
 * env-independent (same leaders in dev/prod) and managed in the Firebase Console (client read-only).
 * Callable only after sign-in (rules require org auth to read it). Returns an unsubscribe fn; emits
 * `[]` when the doc is missing/unreadable. Live so a Console edit propagates without a restart.
 */
export function subscribeLeaderEmails(cb: (emails: string[]) => void): () => void {
  return onSnapshot(
    doc(getDb(), 'config', 'roles'),
    (snap) => {
      const list = snap.exists() ? snap.get('leaderEmails') : null;
      cb(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
    },
    () => cb([])
  );
}

/** Firebase Auth uid of the signed-in user, or null. Used as the workspace document key so the
 *  security rule `request.auth.uid == uid` lets each user write only their own workspace. */
export function currentUid(): string | null {
  return app ? getAuthInstance().currentUser?.uid ?? null : null;
}

/** Exchange a Google id_token (minted by the Rust Drive OAuth flow) for a Firebase session. */
export async function firebaseSignInWithGoogle(idToken: string): Promise<User> {
  const cred = GoogleAuthProvider.credential(idToken);
  const res = await signInWithCredential(getAuthInstance(), cred);
  return res.user;
}

export function firebaseSignOut(): Promise<void> {
  return firebaseAuthSignOut(getAuthInstance());
}

export function onFirebaseAuth(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(getAuthInstance(), cb);
}

// ---- Cloud Storage: shared thumbnail cache ---------------------------------
// Skeleton thumbnails (recreatable PNG cache) live at `envs/{env}/thumbs/{key}.png`. They move off
// the Shared Drive so the Library grid can show previews without the Drive mounted (and on a future
// web/mobile client). A per-machine local cache (Rust `thumb_cache_*`) still fronts this as L1.

function getStorageInstance(): FirebaseStorage {
  if (!storage) storage = getStorage(getApp());
  return storage;
}

function thumbStorageRef(key: string) {
  return storageRef(getStorageInstance(), `envs/${ENV}/thumbs/${key}.png`);
}

/** Download URL for a cached thumbnail, or null if it hasn't been uploaded yet. The URL is used
 *  directly as an `<img>` src (no pixel readback → no bucket CORS needed). */
export async function getThumbDownloadUrl(key: string): Promise<string | null> {
  try {
    return await getDownloadURL(thumbStorageRef(key));
  } catch {
    return null; // object-not-found (or offline) → caller renders it
  }
}

/** Upload a freshly rendered thumbnail (a `data:image/png;base64,…` URL). Best-effort. */
export async function uploadThumb(key: string, dataUrl: string): Promise<void> {
  await uploadString(thumbStorageRef(key), dataUrl, 'data_url');
}
