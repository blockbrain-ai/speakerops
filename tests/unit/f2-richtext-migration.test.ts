/**
 * F2 rich-text primitive — migration proofs for 0036_rich_text_columns.sql,
 * per the migration law: every schema change is a new numbered migration and is
 * tested against BOTH a fresh DB and an upgrade from the pre-wave head (0035),
 * each with a clean PRAGMA foreign_key_check.
 *
 * 0036 is additive-only: six nullable columns
 *   form_versions.welcome_rich_json / thank_you_rich_json
 *   form_fields.description_rich_json
 *   event_participations.bio_rich_json
 *   email_templates.body_rich_json
 *   message_recipients.body_html
 *
 * The upgrade path stages only migrations numbered <= 0035, seeds a legacy
 * plain-text row, upgrades to the full set, and asserts the legacy value is
 * preserved with honest NULLs in the new columns (no data change).
 *
 * A DB-level dual-read proof shows the shared read contract: prefer the
 * *_rich_json column, fall back to legacy text as a paragraph doc AT READ TIME
 * (the read helper is pure — it never writes).
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
import {
  readRichTextValue,
  richTextToPlainText,
} from "../../packages/shared/src/richtext.js";

const require = createRequire(import.meta.url);
const migrationsDir = defaultMigrationsDir(resolveDbPackageRoot());

const F2_MIGRATION = "0036_rich_text_columns.sql";
const PRE_WAVE_HEAD = "0035_api_keys_quota_composite_idx.sql";

/** Pre-wave head: keep only migrations numbered 0001–0035 when staging "old". */
function isPreWaveMigration(file: string): boolean {
  const m = /^(\d{4})_.+\.sql$/i.exec(file);
  if (!m) return false;
  return Number(m[1]) <= 35;
}

const RICH_COLUMNS: Record<string, string[]> = {
  form_versions: ["welcome_rich_json", "thank_you_rich_json"],
  form_fields: ["description_rich_json"],
  event_participations: ["bio_rich_json"],
  email_templates: ["body_rich_json"],
  message_recipients: ["body_html"],
};

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

/** Seed org → event → legacy email_templates row (respecting the events FK). */
function seedLegacyTemplate(db: Database, bodyMd: string): void {
  const now = "2026-08-01T00:00:00.000Z";
  db.run(
    `INSERT INTO organizations (id, name, created_at, updated_at)
     VALUES ('org_f2', 'F2 Org', ?, ?)`,
    [now, now],
  );
  db.run(
    `INSERT INTO events (id, org_id, name, slug, timezone, created_at, updated_at, version)
     VALUES ('evt_f2', 'org_f2', 'F2 Event', 'f2-event', 'UTC', ?, ?, 1)`,
    [now, now],
  );
  db.run(
    `INSERT INTO email_templates (id, event_id, key, subject, body_md, version, created_at, updated_at)
     VALUES ('tpl_f2', 'evt_f2', 'submission_confirmation', 'Subject', ?, 1, ?, ?)`,
    [bodyMd, now, now],
  );
}

describe("F2 0036 migration — fresh database", () => {
  it("applies 0036 and creates all six rich-text columns; fk_check clean", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spo-f2-fresh-"));
    const dbPath = join(dir, "fresh.sqlite");
    try {
      const { columns, result } = await inspectSchema({ dbPath, migrationsDir });
      expect(result.applied, `must apply ${F2_MIGRATION}`).toContain(F2_MIGRATION);
      for (const [table, cols] of Object.entries(RICH_COLUMNS)) {
        for (const col of cols) {
          expect(columns[table], `${table}.${col} exists`).toContain(col);
        }
      }
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

describe("F2 0036 migration — upgrade from pre-wave head 0035", () => {
  it("preserves legacy plain text with honest NULL rich columns; fk_check clean", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spo-f2-upg-"));
    const oldMigrations = join(dir, "migrations-0035");
    const dbPath = join(dir, "upgrade.sqlite");
    mkdirSync(oldMigrations, { recursive: true });
    try {
      // Stage only migrations <= 0035.
      for (const file of readdirSync(migrationsDir)) {
        if (!/^\d{4}_.+\.sql$/i.test(file)) continue;
        if (!isPreWaveMigration(file)) continue;
        copyFileSync(join(migrationsDir, file), join(oldMigrations, file));
      }
      const preResult = await migrate({ dbPath, migrationsDir: oldMigrations });
      expect(preResult.applied).toContain(PRE_WAVE_HEAD);
      expect(preResult.applied).not.toContain(F2_MIGRATION);

      // Seed a pre-wave legacy template row the upgrade must preserve.
      {
        const db = openDb(dbPath);
        try {
          seedLegacyTemplate(db, "Hi {{name}}\nWelcome aboard.");
          writeFileSync(dbPath, Buffer.from(db.export()));
        } finally {
          db.close();
        }
      }

      // Upgrade: apply the full set (adds 0036).
      const upgraded = await migrate({ dbPath, migrationsDir });
      expect(upgraded.applied, `upgrade applies ${F2_MIGRATION}`).toContain(F2_MIGRATION);

      const db = openDb(dbPath);
      try {
        const row = db.exec(
          `SELECT body_md, body_rich_json FROM email_templates WHERE id = 'tpl_f2'`,
        );
        // Legacy text intact; new rich column is an honest NULL.
        expect(row[0]?.values[0]).toEqual(["Hi {{name}}\nWelcome aboard.", null]);
        expect(foreignKeyCheckClean(db)).toBe(true);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * The migration law requires fresh + upgrade + ROLLBACK. 0036 is additive-only
 * (six nullable columns) and is IMMUTABLE + already applied remotely, so the
 * rollback is proven test-only here: dropping the additive columns must leave a
 * valid schema (clean PRAGMA foreign_key_check) with the legacy plain-text data
 * fully intact and the table still writable. (D1 production recovery is Time
 * Travel per the 0036 header note; this test proves the down-path is sound.)
 */
const ROLLBACK_DOWN_SQL: ReadonlyArray<string> = [
  "ALTER TABLE form_versions DROP COLUMN welcome_rich_json",
  "ALTER TABLE form_versions DROP COLUMN thank_you_rich_json",
  "ALTER TABLE form_fields DROP COLUMN description_rich_json",
  "ALTER TABLE event_participations DROP COLUMN bio_rich_json",
  "ALTER TABLE email_templates DROP COLUMN body_rich_json",
  "ALTER TABLE message_recipients DROP COLUMN body_html",
];

describe("F2 0036 migration — rollback (down-path) leaves a valid schema", () => {
  it("drops the six additive columns, preserves legacy data, fk_check stays clean", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spo-f2-rollback-"));
    const dbPath = join(dir, "rollback.sqlite");
    try {
      const { columns: upColumns, result } = await inspectSchema({
        dbPath,
        migrationsDir,
      });
      expect(result.applied).toContain(F2_MIGRATION);
      // Sanity: the additive columns exist before rollback.
      for (const [table, cols] of Object.entries(RICH_COLUMNS)) {
        for (const col of cols) {
          expect(upColumns[table]).toContain(col);
        }
      }

      const db = openDb(dbPath);
      try {
        // Seed a legacy row carrying BOTH the legacy text and a rich doc.
        seedLegacyTemplate(db, "Hi {{name}}\nWelcome aboard.");
        db.run(
          `UPDATE email_templates SET body_rich_json = ? WHERE id = 'tpl_f2'`,
          [
            JSON.stringify({
              schema: "v1",
              doc: {
                type: "doc",
                content: [{ type: "paragraph", content: [{ type: "text", text: "rich" }] }],
              },
            }),
          ],
        );

        // Apply the rollback down-path.
        for (const stmt of ROLLBACK_DOWN_SQL) db.run(stmt);

        // Every additive column is gone from its table.
        const columnsOf = (table: string): string[] => {
          const r = db.exec(`PRAGMA table_info(${table})`);
          return (r[0]?.values ?? []).map((row) => String(row[1]));
        };
        for (const [table, cols] of Object.entries(RICH_COLUMNS)) {
          const present = columnsOf(table);
          for (const col of cols) {
            expect(present, `${table}.${col} dropped`).not.toContain(col);
          }
        }

        // Legacy plain text survives the rollback untouched.
        const row = db.exec(`SELECT body_md FROM email_templates WHERE id = 'tpl_f2'`);
        expect(row[0]?.values[0]).toEqual(["Hi {{name}}\nWelcome aboard."]);

        // Schema still valid + writable after the down-path.
        db.run(
          `INSERT INTO email_templates (id, event_id, key, subject, body_md, version, created_at, updated_at)
           VALUES ('tpl_f2b', 'evt_f2', 'reminder', 'Subject', 'Body', 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
        );
        const after = db.exec(`SELECT COUNT(*) FROM email_templates`);
        expect(after[0]?.values[0]?.[0]).toBe(2);
        expect(foreignKeyCheckClean(db)).toBe(true);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("F2 0036 migration — dual-read at the DB layer", () => {
  it("prefers rich_json, falls back to legacy text as a paragraph doc, never writes on read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spo-f2-dual-"));
    const dbPath = join(dir, "dual.sqlite");
    try {
      await migrate({ dbPath, migrationsDir });
      const db = openDb(dbPath);
      try {
        seedLegacyTemplate(db, "Legacy body line one\nline two");

        const readRow = (): { md: string | null; rich: string | null } => {
          const r = db.exec(
            `SELECT body_md, body_rich_json FROM email_templates WHERE id = 'tpl_f2'`,
          );
          const v = r[0]?.values[0] ?? [null, null];
          return { md: v[0] as string | null, rich: v[1] as string | null };
        };

        // Legacy-only row → dual-read converts text to a paragraph doc.
        let cur = readRow();
        expect(cur.rich).toBeNull();
        const legacyDoc = readRichTextValue(cur.rich, cur.md);
        expect(richTextToPlainText(legacyDoc)).toBe("Legacy body line one\nline two");
        // The read did NOT write back — the rich column is still NULL.
        expect(readRow().rich).toBeNull();

        // Once a rich doc is stored, dual-read prefers it over the legacy text.
        const rich = JSON.stringify({
          schema: "v1",
          doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "RICH WINS" }] }] },
        });
        db.run(`UPDATE email_templates SET body_rich_json = ? WHERE id = 'tpl_f2'`, [rich]);
        cur = readRow();
        expect(richTextToPlainText(readRichTextValue(cur.rich, cur.md))).toBe("RICH WINS");
        expect(foreignKeyCheckClean(db)).toBe(true);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
