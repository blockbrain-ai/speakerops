/**
 * Post-11.9 depth Wave 1B — migration proofs (fresh DB + upgrade from the
 * pre-wave head 0026), per the migration law: every schema change is a new
 * numbered migration and tests run against BOTH paths with a clean
 * PRAGMA foreign_key_check.
 *
 * New migrations under test:
 * - 0027_form_fields_layout_nodes.sql (node_kind default input; layout_type)
 * - 0028_form_versions_per_submitter_limit.sql (nullable — unlimited)
 * - 0029_eval_rounds_hide_speakers.sql (default 0 — roster visible)
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
import { D1SubmissionsStore } from "../../apps/api/src/modules/publicCfp/store.js";

const require = createRequire(import.meta.url);
const migrationsDir = defaultMigrationsDir(resolveDbPackageRoot());

/** Wave 1B migrations (everything after the pre-wave head 0026). */
const WAVE_1B_MIGRATIONS = [
  "0027_form_fields_layout_nodes.sql",
  "0028_form_versions_per_submitter_limit.sql",
  "0029_eval_rounds_hide_speakers.sql",
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

describe("Wave 1B migrations — fresh database", () => {
  it("fresh migrate applies 0027–0029 and creates the depth columns", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spo-w1b-fresh-"));
    const dbPath = join(dir, "fresh.sqlite");
    try {
      const { columns, result } = await inspectSchema({
        dbPath,
        migrationsDir,
      });
      for (const m of WAVE_1B_MIGRATIONS) {
        expect(result.applied, `must apply ${m}`).toContain(m);
      }
      expect(columns.form_fields).toContain("node_kind");
      expect(columns.form_fields).toContain("layout_type");
      expect(columns.form_versions).toContain("per_submitter_limit");
      expect(columns.eval_rounds).toContain("hide_speakers");

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

describe("Wave 1B migrations — upgrade from pre-wave head 0026", () => {
  it("upgrade preserves rows and backfills honest defaults (input / NULL / 0)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spo-w1b-upg-"));
    const oldMigrations = join(dir, "migrations-0026");
    const dbPath = join(dir, "upgrade.sqlite");
    mkdirSync(oldMigrations, { recursive: true });
    try {
      // Stage only pre-wave migrations (0001–0026).
      for (const file of readdirSync(migrationsDir)) {
        if (!/^\d{4}_.+\.sql$/i.test(file)) continue;
        if ((WAVE_1B_MIGRATIONS as readonly string[]).includes(file)) continue;
        copyFileSync(join(migrationsDir, file), join(oldMigrations, file));
      }
      const preResult = await migrate({
        dbPath,
        migrationsDir: oldMigrations,
      });
      expect(preResult.applied).toContain("0026_eval_rounds_instructions.sql");
      for (const m of WAVE_1B_MIGRATIONS) {
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
            `INSERT INTO form_versions (id, form_id, version_num, submission_limit, published_at, snapshot_json)
             VALUES ('fv_up', 'form_up', 1, 25, ?, '{}')`,
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
          const bytes = db.export();
          rmSync(dbPath);
          const { writeFileSync } = await import("node:fs");
          writeFileSync(dbPath, Buffer.from(bytes));
        } finally {
          db.close();
        }
      }

      // Upgrade: apply the full migration set on the seeded 0026 database.
      const upgraded = await migrate({ dbPath, migrationsDir });
      for (const m of WAVE_1B_MIGRATIONS) {
        expect(upgraded.applied, `upgrade must apply ${m}`).toContain(m);
      }

      const db = openDb(dbPath);
      try {
        // Existing field rows become input nodes with no layout type.
        const field = db.exec(
          "SELECT node_kind, layout_type FROM form_fields WHERE id = 'ff_up'",
        );
        expect(field[0]?.values[0]).toEqual(["input", null]);
        // Existing version keeps its total cap; per-person cap unlimited.
        const version = db.exec(
          "SELECT submission_limit, per_submitter_limit FROM form_versions WHERE id = 'fv_up'",
        );
        expect(version[0]?.values[0]).toEqual([25, null]);
        // Existing rounds keep the roster visible (0 = show speakers).
        const round = db.exec(
          "SELECT hide_speakers FROM eval_rounds WHERE id = 'round_up'",
        );
        expect(round[0]?.values[0]).toEqual([0]);
        expect(foreignKeyCheckClean(db)).toBe(true);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("D1 stores read/write the new columns against the migrated schema", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spo-w1b-store-"));
    const dbPath = join(dir, "store.sqlite");
    try {
      await migrate({ dbPath, migrationsDir });
      const db = openDb(dbPath);
      try {
        const now = "2026-08-10T00:00:00.000Z";
        const forms = new D1FormsStore(new SqlJsD1(db));
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
          perSubmitterLimit: 3,
          minSpeakers: 1,
          maxSpeakers: 5,
          publishedAt: null,
          snapshotJson: null,
        });
        const version = await forms.findDraftVersion("form_s");
        expect(version?.perSubmitterLimit).toBe(3);

        await forms.replaceFields("fv_s", [
          {
            id: "ff_s_section",
            formVersionId: "fv_s",
            fieldKey: "layout_intro",
            type: "text",
            label: "Introduce yourself",
            required: false,
            options: null,
            sortOrder: 0,
            conditions: null,
            nodeKind: "layout",
            layoutType: "section",
          },
          {
            id: "ff_s_input",
            formVersionId: "fv_s",
            fieldKey: "abstract",
            type: "textarea",
            label: "Abstract",
            required: true,
            options: null,
            sortOrder: 1,
            conditions: null,
          },
        ]);
        const fields = await forms.listFields("fv_s");
        expect(fields.map((f) => [f.fieldKey, f.nodeKind, f.layoutType])).toEqual([
          ["layout_intro", "layout", "section"],
          ["abstract", "input", null],
        ]);

        const evalStore = new D1EvalStore(new SqlJsD1(db));
        await evalStore.insertRound({
          id: "round_s",
          eventId: "evt_s",
          name: "Round",
          status: "open",
          closesAt: null,
          instructionsMd: null,
          hideSpeakers: true,
          createdAt: now,
          updatedAt: now,
        });
        const round = await evalStore.findRoundById("round_s");
        expect(round?.hideSpeakers).toBe(true);
        const shown = await evalStore.updateRound("round_s", {
          hideSpeakers: false,
          updatedAt: now,
        });
        expect(shown?.hideSpeakers).toBe(false);

        // Per-submitter count joins submissions → primary speaker → people.
        const submissions = new D1SubmissionsStore(new SqlJsD1(db));
        await submissions.insertPerson({
          id: "person_s",
          orgId: "org_s",
          email: "counted@example.com",
          name: "Counted Person",
          createdAt: now,
          updatedAt: now,
        });
        await submissions.insertSubmission({
          id: "sub_s1",
          eventId: "evt_s",
          formVersionId: "fv_s",
          title: "Counted talk",
          category: null,
          status: "submitted",
          submittedAt: now,
          version: 1,
        });
        await submissions.insertSpeakers([
          { submissionId: "sub_s1", personId: "person_s", isPrimary: true, sortOrder: 0 },
        ]);
        // Draft never counts; non-primary never counts.
        await submissions.insertSubmission({
          id: "sub_s2",
          eventId: "evt_s",
          formVersionId: "fv_s",
          title: "Draft talk",
          category: null,
          status: "draft",
          submittedAt: now,
          version: 1,
        });
        await submissions.insertSpeakers([
          { submissionId: "sub_s2", personId: "person_s", isPrimary: true, sortOrder: 0 },
        ]);
        // Per-submitter listing is FORM-scoped (all versions of the pinned
        // form) — normalized email matches; other emails/versions never do.
        expect(
          await submissions.listSubmittedIdsByPrimaryEmailForVersions(
            ["fv_s"],
            "Counted@Example.COM ",
          ),
        ).toEqual(["sub_s1"]);
        expect(
          await submissions.listSubmittedIdsByPrimaryEmailForVersions(
            ["fv_s"],
            "other@example.com",
          ),
        ).toEqual([]);
        expect(
          await submissions.listSubmittedIdsByPrimaryEmailForVersions(
            ["fv_other"],
            "counted@example.com",
          ),
        ).toEqual([]);

        // Atomic per-submitter guard: same slot key claims exactly once and
        // the loser's submission row is NOT inserted (batch rollback).
        const guardRow = (id: string, subId: string) => ({
          id,
          key: "per-submitter:form_s:counted@example.com:1",
          requestHash: subId,
          responseJson: null,
          createdAt: now,
        });
        const winner = await submissions.insertSubmissionWithGuard(
          {
            id: "sub_guard_a",
            eventId: "evt_s",
            formVersionId: "fv_s",
            title: "Guarded A",
            category: null,
            status: "submitted",
            submittedAt: now,
            version: 1,
          },
          guardRow("idem_g1", "sub_guard_a"),
        );
        expect(winner).toBe("inserted");
        const loser = await submissions.insertSubmissionWithGuard(
          {
            id: "sub_guard_b",
            eventId: "evt_s",
            formVersionId: "fv_s",
            title: "Guarded B",
            category: null,
            status: "submitted",
            submittedAt: now,
            version: 1,
          },
          guardRow("idem_g2", "sub_guard_b"),
        );
        expect(loser).toBe("guard_conflict");
        expect(await submissions.findSubmissionById("sub_guard_a")).not.toBeNull();
        expect(await submissions.findSubmissionById("sub_guard_b")).toBeNull();
        // Guard hashes list the claimed submission ids for the form+email.
        expect(
          await submissions.listSubmissionGuardHashes(
            "form_s",
            "Counted@Example.COM ",
          ),
        ).toEqual(["sub_guard_a"]);
        expect(foreignKeyCheckClean(db)).toBe(true);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
