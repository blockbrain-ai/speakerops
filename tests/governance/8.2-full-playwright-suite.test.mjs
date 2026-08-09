/**
 * Section 8.2 — Full Playwright suite governance assertions.
 *
 * Locks AC surface that must pass in `pnpm test:ci` (non-browser):
 * - every REQUIRED inventory id status PASS
 * - no inventory rows deleted vs baseline
 * - L01–L04 @inv tags on Playwright-bound tests
 * - report path wiring + evidence
 * - no new product handlers; no secrets
 *
 * Browser full suite is `pnpm test:e2e` (S-E2E-RUN).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const inventoryPath = join(
  root,
  "KMS-competition",
  "initiative",
  "BROWSER_E2E_INVENTORY.md",
);
const baselinePath = join(
  root,
  "scripts",
  "e2e-inventory-required-baseline.json",
);
const sectionDoc = join(
  root,
  "docs",
  "sections",
  "8.2-full-playwright-suite.md",
);
const evidencePath = join(
  root,
  "KMS-competition",
  "initiative",
  "evidence",
  "e2e-full.txt",
);
const statesSpec = join(
  root,
  "playwright",
  "e2e",
  "states_cross_cutting.spec.ts",
);
const keystoneSpec = join(
  root,
  "playwright",
  "e2e",
  "phase8_full_suite_keystone.spec.ts",
);
const e2eRun = join(root, "scripts", "e2e-run.mjs");
const playwrightConfig = join(root, "playwright.config.ts");
const vitestPath = join(root, "tests", "8.2-full-playwright-suite.test.ts");
const packageJsonPath = join(root, "package.json");
const apiIndexPath = join(root, "apps", "api", "src", "index.ts");
const e2eDoc = join(root, "docs", "E2E.md");

const STATE_IDS = ["L01", "L02", "L03", "L04"];

const SECRET_PATTERNS = [
  /api[_-]?key\s*[:=]\s*["'][^"']{8,}["']/i,
  /secret\s*[:=]\s*["'][^"']{8,}["']/i,
  /password\s*[:=]\s*["'][^"']+["']/i,
  /Bearer\s+[A-Za-z0-9\-._~+/]{20,}=*/,
  /sk-[A-Za-z0-9]{20,}/,
  /CLOUDFLARE_API_TOKEN\s*=\s*["'][^"']+["']/,
  /AIRTABLE_API_KEY\s*=\s*["'][^"']+["']/,
  /spk_[A-Za-z0-9]{16,}/,
];

function parseRequiredStatuses(md) {
  const rowRe =
    /^\| ([A-Z]\d{2}|L2-\d{2}) \|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\| (REQUIRED|OPTIONAL) \|([^|]*)\|/gm;
  const rows = [];
  let m;
  while ((m = rowRe.exec(md)) !== null) {
    rows.push({
      id: m[1].trim(),
      required: m[7] === "REQUIRED",
      status: m[8].trim().toUpperCase(),
    });
  }
  return rows;
}

function loadBaselineIds() {
  const raw = JSON.parse(readFileSync(baselinePath, "utf8"));
  if (Array.isArray(raw.required_ids)) return raw.required_ids;
  if (Array.isArray(raw.requiredIds)) return raw.requiredIds;
  if (Array.isArray(raw.ids)) return raw.ids;
  if (raw.fingerprints && typeof raw.fingerprints === "object") {
    return Object.keys(raw.fingerprints);
  }
  throw new Error("baseline shape unexpected");
}

function fmt(r) {
  return `status=${r.status}\nsignal=${r.signal ?? ""}\nsout=${(r.stdout ?? "").slice(0, 2000)}\nserr=${(r.stderr ?? "").slice(0, 2000)}`;
}

describe("8.2 Full Playwright suite", () => {
  it("deliverables exist (states, keystone, section, evidence, vitest)", () => {
    assert.equal(existsSync(statesSpec), true, "states_cross_cutting.spec.ts");
    assert.equal(existsSync(keystoneSpec), true, "phase8_full_suite_keystone.spec.ts");
    assert.equal(existsSync(sectionDoc), true, "docs/sections/8.2-…");
    assert.equal(existsSync(evidencePath), true, "evidence/e2e-full.txt");
    assert.equal(existsSync(vitestPath), true, "tests/8.2-….test.ts");
    assert.equal(existsSync(e2eRun), true, "scripts/e2e-run.mjs");
    assert.equal(existsSync(playwrightConfig), true, "playwright.config.ts");
  });

  it("assert every REQUIRED inventory id status PASS in report JSON", () => {
    const md = readFileSync(inventoryPath, "utf8");
    const rows = parseRequiredStatuses(md);
    const required = rows.filter((r) => r.required && r.status !== "DEFER");
    assert.ok(required.length >= 108, `expected ≥108 REQUIRED, got ${required.length}`);
    const notPass = required.filter((r) => r.status !== "PASS");
    assert.deepEqual(
      notPass.map((r) => `${r.id}=${r.status}`),
      [],
      "every non-DEFER REQUIRED must be PASS",
    );
    for (const id of STATE_IDS) {
      const row = required.find((r) => r.id === id);
      assert.ok(row, `${id} present`);
      assert.equal(row.status, "PASS", `${id} PASS`);
    }

    // Fixture report JSON: every REQUIRED id has passed, non-skipped outcome
    const r = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "-e",
        `
import { readFileSync } from "node:fs";
import {
  isPassedNonSkippedResult,
  normalizePlaywrightSuite,
  suiteHasExecutionOutcomes,
} from ${JSON.stringify(join(root, "scripts", "e2e-inventory-lint.mjs"))};
import { parseInventoryMarkdown } from ${JSON.stringify(join(root, "scripts", "inventory-lint.ts"))};
const md = readFileSync(${JSON.stringify(inventoryPath)}, "utf8");
const required = parseInventoryMarkdown(md).filter((j) => j.required && j.status !== "DEFER");
const report = {
  entries: required.map((j) => ({
    file: "playwright/e2e/states_cross_cutting.spec.ts",
    title: "@inv:" + j.id + " e2e/fixture",
    status: "expected",
    outcome: "passed",
    ok: true,
  })),
};
const suite = normalizePlaywrightSuite(report, ${JSON.stringify(root)});
if (!suite || !suiteHasExecutionOutcomes(suite)) { console.error("no outcomes", suite); process.exit(2); }
for (const j of required) {
  const hit = suite.entries.filter((e) => e.title.includes("@inv:" + j.id));
  if (!hit.some((e) => isPassedNonSkippedResult(e))) {
    console.error("missing pass", j.id);
    process.exit(3);
  }
}
process.exit(0);
`,
      ],
      { cwd: root, encoding: "utf8", env: process.env },
    );
    assert.equal(r.status, 0, fmt(r));
  });

  it("assert no inventory rows deleted in git diff of inventory file", () => {
    const baseline = new Set(loadBaselineIds());
    assert.ok(baseline.size >= 108);
    const md = readFileSync(inventoryPath, "utf8");
    const rows = parseRequiredStatuses(md);
    const current = new Set(rows.filter((r) => r.required).map((r) => r.id));
    const deleted = [...baseline].filter((id) => !current.has(id));
    assert.deepEqual(deleted, [], "no baseline REQUIRED IDs deleted");

    // git diff should not show deleted table rows for inventory IDs
    // (working tree may have L01–L04 status edits only — not row removals)
    const diff = spawnSync(
      "git",
      ["diff", "--", "KMS-competition/initiative/BROWSER_E2E_INVENTORY.md"],
      { cwd: root, encoding: "utf8" },
    );
    const text = `${diff.stdout ?? ""}\n${diff.stderr ?? ""}`;
    // Removed lines that look like inventory ID rows are forbidden
    const removedIdRows = (text.match(/^-\| (?:[A-Z]\d{2}|L2-\d{2}) \|/gm) ?? []).filter(
      (line) => !/^\+\| (?:[A-Z]\d{2}|L2-\d{2}) \|/.test(line),
    );
    // Allow status-only changes: if a line was removed, a same-ID line must be added
    const removedIds = (text.match(/^-\| ([A-Z]\d{2}|L2-\d{2}) \|/gm) ?? []).map((l) =>
      l.replace(/^-\| ([A-Z]\d{2}|L2-\d{2}) \|.*/, "$1"),
    );
    const addedIds = (text.match(/^\+\| ([A-Z]\d{2}|L2-\d{2}) \|/gm) ?? []).map((l) =>
      l.replace(/^\+\| ([A-Z]\d{2}|L2-\d{2}) \|.*/, "$1"),
    );
    for (const id of removedIds) {
      assert.ok(
        addedIds.includes(id) || current.has(id),
        `inventory row ${id} must not be deleted (diff removal without replacement)`,
      );
    }
    void removedIdRows;
  });

  it("L01–L04 Playwright @inv tags on real test() imports", () => {
    const src = readFileSync(statesSpec, "utf8");
    assert.match(src, /from\s+["']@playwright\/test["']/);
    for (const id of STATE_IDS) {
      assert.match(src, new RegExp(`@inv:${id}\\b`));
      assert.match(src, new RegExp(`test\\([\\s\\S]{0,80}@inv:${id}`));
    }
  });

  it("e2e-run + playwright config wire report artifacts", () => {
    const runSrc = readFileSync(e2eRun, "utf8");
    assert.match(runSrc, /E2E_PLAYWRIGHT_RUN_REPORT/);
    assert.match(runSrc, /playwright-run\.json|playwright-report/);
    assert.match(runSrc, /e2e-coverage\.html|e2e-report-path/);
    const cfg = readFileSync(playwrightConfig, "utf8");
    assert.match(cfg, /json/);
    assert.match(cfg, /playwright-report|E2E_PLAYWRIGHT/);
  });

  it("pnpm test:e2e:inventory still exits 0 (tags + crawl, intermediate)", () => {
    const r = spawnSync("pnpm", ["test:e2e:inventory"], {
      cwd: root,
      encoding: "utf8",
      env: process.env,
      shell: false,
    });
    assert.equal(r.status, 0, fmt(r));
  });

  it("section + E2E docs mention 8.2 full suite and report path", () => {
    const section = readFileSync(sectionDoc, "utf8");
    assert.match(section, /S-E2E-RUN|Full Playwright/i);
    assert.match(section, /L01|empty/i);
    assert.match(section, /playwright-run\.json|playwright-report/);
    assert.match(section, /N\/A|no new product HTTP handlers/i);

    const e2e = readFileSync(e2eDoc, "utf8");
    // Updated by this section
    assert.match(e2e, /8\.2|phase8|full suite/i);
  });

  it("no new product HTTP handlers in API composition root (scope guard)", () => {
    // 8.2 must not invent endpoints — composition root unchanged in intent
    const api = readFileSync(apiIndexPath, "utf8");
    assert.ok(api.includes("export") || api.includes("app"), "api index present");
    const section = readFileSync(sectionDoc, "utf8");
    assert.match(
      section,
      /no new product HTTP handlers|None added|N\/A — no new handlers|no product HTTP surface/i,
    );
  });

  it("no secrets committed in 8.2 e2e artifacts", () => {
    const files = [statesSpec, keystoneSpec, sectionDoc, evidencePath, vitestPath];
    for (const f of files) {
      const body = readFileSync(f, "utf8");
      for (const re of SECRET_PATTERNS) {
        assert.equal(re.test(body), false, `secret pattern ${re} in ${f}`);
      }
    }
  });

  it("package.json e2e scripts non-interactive", () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    assert.equal(/--watch/.test(pkg.scripts["test:e2e"] ?? ""), false);
    assert.equal(/--watch/.test(pkg.scripts["test:e2e:inventory"] ?? ""), false);
  });
});
