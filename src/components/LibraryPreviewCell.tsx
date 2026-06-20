import { Eye } from 'lucide-react';
import type { LibraryEntry } from '../config';
import type { Translations } from '../i18n';

/**
 * Per-row Preview cell: an icon button that opens the live skeleton preview modal
 * (only for exported units). Split out of LibraryInventory to keep that component
 * under the line-size guard.
 */
type Props = { entry: LibraryEntry; onPreview: (entry: LibraryEntry) => void; t: Translations };

/** Just the Preview button (no cell wrapper) — reused by the table cell and the grid card. */
export function LibraryPreviewButton({ entry, onPreview, t }: Props) {
  if (!entry.exported) return null;
  return (
    <button
      className="icon-button library-preview-btn"
      onClick={() => onPreview(entry)}
      title={t.libraryPreview}
      aria-label={t.libraryPreview}
    >
      <Eye size={15} />
    </button>
  );
}

export function LibraryPreviewCell(props: Props) {
  return (
    <td className="library-preview-cell">
      <LibraryPreviewButton {...props} />
    </td>
  );
}
