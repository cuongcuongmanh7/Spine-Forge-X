import { useEffect, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import { useApp } from '../useAppController';
import type { FolderScan, ImageEntry } from '../types';

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Load `paths` to data URLs with a small concurrency cap; reports each result as it lands. */
async function loadThumbs(
  paths: string[],
  read: (path: string) => Promise<string | null>,
  onLoaded: (path: string, url: string | null) => void,
  shouldStop: () => boolean
) {
  const queue = [...paths];
  const workers = Array.from({ length: Math.min(8, queue.length) }, async () => {
    while (queue.length) {
      if (shouldStop()) return;
      const path = queue.shift()!;
      const url = await read(path);
      if (shouldStop()) return;
      onLoaded(path, url);
    }
  });
  await Promise.all(workers);
}

function Thumb({ entry, url }: { entry: ImageEntry; url: string | null | undefined }) {
  const name = entry.relativePath.split('/').pop() || entry.relativePath;
  return (
    <div className="thumb-card" title={`${entry.relativePath} (${formatBytes(entry.sizeBytes)})`}>
      <div className="thumb-img">
        {url ? <img src={url} alt={name} loading="lazy" /> : <span className="empty-thumb" />}
      </div>
      <span className="thumb-name">{name}</span>
    </div>
  );
}

export function CleanFolderDetailModal({
  units,
  index,
  onIndexChange,
  onClose
}: {
  units: FolderScan[];
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
}) {
  const { t, readImageDataUrl } = useApp();
  // Thumbnail cache keyed by absolute path — kept across folder navigation.
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const cancelledRef = useRef(false);

  const unit = units[index];
  const folderName = unit.folder.replace(/\\/g, '/').split('/').pop() || unit.folder;

  // Load the current folder's not-yet-cached thumbnails when the folder changes.
  useEffect(() => {
    cancelledRef.current = false;
    const paths = [...unit.unused, ...unit.usedImages]
      .map((e) => e.absolutePath)
      .filter((p) => !(p in thumbs));
    if (paths.length) {
      void loadThumbs(
        paths,
        readImageDataUrl,
        (path, url) => setThumbs((current) => ({ ...current, [path]: url })),
        () => cancelledRef.current
      );
    }
    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal linked-modal clean-source-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="detail-title">
            <h2 title={unit.folder}>{folderName}</h2>
            <span className="stat-chip unused">
              {t.cleanSourceColUnused} ({unit.unused.length})
            </span>
            <span className="stat-chip used">
              {t.cleanSourceColUsed} ({unit.usedImages.length})
            </span>
          </div>
          <button className="modal-close" title={t.cancel} aria-label={t.cancel} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {unit.error && (
            <div className="notice warning" role="status">
              <AlertTriangle size={18} />
              <span>{unit.error}</span>
            </div>
          )}

          <section className="thumb-section">
            <h3 className="thumb-section-title unused">
              {t.cleanSourceColUnused} ({unit.unused.length})
            </h3>
            {unit.unused.length === 0 ? (
              <p className="helper-text">{t.cleanSourceNoUnused}</p>
            ) : (
              <div className="thumb-grid">
                {unit.unused.map((entry) => (
                  <Thumb key={entry.absolutePath} entry={entry} url={thumbs[entry.absolutePath]} />
                ))}
              </div>
            )}
          </section>

          <section className="thumb-section">
            <h3 className="thumb-section-title used">
              {t.cleanSourceColUsed} ({unit.usedImages.length})
            </h3>
            <div className="thumb-grid">
              {unit.usedImages.map((entry) => (
                <Thumb key={entry.absolutePath} entry={entry} url={thumbs[entry.absolutePath]} />
              ))}
            </div>
          </section>
        </div>

        <div className="modal-footer">
          <button className="secondary-button" disabled={index <= 0} onClick={() => onIndexChange(index - 1)}>
            <ChevronLeft size={16} /> {t.cleanSourcePrev}
          </button>
          <button
            className="secondary-button"
            disabled={index >= units.length - 1}
            onClick={() => onIndexChange(index + 1)}
          >
            {t.cleanSourceNext} <ChevronRight size={16} />
          </button>
          <span className="footer-counter">
            {index + 1}/{units.length}
          </span>
          <span className="footer-spacer" />
          <button className="primary-button" onClick={onClose}>
            {t.done}
          </button>
        </div>
      </div>
    </div>
  );
}
