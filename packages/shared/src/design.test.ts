/**
 * Design Kit pure helpers — contrast gate, CSS vars, soft tint (section 2.4).
 */
import { describe, it, expect } from "vitest";
import {
  contrastRatio,
  deriveBrandFg,
  validateContrastGate,
  designTokensToCssVariables,
  softTintFromBrand,
  parseHexRgb,
  LOGO_MIME_ALLOWLIST,
} from "./design.js";

describe("design contrast helpers", () => {
  it("assert publish with brand #fffffe fails contrast or derives safe fg", () => {
    const fg = deriveBrandFg("#fffffe");
    expect(fg.toLowerCase()).not.toBe("#ffffff");
    const ratio = contrastRatio("#fffffe", fg);
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThanOrEqual(4.5);

    const gate = validateContrastGate({ brand: "#fffffe", radius: "soft" });
    expect(gate.ok).toBe(true);
    if (gate.ok) {
      expect(gate.tokens.brandFg).toBe(gate.brandFg);
      expect(gate.ratio).toBeGreaterThanOrEqual(3);
    }
  });

  it("deep sage brand derives light fg", () => {
    const fg = deriveBrandFg("#3e6b50");
    expect(fg.toLowerCase()).toBe("#ffffff");
    expect(contrastRatio("#3e6b50", fg)!).toBeGreaterThanOrEqual(3);
  });

  it("designTokensToCssVariables emits brand only (no freeform)", () => {
    const css = designTokensToCssVariables({
      brand: "#112233",
      brandSoft: "#e8eef5",
      radius: "curvy",
      wordmark: "Demo",
      logoFileId: null,
      brandFg: "#ffffff",
    });
    expect(css).toContain("--lumen-brand: #112233");
    expect(css).toContain("--lumen-brand-fg: #ffffff");
    expect(css).not.toMatch(/<\/?script/i);
    expect(css).not.toContain("expression(");
  });

  it("softTintFromBrand returns valid hex", () => {
    const soft = softTintFromBrand("#7ba88b");
    expect(parseHexRgb(soft)).not.toBeNull();
  });

  it("logo mime allowlist is PNG only", () => {
    expect(LOGO_MIME_ALLOWLIST).toEqual(["image/png"]);
    expect(LOGO_MIME_ALLOWLIST).not.toContain("image/svg+xml");
  });
});
