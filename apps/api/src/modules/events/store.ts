/**
 * Events / rooms / tracks persistence (section 2.3).
 *
 * MemoryEventsStore is the test / local e2e default (no D1 required).
 * D1EventsStore wraps the Worker DB binding for production (E1 SoR).
 * All event-owned queries take eventId (E2).
 *
 * Mutable updates include the prior version in the WHERE clause (E1 optimistic
 * concurrency) and report false when no row was changed.
 */
import { eq, and, inArray, sql } from "drizzle-orm";
import { uuidv7, DEFAULT_ORG_ID } from "@speakerops/shared";
import {
  createDb,
  type D1DatabaseLike,
  type SpeakerOpsDb,
  organizations,
  events,
  rooms,
  tracks,
  eventMemberships,
  outboxEvents,
  auditEvents,
} from "@speakerops/db";
import { d1Changes } from "../auth/store.js";

export type OrgRow = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type EventRow = {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  timezone: string;
  startsAt: string | null;
  endsAt: string | null;
  settingsJson: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type RoomRow = {
  id: string;
  eventId: string;
  name: string;
  capacity: number | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type TrackRow = {
  id: string;
  eventId: string;
  name: string;
  color: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

/**
 * Membership row written as part of Event.Create unit (E7).
 * Matches event_memberships columns.
 */
export type EventUnitMembership = {
  id: string;
  eventId: string;
  userId: string;
  role: string;
  createdAt: string;
};

/** Outbox row written with the event mutation (airtable.project). */
export type EventUnitOutbox = {
  id: string;
  topic: string;
  payloadJson: string;
  createdAt: string;
};

/** Audit row written with the event mutation (E3). */
export type EventUnitAudit = {
  id: string;
  eventId: string | null;
  actorType: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeJson: string | null;
  afterJson: string | null;
  correlationId: string;
  createdAt: string;
};

/**
 * Event.Create transactional unit (E7): event + membership + optional outbox + audit.
 * Single commit — no compensating multi-step path in commands.
 */
export type CreateEventUnit = {
  event: EventRow;
  membership: EventUnitMembership;
  outbox: EventUnitOutbox | null;
  audit: EventUnitAudit;
};

/**
 * Event.Update transactional unit (E7): CAS event + optional outbox + audit.
 * Returns false when version CAS loses (no side effects committed).
 */
export type UpdateEventUnit = {
  event: EventRow;
  expectedVersion: number;
  outbox: EventUnitOutbox | null;
  audit: EventUnitAudit;
};

/**
 * Memory-store bridges so AuthStore / AirtableStore stay the SoR for those
 * tables under Memory*. D1 ignores bridges and writes tables in one batch.
 */
export type EventUnitBridges = {
  insertMembership(row: EventUnitMembership): Promise<void>;
  deleteMembership(eventId: string, userId: string): Promise<void>;
  insertOutbox?(row: EventUnitOutbox): Promise<void>;
  deleteOutbox?(id: string): Promise<void>;
  insertAudit(row: EventUnitAudit): Promise<void>;
};

export type EventsStore = {
  ensureOrg(input?: { id?: string; name?: string }): Promise<OrgRow>;
  findEventById(id: string): Promise<EventRow | null>;
  findEventBySlug(slug: string): Promise<EventRow | null>;
  listEventsByIds(ids: string[]): Promise<EventRow[]>;
  /** All events belonging to an organization (org-scoped Bearer Event.List). */
  listEventsByOrgId(orgId: string): Promise<EventRow[]>;
  insertEvent(row: EventRow): Promise<EventRow>;
  /**
   * Conditional update: WHERE id AND version = expectedVersion.
   * Returns false on version conflict (no row changed).
   */
  updateEvent(row: EventRow, expectedVersion: number): Promise<boolean>;
  /**
   * Hard-delete for rare store-level rollback only. Product commands use
   * createEventUnit / updateEventUnit (E7 transactional outbox).
   */
  deleteEvent(id: string): Promise<boolean>;
  /**
   * Atomic Event.Create unit (E7): event + membership + outbox? + audit.
   * D1: single db.batch. Memory: bridges keep sibling stores consistent.
   */
  createEventUnit(unit: CreateEventUnit, bridges: EventUnitBridges): Promise<void>;
  /**
   * Atomic Event.Update unit (E7): CAS event + outbox? + audit.
   * Returns false on version conflict (no side effects committed).
   */
  updateEventUnit(
    unit: UpdateEventUnit,
    bridges: EventUnitBridges,
  ): Promise<boolean>;
  findRoom(eventId: string, roomId: string): Promise<RoomRow | null>;
  listRooms(eventId: string): Promise<RoomRow[]>;
  /**
   * Insert or conditional update. On update, expectedVersion must match;
   * returns false on version conflict.
   */
  upsertRoom(row: RoomRow, expectedVersion?: number): Promise<boolean>;
  findTrack(eventId: string, trackId: string): Promise<TrackRow | null>;
  listTracks(eventId: string): Promise<TrackRow[]>;
  /**
   * Insert or conditional update. On update, expectedVersion must match;
   * returns false on version conflict.
   */
  upsertTrack(row: TrackRow, expectedVersion?: number): Promise<boolean>;
};

/** slugify name → kebab-case (ASCII). */
export function slugifyName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return base.length > 0 ? base : "event";
}

/**
 * In-memory events store — unit tests + e2e-api-server without D1.
 */
export class MemoryEventsStore implements EventsStore {
  private orgs = new Map<string, OrgRow>();
  private events = new Map<string, EventRow>();
  private eventsBySlug = new Map<string, string>();
  private rooms = new Map<string, RoomRow>();
  private tracks = new Map<string, TrackRow>();

  private roomKey(eventId: string, roomId: string): string {
    return `${eventId}\0${roomId}`;
  }

  private trackKey(eventId: string, trackId: string): string {
    return `${eventId}\0${trackId}`;
  }

  async ensureOrg(input: { id?: string; name?: string } = {}): Promise<OrgRow> {
    const id = input.id ?? DEFAULT_ORG_ID;
    const existing = this.orgs.get(id);
    if (existing) return existing;
    const now = new Date().toISOString();
    const row: OrgRow = {
      id,
      name: input.name ?? "Dogfood Org",
      createdAt: now,
      updatedAt: now,
    };
    this.orgs.set(id, row);
    return row;
  }

  async findEventById(id: string): Promise<EventRow | null> {
    return this.events.get(id) ?? null;
  }

  async findEventBySlug(slug: string): Promise<EventRow | null> {
    const id = this.eventsBySlug.get(slug);
    if (!id) return null;
    return this.events.get(id) ?? null;
  }

  async listEventsByIds(ids: string[]): Promise<EventRow[]> {
    const out: EventRow[] = [];
    for (const id of ids) {
      const row = this.events.get(id);
      if (row) out.push(row);
    }
    return out;
  }

  async listEventsByOrgId(orgId: string): Promise<EventRow[]> {
    return [...this.events.values()].filter((r) => r.orgId === orgId);
  }

  async insertEvent(row: EventRow): Promise<EventRow> {
    this.events.set(row.id, row);
    this.eventsBySlug.set(row.slug, row.id);
    return row;
  }

  async updateEvent(row: EventRow, expectedVersion: number): Promise<boolean> {
    const prev = this.events.get(row.id);
    if (!prev || prev.version !== expectedVersion) return false;
    if (prev.slug !== row.slug) {
      this.eventsBySlug.delete(prev.slug);
    }
    this.events.set(row.id, row);
    this.eventsBySlug.set(row.slug, row.id);
    return true;
  }

  async deleteEvent(id: string): Promise<boolean> {
    const prev = this.events.get(id);
    if (!prev) return false;
    this.events.delete(id);
    this.eventsBySlug.delete(prev.slug);
    return true;
  }

  /**
   * Memory: apply event + sibling-store bridges as one logical unit.
   * On any bridge failure, reverse prior steps so no partial commit remains.
   */
  async createEventUnit(
    unit: CreateEventUnit,
    bridges: EventUnitBridges,
  ): Promise<void> {
    await this.insertEvent(unit.event);
    let membershipOk = false;
    let outboxOk = false;
    try {
      await bridges.insertMembership(unit.membership);
      membershipOk = true;
      if (unit.outbox && bridges.insertOutbox) {
        await bridges.insertOutbox(unit.outbox);
        outboxOk = true;
      }
      await bridges.insertAudit(unit.audit);
    } catch (err) {
      if (outboxOk && unit.outbox && bridges.deleteOutbox) {
        await bridges.deleteOutbox(unit.outbox.id);
      }
      if (membershipOk) {
        await bridges.deleteMembership(
          unit.membership.eventId,
          unit.membership.userId,
        );
      }
      await this.deleteEvent(unit.event.id);
      throw err;
    }
  }

  async updateEventUnit(
    unit: UpdateEventUnit,
    bridges: EventUnitBridges,
  ): Promise<boolean> {
    const prev = this.events.get(unit.event.id);
    if (!prev || prev.version !== unit.expectedVersion) return false;
    const ok = await this.updateEvent(unit.event, unit.expectedVersion);
    if (!ok) return false;
    let outboxOk = false;
    try {
      if (unit.outbox && bridges.insertOutbox) {
        await bridges.insertOutbox(unit.outbox);
        outboxOk = true;
      }
      await bridges.insertAudit(unit.audit);
    } catch (err) {
      // Restore prior version so failed unit leaves SoR unchanged.
      this.events.set(prev.id, prev);
      this.eventsBySlug.set(prev.slug, prev.id);
      if (outboxOk && unit.outbox && bridges.deleteOutbox) {
        await bridges.deleteOutbox(unit.outbox.id);
      }
      throw err;
    }
    return true;
  }

  async findRoom(eventId: string, roomId: string): Promise<RoomRow | null> {
    return this.rooms.get(this.roomKey(eventId, roomId)) ?? null;
  }

  async listRooms(eventId: string): Promise<RoomRow[]> {
    return [...this.rooms.values()].filter((r) => r.eventId === eventId);
  }

  async upsertRoom(row: RoomRow, expectedVersion?: number): Promise<boolean> {
    const key = this.roomKey(row.eventId, row.id);
    const prev = this.rooms.get(key);
    if (prev) {
      if (expectedVersion !== undefined && prev.version !== expectedVersion) {
        return false;
      }
      if (expectedVersion === undefined && prev.version !== row.version - 1) {
        // Defend against lost updates when callers omit expectedVersion but bump version.
        return false;
      }
    }
    this.rooms.set(key, row);
    return true;
  }

  async findTrack(eventId: string, trackId: string): Promise<TrackRow | null> {
    return this.tracks.get(this.trackKey(eventId, trackId)) ?? null;
  }

  async listTracks(eventId: string): Promise<TrackRow[]> {
    return [...this.tracks.values()].filter((t) => t.eventId === eventId);
  }

  async upsertTrack(row: TrackRow, expectedVersion?: number): Promise<boolean> {
    const key = this.trackKey(row.eventId, row.id);
    const prev = this.tracks.get(key);
    if (prev) {
      if (expectedVersion !== undefined && prev.version !== expectedVersion) {
        return false;
      }
      if (expectedVersion === undefined && prev.version !== row.version - 1) {
        return false;
      }
    }
    this.tracks.set(key, row);
    return true;
  }
}

/**
 * D1-backed events store — production Worker SoR (binding name: DB).
 */
export class D1EventsStore implements EventsStore {
  private readonly db: SpeakerOpsDb;

  constructor(d1: D1DatabaseLike) {
    this.db = createDb(d1);
  }

  async ensureOrg(input: { id?: string; name?: string } = {}): Promise<OrgRow> {
    const id = input.id ?? DEFAULT_ORG_ID;
    const existing = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, id))
      .limit(1);
    if (existing[0]) {
      return {
        id: existing[0].id,
        name: existing[0].name,
        createdAt: existing[0].createdAt,
        updatedAt: existing[0].updatedAt,
      };
    }
    const now = new Date().toISOString();
    const row: OrgRow = {
      id,
      name: input.name ?? "Dogfood Org",
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(organizations).values({
      id: row.id,
      name: row.name,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
    return row;
  }

  async findEventById(id: string): Promise<EventRow | null> {
    const rows = await this.db
      .select()
      .from(events)
      .where(eq(events.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return mapEvent(row);
  }

  async findEventBySlug(slug: string): Promise<EventRow | null> {
    const rows = await this.db
      .select()
      .from(events)
      .where(eq(events.slug, slug))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return mapEvent(row);
  }

  async listEventsByIds(ids: string[]): Promise<EventRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select()
      .from(events)
      .where(inArray(events.id, ids));
    return rows.map(mapEvent);
  }

  async listEventsByOrgId(orgId: string): Promise<EventRow[]> {
    const rows = await this.db
      .select()
      .from(events)
      .where(eq(events.orgId, orgId));
    return rows.map(mapEvent);
  }

  async insertEvent(row: EventRow): Promise<EventRow> {
    await this.db.insert(events).values({
      id: row.id,
      orgId: row.orgId,
      name: row.name,
      slug: row.slug,
      timezone: row.timezone,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      settingsJson: row.settingsJson,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      version: row.version,
    });
    return row;
  }

  async updateEvent(row: EventRow, expectedVersion: number): Promise<boolean> {
    const result = await this.db
      .update(events)
      .set({
        orgId: row.orgId,
        name: row.name,
        slug: row.slug,
        timezone: row.timezone,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        settingsJson: row.settingsJson,
        updatedAt: row.updatedAt,
        version: row.version,
      })
      .where(and(eq(events.id, row.id), eq(events.version, expectedVersion)));
    return d1Changes(result) > 0;
  }

  async deleteEvent(id: string): Promise<boolean> {
    const result = await this.db.delete(events).where(eq(events.id, id));
    return d1Changes(result) > 0;
  }

  /**
   * Single D1 batch: event + membership + outbox? + audit (E7 transactional outbox).
   * Bridges are ignored — tables are written directly so AuthStore/AirtableStore
   * (same D1 binding) observe the committed unit.
   */
  async createEventUnit(
    unit: CreateEventUnit,
    _bridges: EventUnitBridges,
  ): Promise<void> {
    const e = unit.event;
    const m = unit.membership;
    const a = unit.audit;
    const eventInsert = this.db.insert(events).values({
      id: e.id,
      orgId: e.orgId,
      name: e.name,
      slug: e.slug,
      timezone: e.timezone,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      settingsJson: e.settingsJson,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      version: e.version,
    });
    const membershipInsert = this.db.insert(eventMemberships).values({
      id: m.id,
      eventId: m.eventId,
      userId: m.userId,
      role: m.role,
      createdAt: m.createdAt,
    });
    const auditInsert = this.db.insert(auditEvents).values({
      id: a.id,
      eventId: a.eventId,
      actorType: a.actorType,
      actorId: a.actorId,
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId,
      beforeJson: a.beforeJson,
      afterJson: a.afterJson,
      correlationId: a.correlationId,
      createdAt: a.createdAt,
    });
    if (unit.outbox) {
      const o = unit.outbox;
      const outboxInsert = this.db.insert(outboxEvents).values({
        id: o.id,
        topic: o.topic,
        payloadJson: o.payloadJson,
        createdAt: o.createdAt,
        processedAt: null,
        attempts: 0,
        lastError: null,
      });
      await this.db.batch([
        eventInsert,
        membershipInsert,
        outboxInsert,
        auditInsert,
      ]);
    } else {
      await this.db.batch([eventInsert, membershipInsert, auditInsert]);
    }
  }

  /**
   * Single D1 batch: CAS event update + outbox? + audit (E7).
   *
   * Side effects are gated on a *per-attempt transition stamp* written into
   * updated_at by this UPDATE, then restored to the canonical ISO value.
   * Gating only on the target version is insufficient: a concurrent writer
   * can advance expectedVersion→target before this batch runs; the UPDATE
   * then changes 0 rows but version already equals the target, so INSERT…
   * SELECT would still commit the loser's outbox/audit. The unique stamp
   * is only visible when *this* CAS won (same pattern as schedule/comms).
   */
  async updateEventUnit(
    unit: UpdateEventUnit,
    _bridges: EventUnitBridges,
  ): Promise<boolean> {
    const e = unit.event;
    const a = unit.audit;

    // Guaranteed-unique per attempt — not wall-clock ms alone.
    // Used only as an INSERT…SELECT gate; restored to e.updatedAt below.
    const transitionToken = uuidv7();
    const transitionStamp = `${e.updatedAt}#${transitionToken}`;

    const eventUpdate = this.db
      .update(events)
      .set({
        orgId: e.orgId,
        name: e.name,
        slug: e.slug,
        timezone: e.timezone,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        settingsJson: e.settingsJson,
        updatedAt: transitionStamp,
        version: e.version,
      })
      .where(and(eq(events.id, e.id), eq(events.version, unit.expectedVersion)));

    // Transition-unique gate: only *this* UPDATE stamp is visible to inserts.
    const casWon = and(
      eq(events.id, e.id),
      eq(events.version, e.version),
      eq(events.updatedAt, transitionStamp),
    );

    const auditInsert = this.db.insert(auditEvents).select(
      this.db
        .select({
          id: sql<string>`${a.id}`.as("id"),
          eventId: sql<string | null>`${a.eventId}`.as("event_id"),
          actorType: sql<string>`${a.actorType}`.as("actor_type"),
          actorId: sql<string>`${a.actorId}`.as("actor_id"),
          action: sql<string>`${a.action}`.as("action"),
          entityType: sql<string>`${a.entityType}`.as("entity_type"),
          entityId: sql<string>`${a.entityId}`.as("entity_id"),
          beforeJson: sql<string | null>`${a.beforeJson}`.as("before_json"),
          afterJson: sql<string | null>`${a.afterJson}`.as("after_json"),
          correlationId: sql<string>`${a.correlationId}`.as("correlation_id"),
          createdAt: sql<string>`${a.createdAt}`.as("created_at"),
        })
        .from(events)
        .where(casWon)
        .limit(1),
    );

    // Restore canonical ISO updatedAt (do not leak transition marker in DTOs).
    const restoreUpdatedAt = this.db
      .update(events)
      .set({ updatedAt: e.updatedAt })
      .where(casWon);

    let results: unknown[];
    if (unit.outbox) {
      const o = unit.outbox;
      const outboxInsert = this.db.insert(outboxEvents).select(
        this.db
          .select({
            id: sql<string>`${o.id}`.as("id"),
            topic: sql<string>`${o.topic}`.as("topic"),
            payloadJson: sql<string>`${o.payloadJson}`.as("payload_json"),
            createdAt: sql<string>`${o.createdAt}`.as("created_at"),
            processedAt: sql<string | null>`${null}`.as("processed_at"),
            attempts: sql<number>`${0}`.as("attempts"),
            lastError: sql<string | null>`${null}`.as("last_error"),
          })
          .from(events)
          .where(casWon)
          .limit(1),
      );
      results = await this.db.batch([
        eventUpdate,
        outboxInsert,
        auditInsert,
        restoreUpdatedAt,
      ]);
    } else {
      results = await this.db.batch([
        eventUpdate,
        auditInsert,
        restoreUpdatedAt,
      ]);
    }
    return d1Changes(results[0]) > 0;
  }

  async findRoom(eventId: string, roomId: string): Promise<RoomRow | null> {
    const rows = await this.db
      .select()
      .from(rooms)
      .where(and(eq(rooms.eventId, eventId), eq(rooms.id, roomId)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return mapRoom(row);
  }

  async listRooms(eventId: string): Promise<RoomRow[]> {
    const rows = await this.db
      .select()
      .from(rooms)
      .where(eq(rooms.eventId, eventId));
    return rows.map(mapRoom);
  }

  async upsertRoom(row: RoomRow, expectedVersion?: number): Promise<boolean> {
    const existing = await this.findRoom(row.eventId, row.id);
    if (existing) {
      const prior =
        expectedVersion !== undefined ? expectedVersion : row.version - 1;
      const result = await this.db
        .update(rooms)
        .set({
          name: row.name,
          capacity: row.capacity,
          updatedAt: row.updatedAt,
          version: row.version,
        })
        .where(
          and(
            eq(rooms.eventId, row.eventId),
            eq(rooms.id, row.id),
            eq(rooms.version, prior),
          ),
        );
      return d1Changes(result) > 0;
    }
    await this.db.insert(rooms).values({
      id: row.id,
      eventId: row.eventId,
      name: row.name,
      capacity: row.capacity,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      version: row.version,
    });
    return true;
  }

  async findTrack(eventId: string, trackId: string): Promise<TrackRow | null> {
    const rows = await this.db
      .select()
      .from(tracks)
      .where(and(eq(tracks.eventId, eventId), eq(tracks.id, trackId)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return mapTrack(row);
  }

  async listTracks(eventId: string): Promise<TrackRow[]> {
    const rows = await this.db
      .select()
      .from(tracks)
      .where(eq(tracks.eventId, eventId));
    return rows.map(mapTrack);
  }

  async upsertTrack(row: TrackRow, expectedVersion?: number): Promise<boolean> {
    const existing = await this.findTrack(row.eventId, row.id);
    if (existing) {
      const prior =
        expectedVersion !== undefined ? expectedVersion : row.version - 1;
      const result = await this.db
        .update(tracks)
        .set({
          name: row.name,
          color: row.color,
          updatedAt: row.updatedAt,
          version: row.version,
        })
        .where(
          and(
            eq(tracks.eventId, row.eventId),
            eq(tracks.id, row.id),
            eq(tracks.version, prior),
          ),
        );
      return d1Changes(result) > 0;
    }
    await this.db.insert(tracks).values({
      id: row.id,
      eventId: row.eventId,
      name: row.name,
      color: row.color,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      version: row.version,
    });
    return true;
  }
}

function mapEvent(row: {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  timezone: string;
  startsAt: string | null;
  endsAt: string | null;
  settingsJson: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}): EventRow {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    slug: row.slug,
    timezone: row.timezone,
    startsAt: row.startsAt ?? null,
    endsAt: row.endsAt ?? null,
    settingsJson: row.settingsJson ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

function mapRoom(row: {
  id: string;
  eventId: string;
  name: string;
  capacity: number | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}): RoomRow {
  return {
    id: row.id,
    eventId: row.eventId,
    name: row.name,
    capacity: row.capacity ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

function mapTrack(row: {
  id: string;
  eventId: string;
  name: string;
  color: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}): TrackRow {
  return {
    id: row.id,
    eventId: row.eventId,
    name: row.name,
    color: row.color ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

/** Helper to mint a new event id (tests / commands). */
export function newEventId(): string {
  return uuidv7();
}
