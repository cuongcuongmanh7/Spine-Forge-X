import gdriveIconUrl from '../assets/google-drive.png';

/**
 * Google Drive mark — the official multi-colour Drive logo, used as the glyph next to
 * Drive-related actions (load Drive data, Drive info/history, Drive account). Mirrors the
 * lucide icon API (single `size` prop) so it drops in where a lucide icon sat.
 */
export function GoogleDriveIcon({ size = 16 }: { size?: number }) {
  return (
    <img
      src={gdriveIconUrl}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      // inline-block + middle baseline so it sits on the same line as adjacent text (e.g. the modal
      // <h2>), matching how a lucide SVG icon flows; in flex rows it's blockified like any flex item.
      style={{ display: 'inline-block', verticalAlign: 'middle', objectFit: 'contain', flex: '0 0 auto' }}
    />
  );
}
