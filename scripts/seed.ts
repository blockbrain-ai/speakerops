/**
 * Section 8.4 — Deterministic demo seed (~150 speakers).
 *
 * Usage: `pnpm seed` (after `pnpm db:migrate`).
 *
 * Env (names only — E10):
 *   SPEAKEROPS_DB_PATH — local SQLite (default `.data/speakerops.local.sqlite`)
 *
 * Properties:
 * - Deterministic fixed IDs (re-run safe / idempotent)
 * - Exactly SEED_SPEAKER_COUNT event_participations for L05
 * - ≥1 hard schedule conflict (overlapping room blocks)
 * - Missing headshots on most speakers + outstanding tasks
 * - Demo role-switch accounts (admin / evaluator / speaker)
 * - audit_events row with correlationId for the seed write
 *
 * Never logs secrets or magic-link tokens.
 */
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Database, SqlJsStatic } from "sql.js";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Fixed demo graph — stable across re-runs (L05 + role switcher). */
export const SEED_SPEAKER_COUNT = 150;
export const SEED_ORG_ID = "org_dogfood";
export const SEED_EVENT_ID = "evt_dogfood";
export const SEED_EVENT_SLUG = "dogfood-2026";
export const SEED_CORRELATION_ID = "seed_8_4_demo";
export const SEED_AUDIT_ID = "aud_seed_8_4_demo";

/** Demo accounts for dogfood role switcher (not secrets). */
export const SEED_DEMO_USERS = {
  admin: {
    id: "user_demo_admin",
    email: "admin@demo.speakerops.local",
    name: "Demo Admin",
    role: "admin" as const,
  },
  evaluator: {
    id: "user_demo_evaluator",
    email: "evaluator@demo.speakerops.local",
    name: "Demo Evaluator",
    role: "evaluator" as const,
  },
  speaker: {
    id: "user_demo_speaker",
    email: "speaker@demo.speakerops.local",
    name: "Demo Speaker",
    role: "speaker" as const,
  },
} as const;

export type SeedResult = {
  dbPath: string;
  speakerCount: number;
  missingHeadshotCount: number;
  scheduleConflictCount: number;
  outstandingTaskCount: number;
  correlationId: string;
  eventId: string;
};

export type SeedOptions = {
  dbPath?: string;
  migrationsDir?: string;
  /** Skip migrate step when caller already applied (tests). */
  skipMigrate?: boolean;
};

const FIXED_NOW = "2026-06-01T12:00:00.000Z";
const EVENT_STARTS = "2026-09-15T09:00:00.000Z";
const EVENT_ENDS = "2026-09-17T18:00:00.000Z";

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

async function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = (async () => {
      const initSqlJs = require("sql.js") as (
        config?: { locateFile?: (file: string) => string },
      ) => Promise<SqlJsStatic>;
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

function defaultDbPath(): string {
  if (typeof process !== "undefined" && process.env.SPEAKEROPS_DB_PATH) {
    return resolve(process.env.SPEAKEROPS_DB_PATH);
  }
  return resolve(root, ".data", "speakerops.local.sqlite");
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

function run(
  db: Database,
  sql: string,
  params: Array<string | number | null> = [],
): void {
  db.run(sql, params);
}

function scalarInt(db: Database, sql: string, params: string[] = []): number {
  const stmt = db.prepare(sql);
  try {
    if (params.length) stmt.bind(params);
    if (!stmt.step()) return 0;
    const row = stmt.getAsObject() as Record<string, unknown>;
    const v = Object.values(row)[0];
    return typeof v === "number" ? v : Number(v ?? 0);
  } finally {
    stmt.free();
  }
}

/**
 * Count overlapping room block pairs for event (half-open style epochs).
 * Used as proof that seed includes ≥1 schedule conflict.
 */
export function countRoomScheduleConflicts(
  db: Database,
  eventId: string = SEED_EVENT_ID,
): number {
  const stmt = db.prepare(
    `SELECT starts_at, ends_at FROM room_block_reservations
     WHERE event_id = ? AND room_id = ?
     ORDER BY starts_at`,
  );
  const blocks: Array<{ start: number; end: number }> = [];
  try {
    stmt.bind([eventId, "room_seed_main"]);
    while (stmt.step()) {
      const row = stmt.getAsObject() as { starts_at: string; ends_at: string };
      blocks.push({
        start: Date.parse(row.starts_at),
        end: Date.parse(row.ends_at),
      });
    }
  } finally {
    stmt.free();
  }
  let conflicts = 0;
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i]!;
      const b = blocks[j]!;
      if (a.start < b.end && b.start < a.end) conflicts += 1;
    }
  }
  return conflicts;
}

async function ensureMigrated(dbPath: string, migrationsDir: string): Promise<void> {
  const distJs = join(root, "packages/db/dist/src/migrate.js");
  if (!existsSync(distJs)) {
    const { execSync } = await import("node:child_process");
    process.stdout.write("[seed] building @speakerops/db …\n");
    execSync("pnpm --filter @speakerops/db build", {
      cwd: root,
      stdio: "inherit",
    });
  }
  const mod = await import(pathToFileURL(distJs).href);
  await mod.migrate({ dbPath, migrationsDir });
}

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

/**
 * Apply deterministic demo graph. Safe to call repeatedly — same speaker count.
 */
export async function runSeed(options: SeedOptions = {}): Promise<SeedResult> {
  const dbPath = options.dbPath ?? defaultDbPath();
  const migrationsDir =
    options.migrationsDir ?? join(root, "packages/db/migrations");

  if (!options.skipMigrate && dbPath !== ":memory:") {
    await ensureMigrated(dbPath, migrationsDir);
  } else if (dbPath === ":memory:" || options.skipMigrate) {
    // In-memory / test: still need schema
    if (!options.skipMigrate) {
      await ensureMigrated(dbPath, migrationsDir);
    }
  }

  // For :memory: migrate opens its own connection; re-migrate into ours.
  // Always migrate into this connection when using a shared path after ensureMigrated.
  const SQL = await loadSqlJs();
  const db = openDatabase(SQL, dbPath);
  try {
    db.run("PRAGMA foreign_keys = ON;");

    // If memory path was migrated in another connection, apply migrations here too.
    if (dbPath === ":memory:") {
      const files = (await import("node:fs"))
        .readdirSync(migrationsDir)
        .filter((f) => /^\d{4}_.+\.sql$/i.test(f))
        .sort();
      db.run(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id TEXT PRIMARY KEY NOT NULL,
          applied_at TEXT NOT NULL
        );
      `);
      for (const file of files) {
        const check = db.exec(
          `SELECT 1 FROM schema_migrations WHERE id = ${JSON.stringify(file)}`,
        );
        if (check.length > 0 && check[0]!.values.length > 0) continue;
        const sql = readFileSync(join(migrationsDir, file), "utf8");
        db.exec(sql);
        run(db, "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)", [
          file,
          FIXED_NOW,
        ]);
      }
    }

    // --- org + event ---
    run(
      db,
      `INSERT INTO organizations (id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
      [SEED_ORG_ID, "SpeakerOps Dogfood Org", FIXED_NOW, FIXED_NOW],
    );

    run(
      db,
      `INSERT INTO events (
         id, org_id, name, slug, timezone, starts_at, ends_at,
         settings_json, created_at, updated_at, version
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         slug = excluded.slug,
         timezone = excluded.timezone,
         starts_at = excluded.starts_at,
         ends_at = excluded.ends_at,
         updated_at = excluded.updated_at`,
      [
        SEED_EVENT_ID,
        SEED_ORG_ID,
        "AI Engineer World Fair (Dogfood)",
        SEED_EVENT_SLUG,
        "America/Los_Angeles",
        EVENT_STARTS,
        EVENT_ENDS,
        JSON.stringify({ seed: "8.4", speakerTarget: SEED_SPEAKER_COUNT }),
        FIXED_NOW,
        FIXED_NOW,
      ],
    );

    // --- rooms / tracks ---
    for (const [id, name, cap] of [
      ["room_seed_main", "Main Hall", 400],
      ["room_seed_side", "Side Stage", 120],
      ["room_seed_workshop", "Workshop A", 40],
    ] as const) {
      run(
        db,
        `INSERT INTO rooms (id, event_id, name, capacity, created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, capacity = excluded.capacity,
           updated_at = excluded.updated_at`,
        [id, SEED_EVENT_ID, name, cap, FIXED_NOW, FIXED_NOW],
      );
    }

    for (const [id, name, color] of [
      ["track_seed_core", "Core AI", "#7ba88b"],
      ["track_seed_ops", "Ops & Platform", "#3f6e8c"],
      ["track_seed_product", "Product", "#ce922e"],
    ] as const) {
      run(
        db,
        `INSERT INTO tracks (id, event_id, name, color, created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color,
           updated_at = excluded.updated_at`,
        [id, SEED_EVENT_ID, name, color, FIXED_NOW, FIXED_NOW],
      );
    }

    // --- demo role users + memberships ---
    for (const u of Object.values(SEED_DEMO_USERS)) {
      run(
        db,
        `INSERT INTO users (id, email, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name,
           updated_at = excluded.updated_at`,
        [u.id, u.email, u.name, FIXED_NOW, FIXED_NOW],
      );
      const memId = `mem_${u.role}_demo`;
      // Prefer unique (event_id, user_id) so re-seed is idempotent even if id differs.
      run(
        db,
        `INSERT INTO event_memberships (id, event_id, user_id, role, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(event_id, user_id) DO UPDATE SET role = excluded.role`,
        [memId, SEED_EVENT_ID, u.id, u.role, FIXED_NOW],
      );
    }

    // --- task template (on_accept) ---
    run(
      db,
      `INSERT INTO task_templates (
         id, event_id, title, description, trigger, due_offset_days,
         version, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title,
         description = excluded.description, due_offset_days = excluded.due_offset_days`,
      [
        "tpl_seed_headshot",
        SEED_EVENT_ID,
        "Upload headshot",
        "Provide a professional headshot for the programme site.",
        "on_accept",
        7,
        FIXED_NOW,
      ],
    );
    run(
      db,
      `INSERT INTO task_templates (
         id, event_id, title, description, trigger, due_offset_days,
         version, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title`,
      [
        "tpl_seed_bio",
        SEED_EVENT_ID,
        "Complete speaker bio",
        "Short bio for the conference programme.",
        "on_accept",
        5,
        FIXED_NOW,
      ],
    );

    // A few file_assets for speakers who have headshots (uploaded=1)
    const HEADSHOT_COUNT = 10;
    for (let i = 0; i < HEADSHOT_COUNT; i++) {
      const fileId = `file_seed_headshot_${pad3(i)}`;
      run(
        db,
        `INSERT INTO file_assets (
           id, event_id, owner_participation_id, r2_key, filename, mime, size,
           checksum, purpose, created_at, uploaded, virus_scan_status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT(id) DO UPDATE SET uploaded = 1`,
        [
          fileId,
          SEED_EVENT_ID,
          `part_seed_${pad3(i)}`,
          `seed/headshots/${pad3(i)}.jpg`,
          `speaker-${pad3(i)}.jpg`,
          "image/jpeg",
          12_345,
          `sha256_seed_${pad3(i)}`,
          "headshot",
          FIXED_NOW,
          "unscanned",
        ],
      );
    }

    // --- 150 people + participations + sessions + tasks ---
    const tracks = ["track_seed_core", "track_seed_ops", "track_seed_product"];
    for (let i = 0; i < SEED_SPEAKER_COUNT; i++) {
      const idx = pad3(i);
      const personId = `person_seed_${idx}`;
      const partId = `part_seed_${idx}`;
      const sessionId = `sess_seed_${idx}`;
      const email = `speaker${idx}@demo.speakerops.local`;
      const name = `Seed Speaker ${idx}`;
      const hasHeadshot = i < HEADSHOT_COUNT;
      const headshotFileId = hasHeadshot ? `file_seed_headshot_${idx}` : null;
      const trackId = tracks[i % tracks.length]!;

      run(
        db,
        `INSERT INTO people (id, org_id, email, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name,
           updated_at = excluded.updated_at`,
        [personId, SEED_ORG_ID, email, name, FIXED_NOW, FIXED_NOW],
      );

      run(
        db,
        `INSERT INTO event_participations (
           id, event_id, person_id, user_id, role_label, status, bio, company,
           title, headshot_file_id, version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           headshot_file_id = excluded.headshot_file_id,
           user_id = excluded.user_id,
           updated_at = excluded.updated_at`,
        [
          partId,
          SEED_EVENT_ID,
          personId,
          i === 0 ? SEED_DEMO_USERS.speaker.id : null,
          "speaker",
          "accepted",
          hasHeadshot ? `Bio for ${name}.` : null,
          i % 7 === 0 ? "Acme Labs" : null,
          i % 5 === 0 ? "Staff Engineer" : null,
          headshotFileId,
          FIXED_NOW,
          FIXED_NOW,
        ],
      );

      run(
        db,
        `INSERT INTO sessions (
           id, event_id, source_submission_id, title, description, track_id,
           status, version, created_at, updated_at
         ) VALUES (?, ?, NULL, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, track_id = excluded.track_id,
           updated_at = excluded.updated_at`,
        [
          sessionId,
          SEED_EVENT_ID,
          `Talk ${idx}: Deterministic Demo Session`,
          `Abstract for speaker ${idx}.`,
          trackId,
          "accepted",
          FIXED_NOW,
          FIXED_NOW,
        ],
      );

      run(
        db,
        `INSERT INTO session_speakers (session_id, participation_id, is_primary)
         VALUES (?, ?, 1)
         ON CONFLICT(session_id, participation_id) DO UPDATE SET is_primary = 1`,
        [sessionId, partId],
      );

      // Outstanding tasks for speakers without headshots (and a few with)
      for (const [tplId, taskPrefix] of [
        ["tpl_seed_headshot", "task_seed_hs"],
        ["tpl_seed_bio", "task_seed_bio"],
      ] as const) {
        const taskId = `${taskPrefix}_${idx}`;
        const status =
          hasHeadshot && tplId === "tpl_seed_headshot" ? "completed" : "pending";
        const completedAt = status === "completed" ? FIXED_NOW : null;
        run(
          db,
          `INSERT INTO speaker_tasks (
             id, template_id, participation_id, status, due_at, completed_at,
             version, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
           ON CONFLICT(id) DO UPDATE SET status = excluded.status,
             completed_at = excluded.completed_at, updated_at = excluded.updated_at`,
          [
            taskId,
            tplId,
            partId,
            status,
            "2026-09-01T00:00:00.000Z",
            completedAt,
            FIXED_NOW,
            FIXED_NOW,
          ],
        );
      }
    }

    // --- schedule: valid placements + intentional room conflict ---
    // Place first 20 sessions cleanly on main hall in non-overlapping slots.
    for (let i = 0; i < 20; i++) {
      const idx = pad3(i);
      const placementId = `plc_seed_${idx}`;
      const sessionId = `sess_seed_${idx}`;
      const partId = `part_seed_${idx}`;
      // Day 1 slots: 09:00 + i hours (non-overlapping 50-min)
      const hour = 9 + Math.floor(i / 2);
      const min = i % 2 === 0 ? "00" : "30";
      // Two parallel rooms alternate to avoid self-overlap for first 20
      const roomId = i % 2 === 0 ? "room_seed_main" : "room_seed_side";
      const startsAt = `2026-09-15T${String(hour).padStart(2, "0")}:${min}:00.000Z`;
      const endHour = min === "00" ? hour : hour + 1;
      const endMin = min === "00" ? "50" : "20";
      const endsAt = `2026-09-15T${String(endHour).padStart(2, "0")}:${endMin}:00.000Z`;

      run(
        db,
        `INSERT INTO schedule_placements (
           id, event_id, session_id, room_id, starts_at, ends_at,
           version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET room_id = excluded.room_id,
           starts_at = excluded.starts_at, ends_at = excluded.ends_at,
           updated_at = excluded.updated_at`,
        [
          placementId,
          SEED_EVENT_ID,
          sessionId,
          roomId,
          startsAt,
          endsAt,
          FIXED_NOW,
          FIXED_NOW,
        ],
      );
      run(
        db,
        `INSERT INTO room_block_reservations (
           id, event_id, room_id, placement_id, starts_at, ends_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET starts_at = excluded.starts_at,
           ends_at = excluded.ends_at`,
        [
          `rbr_seed_${idx}`,
          SEED_EVENT_ID,
          roomId,
          placementId,
          startsAt,
          endsAt,
          FIXED_NOW,
        ],
      );
      run(
        db,
        `INSERT INTO speaker_block_reservations (
           id, event_id, participation_id, placement_id, starts_at, ends_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET starts_at = excluded.starts_at,
           ends_at = excluded.ends_at`,
        [
          `sbr_seed_${idx}`,
          SEED_EVENT_ID,
          partId,
          placementId,
          startsAt,
          endsAt,
          FIXED_NOW,
        ],
      );
    }

    // Intentional hard room conflict for demo (bypasses domain Place gate):
    // sess_seed_100 overlaps room_seed_main slot used by sess_seed_000 (09:00–09:50).
    {
      const conflictSession = "sess_seed_100";
      const conflictPlc = "plc_seed_conflict_room";
      const conflictStarts = "2026-09-15T09:20:00.000Z";
      const conflictEnds = "2026-09-15T10:10:00.000Z";
      const conflictRoom = "room_seed_main";
      run(
        db,
        `INSERT INTO schedule_placements (
           id, event_id, session_id, room_id, starts_at, ends_at,
           version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET room_id = excluded.room_id,
           starts_at = excluded.starts_at, ends_at = excluded.ends_at,
           updated_at = excluded.updated_at`,
        [
          conflictPlc,
          SEED_EVENT_ID,
          conflictSession,
          conflictRoom,
          conflictStarts,
          conflictEnds,
          FIXED_NOW,
          FIXED_NOW,
        ],
      );
      run(
        db,
        `INSERT INTO room_block_reservations (
           id, event_id, room_id, placement_id, starts_at, ends_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET starts_at = excluded.starts_at,
           ends_at = excluded.ends_at`,
        [
          "rbr_seed_conflict_room",
          SEED_EVENT_ID,
          conflictRoom,
          conflictPlc,
          conflictStarts,
          conflictEnds,
          FIXED_NOW,
        ],
      );
      run(
        db,
        `INSERT INTO speaker_block_reservations (
           id, event_id, participation_id, placement_id, starts_at, ends_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET starts_at = excluded.starts_at,
           ends_at = excluded.ends_at`,
        [
          "sbr_seed_conflict_room",
          SEED_EVENT_ID,
          "part_seed_100",
          conflictPlc,
          conflictStarts,
          conflictEnds,
          FIXED_NOW,
        ],
      );
    }

    // Email template for comms demos (portalUrl merge for accept handoff demos)
    run(
      db,
      `INSERT INTO email_templates (
         id, event_id, key, subject, body_md, version, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET subject = excluded.subject, body_md = excluded.body_md,
         updated_at = excluded.updated_at`,
      [
        "etpl_seed_welcome",
        SEED_EVENT_ID,
        "welcome",
        "Welcome to {{eventName}}, {{name}}",
        "Hi {{name}},\n\nYou are confirmed for **{{eventName}}**.\n\nPortal: {{portalUrl}}\n\n— Programme team",
        FIXED_NOW,
        FIXED_NOW,
      ],
    );

    // --- Competition thin-area graph: published CFP, submissions, eval queue ---
    // Second evaluator for peer-review deliberation demos
    run(
      db,
      `INSERT INTO users (id, email, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name,
         updated_at = excluded.updated_at`,
      [
        "user_demo_evaluator_b",
        "evaluator-b@demo.speakerops.local",
        "Demo Evaluator B",
        FIXED_NOW,
        FIXED_NOW,
      ],
    );
    run(
      db,
      `INSERT INTO event_memberships (id, event_id, user_id, role, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(event_id, user_id) DO UPDATE SET role = excluded.role`,
      [
        "mem_evaluator_b_demo",
        SEED_EVENT_ID,
        "user_demo_evaluator_b",
        "evaluator",
        FIXED_NOW,
      ],
    );

    const SEED_FORM_ID = "form_seed_cfp";
    const SEED_FORM_DRAFT_ID = "fv_seed_cfp_draft";
    const SEED_FORM_PUB_ID = "fv_seed_cfp_v1";
    const snapshot = {
      welcomeMd: "Welcome to Dogfood CFP 2026",
      thankYouMd: "Thanks for submitting — we'll be in touch.",
      opensAt: null,
      closesAt: null,
      submissionLimit: null,
      fields: [
        {
          id: "ff_seed_title",
          fieldKey: "talk_title",
          type: "text",
          label: "Talk title",
          required: true,
          options: null,
          sortOrder: 0,
          conditions: null,
        },
        {
          id: "ff_seed_abstract",
          fieldKey: "abstract",
          type: "textarea",
          label: "Abstract",
          required: true,
          options: null,
          sortOrder: 1,
          conditions: null,
        },
        {
          id: "ff_seed_tracks",
          fieldKey: "tracks",
          type: "multiselect",
          label: "Tracks",
          required: false,
          options: [
            { value: "core", label: "Core AI" },
            { value: "ops", label: "Ops" },
            { value: "product", label: "Product" },
          ],
          sortOrder: 2,
          conditions: null,
        },
        {
          id: "ff_seed_url",
          fieldKey: "slides_url",
          type: "url",
          label: "Slides URL",
          required: false,
          options: null,
          sortOrder: 3,
          conditions: null,
        },
      ],
      rules: [],
    };

    run(
      db,
      `INSERT INTO forms (id, event_id, name, status, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, status = excluded.status`,
      [SEED_FORM_ID, SEED_EVENT_ID, "Dogfood CFP 2026", "published", FIXED_NOW],
    );
    run(
      db,
      `INSERT INTO form_versions (
         id, form_id, version_num, welcome_md, thank_you_md, opens_at, closes_at,
         submission_limit, published_at, snapshot_json
       ) VALUES (?, ?, 0, ?, ?, NULL, NULL, NULL, NULL, NULL)
       ON CONFLICT(id) DO UPDATE SET welcome_md = excluded.welcome_md`,
      [
        SEED_FORM_DRAFT_ID,
        SEED_FORM_ID,
        snapshot.welcomeMd,
        snapshot.thankYouMd,
      ],
    );
    run(
      db,
      `INSERT INTO form_versions (
         id, form_id, version_num, welcome_md, thank_you_md, opens_at, closes_at,
         submission_limit, published_at, snapshot_json
       ) VALUES (?, ?, 1, ?, ?, NULL, NULL, NULL, ?, ?)
       ON CONFLICT(id) DO UPDATE SET snapshot_json = excluded.snapshot_json,
         published_at = excluded.published_at`,
      [
        SEED_FORM_PUB_ID,
        SEED_FORM_ID,
        snapshot.welcomeMd,
        snapshot.thankYouMd,
        FIXED_NOW,
        JSON.stringify(snapshot),
      ],
    );
    // Draft fields (builder reload) + published fields
    for (const verId of [SEED_FORM_DRAFT_ID, SEED_FORM_PUB_ID]) {
      for (const f of snapshot.fields) {
        run(
          db,
          `INSERT INTO form_fields (
             id, form_version_id, field_key, type, label, required, options_json,
             sort_order, conditions_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
           ON CONFLICT(form_version_id, field_key) DO UPDATE SET
             label = excluded.label, type = excluded.type, required = excluded.required,
             options_json = excluded.options_json, sort_order = excluded.sort_order`,
          [
            `${f.id}_${verId === SEED_FORM_PUB_ID ? "pub" : "draft"}`,
            verId,
            f.fieldKey,
            f.type,
            f.label,
            f.required ? 1 : 0,
            f.options ? JSON.stringify(f.options) : null,
            f.sortOrder,
          ],
        );
      }
    }

    // Eval round + criteria
    const SEED_ROUND_ID = "round_seed_main";
    run(
      db,
      `INSERT INTO eval_rounds (
         id, event_id, name, status, closes_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, name = excluded.name,
         updated_at = excluded.updated_at`,
      [
        SEED_ROUND_ID,
        SEED_EVENT_ID,
        "Main review",
        "active",
        FIXED_NOW,
        FIXED_NOW,
      ],
    );
    const criteria = [
      ["crit_seed_impact", "Impact", 5, 1, 0],
      ["crit_seed_clarity", "Clarity", 5, 1, 1],
      ["crit_seed_novelty", "Novelty", 5, 1, 2],
    ] as const;
    for (const [id, name, max, weight, sort] of criteria) {
      run(
        db,
        `INSERT INTO eval_criteria (id, round_id, name, max_score, weight, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, max_score = excluded.max_score`,
        [id, SEED_ROUND_ID, name, max, weight, sort],
      );
    }

    // 12 submitted CFP proposals for triage / assign / bulk / eval demos
    for (let i = 0; i < 12; i++) {
      const idx = pad3(i);
      const subId = `sub_seed_${idx}`;
      const personId = `person_cfp_seed_${idx}`;
      const email = `cfp-speaker${idx}@demo.speakerops.local`;
      const name = `CFP Speaker ${idx}`;
      const title = `CFP Proposal ${idx}: Thin Area Demo Talk`;
      run(
        db,
        `INSERT INTO people (id, org_id, email, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name,
           updated_at = excluded.updated_at`,
        [personId, SEED_ORG_ID, email, name, FIXED_NOW, FIXED_NOW],
      );
      run(
        db,
        `INSERT INTO submissions (
           id, event_id, form_version_id, title, category, status, submitted_at, version
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, status = excluded.status`,
        [
          subId,
          SEED_EVENT_ID,
          SEED_FORM_PUB_ID,
          title,
          i % 2 === 0 ? "core" : "ops",
          "submitted",
          FIXED_NOW,
        ],
      );
      run(
        db,
        `INSERT INTO submission_answers (id, submission_id, field_key, value_json)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(submission_id, field_key) DO UPDATE SET value_json = excluded.value_json`,
        [
          `sa_seed_${idx}_title`,
          subId,
          "talk_title",
          JSON.stringify(title),
        ],
      );
      run(
        db,
        `INSERT INTO submission_answers (id, submission_id, field_key, value_json)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(submission_id, field_key) DO UPDATE SET value_json = excluded.value_json`,
        [
          `sa_seed_${idx}_abstract`,
          subId,
          "abstract",
          JSON.stringify(
            `Abstract for ${title}. Enough detail for evaluators to score responsibly.`,
          ),
        ],
      );
      run(
        db,
        `INSERT INTO submission_answers (id, submission_id, field_key, value_json)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(submission_id, field_key) DO UPDATE SET value_json = excluded.value_json`,
        [
          `sa_seed_${idx}_tracks`,
          subId,
          "tracks",
          JSON.stringify(i % 2 === 0 ? ["core", "ops"] : ["product"]),
        ],
      );
      run(
        db,
        `INSERT INTO submission_speakers (submission_id, person_id, is_primary, sort_order)
         VALUES (?, ?, 1, 0)
         ON CONFLICT(submission_id, person_id) DO UPDATE SET is_primary = 1`,
        [subId, personId],
      );

      // Assign first 8 to demo evaluator; first 4 also to evaluator B (peer demos)
      if (i < 8) {
        const asnA = `asn_seed_a_${idx}`;
        const statusA = i < 2 ? "scored" : "pending";
        run(
          db,
          `INSERT INTO eval_assignments (
             id, round_id, submission_id, evaluator_user_id, status, overall_comment,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET status = excluded.status,
             overall_comment = excluded.overall_comment, updated_at = excluded.updated_at`,
          [
            asnA,
            SEED_ROUND_ID,
            subId,
            SEED_DEMO_USERS.evaluator.id,
            statusA,
            statusA === "scored" ? `Strong talk ${idx} — clear impact.` : null,
            FIXED_NOW,
            FIXED_NOW,
          ],
        );
        if (statusA === "scored") {
          for (const [critId, val] of [
            ["crit_seed_impact", 4],
            ["crit_seed_clarity", 5],
            ["crit_seed_novelty", 3],
          ] as const) {
            run(
              db,
              `INSERT INTO scores (id, assignment_id, criterion_id, value, comment)
               VALUES (?, ?, ?, ?, NULL)
               ON CONFLICT(assignment_id, criterion_id) DO UPDATE SET value = excluded.value`,
              [`score_${asnA}_${critId}`, asnA, critId, val],
            );
          }
        }
      }
      if (i < 4) {
        const asnB = `asn_seed_b_${idx}`;
        const statusB = i < 1 ? "scored" : "pending";
        run(
          db,
          `INSERT INTO eval_assignments (
             id, round_id, submission_id, evaluator_user_id, status, overall_comment,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET status = excluded.status,
             overall_comment = excluded.overall_comment, updated_at = excluded.updated_at`,
          [
            asnB,
            SEED_ROUND_ID,
            subId,
            "user_demo_evaluator_b",
            statusB,
            statusB === "scored" ? `Peer B comment on ${idx}.` : null,
            FIXED_NOW,
            FIXED_NOW,
          ],
        );
        if (statusB === "scored") {
          run(
            db,
            `INSERT INTO scores (id, assignment_id, criterion_id, value, comment)
             VALUES (?, ?, ?, ?, NULL)
             ON CONFLICT(assignment_id, criterion_id) DO UPDATE SET value = excluded.value`,
            [
              `score_${asnB}_crit_seed_impact`,
              asnB,
              "crit_seed_impact",
              4,
            ],
          );
        }
      }
    }

    // Calendar invite for ICS attach-on-send demos (placement from schedule seed)
    run(
      db,
      `INSERT INTO calendar_invites (
         id, event_id, placement_id, session_id, uid, sequence, method,
         summary, starts_at, ends_at, location, ics_body, version, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET ics_body = excluded.ics_body, updated_at = excluded.updated_at`,
      [
        "cinv_seed_main",
        SEED_EVENT_ID,
        "plc_seed_000",
        "sess_seed_000",
        `${SEED_EVENT_ID}-plc_seed_000@speakerops.local`,
        "REQUEST",
        "Talk 000: Deterministic Demo Session",
        "2026-09-15T09:00:00.000Z",
        "2026-09-15T09:50:00.000Z",
        "Main Hall",
        [
          "BEGIN:VCALENDAR",
          "VERSION:2.0",
          "PRODID:-//SpeakerOps//Seed//EN",
          "METHOD:REQUEST",
          "BEGIN:VEVENT",
          `UID:${SEED_EVENT_ID}-plc_seed_000@speakerops.local`,
          "SEQUENCE:0",
          "SUMMARY:Talk 000: Deterministic Demo Session",
          "DTSTART:20260915T090000Z",
          "DTEND:20260915T095000Z",
          "LOCATION:Main Hall",
          "END:VEVENT",
          "END:VCALENDAR",
        ].join("\r\n"),
        FIXED_NOW,
        FIXED_NOW,
      ],
    );

    // Consequential seed audit (E3 correlationId)
    run(
      db,
      `INSERT INTO audit_events (
         id, event_id, actor_type, actor_id, action, entity_type, entity_id,
         before_json, after_json, correlation_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         after_json = excluded.after_json,
         correlation_id = excluded.correlation_id,
         created_at = excluded.created_at`,
      [
        SEED_AUDIT_ID,
        SEED_EVENT_ID,
        "system",
        "seed",
        "Seed.DemoGraph",
        "event",
        SEED_EVENT_ID,
        JSON.stringify({
          speakerCount: SEED_SPEAKER_COUNT,
          section: "8.4",
          missingHeadshots: SEED_SPEAKER_COUNT - HEADSHOT_COUNT,
          scheduleConflict: true,
          thinAreas: {
            publishedCfpForm: true,
            cfpSubmissions: 12,
            evalRound: true,
            evalAssignments: true,
            calendarInvite: true,
            secondEvaluator: true,
          },
        }),
        SEED_CORRELATION_ID,
        FIXED_NOW,
      ],
    );

    const speakerCount = scalarInt(
      db,
      `SELECT COUNT(*) AS c FROM event_participations WHERE event_id = ?`,
      [SEED_EVENT_ID],
    );
    const missingHeadshotCount = scalarInt(
      db,
      `SELECT COUNT(*) AS c FROM event_participations
       WHERE event_id = ? AND (headshot_file_id IS NULL OR headshot_file_id = '')`,
      [SEED_EVENT_ID],
    );
    const outstandingTaskCount = scalarInt(
      db,
      `SELECT COUNT(*) AS c FROM speaker_tasks st
       INNER JOIN event_participations ep ON ep.id = st.participation_id
       WHERE ep.event_id = ? AND st.status = 'pending'`,
      [SEED_EVENT_ID],
    );
    const scheduleConflictCount = countRoomScheduleConflicts(db, SEED_EVENT_ID);

    persistDatabase(db, dbPath);

    return {
      dbPath,
      speakerCount,
      missingHeadshotCount,
      scheduleConflictCount,
      outstandingTaskCount,
      correlationId: SEED_CORRELATION_ID,
      eventId: SEED_EVENT_ID,
    };
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const result = await runSeed();
  process.stdout.write(
    `[seed] ok db=${result.dbPath} speakers=${result.speakerCount} ` +
      `missingHeadshots=${result.missingHeadshotCount} ` +
      `scheduleConflicts=${result.scheduleConflictCount} ` +
      `outstandingTasks=${result.outstandingTaskCount} ` +
      `eventId=${result.eventId} correlationId=${result.correlationId}\n`,
  );
  if (result.speakerCount !== SEED_SPEAKER_COUNT) {
    process.stderr.write(
      `[seed] expected ${SEED_SPEAKER_COUNT} speakers, got ${result.speakerCount}\n`,
    );
    process.exit(1);
  }
  if (result.scheduleConflictCount < 1) {
    process.stderr.write("[seed] expected ≥1 schedule conflict\n");
    process.exit(1);
  }
  if (result.missingHeadshotCount < 1) {
    process.stderr.write("[seed] expected missing headshots\n");
    process.exit(1);
  }
}

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((err) => {
    process.stderr.write(
      `[seed] failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
