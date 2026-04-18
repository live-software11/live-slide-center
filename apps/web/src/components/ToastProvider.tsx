import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { ToastContext, type ToastApi, type ToastItem, type ToastTone } from './toast-context';

const MAX_TOASTS = 5;
const DEFAULT_DURATION = 4500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timeoutsRef = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const handle = timeoutsRef.current.get(id);
    if (handle !== undefined) {
      clearTimeout(handle);
      timeoutsRef.current.delete(id);
    }
  }, []);

  const push = useCallback((tone: ToastTone, title: string, opts?: { description?: string; duration?: number }) => {
    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const duration = opts?.duration ?? DEFAULT_DURATION;
    setToasts((prev) => {
      const next = [...prev, { id, tone, title, description: opts?.description, duration }];
      return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
    });
    if (duration > 0) {
      const handle = setTimeout(() => dismiss(id), duration);
      timeoutsRef.current.set(id, handle as unknown as number);
    }
    return id;
  }, [dismiss]);

  const api = useMemo<ToastApi>(() => ({
    success: (title, opts) => push('success', title, opts),
    error: (title, opts) => push('error', title, opts),
    warning: (title, opts) => push('warning', title, opts),
    info: (title, opts) => push('info', title, opts),
    dismiss,
    clear: () => {
      timeoutsRef.current.forEach((h) => clearTimeout(h));
      timeoutsRef.current.clear();
      setToasts([]);
    },
  }), [push, dismiss]);

  useEffect(() => {
    const map = timeoutsRef.current;
    return () => {
      map.forEach((h) => clearTimeout(h));
      map.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastContainer({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-4 z-60 flex flex-col items-center gap-2 px-4 sm:inset-auto sm:right-4 sm:top-4 sm:items-end"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} item={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  const palette = (() => {
    switch (item.tone) {
      case 'success':
        return {
          icon: <CheckCircle2 className="h-5 w-5" aria-hidden />,
          ring: 'border-sc-success/40 bg-sc-success/10 text-sc-success',
          iconClass: 'text-sc-success',
        };
      case 'error':
        return {
          icon: <AlertCircle className="h-5 w-5" aria-hidden />,
          ring: 'border-sc-danger/40 bg-sc-danger/10 text-sc-danger',
          iconClass: 'text-sc-danger',
        };
      case 'warning':
        return {
          icon: <AlertTriangle className="h-5 w-5" aria-hidden />,
          ring: 'border-sc-warning/40 bg-sc-warning/10 text-sc-warning',
          iconClass: 'text-sc-warning',
        };
      default:
        return {
          icon: <Info className="h-5 w-5" aria-hidden />,
          ring: 'border-sc-primary/30 bg-sc-primary/10 text-sc-primary',
          iconClass: 'text-sc-primary',
        };
    }
  })();

  return (
    <div
      role={item.tone === 'error' || item.tone === 'warning' ? 'alert' : 'status'}
      className={`pointer-events-auto flex w-full max-w-sm gap-3 rounded-xl border px-4 py-3 shadow-lg backdrop-blur-md ${palette.ring}`}
    >
      <span className={`mt-0.5 shrink-0 ${palette.iconClass}`}>{palette.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-sc-text">{item.title}</p>
        {item.description ? (
          <p className="mt-1 text-xs leading-relaxed text-sc-text-muted">{item.description}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        className="shrink-0 rounded-md p-1 text-sc-text-dim transition-colors hover:bg-sc-text/10 hover:text-sc-text"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
