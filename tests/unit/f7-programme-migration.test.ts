/**
 * F7 programme_publications migration 0039 — fresh + upgrade + fk_check.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
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
const F7 = "0039_programme_publications.sql";
const PRE = "0038_search_documents.sql";

function isPre(file: string): boolean {
  const m = /^(\d{4})_.+\.sql$/i.exec(file);
  return m ? Number(m[1]) <= 38 : false;
}

let SQL: SqlJsStatic;
beforeAll(async () => {
  const initSqlJs = require("sql.js") as (c?: {
    locateFile?: (f: string) => string;
  }) => Promise<SqlJsStatic>;
  let wasmDir: string;
  try {
    wasmDir = dirname(require.resolve("sql.js/dist/sql-wasm.js"));
  } catch {
    wasmDir = dirname(require.resolve("sql.js"));
  }
  SQL = await initSqlJs({ locateFile: (f) => join(wasmDir, f) });
});

function open(path: string): Database {
  return new SQL.Database(new Uint8Array(readFileSync(path)));
}

describe("F7 0039 migration", () => {
  it("fresh creates programme_publications + unique events.slug", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spo-f7-"));
    const dbPath = join(dir, "f.sqlite");
    try {
      const { tables, result } = await inspectSchema({ dbPath, migrationsDir });
      expect(result.applied).toContain(F7);
      expect(tables).toContain("programme_publications");
      const db = open(dbPath);
      try {
        expect(db.exec("PRAGMA foreign_key_check").length).toBe(0);
        const idx = db.exec(
          `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_events_slug_unique'`,
        );
        expect(idx.length).toBe(1);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("upgrade from 0038 adds table", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spo-f7u-"));
    const oldM = join(dir, "m");
    const dbPath = join(dir, "u.sqlite");
    mkdirSync(oldM, { recursive: true });
    try {
      for (const f of readdirSync(migrationsDir)) {
        if (!/^\d{4}_/.test(f) || !isPre(f)) continue;
        copyFileSync(join(migrationsDir, f), join(oldM, f));
      }
      const pre = await migrate({ dbPath, migrationsDir: oldM });
      expect(pre.applied).toContain(PRE);
      const up = await migrate({ dbPath, migrationsDir });
      expect(up.applied).toContain(F7);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
