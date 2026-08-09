/**
 * Permission denied surface — section 11.7 (S-L2-A11Y).
 *
 * Distinct from session-expired: user is authenticated but lacks role/scope.
 * Fail closed — no privileged data.
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon } from "./Icon.js";

export type PermissionDeniedStateProps = {
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  "data-testid"?: string;
};

export function PermissionDeniedState({
  title = "Access denied",
  description = "You do not have permission for this area. Sign in with an account that has the required role, or ask an event admin.",
  action,
  className = "",
  "data-testid": testId = "permission-denied-state",
}: PermissionDeniedStateProps) {
  return (
    <div
      className={["l2-permission-denied", className].filter(Boolean).join(" ")}
      data-testid={testId}
      data-state="permission-denied"
      role="alert"
    >
      <span className="l2-permission-denied__icon" aria-hidden="true">
        <Icon name="warning" size="lg" decorative />
      </span>
      <h3 className="l2-permission-denied__title">{title}</h3>
      <p className="l2-permission-denied__body">{description}</p>
      <div className="l2-permission-denied__actions">
        {action ?? (
          <Link
            className="l2-permission-denied__link lumen-focusable"
            to="/login"
            data-testid={
              testId ? `${testId}-login` : "permission-denied-login"
            }
          >
            Sign in with a different account
          </Link>
        )}
      </div>
    </div>
  );
}
