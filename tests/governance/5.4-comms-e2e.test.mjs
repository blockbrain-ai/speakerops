/**
 * Section 5.4 — Comms e2e proof governance / file assertions.
 *
 * Locks AC surface that must pass in `pnpm test:ci` (non-browser):
 * - comms_keystone.spec.ts exists with named assertions
 * - phase-5 inv tags documented in keystone file (J01–J10)
 * - inventory J01–J10 status PASS
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
  "comms_keystone.spec.ts",
);
const sectionDoc = join(root, "docs", "sections", "5.4-comms-e2e.md");
const evidencePath = join(
  root,
  "KMS-competition",
  "initiative",
  "evidence",
  "phase5-e2e.txt",
);
const inventoryPath = join(
  root,
  "KMS-competition",
  "initiative",
  "BROWSER_E2E_INVENTORY.md",
);
const packageJsonPath = join(root, "package.json");
const apiIndexPath = join(root, "apps", "api", "src", "index.ts");
const commsAdminSpec = join(root, "playwright", "e2e", "comms_admin.spec.ts");
const commsTemplateSpec = join(
  root,
  "playwright",
  "e2e",
  "comms_template.spec.ts",
);

/** Phase-5 inventory IDs proof-owned by 5.4 keystone (INVENTORY_OWNERSHIP). */
const PHASE5_INV_IDS = [
  "J01",
  "J02",
  "J03",
  "J04",
  "J05",
  "J06",
  "J07",
  "J08",
  "J09",
  "J10",
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

describe("5.4 comms e2e proof", () => {
  it("assert comms keystone passes J08", () => {
    assert.equal(
      existsSync(keystoneSpec),
      true,
      "playwright/e2e/comms_keystone.spec.ts",
    );
    assert.equal(
      existsSync(commsAdminSpec),
      true,
      "playwright/e2e/comms_admin.spec.ts (implementation @inv J02–J10)",
    );
    assert.equal(
      existsSync(commsTemplateSpec),
      true,
      "playwright/e2e/comms_template.spec.ts (implementation @inv J01)",
    );
    const body = readFileSync(keystoneSpec, "utf8");
    assert.match(body, /@playwright\/test/);
    assert.match(body, /5\.4|comms keystone|I12/i);
    // J08 trust-before-send (named AC)
    assert.match(body, /assert comms keystone passes J08/i);
    assert.match(body, /@inv:J08|preview-required|comms-send-button.*toBeDisabled|toBeDisabled/i);
    assert.match(body, /comms-send-blocked-reason|preview/i);
    assert.match(body, /idempotencyKey.*j08|missing.*preview|400/i);
    // Multi-step soul path surfaces
    assert.match(body, /comms-template|template/i);
    assert.match(body, /comms-segment|segment/i);
    assert.match(body, /comms-preview|preview/i);
    assert.match(body, /comms-send|send/i);
    assert.match(body, /comms-log|delivery log|comms-delivery-log/i);
    assert.match(body, /comms-ics|SEQUENCE|ics/i);
    assert.match(body, /FORBIDDEN|403/);
    assert.match(body, /UNAUTHORIZED|401/);
    // multi-step keystone test present
    assert.match(
      body,
      /keystone:.*preview-required|template → preview|comms keystone passes J08/i,
    );
  });

  it("assert J01–J10 inv tags pass", () => {
    const body = readFileSync(keystoneSpec, "utf8");
    for (const id of PHASE5_INV_IDS) {
      assert.match(
        body,
        new RegExp(`@inv:${id}`),
        `keystone must document @inv:${id}`,
      );
    }

    // Active @inv ownership remains on implementation specs
    const template = readFileSync(commsTemplateSpec, "utf8");
    assert.match(template, /@inv:J01\b/, "comms_template.spec.ts owns @inv:J01");

    const admin = readFileSync(commsAdminSpec, "utf8");
    for (const id of PHASE5_INV_IDS.filter((x) => x !== "J01")) {
      assert.match(
        admin,
        new RegExp(`@inv:${id}\\b`),
        `comms_admin.spec.ts must own @inv:${id}`,
      );
    }

    const inv = readFileSync(inventoryPath, "utf8");
    for (const id of PHASE5_INV_IDS) {
      assert.match(
        inv,
        new RegExp(
          `\\|\\s*${id}\\s*\\|[^|]+\\|[^|]+\\|[^|]+\\|[^|]+\\|[^|]+\\|\\s*REQUIRED\\s*\\|\\s*PASS\\s*\\|`,
        ),
        `${id} must be PASS after 5.4 keystone proof`,
      );
    }
  });

  it("section doc notes evidence path and N/A product surface", () => {
    assert.equal(
      existsSync(sectionDoc),
      true,
      "docs/sections/5.4-comms-e2e.md",
    );
    const doc = readFileSync(sectionDoc, "utf8");
    assert.match(doc, /comms_keystone\.spec\.ts/);
    assert.match(doc, /evidence\/phase5-e2e\.txt|Evidence path/i);
    assert.match(doc, /N\/A|no new.*handler/i);
    assert.match(doc, /S-COMMS|trust-before-send|preview/i);
    assert.match(doc, /J0[1-9]|J10/);
    assert.match(doc, /assert comms keystone passes J08/i);
  });

  it("evidence path file exists for phase 5 keystone", () => {
    assert.equal(
      existsSync(evidencePath),
      true,
      "KMS-competition/initiative/evidence/phase5-e2e.txt must exist",
    );
    const evidence = readFileSync(evidencePath, "utf8");
    assert.match(evidence, /5\.4|comms|e2e|keystone/i);
    assert.match(evidence, /phase5-e2e|J0|S-COMMS/i);
  });

  it("pnpm test:e2e remains non-interactive (no --watch)", () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    assert.equal(typeof pkg.scripts["test:e2e"], "string");
    assert.doesNotMatch(pkg.scripts["test:e2e"], /--watch/);
    assert.match(pkg.scripts["test:e2e"], /e2e-run/);
  });

  it("no new product handlers in API composition root (scope guard)", () => {
    const api = readFileSync(apiIndexPath, "utf8");
    // Domain routes mount via app.route only — no ad-hoc /api handlers in 5.4
    assert.doesNotMatch(api, /app\.(get|post|put|patch|delete)\(["']\/api\//);
    assert.match(api, /app\.get\(["']\/health["']/);
  });

  it("no secrets committed in 5.4 e2e artifacts", () => {
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
