/**
 * Events / rooms / tracks persistence (section 2.3).
 *
 * MemoryEventsStore is the test / local e2e default (no D1 required).
 * All event-owned queries take eventId (E2).
 */
import { uuidv7, DEFAULT_ORG_ID } from "@speakerops/shared";

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

/** Helper to mint a new event id (tests / commands). */
export function newEventId(): string {
  return uuidv7();
}
