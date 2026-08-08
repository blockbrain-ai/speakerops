/**
 * Section 4.1 — governance / file assertions for portal API tasks.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const migrationPath = join(
  root,
  "packages",
  "db",
  "migrations",
  "0012_portal.sql",
);
const portalRoutes = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "portal",
  "routes.ts",
);
const portalCommands = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "portal",
  "commands.ts",
);
const portalTest = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "portal",
  "portal.test.ts",
);
const sharedPortal = join(root, "packages", "shared", "src", "portal.ts");
const indexPath = join(root, "apps", "api", "src", "index.ts");
const openapiPath = join(root, "apps", "api", "src", "openapi.ts");
const sectionDoc = join(root, "docs", "sections", "4.1-portal-api.md");
const e2ePath = join(root, "playwright", "e2e", "portal_api_tasks.spec.ts");
const taskTemplatesPage = join(
  root,
  "apps",
  "web",
  "src",
  "pages",
  "TaskTemplatesSettings.tsx",
);
const speakersPage = join(root, "apps", "web", "src", "pages", "Speakers.tsx");
const commandsPath = join(
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

describe("4.1 portal API governance", () => {
  it("0012_portal.sql adds participation user_id index", () => {
    assert.equal(existsSync(migrationPath), true, "0012_portal.sql must exist");
    const sql = readFileSync(migrationPath, "utf8");
    assert.match(sql, /idx_event_participations_user_id/i);
  });

  it("portal module + shared DTOs + composition root exist", () => {
    assert.equal(existsSync(portalRoutes), true);
    assert.equal(existsSync(portalCommands), true);
    assert.equal(existsSync(portalTest), true);
    assert.equal(existsSync(sharedPortal), true);
    assert.equal(existsSync(sectionDoc), true);
    const index = readFileSync(indexPath, "utf8");
    assert.match(index, /createPortalRoutes/);
    assert.match(index, /createEventPortalRoutes/);
    assert.match(index, /4\.1/);
  });

  it("COMMANDS.md maps portal + speakers + task-templates routes", () => {
    const cmd = readFileSync(commandsPath, "utf8");
    assert.match(cmd, /Portal\.GetHome/);
    assert.match(cmd, /Task\.Complete/);
    assert.match(cmd, /Participation\.UpdateProfile/);
    assert.match(cmd, /Speakers\.List/);
    assert.match(cmd, /TaskTemplate\.Create/);
    assert.match(cmd, /\/api\/portal\/home/);
    assert.match(cmd, /\/api\/events\/:eventId\/speakers/);
    assert.match(cmd, /\/api\/events\/:eventId\/task-templates/);
  });

  it("OpenAPI registers portal commands", () => {
    const src = readFileSync(openapiPath, "utf8");
    assert.match(src, /Portal\.GetHome/);
    assert.match(src, /TaskTemplate\.List/);
    assert.match(src, /Speakers\.List/);
  });

  it("unit tests name required assertions", () => {
    const src = readFileSync(portalTest, "utf8");
    assert.match(
      src,
      /assert speaker cannot complete another participation task/,
    );
    assert.match(src, /assert templates CRUD admin only/);
    assert.match(src, /assert speakers list scoped by eventId/);
  });

  it("UI pages + Playwright inventory tags for O05 and N01–N04", () => {
    assert.equal(existsSync(taskTemplatesPage), true);
    assert.equal(existsSync(speakersPage), true);
    assert.equal(existsSync(e2ePath), true);
    const e2e = readFileSync(e2ePath, "utf8");
    assert.match(e2e, /@inv:O05/);
    assert.match(e2e, /@inv:N01/);
    assert.match(e2e, /@inv:N02/);
    assert.match(e2e, /@inv:N03/);
    assert.match(e2e, /@inv:N04/);
    assert.match(e2e, /@playwright\/test/);
  });

  it("inventory O05 and N01–N04 are IMPLEMENTED or PASS", () => {
    const inv = readFileSync(inventoryPath, "utf8");
    for (const id of ["O05", "N01", "N02", "N03", "N04"]) {
      const re = new RegExp(`\\|\\s*${id}\\s*\\|[^\\n]+\\|\\s*(IMPLEMENTED|PASS)\\s*\\|`);
      assert.match(
        inv,
        re,
        `${id} must be IMPLEMENTED or PASS in BROWSER_E2E_INVENTORY.md`,
      );
    }
  });
});
