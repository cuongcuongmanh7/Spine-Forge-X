import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { useApp } from '../useAppController';

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`} role="status" onClick={() => dismissToast(toast.id)}>
          {toast.kind === 'success' && <CheckCircle2 size={18} />}
          {toast.kind === 'error' && <XCircle size={18} />}
          {toast.kind === 'warning' && <AlertTriangle size={18} />}
          {toast.kind === 'info' && <Info size={18} />}
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
