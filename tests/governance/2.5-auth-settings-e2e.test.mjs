/**
 * Section 2.5 — Auth settings e2e proof governance / file assertions.
 *
 * Locks AC surface that must pass in `pnpm test:ci` (non-browser):
 * - auth_settings_keystone.spec.ts exists with named assertions
 * - B04 and C05 tags present in keystone file
 * - phase-2 inventory Bxx and Cxx status PASS
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
  "auth_settings_keystone.spec.ts",
);
const sectionDoc = join(
  root,
  "docs",
  "sections",
  "2.5-auth-settings-e2e.md",
);
const evidencePath = join(
  root,
  "KMS-competition",
  "initiative",
  "evidence",
  "phase2-e2e.txt",
);
const inventoryPath = join(
  root,
  "KMS-competition",
  "initiative",
  "BROWSER_E2E_INVENTORY.md",
);
const packageJsonPath = join(root, "package.json");
const apiIndexPath = join(root, "apps", "api", "src", "index.ts");

/** Phase-2 inventory IDs owned / proofed by 2.5 keystone. */
const PHASE2_INV_IDS = [
  "B01",
  "B02",
  "B03",
  "B04",
  "B05",
  "B06",
  "C01",
  "C02",
  "C03",
  "C04",
  "C05",
  "C06",
  "C07",
  "C08",
  "C09",
  "C10",
  "C11",
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

describe("2.5 auth settings e2e proof", () => {
  it("assert keystone covers login and design publish path end-to-end", () => {
    assert.equal(
      existsSync(keystoneSpec),
      true,
      "playwright/e2e/auth_settings_keystone.spec.ts",
    );
    const body = readFileSync(keystoneSpec, "utf8");
    assert.match(body, /@playwright\/test/);
    assert.match(body, /2\.5|auth settings keystone|I12/i);
    // login path
    assert.match(body, /login|magic-link|magic.link/i);
    assert.match(body, /speakerops_session|exchange/i);
    // design publish path
    assert.match(body, /design-publish|design\/publish|Design Kit|design-brand/i);
    assert.match(body, /public-cfp|\/cfp\//i);
    assert.match(body, /Published|publish/i);
    // role guards
    assert.match(body, /FORBIDDEN|403|access-denied|role/i);
    assert.match(body, /UNAUTHORIZED|401/i);
    // multi-step keystone test present
    assert.match(
      body,
      /keystone:.*login|login → set design|login.*design.*publish/i,
    );
  });

  it("assert B04 and C05 tags present in keystone file", () => {
    const body = readFileSync(keystoneSpec, "utf8");
    assert.match(body, /@inv:B04/);
    assert.match(body, /@inv:C05/);
    // full phase-2 ownership documented
    for (const id of PHASE2_INV_IDS) {
      assert.match(
        body,
        new RegExp(`@inv:${id}`),
        `keystone must document @inv:${id}`,
      );
    }
  });

  it("phase 2 inventory B01–B06 and C01–C11 status PASS", () => {
    const inv = readFileSync(inventoryPath, "utf8");
    for (const id of PHASE2_INV_IDS) {
      assert.match(
        inv,
        new RegExp(
          `\\|\\s*${id}\\s*\\|[^|]+\\|[^|]+\\|[^|]+\\|[^|]+\\|[^|]+\\|\\s*REQUIRED\\s*\\|\\s*PASS\\s*\\|`,
        ),
        `${id} must be PASS after 2.5 keystone proof`,
      );
    }
  });

  it("section doc notes evidence path and N/A product surface", () => {
    assert.equal(existsSync(sectionDoc), true, "docs/sections/2.5-auth-settings-e2e.md");
    const doc = readFileSync(sectionDoc, "utf8");
    assert.match(doc, /auth_settings_keystone\.spec\.ts/);
    assert.match(doc, /evidence\/phase2-e2e\.txt|Evidence path/i);
    assert.match(doc, /N\/A|no new.*handler/i);
    assert.match(doc, /login|design|publish/i);
    assert.match(doc, /B04|role guard/i);
    assert.match(doc, /C05|S-THEME|brand/i);
  });

  it("evidence path file exists for phase 2 keystone", () => {
    assert.equal(
      existsSync(evidencePath),
      true,
      "KMS-competition/initiative/evidence/phase2-e2e.txt must exist",
    );
    const evidence = readFileSync(evidencePath, "utf8");
    assert.match(evidence, /2\.5|auth|design|e2e|keystone/i);
  });

  it("pnpm test:e2e remains non-interactive (no --watch)", () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    assert.equal(typeof pkg.scripts["test:e2e"], "string");
    assert.doesNotMatch(pkg.scripts["test:e2e"], /--watch/);
    assert.match(pkg.scripts["test:e2e"], /e2e-run/);
  });

  it("no new product handlers in API composition root (scope guard)", () => {
    const api = readFileSync(apiIndexPath, "utf8");
    // Domain routes mount via app.route only — no ad-hoc /api handlers in 2.5
    assert.doesNotMatch(api, /app\.(get|post|put|patch|delete)\(["']\/api\//);
    assert.match(api, /app\.get\(["']\/health["']/);
  });

  it("no secrets committed in 2.5 e2e artifacts", () => {
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
      // Magic-link tokens must not be hardcoded as long opaque secrets
      assert.doesNotMatch(
        body,
        /(?:token|magic)\s*[:=]\s*["'][A-Za-z0-9+/=_-]{40,}["']/i,
        `${file} must not hardcode magic-link tokens`,
      );
    }
  });
});
