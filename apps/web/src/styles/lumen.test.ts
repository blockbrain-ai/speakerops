/**
 * Section 1.4 — lumen.css named assertions.
 * Spec: assert lumen.css defines --lumen-brand and --lumen-focus-ring
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const lumenCss = readFileSync(join(here, "lumen.css"), "utf8");

describe("1.4 lumen.css tokens", () => {
  it("assert lumen.css defines --lumen-brand and --lumen-focus-ring", () => {
    expect(lumenCss).toMatch(/--lumen-brand\s*:/);
    expect(lumenCss).toMatch(/--lumen-focus-ring\s*:/);
    expect(lumenCss).toMatch(/--lumen-focus\s*:/);
  });

  it("defines brand soft and status soft pairs", () => {
    expect(lumenCss).toMatch(/--lumen-brand-soft\s*:/);
    expect(lumenCss).toMatch(/--lumen-success-soft\s*:/);
    expect(lumenCss).toMatch(/--lumen-warn-soft\s*:/);
    expect(lumenCss).toMatch(/--lumen-danger-soft\s*:/);
    expect(lumenCss).toMatch(/--lumen-info-soft\s*:/);
    expect(lumenCss).toMatch(/--lumen-success\s*:/);
    expect(lumenCss).toMatch(/--lumen-warn\s*:/);
    expect(lumenCss).toMatch(/--lumen-danger\s*:/);
    expect(lumenCss).toMatch(/--lumen-info\s*:/);
  });

  it("is light-default (no dark-default theme)", () => {
    expect(lumenCss).toMatch(/--lumen-bg\s*:\s*#f5f5f7/);
    expect(lumenCss).toMatch(/color-scheme:\s*light/);
    // Must not set a dark body background as default
    expect(lumenCss).not.toMatch(/body\s*\{[^}]*background:\s*#0[0-9a-fA-F]{5}/);
  });

  it("includes focus ring utility class", () => {
    expect(lumenCss).toMatch(/\.lumen-focusable:focus-visible/);
    expect(lumenCss).toMatch(/box-shadow:\s*var\(--lumen-focus-ring\)/);
  });
});
