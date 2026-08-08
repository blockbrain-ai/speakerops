/**
 * Event / Room / Track domain commands (section 2.3).
 *
 * Event.Create / Event.Update / Event.List / Event.Get
 * Room.Upsert / Room.List / Room.Get
 * Track.Upsert / Track.List / Track.Get
 */
import {
  uuidv7,
  DEFAULT_ORG_ID,
  AIRTABLE_OUTBOX_TOPIC,
  type EventCreateBody,
  type EventUpdateBody,
  type RoomUpsertBody,
  type TrackUpsertBody,
  type AirtableProjectPayload,
} from "@speakerops/shared";
import type { AuthStore } from "../auth/store.js";
import type { AirtableStore } from "../airtable/store.js";
import {
  type EventsStore,
  type EventRow,
  type RoomRow,
  type TrackRow,
  type EventUnitBridges,
  type EventUnitOutbox,
  slugifyName,
} from "./store.js";

export type EventCommandDeps = {
  events: EventsStore;
  auth: AuthStore;
  /**
   * Optional Airtable projection store (section 7.3 / S-AIRTABLE).
   * When set, Event.Create/Update enqueue airtable.project outbox rows.
   * Request path never calls Airtable HTTP (E7); pause survival when key unset.
   */
  airtable?: AirtableStore;
};

export type CreateEventInput = EventCreateBody & {
  actorUserId: string;
  /** Audit actor type; API-key writes must use "api_key" (E3). */
  actorType?: "user" | "api_key";
  /** Audit actor id; defaults to actorUserId. API keys pass the key id. */
  actorId?: string;
  correlationId: string;
};

export type UpdateEventInput = EventUpdateBody & {
  eventId: string;
  actorUserId: string;
  actorType?: "user" | "api_key";
  actorId?: string;
  correlationId: string;
};

export type UpsertRoomInput = RoomUpsertBody & {
  eventId: string;
  roomId: string;
  actorUserId: string;
  actorType?: "user" | "api_key";
  actorId?: string;
  correlationId: string;
};

export type UpsertTrackInput = TrackUpsertBody & {
  eventId: string;
  trackId: string;
  actorUserId: string;
  actorType?: "user" | "api_key";
  actorId?: string;
  correlationId: string;
};

function auditActor(input: {
  actorUserId: string;
  actorType?: "user" | "api_key";
  actorId?: string;
}): { actorType: "user" | "api_key"; actorId: string } {
  return {
    actorType: input.actorType ?? "user",
    actorId: input.actorId ?? input.actorUserId,
  };
}

export type CommandOk<T> = { ok: true; value: T };
export type CommandErr = {
  ok: false;
  status: 400 | 404 | 409;
  error: string;
  code: string;
  details?: unknown;
};

function toEventDto(row: EventRow) {
  return {
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
  };
}

function toRoomDto(row: RoomRow) {
  return {
    id: row.id,
    eventId: row.eventId,
    name: row.name,
    capacity: row.capacity,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

function toTrackDto(row: TrackRow) {
  return {
    id: row.id,
    eventId: row.eventId,
    name: row.name,
    color: row.color,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

async function uniqueSlug(
  events: EventsStore,
  desired: string,
): Promise<string> {
  let slug = desired;
  let n = 0;
  while (await events.findEventBySlug(slug)) {
    n += 1;
    slug = `${desired}-${n}`;
  }
  return slug;
}

/** Build airtable.project outbox payload without inserting (unit commits it). */
function buildAirtableEventOutbox(input: {
  eventId: string;
  internalId: string;
  sourceVersion: number;
  name: string;
  slug: string;
  timezone: string;
  startsAt: string | null;
  endsAt: string | null;
  correlationId: string;
}): EventUnitOutbox {
  const payload: AirtableProjectPayload = {
    eventId: input.eventId,
    entityType: "event",
    internalId: input.internalId,
    sourceVersion: input.sourceVersion,
    fields: {
      name: input.name,
      slug: input.slug,
      timezone: input.timezone,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      // I16: internal_id always present in projected fields
      internal_id: input.internalId,
    },
    correlationId: input.correlationId,
  };
  return {
    id: uuidv7(),
    topic: AIRTABLE_OUTBOX_TOPIC,
    payloadJson: JSON.stringify(payload),
    createdAt: new Date().toISOString(),
  };
}

function eventUnitBridges(deps: EventCommandDeps): EventUnitBridges {
  return {
    insertMembership: async (m) => {
      await deps.auth.upsertMembership({
        eventId: m.eventId,
        userId: m.userId,
        role: m.role as "admin",
      });
    },
    deleteMembership: async (eventId, userId) => {
      await deps.auth.deleteMembership(eventId, userId);
    },
    insertOutbox: deps.airtable
      ? async (o) => {
          await deps.airtable!.insertOutbox({
            id: o.id,
            topic: o.topic,
            payloadJson: o.payloadJson,
            createdAt: o.createdAt,
            processedAt: null,
            attempts: 0,
            lastError: null,
          });
        }
      : undefined,
    deleteOutbox: deps.airtable
      ? async (id) => {
          await deps.airtable!.deleteUnprocessedOutbox(id);
        }
      : undefined,
    insertAudit: async (a) => {
      await deps.auth.insertAudit({
        id: a.id,
        eventId: a.eventId,
        actorType: a.actorType as "user" | "api_key" | "system",
        actorId: a.actorId,
        action: a.action,
        entityType: a.entityType,
        entityId: a.entityId,
        beforeJson: a.beforeJson,
        afterJson: a.afterJson,
        correlationId: a.correlationId,
        createdAt: a.createdAt,
      });
    },
  };
}

/**
 * Event.Create — admin creates event; grants creator admin membership.
 *
 * E7 transactional outbox unit: event + membership + audit + airtable.project
 * committed via EventsStore.createEventUnit (D1 batch / Memory bridges).
 */
export async function createEvent(
  deps: EventCommandDeps,
  input: CreateEventInput,
): Promise<CommandOk<{ event: ReturnType<typeof toEventDto> }> | CommandErr> {
  const org = await deps.events.ensureOrg({
    id: input.orgId ?? DEFAULT_ORG_ID,
  });
  const now = new Date().toISOString();
  const baseSlug = input.slug ?? slugifyName(input.name);
  const slug = await uniqueSlug(deps.events, baseSlug);
  const id = uuidv7();
  const actor = auditActor(input);

  const row: EventRow = {
    id,
    orgId: org.id,
    name: input.name.trim(),
    slug,
    timezone: input.timezone,
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
    settingsJson: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  const outbox = deps.airtable
    ? buildAirtableEventOutbox({
        eventId: id,
        internalId: id,
        sourceVersion: row.version,
        name: row.name,
        slug: row.slug,
        timezone: row.timezone,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        correlationId: input.correlationId,
      })
    : null;

  await deps.events.createEventUnit(
    {
      event: row,
      membership: {
        id: uuidv7(),
        eventId: id,
        userId: input.actorUserId,
        role: "admin",
        createdAt: now,
      },
      outbox,
      audit: {
        id: uuidv7(),
        eventId: id,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: "Event.Create",
        entityType: "event",
        entityId: id,
        beforeJson: null,
        afterJson: JSON.stringify({
          name: row.name,
          timezone: row.timezone,
          slug: row.slug,
        }),
        correlationId: input.correlationId,
        createdAt: now,
      },
    },
    eventUnitBridges(deps),
  );

  return { ok: true, value: { event: toEventDto(row) } };
}

/**
 * Event.Update — optimistic concurrency via expectedVersion.
 *
 * E7 transactional outbox unit: event CAS + audit + airtable.project
 * committed via EventsStore.updateEventUnit (D1 batch / Memory bridges).
 */
export async function updateEvent(
  deps: EventCommandDeps,
  input: UpdateEventInput,
): Promise<CommandOk<{ event: ReturnType<typeof toEventDto> }> | CommandErr> {
  const existing = await deps.events.findEventById(input.eventId);
  if (!existing) {
    return {
      ok: false,
      status: 404,
      error: "Not found",
      code: "NOT_FOUND",
    };
  }

  if (existing.version !== input.expectedVersion) {
    return {
      ok: false,
      status: 409,
      error: "Version conflict",
      code: "CONFLICT",
      details: { expectedVersion: input.expectedVersion, actual: existing.version },
    };
  }

  const now = new Date().toISOString();
  const actor = auditActor(input);
  const next: EventRow = {
    ...existing,
    name: input.name !== undefined ? input.name.trim() : existing.name,
    timezone: input.timezone !== undefined ? input.timezone : existing.timezone,
    startsAt:
      input.startsAt !== undefined ? input.startsAt : existing.startsAt,
    endsAt: input.endsAt !== undefined ? input.endsAt : existing.endsAt,
    settingsJson:
      input.settingsJson !== undefined
        ? input.settingsJson
        : existing.settingsJson,
    updatedAt: now,
    version: existing.version + 1,
  };

  const outbox = deps.airtable
    ? buildAirtableEventOutbox({
        eventId: next.id,
        internalId: next.id,
        sourceVersion: next.version,
        name: next.name,
        slug: next.slug,
        timezone: next.timezone,
        startsAt: next.startsAt,
        endsAt: next.endsAt,
        correlationId: input.correlationId,
      })
    : null;

  const updated = await deps.events.updateEventUnit(
    {
      event: next,
      expectedVersion: input.expectedVersion,
      outbox,
      audit: {
        id: uuidv7(),
        eventId: next.id,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: "Event.Update",
        entityType: "event",
        entityId: next.id,
        beforeJson: JSON.stringify({
          name: existing.name,
          timezone: existing.timezone,
          startsAt: existing.startsAt,
          endsAt: existing.endsAt,
          version: existing.version,
        }),
        afterJson: JSON.stringify({
          name: next.name,
          timezone: next.timezone,
          startsAt: next.startsAt,
          endsAt: next.endsAt,
          version: next.version,
        }),
        correlationId: input.correlationId,
        createdAt: now,
      },
    },
    eventUnitBridges(deps),
  );

  if (!updated) {
    const latest = await deps.events.findEventById(input.eventId);
    return {
      ok: false,
      status: 409,
      error: "Version conflict",
      code: "CONFLICT",
      details: {
        expectedVersion: input.expectedVersion,
        actual: latest?.version ?? existing.version,
      },
    };
  }

  return { ok: true, value: { event: toEventDto(next) } };
}

/**
 * Event.List — events where user has admin membership and row exists.
 * Membership without row yields a synthetic minimal event (bootstrap id).
 */
export async function listEventsForAdmin(
  deps: EventCommandDeps,
  userId: string,
): Promise<{ events: ReturnType<typeof toEventDto>[] }> {
  const memberships = await deps.auth.listMembershipsForUser(userId);
  const adminIds = memberships
    .filter((m) => m.role === "admin")
    .map((m) => m.eventId);

  const rows = await deps.events.listEventsByIds(adminIds);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const events: ReturnType<typeof toEventDto>[] = [];

  for (const id of adminIds) {
    const row = byId.get(id);
    if (row) {
      events.push(toEventDto(row));
    } else {
      // Bootstrap membership without Event.Create yet — surface id for switcher
      const now = new Date().toISOString();
      events.push({
        id,
        orgId: DEFAULT_ORG_ID,
        name: id,
        slug: id,
        timezone: "UTC",
        startsAt: null,
        endsAt: null,
        settingsJson: null,
        createdAt: now,
        updatedAt: now,
        version: 1,
      });
    }
  }

  return { events };
}

/**
 * Event.List for org-scoped Bearer keys — all events in apiKey.orgId.
 * Does not filter by the key creator's admin memberships (E2): unbound
 * organization automation must list events it is authorized to access.
 */
export async function listEventsByOrg(
  deps: EventCommandDeps,
  orgId: string,
): Promise<{ events: ReturnType<typeof toEventDto>[] }> {
  const rows = await deps.events.listEventsByOrgId(orgId);
  return { events: rows.map(toEventDto) };
}

export async function getEvent(
  deps: EventCommandDeps,
  eventId: string,
): Promise<CommandOk<{ event: ReturnType<typeof toEventDto> }> | CommandErr> {
  const row = await deps.events.findEventById(eventId);
  if (!row) {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }
  return { ok: true, value: { event: toEventDto(row) } };
}

export async function listRooms(
  deps: EventCommandDeps,
  eventId: string,
): Promise<{ rooms: ReturnType<typeof toRoomDto>[] }> {
  const rows = await deps.events.listRooms(eventId);
  return { rooms: rows.map(toRoomDto) };
}

export async function getRoom(
  deps: EventCommandDeps,
  eventId: string,
  roomId: string,
): Promise<CommandOk<{ room: ReturnType<typeof toRoomDto> }> | CommandErr> {
  const row = await deps.events.findRoom(eventId, roomId);
  if (!row) {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }
  return { ok: true, value: { room: toRoomDto(row) } };
}

export async function upsertRoom(
  deps: EventCommandDeps,
  input: UpsertRoomInput,
): Promise<CommandOk<{ room: ReturnType<typeof toRoomDto> }> | CommandErr> {
  const existing = await deps.events.findRoom(input.eventId, input.roomId);
  const now = new Date().toISOString();

  if (existing && input.expectedVersion !== undefined) {
    if (existing.version !== input.expectedVersion) {
      return {
        ok: false,
        status: 409,
        error: "Version conflict",
        code: "CONFLICT",
        details: {
          expectedVersion: input.expectedVersion,
          actual: existing.version,
        },
      };
    }
  }

  const row: RoomRow = existing
    ? {
        ...existing,
        name: input.name.trim(),
        capacity:
          input.capacity !== undefined ? input.capacity : existing.capacity,
        updatedAt: now,
        version: existing.version + 1,
      }
    : {
        id: input.roomId,
        eventId: input.eventId,
        name: input.name.trim(),
        capacity: input.capacity ?? null,
        createdAt: now,
        updatedAt: now,
        version: 1,
      };

  const written = await deps.events.upsertRoom(
    row,
    existing ? (input.expectedVersion ?? existing.version) : undefined,
  );
  if (!written) {
    const latest = await deps.events.findRoom(input.eventId, input.roomId);
    return {
      ok: false,
      status: 409,
      error: "Version conflict",
      code: "CONFLICT",
      details: {
        expectedVersion: input.expectedVersion ?? existing?.version,
        actual: latest?.version ?? existing?.version,
      },
    };
  }

  const actor = auditActor(input);
  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: input.eventId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    action: "Room.Upsert",
    entityType: "room",
    entityId: row.id,
    beforeJson: existing
      ? JSON.stringify({ name: existing.name, version: existing.version })
      : null,
    afterJson: JSON.stringify({
      name: row.name,
      capacity: row.capacity,
      version: row.version,
    }),
    correlationId: input.correlationId,
    createdAt: now,
  });

  return { ok: true, value: { room: toRoomDto(row) } };
}

export async function listTracks(
  deps: EventCommandDeps,
  eventId: string,
): Promise<{ tracks: ReturnType<typeof toTrackDto>[] }> {
  const rows = await deps.events.listTracks(eventId);
  return { tracks: rows.map(toTrackDto) };
}

export async function getTrack(
  deps: EventCommandDeps,
  eventId: string,
  trackId: string,
): Promise<CommandOk<{ track: ReturnType<typeof toTrackDto> }> | CommandErr> {
  const row = await deps.events.findTrack(eventId, trackId);
  if (!row) {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }
  return { ok: true, value: { track: toTrackDto(row) } };
}

export async function upsertTrack(
  deps: EventCommandDeps,
  input: UpsertTrackInput,
): Promise<CommandOk<{ track: ReturnType<typeof toTrackDto> }> | CommandErr> {
  const existing = await deps.events.findTrack(input.eventId, input.trackId);
  const now = new Date().toISOString();

  if (existing && input.expectedVersion !== undefined) {
    if (existing.version !== input.expectedVersion) {
      return {
        ok: false,
        status: 409,
        error: "Version conflict",
        code: "CONFLICT",
        details: {
          expectedVersion: input.expectedVersion,
          actual: existing.version,
        },
      };
    }
  }

  const row: TrackRow = existing
    ? {
        ...existing,
        name: input.name.trim(),
        color: input.color !== undefined ? input.color : existing.color,
        updatedAt: now,
        version: existing.version + 1,
      }
    : {
        id: input.trackId,
        eventId: input.eventId,
        name: input.name.trim(),
        color: input.color ?? null,
        createdAt: now,
        updatedAt: now,
        version: 1,
      };

  const written = await deps.events.upsertTrack(
    row,
    existing ? (input.expectedVersion ?? existing.version) : undefined,
  );
  if (!written) {
    const latest = await deps.events.findTrack(input.eventId, input.trackId);
    return {
      ok: false,
      status: 409,
      error: "Version conflict",
      code: "CONFLICT",
      details: {
        expectedVersion: input.expectedVersion ?? existing?.version,
        actual: latest?.version ?? existing?.version,
      },
    };
  }

  const actor = auditActor(input);
  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: input.eventId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    action: "Track.Upsert",
    entityType: "track",
    entityId: row.id,
    beforeJson: existing
      ? JSON.stringify({ name: existing.name, version: existing.version })
      : null,
    afterJson: JSON.stringify({
      name: row.name,
      color: row.color,
      version: row.version,
    }),
    correlationId: input.correlationId,
    createdAt: now,
  });

  return { ok: true, value: { track: toTrackDto(row) } };
}
