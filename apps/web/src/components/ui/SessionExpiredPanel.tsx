/**
 * Session-expired recovery panel — section 11.7 (S-L2-A11Y).
 *
 * First-class recovery surface: never render as an alert inside a usable
 * privileged shell. Use on login (post-redirect) or as a full-page replacement
 * outside AdminShell.
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon } from "./Icon.js";
import { Button } from "./Button.js";

export type SessionExpiredPanelProps = {
  /** Path the user tried to reach (for copy only — never auto-reauth). */
  from?: string;
  /** Primary recovery action (defaults to focusing login form via link). */
  action?: ReactNode;
  className?: string;
  "data-testid"?: string;
};

export function SessionExpiredPanel({
  from,
  action,
  className = "",
  "data-testid": testId = "session-expired-panel",
}: SessionExpiredPanelProps) {
  return (
    <div
      className={["l2-session-expired", className].filter(Boolean).join(" ")}
      data-testid={testId}
      data-section="11.7"
      data-state="session-expired"
      role="region"
      aria-labelledby="session-expired-title"
    >
      <span className="l2-session-expired__icon" aria-hidden="true">
        <Icon name="clock" size="lg" decorative />
      </span>
      <h2
        className="l2-session-expired__title"
        id="session-expired-title"
        data-testid="session-expired-title"
      >
        Session expired
      </h2>
      <p
        className="l2-session-expired__body"
        data-testid="session-expired-body"
      >
        Your sign-in is no longer valid. Request a new magic link to continue.
        No privileged data is shown until you sign in again.
      </p>
      {from ? (
        <p
          className="l2-session-expired__from"
          data-testid="session-expired-from"
        >
          You were on <code>{from}</code>
        </p>
      ) : null}
      <div className="l2-session-expired__actions">
        {action ?? (
          <Button
            variant="primary"
            data-testid="session-expired-sign-in"
            onClick={() => {
              const el = document.getElementById("login-email");
              if (el instanceof HTMLElement) {
                el.focus();
                return;
              }
              window.location.assign("/login");
            }}
          >
            Sign in again
          </Button>
        )}
        <Link
          className="l2-session-expired__secondary lumen-focusable"
          to="/login"
          data-testid="session-expired-login-link"
        >
          Open sign-in
        </Link>
      </div>
    </div>
  );
}
