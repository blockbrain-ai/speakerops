/**
 * Lightweight authenticated shell for speaker + evaluator (role-lifecycle UX).
 * Product mark + event identity + account; optional section nav with active state.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type MouseEvent,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  MeMembershipsResponseSchema,
  type AuthMembershipOption,
  type EventRole,
} from "@speakerops/shared";
import { Button } from "../components/ui/Button.js";

export type RoleShellNavItem = {
  /** Section id without #, or path starting with / */
  id: string;
  label: string;
  testId?: string;
};

export type RoleShellProps = {
  role: "speaker" | "evaluator";
  /** Active event display name when known (overrides membership lookup). */
  eventName?: string | null;
  eventId?: string | null;
  children: ReactNode;
  /**
   * Section nav (speaker). ids are section element ids; activeId highlights current.
   * Omit for evaluator (no self-link Queue).
   */
  sections?: RoleShellNavItem[];
  activeSectionId?: string | null;
  onSectionSelect?: (sectionId: string) => void;
  /** Hide section nav (mobile uses bottom nav). */
  hideSectionNav?: boolean;
};

export function RoleShell({
  role,
  eventName: eventNameProp,
  eventId: eventIdProp,
  children,
  sections,
  activeSectionId,
  onSectionSelect,
  hideSectionNav = false,
}: RoleShellProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const eventIdFromQuery = searchParams.get("eventId");
  const eventId = eventIdProp ?? eventIdFromQuery;
  const [email, setEmail] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<AuthMembershipOption[]>([]);
  const [signingOut, setSigningOut] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

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
    const sameRole = memberships.filter((m) => m.role === role);
    if (eventId) {
      const hit = sameRole.find((m) => m.eventId === eventId);
      if (hit?.eventName) return hit.eventName;
    }
    if (sameRole.length === 1) return sameRole[0]!.eventName;
    return null;
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

  function onNavClick(e: MouseEvent, sectionId: string) {
    e.preventDefault();
    onSectionSelect?.(sectionId);
  }

  const showSections =
    !hideSectionNav && sections && sections.length > 0 && onSectionSelect;

  return (
    <div
      className={`role-shell role-shell--${role}`}
      data-testid={`role-shell-${role}`}
      data-role={role}
      data-event-id={eventId ?? undefined}
    >
      <header className="role-shell__header" data-testid="role-shell-header">
        <div className="role-shell__brand">
          <p className="role-shell__product" data-testid="role-shell-product">
            SpeakerOps
          </p>
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
          <div className="role-shell__help-wrap">
            <button
              type="button"
              className="role-shell__help lumen-focusable"
              data-testid="role-shell-help"
              aria-expanded={helpOpen}
              onClick={() => setHelpOpen((o) => !o)}
            >
              Help
            </button>
            {helpOpen ? (
              <div
                className="role-shell__help-panel"
                data-testid="role-shell-help-panel"
                role="region"
                aria-label="Help"
              >
                <p>
                  Need support with this programme? Contact the programme team.
                </p>
                <p>
                  <a
                    href="https://learn.speakerops.org"
                    target="_blank"
                    rel="noreferrer"
                    className="lumen-focusable"
                    data-testid="role-docs-link"
                  >
                    Docs &amp; guides
                  </a>
                </p>
                <a
                  className="role-shell__help-mail lumen-focusable"
                  href="mailto:programme@speakerops.org?subject=SpeakerOps%20help"
                  data-testid="role-shell-help-mailto"
                >
                  Email programme@speakerops.org
                </a>
              </div>
            ) : null}
          </div>
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
      {showSections ? (
        <nav
          className="role-shell__nav"
          aria-label={`${roleLabel} sections`}
          data-testid="role-shell-nav"
        >
          {sections!.map((item) => {
            const active = activeSectionId === item.id;
            return (
              <a
                key={item.id}
                className={`role-shell__nav-link lumen-focusable${
                  active ? " role-shell__nav-link--active" : ""
                }`}
                href={`#${item.id}`}
                data-testid={item.testId}
                aria-current={active ? "true" : undefined}
                onClick={(e) => onNavClick(e, item.id)}
              >
                {item.label}
              </a>
            );
          })}
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
