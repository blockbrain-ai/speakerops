/**
 * Lumen 2 EmptyState — benefit + one next step (section 11.0).
 */
import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon.js";

export type EmptyStateProps = {
  title: string;
  description: string;
  icon?: IconName;
  action?: ReactNode;
  className?: string;
  "data-testid"?: string;
};

export function EmptyState({
  title,
  description,
  icon = "inbox",
  action,
  className = "",
  "data-testid": testId,
}: EmptyStateProps) {
  return (
    <div
      className={["l2-empty", className].filter(Boolean).join(" ")}
      data-testid={testId}
      data-state="empty"
    >
      <span className="l2-empty__icon">
        <Icon name={icon} size="lg" decorative />
      </span>
      <h3 className="l2-empty__title">{title}</h3>
      <p className="l2-empty__body">{description}</p>
      {action ? <div className="l2-empty__actions">{action}</div> : null}
    </div>
  );
}
