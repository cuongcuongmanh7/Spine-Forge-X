// Pure formatting/path helpers shared by the Clean Source Folder coordinator and
// its sub-components. Extracted from CleanSourceFolderModal in v0.3.2.

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Reduce a full path to its last two segments, e.g. "3001_Lucius/hero.spine". */
export function shortenPath(path: string): string {
  const segments = path.split(/[\\/]+/).filter(Boolean);
  return segments.slice(-2).join('/');
}

/**
 * Folder path relative to the scanned root, so sibling sub-trees with the same
 * leaf name stay distinct (e.g. "Chibi/9901" vs "Splash/9901"). Falls back to
 * the leaf when the folder isn't under the root.
 */
export function relativeToRoot(folder: string, root: string): string {
  const f = folder.replace(/\\/g, '/').replace(/\/+$/, '');
  const r = root.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (r && f.toLowerCase().startsWith(r.toLowerCase() + '/')) {
    return f.slice(r.length + 1);
  }
  return f.split('/').filter(Boolean).pop() || folder;
}

/** Normalise a folder path for matching scan-progress events to picker units. */
export function normFolder(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}
