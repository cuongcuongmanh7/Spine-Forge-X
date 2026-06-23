import animUrl from '../assets/stat-anim.png';
import imageUrl from '../assets/stat-image.png';
import skinUrl from '../assets/stat-skin.png';

export type StatKind = 'anim' | 'image' | 'skin';

const STAT_ICONS: Record<StatKind, string> = {
  anim: animUrl,
  image: imageUrl,
  skin: skinUrl
};

/**
 * Per-stat glyph (animation / image / skin) shown wherever a skeleton's counts
 * surface — column headers, stat cards, and the expanded anim/skin panels.
 * Mirrors the lucide icon API (single `size` prop) so it drops in beside them.
 */
export function StatIcon({ kind, size = 16 }: { kind: StatKind; size?: number }) {
  return (
    <img
      src={STAT_ICONS[kind]}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: 'text-bottom', objectFit: 'contain' }}
    />
  );
}
