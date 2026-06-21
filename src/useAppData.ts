import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

/**
 * Resolves the team's shared app-data root on this machine — `<drive>:\Shared drives\Pamvis\
 * spine_app_data` — by probing for the Pamvis shared-drive mount (the drive letter varies per
 * machine). This is the default home for shared/derived data (thumbnails today; future caches can
 * point here too). When the Pamvis drive isn't mounted, `appDataDir` is null and the UI warns.
 */
export type AppDataState = {
  /** Absolute `…\spine_app_data` path, or null when the Pamvis drive isn't visible on this machine. */
  appDataDir: string | null;
  /** False until the first probe finishes (avoids flashing the warning on startup). */
  appDataResolved: boolean;
  /** True once we've probed and the shared folder is unreachable. */
  appDataMissing: boolean;
};

export function useAppData(): AppDataState {
  const [appDataDir, setDir] = useState<string | null>(null);
  const [appDataResolved, setResolved] = useState(false);

  useEffect(() => {
    let active = true;
    invoke<string | null>('resolve_app_data_dir')
      .then((d) => {
        if (active) setDir(d ?? null);
      })
      .catch(() => {
        if (active) setDir(null);
      })
      .finally(() => {
        if (active) setResolved(true);
      });
    return () => {
      active = false;
    };
  }, []);

  return { appDataDir, appDataResolved, appDataMissing: appDataResolved && !appDataDir };
}
