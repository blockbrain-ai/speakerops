/**
 * Section 3.6 — CFP eval e2e proof governance / file assertions.
 *
 * Locks AC surface that must pass in `pnpm test:ci` (non-browser):
 * - cfp_eval_keystone.spec.ts exists with named assertions
 * - phase-3 inv tags documented in keystone file
 * - phase-3 inventory A/D/E/F letter ranges (and O04) status PASS
 * - section doc + evidence path
 * - no new product handlers; no secrets
 *
 * Browser execution of keystone is `pnpm test:e2e` (I12).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const keystoneSpec = join(
  root,
  "playwright",
  "e2e",
  "cfp_eval_keystone.spec.ts",
);
const seedHelpers = join(
  root,
  "playwright",
  "e2e",
  "helpers",
  "cfp-eval-seed.ts",
);
const sectionDoc = join(root, "docs", "sections", "3.6-cfp-eval-e2e.md");
const evidencePath = join(
  root,
  "KMS-competition",
  "initiative",
  "evidence",
  "phase3-e2e.txt",
);
const inventoryPath = join(
  root,
  "KMS-competition",
  "initiative",
  "BROWSER_E2E_INVENTORY.md",
);
const packageJsonPath = join(root, "package.json");
const apiIndexPath = join(root, "apps", "api", "src", "index.ts");

/** Phase-3 inventory IDs proof-owned by 3.6 keystone (INVENTORY_OWNERSHIP). */
const PHASE3_INV_IDS = [
  // A — Public CFP
  "A01",
  "A02",
  "A03",
  "A04",
  "A05",
  "A06",
  "A07",
  "A08",
  "A09",
  "A10",
  "A11",
  // D — Form builder
  "D01",
  "D02",
  "D03",
  "D04",
  "D05",
  "D06",
  "D07",
  "D08",
  "D09",
  "D10",
  // E — Submissions / decisions
  "E01",
  "E02",
  "E03",
  "E04",
  "E05",
  "E06",
  "E07",
  "E08",
  // F — Evaluator
  "F01",
  "F02",
  "F03",
  "F04",
  // O04 — Rubric (owned by 3.4, proof 3.6)
  "O04",
];

const SECRET_PATTERNS = [
  /api[_-]?key\s*[:=]\s*["'][^"']{8,}["']/i,
  /secret\s*[:=]\s*["'][^"']{8,}["']/i,
  /password\s*[:=]\s*["'][^"']+["']/i,
  /Bearer\s+[A-Za-z0-9\-._~+/]{20,}=*/,
  /sk-[A-Za-z0-9]{20,}/,
  /CLOUDFLARE_API_TOKEN\s*=\s*["'][^"']+["']/,
  /AIRTABLE_API_KEY\s*=\s*["'][^"']+["']/,
];

describe("3.6 cfp eval e2e proof", () => {
  it("assert keystone path creates tasks after accept", () => {
    assert.equal(
      existsSync(keystoneSpec),
      true,
      "playwright/e2e/cfp_eval_keystone.spec.ts",
    );
    assert.equal(
      existsSync(seedHelpers),
      true,
      "playwright/e2e/helpers/cfp-eval-seed.ts",
    );
    const body = readFileSync(keystoneSpec, "utf8");
    assert.match(body, /@playwright\/test/);
    assert.match(body, /3\.6|cfp eval keystone|I12/i);
    // Full path steps
    assert.match(body, /form-publish|form publish|Published version/i);
    assert.match(body, /public-cfp|\/cfp\//i);
    assert.match(body, /public-cfp-primary|submit/i);
    assert.match(body, /eval-score|score/i);
    assert.match(body, /submission-accept|decision.*accept|accept/i);
    // tasks after accept
    assert.match(body, /tasks/i);
    assert.match(
      body,
      /tasks\.length|speaker_tasks|materialis|creates tasks/i,
    );
    // multi-step keystone test present
    assert.match(
      body,
      /keystone:.*form publish|form publish → public submit|publish.*submit.*score.*accept/i,
    );
    // authz negatives
    assert.match(body, /FORBIDDEN|403/);
    assert.match(body, /UNAUTHORIZED|401/);
  });

  it("assert all phase3 inv tags pass", () => {
    const body = readFileSync(keystoneSpec, "utf8");
    // full phase-3 ownership documented on keystone
    for (const id of PHASE3_INV_IDS) {
      assert.match(
        body,
        new RegExp(`@inv:${id}`),
        `keystone must document @inv:${id}`,
      );
    }

    const inv = readFileSync(inventoryPath, "utf8");
    for (const id of PHASE3_INV_IDS) {
      assert.match(
        inv,
        new RegExp(
          `\\|\\s*${id}\\s*\\|[^|]+\\|[^|]+\\|[^|]+\\|[^|]+\\|[^|]+\\|\\s*REQUIRED\\s*\\|\\s*PASS\\s*\\|`,
        ),
        `${id} must be PASS after 3.6 keystone proof`,
      );
    }
  });

  it("section doc notes evidence path and N/A product surface", () => {
    assert.equal(
      existsSync(sectionDoc),
      true,
      "docs/sections/3.6-cfp-eval-e2e.md",
    );
    const doc = readFileSync(sectionDoc, "utf8");
    assert.match(doc, /cfp_eval_keystone\.spec\.ts/);
    assert.match(doc, /evidence\/phase3-e2e\.txt|Evidence path/i);
    assert.match(doc, /N\/A|no new.*handler/i);
    assert.match(doc, /form publish|public submit|score|accept|tasks/i);
    assert.match(doc, /S-CFP|S-EVAL/);
    assert.match(doc, /A0|D0|E0|F0/);
  });

  it("evidence path file exists for phase 3 keystone", () => {
    assert.equal(
      existsSync(evidencePath),
      true,
      "KMS-competition/initiative/evidence/phase3-e2e.txt must exist",
    );
    const evidence = readFileSync(evidencePath, "utf8");
    assert.match(evidence, /3\.6|cfp|eval|e2e|keystone/i);
    assert.match(evidence, /phase3-e2e|form publish|tasks/i);
  });

  it("pnpm test:e2e remains non-interactive (no --watch)", () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    assert.equal(typeof pkg.scripts["test:e2e"], "string");
    assert.doesNotMatch(pkg.scripts["test:e2e"], /--watch/);
    assert.match(pkg.scripts["test:e2e"], /e2e-run/);
  });

  it("no new product handlers in API composition root (scope guard)", () => {
    const api = readFileSync(apiIndexPath, "utf8");
    // Domain routes mount via app.route only — no ad-hoc /api handlers in 3.6
    assert.doesNotMatch(api, /app\.(get|post|put|patch|delete)\(["']\/api\//);
    assert.match(api, /app\.get\(["']\/health["']/);
  });

  it("no secrets committed in 3.6 e2e artifacts", () => {
    const files = [keystoneSpec, seedHelpers, sectionDoc, evidencePath];
    for (const file of files) {
      if (!existsSync(file)) continue;
      const body = readFileSync(file, "utf8");
      for (const re of SECRET_PATTERNS) {
        assert.equal(
          re.test(body),
          false,
          `secret-like pattern ${re} must not appear in ${file}`,
        );
      }
      // Magic-link tokens must not be hardcoded as long opaque secrets
      assert.doesNotMatch(
        body,
        /(?:token|magic)\s*[:=]\s*["'][A-Za-z0-9+/=_-]{40,}["']/i,
        `${file} must not hardcode magic-link tokens`,
      );
    }
  });
});
