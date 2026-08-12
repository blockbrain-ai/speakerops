/**
 * F6 non-blocking toast stack — success / info / warn / danger.
 * prefers-reduced-motion: no slide animation.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ToastTone = "success" | "info" | "warn" | "danger";

export type ToastItem = {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  /** ms; 0 = sticky until dismiss */
  durationMs?: number;
};

type ToastContextValue = {
  push: (t: Omit<ToastItem, "id"> & { id?: string }) => string;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Safe no-op outside provider (tests / partial mounts).
    return {
      push: () => "",
      dismiss: () => undefined,
    };
  }
  return ctx;
}

export type ToastProviderProps = {
  children: ReactNode;
};

export function ToastProvider({ children }: ToastProviderProps) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (t: Omit<ToastItem, "id"> & { id?: string }) => {
      const id = t.id ?? `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const item: ToastItem = {
        id,
        tone: t.tone,
        title: t.title,
        description: t.description,
        durationMs: t.durationMs ?? 4500,
      };
      setItems((prev) => [...prev, item].slice(-5));
      if (item.durationMs && item.durationMs > 0) {
        window.setTimeout(() => dismiss(id), item.durationMs);
      }
      return id;
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="l2-toast-stack"
        data-testid="toast-stack"
        aria-live="polite"
        aria-relevant="additions"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={`l2-toast l2-toast--${t.tone}`}
            data-testid={`toast-${t.id}`}
            data-tone={t.tone}
            role="status"
          >
            <div className="l2-toast__body">
              <strong className="l2-toast__title">{t.title}</strong>
              {t.description ? (
                <p className="l2-toast__desc">{t.description}</p>
              ) : null}
            </div>
            <button
              type="button"
              className="l2-toast__dismiss lumen-focusable"
              data-testid={`toast-dismiss-${t.id}`}
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
