/**
 * Settings two-pane shell — section 11.7 (S-L2-A11Y).
 *
 * Desktop: category nav (left) + detail content (right).
 * Mobile: category list remains reachable; content stacks below.
 *
 * Page-atlas: Event · Evaluation rubric · Task templates · Event brand · API keys · Airtable
 */
import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Icon, type IconName } from "../components/ui/Icon.js";

export type SettingsNavItem = {
  path: string;
  label: string;
  testId: string;
  icon: IconName;
  description: string;
  /** Match with end for exact `/admin/settings` only. */
  end?: boolean;
};

/** Canonical settings IA — do not invent CRM/Marketing modules. */
export const SETTINGS_NAV_ITEMS: readonly SettingsNavItem[] = [
  {
    path: "/admin/settings",
    label: "Event",
    testId: "settings-nav-event",
    icon: "calendar",
    description: "Name, dates, rooms, and tracks",
    end: true,
  },
  {
    path: "/admin/settings/rubric",
    label: "Evaluation rubric",
    testId: "settings-nav-rubric",
    icon: "check",
    description: "Criteria evaluators score against",
  },
  {
    path: "/admin/settings/task-templates",
    label: "Task templates",
    testId: "settings-nav-task-templates",
    icon: "file",
    description: "Speaker readiness checklist",
  },
  {
    path: "/admin/settings/design",
    label: "Event brand",
    testId: "settings-nav-design",
    icon: "spark",
    description: "Public CFP colours and logo",
  },
  {
    path: "/admin/settings/api-keys",
    label: "API keys",
    testId: "settings-nav-api-keys",
    icon: "settings",
    description: "Scoped machine credentials",
  },
  {
    path: "/admin/settings/integrations",
    label: "Integrations",
    testId: "settings-nav-airtable",
    icon: "external",
    description: "One-way Airtable and Accelevents projectors",
  },
] as const;

export type SettingsShellProps = {
  children: ReactNode;
};

function navClass({ isActive }: { isActive: boolean }): string {
  return [
    "settings-shell__nav-link",
    "lumen-focusable",
    isActive ? "settings-shell__nav-link--active" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function titleForSettingsPath(pathname: string): string {
  if (pathname.startsWith("/admin/settings/design")) return "Event brand";
  if (pathname.startsWith("/admin/settings/l2-state-sheet"))
    return "Lumen 2 state sheet";
  if (pathname.startsWith("/admin/settings/rubric")) return "Evaluation rubric";
  if (pathname.startsWith("/admin/settings/task-templates"))
    return "Task templates";
  if (pathname.startsWith("/admin/settings/api-keys")) return "API keys";
  if (pathname.startsWith("/admin/settings/airtable")) return "Integrations";
  if (pathname.startsWith("/admin/settings/integrations")) return "Integrations";
  if (pathname === "/admin/settings" || pathname === "/admin/settings/")
    return "Event";
  return "Settings";
}

export function SettingsShell({ children }: SettingsShellProps) {
  const { pathname } = useLocation();
  const sectionTitle = titleForSettingsPath(pathname);

  return (
    <div
      className="settings-shell"
      data-testid="settings-shell"
      data-section="11.7"
      data-layout="two-pane"
    >
      <aside
        className="settings-shell__nav"
        data-testid="settings-nav"
        aria-label="Settings categories"
      >
        <p className="settings-shell__nav-heading" id="settings-nav-heading">
          Settings
        </p>
        <nav
          className="settings-shell__nav-list"
          aria-labelledby="settings-nav-heading"
        >
          {SETTINGS_NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.end === true}
              className={navClass}
              data-testid={item.testId}
              aria-current={undefined}
            >
              <Icon name={item.icon} size="sm" decorative />
              <span className="settings-shell__nav-text">
                <span className="settings-shell__nav-label">{item.label}</span>
                <span className="settings-shell__nav-desc">
                  {item.description}
                </span>
              </span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <div
        className="settings-shell__content"
        data-testid="settings-content"
        role="region"
        aria-label={sectionTitle}
      >
        {children}
      </div>
    </div>
  );
}
