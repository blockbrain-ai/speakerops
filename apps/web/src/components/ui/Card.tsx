/**
 * Lumen 2 Card — surface unit with optional header/body/footer.
 * States: rest, raised, interactive hover/focus, selected.
 */
import type { HTMLAttributes, ReactNode } from "react";

export type CardProps = {
  raised?: boolean;
  interactive?: boolean;
  selected?: boolean;
  header?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
  title?: string;
} & Omit<HTMLAttributes<HTMLElement>, "title" | "children" | "className">;

export function Card({
  raised = false,
  interactive = false,
  selected = false,
  header,
  meta,
  actions,
  footer,
  children,
  className = "",
  title,
  ...rest
}: CardProps) {
  const classes = [
    "l2-card",
    raised ? "l2-card--raised" : "",
    interactive ? "l2-card--interactive lumen-focusable" : "",
    selected ? "is-selected" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      data-state={selected ? "selected" : "rest"}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      {...rest}
    >
      {(title || header || actions) && (
        <div className="l2-card__header">
          <div>
            {title ? <h3 className="l2-card__title">{title}</h3> : header}
            {meta ? <p className="l2-card__meta">{meta}</p> : null}
          </div>
          {actions}
        </div>
      )}
      {children ? <div className="l2-card__body">{children}</div> : null}
      {footer ? <div className="l2-card__footer">{footer}</div> : null}
    </div>
  );
}
