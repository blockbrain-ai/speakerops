/**
 * Network / API error recovery — section 11.7 (S-L2-A11Y).
 *
 * First-class failure surface: explains impact, offers scoped retry.
 * Not used for session expiry (use SessionExpiredPanel) or authz
 * (use PermissionDeniedState / AccessDenied).
 */
import type { ReactNode } from "react";
import { Icon } from "./Icon.js";
import { Button } from "./Button.js";

export type NetworkErrorStateProps = {
  title?: string;
  description?: string;
  /** Scoped retry for the failed operation. */
  onRetry?: () => void;
  retryLabel?: string;
  pending?: boolean;
  action?: ReactNode;
  className?: string;
  "data-testid"?: string;
};

export function NetworkErrorState({
  title = "Couldn't load this data",
  description = "A network or server error interrupted the request. Your work on this page was not saved. Retry the same operation when you are ready.",
  onRetry,
  retryLabel = "Retry",
  pending = false,
  action,
  className = "",
  "data-testid": testId = "network-error-state",
}: NetworkErrorStateProps) {
  return (
    <div
      className={["l2-network-error", className].filter(Boolean).join(" ")}
      data-testid={testId}
      data-state="error"
      role="alert"
    >
      <span className="l2-network-error__icon" aria-hidden="true">
        <Icon name="warning" size="lg" decorative />
      </span>
      <h3 className="l2-network-error__title">{title}</h3>
      <p className="l2-network-error__body">{description}</p>
      <div className="l2-network-error__actions">
        {onRetry ? (
          <Button
            variant="secondary"
            pending={pending}
            onClick={onRetry}
            data-testid={
              testId ? `${testId}-retry` : "network-error-retry"
            }
          >
            {retryLabel}
          </Button>
        ) : null}
        {action}
      </div>
    </div>
  );
}
