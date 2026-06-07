import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useApp } from '../useAppController';

export function NameSessionModal() {
  const { t, confirmNewSession, setSessionDialogOpen } = useApp();
  const [draft, setDraft] = useState(t.newSession);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.select());
  }, []);

  function close() {
    setSessionDialogOpen(false);
  }

  function save() {
    confirmNewSession(draft);
  }

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal name-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2>{t.nameSessionTitle}</h2>
          <button className="modal-close" title={t.cancel} aria-label={t.cancel} onClick={close}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <p className="name-dialog-hint">{t.nameSessionHint}</p>
          <input
            ref={inputRef}
            className="name-dialog-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') save();
              if (event.key === 'Escape') close();
            }}
          />
          <div className="modal-footer">
            <button className="secondary-button" onClick={close}>{t.cancel}</button>
            <button className="primary-button" disabled={!draft.trim()} onClick={save}>{t.save}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
