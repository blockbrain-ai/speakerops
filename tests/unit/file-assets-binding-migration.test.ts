/**
 * Final-audit residual — CFP upload binding migration proofs (fresh DB +
 * upgrade from the pre-fix head 0032), per the migration law: every schema
 * change is a new numbered migration and tests run against BOTH paths with a
 * clean PRAGMA foreign_key_check.
 *
 * New migration under test:
 * - 0033_file_assets_form_binding.sql (form_version_id / field_key TEXT,
 *   default NULL — the persisted upload authorization Submission.Create
 *   re-checks against the pinned version + answering field)
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
import { SqlJsD1 } from "../helpers/sqljs-d1.js";
import { D1DesignStore } from "../../apps/api/src/modules/design/store.js";

const require = createRequire(import.meta.url);
const migrationsDir = defaultMigrationsDir(resolveDbPackageRoot());

const BINDING_MIGRATION = "0033_file_assets_form_binding.sql";

/** Pre-fix head: keep only migrations numbered 0001–0032 when staging "old". */
function isPreFixMigration(file: string): boolean {
  const m = /^(\d{4})_.+\.sql$/i.exec(file);
  if (!m) return false;
  return Number(m[1]) <= 32;
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
  const res = db.exec("PRAGMA foreign_key_check");
  return res.length === 0;
}

describe("file_assets upload-binding migration — fresh database", () => {
  it("fresh migrate applies 0033 and creates form_version_id/field_key on file_assets", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spo-fab-fresh-"));
    const dbPath = join(dir, "fresh.sqlite");
    try {
      const { columns, result } = await inspectSchema({
        dbPath,
        migrationsDir,
      });
      expect(result.applied, `must apply ${BINDING_MIGRATION}`).toContain(
        BINDING_MIGRATION,
      );
      expect(columns.file_assets).toContain("form_version_id");
      expect(columns.file_assets).toContain("field_key");

      const db = openDb(dbPath);
      try {
        expect(foreignKeyCheckClean(db)).toBe(true);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("file_assets upload-binding migration — upgrade from pre-fix head 0032", () => {
  it("upgrade preserves existing assets with honest NULL bindings", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spo-fab-upg-"));
    const oldMigrations = join(dir, "migrations-0032");
    const dbPath = join(dir, "upgrade.sqlite");
    mkdirSync(oldMigrations, { recursive: true });
    try {
      // Stage only pre-fix migrations (<= 0032).
      for (const file of readdirSync(migrationsDir)) {
        if (!/^\d{4}_.+\.sql$/i.test(file)) continue;
        if (!isPreFixMigration(file)) continue;
        copyFileSync(join(migrationsDir, file), join(oldMigrations, file));
      }
      const preResult = await migrate({
        dbPath,
        migrationsDir: oldMigrations,
      });
      expect(preResult.applied).toContain(
        "0032_task_templates_required_default.sql",
      );
      expect(preResult.applied).not.toContain(BINDING_MIGRATION);

      // Seed a pre-fix uploaded asset the upgrade must preserve untouched.
      {
        const db = openDb(dbPath);
        try {
          db.run(
            `INSERT INTO file_assets
               (id, event_id, owner_participation_id, r2_key, filename, mime,
                size, checksum, purpose, created_at, uploaded)
             VALUES
               ('file_up', 'evt_up', NULL, 'events/evt_up/cfp/file_up.pdf',
                'legacy.pdf', 'application/pdf', 13, NULL, 'other',
                '2026-08-01T00:00:00.000Z', 1)`,
          );
          const bytes = db.export();
          rmSync(dbPath);
          writeFileSync(dbPath, Buffer.from(bytes));
        } finally {
          db.close();
        }
      }

      // Upgrade: apply the full set including 0033.
      const upgraded = await migrate({ dbPath, migrationsDir });
      expect(
        upgraded.applied,
        `upgrade must apply ${BINDING_MIGRATION}`,
      ).toContain(BINDING_MIGRATION);

      const db = openDb(dbPath);
      try {
        // Existing rows keep their identity and gain honest NULL bindings —
        // legacy assets fail the submit-time binding check closed.
        const row = db.exec(
          `SELECT filename, uploaded, form_version_id, field_key
           FROM file_assets WHERE id = 'file_up'`,
        );
        expect(row[0]?.values[0]).toEqual(["legacy.pdf", 1, null, null]);
        expect(foreignKeyCheckClean(db)).toBe(true);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("D1DesignStore round-trips the persisted upload binding", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spo-fab-store-"));
    const dbPath = join(dir, "store.sqlite");
    try {
      await migrate({ dbPath, migrationsDir });
      const db = openDb(dbPath);
      try {
        const design = new D1DesignStore(new SqlJsD1(db));
        const now = "2026-08-10T00:00:00.000Z";
        await design.insertFile({
          id: "file_bound",
          eventId: "evt_b",
          ownerParticipationId: null,
          r2Key: "events/evt_b/cfp/file_bound.pdf",
          filename: "bound.pdf",
          mime: "application/pdf",
          size: 13,
          checksum: null,
          purpose: "other",
          createdAt: now,
          uploaded: true,
          formVersionId: "fv_active",
          fieldKey: "supporting_pdf",
        });
        const bound = await design.findFile("evt_b", "file_bound");
        expect(bound?.formVersionId).toBe("fv_active");
        expect(bound?.fieldKey).toBe("supporting_pdf");

        // Non-CFP assets (logo/portal) carry no binding — honest NULLs.
        await design.insertFile({
          id: "file_logo",
          eventId: "evt_b",
          ownerParticipationId: null,
          r2Key: "events/evt_b/logo/file_logo.png",
          filename: "logo.png",
          mime: "image/png",
          size: 4,
          checksum: null,
          purpose: "logo",
          createdAt: now,
          uploaded: false,
        });
        const logo = await design.findFile("evt_b", "file_logo");
        expect(logo?.formVersionId).toBeNull();
        expect(logo?.fieldKey).toBeNull();
        expect(foreignKeyCheckClean(db)).toBe(true);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
