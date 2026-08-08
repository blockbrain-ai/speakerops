/**
 * Section 6.1 — governance / file assertions for schedule conflict engine.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const migrationPath = join(
  root,
  "packages",
  "db",
  "migrations",
  "0017_schedule.sql",
);
const schemaPath = join(root, "packages", "db", "schema.ts");
const scheduleRoutes = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "schedule",
  "routes.ts",
);
const scheduleCommands = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "schedule",
  "commands.ts",
);
const scheduleStore = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "schedule",
  "store.ts",
);
const scheduleTest = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "schedule",
  "schedule.test.ts",
);
const sharedSchedule = join(
  root,
  "packages",
  "shared",
  "src",
  "schedule.ts",
);
const openapiPath = join(root, "apps", "api", "src", "openapi.ts");
const indexPath = join(root, "apps", "api", "src", "index.ts");
const sectionDoc = join(root, "docs", "sections", "6.1-schedule-conflicts.md");

describe("6.1 schedule conflict engine governance", () => {
  it("0017_schedule.sql creates placements and reservation tables", () => {
    assert.equal(existsSync(migrationPath), true, "0017_schedule.sql must exist");
    const sql = readFileSync(migrationPath, "utf8");
    assert.match(sql, /CREATE TABLE IF NOT EXISTS schedule_placements\b/i);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS room_block_reservations\b/i);
    assert.match(
      sql,
      /CREATE TABLE IF NOT EXISTS speaker_block_reservations\b/i,
    );
    assert.match(sql, /starts_at/i);
    assert.match(sql, /ends_at/i);
    assert.match(sql, /version/i);
  });

  it("schema exports schedule tables", () => {
    const src = readFileSync(schemaPath, "utf8");
    assert.match(src, /schedulePlacements/);
    assert.match(src, /roomBlockReservations/);
    assert.match(src, /speakerBlockReservations/);
    assert.match(src, /scheduleTables/);
  });

  it("API module implements Place/Move/Unschedule/List", () => {
    assert.equal(existsSync(scheduleRoutes), true);
    assert.equal(existsSync(scheduleCommands), true);
    assert.equal(existsSync(scheduleStore), true);
    const routes = readFileSync(scheduleRoutes, "utf8");
    assert.match(routes, /schedule\/place/);
    assert.match(routes, /schedule\/move/);
    assert.match(routes, /schedule\/unschedule/);
    assert.match(routes, /\/:eventId\/schedule/);
    const commands = readFileSync(scheduleCommands, "utf8");
    assert.match(commands, /placeSession|Schedule\.Place/);
    assert.match(commands, /movePlacement|Schedule\.Move/);
    assert.match(commands, /unschedulePlacement|Schedule\.Unschedule/);
    assert.match(commands, /listSchedule|Schedule\.List/);
    assert.match(commands, /detectConflicts/);
  });

  it("shared DTOs include conflict + VERSION codes", () => {
    assert.equal(existsSync(sharedSchedule), true);
    const src = readFileSync(sharedSchedule, "utf8");
    assert.match(src, /SchedulePlaceBodySchema/);
    assert.match(src, /ScheduleMoveBodySchema/);
    assert.match(src, /ScheduleUnscheduleBodySchema/);
    assert.match(src, /ScheduleListResponseSchema/);
    assert.match(src, /ScheduleConflictItemSchema/);
    const errors = readFileSync(
      join(root, "packages", "shared", "src", "errors.ts"),
      "utf8",
    );
    assert.match(errors, /VERSION/);
  });

  it("named test assertions present", () => {
    assert.equal(existsSync(scheduleTest), true);
    const tests = readFileSync(scheduleTest, "utf8");
    assert.match(
      tests,
      /assert double-book speaker returns 409 CONFLICT/,
    );
    assert.match(
      tests,
      /assert unschedule removes reservation allowing rebook/,
    );
    assert.match(tests, /assert stale version 409 VERSION/);
    assert.match(tests, /List returns unscheduled sessions/);
    assert.match(tests, /toBe\(409\)/);
    assert.match(tests, /CONFLICT|VERSION/);
  });

  it("composition root wires schedule store + OpenAPI commands", () => {
    const index = readFileSync(indexPath, "utf8");
    assert.match(index, /createScheduleRoutes/);
    assert.match(index, /MemoryScheduleStore|D1ScheduleStore|scheduleStore/);
    const openapi = readFileSync(openapiPath, "utf8");
    assert.match(openapi, /Schedule\.List/);
    assert.match(openapi, /Schedule\.Place/);
    assert.match(openapi, /Schedule\.Move/);
    assert.match(openapi, /Schedule\.Unschedule/);
  });

  it("section doc exists and forbids OR-Tools", () => {
    assert.equal(existsSync(sectionDoc), true);
    const doc = readFileSync(sectionDoc, "utf8");
    assert.match(doc, /S-SCHED|conflict/i);
    assert.match(doc, /No OR-Tools|no OR-Tools/i);
    assert.match(doc, /schedule_placements/);
  });

  it("no secrets in schedule sources", () => {
    for (const path of [
      scheduleRoutes,
      scheduleCommands,
      scheduleStore,
      sharedSchedule,
      migrationPath,
    ]) {
      const src = readFileSync(path, "utf8");
      assert.equal(
        /sk-[A-Za-z0-9]{10,}/.test(src),
        false,
        `secret-like token in ${path}`,
      );
      assert.equal(
        /api[_-]?key\s*[:=]\s*['\"][^'\"]+['\"]/i.test(src),
        false,
        `api key literal in ${path}`,
      );
    }
  });
});
