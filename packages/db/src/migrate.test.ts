/**
 * Section 1.3 — migration named assertions (Vitest).
 *
 * Spec tests:
 * - assert migration creates organizations,events,audit_events,outbox_events,idempotency_keys
 * - assert events.version column exists
 * - assert second migrate is no-op or succeeds
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  migrate,
  inspectSchema,
  BASELINE_TABLES,
  AUTH_TABLES,
  MEMBERSHIP_TABLES,
  EVENT_SETTINGS_TABLES,
  DESIGN_TABLES,
  resolveDbPackageRoot,
  defaultMigrationsDir,
} from "./migrate.js";
import {
  requireEventId,
  eventScoped,
  buildAuditEventRow,
  MissingEventIdError,
} from "./repository.js";
import {
  organizations,
  events,
  auditEvents,
  outboxEvents,
  idempotencyKeys,
  users,
  authSessions,
  magicLinks,
  eventMemberships,
  rooms,
  tracks,
  designTokenDrafts,
  designTokenPublished,
  fileAssets,
  schema,
} from "../schema.js";
import { SCHEMA_READY } from "./client.js";

const migrationsDir = defaultMigrationsDir(resolveDbPackageRoot());

function tempDbPath(): { dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "speakerops-db-"));
  return { dir, dbPath: join(dir, "test.sqlite") };
}

describe("1.3 D1 Drizzle baseline migrations", () => {
  it("assert migration creates organizations,events,audit_events,outbox_events,idempotency_keys", async () => {
    const { dir, dbPath } = tempDbPath();
    try {
      const result = await migrate({ dbPath, migrationsDir });
      expect(result.applied).toContain("0001_baseline.sql");
      for (const table of BASELINE_TABLES) {
        expect(result.tables, `missing table ${table}`).toContain(table);
      }
      expect(SCHEMA_READY).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("assert events.version column exists", async () => {
    const { dir, dbPath } = tempDbPath();
    try {
      const { columns, tables } = await inspectSchema({ dbPath, migrationsDir });
      expect(tables).toContain("events");
      expect(columns.events, "events columns").toContain("version");
      expect(events.version).toBeDefined();
      expect(events.version.name).toBe("version");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("assert second migrate is no-op or succeeds", async () => {
    const { dir, dbPath } = tempDbPath();
    try {
      const first = await migrate({ dbPath, migrationsDir });
      expect(first.applied).toContain("0001_baseline.sql");
      expect(first.skipped).toEqual([]);

      const second = await migrate({ dbPath, migrationsDir });
      expect(second.applied).toEqual([]);
      expect(second.skipped).toContain("0001_baseline.sql");
      for (const table of BASELINE_TABLES) {
        expect(second.tables).toContain(table);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("schema module exports all baseline tables", () => {
    expect(organizations).toBeDefined();
    expect(events).toBeDefined();
    expect(auditEvents).toBeDefined();
    expect(outboxEvents).toBeDefined();
    expect(idempotencyKeys).toBeDefined();
    expect(schema.organizations).toBe(organizations);
    expect(schema.events).toBe(events);
    expect(schema.auditEvents).toBe(auditEvents);
    expect(schema.outboxEvents).toBe(outboxEvents);
    expect(schema.idempotencyKeys).toBe(idempotencyKeys);
  });

  it("2.1 migration creates users, auth_sessions, magic_links with token_hash", async () => {
    const { dir, dbPath } = tempDbPath();
    try {
      const result = await migrate({ dbPath, migrationsDir });
      expect(result.applied).toContain("0002_auth.sql");
      for (const table of AUTH_TABLES) {
        expect(result.tables, `missing table ${table}`).toContain(table);
      }
      const { columns } = await inspectSchema({ dbPath, migrationsDir });
      expect(columns.magic_links).toContain("token_hash");
      expect(columns.magic_links).toContain("used_at");
      expect(columns.auth_sessions).toContain("token_hash");
      expect(columns.users).toContain("email");
      // No plaintext token column
      expect(columns.magic_links).not.toContain("token");
      expect(columns.auth_sessions).not.toContain("token");
      expect(users).toBeDefined();
      expect(authSessions).toBeDefined();
      expect(magicLinks).toBeDefined();
      expect(schema.users).toBe(users);
      expect(schema.authSessions).toBe(authSessions);
      expect(schema.magicLinks).toBe(magicLinks);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("audit_events and outbox_events tables exist after migrate", async () => {
    const { dir, dbPath } = tempDbPath();
    try {
      const { tables, columns } = await inspectSchema({ dbPath, migrationsDir });
      expect(tables).toContain("audit_events");
      expect(tables).toContain("outbox_events");
      expect(columns.audit_events).toContain("correlation_id");
      expect(columns.outbox_events).toContain("payload_json");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("2.2 migration creates event_memberships with role", async () => {
    const { dir, dbPath } = tempDbPath();
    try {
      const result = await migrate({ dbPath, migrationsDir });
      expect(result.applied).toContain("0003_event_memberships.sql");
      for (const table of MEMBERSHIP_TABLES) {
        expect(result.tables, `missing table ${table}`).toContain(table);
      }
      const { columns } = await inspectSchema({ dbPath, migrationsDir });
      expect(columns.event_memberships).toContain("event_id");
      expect(columns.event_memberships).toContain("user_id");
      expect(columns.event_memberships).toContain("role");
      expect(eventMemberships).toBeDefined();
      expect(schema.eventMemberships).toBe(eventMemberships);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("2.3 migration creates rooms and tracks with event_id", async () => {
    const { dir, dbPath } = tempDbPath();
    try {
      const result = await migrate({ dbPath, migrationsDir });
      expect(result.applied).toContain("0004_rooms_tracks.sql");
      for (const table of EVENT_SETTINGS_TABLES) {
        expect(result.tables, `missing table ${table}`).toContain(table);
      }
      const { columns } = await inspectSchema({ dbPath, migrationsDir });
      expect(columns.rooms).toContain("event_id");
      expect(columns.rooms).toContain("name");
      expect(columns.rooms).toContain("version");
      expect(columns.tracks).toContain("event_id");
      expect(columns.tracks).toContain("name");
      expect(columns.tracks).toContain("version");
      expect(rooms).toBeDefined();
      expect(tracks).toBeDefined();
      expect(schema.rooms).toBe(rooms);
      expect(schema.tracks).toBe(tracks);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("2.4 migration creates design token tables and file_assets", async () => {
    const { dir, dbPath } = tempDbPath();
    try {
      const result = await migrate({ dbPath, migrationsDir });
      expect(result.applied).toContain("0005_design_tokens.sql");
      for (const table of DESIGN_TABLES) {
        expect(result.tables, `missing table ${table}`).toContain(table);
      }
      const { columns } = await inspectSchema({ dbPath, migrationsDir });
      expect(columns.design_token_drafts).toContain("event_id");
      expect(columns.design_token_drafts).toContain("tokens_json");
      expect(columns.design_token_drafts).toContain("version");
      expect(columns.design_token_published).toContain("event_id");
      expect(columns.design_token_published).toContain("published_at");
      expect(columns.file_assets).toContain("event_id");
      expect(columns.file_assets).toContain("mime");
      expect(columns.file_assets).toContain("purpose");
      expect(designTokenDrafts).toBeDefined();
      expect(designTokenPublished).toBeDefined();
      expect(fileAssets).toBeDefined();
      expect(schema.designTokenDrafts).toBe(designTokenDrafts);
      expect(schema.designTokenPublished).toBe(designTokenPublished);
      expect(schema.fileAssets).toBe(fileAssets);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("1.3 repository eventId scoping stub", () => {
  it("requireEventId rejects empty and accepts valid ids", () => {
    expect(() => requireEventId(undefined)).toThrow(MissingEventIdError);
    expect(() => requireEventId("")).toThrow(MissingEventIdError);
    expect(() => requireEventId("   ")).toThrow(MissingEventIdError);
    expect(requireEventId("evt_01")).toBe("evt_01");
  });

  it("eventScoped injects validated eventId", () => {
    const list = eventScoped((eventId: string, suffix: string) => `${eventId}:${suffix}`);
    expect(list("evt_abc", "x")).toBe("evt_abc:x");
    expect(() => list(null, "x")).toThrow(MissingEventIdError);
  });

  it("buildAuditEventRow requires correlationId (E3)", () => {
    expect(() =>
      buildAuditEventRow({
        id: "a1",
        actorType: "system",
        actorId: "sys",
        action: "test",
        entityType: "event",
        entityId: "e1",
        correlationId: "",
        createdAt: new Date().toISOString(),
      }),
    ).toThrow(/correlationId/);

    const row = buildAuditEventRow({
      id: "a1",
      eventId: "e1",
      actorType: "system",
      actorId: "sys",
      action: "test.create",
      entityType: "event",
      entityId: "e1",
      correlationId: "corr-123",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(row.correlationId).toBe("corr-123");
    expect(row.eventId).toBe("e1");
  });
});
