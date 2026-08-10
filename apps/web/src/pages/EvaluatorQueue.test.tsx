/**
 * Section 3.4 / 11.4 — evaluator queue loading states.
 *
 * The "No matching assignments" empty state must never render while the queue
 * is still loading (live UX walk showed it flashing under the skeleton for
 * ~7s before data arrived). Initial render = loading → skeleton only.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createElement } from "react";
import { EvaluatorQueuePage } from "./EvaluatorQueue.js";

const errorSpy = vi
  .spyOn(console, "error")
  .mockImplementation((...args: unknown[]) => {
    const msg = String(args[0] ?? "");
    if (
      msg.includes("useLayoutEffect") ||
      msg.includes("ReactDOM.useLayoutEffect")
    ) {
      return;
    }
  });

afterEach(() => {
  errorSpy.mockClear();
});

describe("3.4 EvaluatorQueuePage loading states", () => {
  it("initial (loading) render shows the skeleton, never an empty state", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(EvaluatorQueuePage)),
    );
    expect(html).toContain('data-testid="eval-queue-loading"');
    // Empty states must wait for the load to complete
    expect(html).not.toContain('data-testid="eval-queue-filter-empty"');
    expect(html).not.toContain('data-testid="eval-queue-empty"');
    expect(html).not.toContain("No matching assignments");
    expect(html).not.toContain("No assigned submissions yet");
  });
});
