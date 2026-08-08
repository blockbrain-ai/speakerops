/**
 * Section 4.4 — Portal e2e proof governance / file assertions.
 *
 * Locks AC surface that must pass in `pnpm test:ci` (non-browser):
 * - portal_keystone.spec.ts exists with named assertions
 * - phase-4 inv tags documented in keystone file (G01–G08, O05)
 * - inventory G01–G08 / O05 status PASS
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
  "portal_keystone.spec.ts",
);
const sectionDoc = join(root, "docs", "sections", "4.4-portal-e2e.md");
const evidencePath = join(
  root,
  "KMS-competition",
  "initiative",
  "evidence",
  "phase4-e2e.txt",
);
const inventoryPath = join(
  root,
  "KMS-competition",
  "initiative",
  "BROWSER_E2E_INVENTORY.md",
);
const packageJsonPath = join(root, "package.json");
const apiIndexPath = join(root, "apps", "api", "src", "index.ts");
const portalUiSpec = join(root, "playwright", "e2e", "portal_ui.spec.ts");

/** Phase-4 inventory IDs proof-owned by 4.4 keystone (INVENTORY_OWNERSHIP). */
const PHASE4_INV_IDS = [
  "G01",
  "G02",
  "G03",
  "G04",
  "G05",
  "G06",
  "G07",
  "G08",
  "O05",
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

describe("4.4 portal e2e proof", () => {
  it("assert portal keystone green after seed accept", () => {
    assert.equal(
      existsSync(keystoneSpec),
      true,
      "playwright/e2e/portal_keystone.spec.ts",
    );
    assert.equal(
      existsSync(portalUiSpec),
      true,
      "playwright/e2e/portal_ui.spec.ts (implementation @inv)",
    );
    const body = readFileSync(keystoneSpec, "utf8");
    assert.match(body, /@playwright\/test/);
    assert.match(body, /4\.4|portal keystone|I12/i);
    // Seed accept path
    assert.match(body, /accept|Decision|decision.*accept/i);
    assert.match(body, /speaker_tasks|tasks\.length|materialis/i);
    // Portal surfaces after accept
    assert.match(body, /portal-home|portal-next-task/i);
    assert.match(body, /portal-bio|bio/i);
    assert.match(body, /portal-headshot|headshot/i);
    assert.match(body, /portal-slides|slides/i);
    assert.match(body, /portal-task-complete|task-status.*completed|completed/i);
    assert.match(body, /portal-session|sessions/i);
    assert.match(body, /overdue|portal-task--overdue/i);
    assert.match(body, /setViewportSize|mobile|375/i);
    // multi-step keystone test present
    assert.match(
      body,
      /keystone:.*seed accept|seed accept → portal green|portal green after seed accept/i,
    );
    // authz negatives
    assert.match(body, /FORBIDDEN|403/);
    assert.match(body, /UNAUTHORIZED|401/);
    // named assertion
    assert.match(body, /assert portal keystone green after seed accept/i);
  });

  it("assert G01–G08 (and O05) inv tags pass", () => {
    const body = readFileSync(keystoneSpec, "utf8");
    for (const id of PHASE4_INV_IDS) {
      assert.match(
        body,
        new RegExp(`@inv:${id}`),
        `keystone must document @inv:${id}`,
      );
    }

    // Active @inv ownership remains on implementation specs
    const ui = readFileSync(portalUiSpec, "utf8");
    for (const id of ["G01", "G02", "G03", "G04", "G05", "G06", "G07", "G08"]) {
      assert.match(
        ui,
        new RegExp(`@inv:${id}\\b`),
        `portal_ui.spec.ts must own @inv:${id}`,
      );
    }

    const inv = readFileSync(inventoryPath, "utf8");
    for (const id of PHASE4_INV_IDS) {
      assert.match(
        inv,
        new RegExp(
          `\\|\\s*${id}\\s*\\|[^|]+\\|[^|]+\\|[^|]+\\|[^|]+\\|[^|]+\\|\\s*REQUIRED\\s*\\|\\s*PASS\\s*\\|`,
        ),
        `${id} must be PASS after 4.4 keystone proof`,
      );
    }
  });

  it("section doc notes evidence path and N/A product surface", () => {
    assert.equal(
      existsSync(sectionDoc),
      true,
      "docs/sections/4.4-portal-e2e.md",
    );
    const doc = readFileSync(sectionDoc, "utf8");
    assert.match(doc, /portal_keystone\.spec\.ts/);
    assert.match(doc, /evidence\/phase4-e2e\.txt|Evidence path/i);
    assert.match(doc, /N\/A|no new.*handler/i);
    assert.match(doc, /seed accept|portal green|S-PORTAL/i);
    assert.match(doc, /G0[1-8]/);
  });

  it("evidence path file exists for phase 4 keystone", () => {
    assert.equal(
      existsSync(evidencePath),
      true,
      "KMS-competition/initiative/evidence/phase4-e2e.txt must exist",
    );
    const evidence = readFileSync(evidencePath, "utf8");
    assert.match(evidence, /4\.4|portal|e2e|keystone/i);
    assert.match(evidence, /phase4-e2e|seed accept|G0/i);
  });

  it("pnpm test:e2e remains non-interactive (no --watch)", () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    assert.equal(typeof pkg.scripts["test:e2e"], "string");
    assert.doesNotMatch(pkg.scripts["test:e2e"], /--watch/);
    assert.match(pkg.scripts["test:e2e"], /e2e-run/);
  });

  it("no new product handlers in API composition root (scope guard)", () => {
    const api = readFileSync(apiIndexPath, "utf8");
    // Domain routes mount via app.route only — no ad-hoc /api handlers in 4.4
    assert.doesNotMatch(api, /app\.(get|post|put|patch|delete)\(["']\/api\//);
    assert.match(api, /app\.get\(["']\/health["']/);
  });

  it("no secrets committed in 4.4 e2e artifacts", () => {
    const files = [keystoneSpec, sectionDoc, evidencePath];
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
      assert.doesNotMatch(
        body,
        /(?:token|magic)\s*[:=]\s*["'][A-Za-z0-9+/=_-]{40,}["']/i,
        `${file} must not hardcode magic-link tokens`,
      );
    }
  });
});
