/**
 * Section 7.3 — governance / file assertions for Airtable one-way projection.
 *
 * Named plan assertions:
 * - assert mutation 200 when AIRTABLE_API_KEY unset and outbox pending
 * - assert upsert uses internal_id
 * - assert status endpoint returns lag fields
 * - assert @inv:O06
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const sharedAirtable = join(root, "packages", "shared", "src", "airtable.ts");
const sharedIndex = join(root, "packages", "shared", "src", "index.ts");
const migration = join(
  root,
  "packages",
  "db",
  "migrations",
  "0019_projection_records.sql",
);
const schema = join(root, "packages", "db", "schema.ts");
const store = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "airtable",
  "store.ts",
);
const client = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "airtable",
  "client.ts",
);
const commands = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "airtable",
  "commands.ts",
);
const routes = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "airtable",
  "routes.ts",
);
const enqueue = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "airtable",
  "enqueue.ts",
);
const apiTest = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "airtable",
  "airtable.test.ts",
);
const consumer = join(
  root,
  "apps",
  "api",
  "src",
  "workers",
  "airtableConsumer.ts",
);
const indexPath = join(root, "apps", "api", "src", "index.ts");
const envPath = join(root, "apps", "api", "src", "env.ts");
const openapiPath = join(root, "apps", "api", "src", "openapi.ts");
const page = join(root, "apps", "web", "src", "pages", "AirtableStatus.tsx");
const appTsx = join(root, "apps", "web", "src", "App.tsx");
const e2ePath = join(root, "playwright", "e2e", "airtable_status.spec.ts");
const sectionDoc = join(root, "docs", "sections", "7.3-airtable-projection.md");
const inventoryPath = join(
  root,
  "KMS-competition",
  "initiative",
  "BROWSER_E2E_INVENTORY.md",
);
const secretsDoc = join(root, "docs", "SECRETS.md");

describe("7.3 Airtable one-way projection governance", () => {
  it("primary files exist", () => {
    for (const p of [
      sharedAirtable,
      migration,
      schema,
      store,
      client,
      commands,
      routes,
      enqueue,
      apiTest,
      consumer,
      page,
      e2ePath,
      sectionDoc,
    ]) {
      assert.ok(existsSync(p), `missing ${p}`);
    }
  });

  it("schema and migration define projection_records with internal_id", () => {
    const sql = readFileSync(migration, "utf8");
    const sch = readFileSync(schema, "utf8");
    assert.match(sql, /CREATE TABLE IF NOT EXISTS projection_records/i);
    assert.match(sql, /internal_id/i);
    assert.match(sql, /entity_type/i);
    assert.match(sql, /external_id/i);
    assert.match(sql, /source_version/i);
    assert.match(sch, /export const projectionRecords/);
    assert.match(sch, /internalId:\s*text\(["']internal_id["']\)/);
  });

  it("shared exports AIRTABLE_OUTBOX_TOPIC and status schema", () => {
    const src = readFileSync(sharedAirtable, "utf8");
    const idx = readFileSync(sharedIndex, "utf8");
    assert.match(src, /AIRTABLE_OUTBOX_TOPIC\s*=\s*["']airtable\.project["']/);
    assert.match(src, /ReportsAirtableStatusResponseSchema/);
    assert.match(src, /pendingCount/);
    assert.match(src, /oldestPendingAt/);
    assert.match(idx, /airtable\.js/);
  });

  it("assert named tests present in airtable.test.ts", () => {
    const t = readFileSync(apiTest, "utf8");
    assert.match(
      t,
      /assert mutation 200 when AIRTABLE_API_KEY unset and outbox pending/,
    );
    assert.match(t, /assert upsert uses internal_id/);
    assert.match(t, /assert status endpoint returns lag fields/);
  });

  it("routes and consumer avoid request-path Airtable", () => {
    const r = readFileSync(routes, "utf8");
    const c = readFileSync(consumer, "utf8");
    const i = readFileSync(indexPath, "utf8");
    assert.match(r, /airtable\/status/);
    assert.match(r, /Reports\.AirtableStatus|getAirtableStatus/);
    assert.match(r, /never calls Airtable|Never performs Airtable|no request-path/i);
    assert.match(c, /processAirtableOutbox/);
    assert.match(c, /paused|AIRTABLE_API_KEY/);
    assert.match(c, /internalId|internal_id/);
    assert.match(i, /createAirtableRoutes|drainAirtableOutboxFromEnv/);
    assert.match(i, /processAirtableOutbox/);
  });

  it("env documents AIRTABLE_API_KEY and AIRTABLE_BASE_ID names only", () => {
    const e = readFileSync(envPath, "utf8");
    const s = readFileSync(secretsDoc, "utf8");
    assert.match(e, /AIRTABLE_API_KEY/);
    assert.match(e, /AIRTABLE_BASE_ID/);
    assert.match(s, /AIRTABLE_API_KEY/);
    assert.match(s, /AIRTABLE_BASE_ID/);
    // No committed secret values
    assert.doesNotMatch(e, /AIRTABLE_API_KEY\s*=\s*["']pat/);
    assert.doesNotMatch(s, /AIRTABLE_API_KEY\s*=\s*["'][^"']+["']/);
  });

  it("OpenAPI lists Reports.AirtableStatus", () => {
    const o = readFileSync(openapiPath, "utf8");
    assert.match(o, /Reports\.AirtableStatus/);
    assert.match(o, /airtable\/status/);
  });

  it("O06 UI page + inventory IMPLEMENTED + @inv tag", () => {
    const p = readFileSync(page, "utf8");
    const app = readFileSync(appTsx, "utf8");
    const e2e = readFileSync(e2ePath, "utf8");
    const inv = readFileSync(inventoryPath, "utf8");
    assert.match(p, /airtable-status-page/);
    assert.match(p, /ReportsAirtableStatusResponseSchema/);
    assert.match(app, /AirtableStatusPage|settings\/airtable/);
    assert.match(e2e, /@inv:O06/);
    assert.match(e2e, /e2e\/settings\/airtable-status/);
    assert.match(inv, /O06.*IMPLEMENTED|IMPLEMENTED.*O06/);
  });

  it("section doc maps ACs to named assertions", () => {
    const doc = readFileSync(sectionDoc, "utf8");
    assert.match(doc, /S-AIRTABLE/);
    assert.match(doc, /internal_id/);
    assert.match(
      doc,
      /assert mutation 200 when AIRTABLE_API_KEY unset and outbox pending/,
    );
    assert.match(doc, /assert upsert uses internal_id/);
    assert.match(doc, /assert status endpoint returns lag fields/);
    assert.match(doc, /O06/);
  });

  it("no dual-write Airtable on domain command path", () => {
    const eventsCmd = readFileSync(
      join(root, "apps", "api", "src", "modules", "events", "commands.ts"),
      "utf8",
    );
    assert.match(eventsCmd, /enqueueAirtableProjection/);
    assert.match(eventsCmd, /Never Airtable HTTP|never Airtable HTTP|outbox only/i);
    // Must not import live fetch to Airtable from events commands
    assert.doesNotMatch(eventsCmd, /api\.airtable\.com/);
  });
});
