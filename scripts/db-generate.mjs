/**
 * pnpm db:generate — verify Drizzle schema baseline + migration inventory.
 *
 * Section 1.3 baseline SQL is hand-authored (0001_baseline.sql) to match SCHEMA.md.
 * Later sections may add drizzle-kit generate for additive migrations; this gate
 * remains non-interactive and never overwrites 0001.
 *
 * Exit 0 when schema exports and 0001 migration are present and consistent.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = join(root, "packages/db/schema.ts");
const migrationsDir = join(root, "packages/db/migrations");
const baselineSql = join(migrationsDir, "0001_baseline.sql");

const REQUIRED_TABLES = [
  "organizations",
  "events",
  "audit_events",
  "outbox_events",
  "idempotency_keys",
];

function fail(msg) {
  console.error(`[db:generate] ${msg}`);
  process.exit(1);
}

if (!existsSync(schemaPath)) {
  fail(`missing packages/db/schema.ts (E1)`);
}
if (!existsSync(baselineSql)) {
  fail(`missing packages/db/migrations/0001_baseline.sql`);
}

const schemaSrc = readFileSync(schemaPath, "utf8");
const sqlSrc = readFileSync(baselineSql, "utf8");

// Schema must export each baseline table symbol / SQL name
const exportChecks = [
  ["organizations", /export const organizations/],
  ["events", /export const events/],
  ["audit_events", /export const auditEvents/],
  ["outbox_events", /export const outboxEvents/],
  ["idempotency_keys", /export const idempotencyKeys/],
];

for (const [name, re] of exportChecks) {
  if (!re.test(schemaSrc)) {
    fail(`schema.ts must export table for ${name}`);
  }
}

if (!/version:\s*integer\(["']version["']\)/.test(schemaSrc)) {
  fail("events.version column missing from schema.ts");
}

for (const table of REQUIRED_TABLES) {
  if (!new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, "i").test(sqlSrc)) {
    fail(`0001_baseline.sql must CREATE TABLE ${table}`);
  }
}

if (!/\bversion\b/i.test(sqlSrc) || !/CREATE TABLE IF NOT EXISTS events/i.test(sqlSrc)) {
  fail("events.version must appear in 0001_baseline.sql");
}

// Migration files must be linear NNNN_*.sql
const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
for (const f of files) {
  if (!/^\d{4}_.+\.sql$/i.test(f)) {
    fail(`migration filename must match NNNN_name.sql: ${f}`);
  }
}

if (!files.includes("0001_baseline.sql")) {
  fail("expected 0001_baseline.sql in migrations/");
}

console.log("[db:generate] schema.ts exports baseline tables");
console.log("[db:generate] 0001_baseline.sql present and lists required tables");
console.log(`[db:generate] migrations: ${files.sort().join(", ")}`);
console.log(
  "[db:generate] ok — baseline is hand-authored; additive migrations append next NNNN_*.sql",
);
process.exit(0);
