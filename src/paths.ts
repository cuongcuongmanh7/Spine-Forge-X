/**
 * Longest common parent directory of a set of paths, e.g.
 * ["C:\\u\\Heroes\\3004", "C:\\u\\Heroes\\3005"] -> "C:\\u\\Heroes".
 * Returns '' when there is no shared parent beyond a bare drive/root.
 */
export function commonParentPath(paths: string[]): string {
  if (paths.length === 0) return '';
  const sep = paths[0].includes('\\') ? '\\' : '/';
  const parts = paths.map((p) => p.replace(/[\\/]+$/, '').split(/[\\/]/));
  const first = parts[0];
  let i = 0;
  while (i < first.length && parts.every((p) => p[i] === first[i])) i++;
  const common = first.slice(0, i);
  // Need at least root + one segment (e.g. "C:" + "u") to be a useful folder.
  if (common.length < 2) return '';
  return common.join(sep);
}
