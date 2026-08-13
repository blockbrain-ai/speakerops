/**
 * Section 11.7 — Settings two-pane shell unit proof.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { SettingsShell, SETTINGS_NAV_ITEMS } from "./SettingsShell.js";

describe("11.7 SettingsShell two-pane", () => {
  it("exports canonical settings categories", () => {
    const labels = SETTINGS_NAV_ITEMS.map((i) => i.label);
    expect(labels).toEqual([
      "Event",
      "Evaluation rubric",
      "Task templates",
      "Event brand",
      "API keys",
      "Integrations",
    ]);
  });

  it("renders two-pane shell with nav and content region", () => {
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/admin/settings"] },
        createElement(
          SettingsShell,
          null,
          createElement("div", { "data-testid": "child" }, "Event body"),
        ),
      ),
    );
    expect(markup).toContain('data-testid="settings-shell"');
    expect(markup).toContain('data-layout="two-pane"');
    expect(markup).toContain('data-testid="settings-nav"');
    expect(markup).toContain('data-testid="settings-content"');
    expect(markup).toContain('data-testid="settings-nav-event"');
    expect(markup).toContain('data-testid="settings-nav-design"');
    expect(markup).toContain("Event body");
  });
});
