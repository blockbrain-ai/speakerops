/**
 * Lumen 2 Badge — read-only state with text label (never color-only).
 */
import type { HTMLAttributes, ReactNode } from "react";

export type BadgeTone =
  | "neutral"
  | "brand"
  | "success"
  | "progress"
  | "warn"
  | "danger"
  | "info";

export type BadgeProps = {
  tone?: BadgeTone;
  /** Optional reinforcing dot — never replaces text. */
  showDot?: boolean;
  children: ReactNode;
  className?: string;
} & Omit<HTMLAttributes<HTMLSpanElement>, "children" | "className">;

export function Badge({
  tone = "neutral",
  showDot = false,
  children,
  className = "",
  ...rest
}: BadgeProps) {
  const classes = ["l2-badge", `l2-badge--${tone}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} data-tone={tone} {...rest}>
      {showDot ? <span className="l2-badge__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
