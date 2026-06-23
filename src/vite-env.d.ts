/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Firebase web config — embedded at build time (see docs/sync.md ▸ Firestore set-up). */
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.ico' {
  const src: string;
  export default src;
}

declare module '*.png' {
  const src: string;
  export default src;
}

declare const __APP_VERSION__: string;

// npm alias to the 4.2 Spine player (same API as the 4.3 package it mirrors).
declare module 'spine-player-42' {
  export * from '@esotericsoftware/spine-player';
}
