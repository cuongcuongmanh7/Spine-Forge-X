import { useEffect, useState } from 'react';

export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 420;
export const SIDEBAR_DEFAULT = 240;
const SIDEBAR_KEY = 'spineforge.sidebarWidth';

export function clampWidth(value: number): number {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, value));
}

function readSidebarWidth(): number {
  const raw = Number(localStorage.getItem(SIDEBAR_KEY));
  return Number.isFinite(raw) && raw > 0 ? clampWidth(raw) : SIDEBAR_DEFAULT;
}

/**
 * Shared resizable sidebar width, persisted to one localStorage key so the Workspace and
 * Library sidebars stay the same width (only one mode is mounted at a time; each reads the
 * persisted value on mount). Returns the width plus a pointer-drag resize handler.
 */
export function useSidebarWidth() {
  const [width, setWidth] = useState(readSidebarWidth);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, String(width));
  }, [width]);

  function startResize(event: React.PointerEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startW = width;
    document.body.classList.add('col-resizing');
    const onMove = (e: PointerEvent) => setWidth(clampWidth(startW + (e.clientX - startX)));
    const onUp = () => {
      document.body.classList.remove('col-resizing');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  return { width, setWidth, startResize };
}
