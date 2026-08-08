/**
 * Section 1.3 — D1 Drizzle baseline governance / file assertions.
 *
 * Complements packages/db/src/migrate.test.ts runtime migration tests.
 * Named AC coverage for schema files, scripts, scope, and composition root.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const schemaPath = join(root, "packages", "db", "schema.ts");
const migrationPath = join(root, "packages", "db", "migrations", "0001_baseline.sql");
const migrationsDir = join(root, "packages", "db", "migrations");
const dbIndexPath = join(root, "packages", "db", "src", "index.ts");
const repositoryPath = join(root, "packages", "db", "src", "repository.ts");
const migrateSrcPath = join(root, "packages", "db", "src", "migrate.ts");
const sectionDocPath = join(root, "docs", "sections", "1.3-d1-baseline.md");
const packageJsonPath = join(root, "package.json");
const wranglerPath = join(root, "wrangler.toml");
const migrateScriptPath = join(root, "scripts", "db-migrate.mjs");
const generateScriptPath = join(root, "scripts", "db-generate.mjs");
const migrateTestPath = join(root, "packages", "db", "src", "migrate.test.ts");

const BASELINE_TABLES = [
  "organizations",
  "events",
  "audit_events",
  "outbox_events",
  "idempotency_keys",
];

describe("1.3 D1 Drizzle baseline", () => {
  it("assert packages/db/schema.ts and 0001_baseline.sql exist with baseline tables", () => {
    assert.equal(existsSync(schemaPath), true, "packages/db/schema.ts (E1)");
    assert.equal(existsSync(migrationPath), true, "packages/db/migrations/0001_baseline.sql");
    assert.equal(existsSync(dbIndexPath), true, "packages/db/src/index.ts composition root");

    const schema = readFileSync(schemaPath, "utf8");
    const sql = readFileSync(migrationPath, "utf8");

    for (const table of BASELINE_TABLES) {
      assert.match(
        sql,
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, "i"),
        `0001 must create ${table}`,
      );
    }

    assert.match(schema, /export const organizations/);
    assert.match(schema, /export const events/);
    assert.match(schema, /export const auditEvents/);
    assert.match(schema, /export const outboxEvents/);
    assert.match(schema, /export const idempotencyKeys/);
  });

  it("assert events.version column exists in schema and migration", () => {
    const schema = readFileSync(schemaPath, "utf8");
    const sql = readFileSync(migrationPath, "utf8");

    assert.match(
      schema,
      /version:\s*integer\(["']version["']\)/,
      "Drizzle events.version required (E1 optimistic concurrency)",
    );
    assert.match(
      sql,
      /version\s+INTEGER\s+NOT\s+NULL/i,
      "SQL events.version INTEGER NOT NULL",
    );
  });

  it("assert audit_events and outbox_events exist with correlation / payload columns", () => {
    const sql = readFileSync(migrationPath, "utf8");
    assert.match(sql, /CREATE TABLE IF NOT EXISTS audit_events/i);
    assert.match(sql, /correlation_id\s+TEXT\s+NOT\s+NULL/i);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS outbox_events/i);
    assert.match(sql, /payload_json\s+TEXT\s+NOT\s+NULL/i);
  });

  it("pnpm db:migrate / db:generate scripts are real (not stub)", () => {
    assert.equal(existsSync(migrateScriptPath), true);
    assert.equal(existsSync(generateScriptPath), true);
    assert.equal(existsSync(migrateSrcPath), true);

    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    assert.match(pkg.scripts["db:migrate"], /db-migrate/);
    assert.match(pkg.scripts["db:generate"], /db-generate/);
    assert.equal(
      /db-stub/.test(pkg.scripts["db:migrate"]),
      false,
      "db:migrate must not use stub",
    );

    const migrateScript = readFileSync(migrateScriptPath, "utf8");
    assert.match(migrateScript, /migrate/);
    assert.equal(/stub — real Drizzle/.test(migrateScript), false);
  });

  it("repository helpers implement eventId scoping pattern", () => {
    assert.equal(existsSync(repositoryPath), true);
    const body = readFileSync(repositoryPath, "utf8");
    assert.match(body, /requireEventId/);
    assert.match(body, /eventScoped|EventScopedOptions/);
    assert.match(body, /buildAuditEventRow|correlationId/);
  });

  it("wrangler.toml points migrations_dir at packages/db/migrations", () => {
    const body = readFileSync(wranglerPath, "utf8");
    assert.match(body, /migrations_dir\s*=\s*["']packages\/db\/migrations["']/);
    assert.match(body, /binding\s*=\s*["']DB["']/);
  });

  it("section doc and named vitest migration tests exist", () => {
    assert.equal(existsSync(sectionDocPath), true, "docs/sections/1.3-d1-baseline.md");
    const doc = readFileSync(sectionDocPath, "utf8");
    assert.match(doc, /1\.3/);
    assert.match(doc, /organizations|audit_events|outbox_events/);

    assert.equal(existsSync(migrateTestPath), true, "packages/db/src/migrate.test.ts");
    const tests = readFileSync(migrateTestPath, "utf8");
    assert.match(
      tests,
      /assert migration creates organizations,events,audit_events,outbox_events,idempotency_keys/,
    );
    assert.match(tests, /assert events\.version column exists/);
    assert.match(tests, /assert second migrate is no-op or succeeds/);
  });

  it("migrations are linear additive NNNN_*.sql only (no domain tables in 1.3)", () => {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
    assert.ok(files.includes("0001_baseline.sql"));
    for (const f of files) {
      assert.match(f, /^\d{4}_.+\.sql$/i, `bad migration name: ${f}`);
    }
    const sql = readFileSync(migrationPath, "utf8");
    // Domain tables from later sections must not appear in baseline
    for (const banned of [
      "submissions",
      "eval_rounds",
      "schedule_placements",
      "api_keys",
      "magic_links",
    ]) {
      assert.equal(
        new RegExp(`CREATE TABLE.*\\b${banned}\\b`, "i").test(sql),
        false,
        `1.3 must not invent domain table ${banned}`,
      );
    }
  });

  it("no secrets in schema/migration/wrangler paths", () => {
    const sql = readFileSync(migrationPath, "utf8");
    assert.equal(/api[_-]?key\s*=\s*['\"][^'\"]+['\"]/i.test(sql), false);
    assert.equal(/sk-[A-Za-z0-9]{10,}/.test(sql), false);
    const wrangler = readFileSync(wranglerPath, "utf8");
    assert.equal(/CLOUDFLARE_API_TOKEN\s*=/.test(wrangler), false);
  });
});
