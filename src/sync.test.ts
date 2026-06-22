import { beforeEach, describe, expect, it } from 'vitest';
import { defaultAppConfig, defaultSessionConfig, type Library, type Project, type Session } from './config';
import {
  applyLibraryCleanProfile,
  applyLibraryProfile,
  applyWorkspaceProfile,
  buildLibraryCleanProfile,
  buildLibraryProfile,
  buildWorkspaceProfile,
  deriveAnchor,
  libraryDataDir,
  libraryListPath,
  resolvePath,
  sameLibraryBody,
  sameLibraryCleanBody,
  sameWorkspaceBody,
  slugifyEmail,
  tokenizePath,
  workspaceProfilePath,
  type SyncData
} from './sync';
import type { LibraryCleanRecord, LibraryCleanState } from './config';

describe('deriveAnchor', () => {
  it('anchors at the Shared drives mount when the folder is inside one', () => {
    expect(deriveAnchor('G:\\Shared drives\\FD')).toBe('G:\\Shared drives');
    expect(deriveAnchor('G:\\Shared drives\\Pamvis\\spine_app_data')).toBe('G:\\Shared drives');
  });

  it('returns the mount itself unchanged', () => {
    expect(deriveAnchor('G:\\Shared drives')).toBe('G:\\Shared drives');
  });

  it('falls back to the folder when not under a Shared drives mount', () => {
    expect(deriveAnchor('D:\\Local\\Spine')).toBe('D:\\Local\\Spine');
  });
});

describe('tokenizePath / resolvePath', () => {
  const root = 'G:\\GDrive\\Spine';

  it('tokenizes a path under the Spine root', () => {
    expect(tokenizePath('G:\\GDrive\\Spine\\Heroes\\a.spine', root)).toBe('${SPINE_ROOT}/Heroes/a.spine');
  });

  it('is case-insensitive on the root match (Windows)', () => {
    expect(tokenizePath('g:\\gdrive\\spine\\Heroes\\a.spine', root)).toBe('${SPINE_ROOT}/Heroes/a.spine');
  });

  it('returns the bare token when the path equals the root', () => {
    expect(tokenizePath('G:\\GDrive\\Spine', root)).toBe('${SPINE_ROOT}');
  });

  it('leaves paths outside the root absolute', () => {
    expect(tokenizePath('C:\\Other\\b.spine', root)).toBe('C:\\Other\\b.spine');
  });

  it('rebases a token onto a different drive on another machine', () => {
    expect(resolvePath('${SPINE_ROOT}/Heroes/a.spine', 'F:\\Drive\\Spine')).toBe('F:\\Drive\\Spine\\Heroes\\a.spine');
  });
});

describe('path helpers', () => {
  it('slugifies emails into filesystem-safe folder names', () => {
    expect(slugifyEmail('Cuong.DM@Ondigames.com')).toBe('cuong.dm_ondigames.com');
  });

  it('builds per-user workspace + shared library paths under the app-data root', () => {
    const base = 'G:\\Shared drives\\Pamvis\\spine_app_data';
    expect(workspaceProfilePath(base, 'a@b.com')).toBe('G:\\Shared drives\\Pamvis\\spine_app_data\\workspaces\\a_b.com\\profile.json');
    expect(libraryDataDir(base)).toBe('G:\\Shared drives\\Pamvis\\spine_app_data\\library');
    expect(libraryListPath(base)).toBe('G:\\Shared drives\\Pamvis\\spine_app_data\\library\\libraries.json');
  });
});

describe('build / apply profiles', () => {
  beforeEach(() => localStorage.clear());

  const project: Project = { id: 'p1', name: 'Proj', autoNamed: false, createdAt: 1, updatedAt: 2 };
  const session: Session = {
    id: 's1',
    projectId: 'p1',
    name: 'Hero',
    autoNamed: false,
    wizardCompleted: true,
    config: {
      ...defaultSessionConfig,
      inputPath: 'G:\\GDrive\\Spine\\Heroes',
      inputFiles: ['G:\\GDrive\\Spine\\Heroes\\a.spine'],
      excludedFiles: ['G:\\GDrive\\Spine\\Heroes\\b.spine'],
      outputPath: 'C:\\Unity\\Assets'
    },
    createdAt: 1,
    updatedAt: 2
  };
  const library: Library = { id: 'l1', name: 'Lib', rootPath: 'G:\\GDrive\\Spine', createdAt: 1, lastScanAt: null };
  const data: SyncData = {
    appConfig: { ...defaultAppConfig, spinePath: 'C:\\MachineA\\Spine.com', parallelJobs: 6 },
    projects: [project],
    sessions: [session],
    libraries: [library],
    libraryCleanState: {}
  };

  it('workspace profile tokenizes source paths, drops spinePath, omits libraries', () => {
    const profile = buildWorkspaceProfile(data, 'G:\\GDrive\\Spine', 1000);
    expect(profile.sessions[0].config.inputFiles[0]).toBe('${SPINE_ROOT}/Heroes/a.spine');
    expect(profile.sessions[0].config.excludedFiles[0]).toBe('${SPINE_ROOT}/Heroes/b.spine');
    expect(profile.sessions[0].config.outputPath).toBe('C:\\Unity\\Assets'); // Unity stays absolute
    expect(profile.appConfig).not.toHaveProperty('spinePath');
    expect(profile.appConfig.parallelJobs).toBe(6);
    expect(profile).not.toHaveProperty('libraries');
  });

  it('library profile tokenizes rootPath', () => {
    const profile = buildLibraryProfile(data.libraries, 'G:\\GDrive\\Spine', 1000);
    expect(profile.libraries[0].rootPath).toBe('${SPINE_ROOT}');
  });

  it('applyWorkspaceProfile rebases onto another machine and preserves the local spinePath', () => {
    const profile = buildWorkspaceProfile(data, 'G:\\GDrive\\Spine', 1000);
    applyWorkspaceProfile(profile, 'F:\\Drive\\Spine', 'D:\\MachineB\\Spine.com');

    const sessions = JSON.parse(localStorage.getItem('spineforge.sessions')!) as Session[];
    expect(sessions[0].config.inputFiles[0]).toBe('F:\\Drive\\Spine\\Heroes\\a.spine');

    const appConfig = JSON.parse(localStorage.getItem('spineforge.appConfig')!);
    expect(appConfig.spinePath).toBe('D:\\MachineB\\Spine.com'); // local value kept, not synced
    expect(appConfig.parallelJobs).toBe(6); // synced value applied
  });

  it('applyLibraryProfile rebases library rootPath', () => {
    const profile = buildLibraryProfile(data.libraries, 'G:\\GDrive\\Spine', 1000);
    applyLibraryProfile(profile, 'F:\\Drive\\Spine');
    const libs = JSON.parse(localStorage.getItem('spineforge.libraries')!) as Library[];
    expect(libs[0].rootPath).toBe('F:\\Drive\\Spine');
  });

  it('sameWorkspaceBody / sameLibraryBody ignore updatedAt', () => {
    expect(sameWorkspaceBody(buildWorkspaceProfile(data, 'G:\\GDrive\\Spine', 1000), buildWorkspaceProfile(data, 'G:\\GDrive\\Spine', 9999))).toBe(true);
    expect(sameLibraryBody(buildLibraryProfile(data.libraries, 'G:\\GDrive\\Spine', 1000), buildLibraryProfile(data.libraries, 'G:\\GDrive\\Spine', 9999))).toBe(true);
  });
});

describe('library clean-state profile', () => {
  beforeEach(() => localStorage.clear());

  const CLEAN_KEY = 'spineforge.libraryClean.l1';
  const libraries: Library[] = [{ id: 'l1', name: 'Lib', rootPath: 'G:\\GDrive\\Spine', createdAt: 1, lastScanAt: null }];
  const recordFor = (spineFile: string): LibraryCleanRecord => ({
    spineFile,
    scannedAt: 5,
    unusedCount: 0,
    unusedBytes: 0,
    spineBytes: 100,
    imageBytes: 200,
    imageCount: 3,
    version: '4.1',
    exported: true
  });
  const seed = (state: LibraryCleanState) => localStorage.setItem(CLEAN_KEY, JSON.stringify(state));

  it('tokenizes both the record map key and the embedded spineFile', () => {
    const abs = 'G:\\GDrive\\Spine\\Heroes\\a.spine';
    seed({ [abs]: recordFor(abs) });
    const profile = buildLibraryCleanProfile(libraries, 'G:\\GDrive\\Spine', 1000);
    expect(profile.states.l1).toHaveLength(1);
    expect(profile.states.l1[0].spineFile).toBe('${SPINE_ROOT}/Heroes/a.spine');
  });

  it('omits libraries with an empty clean-state', () => {
    const profile = buildLibraryCleanProfile(libraries, 'G:\\GDrive\\Spine', 1000);
    expect(profile.states).toEqual({});
  });

  it('round-trips onto another machine: map key AND record.spineFile rebase to the local path', () => {
    const abs = 'G:\\GDrive\\Spine\\Heroes\\a.spine';
    seed({ [abs]: recordFor(abs) });
    const profile = buildLibraryCleanProfile(libraries, 'G:\\GDrive\\Spine', 1000);

    localStorage.clear();
    applyLibraryCleanProfile(profile, 'F:\\Drive\\Spine');
    const local = JSON.parse(localStorage.getItem(CLEAN_KEY)!) as LibraryCleanState;

    const localAbs = 'F:\\Drive\\Spine\\Heroes\\a.spine';
    // The map MUST be keyed by the local absolute path...
    expect(Object.keys(local)).toEqual([localAbs]);
    // ...and record.spineFile rebased too, or cleanStatusForEntry's `record.spineFile === entry.spineFile`
    // check would reject it on the new machine (showing "needs review" instead of "clean").
    expect(local[localAbs].spineFile).toBe(localAbs);
    expect(local[localAbs].version).toBe('4.1');
  });

  it('sameLibraryCleanBody ignores updatedAt and map-iteration order', () => {
    seed({
      'G:\\GDrive\\Spine\\b.spine': recordFor('G:\\GDrive\\Spine\\b.spine'),
      'G:\\GDrive\\Spine\\a.spine': recordFor('G:\\GDrive\\Spine\\a.spine')
    });
    const a = buildLibraryCleanProfile(libraries, 'G:\\GDrive\\Spine', 1000);
    const b = buildLibraryCleanProfile(libraries, 'G:\\GDrive\\Spine', 9999);
    expect(sameLibraryCleanBody(a, b)).toBe(true);
  });
});
