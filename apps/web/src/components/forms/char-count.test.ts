/**
 * Post-11.9 depth Wave 1A — character counter model (pure).
 * Warning at ≥80% of the cap; over past it; ok otherwise.
 */
import { describe, it, expect } from "vitest";
import {
  charCountTone,
  charCountLabel,
  charCountOverMessage,
} from "./char-count.js";

describe("char-count tone model", () => {
  it("stays ok well under the cap", () => {
    expect(charCountTone(0, 20)).toBe("ok");
    expect(charCountTone(15, 20)).toBe("ok");
  });

  it("turns warning at 80% of the cap (ceil)", () => {
    expect(charCountTone(16, 20)).toBe("warn");
    expect(charCountTone(20, 20)).toBe("warn");
    // Odd caps round up: ceil(25 * 0.8) = 20
    expect(charCountTone(19, 25)).toBe("ok");
    expect(charCountTone(20, 25)).toBe("warn");
  });

  it("goes over past the cap", () => {
    expect(charCountTone(21, 20)).toBe("over");
  });

  it("treats non-positive caps as ok (no cap)", () => {
    expect(charCountTone(999, 0)).toBe("ok");
  });

  it("labels with locale separators and human error copy", () => {
    expect(charCountLabel(5, 20)).toBe("5 / 20 characters");
    expect(charCountOverMessage("Abstract", 500)).toBe(
      "Abstract is limited to 500 characters",
    );
  });
});
