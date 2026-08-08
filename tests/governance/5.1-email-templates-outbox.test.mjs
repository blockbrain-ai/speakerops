/**
 * Section 5.1 — governance / file assertions for email templates + outbox.
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
  "0015_comms.sql",
);
const commsRoutes = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "comms",
  "routes.ts",
);
const commsCommands = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "comms",
  "commands.ts",
);
const commsTest = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "comms",
  "comms.test.ts",
);
const sharedComms = join(root, "packages", "shared", "src", "comms.ts");
const indexPath = join(root, "apps", "api", "src", "index.ts");
const openapiPath = join(root, "apps", "api", "src", "openapi.ts");
const sectionDoc = join(root, "docs", "sections", "5.1-email-templates.md");
const e2ePath = join(root, "playwright", "e2e", "comms_template.spec.ts");
const commsPage = join(root, "apps", "web", "src", "pages", "Comms.tsx");
const schemaPath = join(root, "packages", "db", "schema.ts");
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

describe("5.1 email templates outbox governance", () => {
  it("0015_comms.sql creates email_templates and message_jobs", () => {
    assert.equal(existsSync(migrationPath), true, "0015_comms.sql must exist");
    const sql = readFileSync(migrationPath, "utf8");
    assert.match(sql, /email_templates/i);
    assert.match(sql, /message_jobs/i);
    assert.match(sql, /idempotency_key/i);
  });

  it("schema.ts defines emailTemplates and messageJobs", () => {
    const src = readFileSync(schemaPath, "utf8");
    assert.match(src, /emailTemplates/);
    assert.match(src, /messageJobs/);
    assert.match(src, /email_templates/);
    assert.match(src, /message_jobs/);
  });

  it("shared DTOs and merge field helpers exist", () => {
    assert.equal(existsSync(sharedComms), true);
    const src = readFileSync(sharedComms, "utf8");
    assert.match(src, /CommsUpsertTemplateBodySchema/);
    assert.match(src, /renderMergeFields/);
    assert.match(src, /COMMS_OUTBOX_TOPIC/);
  });

  it("comms module implements UpsertTemplate, Preview, Send enqueue", () => {
    assert.equal(existsSync(commsRoutes), true);
    assert.equal(existsSync(commsCommands), true);
    const commands = readFileSync(commsCommands, "utf8");
    assert.match(commands, /upsertTemplate|Comms\.UpsertTemplate/);
    assert.match(commands, /previewComms|Comms\.Preview/);
    assert.match(commands, /sendComms|Comms\.Send/);
    assert.match(commands, /insertOutbox|outbox/);
    // No provider SDK/client import in command path (comments may mention providers)
    assert.doesNotMatch(
      commands,
      /from\s+["'](?:resend|@sendgrid|@aws-sdk\/client-ses|nodemailer)/i,
    );
    assert.doesNotMatch(commands, /new\s+Resend\b|SendGrid\(|createTransport\(/);
    const routes = readFileSync(commsRoutes, "utf8");
    assert.match(routes, /templates\/:key/);
    assert.match(routes, /\/preview/);
    assert.match(routes, /\/send/);
  });

  it("composition root registers comms routes", () => {
    const index = readFileSync(indexPath, "utf8");
    assert.match(index, /createEventCommsRoutes|createCommsRoutes/);
    assert.match(index, /MemoryCommsStore|D1CommsStore/);
  });

  it("OpenAPI lists Comms commands", () => {
    const openapi = readFileSync(openapiPath, "utf8");
    assert.match(openapi, /Comms\.UpsertTemplate/);
    assert.match(openapi, /Comms\.Preview/);
    assert.match(openapi, /Comms\.Send/);
  });

  it("named test assertions present in unit suite", () => {
    assert.equal(existsSync(commsTest), true);
    const test = readFileSync(commsTest, "utf8");
    assert.match(test, /assert template upsert stores subject/);
    assert.match(
      test,
      /assert enqueue creates outbox_events not provider HTTP mock call in command/,
    );
  });

  it("admin Comms SPA page wired", () => {
    assert.equal(existsSync(commsPage), true);
    const page = readFileSync(commsPage, "utf8");
    assert.match(page, /comms-template-subject-input/);
    assert.match(page, /\/api\/events\/.*templates/);
  });

  it("Playwright @inv:J01 exists", () => {
    assert.equal(existsSync(e2ePath), true);
    const e2e = readFileSync(e2ePath, "utf8");
    assert.match(e2e, /@inv:J01/);
    assert.match(e2e, /e2e\/comms\/template/);
  });

  it("section doc and COMMANDS map", () => {
    assert.equal(existsSync(sectionDoc), true);
    const doc = readFileSync(sectionDoc, "utf8");
    assert.match(doc, /Comms\.UpsertTemplate/);
    assert.match(doc, /outbox/);
    const commands = readFileSync(commandsPath, "utf8");
    assert.match(commands, /Comms\.UpsertTemplate/);
    assert.match(commands, /\/api\/events\/:eventId\/templates\/:key/);
  });

  it("inventory J01 is IMPLEMENTED (not shrunk)", () => {
    const inv = readFileSync(inventoryPath, "utf8");
    assert.match(inv, /\| J01 \|/);
    assert.match(inv, /J01.*IMPLEMENTED|IMPLEMENTED.*J01|J01 \| admin \| Comms \|.*IMPLEMENTED/);
  });
});
