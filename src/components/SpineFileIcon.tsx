import spineIconUrl from '../assets/spine-file.png';

/**
 * SpineForge file mark — the official Spine "vertebra" icon (from spine-unity),
 * used as the per-row glyph next to .spine files. Mirrors the lucide icon API
 * (single `size` prop).
 */
export function SpineFileIcon({ size = 16 }: { size?: number }) {
  return (
    <img
      src={spineIconUrl}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      style={{ display: 'block', objectFit: 'contain' }}
    />
  );
}
