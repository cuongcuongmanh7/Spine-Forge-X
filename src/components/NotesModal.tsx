import { useLayoutEffect, useRef, useState } from 'react';
import { CheckCircle2, MessageSquare, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import type { LibraryNote } from '../library';
import type { Translations } from '../i18n';
import { continueList } from '../listContinuation';

/**
 * Notes/comments for one Library target (a file or a folder). Standard modal per
 * docs/ui-design-rules.md §1: backdrop click-to-close, scrollable body, footer carries its own
 * padding. Resolved notes are dimmed and hidden unless `showResolved`. Delete only shows when the
 * caller's `canDelete` allows it (author or leader).
 */
export function NotesModal({
  t,
  targetLabel,
  notes,
  showResolved,
  onToggleShowResolved,
  onAdd,
  onToggleResolved,
  onDelete,
  canDelete,
  onClose
}: {
  t: Translations;
  targetLabel: string;
  notes: LibraryNote[];
  showResolved: boolean;
  onToggleShowResolved: () => void;
  onAdd: (text: string) => void;
  onToggleResolved: (id: string) => void;
  onDelete: (id: string) => void;
  canDelete: (note: LibraryNote) => boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // True only when a mouse press *started* on the backdrop itself — so releasing a drag (e.g.
  // resizing the textarea) outside the modal doesn't count as a backdrop click and close it.
  const pressedBackdrop = useRef(false);
  // Caret to restore after a controlled value edit (list continuation), applied post-render.
  const pendingCaret = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (pendingCaret.current !== null && inputRef.current) {
      inputRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  });

  const unresolved = notes.reduce((n, note) => n + (note.resolved ? 0 : 1), 0);
  const visible = notes.filter((n) => showResolved || !n.resolved);
  // Newest first so the latest comment is what you read on open.
  const ordered = [...visible].sort((a, b) => b.createdAt - a.createdAt);

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onAdd(text);
    setDraft('');
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedBackdrop.current && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal notes-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            <MessageSquare size={16} /> {t.notesFor.replace('{name}', targetLabel)}
            {unresolved > 0 && <span className="notes-badge">{unresolved}</span>}
          </h2>
          <button
            type="button"
            className={`icon-button notes-resolved-toggle${showResolved ? ' active' : ''}`}
            title={t.notesShowResolved}
            aria-label={t.notesShowResolved}
            aria-pressed={showResolved}
            onClick={onToggleShowResolved}
          >
            <CheckCircle2 size={16} />
          </button>
          <button className="modal-close" title={t.cancel} aria-label={t.cancel} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body notes-body">
          {ordered.length === 0 ? (
            <p className="helper-text">{t.notesEmpty}</p>
          ) : (
            <ul className="notes-list">
              {ordered.map((note) => (
                <li key={note.id} className={`note-item${note.resolved ? ' resolved' : ''}`}>
                  <div className="note-text">{note.text}</div>
                  <div className="note-meta">
                    <span className="muted">
                      {t.notesBy.replace('{author}', note.authorEmail || '—')} · {new Date(note.createdAt).toLocaleString()}
                    </span>
                    <span className="note-actions">
                      <button
                        className="icon-button"
                        onClick={() => onToggleResolved(note.id)}
                        title={note.resolved ? t.notesUnresolve : t.notesResolve}
                        aria-label={note.resolved ? t.notesUnresolve : t.notesResolve}
                      >
                        {note.resolved ? <RotateCcw size={15} /> : <CheckCircle2 size={15} />}
                      </button>
                      {canDelete(note) && (
                        <button
                          className="icon-button danger"
                          onClick={() => onDelete(note.id)}
                          title={t.notesDelete}
                          aria-label={t.notesDelete}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="modal-footer notes-footer">
          <textarea
            ref={inputRef}
            className="notes-input"
            value={draft}
            placeholder={t.notesPlaceholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Ctrl/Cmd+Enter submits without closing — quick repeated notes.
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                submit();
                return;
              }
              // Plain Enter continues an ordered/unordered list the caret is on (Shift+Enter is a
              // normal newline; a non-list line also falls through to the default newline).
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                const el = e.currentTarget;
                if (el.selectionStart !== el.selectionEnd) return;
                const next = continueList(el.value, el.selectionStart);
                if (!next) return;
                e.preventDefault();
                pendingCaret.current = next.caret;
                setDraft(next.value);
              }
            }}
            rows={2}
          />
          <button className="primary-button" onClick={submit} disabled={!draft.trim()}>
            <Plus size={16} /> {t.notesAdd}
          </button>
        </div>
      </div>
    </div>
  );
}
