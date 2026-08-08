/**
 * Section 5.3 — governance / file assertions for Comms admin UI.
 *
 * Named plan assertions:
 * - assert send button disabled until preview
 * - assert @inv:J01-J10
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const commsPage = join(root, "apps", "web", "src", "pages", "Comms.tsx");
const commsUtils = join(root, "apps", "web", "src", "pages", "comms-utils.ts");
const commsUtilsTest = join(
  root,
  "apps",
  "web",
  "src",
  "pages",
  "comms-utils.test.ts",
);
const e2ePath = join(root, "playwright", "e2e", "comms_admin.spec.ts");
const sectionDoc = join(root, "docs", "sections", "5.3-comms-ui.md");
const routesPath = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "comms",
  "routes.ts",
);
const commandsPath = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "comms",
  "commands.ts",
);
const sharedComms = join(root, "packages", "shared", "src", "comms.ts");
const openapiPath = join(root, "apps", "api", "src", "openapi.ts");
const contractsCommands = join(
  root,
  "KMS-competition",
  "initiative",
  "contracts",
  "COMMANDS.md",
);
const inventoryPath = join(
  root,
  "KMS-competition",
  "initiative",
  "BROWSER_E2E_INVENTORY.md",
);
const appTsx = join(root, "apps", "web", "src", "App.tsx");

const INV_IDS = [
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

describe("5.3 comms admin UI governance", () => {
  it("primary files exist", () => {
    assert.equal(existsSync(commsPage), true, "Comms.tsx");
    assert.equal(existsSync(commsUtils), true, "comms-utils.ts");
    assert.equal(existsSync(commsUtilsTest), true, "comms-utils.test.ts");
    assert.equal(existsSync(e2ePath), true, "comms_admin.spec.ts");
    assert.equal(existsSync(sectionDoc), true, "5.3-comms-ui.md");
  });

  it("assert @inv:J01-J10 appear in Playwright e2e files", () => {
    const admin = readFileSync(e2ePath, "utf8");
    const j01File = join(root, "playwright", "e2e", "comms_template.spec.ts");
    const j01 = readFileSync(j01File, "utf8");
    // J01 owned by 5.1 template spec (no duplicate owners)
    assert.match(j01, /@inv:J01\b/);
    assert.match(j01, /e2e\/comms\/template/);
    for (const id of INV_IDS.filter((x) => x !== "J01")) {
      assert.match(
        admin,
        new RegExp(`@inv:${id}\\b`),
        `missing @inv:${id} in comms_admin.spec.ts`,
      );
    }
    assert.match(admin, /e2e\/comms\/segment/);
    assert.match(admin, /e2e\/comms\/preview/);
    assert.match(admin, /e2e\/comms\/send-idempotent/);
    assert.match(admin, /e2e\/comms\/log/);
    assert.match(admin, /e2e\/comms\/ics/);
    assert.match(admin, /e2e\/comms\/authz/);
    assert.match(admin, /e2e\/comms\/preview-required/);
    assert.match(admin, /e2e\/comms\/preview-invalidate/);
    assert.match(admin, /e2e\/comms\/ics-update/);
  });

  it("assert send button disabled until preview", () => {
    const utils = readFileSync(commsUtils, "utf8");
    const utilsTest = readFileSync(commsUtilsTest, "utf8");
    const page = readFileSync(commsPage, "utf8");
    const e2e = readFileSync(e2ePath, "utf8");
    assert.match(utils, /isSendEnabled/);
    assert.match(utilsTest, /assert send button disabled until preview/);
    assert.match(page, /comms-send-button/);
    assert.match(page, /isSendEnabled|sendEnabled/);
    assert.match(e2e, /assert send button disabled until preview/);
    assert.match(e2e, /comms-send-button.*toBeDisabled|toBeDisabled/);
  });

  it("Comms SPA wires segment, preview, send, log, ICS", () => {
    const page = readFileSync(commsPage, "utf8");
    assert.match(page, /comms-segment-builder/);
    assert.match(page, /comms-segment-count/);
    assert.match(page, /comms-preview-panel|comms-preview-run/);
    assert.match(page, /comms-send-button/);
    assert.match(page, /comms-delivery-log/);
    assert.match(page, /comms-ics-panel/);
    assert.match(page, /\/api\/comms\/preview/);
    assert.match(page, /\/api\/comms\/send/);
    assert.match(page, /comms\/jobs/);
    assert.match(page, /comms\/ics/);
    assert.match(page, /data-section="5\.3"/);
  });

  it("App routes /admin/comms to CommsPage", () => {
    const app = readFileSync(appTsx, "utf8");
    assert.match(app, /CommsPage|pages\/Comms/);
    assert.match(app, /\/admin\/comms/);
  });

  it("API list/get routes and ICS HTTP exist", () => {
    const routes = readFileSync(routesPath, "utf8");
    assert.match(routes, /listTemplates|ListTemplates/);
    assert.match(routes, /comms\/jobs/);
    assert.match(routes, /comms\/ics/);
    assert.match(routes, /icsForPlacementCommand/);
    const commands = readFileSync(commandsPath, "utf8");
    assert.match(commands, /export async function listTemplates/);
    assert.match(commands, /export async function listJobs/);
    assert.match(commands, /export async function getJob/);
    assert.match(commands, /export async function listIcs/);
  });

  it("shared DTOs for list jobs and ICS", () => {
    const shared = readFileSync(sharedComms, "utf8");
    assert.match(shared, /CommsListJobsResponseSchema/);
    assert.match(shared, /CommsGetJobResponseSchema/);
    assert.match(shared, /CommsListIcsResponseSchema/);
    assert.match(shared, /CommsIcsForPlacementBodySchema/);
  });

  it("OpenAPI and COMMANDS include 5.3 list/ICS routes", () => {
    const openapi = readFileSync(openapiPath, "utf8");
    assert.match(openapi, /Comms\.ListTemplates/);
    assert.match(openapi, /Comms\.ListJobs/);
    assert.match(openapi, /Comms\.GetJob/);
    assert.match(openapi, /Comms\.ListIcs/);
    assert.match(openapi, /Comms\.IcsForPlacement/);
    const contracts = readFileSync(contractsCommands, "utf8");
    assert.match(contracts, /Comms\.ListTemplates/);
    assert.match(contracts, /Comms\.ListJobs/);
    assert.match(contracts, /\/api\/events\/:eventId\/comms\/jobs/);
    assert.match(contracts, /\/api\/events\/:eventId\/comms\/ics/);
  });

  it("inventory J01–J10 are IMPLEMENTED (not shrunk)", () => {
    const inv = readFileSync(inventoryPath, "utf8");
    for (const id of INV_IDS) {
      assert.match(inv, new RegExp(`\\| ${id} \\|`));
      // Status column ends with IMPLEMENTED (or PASS)
      assert.match(
        inv,
        new RegExp(`\\| ${id} \\| admin \\| Comms \\|.*\\| (IMPLEMENTED|PASS) \\|`),
        `${id} must be IMPLEMENTED or PASS`,
      );
    }
  });

  it("section doc covers trust-before-send", () => {
    const doc = readFileSync(sectionDoc, "utf8");
    assert.match(doc, /J01|J10|trust-before-send/i);
    assert.match(doc, /assert send button disabled until preview/);
    assert.match(doc, /S-COMMS/);
  });
});
