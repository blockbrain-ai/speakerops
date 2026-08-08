/**
 * Admin chrome shell — Lumen IA sidebar (section 1.4).
 *
 * Nav labels locked in docs/governance/0.2-lumen-lock.md §6:
 * Overview | CFP / Forms | Submissions | Evaluations | Speakers | Schedule | Comms | Settings
 *
 * Route targets are structural placeholders (no fake domain mutations).
 * Product surfaces land in later sections and wire real COMMANDS.md APIs.
 */
import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";

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
  /** Active event label shown on mutating admin surfaces (placeholder until 2.3). */
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
          <div className="admin-shell__event" data-testid="admin-active-event">
            Event: {activeEventLabel}
          </div>
        </header>
        <main className="admin-shell__content" data-testid="admin-content">
          {children}
        </main>
      </div>
    </div>
  );
}
