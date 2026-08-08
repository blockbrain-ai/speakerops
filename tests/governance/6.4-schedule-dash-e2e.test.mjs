/**
 * Section 6.4 — Schedule + readiness dashboard e2e proof governance.
 *
 * Locks AC surface that must pass in `pnpm test:ci` (non-browser):
 * - schedule_dash_keystone.spec.ts exists with named assertions
 * - phase-6 inv tags documented in keystone file (I* H* N* L05)
 * - inventory I01–I16, H01–H05, N01–N04, L05 status PASS
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
  "schedule_dash_keystone.spec.ts",
);
const sectionDoc = join(root, "docs", "sections", "6.4-schedule-dash-e2e.md");
const evidencePath = join(
  root,
  "KMS-competition",
  "initiative",
  "evidence",
  "phase6-e2e.txt",
);
const inventoryPath = join(
  root,
  "KMS-competition",
  "initiative",
  "BROWSER_E2E_INVENTORY.md",
);
const packageJsonPath = join(root, "package.json");
const apiIndexPath = join(root, "apps", "api", "src", "index.ts");
const scheduleStudioSpec = join(
  root,
  "playwright",
  "e2e",
  "schedule_studio.spec.ts",
);
const readinessSpec = join(
  root,
  "playwright",
  "e2e",
  "readiness_dashboard.spec.ts",
);
const speakersSpec = join(root, "playwright", "e2e", "portal_api_tasks.spec.ts");

/** Phase-6 inventory IDs proof-owned by 6.4 keystone (INVENTORY_OWNERSHIP). */
const SCHEDULE_IDS = [
  "I01",
  "I02",
  "I03",
  "I04",
  "I05",
  "I06",
  "I07",
  "I08",
  "I09",
  "I10",
  "I11",
  "I12",
  "I13",
  "I14",
  "I15",
  "I16",
];
const DASH_IDS = ["H01", "H02", "H03", "H04", "H05"];
const SPEAKER_IDS = ["N01", "N02", "N03", "N04"];
const PHASE6_INV_IDS = [...SCHEDULE_IDS, ...DASH_IDS, ...SPEAKER_IDS, "L05"];

const SECRET_PATTERNS = [
  /api[_-]?key\s*[:=]\s*["'][^"']{8,}["']/i,
  /secret\s*[:=]\s*["'][^"']{8,}["']/i,
  /password\s*[:=]\s*["'][^"']+["']/i,
  /Bearer\s+[A-Za-z0-9\-._~+/]{20,}=*/,
  /sk-[A-Za-z0-9]{20,}/,
  /CLOUDFLARE_API_TOKEN\s*=\s*["'][^"']+["']/,
  /AIRTABLE_API_KEY\s*=\s*["'][^"']+["']/,
];

describe("6.4 schedule+dash e2e proof", () => {
  it("assert schedule+dash keystone green", () => {
    assert.equal(
      existsSync(keystoneSpec),
      true,
      "playwright/e2e/schedule_dash_keystone.spec.ts",
    );
    assert.equal(
      existsSync(scheduleStudioSpec),
      true,
      "playwright/e2e/schedule_studio.spec.ts (implementation @inv I*)",
    );
    assert.equal(
      existsSync(readinessSpec),
      true,
      "playwright/e2e/readiness_dashboard.spec.ts (implementation @inv H* L05)",
    );
    assert.equal(
      existsSync(speakersSpec),
      true,
      "playwright/e2e/portal_api_tasks.spec.ts (implementation @inv N*)",
    );

    const body = readFileSync(keystoneSpec, "utf8");
    assert.match(body, /@playwright\/test/);
    assert.match(body, /6\.4|schedule\+dash keystone|I12/i);
    // Named AC
    assert.match(body, /assert schedule\+dash keystone green/i);
    // Multi-step soul path surfaces (S-SCHED)
    assert.match(body, /page-schedule|schedule-tray|schedule-view/i);
    assert.match(body, /schedule-conflict-toast|conflict/i);
    assert.match(body, /schedule-timezone|America\/New_York/i);
    assert.match(body, /schedule-undo|unschedule|stale-recovery/i);
    // S-READY
    assert.match(body, /page-readiness|readiness-stats|readiness-outstanding/i);
    assert.match(body, /readiness-filter-overdue|readiness-drill/i);
    assert.match(body, /Task\.Complete|portal\/tasks|readiness-empty/i);
    // N* speakers
    assert.match(body, /speakers-list|speakers-detail|speakers-search/i);
    // L05 large list
    assert.match(body, /150|speakers-pager|large-list|L05/i);
    // Authz negatives
    assert.match(body, /401/);
    // multi-step keystone test present
    assert.match(
      body,
      /keystone:.*schedule|schedule → readiness|assert schedule\+dash keystone green/i,
    );
  });

  it("assert I* H* N* L05 inv tags pass", () => {
    const body = readFileSync(keystoneSpec, "utf8");
    for (const id of PHASE6_INV_IDS) {
      assert.match(
        body,
        new RegExp(`@inv:${id}`),
        `keystone must document @inv:${id}`,
      );
    }

    // Active @inv ownership remains on implementation specs
    const studio = readFileSync(scheduleStudioSpec, "utf8");
    for (const id of SCHEDULE_IDS) {
      assert.match(
        studio,
        new RegExp(`@inv:${id}\\b`),
        `schedule_studio.spec.ts must own @inv:${id}`,
      );
    }

    const readiness = readFileSync(readinessSpec, "utf8");
    for (const id of [...DASH_IDS, "L05"]) {
      assert.match(
        readiness,
        new RegExp(`@inv:${id}\\b`),
        `readiness_dashboard.spec.ts must own @inv:${id}`,
      );
    }

    const speakers = readFileSync(speakersSpec, "utf8");
    for (const id of SPEAKER_IDS) {
      assert.match(
        speakers,
        new RegExp(`@inv:${id}\\b`),
        `portal_api_tasks.spec.ts must own @inv:${id}`,
      );
    }

    const inv = readFileSync(inventoryPath, "utf8");
    for (const id of PHASE6_INV_IDS) {
      assert.match(
        inv,
        new RegExp(
          `\\|\\s*${id}\\s*\\|[^|]+\\|[^|]+\\|[^|]+\\|[^|]+\\|[^|]+\\|\\s*REQUIRED\\s*\\|\\s*PASS\\s*\\|`,
        ),
        `${id} must be PASS after 6.4 keystone proof`,
      );
    }
  });

  it("section doc notes evidence path and N/A product surface", () => {
    assert.equal(
      existsSync(sectionDoc),
      true,
      "docs/sections/6.4-schedule-dash-e2e.md",
    );
    const doc = readFileSync(sectionDoc, "utf8");
    assert.match(doc, /schedule_dash_keystone\.spec\.ts/);
    assert.match(doc, /evidence\/phase6-e2e\.txt|Evidence path/i);
    assert.match(doc, /N\/A|no new.*handler/i);
    assert.match(doc, /S-SCHED|S-READY/i);
    assert.match(doc, /I0[1-9]|I1[0-6]|H0[1-5]|N0[1-4]|L05/);
    assert.match(doc, /assert schedule\+dash keystone green/i);
  });

  it("evidence path file exists for phase 6 keystone", () => {
    assert.equal(
      existsSync(evidencePath),
      true,
      "KMS-competition/initiative/evidence/phase6-e2e.txt must exist",
    );
    const evidence = readFileSync(evidencePath, "utf8");
    assert.match(evidence, /6\.4|schedule|readiness|e2e|keystone/i);
    assert.match(evidence, /phase6-e2e|I0|H0|S-SCHED|S-READY/i);
  });

  it("pnpm test:e2e remains non-interactive (no --watch)", () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    assert.equal(typeof pkg.scripts["test:e2e"], "string");
    assert.doesNotMatch(pkg.scripts["test:e2e"], /--watch/);
    assert.match(pkg.scripts["test:e2e"], /e2e-run/);
  });

  it("no new product handlers in API composition root (scope guard)", () => {
    const api = readFileSync(apiIndexPath, "utf8");
    // Domain routes mount via app.route only — no ad-hoc /api handlers in 6.4
    assert.doesNotMatch(api, /app\.(get|post|put|patch|delete)\(["']\/api\//);
    assert.match(api, /app\.get\(["']\/health["']/);
  });

  it("no secrets committed in 6.4 e2e artifacts", () => {
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
