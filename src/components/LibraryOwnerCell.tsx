import { useState } from 'react';
import { Pencil } from 'lucide-react';
import type { Translations } from '../i18n';

/**
 * Owner column cell: a manually-assigned owner takes precedence (shown with an "edited" accent),
 * otherwise it falls back to the Drive owner/last-editor (Tier B). Click to edit inline; an empty
 * value clears the manual owner and reverts to the Drive value.
 */
export function LibraryOwnerCell({
  manualOwner,
  driveName,
  driveEmail,
  onSet,
  t
}: {
  manualOwner: string | undefined;
  driveName: string;
  driveEmail: string | undefined;
  onSet: (owner: string) => void;
  t: Translations;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  function startEdit() {
    setDraft(manualOwner ?? driveName ?? '');
    setEditing(true);
  }

  function commit() {
    onSet(draft.trim());
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        className="library-owner-input"
        autoFocus
        value={draft}
        placeholder={t.libraryOwnerPlaceholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }

  const display = manualOwner || driveName;
  return (
    <button
      type="button"
      className={`library-owner-value ${manualOwner ? 'manual' : ''}`}
      title={manualOwner ? t.librarySetOwner : (driveEmail ?? t.librarySetOwner)}
      onClick={startEdit}
    >
      {display ? <span>{display}</span> : <span className="muted">—</span>}
      <Pencil className="library-owner-edit" size={11} />
    </button>
  );
}
