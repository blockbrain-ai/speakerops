/**
 * Section 1.5 — Playwright inventory harness governance assertions.
 *
 * Named tests from spec:
 * - assert inventory-lint exits 1 when REQUIRED id A01 missing from fixtures
 * - assert inventory-lint exits 0 when fixture tags all required subset
 * - assert playwright.config.ts exists
 *
 * Fixture exit 0/1 are also covered in tests/1.5-inventory-lint.test.ts (Vitest).
 * This suite locks files, CLI non-interactive, and docs convention.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const configPath = join(root, "playwright.config.ts");
const inventoryLintTs = join(root, "scripts", "inventory-lint.ts");
const e2eLintMjs = join(root, "scripts", "e2e-inventory-lint.mjs");
const harnessSpec = join(
  root,
  "playwright",
  "e2e",
  "_harness_example.spec.ts",
);
const e2eDoc = join(root, "docs", "E2E.md");
const sectionDoc = join(
  root,
  "docs",
  "sections",
  "1.5-playwright-inventory-harness.md",
);
const packageJsonPath = join(root, "package.json");
const e2eDir = join(root, "playwright", "e2e");

function fmtResult(r) {
  return `status=${r.status}\nsignal=${r.signal ?? ""}\nstdout=${r.stdout ?? ""}\nstderr=${r.stderr ?? ""}`;
}

describe("1.5 Playwright inventory harness", () => {
  it("assert playwright.config.ts exists", () => {
    assert.equal(
      existsSync(configPath),
      true,
      "playwright.config.ts must exist at workspace root",
    );
    const body = readFileSync(configPath, "utf8");
    assert.match(body, /defineConfig|@playwright\/test/);
    assert.match(body, /playwright\/e2e|testDir/);
  });

  it("scripts/inventory-lint.ts and docs/E2E.md exist", () => {
    assert.equal(existsSync(inventoryLintTs), true, "scripts/inventory-lint.ts");
    assert.equal(existsSync(e2eLintMjs), true, "scripts/e2e-inventory-lint.mjs");
    assert.equal(existsSync(e2eDoc), true, "docs/E2E.md");
    assert.equal(existsSync(sectionDoc), true, "docs/sections/1.5-…");
    assert.equal(existsSync(harnessSpec), true, "harness example spec");
    assert.equal(existsSync(e2eDir), true, "playwright/e2e/");
  });

  it("documents @inv:A01 convention", () => {
    const e2e = readFileSync(e2eDoc, "utf8");
    assert.match(e2e, /@inv:A01/);
    assert.match(e2e, /@inv:/);
    assert.match(e2e, /test:e2e:inventory|inventory-lint/);

    const harness = readFileSync(harnessSpec, "utf8");
    assert.match(harness, /@inv:A01/);
    assert.match(harness, /@playwright\/test/);
    assert.match(harness, /e2e\/public\/cfp-load/);

    const lintSrc = readFileSync(inventoryLintTs, "utf8");
    assert.match(lintSrc, /@inv:A01|@inv:ID/);
    assert.match(lintSrc, /allow-missing-until|allowMissingUntil/);
  });

  it("CI script non-interactive (package.json test:e2e:inventory → inventory-lint)", () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    assert.equal(typeof pkg.scripts["test:e2e"], "string");
    assert.equal(typeof pkg.scripts["test:e2e:inventory"], "string");
    assert.match(
      pkg.scripts["test:e2e:inventory"],
      /inventory-lint/,
      "test:e2e:inventory must invoke inventory-lint",
    );
    assert.doesNotMatch(
      pkg.scripts["test:e2e:inventory"],
      /--watch/,
      "inventory lint must not use --watch",
    );
    assert.doesNotMatch(
      pkg.scripts["test:e2e"],
      /--watch/,
      "test:e2e must not use --watch",
    );
    assert.ok(
      pkg.devDependencies?.["@playwright/test"] ||
        pkg.dependencies?.["@playwright/test"],
      "@playwright/test must be a dependency",
    );
  });

  it("assert inventory-lint exits 1 when REQUIRED id A01 missing from fixtures", () => {
    // Fixture unit via in-process full engine + probe (same semantics as Vitest).
    // Spawn a tiny runner so node:test does not need to import TypeScript.
    const probe = mkdtempSync(join(tmpdir(), "spo-1.5-missing-"));
    try {
      const invPath = join(probe, "inv.md");
      const e2eRoot = join(probe, "playwright", "e2e");
      mkdirSync(e2eRoot, { recursive: true });
      writeFileSync(
        invPath,
        `| ID | Role | Surface | Journey | test_id | Negative | Required | Status |\n` +
          `|----|------|---------|---------|---------|----------|--------|\n` +
          `| A01 | public | /cfp | Load form | e2e/public/cfp-load | 404 | REQUIRED | IMPLEMENTED |\n`,
        "utf8",
      );
      writeFileSync(
        join(e2eRoot, "untagged.spec.ts"),
        `import { test } from '@playwright/test';\ntest("no inv tag", async () => {});\n`,
        "utf8",
      );

      // Minimal baseline matching A01 only for this probe — use full workspace
      // baseline would fail anti-shrinkage; call runInventoryLint with overrides
      // via a one-shot tsx eval importing fixture API.
      const runner = join(probe, "run.mjs");
      writeFileSync(
        runner,
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
  console.error(JSON.stringify(result, null, 2));
  process.exit(2);
}
console.log("OK missing-A01 exit=1");
process.exit(0);
`,
        "utf8",
      );

      const childEnv = { ...process.env };
      delete childEnv.NODE_TEST_CONTEXT;
      delete childEnv.NODE_TEST_NAME;
      const result = spawnSync(
        "pnpm",
        ["exec", "tsx", runner],
        {
          cwd: root,
          encoding: "utf8",
          env: childEnv,
          timeout: 30_000,
        },
      );
      assert.equal(
        result.status,
        0,
        `fixture runner must confirm exit 1 for missing A01:\n${fmtResult(result)}`,
      );
      assert.match(result.stdout ?? "", /OK missing-A01/);
    } finally {
      rmSync(probe, { recursive: true, force: true });
    }
  });

  it("assert inventory-lint exits 0 when fixture tags all required subset", () => {
    const probe = mkdtempSync(join(tmpdir(), "spo-1.5-ok-"));
    try {
      const runner = join(probe, "run.mjs");
      writeFileSync(
        runner,
        `
import {
  buildFixtureInventory,
  lintInventoryFixtures,
  pwTaggedSource,
} from ${JSON.stringify(inventoryLintTs)};

const inventoryMarkdown = buildFixtureInventory([
  { id: "A01", status: "IMPLEMENTED", testId: "e2e/public/cfp-load" },
  { id: "A02", status: "IMPLEMENTED", testId: "e2e/public/cfp-conditional" },
]);
const result = lintInventoryFixtures({
  inventoryMarkdown,
  requiredSubset: ["A01", "A02"],
  requireAllRequiredTags: true,
  testSources: {
    "a.spec.ts": pwTaggedSource("A01", "e2e/public/cfp-load"),
    "b.spec.ts": pwTaggedSource("A02", "e2e/public/cfp-conditional"),
  },
  label: "gov-subset-ok",
});
if (result.exitCode !== 0) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(2);
}
console.log("OK subset-tagged exit=0");
process.exit(0);
`,
        "utf8",
      );

      const childEnv = { ...process.env };
      delete childEnv.NODE_TEST_CONTEXT;
      delete childEnv.NODE_TEST_NAME;
      const result = spawnSync(
        "pnpm",
        ["exec", "tsx", runner],
        {
          cwd: root,
          encoding: "utf8",
          env: childEnv,
          timeout: 30_000,
        },
      );
      assert.equal(
        result.status,
        0,
        `fixture runner must confirm exit 0 for tagged subset:\n${fmtResult(result)}`,
      );
      assert.match(result.stdout ?? "", /OK subset-tagged/);
    } finally {
      rmSync(probe, { recursive: true, force: true });
    }
  });

  it("workspace inventory lint (pnpm test:e2e:inventory) exits 0", () => {
    const childEnv = { ...process.env };
    delete childEnv.NODE_TEST_CONTEXT;
    delete childEnv.NODE_TEST_NAME;
    delete childEnv.E2E_INVENTORY_GATE;
    const result = spawnSync("pnpm", ["test:e2e:inventory"], {
      cwd: root,
      encoding: "utf8",
      env: childEnv,
      timeout: 120_000,
    });
    assert.equal(
      result.status,
      0,
      `test:e2e:inventory must pass:\n${fmtResult(result)}`,
    );
    assert.match(`${result.stdout ?? ""}\n${result.stderr ?? ""}`, /OK/i);
  });

  it("section 1.5 scope: no product HTTP handlers invented", () => {
    assert.equal(existsSync(sectionDoc), true);
    const body = readFileSync(sectionDoc, "utf8");
    assert.match(body, /1\.5|Playwright inventory harness/i);
    assert.match(body, /N\/A|no product HTTP|no new HTTP/i);
    assert.match(body, /@inv:A01/);
  });
});
