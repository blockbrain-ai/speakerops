/**
 * Admin chrome shell — Lumen IA sidebar (section 1.4) + active event switcher (2.3).
 *
 * Nav labels locked in docs/governance/0.2-lumen-lock.md §6:
 * Overview | CFP / Forms | Submissions | Evaluations | Speakers | Schedule | Comms | Settings
 *
 * Active event context: data-testid="event-context" (C02).
 */
import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useEventContextOptional } from "../events/EventContext.js";

export type AdminNavItem = {
  /** Stable path segment under /admin */
  path: string;
  /** Visible sidebar label (Lumen IA) */
  label: string;
  /** data-testid for inventory / e2e anchors */
  testId: string;
};

/** Canonical admin IA — do not invent CRM/Marketing modules. */
export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  { path: "/admin", label: "Overview", testId: "nav-overview" },
  { path: "/admin/cfp", label: "CFP / Forms", testId: "nav-cfp" },
  { path: "/admin/submissions", label: "Submissions", testId: "nav-submissions" },
  { path: "/admin/evaluations", label: "Evaluations", testId: "nav-evaluations" },
  { path: "/admin/speakers", label: "Speakers", testId: "nav-speakers" },
  { path: "/admin/schedule", label: "Schedule", testId: "nav-schedule" },
  { path: "/admin/comms", label: "Comms", testId: "nav-comms" },
  { path: "/admin/settings", label: "Settings", testId: "nav-settings" },
] as const;

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
  if (pathname.startsWith("/admin/settings/rubric")) return "Eval rubric";
  if (pathname.startsWith("/admin/settings/task-templates")) return "Task templates";
  if (pathname.startsWith("/admin/settings/api-keys")) return "API keys";
  if (pathname.startsWith("/admin/settings/airtable")) return "Airtable status";
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
  const pageTitle = titleForPath(pathname);
  const eventCtx = useEventContextOptional();

  const label =
    eventCtx?.activeEvent?.name ??
    eventCtx?.activeEventId ??
    activeEventLabel;

  return (
    <div className="admin-shell" data-testid="admin-shell" data-section="1.4">
      <aside
        className="admin-shell__sidebar"
        data-testid="admin-sidebar"
        aria-label="Admin navigation"
      >
        <div className="admin-shell__brand">
          <p className="admin-shell__brand-name">SpeakerOps</p>
          <p className="admin-shell__brand-meta">Admin</p>
        </div>
        <nav className="admin-shell__nav" data-testid="admin-nav" aria-label="Primary">
          {ADMIN_NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/admin"}
              className={navLinkClass}
              data-testid={item.testId}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="admin-shell__main">
        <header className="admin-shell__header">
          <h1 className="admin-shell__title" data-testid="admin-page-title">
            {pageTitle}
          </h1>
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
            ) : (
              <div
                className="admin-shell__event"
                data-testid="event-context"
                data-event-id={eventCtx?.activeEventId ?? ""}
              >
                Event: {label}
              </div>
            )}
            <span
              className="admin-shell__event-active-name"
              data-testid="admin-active-event"
              hidden
            >
              {label}
            </span>
          </div>
        </header>
        <main className="admin-shell__content" data-testid="admin-content">
          {children}
        </main>
      </div>
    </div>
  );
}
