import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { newUuid } from '../utils/format';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  notify: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue>({
  notify: () => {},
});

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

/**
 * Accessible status notifications:
 * - Uses native ariaNotify() when available, falling back to a pre-populated polite live region.
 * - Never auto-dismisses while focus is inside the toast.
 * - Explicit close buttons for keyboard users.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [liveMessage, setLiveMessage] = useState('');
  const pausedIds = useRef(new Set<string>());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
    pausedIds.current.delete(id);
  }, []);

  const notify = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      // Do not surface toasts behind an open modal dialog
      if (typeof document !== 'undefined' && document.querySelector('dialog:modal')) {
        return;
      }

      const id = newUuid();
      setToasts((prev) => [...prev.slice(-3), { id, message, tone }]);

      // Announce via ariaNotify() where supported; otherwise update pre-mounted live region
      const doc = document as Document & { ariaNotify?: (text: string) => void };
      if (typeof doc.ariaNotify === 'function') {
        doc.ariaNotify(message);
      } else {
        setLiveMessage('');
        requestAnimationFrame(() => setLiveMessage(message));
      }

      window.setTimeout(() => {
        if (!pausedIds.current.has(id)) {
          dismiss(id);
        }
      }, 5500);
    },
    [dismiss],
  );

  useEffect(() => {
    return () => {
      pausedIds.current.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <p className="visually-hidden">Screen reader status notifications</p>
      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
        {liveMessage}
      </div>
      {toasts.length > 0 ? (
        <div role="region" aria-label="Notifications" className="toast-region">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className="toast-item"
              data-tone={toast.tone}
              onFocus={() => pausedIds.current.add(toast.id)}
              onBlur={() => {
                pausedIds.current.delete(toast.id);
                window.setTimeout(() => dismiss(toast.id), 2500);
              }}
            >
              <span>{toast.message}</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label="Dismiss notification"
                onClick={() => dismiss(toast.id)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}
