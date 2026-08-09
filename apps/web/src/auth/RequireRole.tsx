/**
 * UI route guard — section 2.2 + 11.7 session recovery (S-L2-A11Y).
 *
 * Probes server-side role via real API (never trust client alone):
 * - roles includes admin → GET /api/events (Event.List admin gate)
 *
 * Unauthenticated (401) → redirect /login with session-expired recovery state
 *   (never leave an auth alert inside a usable admin shell)
 * Wrong role (403) → AccessDenied / PermissionDenied surface
 * OK (200) → children
 *
 * Inventory: B04 unauth admin blocked · B05 speaker blocked from admin
 * · L2-02 session recovery
 */
import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { EventRole } from "@speakerops/shared";
import { ErrorEnvelopeSchema } from "@speakerops/shared";
import { LoadingState } from "../components/ui/LoadingState.js";


export type RequireRoleProps = {
  /** Allowed roles for this surface (UI mirrors server requireRole). */
  roles: readonly EventRole[];
  children: ReactNode;
};

type GuardState =
  | { status: "loading" }
  | { status: "ok" }
  | { status: "unauthenticated" }
  | { status: "forbidden"; message: string }
  | { status: "error"; message: string };

/**
 * Probe admin access via Event.List (COMMANDS.md GET /api/events).
 * Other role probes can be added as domain endpoints land.
 */
async function probeAdminAccess(): Promise<
  "ok" | "unauthenticated" | "forbidden" | "error"
> {
  try {
    const res = await fetch("/api/events", {
      method: "GET",
      credentials: "include",
      headers: { accept: "application/json" },
    });
    if (res.status === 401) return "unauthenticated";
    if (res.status === 403) return "forbidden";
    if (res.ok) return "ok";
    return "error";
  } catch {
    return "error";
  }
}

/**
 * Probe evaluator access via GET /api/me/eval-queue (section 3.4).
 * 401 unauthenticated · 403 wrong role · 200 ok.
 */
async function probeEvaluatorAccess(): Promise<
  "ok" | "unauthenticated" | "forbidden" | "error"
> {
  try {
    const res = await fetch("/api/me/eval-queue", {
      method: "GET",
      credentials: "include",
      headers: { accept: "application/json" },
    });
    if (res.status === 401) return "unauthenticated";
    if (res.status === 403) return "forbidden";
    if (res.ok) return "ok";
    return "error";
  } catch {
    return "error";
  }
}

export function AccessDenied({
  message = "You do not have access to this area.",
}: {
  message?: string;
}) {
  return (
    <div
      className="access-denied"
      data-testid="access-denied"
      data-section="2.2"
      role="alert"
    >
      <div className="access-denied__card">
        <p className="access-denied__overline">SpeakerOps</p>
        <h1 className="access-denied__title" data-testid="access-denied-title">
          Access denied
        </h1>
        <p className="access-denied__body" data-testid="access-denied-message">
          {message}
        </p>
        <a
          className="access-denied__link lumen-focusable"
          href="/login"
          data-testid="access-denied-login"
        >
          Sign in with a different account
        </a>
      </div>
    </div>
  );
}

export function RequireRole({ roles, children }: RequireRoleProps) {
  const location = useLocation();
  const [state, setState] = useState<GuardState>({ status: "loading" });

  const check = useCallback(async () => {
    setState({ status: "loading" });
    // Admin surfaces use Event.List probe (server enforceRole)
    const needsAdmin = roles.includes("admin");
    const needsEvaluator =
      roles.includes("evaluator") && !roles.includes("admin");

    if (needsEvaluator) {
      const result = await probeEvaluatorAccess();
      if (result === "ok") {
        setState({ status: "ok" });
        return;
      }
      if (result === "unauthenticated") {
        setState({ status: "unauthenticated" });
        return;
      }
      if (result === "forbidden") {
        setState({
          status: "forbidden",
          message: "Evaluator role required for this area.",
        });
        return;
      }
      setState({ status: "error", message: "Unable to verify access" });
      return;
    }

    if (!needsAdmin) {
      // Speaker / other surfaces land with dedicated probes in later sections
      setState({ status: "ok" });
      return;
    }

    const result = await probeAdminAccess();
    if (result === "ok") {
      setState({ status: "ok" });
      return;
    }
    if (result === "unauthenticated") {
      setState({ status: "unauthenticated" });
      return;
    }
    if (result === "forbidden") {
      setState({
        status: "forbidden",
        message: "Admin role required for this area.",
      });
      return;
    }
    // Network / unexpected — still fail closed for admin
    try {
      const res = await fetch("/api/events", {
        credentials: "include",
      });
      const raw: unknown = await res.json().catch(() => null);
      const env = ErrorEnvelopeSchema.safeParse(raw);
      setState({
        status: "error",
        message: env.success ? env.data.error : "Unable to verify access",
      });
    } catch {
      setState({ status: "error", message: "Unable to verify access" });
    }
  }, [roles]);

  useEffect(() => {
    void check();
    // Session restore (10.4): re-probe when tab becomes visible so an expired
    // or swapped cookie (role switcher / logout elsewhere) fails closed instead
    // of leaving a stale privileged shell painted.
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void check();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [check, location.pathname]);

  if (state.status === "loading") {
    return (
      <div
        className="access-denied access-denied--loading"
        data-testid="require-role-loading"
        data-section="2.2"
      >
        <LoadingState
          label="Checking access…"
          rows={2}
          data-testid="require-role-loading-state"
        />
      </div>
    );
  }

  if (state.status === "unauthenticated") {
    // Focused recovery on login — never paint privileged shell with auth alert.
    return (
      <Navigate
        to="/login"
        replace
        state={{
          from: location.pathname,
          sessionExpired: true,
        }}
      />
    );
  }

  if (state.status === "forbidden") {
    return <AccessDenied message={state.message} />;
  }

  if (state.status === "error") {
    return <AccessDenied message={state.message} />;
  }

  return <>{children}</>;
}
