import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Renders a dropdown in a body portal, fixed-positioned under (or above) its anchor. This escapes
 *  the scroll container's `overflow` clipping so the menu floats over the rest of the app — including
 *  the bottom bar — instead of being cut off on the last rows. Shared by the row "⋯" menu and the
 *  collapsed-filter chip-overflow popup; pass `className` to skin it per use. */
export function MenuPopover({
  anchor,
  onClose,
  className = 'session-menu library-row-menu library-row-menu--portal',
  children
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const menu = menuRef.current;
      const mw = menu?.offsetWidth ?? 168;
      const mh = menu?.offsetHeight ?? 0;
      const gap = 4;
      const margin = 8;
      // Default below the trigger; flip above if it would overflow the viewport bottom.
      let top = a.bottom + gap;
      if (mh && top + mh > window.innerHeight - margin) {
        top = Math.max(margin, a.top - gap - mh);
      }
      // Right-align to the trigger, clamped to the viewport.
      let left = a.right - mw;
      left = Math.min(Math.max(margin, left), window.innerWidth - mw - margin);
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor]);

  return createPortal(
    <>
      <div
        className="menu-backdrop"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      />
      <div
        ref={menuRef}
        className={className}
        style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>,
    document.body
  );
}
