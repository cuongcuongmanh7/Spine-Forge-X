/**
 * SpineForge logo mark — a dark rounded square with a descending stack of orange
 * "vertebra" segments. Drawn as inline SVG so it stays crisp at any size and needs
 * no asset pipeline. Mirrors the lucide icon API (single `size` prop).
 */
export function SpineFileIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="1" y="1" width="22" height="22" rx="5" fill="#262626" />
      <g fill="#FF4F18">
        <rect x="6.6" y="3.6" width="11" height="5" rx="2.5" transform="rotate(-4 12 6)" />
        <rect x="6.4" y="9.4" width="9.2" height="4.4" rx="2.2" transform="rotate(-7 11 11.6)" />
        <rect x="6.2" y="14.2" width="7" height="3.7" rx="1.85" transform="rotate(-10 9.7 16)" />
        <rect x="6.1" y="18" width="5" height="3.1" rx="1.55" transform="rotate(-12 8.6 19.5)" />
      </g>
    </svg>
  );
}
