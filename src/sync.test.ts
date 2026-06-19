import { beforeEach, describe, expect, it } from 'vitest';
import { defaultAppConfig, defaultSessionConfig, type Library, type Project, type Session } from './config';
import { applyProfile, buildProfile, resolvePath, sameProfileBody, tokenizePath, type SyncData } from './sync';

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

  it('round-trips across different mount paths', () => {
    const token = tokenizePath('G:\\GDrive\\Spine\\Heroes\\a.spine', root);
    expect(resolvePath(token, 'F:\\Drive\\Spine')).toBe('F:\\Drive\\Spine\\Heroes\\a.spine');
  });
});

describe('buildProfile / applyProfile', () => {
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
    libraries: [library]
  };

  it('tokenizes source paths and drops the machine-local spinePath', () => {
    const profile = buildProfile(data, 'G:\\GDrive\\Spine', 1000);
    expect(profile.sessions[0].config.inputFiles[0]).toBe('${SPINE_ROOT}/Heroes/a.spine');
    expect(profile.sessions[0].config.excludedFiles[0]).toBe('${SPINE_ROOT}/Heroes/b.spine');
    expect(profile.libraries[0].rootPath).toBe('${SPINE_ROOT}');
    // outputPath (Unity) stays absolute for now; spinePath is never written.
    expect(profile.sessions[0].config.outputPath).toBe('C:\\Unity\\Assets');
    expect(profile.appConfig).not.toHaveProperty('spinePath');
    expect(profile.appConfig.parallelJobs).toBe(6);
  });

  it('rebases onto another machine and preserves the local spinePath', () => {
    const profile = buildProfile(data, 'G:\\GDrive\\Spine', 1000);
    applyProfile(profile, 'F:\\Drive\\Spine', 'D:\\MachineB\\Spine.com');

    const sessions = JSON.parse(localStorage.getItem('spineforge.sessions')!) as Session[];
    expect(sessions[0].config.inputFiles[0]).toBe('F:\\Drive\\Spine\\Heroes\\a.spine');
    expect(sessions[0].config.excludedFiles[0]).toBe('F:\\Drive\\Spine\\Heroes\\b.spine');

    const libs = JSON.parse(localStorage.getItem('spineforge.libraries')!) as Library[];
    expect(libs[0].rootPath).toBe('F:\\Drive\\Spine');

    const appConfig = JSON.parse(localStorage.getItem('spineforge.appConfig')!);
    expect(appConfig.spinePath).toBe('D:\\MachineB\\Spine.com'); // local value kept, not synced
    expect(appConfig.parallelJobs).toBe(6); // synced value applied
  });

  it('sameProfileBody ignores updatedAt', () => {
    const a = buildProfile(data, 'G:\\GDrive\\Spine', 1000);
    const b = buildProfile(data, 'G:\\GDrive\\Spine', 9999);
    expect(sameProfileBody(a, b)).toBe(true);
  });
});
