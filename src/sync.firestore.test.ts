import { beforeEach, describe, expect, it, vi } from 'vitest';

// Firestore IO is tested against in-memory mocks of `./firebase` (uid + doc refs) and the
// `firebase/firestore` primitives, so the round-trip — serverTimestamp → resolved millis, doc
// validation, signed-out guards — is verified without a live backend.

const store = new Map<string, Record<string, unknown>>();
let mockUid: string | null = 'uid-1';
const SERVER = Symbol('serverTimestamp');

vi.mock('./firebase', () => ({
  currentUid: () => mockUid,
  envDoc: (...segments: string[]) => ({ key: segments.join('/') })
}));

vi.mock('firebase/firestore', () => {
  class Timestamp {
    constructor(public ms: number) {}
    toMillis() {
      return this.ms;
    }
  }
  return {
    Timestamp,
    serverTimestamp: () => SERVER,
    setDoc: async (ref: { key: string }, data: Record<string, unknown>) => {
      store.set(ref.key, { ...data, updatedAt: data.updatedAt === SERVER ? new Timestamp(5000) : data.updatedAt });
    },
    getDoc: async (ref: { key: string }) => {
      const data = store.get(ref.key);
      return {
        exists: () => data !== undefined,
        data: () => data,
        get: (k: string) => data?.[k]
      };
    }
  };
});

import { defaultAppConfig, defaultSessionConfig, type Library, type Project, type Session } from './config';
import {
  buildLibraryProfile,
  buildWorkspaceProfile,
  readLibraryProfile,
  readWorkspaceProfile,
  writeLibraryProfile,
  writeWorkspaceProfile,
  type SyncData
} from './sync';

const project: Project = { id: 'p1', name: 'Proj', autoNamed: false, createdAt: 1, updatedAt: 2 };
const session: Session = {
  id: 's1',
  projectId: 'p1',
  name: 'Hero',
  autoNamed: false,
  wizardCompleted: true,
  config: { ...defaultSessionConfig, inputPath: 'G:\\GDrive\\Spine\\Heroes' },
  createdAt: 1,
  updatedAt: 2
};
const library: Library = { id: 'l1', name: 'Lib', rootPath: 'G:\\GDrive\\Spine', createdAt: 1, lastScanAt: null };
const data: SyncData = { appConfig: { ...defaultAppConfig }, projects: [project], sessions: [session], libraries: [library] };

describe('workspace Firestore IO', () => {
  beforeEach(() => {
    store.clear();
    mockUid = 'uid-1';
  });

  it('writes with a server timestamp and reads it back as millis', async () => {
    const local = buildWorkspaceProfile(data, 'G:\\GDrive\\Spine', 1000);
    const at = await writeWorkspaceProfile(local);
    expect(at).toBe(5000); // resolved serverTimestamp, not the client 1000

    const remote = await readWorkspaceProfile();
    expect(remote?.updatedAt).toBe(5000);
    expect(remote?.projects).toHaveLength(1);
    expect(remote?.sessions[0].config.inputPath).toBe('${SPINE_ROOT}/Heroes');
  });

  it('reads null when signed out and refuses to write', async () => {
    mockUid = null;
    expect(await readWorkspaceProfile()).toBeNull();
    await expect(writeWorkspaceProfile(buildWorkspaceProfile(data, 'G:\\GDrive\\Spine', 1000))).rejects.toThrow();
  });
});

describe('library Firestore IO', () => {
  beforeEach(() => store.clear());

  it('round-trips the shared library list with a server timestamp', async () => {
    const local = buildLibraryProfile(data.libraries, 'G:\\GDrive\\Spine', 1000);
    const at = await writeLibraryProfile(local);
    expect(at).toBe(5000);

    const remote = await readLibraryProfile();
    expect(remote?.updatedAt).toBe(5000);
    expect(remote?.libraries[0].rootPath).toBe('${SPINE_ROOT}');
  });

  it('returns null when the doc does not exist', async () => {
    expect(await readLibraryProfile()).toBeNull();
  });
});
