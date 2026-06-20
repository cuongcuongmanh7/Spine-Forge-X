import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ExportAssets, LibraryEntry } from './config';
import { type DisposablePlayer, basename, buildRawDataURIs, loadSpine38, loadSpine4 } from './spineRuntime';

/**
 * Live skeleton preview for a Library unit's exported skeleton, rendered with the
 * official Spine web player. Resolves the export file set via `list_export_assets`,
 * feeds the bytes to the player as `rawDataURIs` (no network), and picks the runtime
 * by detected version (see {@link import('./spineRuntime')} for the shared loaders).
 */

export type PreviewStatus = 'loading' | 'ready' | 'error';

export function useSpinePreview(entry: LibraryEntry | null, containerRef: React.RefObject<HTMLDivElement>) {
  const [status, setStatus] = useState<PreviewStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [assets, setAssets] = useState<ExportAssets | null>(null);
  const playerRef = useRef<DisposablePlayer | null>(null);

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    setStatus('loading');
    setError(null);
    setAssets(null);

    const fail = (msg: string) => {
      if (cancelled) return;
      setError(msg);
      setStatus('error');
    };

    (async () => {
      let resolved: ExportAssets;
      try {
        resolved = await invoke<ExportAssets>('list_export_assets', { folder: entry.folder });
      } catch (e) {
        fail(String(e));
        return;
      }
      if (cancelled) return;
      setAssets(resolved);

      let rawDataURIs: Record<string, string>;
      try {
        rawDataURIs = await buildRawDataURIs(resolved);
      } catch (e) {
        fail(String(e));
        return;
      }
      if (cancelled) return;

      const container = containerRef.current;
      if (!container) return;

      const skelName = basename(resolved.skeletonPath);
      const atlasName = basename(resolved.atlasPath);
      const onSuccess = () => {
        if (!cancelled) setStatus('ready');
      };
      const onError = (_p: unknown, msg: string) => fail(msg);

      try {
        if (resolved.version === '3.8') {
          const spine = await loadSpine38();
          if (cancelled) return;
          const cfg: Record<string, unknown> = {
            atlasUrl: atlasName,
            rawDataURIs,
            showControls: true,
            alpha: true,
            backgroundColor: '#00000000',
            success: onSuccess,
            error: onError,
          };
          cfg[resolved.skeletonFormat === 'json' ? 'jsonUrl' : 'skelUrl'] = skelName;
          playerRef.current = new spine.SpinePlayer(container, cfg);
        } else {
          const { SpinePlayer } = await loadSpine4();
          if (cancelled) return;
          playerRef.current = new SpinePlayer(container, {
            skeleton: skelName,
            atlas: atlasName,
            rawDataURIs,
            showControls: true,
            alpha: true,
            preserveDrawingBuffer: false,
            backgroundColor: '#00000000',
            success: onSuccess,
            error: onError,
          });
        }
      } catch (e) {
        fail(String(e));
      }
    })();

    return () => {
      cancelled = true;
      try {
        playerRef.current?.dispose();
      } catch {
        /* player may not have finished initializing */
      }
      playerRef.current = null;
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry]);

  return { status, error, assets };
}
