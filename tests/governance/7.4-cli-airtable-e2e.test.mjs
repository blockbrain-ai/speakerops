/**
 * Section 7.4 — CLI Airtable proof governance (I12 keystone).
 *
 * Locks AC surface that must pass in `pnpm test:ci` (non-browser):
 * - phase7_keystone.spec.ts exists with named assertions
 * - phase-7 inv tags documented in keystone file (K01–K04, O06)
 * - inventory K01–K04 PASS; O06 PASS
 * - CLI07 deny + airtable pause present in keystone
 * - section doc + evidence path
 * - no new product handlers; no secrets
 *
 * Browser execution of keystone is `pnpm test:e2e` (I12).
 * CLI unit coverage remains packages/cli/src/cli.test.ts (vitest).
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
  "phase7_keystone.spec.ts",
);
const sectionDoc = join(
  root,
  "docs",
  "sections",
  "7.4-cli-airtable-e2e.md",
);
const evidencePath = join(
  root,
  "KMS-competition",
  "initiative",
  "evidence",
  "phase7-e2e.txt",
);
const inventoryPath = join(
  root,
  "KMS-competition",
  "initiative",
  "BROWSER_E2E_INVENTORY.md",
);
const packageJsonPath = join(root, "package.json");
const apiIndexPath = join(root, "apps", "api", "src", "index.ts");
const apiKeysSpec = join(root, "playwright", "e2e", "api_keys.spec.ts");
const airtableSpec = join(root, "playwright", "e2e", "airtable_status.spec.ts");
const cliTest = join(root, "packages", "cli", "src", "cli.test.ts");
const airtableUnit = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "airtable",
  "airtable.test.ts",
);
const e2eRun = join(root, "scripts", "e2e-run.mjs");

/** Phase-7 browser inventory IDs proof-owned by 7.4 keystone. */
const KEY_IDS = ["K01", "K02", "K03", "K04"];
const PHASE7_INV_IDS = [...KEY_IDS, "O06"];

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

describe("7.4 CLI Airtable e2e proof", () => {
  it("assert phase7 keystone includes CLI07 deny and airtable pause", () => {
    assert.equal(
      existsSync(keystoneSpec),
      true,
      "playwright/e2e/phase7_keystone.spec.ts",
    );
    assert.equal(
      existsSync(apiKeysSpec),
      true,
      "playwright/e2e/api_keys.spec.ts (implementation @inv K*)",
    );
    assert.equal(
      existsSync(airtableSpec),
      true,
      "playwright/e2e/airtable_status.spec.ts (implementation @inv O06)",
    );
    assert.equal(
      existsSync(cliTest),
      true,
      "packages/cli/src/cli.test.ts (CLI07 unit)",
    );
    assert.equal(
      existsSync(airtableUnit),
      true,
      "airtable.test.ts (pause survival unit)",
    );

    const body = readFileSync(keystoneSpec, "utf8");
    assert.match(body, /@playwright\/test/);
    assert.match(body, /7\.4|phase7 keystone|I12/i);
    // Named AC (exact phrase from spec)
    assert.match(
      body,
      /assert phase7 keystone includes CLI07 deny and airtable pause/i,
    );
    // CLI07 deny surfaces
    assert.match(body, /CLI07/);
    assert.match(body, /reports-only|reports:read/);
    assert.match(body, /schedule.*place|schedule\/place/i);
    assert.match(body, /EXIT_AUTHZ|toBe\(2\)|status\)\.toBe\(2\)/);
    assert.match(body, /FORBIDDEN|403/);
    assert.match(body, /runSpeakerops|speakerops|CLI_DIST|SPEAKEROPS_API/);
    // Airtable pause surfaces
    assert.match(body, /airtable pause|airtable-status|paused/i);
    assert.match(body, /pendingCount|pending-count|lag/i);
    assert.match(body, /AIRTABLE|configured|paused/);
    // K* keys multi-step
    assert.match(body, /api-keys-page|api-key-create|api-key-secret-once/i);
    assert.match(body, /api-key-revoke|access-denied/i);
    // Authz negatives
    assert.match(body, /401/);
    // multi-step keystone test present
    assert.match(
      body,
      /keystone:.*CLI07|K\*.*CLI07|CLI07 deny.*airtable pause/i,
    );

    // Unit proofs still present in CI surface
    const cli = readFileSync(cliTest, "utf8");
    assert.match(cli, /CLI07/);
    assert.match(cli, /EXIT_AUTHZ|toBe\(2\)/);
    const at = readFileSync(airtableUnit, "utf8");
    assert.match(
      at,
      /assert mutation 200 when AIRTABLE_API_KEY unset and outbox pending/,
    );
  });

  it("assert K01–K04 and O06 inv tags pass", () => {
    const body = readFileSync(keystoneSpec, "utf8");
    for (const id of PHASE7_INV_IDS) {
      assert.match(
        body,
        new RegExp(`@inv:${id}`),
        `keystone must document @inv:${id}`,
      );
    }

    // Active @inv ownership remains on implementation specs
    const keys = readFileSync(apiKeysSpec, "utf8");
    for (const id of KEY_IDS) {
      assert.match(
        keys,
        new RegExp(`@inv:${id}\\b`),
        `api_keys.spec.ts must own @inv:${id}`,
      );
    }

    const airtable = readFileSync(airtableSpec, "utf8");
    assert.match(airtable, /@inv:O06\b/);
    assert.match(airtable, /e2e\/settings\/airtable-status/);

    const inv = readFileSync(inventoryPath, "utf8");
    for (const id of PHASE7_INV_IDS) {
      assert.match(
        inv,
        new RegExp(
          `\\|\\s*${id}\\s*\\|[^|]+\\|[^|]+\\|[^|]+\\|[^|]+\\|[^|]+\\|\\s*REQUIRED\\s*\\|\\s*PASS\\s*\\|`,
        ),
        `${id} must be PASS after 7.4 keystone proof`,
      );
    }
  });

  it("section doc notes evidence path and N/A product surface", () => {
    assert.equal(
      existsSync(sectionDoc),
      true,
      "docs/sections/7.4-cli-airtable-e2e.md",
    );
    const doc = readFileSync(sectionDoc, "utf8");
    assert.match(doc, /phase7_keystone\.spec\.ts/);
    assert.match(doc, /evidence\/phase7-e2e\.txt|Evidence path/i);
    assert.match(doc, /N\/A|no new.*handler/i);
    assert.match(doc, /S-CLI|S-AIRTABLE/i);
    assert.match(doc, /K0[1-4]|O06|CLI07/);
    assert.match(
      doc,
      /assert phase7 keystone includes CLI07 deny and airtable pause/i,
    );
  });

  it("evidence path file exists for phase 7 keystone", () => {
    assert.equal(
      existsSync(evidencePath),
      true,
      "KMS-competition/initiative/evidence/phase7-e2e.txt must exist",
    );
    const evidence = readFileSync(evidencePath, "utf8");
    assert.match(evidence, /7\.4|phase7|CLI07|airtable|keystone/i);
    assert.match(evidence, /phase7-e2e|K0|O06|S-CLI|S-AIRTABLE/i);
    assert.match(
      evidence,
      /assert phase7 keystone includes CLI07 deny and airtable pause/i,
    );
  });

  it("pnpm test:e2e remains non-interactive and builds CLI for keystone", () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    assert.equal(typeof pkg.scripts["test:e2e"], "string");
    assert.doesNotMatch(pkg.scripts["test:e2e"], /--watch/);
    assert.match(pkg.scripts["test:e2e"], /e2e-run/);

    const run = readFileSync(e2eRun, "utf8");
    assert.match(run, /@speakerops\/cli|packages\/cli/);
  });

  it("no new product handlers in API composition root (scope guard)", () => {
    const api = readFileSync(apiIndexPath, "utf8");
    // Domain routes mount via app.route only — no ad-hoc /api handlers in 7.4
    assert.doesNotMatch(api, /app\.(get|post|put|patch|delete)\(["']\/api\//);
    assert.match(api, /app\.get\(["']\/health["']/);
  });

  it("no secrets committed in 7.4 e2e artifacts", () => {
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
