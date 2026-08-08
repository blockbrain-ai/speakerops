/**
 * Events / rooms / tracks persistence (section 2.3).
 *
 * MemoryEventsStore is the test / local e2e default (no D1 required).
 * D1EventsStore wraps the Worker DB binding for production (E1 SoR).
 * All event-owned queries take eventId (E2).
 */
import { eq, and, inArray } from "drizzle-orm";
import { uuidv7, DEFAULT_ORG_ID } from "@speakerops/shared";
import {
  createDb,
  type D1DatabaseLike,
  type SpeakerOpsDb,
  organizations,
  events,
  rooms,
  tracks,
} from "@speakerops/db";

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

export type EventsStore = {
  ensureOrg(input?: { id?: string; name?: string }): Promise<OrgRow>;
  findEventById(id: string): Promise<EventRow | null>;
  findEventBySlug(slug: string): Promise<EventRow | null>;
  listEventsByIds(ids: string[]): Promise<EventRow[]>;
  insertEvent(row: EventRow): Promise<EventRow>;
  updateEvent(row: EventRow): Promise<EventRow>;
  findRoom(eventId: string, roomId: string): Promise<RoomRow | null>;
  listRooms(eventId: string): Promise<RoomRow[]>;
  upsertRoom(row: RoomRow): Promise<RoomRow>;
  findTrack(eventId: string, trackId: string): Promise<TrackRow | null>;
  listTracks(eventId: string): Promise<TrackRow[]>;
  upsertTrack(row: TrackRow): Promise<TrackRow>;
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

  async insertEvent(row: EventRow): Promise<EventRow> {
    this.events.set(row.id, row);
    this.eventsBySlug.set(row.slug, row.id);
    return row;
  }

  async updateEvent(row: EventRow): Promise<EventRow> {
    const prev = this.events.get(row.id);
    if (prev && prev.slug !== row.slug) {
      this.eventsBySlug.delete(prev.slug);
    }
    this.events.set(row.id, row);
    this.eventsBySlug.set(row.slug, row.id);
    return row;
  }

  async findRoom(eventId: string, roomId: string): Promise<RoomRow | null> {
    return this.rooms.get(this.roomKey(eventId, roomId)) ?? null;
  }

  async listRooms(eventId: string): Promise<RoomRow[]> {
    return [...this.rooms.values()].filter((r) => r.eventId === eventId);
  }

  async upsertRoom(row: RoomRow): Promise<RoomRow> {
    this.rooms.set(this.roomKey(row.eventId, row.id), row);
    return row;
  }

  async findTrack(eventId: string, trackId: string): Promise<TrackRow | null> {
    return this.tracks.get(this.trackKey(eventId, trackId)) ?? null;
  }

  async listTracks(eventId: string): Promise<TrackRow[]> {
    return [...this.tracks.values()].filter((t) => t.eventId === eventId);
  }

  async upsertTrack(row: TrackRow): Promise<TrackRow> {
    this.tracks.set(this.trackKey(row.eventId, row.id), row);
    return row;
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

  async updateEvent(row: EventRow): Promise<EventRow> {
    await this.db
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
      .where(eq(events.id, row.id));
    return row;
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

  async upsertRoom(row: RoomRow): Promise<RoomRow> {
    const existing = await this.findRoom(row.eventId, row.id);
    if (existing) {
      await this.db
        .update(rooms)
        .set({
          name: row.name,
          capacity: row.capacity,
          updatedAt: row.updatedAt,
          version: row.version,
        })
        .where(and(eq(rooms.eventId, row.eventId), eq(rooms.id, row.id)));
    } else {
      await this.db.insert(rooms).values({
        id: row.id,
        eventId: row.eventId,
        name: row.name,
        capacity: row.capacity,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        version: row.version,
      });
    }
    return row;
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

  async upsertTrack(row: TrackRow): Promise<TrackRow> {
    const existing = await this.findTrack(row.eventId, row.id);
    if (existing) {
      await this.db
        .update(tracks)
        .set({
          name: row.name,
          color: row.color,
          updatedAt: row.updatedAt,
          version: row.version,
        })
        .where(and(eq(tracks.eventId, row.eventId), eq(tracks.id, row.id)));
    } else {
      await this.db.insert(tracks).values({
        id: row.id,
        eventId: row.eventId,
        name: row.name,
        color: row.color,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        version: row.version,
      });
    }
    return row;
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
