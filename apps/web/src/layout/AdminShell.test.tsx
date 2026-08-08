/**
 * Section 1.4 — AdminShell named assertion.
 * Spec: assert AdminShell renders nav label including 'CFP'
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
      "Evaluations",
      "Speakers",
      "Schedule",
      "Comms",
      "Settings",
    ]);
  });
});
