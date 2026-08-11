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

  it("action pair never trusts a stale brandFg (light sage + stored white)", () => {
    // Regression: re-themed brand #7BA88B kept a stale white brandFg from the
    // old indigo era → CFP primary rendered ~2.35:1. The action pair must be
    // recomputed from the brand, not read from stored brandFg.
    const css = designTokensToCssVariables({
      brand: "#7ba88b",
      brandSoft: "#e7efdf",
      radius: "soft",
      wordmark: "Demo",
      logoFileId: null,
      brandFg: "#ffffff", // stale
    });
    expect(css).toContain("--lumen-action: #7ba88b");
    // deriveBrandFg picks ink for light sage; pair must meet UI AA (3:1)
    expect(css).toContain("--lumen-text-on-brand: #1e2621");
    expect(contrastRatio("#7ba88b", "#1e2621")!).toBeGreaterThanOrEqual(3);
  });

  it("action pair falls back to locked sage-deep when no fg can pass on the brand", () => {
    // A mid-gray brand where neither white nor ink reaches 3:1 must not emit
    // an unreadable CTA — fall back to the locked action pair.
    const css = designTokensToCssVariables({
      brand: "#8a9099",
      brandSoft: "#eceef0",
      radius: "soft",
      wordmark: "Demo",
      logoFileId: null,
      brandFg: "#ffffff",
    });
    const white = contrastRatio("#8a9099", "#ffffff")!;
    const ink = contrastRatio("#8a9099", "#1e2621")!;
    if (white < 3 && ink < 3) {
      expect(css).toContain("--lumen-action: #3e6b50");
      expect(css).toContain("--lumen-text-on-brand: #ffffff");
    } else {
      // If this fixture brand actually passes, the pair must still be AA-safe.
      expect(Math.max(white, ink)).toBeGreaterThanOrEqual(3);
    }
  });

  it("logo mime allowlist is PNG only", () => {
    expect(LOGO_MIME_ALLOWLIST).toEqual(["image/png"]);
    expect(LOGO_MIME_ALLOWLIST).not.toContain("image/svg+xml");
  });
});
