import { useEffect, useMemo, useState } from 'react';

/**
 * useState whose value is mirrored into localStorage, so it survives component unmounts
 * (e.g. the Library view tearing down when the user switches to the Workspace tab and back).
 * Falls back to `initial` on any read/parse error and silently ignores write failures
 * (quota / private-mode), matching the rest of the app's localStorage usage.
 */
export function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch {
      /* ignore parse/privacy errors */
    }
    return initial;
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore quota/privacy errors */
    }
  }, [key, value]);

  return [value, setValue] as const;
}

/**
 * Set<string> variant of usePersistentState — serialized as a JSON array. Returns the same
 * [value, setValue] shape as useState so call sites can keep using functional updaters.
 */
export function usePersistentSet(key: string, initial: Set<string> = new Set()) {
  const [arr, setArr] = usePersistentState<string[]>(key, [...initial]);
  // Stable Set identity per `arr` so consumers' useMemo/effect deps don't fire every render.
  const value = useMemo(() => new Set(arr), [arr]);
  const setValue: React.Dispatch<React.SetStateAction<Set<string>>> = (next) => {
    setArr((prev) => {
      const resolved = typeof next === 'function' ? (next as (p: Set<string>) => Set<string>)(new Set(prev)) : next;
      return [...resolved];
    });
  };
  return [value, setValue] as const;
}
