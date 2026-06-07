import { useState } from 'react';
import { FolderOpen, Plus, Trash2, Wand2, X } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { useApp } from '../useAppController';
import type { LinkedType } from '../config';

export function LinkedProjectModal() {
  const {
    t,
    linkedProjects,
    addLinkedProject,
    updateLinkedProject,
    deleteLinkedProject,
    listSubdirectories,
    setLinkedModalOpen
  } = useApp();

  // Master–detail: a scrollable list on the left, the selected project's editor on the right.
  const [selectedId, setSelectedId] = useState<string | null>(linkedProjects[0]?.id ?? null);
  const selected = linkedProjects.find((p) => p.id === selectedId) ?? null;

  function close() {
    setLinkedModalOpen(false);
  }

  function addProject() {
    setSelectedId(addLinkedProject());
  }

  function removeProject(id: string) {
    deleteLinkedProject(id);
    if (selectedId === id) {
      const remaining = linkedProjects.filter((p) => p.id !== id);
      setSelectedId(remaining[0]?.id ?? null);
    }
  }

  async function browse(id: string, key: 'unityRoot' | 'sourceRoot', current: string) {
    const picked = await open({ directory: true, multiple: false, defaultPath: current.trim() || undefined });
    if (typeof picked === 'string') updateLinkedProject(id, { [key]: picked });
  }

  function setType(id: string, types: LinkedType[], index: number, patch: Partial<LinkedType>) {
    updateLinkedProject(id, { types: types.map((ty, i) => (i === index ? { ...ty, ...patch } : ty)) });
  }

  function addType(id: string, types: LinkedType[]) {
    updateLinkedProject(id, { types: [...types, { sourceName: '', destName: '' }] });
  }

  function removeType(id: string, types: LinkedType[], index: number) {
    updateLinkedProject(id, { types: types.filter((_, i) => i !== index) });
  }

  async function autoFill(id: string, unityRoot: string, types: LinkedType[]) {
    const subdirs = await listSubdirectories(unityRoot);
    if (subdirs.length === 0) return;
    const byName = new Map(types.map((ty) => [ty.destName, ty]));
    // Keep any existing source→dest override whose dest matches a folder; add the rest as identity maps.
    const merged: LinkedType[] = subdirs.map((dir) => byName.get(dir) ?? { sourceName: dir, destName: dir });
    updateLinkedProject(id, { types: merged });
  }

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal linked-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t.linkedModalTitle}</h2>
          <button className="modal-close" title={t.cancel} aria-label={t.cancel} onClick={close}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body linked-body">
          <div className="linked-list">
            {linkedProjects.length === 0 && <p className="linked-list-empty">{t.linkedNoProjects}</p>}
            {linkedProjects.map((p) => {
              const label = p.name.trim() || t.linkedUntitled;
              return (
                <button
                  key={p.id}
                  className={`linked-list-item${p.id === selectedId ? ' selected' : ''}`}
                  onClick={() => setSelectedId(p.id)}
                >
                  <span className="linked-list-name">{label}</span>
                  <span className="linked-list-meta">{p.types.length}</span>
                  <span
                    className="linked-list-del"
                    role="button"
                    title={t.linkedDeleteProject}
                    aria-label={t.linkedDeleteProject}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeProject(p.id);
                    }}
                  >
                    <Trash2 size={14} />
                  </span>
                </button>
              );
            })}
          </div>

          <div className="linked-detail">
            {!selected ? (
              <p className="helper-text">{t.linkedSelectHint}</p>
            ) : (
              <>
                <div className="form-row">
                  <label>{t.linkedName}</label>
                  <input value={selected.name} onChange={(e) => updateLinkedProject(selected.id, { name: e.target.value })} placeholder="FD" />
                </div>
                <div className="form-row">
                  <label>{t.unityRoot}</label>
                  <input value={selected.unityRoot} onChange={(e) => updateLinkedProject(selected.id, { unityRoot: e.target.value })} placeholder="…/Animations/Spine" />
                  <button className="icon-button" title={t.unityRoot} aria-label={t.unityRoot} onClick={() => browse(selected.id, 'unityRoot', selected.unityRoot)}>
                    <FolderOpen size={18} />
                  </button>
                </div>
                <div className="form-row">
                  <label>{t.sourceRoot}</label>
                  <input value={selected.sourceRoot} onChange={(e) => updateLinkedProject(selected.id, { sourceRoot: e.target.value })} placeholder="[FD] Animation" />
                  <button className="icon-button" title={t.sourceRoot} aria-label={t.sourceRoot} onClick={() => browse(selected.id, 'sourceRoot', selected.sourceRoot)}>
                    <FolderOpen size={18} />
                  </button>
                </div>

                <div className="linked-types">
                  <div className="linked-types-header">
                    <strong>{t.linkedTypes}</strong>
                    <button className="secondary-button small" disabled={!selected.unityRoot.trim()} onClick={() => autoFill(selected.id, selected.unityRoot, selected.types)}>
                      <Wand2 size={14} /> {t.autoFillFromUnityRoot}
                    </button>
                  </div>
                  <div className="linked-type-list">
                    {selected.types.map((ty, i) => (
                      <div className="linked-type-row" key={i}>
                        <input
                          value={ty.sourceName}
                          placeholder={t.linkedSourceName}
                          onChange={(e) => setType(selected.id, selected.types, i, { sourceName: e.target.value })}
                        />
                        <span className="linked-arrow">→</span>
                        <input
                          value={ty.destName}
                          placeholder={t.linkedDestName}
                          onChange={(e) => setType(selected.id, selected.types, i, { destName: e.target.value })}
                        />
                        <button className="icon-button danger" title={t.remove} aria-label={t.remove} onClick={() => removeType(selected.id, selected.types, i)}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button className="secondary-button small" onClick={() => addType(selected.id, selected.types)}>
                    <Plus size={14} /> {t.linkedAddType}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="secondary-button" onClick={addProject}>
            <Plus size={16} /> {t.linkedAddProject}
          </button>
          <button className="primary-button" onClick={close}>
            {t.done}
          </button>
        </div>
      </div>
    </div>
  );
}
