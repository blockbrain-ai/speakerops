/**
 * Section 8.1 — Inventory completeness audit (Vitest).
 *
 * Named assertions from spec:
 * - assert lint fails on missing REQUIRED tag
 * - assert crawl fails on unmapped primary button fixture
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFixtureInventory,
  crawlFailsOnUnmappedPrimary,
  crawlPrimaryControls,
  lintInventoryFixtures,
  loadCrawlAllowlist,
  parseRequiredIds,
  pwTaggedSource,
  runWorkspaceAdminCrawl,
  runWorkspaceInventoryLint,
} from "../scripts/inventory-lint.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const allowlistPath = join(root, "scripts", "ui-crawl-allowlist.json");
const sectionDoc = join(root, "docs", "sections", "8.1-inventory-completeness.md");

describe("8.1 inventory completeness audit", () => {
  it("assert lint fails on missing REQUIRED tag", () => {
    const inventoryMarkdown = buildFixtureInventory([
      { id: "A01", status: "IMPLEMENTED", testId: "e2e/public/cfp-load" },
      { id: "C01", status: "PASS", testId: "e2e/admin/event-create" },
    ]);

    const result = lintInventoryFixtures({
      inventoryMarkdown,
      requiredSubset: ["A01", "C01"],
      requireAllRequiredTags: true,
      testSources: {
        // Deliberate: C01 tagged, A01 missing
        "admin/event-create.spec.ts": pwTaggedSource(
          "C01",
          "e2e/admin/event-create",
        ),
      },
      label: "8.1-missing-required-tag",
    });

    expect(result.exitCode).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("A01");
    expect(result.stderr).toMatch(/missing @inv|A01/i);
  });

  it("assert crawl fails on unmapped primary button fixture", () => {
    const allowlist = loadCrawlAllowlist(allowlistPath);
    const html = `
      <div data-testid="admin-shell">
        <button type="button" data-testid="rogue-primary-action">Do something</button>
        <button type="submit" data-testid="form-publish">Publish</button>
      </div>
    `;

    const result = crawlFailsOnUnmappedPrimary(html, allowlist, [
      "D08",
      "A01",
      "C01",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.unmapped.some((c) => c.testid === "rogue-primary-action")).toBe(
      true,
    );
    expect(result.stderr).toMatch(/unmapped primary|rogue-primary-action/i);
    // Known mapped control from controlMap still resolves
    expect(result.mapped.some((c) => c.testid === "form-publish" && c.inv === "D08")).toBe(
      true,
    );
  });

  it("crawl allowlist is documented and loadable", () => {
    expect(existsSync(allowlistPath)).toBe(true);
    const allowlist = loadCrawlAllowlist(allowlistPath);
    expect(allowlist.version).toBeGreaterThanOrEqual(1);
    expect(allowlist.chrome.length).toBeGreaterThan(0);
    expect(allowlist.controlMap.length).toBeGreaterThan(0);
    expect(allowlist.description ?? "").toMatch(/chrome|crawl|primary/i);
    // Every chrome entry has a non-empty reason (no silent exemptions)
    for (const c of allowlist.chrome) {
      expect(c.testid.length).toBeGreaterThan(0);
      expect(c.reason.trim().length).toBeGreaterThan(0);
    }
    for (const m of allowlist.controlMap) {
      expect(m.inv).toMatch(/^(?:[A-Z]\d{2}|L2-\d{2})$/);
    }
  });

  it("mapped primary button fixture passes crawl", () => {
    const allowlist = loadCrawlAllowlist(allowlistPath);
    const html = `
      <button type="button" data-testid="form-publish">Publish</button>
      <button type="button" data-testid="design-preview-button">Sample</button>
    `;
    const result = crawlPrimaryControls({
      allowlist,
      sources: { "ok.html": html },
      inventoryIds: parseRequiredIds(
        buildFixtureInventory([
          { id: "D08", status: "PASS" },
          { id: "C05", status: "PASS" },
        ]),
      ),
      label: "mapped-ok",
    });
    expect(result.exitCode).toBe(0);
    expect(result.unmapped).toEqual([]);
    expect(result.mapped.some((c) => c.inv === "D08")).toBe(true);
    expect(result.chromeSkipped.some((c) => c.testid === "design-preview-button")).toBe(
      true,
    );
  });

  it("workspace admin crawl exits 0 (all primary controls mapped)", () => {
    const result = runWorkspaceAdminCrawl({ root, silent: true });
    expect(result.exitCode).toBe(0);
    expect(result.ok).toBe(true);
    expect(result.unmapped).toEqual([]);
    expect(result.mapped.length).toBeGreaterThan(0);
  });

  it("workspace inventory lint (tags + crawl) exits 0", () => {
    const result = runWorkspaceInventoryLint({
      root,
      argv: ["node", "scripts/inventory-lint.ts"],
      silent: true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.ok).toBe(true);
  });

  it("section doc documents crawl allowlist and ACs", () => {
    expect(existsSync(sectionDoc)).toBe(true);
    const body = readFileSync(sectionDoc, "utf8");
    expect(body).toMatch(/8\.1/);
    expect(body).toMatch(/ui-crawl-allowlist/);
    expect(body).toMatch(/missing REQUIRED tag|@inv/i);
    expect(body).toMatch(/unmapped primary/i);
  });
});
