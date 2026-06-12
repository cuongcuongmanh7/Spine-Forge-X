import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { AppConfig, LinkedProject, SessionConfig } from './config';
import type { Translations } from './i18n';
import { detectTypesFromFiles } from './controllerHelpers';
import { makeId } from './sessions';

type Options = {
  appConfig: AppConfig;
  setAppConfig: React.Dispatch<React.SetStateAction<AppConfig>>;
  /** Input files of the active session — used to auto-pick its linked Type. */
  files: string[];
  sessionConfig: SessionConfig;
  activeSessionId: string | null;
  updateSessionConfig: <K extends keyof SessionConfig>(key: K, value: SessionConfig[K]) => void;
  t: Translations;
  appendLog: (text: string) => void;
};

/**
 * Linked Projects (Unity links, shared across sessions via appConfig): CRUD on the link list
 * plus auto-detecting a session's single Type from its input-file paths. Extracted from
 * useAppController; the controller spreads the returned API into its context.
 */
export function useLinkedProjects({
  appConfig,
  setAppConfig,
  files,
  sessionConfig,
  activeSessionId,
  updateSessionConfig,
  t,
  appendLog
}: Options) {
  // Warning shown at the Output step when input files don't all map to one linked Type.
  const [linkedTypeWarning, setLinkedTypeWarning] = useState('');

  function addLinkedProject(): string {
    const id = makeId();
    const project: LinkedProject = { id, name: '', unityRoot: '', sourceRoot: '', types: [] };
    setAppConfig((current) => ({ ...current, linkedProjects: [...current.linkedProjects, project] }));
    return id;
  }

  function updateLinkedProject(id: string, patch: Partial<LinkedProject>) {
    setAppConfig((current) => ({
      ...current,
      linkedProjects: current.linkedProjects.map((p) => (p.id === id ? { ...p, ...patch } : p))
    }));
  }

  function deleteLinkedProject(id: string) {
    setAppConfig((current) => ({ ...current, linkedProjects: current.linkedProjects.filter((p) => p.id !== id) }));
    // Sessions still pointing at this link fall back to "no selection" (validation flags them).
  }

  /** Auto-pick the session's linked Type from the input files' paths; warn if files span types. */
  function autoDetectLinkedType() {
    if (!activeSessionId) return;
    const project = appConfig.linkedProjects.find((p) => p.id === sessionConfig.linkedProjectId);
    if (!project || project.types.length === 0) {
      setLinkedTypeWarning('');
      return;
    }
    const { counts, unmatched } = detectTypesFromFiles(files, project);
    if (counts.size === 0) {
      setLinkedTypeWarning(t.linkedTypeNoMatch);
      return;
    }
    // Pick the most-matched type.
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    if (sessionConfig.linkedTypeName !== best) updateSessionConfig('linkedTypeName', best);
    if (counts.size > 1 || unmatched > 0) {
      const names = [...counts.keys()].join(', ');
      setLinkedTypeWarning(t.linkedTypeMismatch.replace('{types}', names).replace('{best}', best));
    } else {
      setLinkedTypeWarning('');
    }
  }

  /** List immediate subfolders of a path (for "Auto-fill from Unity root"). Returns [] on error. */
  async function listSubdirectories(path: string): Promise<string[]> {
    if (!path.trim()) return [];
    try {
      return await invoke<string[]>('list_subdirectories', { path });
    } catch (error) {
      appendLog(`${t.linkedAutoFillFailed}: ${String(error)}`);
      return [];
    }
  }

  return {
    linkedProjects: appConfig.linkedProjects,
    addLinkedProject,
    updateLinkedProject,
    deleteLinkedProject,
    autoDetectLinkedType,
    listSubdirectories,
    linkedTypeWarning
  };
}
