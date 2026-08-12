/**
 * F6 right-side drawer — create/edit inspector pattern.
 * Focus trap, Escape, restore focus (same a11y law as Modal).
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";
import { Button } from "./Button.js";
import { Icon } from "./Icon.js";

export type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Width token. */
  size?: "sm" | "md" | "lg";
  dismissible?: boolean;
  className?: string;
  "data-testid"?: string;
};

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
  dismissible = true,
  className = "",
  "data-testid": testId = "drawer",
}: DrawerProps) {
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
    (focusables[0] ?? panel)?.focus();
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

  return (
    <div
      className={["l2-drawer", className].filter(Boolean).join(" ")}
      data-testid={testId}
      data-size={size}
      data-state="open"
    >
      <button
        type="button"
        className="l2-drawer__backdrop"
        aria-label="Close drawer"
        data-testid={`${testId}-backdrop`}
        onClick={handleClose}
      />
      <div
        ref={panelRef}
        className="l2-drawer__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid={`${testId}-panel`}
      >
        <header className="l2-drawer__header">
          <h2 id={titleId} className="l2-drawer__title">
            {title}
          </h2>
          <Button
            type="button"
            variant="quiet"
            size="sm"
            onClick={handleClose}
            data-testid={`${testId}-close`}
            aria-label="Close"
          >
            <Icon name="close" size="sm" decorative />
          </Button>
        </header>
        <div className="l2-drawer__body">{children}</div>
        {footer ? (
          <footer className="l2-drawer__footer" data-testid={`${testId}-footer`}>
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
