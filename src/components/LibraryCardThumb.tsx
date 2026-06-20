import { useEffect, useRef, useState } from 'react';
import { useSpineThumbnail } from '../useSpineThumbnail';
import type { LibraryEntry } from '../config';
import { SpineFileIcon } from './SpineFileIcon';

/**
 * Grid-card thumbnail slot. Renders a real skeleton preview ({@link useSpineThumbnail}) but
 * only once the card scrolls into view (IntersectionObserver) and only for exported units —
 * so a long inventory doesn't kick off hundreds of off-screen WebGL renders at mount. Falls
 * back to the static file icon while loading, on error, or for non-exported units.
 */
export function LibraryCardThumb({ entry }: { entry: LibraryEntry }) {
  const ref = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (enabled) return; // latch: once triggered, keep rendering
    const el = ref.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        if (visible) {
          // Only trigger once the card has lingered in view — scrolling straight past it
          // never starts a render.
          timer = setTimeout(() => {
            setEnabled(true);
            obs.disconnect();
          }, 150);
        } else if (timer) {
          clearTimeout(timer);
          timer = undefined;
        }
      },
      { rootMargin: '120px' }
    );
    obs.observe(el);
    return () => {
      if (timer) clearTimeout(timer);
      obs.disconnect();
    };
  }, [enabled]);

  const { status, dataUrl } = useSpineThumbnail(entry, enabled);

  const cls =
    status === 'ready' ? ' has-image' : status === 'loading' ? ' is-loading' : '';
  return (
    <div ref={ref} className={`library-card-thumb${cls}`} aria-hidden="true">
      {status === 'ready' && dataUrl ? (
        <img className="library-card-thumb-img" src={dataUrl} alt="" loading="lazy" />
      ) : (
        <SpineFileIcon size={20} />
      )}
    </div>
  );
}
