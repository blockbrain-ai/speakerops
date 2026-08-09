/**
 * Section 8.1 — Inventory completeness audit governance assertions.
 *
 * Named tests from spec:
 * - assert lint fails on missing REQUIRED tag
 * - assert crawl fails on unmapped primary button fixture
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const allowlistPath = join(root, "scripts", "ui-crawl-allowlist.json");
const inventoryLintTs = join(root, "scripts", "inventory-lint.ts");
const sectionDoc = join(
  root,
  "docs",
  "sections",
  "8.1-inventory-completeness.md",
);
const e2eDoc = join(root, "docs", "E2E.md");
const packageJsonPath = join(root, "package.json");
const vitestPath = join(root, "tests", "8.1-inventory-completeness.test.ts");

function fmt(r) {
  return `status=${r.status}\nsignal=${r.signal ?? ""}\nstdout=${r.stdout ?? ""}\nstderr=${r.stderr ?? ""}`;
}

describe("8.1 Inventory completeness audit", () => {
  it("deliverables exist (lint, allowlist, section doc, vitest)", () => {
    assert.equal(existsSync(inventoryLintTs), true, "scripts/inventory-lint.ts");
    assert.equal(existsSync(allowlistPath), true, "scripts/ui-crawl-allowlist.json");
    assert.equal(existsSync(sectionDoc), true, "docs/sections/8.1-…");
    assert.equal(existsSync(vitestPath), true, "tests/8.1-inventory-completeness.test.ts");
  });

  it("assert lint fails on missing REQUIRED tag (fixture via vitest file presence + unit)", async () => {
    // Dynamic import of TS helpers through tsx-compiled path is heavy; re-check via spawn of node --import tsx
    const r = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "-e",
        `
import {
  buildFixtureInventory,
  lintInventoryFixtures,
  pwTaggedSource,
} from ${JSON.stringify(inventoryLintTs)};
const inventoryMarkdown = buildFixtureInventory([
  { id: "A01", status: "IMPLEMENTED", testId: "e2e/public/cfp-load" },
]);
const result = lintInventoryFixtures({
  inventoryMarkdown,
  requiredSubset: ["A01"],
  requireAllRequiredTags: true,
  testSources: {
    "empty.spec.ts": "import { test } from '@playwright/test';\\ntest(\\"untagged\\", async () => {});\\n",
  },
  label: "gov-missing-A01",
});
if (result.exitCode !== 1 || !result.missing.includes("A01")) {
  console.error(JSON.stringify(result));
  process.exit(2);
}
process.exit(0);
`,
      ],
      { cwd: root, encoding: "utf8", env: process.env },
    );
    assert.equal(r.status, 0, fmt(r));
  });

  it("assert crawl fails on unmapped primary button fixture", () => {
    const r = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "-e",
        `
import {
  crawlFailsOnUnmappedPrimary,
  loadCrawlAllowlist,
} from ${JSON.stringify(inventoryLintTs)};
const allowlist = loadCrawlAllowlist(${JSON.stringify(allowlistPath)});
const html = '<button type="button" data-testid="rogue-primary-action">X</button>';
const result = crawlFailsOnUnmappedPrimary(html, allowlist, ["D08"]);
if (result.exitCode !== 1) {
  console.error(JSON.stringify(result));
  process.exit(2);
}
if (!result.unmapped.some((c) => c.testid === "rogue-primary-action")) {
  console.error("expected rogue-primary-action unmapped", result);
  process.exit(3);
}
process.exit(0);
`,
      ],
      { cwd: root, encoding: "utf8", env: process.env },
    );
    assert.equal(r.status, 0, fmt(r));
  });

  it("crawl allowlist documents pure chrome reasons", () => {
    const raw = JSON.parse(readFileSync(allowlistPath, "utf8"));
    assert.ok(Array.isArray(raw.chrome) && raw.chrome.length > 0);
    assert.ok(Array.isArray(raw.controlMap) && raw.controlMap.length > 0);
    assert.match(String(raw.description ?? ""), /chrome|crawl|primary/i);
    for (const c of raw.chrome) {
      assert.ok(c.testid && c.reason, "chrome needs testid+reason");
    }
    for (const m of raw.controlMap) {
      assert.match(m.inv, /^(?:[A-Z]\d{2}|L2-\d{2})$/);
    }
  });

  it("pnpm test:e2e:inventory exits 0 (tags + crawl)", () => {
    const r = spawnSync("pnpm", ["test:e2e:inventory"], {
      cwd: root,
      encoding: "utf8",
      env: process.env,
      shell: false,
    });
    assert.equal(r.status, 0, fmt(r));
    assert.match(
      `${r.stdout}\n${r.stderr}`,
      /admin discovery crawl|inventory-crawl: OK/i,
    );
  });

  it("package.json wires test:e2e:inventory non-interactively", () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    assert.equal(pkg.scripts["test:e2e:inventory"], "tsx scripts/inventory-lint.ts");
    assert.equal(/--watch/.test(pkg.scripts["test:e2e:inventory"]), false);
  });

  it("docs mention discovery crawl allowlist (8.1)", () => {
    const section = readFileSync(sectionDoc, "utf8");
    assert.match(section, /ui-crawl-allowlist/);
    assert.match(section, /S-E2E-INV|inventory completeness/i);
    assert.match(section, /assert lint fails on missing REQUIRED tag/i);
    assert.match(section, /assert crawl fails on unmapped primary button fixture/i);

    const e2e = readFileSync(e2eDoc, "utf8");
    assert.match(e2e, /ui-crawl-allowlist|discovery crawl/i);
  });

  it("no product HTTP handlers invented in 8.1 section doc", () => {
    const section = readFileSync(sectionDoc, "utf8");
    assert.match(section, /N\/A|no new product HTTP handlers/i);
  });
});
