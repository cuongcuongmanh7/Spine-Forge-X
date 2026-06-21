import { FolderSearch } from 'lucide-react';

/**
 * Animated "scanning/working" panel (pulsing icon + indeterminate bar). Shared by the Inventory
 * empty-state (inline, `overlay={false}`) and the Cleanup tab (`overlay` covering the pane to block
 * interaction while a scan/clean runs). Styles live in LibraryView.css (`.library-scanning*` +
 * `.library-scan-overlay`).
 */
export function LibraryScanningOverlay({
  title,
  subtitle,
  overlay = false
}: {
  title: string;
  subtitle?: string;
  overlay?: boolean;
}) {
  const panel = (
    <div className="library-scanning" role="status" aria-live="polite">
      <span className="library-scanning-icon">
        <FolderSearch size={28} />
      </span>
      <div className="library-scanning-text">
        <span className="library-scanning-title">{title}</span>
        {subtitle && (
          <span className="library-scanning-path" title={subtitle}>
            {subtitle}
          </span>
        )}
      </div>
      <div className="library-scanning-bar" aria-hidden="true">
        <span />
      </div>
    </div>
  );
  return overlay ? <div className="library-scan-overlay">{panel}</div> : panel;
}
