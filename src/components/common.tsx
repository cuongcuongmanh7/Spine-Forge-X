import { useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, HelpCircle, XCircle } from 'lucide-react';
import './common.css';

/** Small muted info icon; the tip text shows only on hover (native tooltip). */
export function Hint({ text }: { text: string }) {
  return (
    <span className="hint" title={text} aria-label={text}>
      <HelpCircle size={14} />
    </span>
  );
}

type SectionProps = {
  title: string;
  defaultOpen?: boolean;
  /** When set, the open/closed state is persisted in localStorage under this key. */
  storageKey?: string;
  /** Optional element shown in the header next to the chevron (e.g. a count badge). */
  accessory?: ReactNode;
  /** Compact summary shown below the header only while collapsed (e.g. key stats / essential toggles). */
  collapsedPreview?: ReactNode;
  children: ReactNode;
};

export function Section({ title, defaultOpen = true, storageKey, accessory, collapsedPreview, children }: SectionProps) {
  const [open, setOpen] = useState(() => {
    if (storageKey) {
      try {
        const v = localStorage.getItem(storageKey);
        if (v === '0') return false;
        if (v === '1') return true;
      } catch {
        /* ignore quota/privacy errors */
      }
    }
    return defaultOpen;
  });
  const toggle = () =>
    setOpen((value) => {
      const next = !value;
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, next ? '1' : '0');
        } catch {
          /* ignore quota/privacy errors */
        }
      }
      return next;
    });
  return (
    <section className="section">
      <div className="section-header">
        <button className="section-title-btn" onClick={toggle}>
          <span>{title}</span>
        </button>
        {!open && collapsedPreview && <div className="section-header-preview">{collapsedPreview}</div>}
        {/* Accessory sits beside the chevron but outside the toggle button, so it can hold its own
            interactive controls (e.g. a "Clear all" button) without nesting buttons / toggling. */}
        <div className="section-header-right">
          {accessory}
          <button className="section-header-toggle" onClick={toggle} aria-label={title}>
            {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </button>
        </div>
      </div>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

type FieldStatusProps = {
  ok?: boolean;
  warning?: boolean;
  message: string;
};

export function FieldStatus({ ok, warning, message }: FieldStatusProps) {
  if (ok) {
    return (
      <span className="field-status ok" title={message} role="img" aria-label={message}>
        <CheckCircle2 size={18} />
      </span>
    );
  }
  if (warning) {
    return (
      <span className="field-status warning" title={message} role="img" aria-label={message}>
        <AlertTriangle size={18} />
      </span>
    );
  }
  return (
    <span className="field-status error" title={message} role="img" aria-label={message}>
      <XCircle size={18} />
    </span>
  );
}
