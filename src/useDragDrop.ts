import { useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * OS file drag-drop (Tauri v2): tracks whether a drag is hovering the window and forwards
 * dropped absolute paths to `onDropPaths`. The handler is kept in a ref so the listener,
 * subscribed once, always calls the latest closure (fresh state) without re-subscribing.
 */
export function useDragDrop(onDropPaths: (paths: string[]) => void | Promise<void>) {
  const [isDragOver, setIsDragOver] = useState(false);
  const handlerRef = useRef(onDropPaths);
  handlerRef.current = onDropPaths;

  useEffect(() => {
    let unlisten: Promise<() => void> | null = null;
    try {
      unlisten = getCurrentWindow().onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === 'over' || payload.type === 'enter') {
          setIsDragOver(true);
        } else if (payload.type === 'leave') {
          setIsDragOver(false);
        } else if (payload.type === 'drop') {
          setIsDragOver(false);
          void handlerRef.current(payload.paths);
        }
      });
    } catch (error) {
      console.warn('Drag-drop unavailable:', error);
    }
    return () => {
      unlisten?.then((fn) => fn()).catch(() => undefined);
    };
  }, []);

  return { isDragOver };
}
