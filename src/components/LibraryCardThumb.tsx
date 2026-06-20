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
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (inView) return; // latch: once seen, keep rendering
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          obs.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [inView]);

  const { status, dataUrl } = useSpineThumbnail(entry, inView);

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
