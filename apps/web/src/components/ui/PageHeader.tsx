/**
 * Lumen 2 PageHeader — sentence-case title + optional actions (section 11.0).
 */
import type { ReactNode } from "react";

export type PageHeaderProps = {
  title: string;
  eyebrow?: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
  "data-testid"?: string;
};

export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  className = "",
  "data-testid": testId,
}: PageHeaderProps) {
  return (
    <header
      className={["l2-page-header", className].filter(Boolean).join(" ")}
      data-testid={testId}
    >
      <div className="l2-page-header__text">
        {eyebrow ? (
          <p className="l2-page-header__eyebrow">{eyebrow}</p>
        ) : null}
        <h1 className="l2-page-header__title">{title}</h1>
        {description ? (
          <p className="l2-page-header__description">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="l2-page-header__actions">{actions}</div>
      ) : null}
    </header>
  );
}
