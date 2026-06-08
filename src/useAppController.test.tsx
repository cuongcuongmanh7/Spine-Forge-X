import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAppControllerValue } from './useAppController';
import { invokeMock, emitTauriEvent } from './test-setup';

/**
 * Hook-level tests for useAppController (Properties 3, 4, 14). These render the
 * real controller in jsdom with `@tauri-apps/*` mocked (see test-setup.ts), so
 * they exercise the actual session/runtime/log-routing logic — not a reimplementation.
 */

/** Render the controller and flush its async mount effects (auto-detect, presets, …). */
async function renderController() {
  const view = renderHook(() => useAppControllerValue());
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

beforeEach(() => {
  localStorage.clear();
});

describe('useAppController — session runtime isolation (P3)', () => {
  it('keeps each session’s runtime (logs) when switching away and back', async () => {
    const { result } = await renderController();

    // Create project + session A (becomes active).
    await act(async () => {
      result.current.newProject('Proj');
    });
    const aId = result.current.activeSessionId!;
    expect(aId).toBeTruthy();

    // Give A some runtime.
    await act(async () => {
      result.current.setLogs(['A-log']);
    });
    expect(result.current.logs).toEqual(['A-log']);

    // Create session B → A's runtime is captured, B starts empty.
    let bId = '';
    await act(async () => {
      bId = result.current.newSession();
    });
    expect(result.current.activeSessionId).toBe(bId);
    expect(result.current.logs).toEqual([]);

    await act(async () => {
      result.current.setLogs(['B-log']);
    });

    // Switching back to A restores A's runtime, untouched by B.
    await act(async () => {
      result.current.selectSession(aId);
    });
    expect(result.current.activeSessionId).toBe(aId);
    expect(result.current.logs).toEqual(['A-log']);

    // And B still has its own.
    await act(async () => {
      result.current.selectSession(bId);
    });
    expect(result.current.logs).toEqual(['B-log']);
  });
});

describe('useAppController — delete project cascade (P4)', () => {
  it('removes the project and every child session', async () => {
    const { result } = await renderController();

    let projId = '';
    await act(async () => {
      projId = result.current.newProject('P');
    });
    // newProject seeds one session; add a second so we prove the cascade.
    await act(async () => {
      result.current.addSessionToProject(projId);
    });
    expect(result.current.sessions.filter((s) => s.projectId === projId)).toHaveLength(2);

    // confirm() is mocked to resolve true, so the delete proceeds.
    await act(async () => {
      await result.current.deleteProject(projId);
    });

    expect(result.current.projects.find((p) => p.id === projId)).toBeUndefined();
    expect(result.current.sessions.filter((s) => s.projectId === projId)).toEqual([]);
  });
});

describe('useAppController — log routing across session switch (P14)', () => {
  it('routes spine-log to the running session even after the user switches away', async () => {
    // Hold start_batch_export pending so the session stays "running" while we switch.
    let resolveExport!: (value: unknown) => void;
    invokeMock.mockImplementation((command: string) => {
      switch (command) {
        case 'start_batch_export':
          return new Promise((resolve) => {
            resolveExport = resolve;
          });
        case 'scan_spine_files':
          return Promise.resolve({ files: ['D:/in/a.spine'], skipped: [] });
        case 'validate_settings':
          return Promise.resolve({ ok: true, warnings: [], errors: [] });
        case 'check_output_collisions':
          return Promise.resolve([]);
        case 'list_export_presets':
        case 'list_subdirectories':
          return Promise.resolve([]);
        default:
          return Promise.resolve(undefined);
      }
    });

    const { result } = await renderController();

    // Project with two sessions A and B.
    let projId = '';
    await act(async () => {
      projId = result.current.newProject('P');
    });
    const aId = result.current.activeSessionId!;
    let bId = '';
    await act(async () => {
      bId = result.current.addSessionToProject(projId);
    });

    // Configure + scan session A so it can start.
    await act(async () => {
      result.current.selectSession(aId);
    });
    await act(async () => {
      result.current.updateSetting('inputPath', 'D:/in');
      result.current.updateSetting('globalJsonPath', 'D:/p.export.json');
    });
    await act(async () => {
      await result.current.scanInput();
    });
    await waitFor(() => expect(result.current.canStart).toBe(true));

    // Start export on A (stays pending).
    let startPromise: Promise<void> | undefined;
    await act(async () => {
      startPromise = result.current.startExport();
    });
    expect(result.current.runningSessionId).toBe(aId);

    // Switch to B while A is still running.
    await act(async () => {
      result.current.selectSession(bId);
    });
    expect(result.current.activeSessionId).toBe(bId);

    // A backend log arrives → must NOT land in B's visible logs.
    await act(async () => {
      emitTauriEvent('spine-log', 'hello-from-A');
    });
    expect(result.current.logs.join('\n')).not.toContain('hello-from-A');

    // Switching back to A reveals the routed log.
    await act(async () => {
      result.current.selectSession(aId);
    });
    expect(result.current.logs.join('\n')).toContain('hello-from-A');

    // Let the export finish cleanly.
    await act(async () => {
      resolveExport({ completed: 1, failed: 0, skipped: 0, total: 1, outputFolders: [], stopped: false });
      await startPromise;
    });
    expect(result.current.runningSessionId).toBeNull();
  });
});
