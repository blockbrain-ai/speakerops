/**
 * Section 2.3 — governance / file assertions for event settings.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const migrationPath = join(
  root,
  "packages",
  "db",
  "migrations",
  "0004_rooms_tracks.sql",
);
const schemaPath = join(root, "packages", "db", "schema.ts");
const eventsRoutes = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "events",
  "routes.ts",
);
const eventsTest = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "events",
  "events.test.ts",
);
const settingsPage = join(
  root,
  "apps",
  "web",
  "src",
  "pages",
  "EventSettings.tsx",
);
const e2ePath = join(root, "playwright", "e2e", "event_settings.spec.ts");
const sectionDoc = join(root, "docs", "sections", "2.3-event-settings.md");
const inventoryPath = join(
  root,
  "KMS-competition",
  "initiative",
  "BROWSER_E2E_INVENTORY.md",
);
const sharedEvents = join(root, "packages", "shared", "src", "events.ts");

describe("2.3 event settings governance", () => {
  it("0004_rooms_tracks.sql creates rooms and tracks", () => {
    assert.equal(existsSync(migrationPath), true, "0004_rooms_tracks.sql must exist");
    const sql = readFileSync(migrationPath, "utf8");
    assert.match(sql, /CREATE TABLE IF NOT EXISTS rooms\b/i);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS tracks\b/i);
    assert.match(sql, /event_id/i);
  });

  it("schema exports rooms and tracks", () => {
    const src = readFileSync(schemaPath, "utf8");
    assert.match(src, /export const rooms/);
    assert.match(src, /export const tracks/);
  });

  it("shared event DTOs and API routes exist", () => {
    assert.equal(existsSync(sharedEvents), true);
    const shared = readFileSync(sharedEvents, "utf8");
    assert.match(shared, /EventCreateBodySchema/);
    assert.match(shared, /RoomUpsertBodySchema/);
    assert.match(shared, /TrackUpsertBodySchema/);

    assert.equal(existsSync(eventsRoutes), true);
    const routes = readFileSync(eventsRoutes, "utf8");
    assert.match(routes, /Event\.Create|POST.*\//);
    assert.match(routes, /Room\.Upsert|rooms/);
    assert.match(routes, /Track\.Upsert|tracks/);
  });

  it("named assertions present in events.test.ts", () => {
    assert.equal(existsSync(eventsTest), true);
    const src = readFileSync(eventsTest, "utf8");
    for (const name of [
      "assert Event.Create returns id and timezone",
      "assert room from event A not readable with event B context 404",
    ]) {
      assert.match(src, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("EventSettings UI and Playwright @inv C01 C02 C07 C11 O01–O03 exist", () => {
    assert.equal(existsSync(settingsPage), true);
    assert.equal(existsSync(e2ePath), true);
    const e2e = readFileSync(e2ePath, "utf8");
    for (const id of ["C01", "C02", "C07", "C11", "O01", "O02", "O03"]) {
      assert.match(e2e, new RegExp(`@inv:${id}`));
    }
    assert.match(e2e, /e2e\/admin\/event-create/);
    assert.match(e2e, /e2e\/admin\/event-switch/);
    assert.match(e2e, /e2e\/admin\/settings-cfp-window/);
    assert.match(e2e, /e2e\/admin\/event-isolation/);
    assert.match(e2e, /e2e\/settings\/event/);
    assert.match(e2e, /e2e\/settings\/rooms/);
    assert.match(e2e, /e2e\/settings\/tracks/);
    assert.match(e2e, /event-context/);
  });

  it("inventory C01 C02 C07 C11 O01–O03 status IMPLEMENTED or PASS", () => {
    const inv = readFileSync(inventoryPath, "utf8");
    for (const id of ["C01", "C02", "C07", "C11", "O01", "O02", "O03"]) {
      assert.match(
        inv,
        new RegExp(
          `\\|\\s*${id}\\s*\\|[^|]+\\|[^|]+\\|[^|]+\\|[^|]+\\|[^|]+\\|\\s*REQUIRED\\s*\\|\\s*(IMPLEMENTED|PASS)\\s*\\|`,
        ),
        `${id} must be IMPLEMENTED or PASS (2.5 proof may promote)`,
      );
    }
  });

  it("section doc exists", () => {
    assert.equal(existsSync(sectionDoc), true);
    const doc = readFileSync(sectionDoc, "utf8");
    assert.match(doc, /2\.3/);
    assert.match(doc, /Event\.Create/);
    assert.match(doc, /rooms/i);
    assert.match(doc, /tracks/i);
  });

  it("no secrets in events module sources", () => {
    const dir = join(root, "apps", "api", "src", "modules", "events");
    if (!existsSync(dir)) return;
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    for (const f of files) {
      const body = readFileSync(join(dir, f), "utf8");
      assert.equal(/sk-[A-Za-z0-9]{20,}/.test(body), false, f);
      assert.equal(/CLOUDFLARE_API_TOKEN\s*=/.test(body), false, f);
    }
  });
});
