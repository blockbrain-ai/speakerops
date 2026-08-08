/**
 * Section 6.3 — governance / file assertions for readiness dashboard live.
 *
 * Named plan assertions:
 * - assert readiness outstanding decreases after task complete poll
 * - assert @inv:H01-H05 and N01-N04
 * - assert 150-row list scrollable/paginated
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const readinessPage = join(
  root,
  "apps",
  "web",
  "src",
  "pages",
  "Readiness.tsx",
);
const speakersPage = join(
  root,
  "apps",
  "web",
  "src",
  "pages",
  "Speakers.tsx",
);
const utilsPath = join(
  root,
  "apps",
  "web",
  "src",
  "pages",
  "readiness-utils.ts",
);
const utilsTest = join(
  root,
  "apps",
  "web",
  "src",
  "pages",
  "readiness-utils.test.ts",
);
const apiCommands = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "readiness",
  "commands.ts",
);
const apiRoutes = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "readiness",
  "routes.ts",
);
const apiTest = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "readiness",
  "readiness.test.ts",
);
const sharedReadiness = join(
  root,
  "packages",
  "shared",
  "src",
  "readiness.ts",
);
const e2ePath = join(root, "playwright", "e2e", "readiness_dashboard.spec.ts");
const sectionDoc = join(root, "docs", "sections", "6.3-readiness-dashboard.md");
const appTsx = join(root, "apps", "web", "src", "App.tsx");
const indexPath = join(root, "apps", "api", "src", "index.ts");
const openapiPath = join(root, "apps", "api", "src", "openapi.ts");
const shellCss = join(root, "apps", "web", "src", "styles", "shell.css");
const inventoryPath = join(
  root,
  "KMS-competition",
  "initiative",
  "BROWSER_E2E_INVENTORY.md",
);

const H_IDS = ["H01", "H02", "H03", "H04", "H05"];
const N_IDS = ["N01", "N02", "N03", "N04"];

describe("6.3 readiness dashboard governance", () => {
  it("primary files exist", () => {
    assert.equal(existsSync(readinessPage), true, "Readiness.tsx");
    assert.equal(existsSync(speakersPage), true, "Speakers.tsx");
    assert.equal(existsSync(utilsPath), true, "readiness-utils.ts");
    assert.equal(existsSync(utilsTest), true, "readiness-utils.test.ts");
    assert.equal(existsSync(apiCommands), true, "readiness commands");
    assert.equal(existsSync(apiRoutes), true, "readiness routes");
    assert.equal(existsSync(apiTest), true, "readiness.test.ts");
    assert.equal(existsSync(sharedReadiness), true, "shared readiness DTOs");
    assert.equal(existsSync(e2ePath), true, "readiness_dashboard.spec.ts");
    assert.equal(existsSync(sectionDoc), true, "6.3-readiness-dashboard.md");
  });

  it("App routes ReadinessPage at /admin", () => {
    const src = readFileSync(appTsx, "utf8");
    assert.match(src, /ReadinessPage/);
    assert.match(src, /path="\/admin"/);
    assert.doesNotMatch(src, /OverviewPage/);
  });

  it("composition root registers readiness routes", () => {
    const index = readFileSync(indexPath, "utf8");
    assert.match(index, /createReadinessRoutes/);
    assert.match(index, /6\.3/);
  });

  it("OpenAPI registers Reports.Readiness", () => {
    const src = readFileSync(openapiPath, "utf8");
    assert.match(src, /Reports\.Readiness/);
    assert.match(src, /READINESS_OPENAPI_PATHS/);
  });

  it("Readiness UI wires real Reports.Readiness API + live poll", () => {
    const src = readFileSync(readinessPage, "utf8");
    assert.match(src, /\/readiness/);
    assert.match(src, /READINESS_POLL_MS/);
    assert.match(src, /readiness-filter-overdue/);
    assert.match(src, /readiness-stats/);
    assert.match(src, /readiness-empty/);
    assert.match(src, /readiness-drill-/);
    assert.match(src, /setInterval/);
  });

  it("Speakers page paginates large list (L05)", () => {
    const src = readFileSync(speakersPage, "utf8");
    assert.match(src, /SPEAKERS_PAGE_SIZE|paginateSlice/);
    assert.match(src, /speakers-pager/);
    assert.match(src, /speakers-list/);
    assert.match(src, /participationIdFromSearch/);
  });

  it("shell.css defines readiness dashboard with Lumen tokens only", () => {
    const css = readFileSync(shellCss, "utf8");
    assert.match(css, /Section 6\.3/);
    assert.match(css, /\.readiness-dashboard__stat\b/);
    const block = css.slice(css.indexOf("Section 6.3"));
    assert.match(block, /var\(--lumen-/);
    assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}/);
  });

  it("assert readiness outstanding decreases after task complete poll", () => {
    const api = readFileSync(apiTest, "utf8");
    assert.match(
      api,
      /assert readiness outstanding decreases after task complete poll/,
    );
    const e2e = readFileSync(e2ePath, "utf8");
    assert.match(
      e2e,
      /assert readiness outstanding decreases after task complete poll/,
    );
  });

  it("assert @inv:H01-H05 and N01-N04", () => {
    const e2e = readFileSync(e2ePath, "utf8");
    for (const id of H_IDS) {
      assert.match(
        e2e,
        new RegExp(`@inv:${id}\\b`),
        `Playwright must tag @inv:${id}`,
      );
    }
    // N01–N04 remain owned by portal_api_tasks; 6.3 re-affirms H* + L05 here
    const nE2e = readFileSync(
      join(root, "playwright", "e2e", "portal_api_tasks.spec.ts"),
      "utf8",
    );
    for (const id of N_IDS) {
      assert.match(
        nE2e,
        new RegExp(`@inv:${id}\\b`),
        `Playwright must tag @inv:${id}`,
      );
    }
  });

  it("assert 150-row list scrollable/paginated", () => {
    const e2e = readFileSync(e2ePath, "utf8");
    assert.match(e2e, /assert 150-row list scrollable\/paginated/);
    assert.match(e2e, /@inv:L05/);
    assert.match(e2e, /150/);
  });

  it("inventory H01–H05 L05 PASS and N01–N04 PASS or IMPLEMENTED", () => {
    const inv = readFileSync(inventoryPath, "utf8");
    for (const id of [...H_IDS, "L05"]) {
      const row = inv
        .split("\n")
        .find((line) => line.startsWith(`| ${id} |`));
      assert.ok(row, `inventory row ${id}`);
      assert.match(row, /REQUIRED/);
      assert.match(row, /\|\s*PASS\s*\|/);
    }
    for (const id of N_IDS) {
      const re = new RegExp(
        `\\|\\s*${id}\\s*\\|[^\\n]+\\|\\s*(IMPLEMENTED|PASS)\\s*\\|`,
      );
      assert.match(inv, re, `${id} must be IMPLEMENTED or PASS`);
    }
  });

  it("section doc exists and lists H* N* L05", () => {
    const doc = readFileSync(sectionDoc, "utf8");
    assert.match(doc, /6\.3/);
    assert.match(doc, /S-READY/);
    for (const id of H_IDS) {
      assert.match(doc, new RegExp(id));
    }
    assert.match(doc, /L05/);
    assert.match(doc, /N01/);
  });
});
