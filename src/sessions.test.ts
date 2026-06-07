import { describe, expect, it } from 'vitest';
import { loadPersistedState } from './sessions';

const KEYS = {
  appConfig: 'spineforge.appConfig',
  projects: 'spineforge.projects',
  sessions: 'spineforge.sessions',
  activeId: 'spineforge.activeSessionId',
  activeProjectId: 'spineforge.activeProjectId',
  legacySettings: 'spineforge.settings'
};

describe('loadPersistedState — Property 2: persist/restore round-trip', () => {
  it('Case A (new format): preserves session id/name/config and migrates hidden values', () => {
    localStorage.setItem(KEYS.projects, JSON.stringify([{ id: 'p1', name: 'Proj A', autoNamed: false }]));
    localStorage.setItem(
      KEYS.sessions,
      JSON.stringify([
        {
          id: 's1',
          projectId: 'p1',
          name: 'My Session',
          config: {
            inputPath: 'C:/in',
            globalJsonPath: 'C:/preset.export.json',
            // hidden/legacy values that must be migrated:
            outputPolicy: 'timestamp',
            exportMode: 'builtIn',
            targetVersion: '4.3.xx'
          }
        }
      ])
    );
    localStorage.setItem(KEYS.activeId, 's1');

    const state = loadPersistedState();

    expect(state.projects).toHaveLength(1);
    expect(state.sessions).toHaveLength(1);
    const s = state.sessions[0];
    expect(s.id).toBe('s1');
    expect(s.projectId).toBe('p1');
    expect(s.name).toBe('My Session');
    expect(s.config.inputPath).toBe('C:/in');
    expect(s.config.globalJsonPath).toBe('C:/preset.export.json');
    // timestamp policy is hidden → migrated to sourceFolderName
    expect(s.config.outputPolicy).toBe('sourceFolderName');
    // only the global-preset flow is supported → exportMode forced
    expect(s.config.exportMode).toBe('globalJson');
    // patch-agnostic version normalized
    expect(s.config.targetVersion).toBe('4.3.XX');
    expect(state.activeSessionId).toBe('s1');
    expect(state.activeProjectId).toBe('p1');
  });

  it('Case A: reparents a session whose project no longer exists', () => {
    localStorage.setItem(KEYS.projects, JSON.stringify([{ id: 'p1', name: 'Proj' }]));
    localStorage.setItem(
      KEYS.sessions,
      JSON.stringify([{ id: 's1', projectId: 'ghost', name: 'Orphan', config: {} }])
    );

    const state = loadPersistedState();
    expect(state.sessions[0].projectId).toBe('p1');
  });

  it('Case B (flat sessions, no projects): wraps all sessions into one default project', () => {
    localStorage.setItem(
      KEYS.sessions,
      JSON.stringify([
        { id: 's1', name: 'One', config: {} },
        { id: 's2', name: 'Two', config: {} }
      ])
    );

    const state = loadPersistedState();
    expect(state.projects).toHaveLength(1);
    const home = state.projects[0].id;
    expect(state.sessions.map((s) => s.projectId)).toEqual([home, home]);
    expect(state.activeProjectId).toBe(home);
  });

  it('Case C (legacy single-session settings): migrates into a default project + session', () => {
    localStorage.setItem(
      KEYS.legacySettings,
      JSON.stringify({ inputPath: 'C:/Assets/Hero', globalJsonPath: 'C:/p.export.json', spinePath: 'C:/Spine.com' })
    );

    const state = loadPersistedState();
    expect(state.projects).toHaveLength(1);
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].config.inputPath).toBe('C:/Assets/Hero');
    // session name derived from the input folder basename
    expect(state.sessions[0].name).toBe('Hero');
    expect(state.appConfig.spinePath).toBe('C:/Spine.com');
    expect(state.activeSessionId).toBe(state.sessions[0].id);
  });

  it('Case D (nothing stored): returns empty projects/sessions', () => {
    const state = loadPersistedState();
    expect(state.projects).toEqual([]);
    expect(state.sessions).toEqual([]);
    expect(state.activeSessionId).toBeNull();
    expect(state.activeProjectId).toBeNull();
  });

  it('drops unknown config keys (sanitizeConfig/pickKnown) and defaults inputFiles to an array', () => {
    localStorage.setItem(KEYS.projects, JSON.stringify([{ id: 'p1', name: 'P' }]));
    localStorage.setItem(
      KEYS.sessions,
      JSON.stringify([{ id: 's1', projectId: 'p1', name: 'S', config: { bogusKey: 'x', inputFiles: 'not-an-array' } }])
    );

    const state = loadPersistedState();
    const cfg = state.sessions[0].config as Record<string, unknown>;
    expect('bogusKey' in cfg).toBe(false);
    expect(Array.isArray(state.sessions[0].config.inputFiles)).toBe(true);
  });
});
