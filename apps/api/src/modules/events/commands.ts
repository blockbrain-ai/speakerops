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
  type EventCreateBody,
  type EventUpdateBody,
  type RoomUpsertBody,
  type TrackUpsertBody,
} from "@speakerops/shared";
import type { AuthStore } from "../auth/store.js";
import type { AirtableStore } from "../airtable/store.js";
import { enqueueAirtableProjection } from "../airtable/enqueue.js";
import {
  type EventsStore,
  type EventRow,
  type RoomRow,
  type TrackRow,
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

/**
 * Event.Create — admin creates event; grants creator admin membership.
 *
 * E7 transactional outbox unit: event + membership + audit + airtable.project.
 * On side-effect failure, compensates the event insert so a failed request
 * never leaves a durable event change without a projection outbox row.
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

  await deps.events.insertEvent(row);
  let outboxId: string | null = null;
  try {
    // Creator is admin of the new event (E2 membership)
    await deps.auth.upsertMembership({
      eventId: id,
      userId: input.actorUserId,
      role: "admin",
    });

    // S-AIRTABLE outbox before audit — both are part of the unit; failure
    // compensates the event so we never leave SoR without projection.
    if (deps.airtable) {
      const enq = await enqueueAirtableProjection(deps.airtable, {
        eventId: id,
        entityType: "event",
        internalId: id,
        sourceVersion: row.version,
        fields: {
          name: row.name,
          slug: row.slug,
          timezone: row.timezone,
          starts_at: row.startsAt,
          ends_at: row.endsAt,
        },
        correlationId: input.correlationId,
      });
      outboxId = enq.outboxId;
    }

    await deps.auth.insertAudit({
      id: uuidv7(),
      eventId: id,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "Event.Create",
      entityType: "event",
      entityId: id,
      afterJson: JSON.stringify({
        name: row.name,
        timezone: row.timezone,
        slug: row.slug,
      }),
      correlationId: input.correlationId,
      createdAt: now,
    });
  } catch (err) {
    // Compensate: remove event (+ partial outbox) so error ⇒ no durable mutation.
    await deps.events.deleteEvent(id);
    if (outboxId && deps.airtable) {
      await deps.airtable.deleteUnprocessedOutbox(outboxId);
    }
    throw err;
  }

  return { ok: true, value: { event: toEventDto(row) } };
}

/**
 * Event.Update — optimistic concurrency via expectedVersion.
 *
 * E7 transactional outbox unit: event CAS + audit + airtable.project.
 * Side-effect failure restores the prior event version so a failed request
 * never leaves a changed event without a projection outbox row.
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

  const updated = await deps.events.updateEvent(next, input.expectedVersion);
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

  let outboxId: string | null = null;
  try {
    // S-AIRTABLE: outbox only — never Airtable HTTP on request path (E7).
    if (deps.airtable) {
      const enq = await enqueueAirtableProjection(deps.airtable, {
        eventId: next.id,
        entityType: "event",
        internalId: next.id,
        sourceVersion: next.version,
        fields: {
          name: next.name,
          slug: next.slug,
          timezone: next.timezone,
          starts_at: next.startsAt,
          ends_at: next.endsAt,
        },
        correlationId: input.correlationId,
      });
      outboxId = enq.outboxId;
    }

    await deps.auth.insertAudit({
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
    });
  } catch (err) {
    // Compensate event CAS so error response leaves prior version intact.
    await deps.events.updateEvent(existing, next.version);
    if (outboxId && deps.airtable) {
      await deps.airtable.deleteUnprocessedOutbox(outboxId);
    }
    throw err;
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
