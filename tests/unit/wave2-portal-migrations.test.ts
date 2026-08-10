/**
 * Post-11.9 depth Wave 2 — portal task depth migration proofs (fresh DB +
 * upgrade from the pre-wave head 0029), per the migration law: every schema
 * change is a new numbered migration and tests run against BOTH paths with a
 * clean PRAGMA foreign_key_check.
 *
 * New migrations under test:
 * - 0030_task_templates_link_required.sql (link_url NULL; required knob)
 * - 0032_task_templates_required_default.sql (repair: 0030 defaulted
 *   `required` to 0, silently flipping every pre-existing template to
 *   optional — incomplete tasks stopped blocking readiness. 0032 backfills
 *   required=1 for all existing templates and changes the default to 1, so
 *   pre-0030 semantics hold: tasks block unless the organizer opts INTO
 *   optional.)
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
import { D1DecisionsStore } from "../../apps/api/src/modules/decisions/store.js";
import { computePortalReadiness } from "../../apps/api/src/modules/portal/commands.js";

const require = createRequire(import.meta.url);
const migrationsDir = defaultMigrationsDir(resolveDbPackageRoot());

/** Wave 2 portal-depth migrations (everything after the pre-wave head 0029). */
const WAVE_2_PORTAL_MIGRATIONS = [
  "0030_task_templates_link_required.sql",
  "0032_task_templates_required_default.sql",
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

describe("Wave 2 portal-depth migrations — fresh database", () => {
  it("fresh migrate applies 0030 and creates link_url + required on task_templates", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spo-w2-fresh-"));
    const dbPath = join(dir, "fresh.sqlite");
    try {
      const { columns, result } = await inspectSchema({
        dbPath,
        migrationsDir,
      });
      for (const m of WAVE_2_PORTAL_MIGRATIONS) {
        expect(result.applied, `must apply ${m}`).toContain(m);
      }
      expect(columns.task_templates).toContain("link_url");
      expect(columns.task_templates).toContain("required");

      const db = openDb(dbPath);
      try {
        // 0032: fresh schema defaults `required` to 1 (blocking) — a raw
        // insert without the column comes out required.
        db.run(
          `INSERT INTO task_templates (id, event_id, title, trigger, due_offset_days, version, created_at)
           VALUES ('tpl_fresh_default', 'evt_fresh', 'Default check', 'on_accept', 7, 1, '2026-08-10T00:00:00.000Z')`,
        );
        const fresh = db.exec(
          "SELECT required FROM task_templates WHERE id = 'tpl_fresh_default'",
        );
        expect(fresh[0]?.values[0]).toEqual([1]);
        expect(foreignKeyCheckClean(db)).toBe(true);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Wave 2 portal-depth migrations — upgrade from pre-wave head 0029", () => {
  it("upgrade preserves template rows and 0032 backfills required=1 (pre-existing incomplete tasks still block readiness)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spo-w2-upg-"));
    const oldMigrations = join(dir, "migrations-0029");
    const dbPath = join(dir, "upgrade.sqlite");
    mkdirSync(oldMigrations, { recursive: true });
    try {
      // Stage only pre-wave migrations (0001–0029).
      for (const file of readdirSync(migrationsDir)) {
        if (!/^\d{4}_.+\.sql$/i.test(file)) continue;
        if ((WAVE_2_PORTAL_MIGRATIONS as readonly string[]).includes(file)) {
          continue;
        }
        copyFileSync(join(migrationsDir, file), join(oldMigrations, file));
      }
      const preResult = await migrate({
        dbPath,
        migrationsDir: oldMigrations,
      });
      expect(preResult.applied).toContain(
        "0029_eval_rounds_hide_speakers.sql",
      );
      for (const m of WAVE_2_PORTAL_MIGRATIONS) {
        expect(preResult.applied).not.toContain(m);
      }

      // Seed a pre-wave template + an INCOMPLETE instantiated task — the
      // pre-0030 contract: this task blocks portal readiness.
      {
        const db = openDb(dbPath);
        try {
          const now = "2026-08-01T00:00:00.000Z";
          db.run(
            `INSERT INTO task_templates (id, event_id, title, description, trigger, due_offset_days, version, created_at)
             VALUES ('tpl_up', 'evt_up', 'Upload headshot', 'Portrait for the programme', 'on_accept', 14, 1, ?)`,
            [now],
          );
          db.run(
            `INSERT INTO speaker_tasks (id, template_id, participation_id, status, due_at, completed_at, version, created_at, updated_at)
             VALUES ('task_up', 'tpl_up', 'part_up', 'pending', NULL, NULL, 1, ?, ?)`,
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

      // Upgrade: apply the full migration set on the seeded 0029 database.
      const upgraded = await migrate({ dbPath, migrationsDir });
      for (const m of WAVE_2_PORTAL_MIGRATIONS) {
        expect(upgraded.applied, `upgrade must apply ${m}`).toContain(m);
      }

      const db = openDb(dbPath);
      try {
        // 0032 repair: pre-existing templates come out REQUIRED (pre-0030
        // semantics — 0030 alone had silently flipped them all to optional).
        const tpl = db.exec(
          "SELECT link_url, required FROM task_templates WHERE id = 'tpl_up'",
        );
        expect(tpl[0]?.values[0]).toEqual([null, 1]);
        // Pre-wave columns untouched on the preserved row.
        const kept = db.exec(
          "SELECT title, trigger, due_offset_days, version FROM task_templates WHERE id = 'tpl_up'",
        );
        expect(kept[0]?.values[0]).toEqual(["Upload headshot", "on_accept", 14, 1]);
        // And a template row inserted AFTER the upgrade without the column
        // defaults to required too (column default changed to 1).
        db.run(
          `INSERT INTO task_templates (id, event_id, title, trigger, due_offset_days, version, created_at)
           VALUES ('tpl_up_new', 'evt_up', 'Post-upgrade default', 'manual', 3, 1, '2026-08-10T00:00:00.000Z')`,
        );
        const post = db.exec(
          "SELECT required FROM task_templates WHERE id = 'tpl_up_new'",
        );
        expect(post[0]?.values[0]).toEqual([1]);

        // Readiness proof through the REAL stores + readiness contract: the
        // pre-existing incomplete task still blocks after the upgrade.
        const decisions = new D1DecisionsStore(new SqlJsD1(db));
        const templates = await decisions.listTaskTemplates("evt_up");
        const requiredByTemplate = new Map(
          templates.map((t) => [t.id, t.required === true]),
        );
        expect(requiredByTemplate.get("tpl_up")).toBe(true);
        const tasks = await decisions.listSpeakerTasksForParticipations([
          "part_up",
        ]);
        expect(tasks).toHaveLength(1);
        const readiness = computePortalReadiness(
          // Complete profile — ONLY the incomplete task gates the state.
          {
            bio: "Bio",
            company: "Co",
            title: "Speaker",
            headshotFileId: "file_up",
          },
          tasks.map((t) => ({
            status: t.status,
            required: requiredByTemplate.get(t.templateId) ?? false,
          })),
        );
        expect(readiness.state).toBe("needs_action");
        expect(readiness.headline).toBe("Required tasks remaining");

        expect(foreignKeyCheckClean(db)).toBe(true);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("decisions store reads/writes link_url + required against the migrated schema", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spo-w2-store-"));
    const dbPath = join(dir, "store.sqlite");
    try {
      await migrate({ dbPath, migrationsDir });
      const db = openDb(dbPath);
      try {
        const now = "2026-08-10T00:00:00.000Z";
        const decisions = new D1DecisionsStore(new SqlJsD1(db));

        await decisions.insertTaskTemplate({
          id: "tpl_s_req",
          eventId: "evt_s",
          title: "Sign the speaker agreement",
          description: "Blocking paperwork",
          trigger: "on_accept",
          dueOffsetDays: 7,
          linkUrl: "https://example.com/agreement",
          required: true,
          version: 1,
          createdAt: now,
        });
        await decisions.insertTaskTemplate({
          id: "tpl_s_opt",
          eventId: "evt_s",
          title: "Share travel plans",
          description: null,
          trigger: "manual",
          dueOffsetDays: 30,
          linkUrl: null,
          required: false,
          version: 1,
          createdAt: now,
        });

        const found = await decisions.findTaskTemplateById("tpl_s_req");
        expect(found?.linkUrl).toBe("https://example.com/agreement");
        expect(found?.required).toBe(true);

        const listed = await decisions.listTaskTemplates("evt_s");
        expect(
          listed.map((t) => [t.id, t.linkUrl, t.required]).sort(),
        ).toEqual([
          ["tpl_s_opt", null, false],
          ["tpl_s_req", "https://example.com/agreement", true],
        ]);

        // Round-trip update: clear the link and demote to optional (E1 versioned).
        const updated = await decisions.updateTaskTemplate("tpl_s_req", {
          linkUrl: null,
          required: false,
          version: 2,
          expectedVersion: 1,
        });
        expect(updated?.linkUrl).toBeNull();
        expect(updated?.required).toBe(false);
        expect(updated?.version).toBe(2);

        // And back on: set a fresh https link + required.
        const again = await decisions.updateTaskTemplate("tpl_s_req", {
          linkUrl: "https://example.com/agreement-v2",
          required: true,
          version: 3,
          expectedVersion: 2,
        });
        expect(again?.linkUrl).toBe("https://example.com/agreement-v2");
        expect(again?.required).toBe(true);

        // Stale expectedVersion never writes (conditional UPDATE).
        const stale = await decisions.updateTaskTemplate("tpl_s_req", {
          required: false,
          version: 3,
          expectedVersion: 2,
        });
        expect(stale).toBeNull();

        expect(foreignKeyCheckClean(db)).toBe(true);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
