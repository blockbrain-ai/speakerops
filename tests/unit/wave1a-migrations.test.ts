/**
 * Post-11.9 depth Wave 1A — migration proofs (fresh DB + upgrade from the
 * pre-wave head 0022), per the migration law: every schema change is a new
 * numbered migration and tests run against BOTH paths with a clean
 * PRAGMA foreign_key_check.
 *
 * New migrations under test:
 * - 0023_form_fields_help_placeholder_maxchars.sql
 * - 0024_form_versions_speaker_bounds.sql (defaults 1/5 preserve behavior)
 * - 0025_eval_assignments_abstain.sql
 * - 0026_eval_rounds_instructions.sql
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
import { SqlJsD1 } from "../helpers/sqljs-d1.js";
import { D1FormsStore } from "../../apps/api/src/modules/forms/store.js";
import { D1EvalStore } from "../../apps/api/src/modules/eval/store.js";

const require = createRequire(import.meta.url);
const migrationsDir = defaultMigrationsDir(resolveDbPackageRoot());

/** Wave 1A migrations (everything after the pre-wave head 0022). */
const WAVE_1A_MIGRATIONS = [
  "0023_form_fields_help_placeholder_maxchars.sql",
  "0024_form_versions_speaker_bounds.sql",
  "0025_eval_assignments_abstain.sql",
  "0026_eval_rounds_instructions.sql",
] as const;

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

describe("Wave 1A migrations — fresh database", () => {
  it("fresh migrate applies 0023–0026 and creates the depth columns", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spo-w1a-fresh-"));
    const dbPath = join(dir, "fresh.sqlite");
    try {
      const { columns, result } = await inspectSchema({
        dbPath,
        migrationsDir,
      });
      for (const m of WAVE_1A_MIGRATIONS) {
        expect(result.applied, `must apply ${m}`).toContain(m);
      }
      expect(columns.form_fields).toContain("help_text");
      expect(columns.form_fields).toContain("placeholder");
      expect(columns.form_fields).toContain("max_chars");
      expect(columns.form_versions).toContain("min_speakers");
      expect(columns.form_versions).toContain("max_speakers");
      expect(columns.eval_assignments).toContain("abstain_reason");
      expect(columns.eval_rounds).toContain("instructions_md");

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

describe("Wave 1A migrations — upgrade from pre-wave head 0022", () => {
  it("upgrade preserves rows and backfills speaker-bound defaults (1/5)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spo-w1a-upg-"));
    const oldMigrations = join(dir, "migrations-0022");
    const dbPath = join(dir, "upgrade.sqlite");
    mkdirSync(oldMigrations, { recursive: true });
    try {
      // Stage only pre-wave migrations (0001–0022).
      for (const file of readdirSync(migrationsDir)) {
        if (!/^\d{4}_.+\.sql$/i.test(file)) continue;
        if ((WAVE_1A_MIGRATIONS as readonly string[]).includes(file)) continue;
        copyFileSync(join(migrationsDir, file), join(oldMigrations, file));
      }
      const preResult = await migrate({
        dbPath,
        migrationsDir: oldMigrations,
      });
      expect(preResult.applied).toContain("0022_api_keys_created_at.sql");
      for (const m of WAVE_1A_MIGRATIONS) {
        expect(preResult.applied).not.toContain(m);
      }

      // Seed pre-wave rows the upgrade must preserve.
      {
        const db = openDb(dbPath);
        try {
          const now = "2026-08-01T00:00:00.000Z";
          db.run(
            `INSERT INTO forms (id, event_id, name, status, created_at)
             VALUES ('form_up', 'evt_up', 'Upgrade CFP', 'published', ?)`,
            [now],
          );
          db.run(
            `INSERT INTO form_versions (id, form_id, version_num, published_at, snapshot_json)
             VALUES ('fv_up', 'form_up', 1, ?, '{}')`,
            [now],
          );
          db.run(
            `INSERT INTO form_fields (id, form_version_id, field_key, type, label, required, sort_order)
             VALUES ('ff_up', 'fv_up', 'abstract', 'textarea', 'Abstract', 1, 0)`,
          );
          db.run(
            `INSERT INTO eval_rounds (id, event_id, name, status, created_at, updated_at)
             VALUES ('round_up', 'evt_up', 'Round 1', 'open', ?, ?)`,
            [now, now],
          );
          db.run(
            `INSERT INTO eval_assignments (id, round_id, submission_id, evaluator_user_id, status, created_at, updated_at)
             VALUES ('asg_up', 'round_up', 'sub_up', 'user_up', 'pending', ?, ?)`,
            [now, now],
          );
          const bytes = db.export();
          rmSync(dbPath);
          const { writeFileSync } = await import("node:fs");
          writeFileSync(dbPath, Buffer.from(bytes));
        } finally {
          db.close();
        }
      }

      // Upgrade: apply the full migration set on the seeded 0022 database.
      const upgraded = await migrate({ dbPath, migrationsDir });
      for (const m of WAVE_1A_MIGRATIONS) {
        expect(upgraded.applied, `upgrade must apply ${m}`).toContain(m);
      }

      const db = openDb(dbPath);
      try {
        // Existing published version backfilled with default 1/5 bounds.
        const row = db.exec(
          "SELECT min_speakers, max_speakers FROM form_versions WHERE id = 'fv_up'",
        );
        expect(row[0]?.values[0]).toEqual([1, 5]);
        // Existing field rows keep NULL depth knobs (no cap / no help).
        const field = db.exec(
          "SELECT help_text, placeholder, max_chars FROM form_fields WHERE id = 'ff_up'",
        );
        expect(field[0]?.values[0]).toEqual([null, null, null]);
        // Assignment + round rows intact with NULL depth columns.
        const asg = db.exec(
          "SELECT status, abstain_reason FROM eval_assignments WHERE id = 'asg_up'",
        );
        expect(asg[0]?.values[0]).toEqual(["pending", null]);
        const round = db.exec(
          "SELECT instructions_md FROM eval_rounds WHERE id = 'round_up'",
        );
        expect(round[0]?.values[0]).toEqual([null]);
        expect(foreignKeyCheckClean(db)).toBe(true);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("D1 stores read/write the new columns against the migrated schema", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spo-w1a-store-"));
    const dbPath = join(dir, "store.sqlite");
    try {
      await migrate({ dbPath, migrationsDir });
      const db = openDb(dbPath);
      try {
        const forms = new D1FormsStore(new SqlJsD1(db));
        const now = "2026-08-10T00:00:00.000Z";
        await forms.insertForm({
          id: "form_s",
          eventId: "evt_s",
          name: "Store CFP",
          status: "draft",
          createdAt: now,
        });
        await forms.insertVersion({
          id: "fv_s",
          formId: "form_s",
          versionNum: 0,
          welcomeMd: null,
          thankYouMd: null,
          opensAt: null,
          closesAt: null,
          submissionLimit: null,
          minSpeakers: 2,
          maxSpeakers: 9,
          publishedAt: null,
          snapshotJson: null,
        });
        const version = await forms.findDraftVersion("form_s");
        expect(version?.minSpeakers).toBe(2);
        expect(version?.maxSpeakers).toBe(9);

        await forms.replaceFields("fv_s", [
          {
            id: "ff_s",
            formVersionId: "fv_s",
            fieldKey: "abstract",
            type: "textarea",
            label: "Abstract",
            required: true,
            options: null,
            sortOrder: 0,
            conditions: null,
            helpText: "Two paragraphs max.",
            placeholder: "What will the audience learn?",
            maxChars: 500,
          },
        ]);
        const fields = await forms.listFields("fv_s");
        expect(fields[0]?.helpText).toBe("Two paragraphs max.");
        expect(fields[0]?.placeholder).toBe("What will the audience learn?");
        expect(fields[0]?.maxChars).toBe(500);

        const evalStore = new D1EvalStore(new SqlJsD1(db));
        await evalStore.insertRound({
          id: "round_s",
          eventId: "evt_s",
          name: "Round",
          status: "open",
          closesAt: "2026-09-01T00:00:00.000Z",
          instructionsMd: "Score fairly.",
          createdAt: now,
          updatedAt: now,
        });
        const round = await evalStore.findRoundById("round_s");
        expect(round?.instructionsMd).toBe("Score fairly.");

        await evalStore.insertAssignment({
          id: "asg_s",
          roundId: "round_s",
          submissionId: "sub_s",
          evaluatorUserId: "user_s",
          status: "pending",
          overallComment: null,
          createdAt: now,
          updatedAt: now,
        });
        const abstained = await evalStore.updateAssignment("asg_s", {
          status: "abstained",
          abstainReason: "Conflict of interest",
          updatedAt: now,
        });
        expect(abstained?.status).toBe("abstained");
        const reread = await evalStore.findAssignmentById("asg_s");
        expect(reread?.status).toBe("abstained");
        expect(reread?.abstainReason).toBe("Conflict of interest");
        expect(foreignKeyCheckClean(db)).toBe(true);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
