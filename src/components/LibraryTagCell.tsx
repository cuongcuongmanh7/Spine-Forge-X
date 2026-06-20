import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { Translations } from '../i18n';

/** Editable tag chips for one library asset: shows the current tags with a remove (×) each, plus a
 *  "+" that reveals an inline input. Kept as its own component so LibraryInventory stays thin. */
export function LibraryTagCell({
  tags,
  onAdd,
  onRemove,
  t
}: {
  tags: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  t: Translations;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  function commit() {
    const value = draft.trim();
    if (value) onAdd(value);
    setDraft('');
    setAdding(false);
  }

  return (
    <span className="library-tag-cell">
      {tags.map((tag) => (
        <span className="library-tag-chip" key={tag}>
          {tag}
          <button
            type="button"
            className="library-tag-remove"
            title={t.libraryRemoveTag.replace('{tag}', tag)}
            aria-label={t.libraryRemoveTag.replace('{tag}', tag)}
            onClick={() => onRemove(tag)}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      {adding ? (
        <input
          className="library-tag-input"
          autoFocus
          value={draft}
          placeholder={t.libraryTagPlaceholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') {
              setDraft('');
              setAdding(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="library-tag-add"
          title={t.libraryAddTag}
          aria-label={t.libraryAddTag}
          onClick={() => setAdding(true)}
        >
          <Plus size={11} />
        </button>
      )}
    </span>
  );
}
