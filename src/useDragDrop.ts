import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

export interface DragPoint {
  x: number;
  y: number;
}

export type DropZone = 'input' | 'output';

export interface DropHandlers {
  /** Drops are ignored entirely while false (e.g. mid-export). */
  enabled: boolean;
  /** Whether the output zone exists; false routes every drop to input. */
  outputDropEnabled: boolean;
  onInputFiles(spineFiles: string[]): void;
  onInputFolder(folder: string): void | Promise<void>;
  onOutputFolder(folder: string): void;
  onUnsupported(zone: DropZone): void;
}

/** True when `path` is an existing directory — `list_subdirectories` errs on anything else. */
async function isDirectory(path: string): Promise<boolean> {
  try {
    await invoke('list_subdirectories', { path });
    return true;
  } catch {
    return false;
  }
}

/** Which overlay zone a CSS-pixel point falls in; the right half targets output. */
export function dropZoneAt(position: DragPoint | null, outputDropEnabled: boolean): DropZone {
  if (!outputDropEnabled || !position) return 'input';
  return position.x >= window.innerWidth * 0.5 ? 'output' : 'input';
}

/**
 * OS file drag-drop (Tauri v2): tracks whether a drag is hovering the window (and where,
 * converted from physical to CSS pixels) and routes dropped absolute paths by zone:
 * on input, `.spine` files become a file selection and a single folder is scanned;
 * on output, a single folder becomes the output root. Handlers are kept in a ref so the
 * listener, subscribed once, always calls the latest closures without re-subscribing.
 */
export function useDragDrop(handlers: DropHandlers) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragPosition, setDragPosition] = useState<DragPoint | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const toCss = (p: { x: number; y: number }): DragPoint => ({
      x: p.x / window.devicePixelRatio,
      y: p.y / window.devicePixelRatio
    });
    // A single non-.spine path is only accepted as a folder if it really is a
    // directory on disk — a stray .png/.txt drop warns instead of silently
    // becoming the input or output path.
    const handleDrop = async (paths: string[], position: DragPoint) => {
      const h = handlersRef.current;
      if (!h.enabled || !paths.length) return;
      const zone = dropZoneAt(position, h.outputDropEnabled);
      if (zone === 'output') {
        if (paths.length === 1 && (await isDirectory(paths[0]))) h.onOutputFolder(paths[0]);
        else h.onUnsupported('output');
        return;
      }
      const spineFiles = paths.filter((p) => p.toLowerCase().endsWith('.spine'));
      if (spineFiles.length) h.onInputFiles(spineFiles);
      else if (paths.length === 1 && (await isDirectory(paths[0]))) void h.onInputFolder(paths[0]);
      else h.onUnsupported('input');
    };
    let unlisten: Promise<() => void> | null = null;
    try {
      unlisten = getCurrentWindow().onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === 'over' || payload.type === 'enter') {
          setIsDragOver(true);
          setDragPosition(toCss(payload.position));
        } else if (payload.type === 'leave') {
          setIsDragOver(false);
          setDragPosition(null);
        } else if (payload.type === 'drop') {
          setIsDragOver(false);
          setDragPosition(null);
          void handleDrop(payload.paths, toCss(payload.position));
        }
      });
    } catch (error) {
      console.warn('Drag-drop unavailable:', error);
    }
    return () => {
      unlisten?.then((fn) => fn()).catch(() => undefined);
    };
  }, []);

  return { isDragOver, dragPosition };
}
