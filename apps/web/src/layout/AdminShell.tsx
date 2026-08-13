/**
 * Admin chrome shell — Lumen IA sidebar (section 1.4) + active event switcher (2.3)
 * + Lumen 2 icon rail / account area / tablet-mobile drawer (section 11.1 · S-L2-SHELL).
 *
 * Nav labels locked in docs/governance/0.2-lumen-lock.md §6:
 * Overview | CFP / Forms | Submissions | Evaluations | Speakers | Schedule | Comms | Settings
 *
 * Active event context: data-testid="event-context" (C02).
 * Mobile nav toggle: data-testid="admin-nav-toggle" (390px usable).
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useEventContextOptional } from "../events/EventContext.js";
import { Icon, type IconName } from "../components/ui/Icon.js";
import { Button } from "../components/ui/Button.js";
import { BrandLockup } from "../components/ui/BrandMark.js";
import { RoleSwitcher } from "../components/RoleSwitcher.js";
import { FindTrigger } from "../components/FindPalette.js";
import { ToastProvider } from "../components/ui/Toast.js";

export type AdminNavItem = {
  /** Stable path segment under /admin */
  path: string;
  /** Visible sidebar label (Lumen IA) */
  label: string;
  /** data-testid for inventory / e2e anchors */
  testId: string;
  /** First-party Lumen 2 icon (section 11.0) */
  icon: IconName;
};

/** Canonical admin IA — do not invent CRM/Marketing modules. */
export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  { path: "/admin", label: "Overview", testId: "nav-overview", icon: "home" },
  { path: "/admin/cfp", label: "CFP / Forms", testId: "nav-cfp", icon: "file" },
  {
    path: "/admin/submissions",
    label: "Submissions",
    testId: "nav-submissions",
    icon: "inbox",
  },
  {
    path: "/admin/evaluations",
    label: "Evaluations",
    testId: "nav-evaluations",
    icon: "check",
  },
  {
    path: "/admin/speakers",
    label: "Speakers",
    testId: "nav-speakers",
    icon: "users",
  },
  {
    path: "/admin/schedule",
    label: "Schedule",
    testId: "nav-schedule",
    icon: "calendar",
  },
  { path: "/admin/comms", label: "Comms", testId: "nav-comms", icon: "mail" },
  {
    path: "/admin/portal-forms",
    label: "Portal forms",
    testId: "nav-portal-forms",
    icon: "file",
  },
  {
    path: "/admin/resources",
    label: "Resources",
    testId: "nav-resources",
    icon: "file",
  },
  {
    path: "/admin/file-requests",
    label: "File requests",
    testId: "nav-file-requests",
    icon: "inbox",
  },
  {
    path: "/admin/embeds",
    label: "Embeds",
    testId: "nav-embeds",
    icon: "file",
  },
  {
    path: "/admin/preview",
    label: "Preview",
    testId: "nav-preview",
    icon: "home",
  },
  {
    path: "/admin/analytics",
    label: "Analytics",
    testId: "nav-analytics",
    icon: "check",
  },
  {
    path: "/admin/team",
    label: "Team",
    testId: "nav-team",
    icon: "users",
  },
  {
    path: "/admin/files",
    label: "Files",
    testId: "nav-files",
    icon: "file",
  },
  {
    path: "/admin/history",
    label: "History",
    testId: "nav-history",
    icon: "clock",
  },
  {
    path: "/admin/settings",
    label: "Settings",
    testId: "nav-settings",
    icon: "settings",
  },
] as const;

const ADMIN_NAV_GROUPS: readonly {
  id: string;
  label: string;
  paths: readonly string[];
}[] = [
  {
    id: "programme",
    label: "Programme",
    paths: [
      "/admin",
      "/admin/cfp",
      "/admin/submissions",
      "/admin/evaluations",
      "/admin/speakers",
      "/admin/schedule",
    ],
  },
  {
    id: "speaker-ops",
    label: "Speaker ops",
    paths: [
      "/admin/comms",
      "/admin/portal-forms",
      "/admin/resources",
      "/admin/file-requests",
    ],
  },
  {
    id: "publish",
    label: "Publish",
    paths: ["/admin/embeds", "/admin/preview", "/admin/analytics"],
  },
  {
    id: "admin",
    label: "Admin",
    paths: ["/admin/team", "/admin/files", "/admin/history", "/admin/settings"],
  },
];

export type AdminShellProps = {
  children: ReactNode;
  /** Active event label fallback when EventProvider is absent (unit tests). */
  activeEventLabel?: string;
};

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return [
    "admin-shell__nav-link",
    "lumen-focusable",
    isActive ? "admin-shell__nav-link--active" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function titleForPath(pathname: string): string {
  if (pathname.startsWith("/admin/settings/design")) return "Design Kit";
  if (pathname.startsWith("/admin/settings/l2-state-sheet"))
    return "Lumen 2 state sheet";
  if (pathname.startsWith("/admin/settings/rubric")) return "Eval rubric";
  if (pathname.startsWith("/admin/settings/task-templates")) return "Task templates";
  if (pathname.startsWith("/admin/settings/api-keys")) return "API keys";
  if (pathname.startsWith("/admin/settings/airtable")) return "Integrations";
  if (pathname.startsWith("/admin/settings/integrations")) return "Integrations";
  const exact = ADMIN_NAV_ITEMS.find((item) => item.path === pathname);
  if (exact) return exact.label;
  const nested = ADMIN_NAV_ITEMS.find(
    (item) => item.path !== "/admin" && pathname.startsWith(item.path),
  );
  return nested?.label ?? "Overview";
}

export function AdminShell({
  children,
  activeEventLabel = "No event selected",
}: AdminShellProps) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const pageTitle = titleForPath(pathname);
  const eventCtx = useEventContextOptional();
  const [navOpen, setNavOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const label =
    eventCtx?.activeEvent?.name ??
    eventCtx?.activeEventId ??
    activeEventLabel;

  // Close drawer on route change (mobile / tablet).
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  // Escape closes the mobile drawer.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  // Desktop: keep body scroll free; when drawer open on narrow screens, lock scroll.
  useEffect(() => {
    if (!navOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [navOpen]);

  const closeNav = useCallback(() => setNavOpen(false), []);
  const toggleNav = useCallback(() => setNavOpen((v) => !v), []);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Fail closed: still leave the privileged shell.
    } finally {
      setSigningOut(false);
      navigate("/login", { replace: true });
    }
  }, [navigate]);

  return (
    <ToastProvider>
    <div
      className={[
        "admin-shell",
        navOpen ? "admin-shell--nav-open" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid="admin-shell"
      data-section="11.1"
    >
      {/* Backdrop for tablet/mobile drawer */}
      <button
        type="button"
        className="admin-shell__backdrop"
        data-testid="admin-nav-backdrop"
        aria-label="Close navigation"
        tabIndex={navOpen ? 0 : -1}
        onClick={closeNav}
        hidden={!navOpen}
      />

      <aside
        className="admin-shell__sidebar"
        data-testid="admin-sidebar"
        aria-label="Admin navigation"
        id="admin-sidebar"
      >
        <div className="admin-shell__brand">
          {/* F1 — Signal mark + lowercase wordmark lockup (locked brand) */}
          <Link
            to="/"
            className="admin-shell__brand-home lumen-focusable"
            aria-label="SpeakerOps home"
          >
            <BrandLockup size={22} />
          </Link>
          <p className="admin-shell__brand-name visually-hidden">SpeakerOps</p>
          <p className="admin-shell__brand-meta">Admin</p>
        </div>
        <nav className="admin-shell__nav" data-testid="admin-nav" aria-label="Primary">
          {ADMIN_NAV_GROUPS.map((group) => (
            <div
              key={group.id}
              className="admin-shell__nav-group"
              data-testid={`admin-nav-group-${group.id}`}
            >
              <p className="admin-shell__nav-group-label">{group.label}</p>
              {group.paths.map((path) => {
                const item = ADMIN_NAV_ITEMS.find((n) => n.path === path);
                if (!item) return null;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === "/admin"}
                    className={navLinkClass}
                    data-testid={item.testId}
                    onClick={closeNav}
                  >
                    <Icon
                      name={item.icon}
                      size="sm"
                      decorative
                      className="admin-shell__nav-icon"
                    />
                    <span className="admin-shell__nav-label">{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Account / help area (section 11.1) */}
        <div
          className="admin-shell__account"
          data-testid="admin-account"
          aria-label="Account"
        >
          <a
            href="/admin/settings"
            className="admin-shell__account-link lumen-focusable"
            data-testid="admin-help"
            onClick={closeNav}
          >
            <Icon name="info" size="sm" decorative />
            <span>Help &amp; settings</span>
          </a>
          <a
            href="https://learn.speakerops.org"
            target="_blank"
            rel="noreferrer"
            className="admin-shell__account-link lumen-focusable"
            data-testid="admin-docs-link"
          >
            <Icon name="info" size="sm" decorative />
            <span>Docs &amp; guides</span>
          </a>
          <Button
            type="button"
            variant="quiet"
            size="sm"
            className="admin-shell__sign-out"
            data-testid="admin-sign-out"
            pending={signingOut}
            onClick={() => void signOut()}
          >
            Sign out
          </Button>
        </div>
      </aside>

      <div className="admin-shell__main">
        <header className="admin-shell__header">
          <div className="admin-shell__header-start">
            <Button
              type="button"
              variant="quiet"
              size="sm"
              iconOnly
              className="admin-shell__nav-toggle"
              data-testid="admin-nav-toggle"
              aria-label={navOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={navOpen}
              aria-controls="admin-sidebar"
              onClick={toggleNav}
            >
              <Icon name={navOpen ? "close" : "more"} size="md" decorative />
            </Button>
            <h1 className="admin-shell__title" data-testid="admin-page-title">
              {pageTitle}
            </h1>
          </div>
          <div className="admin-shell__event-switcher">
            {eventCtx && eventCtx.events.length > 0 ? (
              <label className="admin-shell__event-label">
                <span className="admin-shell__event-label-text">Event</span>
                <select
                  className="admin-shell__event-select lumen-focusable"
                  data-testid="event-context"
                  value={eventCtx.activeEventId ?? ""}
                  onChange={(e) => eventCtx.setActiveEventId(e.target.value)}
                  aria-label="Active event"
                >
                  {eventCtx.events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : eventCtx && !eventCtx.loading ? (
              /* Empty state: no events yet — surface the create path here. */
              <div
                className="admin-shell__event admin-shell__event--empty"
                data-testid="event-context"
                data-event-id=""
              >
                No events yet
              </div>
            ) : (
              <div
                className="admin-shell__event"
                data-testid="event-context"
                data-event-id={eventCtx?.activeEventId ?? ""}
              >
                Event: {label}
              </div>
            )}
            {/* A real link, not a select option — selects change value, they
                don't navigate (a11y). ?intent=create-event focuses the
                create form on arrival. */}
            <Link
              to="/admin/settings?intent=create-event"
              className="admin-shell__new-event lumen-focusable"
              data-testid="admin-new-event"
            >
              + New event
            </Link>
            <span
              className="admin-shell__event-active-name"
              data-testid="admin-active-event"
              hidden
            >
              {label}
            </span>
          </div>
          {/* F5 — permissioned ⌘K Find */}
          <div className="admin-shell__find-slot" data-testid="topbar-find-slot">
            <FindTrigger />
          </div>
          <div className="admin-shell__topbar-end" data-testid="admin-topbar-end">
            <Link
              to="/portal"
              className="admin-shell__view-portal lumen-focusable"
              data-testid="admin-view-portal"
            >
              View portal
            </Link>
            {/* Demo-role chip — small, subordinate (renders only when enabled).
                No eventId prop: keeps the exact pre-F1 switch payload. */}
            <RoleSwitcher />
          </div>
        </header>
        <main className="admin-shell__content" data-testid="admin-content">
          {children}
        </main>
      </div>
    </div>
    </ToastProvider>
  );
}
