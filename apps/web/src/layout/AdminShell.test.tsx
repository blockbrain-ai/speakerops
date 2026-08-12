/**
 * Section 1.4 + 11.1 — AdminShell named assertions.
 * Spec: assert AdminShell renders nav label including 'CFP'
 * Section 11.1: icon nav, account/help, mobile nav toggle.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createElement } from "react";
import { AdminShell, ADMIN_NAV_ITEMS } from "./AdminShell.js";

/** NavLink uses useLayoutEffect; suppress expected SSR warnings in unit render. */
const errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
  const msg = String(args[0] ?? "");
  if (msg.includes("useLayoutEffect") || msg.includes("ReactDOM.useLayoutEffect")) return;
  // rethrow unexpected
  // eslint-disable-next-line no-console
  console.warn(...args);
});

afterEach(() => {
  errorSpy.mockClear();
});

function renderShell(path = "/admin") {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [path] },
      createElement(AdminShell, null, createElement("div", { "data-testid": "child" }, "child")),
    ),
  );
}

describe("1.4 AdminShell", () => {
  it("assert AdminShell renders nav label including 'CFP'", () => {
    const html = renderShell();
    expect(html).toContain("CFP");
    expect(html).toContain("CFP / Forms");
    expect(html).toMatch(/data-testid="nav-cfp"/);
  });

  it("sidebar includes Forms and Settings labels (Lumen IA)", () => {
    const html = renderShell();
    expect(html).toContain("Forms");
    expect(html).toContain("Settings");
    expect(html).toMatch(/data-testid="nav-settings"/);
    expect(html).toMatch(/data-testid="admin-sidebar"/);
  });

  it("exports full Lumen admin IA nav items", () => {
    const labels = ADMIN_NAV_ITEMS.map((i) => i.label);
    expect(labels).toEqual([
      "Overview",
      "CFP / Forms",
      "Submissions",
      "Files",
      "History",
      "Team",
      "Embeds",
      "Preview",
      "Analytics",
      "Evaluations",
      "Speakers",
      "Schedule",
      "Comms",
      "Settings",
    ]);
  });
});

describe("11.1 AdminShell Lumen2 shell chrome", () => {
  it("renders first-party icons on every nav item", () => {
    const html = renderShell();
    for (const item of ADMIN_NAV_ITEMS) {
      expect(html).toContain(`data-icon="${item.icon}"`);
      expect(html).toContain(`data-testid="${item.testId}"`);
    }
    expect(html).toContain('data-icon="home"');
    expect(html).toContain('data-icon="settings"');
  });

  it("exposes account/help area and sign-out control", () => {
    const html = renderShell();
    expect(html).toMatch(/data-testid="admin-account"/);
    expect(html).toMatch(/data-testid="admin-help"/);
    expect(html).toMatch(/data-testid="admin-sign-out"/);
    expect(html).toContain("Help");
    expect(html).toContain("Sign out");
  });

  it("exposes mobile nav toggle for 390px strategy", () => {
    const html = renderShell();
    expect(html).toMatch(/data-testid="admin-nav-toggle"/);
    expect(html).toMatch(/aria-controls="admin-sidebar"/);
    expect(html).toMatch(/data-testid="admin-nav-backdrop"/);
  });

  it("preserves event-context and page title anchors", () => {
    const html = renderShell("/admin/submissions");
    expect(html).toMatch(/data-testid="event-context"/);
    expect(html).toMatch(/data-testid="admin-page-title"/);
    expect(html).toContain("Submissions");
    expect(html).toMatch(/data-section="11.1"/);
  });

  it("every nav item carries a stable icon name", () => {
    for (const item of ADMIN_NAV_ITEMS) {
      expect(item.icon).toBeTruthy();
      expect(typeof item.icon).toBe("string");
    }
  });
});
