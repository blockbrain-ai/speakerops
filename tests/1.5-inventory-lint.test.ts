/**
 * Section 1.5 — inventory-lint fixture unit tests (Vitest).
 *
 * Named assertions from spec:
 * - assert inventory-lint exits 1 when REQUIRED id A01 missing from fixtures
 * - assert inventory-lint exits 0 when fixture tags all required subset
 * - assert playwright.config.ts exists (also in governance suite)
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFixtureInventory,
  lintInventoryFixtures,
  parseInventoryMarkdown,
  parseRequiredIds,
  pwTaggedSource,
} from "../scripts/inventory-lint.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("1.5 inventory-lint fixtures", () => {
  it("assert inventory-lint exits 1 when REQUIRED id A01 missing from fixtures", () => {
    const inventoryMarkdown = buildFixtureInventory([
      { id: "A01", status: "IMPLEMENTED", testId: "e2e/public/cfp-load" },
      { id: "A02", status: "OPEN", testId: "e2e/public/cfp-conditional" },
    ]);

    // Deliberate: no @inv:A01 in test sources
    const result = lintInventoryFixtures({
      inventoryMarkdown,
      requiredSubset: ["A01"],
      requireAllRequiredTags: true,
      testSources: {
        "empty.spec.ts":
          "import { test } from '@playwright/test';\n" +
          'test("untagged journey", async () => {});\n',
      },
      label: "missing-A01",
    });

    expect(result.exitCode).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("A01");
    expect(result.stderr).toMatch(/missing @inv|A01/i);
  });

  it("assert inventory-lint exits 0 when fixture tags all required subset", () => {
    const inventoryMarkdown = buildFixtureInventory([
      { id: "A01", status: "IMPLEMENTED", testId: "e2e/public/cfp-load" },
      { id: "A02", status: "IMPLEMENTED", testId: "e2e/public/cfp-conditional" },
      { id: "B01", status: "OPEN", testId: "e2e/auth/admin-login" },
    ]);

    const result = lintInventoryFixtures({
      inventoryMarkdown,
      requiredSubset: ["A01", "A02"],
      requireAllRequiredTags: true,
      testSources: {
        "public/cfp-load.spec.ts": pwTaggedSource("A01", "e2e/public/cfp-load"),
        "public/cfp-conditional.spec.ts": pwTaggedSource(
          "A02",
          "e2e/public/cfp-conditional",
        ),
      },
      label: "subset-tagged",
    });

    expect(result.exitCode).toBe(0);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.tagged).toEqual(expect.arrayContaining(["A01", "A02"]));
    expect(result.stdout).toMatch(/OK/i);
  });

  it("assert playwright.config.ts exists", () => {
    const configPath = join(root, "playwright.config.ts");
    expect(existsSync(configPath)).toBe(true);
  });

  it("parses Required column from inventory markdown", () => {
    const md = buildFixtureInventory([
      { id: "A01", status: "OPEN" },
      { id: "A02", status: "OPEN", required: false },
      { id: "B01", status: "IMPLEMENTED" },
    ]);
    const required = parseRequiredIds(md);
    expect(required).toEqual(["A01", "B01"]);
    const rows = parseInventoryMarkdown(md);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.id === "A02")?.required).toBe(false);
  });

  it("intermediate allow-missing-until leaves OPEN untagged OK", () => {
    const inventoryMarkdown = buildFixtureInventory([
      { id: "A01", status: "OPEN", testId: "e2e/public/cfp-load" },
      { id: "A02", status: "IMPLEMENTED", testId: "e2e/public/cfp-conditional" },
    ]);
    const result = lintInventoryFixtures({
      inventoryMarkdown,
      allowMissingUntil: "8.2",
      testSources: {
        "public/cfp-conditional.spec.ts": pwTaggedSource(
          "A02",
          "e2e/public/cfp-conditional",
        ),
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.tagTargets).toEqual(["A02"]);
  });

  it("strict mode (allow-missing off) fails when OPEN REQUIRED lacks @inv", () => {
    const inventoryMarkdown = buildFixtureInventory([
      { id: "A01", status: "OPEN", testId: "e2e/public/cfp-load" },
    ]);
    const result = lintInventoryFixtures({
      inventoryMarkdown,
      allowMissingUntil: null,
      testSources: {},
      label: "strict-open",
    });
    expect(result.exitCode).toBe(1);
    expect(result.missing).toContain("A01");
  });
});
