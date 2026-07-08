// Deterministic accent color for a Filters chip. Status keys map to semantic colors (green / amber /
// red / gray) so a chip's color reads as its clean-scan state at a glance; every other label (type,
// version, user, tag) gets a stable hashed hue, so the same value always draws the same color across
// sessions without us storing anything.

// Muted mid-tones, not vivid primaries: the chip UI paints these as a pale tint + colored text
// (Figma/Trello style), so the base color only needs to carry enough saturation to stay identifiable.
const STATUS_COLORS: Record<string, string> = {
  clean: 'hsl(146 42% 45%)',
  warning: 'hsl(38 70% 48%)',
  'not-exported': 'hsl(2 58% 56%)',
  unknown: 'hsl(220 9% 55%)'
};

// FNV-1a → a hue in [0, 360). Small, stable, good-enough spread for a handful of labels.
function hashHue(label: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 360;
}

/** Accent color (an `hsl(...)` string) for a chip. `statusKey` wins when the chip represents a
 *  clean/export status; otherwise the color is hashed from `label` for a stable pseudo-random hue. */
export function chipColor(label: string, statusKey?: string): string {
  if (statusKey && STATUS_COLORS[statusKey]) return STATUS_COLORS[statusKey];
  return `hsl(${hashHue(label)} 48% 52%)`;
}
