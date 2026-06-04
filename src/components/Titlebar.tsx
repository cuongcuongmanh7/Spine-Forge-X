import { Minus, RotateCw, Square, X } from 'lucide-react';
import appIconUrl from '../../src-tauri/icons/icon.ico';
import { appVersionLabel } from '../config';
import { useApp } from '../useAppController';

export function Titlebar() {
  const { updateUi, getAppWindow, checkForAppUpdate, installPendingUpdate } = useApp();

  return (
    <div className="custom-titlebar">
      <div
        className="titlebar-drag-zone"
        onMouseDown={() => void getAppWindow()?.startDragging()}
        onDoubleClick={() => void getAppWindow()?.toggleMaximize()}
      >
        <div className="titlebar-brand">
          <img className="titlebar-mark" src={appIconUrl} alt="" aria-hidden="true" />
          <span>SpineForge X</span>
          <span className="titlebar-version">{appVersionLabel}</span>
          <button
            className="titlebar-update-check"
            title="Check for update"
            disabled={updateUi.status === 'checking' || updateUi.status === 'downloading' || updateUi.status === 'ready'}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => void checkForAppUpdate(true)}
          >
            <RotateCw className={updateUi.status === 'checking' ? 'spin' : undefined} size={13} />
          </button>
          {updateUi.status === 'checking' && <span className="titlebar-update-note">Checking...</span>}
          {updateUi.status === 'upToDate' && <span className="titlebar-update-note">Up to date</span>}
          {updateUi.status === 'error' && (
            <span className="titlebar-update-note error" title={updateUi.message || 'Update failed'}>
              Update failed
            </span>
          )}
          {updateUi.status === 'downloading' && (
            <span className="titlebar-update" title={`Downloading new version (v${updateUi.version})`}>
              <span>Downloading new version (v{updateUi.version})</span>
              <progress value={updateUi.progressKnown ? updateUi.progress : undefined} max={100} />
              <span>{updateUi.progressKnown ? `${updateUi.progress}%` : '...'}</span>
            </span>
          )}
          {updateUi.status === 'ready' && (
            <button
              className="titlebar-update-button"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => void installPendingUpdate()}
            >
              Relaunch for v{updateUi.version}
            </button>
          )}
        </div>
      </div>
      <div className="titlebar-controls">
        <button title="Minimize" onClick={() => void getAppWindow()?.minimize()}>
          <Minus size={15} />
        </button>
        <button title="Maximize" onClick={() => void getAppWindow()?.toggleMaximize()}>
          <Square size={13} />
        </button>
        <button className="close" title="Close" onClick={() => void getAppWindow()?.close()}>
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
