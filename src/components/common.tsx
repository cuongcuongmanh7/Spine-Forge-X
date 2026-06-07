import { useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, HelpCircle, XCircle } from 'lucide-react';

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
  children: ReactNode;
};

export function Section({ title, defaultOpen = true, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="section">
      <button className="section-header" onClick={() => setOpen((value) => !value)}>
        <span>{title}</span>
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
      </button>
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
      <span className="field-status ok" title={message}>
        <CheckCircle2 size={18} />
      </span>
    );
  }
  if (warning) {
    return (
      <span className="field-status warning" title={message}>
        <AlertTriangle size={18} />
      </span>
    );
  }
  return (
    <span className="field-status error" title={message}>
      <XCircle size={18} />
    </span>
  );
}
