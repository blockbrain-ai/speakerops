/**
 * Section 3.5 — submission detail control gating (assign/decision).
 * Mirrors server eligibility so controls disable instead of 400ing.
 */
import { describe, it, expect } from "vitest";
import {
  assignIneligibleReason,
  decisionIneligibleReason,
} from "./submissions-eligibility.js";

describe("3.5 assignIneligibleReason", () => {
  it("allows submitted and in_review", () => {
    expect(assignIneligibleReason("submitted")).toBeNull();
    expect(assignIneligibleReason("in_review")).toBeNull();
  });

  it("blocks draft, waitlist, accepted, rejected, withdrawn with a reason", () => {
    for (const status of [
      "draft",
      "waitlist",
      "accepted",
      "rejected",
      "withdrawn",
    ]) {
      const reason = assignIneligibleReason(status);
      expect(reason, `status ${status} must block assign`).toBeTruthy();
    }
    expect(assignIneligibleReason("draft")).toMatch(/draft/i);
    expect(assignIneligibleReason("waitlist")).toMatch(/waitlist/);
  });
});

describe("3.5 decisionIneligibleReason", () => {
  it("allows decision sources including re-decisions", () => {
    for (const status of [
      "submitted",
      "in_review",
      "accepted",
      "rejected",
      "waitlist",
    ]) {
      expect(
        decisionIneligibleReason(status),
        `status ${status} must allow decisions`,
      ).toBeNull();
    }
  });

  it("blocks draft and withdrawn with a reason", () => {
    expect(decisionIneligibleReason("draft")).toMatch(/draft/i);
    expect(decisionIneligibleReason("withdrawn")).toMatch(/withdrawn/);
  });
});
