/**
 * Post-11.9 depth Wave 2 — speaker-info seeding migration proofs (fresh DB +
 * upgrade from the pre-wave head 0029), per the migration law: every schema
 * change is a new numbered migration and tests run against BOTH paths with a
 * clean PRAGMA foreign_key_check.
 *
 * New migration under test:
 * - 0031_submission_speakers_profile.sql (bio/company/title TEXT, default NULL)
 *
 * The upgrade path stages only migrations numbered <= 0029, so this file never
 * depends on 0030 (owned by a parallel wave item) while still tolerating its
 * presence when the full set is applied.
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
import { D1SubmissionsStore } from "../../apps/api/src/modules/publicCfp/store.js";

const require = createRequire(import.meta.url);
const migrationsDir = defaultMigrationsDir(resolveDbPackageRoot());

const WAVE_2_SPEAKERS_MIGRATION = "0031_submission_speakers_profile.sql";

/** Pre-wave head: keep only migrations numbered 0001–0029 when staging "old". */
function isPreWaveMigration(file: string): boolean {
  const m = /^(\d{4})_.+\.sql$/i.exec(file);
  if (!m) return false;
  return Number(m[1]) <= 29;
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

describe("Wave 2 speaker-seed migration — fresh database", () => {
  it("fresh migrate applies 0031 and creates bio/company/title on submission_speakers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spo-w2spk-fresh-"));
    const dbPath = join(dir, "fresh.sqlite");
    try {
      const { columns, result } = await inspectSchema({
        dbPath,
        migrationsDir,
      });
      expect(
        result.applied,
        `must apply ${WAVE_2_SPEAKERS_MIGRATION}`,
      ).toContain(WAVE_2_SPEAKERS_MIGRATION);
      expect(columns.submission_speakers).toContain("bio");
      expect(columns.submission_speakers).toContain("company");
      expect(columns.submission_speakers).toContain("title");

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

describe("Wave 2 speaker-seed migration — upgrade from pre-wave head 0029", () => {
  it("upgrade preserves seeded speaker rows with honest NULL defaults", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spo-w2spk-upg-"));
    const oldMigrations = join(dir, "migrations-0029");
    const dbPath = join(dir, "upgrade.sqlite");
    mkdirSync(oldMigrations, { recursive: true });
    try {
      // Stage only pre-wave migrations (<= 0029) — never depend on 0030/0031.
      for (const file of readdirSync(migrationsDir)) {
        if (!/^\d{4}_.+\.sql$/i.test(file)) continue;
        if (!isPreWaveMigration(file)) continue;
        copyFileSync(join(migrationsDir, file), join(oldMigrations, file));
      }
      const preResult = await migrate({
        dbPath,
        migrationsDir: oldMigrations,
      });
      expect(preResult.applied).toContain("0029_eval_rounds_hide_speakers.sql");
      expect(preResult.applied).not.toContain(WAVE_2_SPEAKERS_MIGRATION);

      // Seed a pre-wave speaker row the upgrade must preserve untouched.
      {
        const db = openDb(dbPath);
        try {
          const now = "2026-08-01T00:00:00.000Z";
          db.run(
            `INSERT INTO people (id, org_id, email, name, created_at, updated_at)
             VALUES ('person_up', 'org_up', 'pre-wave@example.com', 'Pre Wave', ?, ?)`,
            [now, now],
          );
          db.run(
            `INSERT INTO submissions (id, event_id, form_version_id, title, category, status, submitted_at, version)
             VALUES ('sub_up', 'evt_up', 'fv_up', 'Pre-wave talk', NULL, 'submitted', ?, 1)`,
            [now],
          );
          db.run(
            `INSERT INTO submission_speakers (submission_id, person_id, is_primary, sort_order)
             VALUES ('sub_up', 'person_up', 1, 0)`,
          );
          const bytes = db.export();
          rmSync(dbPath);
          const { writeFileSync } = await import("node:fs");
          writeFileSync(dbPath, Buffer.from(bytes));
        } finally {
          db.close();
        }
      }

      // Upgrade: apply the full set (may include 0030 from the parallel item).
      const upgraded = await migrate({ dbPath, migrationsDir });
      expect(
        upgraded.applied,
        `upgrade must apply ${WAVE_2_SPEAKERS_MIGRATION}`,
      ).toContain(WAVE_2_SPEAKERS_MIGRATION);

      const db = openDb(dbPath);
      try {
        // Existing rows keep their identity and gain NULL seed fields.
        const row = db.exec(
          `SELECT is_primary, sort_order, bio, company, title
           FROM submission_speakers
           WHERE submission_id = 'sub_up' AND person_id = 'person_up'`,
        );
        expect(row[0]?.values[0]).toEqual([1, 0, null, null, null]);
        expect(foreignKeyCheckClean(db)).toBe(true);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("D1SubmissionsStore round-trips the new speaker seed fields", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spo-w2spk-store-"));
    const dbPath = join(dir, "store.sqlite");
    try {
      await migrate({ dbPath, migrationsDir });
      const db = openDb(dbPath);
      try {
        const now = "2026-08-10T00:00:00.000Z";
        const submissions = new D1SubmissionsStore(new SqlJsD1(db));
        await submissions.insertPerson({
          id: "person_s",
          orgId: "org_s",
          email: "seeded@example.com",
          name: "Seeded Speaker",
          createdAt: now,
          updatedAt: now,
        });
        await submissions.insertPerson({
          id: "person_s2",
          orgId: "org_s",
          email: "plain@example.com",
          name: "Plain Speaker",
          createdAt: now,
          updatedAt: now,
        });
        await submissions.insertSubmission({
          id: "sub_s",
          eventId: "evt_s",
          formVersionId: "fv_s",
          title: "Seeded talk",
          category: null,
          status: "submitted",
          submittedAt: now,
          version: 1,
        });
        await submissions.insertSpeakers([
          {
            submissionId: "sub_s",
            personId: "person_s",
            isPrimary: true,
            sortOrder: 0,
            bio: "Distributed-systems engineer and part-time beekeeper.",
            company: "Hexagon Labs",
            title: "Principal Engineer",
          },
          {
            submissionId: "sub_s",
            personId: "person_s2",
            isPrimary: false,
            sortOrder: 1,
            // Omitted fields must come back as honest NULLs.
          },
        ]);
        const rows = await submissions.listSpeakers("sub_s");
        const sorted = rows.slice().sort((a, b) => a.sortOrder - b.sortOrder);
        expect(
          sorted.map((r) => [r.personId, r.bio, r.company, r.title]),
        ).toEqual([
          [
            "person_s",
            "Distributed-systems engineer and part-time beekeeper.",
            "Hexagon Labs",
            "Principal Engineer",
          ],
          ["person_s2", null, null, null],
        ]);

        // replaceSpeakers (draft re-save) keeps the seed fields too.
        await submissions.replaceSpeakers("sub_s", [
          {
            submissionId: "sub_s",
            personId: "person_s",
            isPrimary: true,
            sortOrder: 0,
            bio: "Updated bio",
            company: null,
            title: "Staff Engineer",
          },
        ]);
        const replaced = await submissions.listSpeakers("sub_s");
        expect(
          replaced.map((r) => [r.personId, r.bio, r.company, r.title]),
        ).toEqual([["person_s", "Updated bio", null, "Staff Engineer"]]);
        expect(foreignKeyCheckClean(db)).toBe(true);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
