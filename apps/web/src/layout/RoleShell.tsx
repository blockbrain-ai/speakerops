/**
 * Lightweight authenticated shell for speaker + evaluator (role-lifecycle UX).
 * Not a full admin IA — event identity, account, help, sign-out only.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  MeMembershipsResponseSchema,
  type AuthMembershipOption,
  type EventRole,
} from "@speakerops/shared";
import { Button } from "../components/ui/Button.js";

export type RoleShellProps = {
  role: "speaker" | "evaluator";
  /** Active event display name when known (overrides membership lookup). */
  eventName?: string | null;
  eventId?: string | null;
  children: ReactNode;
  /** Optional compact nav links (role-specific). */
  nav?: Array<{ href: string; label: string; testId?: string }>;
};

export function RoleShell({
  role,
  eventName: eventNameProp,
  eventId: eventIdProp,
  children,
  nav,
}: RoleShellProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const eventIdFromQuery = searchParams.get("eventId");
  const eventId = eventIdProp ?? eventIdFromQuery;
  const [email, setEmail] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<AuthMembershipOption[]>([]);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", {
          credentials: "include",
          headers: { accept: "application/json" },
        });
        if (!res.ok || cancelled) return;
        const raw: unknown = await res.json();
        const parsed = MeMembershipsResponseSchema.safeParse(raw);
        if (!parsed.success || cancelled) return;
        setEmail(parsed.data.email);
        setMemberships(parsed.data.memberships);
      } catch {
        /* optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const eventName = useMemo(() => {
    if (eventNameProp?.trim()) return eventNameProp.trim();
    if (!eventId) return null;
    const hit = memberships.find(
      (m) => m.eventId === eventId && (m.role === role || role === "evaluator"),
    );
    return hit?.eventName ?? null;
  }, [eventNameProp, eventId, memberships, role]);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      /* still leave */
    } finally {
      setSigningOut(false);
      navigate("/login", { replace: true });
    }
  }, [navigate]);

  const roleLabel = role === "speaker" ? "Speaker" : "Evaluator";
  const sameRoleMemberships = memberships.filter((m) => m.role === role);
  const showSwitcher = sameRoleMemberships.length > 1;

  return (
    <div
      className={`role-shell role-shell--${role}`}
      data-testid={`role-shell-${role}`}
      data-role={role}
      data-event-id={eventId ?? undefined}
    >
      <header className="role-shell__header" data-testid="role-shell-header">
        <div className="role-shell__brand">
          <p className="role-shell__overline" data-testid="role-shell-role">
            {roleLabel}
          </p>
          <h1 className="role-shell__title" data-testid="role-shell-event">
            {eventName?.trim() || "Your programme"}
          </h1>
        </div>
        <div className="role-shell__account" data-testid="role-shell-account">
          {email ? (
            <span
              className="role-shell__email"
              data-testid="role-shell-email"
              title={email}
            >
              {email}
            </span>
          ) : null}
          {showSwitcher ? (
            <label className="role-shell__switcher-label">
              <span className="visually-hidden">Switch event</span>
              <select
                className="role-shell__switcher lumen-focusable"
                data-testid="role-shell-event-switcher"
                value={eventId ?? ""}
                onChange={(e) => {
                  const next = e.target.value;
                  if (!next) return;
                  if (role === "speaker") {
                    navigate(`/portal?eventId=${encodeURIComponent(next)}`);
                  } else {
                    navigate(`/eval?eventId=${encodeURIComponent(next)}`);
                  }
                }}
              >
                {sameRoleMemberships.map((m) => (
                  <option key={`${m.eventId}-${m.role}`} value={m.eventId}>
                    {m.eventName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <a
            className="role-shell__help lumen-focusable"
            href="mailto:programme@speakerops.org?subject=SpeakerOps%20help"
            data-testid="role-shell-help"
          >
            Help
          </a>
          <Button
            type="button"
            variant="quiet"
            size="sm"
            data-testid="role-shell-sign-out"
            pending={signingOut}
            onClick={() => void signOut()}
          >
            Sign out
          </Button>
        </div>
      </header>
      {nav && nav.length > 0 ? (
        <nav
          className="role-shell__nav"
          aria-label={`${roleLabel} sections`}
          data-testid="role-shell-nav"
        >
          {nav.map((item) => (
            <a
              key={item.href}
              className="role-shell__nav-link lumen-focusable"
              href={item.href}
              data-testid={item.testId}
            >
              {item.label}
            </a>
          ))}
        </nav>
      ) : null}
      <main className="role-shell__main" data-testid="role-shell-main">
        {children}
      </main>
    </div>
  );
}

/** Landing path for a membership. */
export function pathForMembership(m: {
  eventId: string;
  role: EventRole;
}): string {
  if (m.role === "admin") return "/admin";
  if (m.role === "evaluator") {
    return `/eval?eventId=${encodeURIComponent(m.eventId)}`;
  }
  return `/portal?eventId=${encodeURIComponent(m.eventId)}`;
}
