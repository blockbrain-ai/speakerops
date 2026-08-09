/**
 * Lumen 2 Modal — focus trap, Escape, restore focus (section 11.0 / E6).
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type MouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Button } from "./Button.js";
import { Icon } from "./Icon.js";

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Large surface for denser content. */
  size?: "md" | "lg";
  /** When false, Escape and backdrop do not close (destructive confirm). */
  dismissible?: boolean;
  className?: string;
  "data-testid"?: string;
};

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
  dismissible = true,
  className = "",
  "data-testid": testId,
}: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const handleClose = useCallback(() => {
    if (dismissible) onClose();
  }, [dismissible, onClose]);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const panel = panelRef.current;
    const focusables = panel
      ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      : [];
    const first = focusables[0] ?? panel;
    first?.focus();

    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        handleClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => !el.hasAttribute("disabled"));
      if (focusables.length === 0) {
        e.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, handleClose]);

  if (!open) return null;

  function onBackdropClick(e: MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) handleClose();
  }

  function onPanelKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    // Stop bubbling so nested handlers do not steal Escape before trap.
    if (e.key === "Escape") e.stopPropagation();
  }

  return (
    <div
      className="l2-modal-backdrop"
      onClick={onBackdropClick}
      data-testid={testId ? `${testId}-backdrop` : undefined}
    >
      <div
        ref={panelRef}
        className={[
          "l2-modal",
          size === "lg" ? "l2-modal--lg" : "",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
        data-testid={testId}
        data-state="open"
      >
        <div className="l2-modal__header">
          <h2 className="l2-modal__title" id={titleId}>
            {title}
          </h2>
          {dismissible ? (
            <Button
              variant="quiet"
              size="sm"
              iconOnly
              onClick={handleClose}
              aria-label="Close dialog"
              data-testid={testId ? `${testId}-close` : undefined}
            >
              <Icon name="close" size="sm" decorative />
            </Button>
          ) : null}
        </div>
        <div className="l2-modal__body">{children}</div>
        {footer ? <div className="l2-modal__footer">{footer}</div> : null}
      </div>
    </div>
  );
}
