import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Wizard, canActivateWizardStep, type WizardStep } from "./Wizard.js";

const steps: WizardStep[] = [
  { id: "a", label: "A", valid: true },
  { id: "b", label: "B", valid: false },
  { id: "c", label: "C", valid: false },
];

describe("Wizard D1", () => {
  it("canActivateWizardStep requires prior steps valid", () => {
    expect(canActivateWizardStep(steps, "a")).toBe(true);
    expect(canActivateWizardStep(steps, "b")).toBe(true);
    expect(canActivateWizardStep(steps, "c")).toBe(false);
  });

  it("renders active step children only and nav testids", () => {
    const html = renderToStaticMarkup(
      createElement(
        Wizard,
        {
          steps,
          activeId: "a",
          onStepChange: () => {},
          stepNavTestId: (id) => `comms-step-nav-${id}`,
          "data-testid": "comms-wizard",
        },
        createElement("div", { "data-testid": "only-active" }, "A body"),
      ),
    );
    expect(html).toContain("data-testid=\"comms-wizard\"");
    expect(html).toContain("data-testid=\"comms-step-nav-a\"");
    expect(html).toContain("data-testid=\"comms-wizard-next\"");
    expect(html).toContain("data-testid=\"only-active\"");
    expect(html).toContain("A body");
  });
});
