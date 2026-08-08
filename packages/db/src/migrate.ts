/**
 * Local D1-compatible migration runner (sql.js — pure WASM, no native addons).
 *
 * Applies packages/db/migrations/*.sql in lexical order.
 * Tracks applied files in schema_migrations so re-runs are no-ops.
 *
 * Used by `pnpm db:migrate` and unit tests. Cloudflare deploy paths use
 * wrangler d1 migrations with the same SQL files (migrations_dir).
 *
 * Env:
 *   SPEAKEROPS_DB_PATH — sqlite file path (default: .data/speakerops.local.sqlite)
 *   No secrets required for local apply.
 */
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Database, SqlJsStatic } from "sql.js";

const require = createRequire(import.meta.url);

/** Package root (packages/db) — migrations live next to schema.ts. */
export function resolveDbPackageRoot(fromFile = import.meta.url): string {
  const here = dirname(fileURLToPath(fromFile));
  let dir = here;
  for (let i = 0; i < 5; i++) {
    if (
      existsSync(join(dir, "migrations")) &&
      (existsSync(join(dir, "schema.ts")) || existsSync(join(dir, "package.json")))
    ) {
      return dir;
    }
    dir = dirname(dir);
  }
  return resolve(here, "../..");
}

export function defaultMigrationsDir(packageRoot?: string): string {
  return join(packageRoot ?? resolveDbPackageRoot(), "migrations");
}

export function defaultDbPath(): string {
  if (typeof process !== "undefined" && process.env.SPEAKEROPS_DB_PATH) {
    return resolve(process.env.SPEAKEROPS_DB_PATH);
  }
  return resolve(process.cwd(), ".data", "speakerops.local.sqlite");
}

export type MigrateOptions = {
  /** SQLite file path, or ":memory:" for tests. */
  dbPath?: string;
  /** Directory containing NNNN_*.sql files. */
  migrationsDir?: string;
};

export type MigrateResult = {
  dbPath: string;
  migrationsDir: string;
  applied: string[];
  skipped: string[];
  tables: string[];
};

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

async function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = (async () => {
      const initSqlJs = require("sql.js") as (
        config?: { locateFile?: (file: string) => string },
      ) => Promise<SqlJsStatic>;
      // Resolve wasm next to the sql.js package
      let wasmDir: string;
      try {
        wasmDir = dirname(require.resolve("sql.js/dist/sql-wasm.js"));
      } catch {
        wasmDir = dirname(require.resolve("sql.js"));
      }
      return initSqlJs({
        locateFile: (file: string) => join(wasmDir, file),
      });
    })();
  }
  return sqlJsPromise;
}

function openDatabase(SQL: SqlJsStatic, dbPath: string): Database {
  if (dbPath === ":memory:") {
    return new SQL.Database();
  }
  mkdirSync(dirname(dbPath), { recursive: true });
  if (existsSync(dbPath)) {
    const buf = readFileSync(dbPath);
    return new SQL.Database(new Uint8Array(buf));
  }
  return new SQL.Database();
}

function persistDatabase(db: Database, dbPath: string): void {
  if (dbPath === ":memory:") return;
  mkdirSync(dirname(dbPath), { recursive: true });
  const data = db.export();
  writeFileSync(dbPath, Buffer.from(data));
}

function listSqlMigrations(migrationsDir: string): string[] {
  if (!existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }
  return readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_.+\.sql$/i.test(f))
    .sort();
}

function ensureMigrationsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

function appliedSet(db: Database): Set<string> {
  const result = db.exec("SELECT id FROM schema_migrations");
  const ids = new Set<string>();
  if (result.length > 0) {
    for (const row of result[0].values) {
      ids.add(String(row[0]));
    }
  }
  return ids;
}

function listUserTables(db: Database): string[] {
  const result = db.exec(
    `SELECT name FROM sqlite_master
     WHERE type = 'table'
       AND name NOT LIKE 'sqlite_%'
       AND name != 'schema_migrations'
     ORDER BY name`,
  );
  if (result.length === 0) return [];
  return result[0].values.map((row) => String(row[0]));
}

function listColumns(db: Database, table: string): string[] {
  // PRAGMA table_info does not accept bound params for table name; whitelist from sqlite_master.
  const tables = listUserTables(db);
  if (!tables.includes(table)) return [];
  const result = db.exec(`PRAGMA table_info(${JSON.stringify(table)})`);
  if (result.length === 0) return [];
  // columns: cid, name, type, notnull, dflt_value, pk — name is index 1
  return result[0].values.map((row) => String(row[1]));
}

/**
 * Apply pending SQL migrations. Safe to call repeatedly (second run no-op).
 */
export async function migrate(options: MigrateOptions = {}): Promise<MigrateResult> {
  const dbPath = options.dbPath ?? defaultDbPath();
  const migrationsDir = options.migrationsDir ?? defaultMigrationsDir();
  const files = listSqlMigrations(migrationsDir);

  const SQL = await loadSqlJs();
  const db = openDatabase(SQL, dbPath);
  try {
    db.run("PRAGMA foreign_keys = ON;");
    ensureMigrationsTable(db);
    const already = appliedSet(db);
    const applied: string[] = [];
    const skipped: string[] = [];

    for (const file of files) {
      if (already.has(file)) {
        skipped.push(file);
        continue;
      }
      const sql = readFileSync(join(migrationsDir, file), "utf8");
      // exec runs multi-statement SQL files (run only executes the first statement).
      db.exec(sql);
      db.run("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)", [
        file,
        new Date().toISOString(),
      ]);
      applied.push(file);
    }

    persistDatabase(db, dbPath);

    return {
      dbPath,
      migrationsDir,
      applied,
      skipped,
      tables: listUserTables(db),
    };
  } finally {
    db.close();
  }
}

/**
 * Open a DB, migrate, and return table column info for assertions.
 */
export async function inspectSchema(options: MigrateOptions = {}): Promise<{
  tables: string[];
  columns: Record<string, string[]>;
  result: MigrateResult;
}> {
  const dbPath = options.dbPath ?? defaultDbPath();
  const migrationsDir = options.migrationsDir ?? defaultMigrationsDir();
  const result = await migrate({ dbPath, migrationsDir });

  const SQL = await loadSqlJs();
  const db = openDatabase(SQL, dbPath);
  try {
    const tables = listUserTables(db);
    const columns: Record<string, string[]> = {};
    for (const table of tables) {
      columns[table] = listColumns(db, table);
    }
    return { tables, columns, result };
  } finally {
    db.close();
  }
}

/** Baseline table names required by section 1.3 AC. */
export const BASELINE_TABLES = [
  "organizations",
  "events",
  "audit_events",
  "outbox_events",
  "idempotency_keys",
] as const;

/** Auth table names required by section 2.1 AC. */
export const AUTH_TABLES = ["users", "auth_sessions", "magic_links"] as const;

/** Membership table names required by section 2.2 AC. */
export const MEMBERSHIP_TABLES = ["event_memberships"] as const;

/** Rooms/tracks table names required by section 2.3 AC. */
export const EVENT_SETTINGS_TABLES = ["rooms", "tracks"] as const;

/** Design Kit table names required by section 2.4 AC. */
export const DESIGN_TABLES = [
  "design_token_drafts",
  "design_token_published",
  "file_assets",
] as const;

/** file_assets readiness column (phase-audit fix; migration 0006). */
export const FILE_ASSETS_UPLOADED_COLUMN = "uploaded" as const;

/** file_assets virus scan stub (section 4.2; migration 0013). */
export const FILE_ASSETS_VIRUS_SCAN_COLUMN = "virus_scan_status" as const;

/** Forms table names required by section 3.1 AC. */
export const FORM_TABLES = [
  "forms",
  "form_versions",
  "form_fields",
  "form_rules",
] as const;

/** Submissions / people table names required by section 3.3 AC. */
export const SUBMISSION_TABLES = [
  "people",
  "submissions",
  "submission_answers",
  "submission_speakers",
] as const;

/** Eval table names required by section 3.4 AC. */
export const EVAL_TABLES = [
  "eval_rounds",
  "eval_criteria",
  "eval_assignments",
  "scores",
] as const;

/** Decision / session / task table names required by section 3.5 AC. */
export const DECISION_TABLES = [
  "decisions",
  "event_participations",
  "sessions",
  "session_speakers",
  "task_templates",
  "speaker_tasks",
] as const;

/** Comms table names required by section 5.1 AC. */
export const COMMS_TABLES = ["email_templates", "message_jobs"] as const;

/** Comms send / ICS table names required by section 5.2 AC. */
export const COMMS_SEND_TABLES = [
  "message_recipients",
  "delivery_events",
  "calendar_invites",
] as const;
