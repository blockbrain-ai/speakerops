/**
 * Lumen 2 Button — full state anatomy (section 11.0).
 * States: rest, hover, focus-visible, pressed, disabled, pending.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "quiet"
  | "danger"
  | "success";

export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Async in-flight — retains width, shows spinner, blocks double-submit. */
  pending?: boolean;
  /** Forced pressed visual (state sheet / demos). */
  pressed?: boolean;
  iconOnly?: boolean;
  children?: ReactNode;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className">;

export function Button({
  variant = "primary",
  size = "md",
  pending = false,
  pressed = false,
  iconOnly = false,
  disabled,
  children,
  className = "",
  type = "button",
  ...rest
}: ButtonProps) {
  const isDisabled = Boolean(disabled) || pending;
  const classes = [
    "l2-btn",
    `l2-btn--${variant}`,
    size !== "md" ? `l2-btn--${size}` : "",
    iconOnly ? "l2-btn--icon" : "",
    pending ? "is-pending" : "",
    pressed ? "is-pressed" : "",
    disabled ? "is-disabled" : "",
    "lumen-focusable",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type={type}
      className={classes}
      disabled={isDisabled}
      aria-busy={pending || undefined}
      aria-disabled={isDisabled || undefined}
      data-state={
        pending
          ? "pending"
          : disabled
            ? "disabled"
            : pressed
              ? "pressed"
              : "rest"
      }
      {...rest}
    >
      {pending ? (
        <span className="l2-btn__spinner" aria-hidden="true" />
      ) : null}
      <span className="l2-btn__label">{children}</span>
    </button>
  );
}
