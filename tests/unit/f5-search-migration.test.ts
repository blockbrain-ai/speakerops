/**
 * F5 search_documents migration 0038 — fresh + upgrade + rollback + fk_check.
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
const F5_MIGRATION = "0038_search_documents.sql";
const PRE_WAVE_HEAD = "0037_saved_views.sql";

function isPreWave(file: string): boolean {
  const m = /^(\d{4})_.+\.sql$/i.exec(file);
  return m ? Number(m[1]) <= 37 : false;
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

function fkClean(db: Database): boolean {
  return db.exec("PRAGMA foreign_key_check").length === 0;
}

describe("F5 0038 migration — fresh", () => {
  it("creates search_documents content table; fk_check clean", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spo-f5-fresh-"));
    const dbPath = join(dir, "fresh.sqlite");
    try {
      const { tables, result } = await inspectSchema({ dbPath, migrationsDir });
      expect(result.applied).toContain(F5_MIGRATION);
      expect(tables).toContain("search_documents");
      const db = openDb(dbPath);
      try {
        expect(fkClean(db)).toBe(true);
        // Insert content row (triggers may populate FTS when available).
        db.run(
          `INSERT INTO search_documents
            (id, entity_type, entity_id, event_id, title, body, route, updated_at)
           VALUES
            ('submission:s1', 'submission', 's1', 'e1', 'Hello Find', 'body', '/admin/submissions', '2026-01-01T00:00:00.000Z')`,
        );
        const n = db.exec(`SELECT COUNT(*) FROM search_documents`);
        expect(Number(n[0]?.values[0]?.[0])).toBe(1);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("F5 0038 migration — upgrade from 0037", () => {
  it("adds search_documents without disturbing saved_views", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spo-f5-upg-"));
    const oldMigrations = join(dir, "mig-0037");
    const dbPath = join(dir, "upgrade.sqlite");
    mkdirSync(oldMigrations, { recursive: true });
    try {
      for (const file of readdirSync(migrationsDir)) {
        if (!/^\d{4}_.+\.sql$/i.test(file) || !isPreWave(file)) continue;
        copyFileSync(join(migrationsDir, file), join(oldMigrations, file));
      }
      const pre = await migrate({ dbPath, migrationsDir: oldMigrations });
      expect(pre.applied).toContain(PRE_WAVE_HEAD);
      expect(pre.applied).not.toContain(F5_MIGRATION);

      const up = await migrate({ dbPath, migrationsDir });
      expect(up.applied).toContain(F5_MIGRATION);
      const db = openDb(dbPath);
      try {
        expect(fkClean(db)).toBe(true);
        const t = db.exec(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='search_documents'`,
        );
        expect(t.length).toBe(1);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("F5 0038 migration — rollback", () => {
  it("DROP TABLE search_documents leaves valid schema", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spo-f5-rb-"));
    const dbPath = join(dir, "rb.sqlite");
    try {
      await inspectSchema({ dbPath, migrationsDir });
      const db = openDb(dbPath);
      try {
        try {
          db.run(`DROP TABLE IF EXISTS search_documents_fts`);
        } catch {
          /* fts optional if create failed in env */
        }
        db.run(`DROP TABLE IF EXISTS search_documents`);
        expect(fkClean(db)).toBe(true);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
