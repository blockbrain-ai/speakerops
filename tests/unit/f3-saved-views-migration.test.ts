/**
 * F3 data-grid primitive — migration proofs for 0037_saved_views.sql.
 * Law: fresh + upgrade from pre-wave head (0036) + rollback + fk_check clean.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import type { Database, SqlJsStatic } from "sql.js";
import {
  migrate,
  inspectSchema,
  defaultMigrationsDir,
  resolveDbPackageRoot,
} from "../../packages/db/src/migrate.js";

const require = createRequire(import.meta.url);
const migrationsDir = defaultMigrationsDir(resolveDbPackageRoot());

const F3_MIGRATION = "0037_saved_views.sql";
const PRE_WAVE_HEAD = "0036_rich_text_columns.sql";

function isPreWaveMigration(file: string): boolean {
  const m = /^(\d{4})_.+\.sql$/i.exec(file);
  if (!m) return false;
  return Number(m[1]) <= 36;
}

let SQL: SqlJsStatic;

beforeAll(async () => {
  const initSqlJs = require("sql.js") as (config?: {
    locateFile?: (file: string) => string;
  }) => Promise<SqlJsStatic>;
  let wasmDir: string;
  try {
    wasmDir = dirname(require.resolve("sql.js/dist/sql-wasm.js"));
  } catch {
    wasmDir = dirname(require.resolve("sql.js"));
  }
  SQL = await initSqlJs({ locateFile: (file: string) => join(wasmDir, file) });
});

function openDb(dbPath: string): Database {
  return new SQL.Database(new Uint8Array(readFileSync(dbPath)));
}

function foreignKeyCheckClean(db: Database): boolean {
  return db.exec("PRAGMA foreign_key_check").length === 0;
}

function seedUserEvent(db: Database): void {
  const now = "2026-08-01T00:00:00.000Z";
  db.run(
    `INSERT INTO organizations (id, name, created_at, updated_at)
     VALUES ('org_f3', 'F3 Org', ?, ?)`,
    [now, now],
  );
  db.run(
    `INSERT INTO events (id, org_id, name, slug, timezone, created_at, updated_at, version)
     VALUES ('evt_f3', 'org_f3', 'F3 Event', 'f3-event', 'UTC', ?, ?, 1)`,
    [now, now],
  );
  db.run(
    `INSERT INTO users (id, email, created_at, updated_at)
     VALUES ('usr_f3', 'f3@example.com', ?, ?)`,
    [now, now],
  );
}

describe("F3 0037 migration — fresh database", () => {
  it("creates saved_views + indexes; fk_check clean", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spo-f3-fresh-"));
    const dbPath = join(dir, "fresh.sqlite");
    try {
      const { tables, result } = await inspectSchema({ dbPath, migrationsDir });
      expect(result.applied, `must apply ${F3_MIGRATION}`).toContain(F3_MIGRATION);
      expect(tables).toContain("saved_views");

      const db = openDb(dbPath);
      try {
        expect(foreignKeyCheckClean(db)).toBe(true);
        const idx = db.exec(
          `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='saved_views'`,
        );
        const names = (idx[0]?.values ?? []).map((r) => String(r[0]));
        expect(names).toContain("idx_saved_views_user_event_surface");
        expect(names).toContain("idx_saved_views_name_scope");
        expect(names).toContain("idx_saved_views_default_scope");
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("F3 0037 migration — upgrade from 0036", () => {
  it("adds saved_views without touching pre-wave tables; fk_check clean", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spo-f3-upg-"));
    const oldMigrations = join(dir, "migrations-0036");
    const dbPath = join(dir, "upgrade.sqlite");
    mkdirSync(oldMigrations, { recursive: true });
    try {
      for (const file of readdirSync(migrationsDir)) {
        if (!/^\d{4}_.+\.sql$/i.test(file)) continue;
        if (!isPreWaveMigration(file)) continue;
        copyFileSync(join(migrationsDir, file), join(oldMigrations, file));
      }
      const preResult = await migrate({ dbPath, migrationsDir: oldMigrations });
      expect(preResult.applied).toContain(PRE_WAVE_HEAD);
      expect(preResult.applied).not.toContain(F3_MIGRATION);

      {
        const db = openDb(dbPath);
        try {
          seedUserEvent(db);
          writeFileSync(dbPath, Buffer.from(db.export()));
        } finally {
          db.close();
        }
      }

      const upgraded = await migrate({ dbPath, migrationsDir });
      expect(upgraded.applied).toContain(F3_MIGRATION);

      const db = openDb(dbPath);
      try {
        // Pre-wave user/event still present.
        const u = db.exec(`SELECT email FROM users WHERE id = 'usr_f3'`);
        expect(u[0]?.values[0]).toEqual(["f3@example.com"]);
        // Can insert a saved view under the new table.
        db.run(
          `INSERT INTO saved_views
            (id, user_id, event_id, surface, name, definition_json, is_default, version, created_at, updated_at)
           VALUES
            ('sv1', 'usr_f3', 'evt_f3', 'submissions', 'Mine', '{}', 0, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
        );
        const n = db.exec(`SELECT COUNT(*) FROM saved_views`);
        expect(Number(n[0]?.values[0]?.[0])).toBe(1);
        expect(foreignKeyCheckClean(db)).toBe(true);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("F3 0037 migration — rollback (drop table) leaves valid schema", () => {
  it("DROP TABLE saved_views preserves users/events; fk_check clean", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spo-f3-rb-"));
    const dbPath = join(dir, "rollback.sqlite");
    try {
      const { result } = await inspectSchema({ dbPath, migrationsDir });
      expect(result.applied).toContain(F3_MIGRATION);

      const db = openDb(dbPath);
      try {
        seedUserEvent(db);
        db.run(
          `INSERT INTO saved_views
            (id, user_id, event_id, surface, name, definition_json, is_default, version, created_at, updated_at)
           VALUES
            ('sv1', 'usr_f3', 'evt_f3', 'submissions', 'Mine', '{}', 0, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
        );
        db.run(`DROP TABLE saved_views`);
        const tables = db
          .exec(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='saved_views'`,
          );
        expect(tables.length).toBe(0);
        const u = db.exec(`SELECT email FROM users WHERE id = 'usr_f3'`);
        expect(u[0]?.values[0]).toEqual(["f3@example.com"]);
        expect(foreignKeyCheckClean(db)).toBe(true);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
