import { Eye } from 'lucide-react';
import type { LibraryEntry } from '../config';
import type { Translations } from '../i18n';

/**
 * Per-row Preview cell: an icon button that opens the live skeleton preview modal
 * (only for exported units). Split out of LibraryInventory to keep that component
 * under the line-size guard.
 */
export function LibraryPreviewCell({
  entry,
  onPreview,
  t
}: {
  entry: LibraryEntry;
  onPreview: (entry: LibraryEntry) => void;
  t: Translations;
}) {
  return (
    <td className="library-preview-cell">
      {entry.exported && (
        <button
          className="icon-button library-preview-btn"
          onClick={() => onPreview(entry)}
          title={t.libraryPreview}
          aria-label={t.libraryPreview}
        >
          <Eye size={15} />
        </button>
      )}
    </td>
  );
}
