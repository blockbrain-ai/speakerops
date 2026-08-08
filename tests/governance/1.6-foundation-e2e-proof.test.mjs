/**
 * Section 1.6 — Foundation e2e proof governance / file assertions.
 *
 * Locks AC surface that must pass in `pnpm test:ci` (non-browser):
 * - foundation_smoke.spec.ts exists with named assertions
 * - e2e-api-server + playwright webServer wiring
 * - section doc + evidence path
 * - no new product handlers; no secrets
 *
 * Browser execution of foundation smoke is `pnpm test:e2e` (I12 keystone).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const smokeSpec = join(root, "playwright", "e2e", "foundation_smoke.spec.ts");
const e2eApiServer = join(root, "scripts", "e2e-api-server.mjs");
const e2eRun = join(root, "scripts", "e2e-run.mjs");
const playwrightConfig = join(root, "playwright.config.ts");
const sectionDoc = join(
  root,
  "docs",
  "sections",
  "1.6-foundation-e2e-proof.md",
);
const evidencePath = join(
  root,
  "KMS-competition",
  "initiative",
  "evidence",
  "phase1.txt",
);
const packageJsonPath = join(root, "package.json");
const apiIndexPath = join(root, "apps", "api", "src", "index.ts");

const SECRET_PATTERNS = [
  /api[_-]?key\s*[:=]\s*["'][^"']{8,}["']/i,
  /secret\s*[:=]\s*["'][^"']{8,}["']/i,
  /password\s*[:=]\s*["'][^"']+["']/i,
  /Bearer\s+[A-Za-z0-9\-._~+/]{20,}=*/,
  /sk-[A-Za-z0-9]{20,}/,
  /CLOUDFLARE_API_TOKEN\s*=\s*["'][^"']+["']/,
  /AIRTABLE_API_KEY\s*=\s*["'][^"']+["']/,
];

describe("1.6 foundation e2e proof", () => {
  it("foundation_smoke.spec.ts exists with named assertions", () => {
    assert.equal(existsSync(smokeSpec), true, "playwright/e2e/foundation_smoke.spec.ts");
    const body = readFileSync(smokeSpec, "utf8");
    assert.match(body, /@playwright\/test/);
    assert.match(body, /CFP\|Forms|CFP\s*\/\s*Forms|\/CFP\|Forms\/i/);
    assert.match(body, /pageerror/);
    assert.match(body, /\/health|get\(["']\/health["']\)/);
    assert.match(body, /page\.goto|goto\(/);
    assert.match(body, /1\.6|foundation smoke|I12/i);
  });

  it("wires local baseURL + webServer for health + SPA", () => {
    assert.equal(existsSync(playwrightConfig), true);
    const cfg = readFileSync(playwrightConfig, "utf8");
    assert.match(cfg, /baseURL/);
    assert.match(cfg, /E2E_WEB_SERVER|webServer/);
    assert.match(cfg, /e2e-api-server|E2E_API_PORT|8787/);
    assert.match(cfg, /5173|E2E_WEB_PORT|vite/i);

    assert.equal(existsSync(e2eApiServer), true, "scripts/e2e-api-server.mjs");
    const apiSrv = readFileSync(e2eApiServer, "utf8");
    assert.match(apiSrv, /createApp|\/health/);
    assert.match(apiSrv, /E2E_API_PORT|8787/);

    assert.equal(existsSync(e2eRun), true);
    const run = readFileSync(e2eRun, "utf8");
    assert.match(run, /E2E_WEB_SERVER/);
    assert.match(run, /playwright/);
  });

  it("section doc notes evidence path and N/A product surface", () => {
    assert.equal(existsSync(sectionDoc), true, "docs/sections/1.6-foundation-e2e-proof.md");
    const doc = readFileSync(sectionDoc, "utf8");
    assert.match(doc, /foundation_smoke\.spec\.ts/);
    assert.match(doc, /evidence\/phase1\.txt|Evidence path/i);
    assert.match(doc, /N\/A|no new.*handler/i);
    assert.match(doc, /CFP|Forms/);
    assert.match(doc, /pageerror|uncaught/i);
    assert.match(doc, /\/health/);
  });

  it("evidence path file exists for phase 1 keystone", () => {
    assert.equal(
      existsSync(evidencePath),
      true,
      "KMS-competition/initiative/evidence/phase1.txt must exist",
    );
    const evidence = readFileSync(evidencePath, "utf8");
    assert.match(evidence, /1\.6|foundation|health|e2e/i);
  });

  it("pnpm test:e2e remains non-interactive (no --watch)", () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    assert.equal(typeof pkg.scripts["test:e2e"], "string");
    assert.doesNotMatch(pkg.scripts["test:e2e"], /--watch/);
    assert.match(pkg.scripts["test:e2e"], /e2e-run/);
  });

  it("N/A: no new product HTTP handlers beyond /health (scope guard)", () => {
    const api = readFileSync(apiIndexPath, "utf8");
    // Still health-only composition root for foundation (domain routes later)
    assert.match(api, /app\.get\(["']\/health["']/);
    assert.doesNotMatch(api, /app\.(get|post|put|patch|delete)\(["']\/api\//);
    const smoke = readFileSync(smokeSpec, "utf8");
    assert.doesNotMatch(smoke, /magic[_-]?link|api[_-]?key\s*[:=]\s*["'][A-Za-z0-9]{16,}/i);
  });

  it("no secrets committed in 1.6 e2e artifacts", () => {
    const files = [smokeSpec, e2eApiServer, e2eRun, playwrightConfig, sectionDoc, evidencePath];
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
    }
  });
});
