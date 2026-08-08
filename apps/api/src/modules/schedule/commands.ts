/**
 * Schedule domain commands (section 6.1 / S-SCHED).
 *
 * Schedule.List · Schedule.Place · Schedule.Move · Schedule.Unschedule
 *
 * Hard conflict detection: room overlap + speaker (participation) double-book.
 * No OR-Tools. Versioned placements (E1). Audit on consequential writes (E3).
 *
 * Canonical registry: KMS-competition/initiative/contracts/COMMANDS.md
 */
import {
  uuidv7,
  type SchedulePlaceBody,
  type ScheduleMoveBody,
  type ScheduleUnscheduleBody,
  type SchedulePlacementDto,
  type UnscheduledSessionDto,
  type ScheduleConflictItem,
  type ScheduleListResponse,
} from "@speakerops/shared";
import type { AuthStore } from "../auth/store.js";
import type { EventsStore } from "../events/store.js";
import type { DecisionsStore } from "../decisions/store.js";
import {
  type ScheduleStore,
  type PlacementRow,
  type PlacementWriteBundle,
  newPlacementId,
  newReservationId,
} from "./store.js";

export type ScheduleCommandDeps = {
  schedule: ScheduleStore;
  events: EventsStore;
  decisions: DecisionsStore;
  auth: AuthStore;
};

export type CommandOk<T> = { ok: true; value: T };
export type CommandErr = {
  ok: false;
  status: 400 | 403 | 404 | 409;
  error: string;
  code: string;
  /** Top-level conflicts[] for schedule 409 CONFLICT (6.1 interface). */
  conflicts?: ScheduleConflictItem[];
  details?: unknown;
};

function toPlacementDto(
  row: PlacementRow,
  sessionMeta?: { title?: string; trackId?: string | null },
): SchedulePlacementDto {
  return {
    id: row.id,
    eventId: row.eventId,
    sessionId: row.sessionId,
    roomId: row.roomId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    version: row.version,
    ...(sessionMeta?.title ? { title: sessionMeta.title } : {}),
    ...(sessionMeta && "trackId" in sessionMeta
      ? { trackId: sessionMeta.trackId ?? null }
      : {}),
  };
}

function versionErr(
  expectedVersion: number,
  actual: number | string,
): CommandErr {
  return {
    ok: false,
    status: 409,
    error: "Version conflict",
    code: "VERSION",
    details: { expectedVersion, actual },
  };
}

function conflictErr(conflicts: ScheduleConflictItem[]): CommandErr {
  return {
    ok: false,
    status: 409,
    error: "Schedule conflict",
    code: "CONFLICT",
    conflicts,
    details: { conflicts },
  };
}

/**
 * Detect hard room + speaker conflicts for a proposed block.
 * excludePlacementId skips the placement being moved (self).
 */
export async function detectConflicts(
  deps: ScheduleCommandDeps,
  input: {
    eventId: string;
    roomId: string;
    startsAt: string;
    endsAt: string;
    participationIds: string[];
    excludePlacementId?: string;
  },
): Promise<ScheduleConflictItem[]> {
  const conflicts: ScheduleConflictItem[] = [];

  const roomHits = await deps.schedule.listOverlappingRoomReservations({
    eventId: input.eventId,
    roomId: input.roomId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    excludePlacementId: input.excludePlacementId,
  });
  for (const hit of roomHits) {
    conflicts.push({
      type: "room",
      message: `Room is already booked from ${hit.startsAt} to ${hit.endsAt}`,
      roomId: hit.roomId,
      placementId: hit.placementId,
    });
  }

  for (const participationId of input.participationIds) {
    const speakerHits =
      await deps.schedule.listOverlappingSpeakerReservations({
        eventId: input.eventId,
        participationId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        excludePlacementId: input.excludePlacementId,
      });
    for (const hit of speakerHits) {
      conflicts.push({
        type: "speaker",
        message: `Speaker is already booked from ${hit.startsAt} to ${hit.endsAt}`,
        participationId: hit.participationId,
        placementId: hit.placementId,
      });
    }
  }

  return conflicts;
}

function buildBundle(input: {
  placementId: string;
  eventId: string;
  sessionId: string;
  roomId: string;
  startsAt: string;
  endsAt: string;
  version: number;
  now: string;
  participationIds: string[];
  createdAt?: string;
}): PlacementWriteBundle {
  return {
    placement: {
      id: input.placementId,
      eventId: input.eventId,
      sessionId: input.sessionId,
      roomId: input.roomId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      version: input.version,
      createdAt: input.createdAt ?? input.now,
      updatedAt: input.now,
    },
    roomReservation: {
      id: newReservationId(),
      eventId: input.eventId,
      roomId: input.roomId,
      placementId: input.placementId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      createdAt: input.now,
    },
    speakerReservations: input.participationIds.map((participationId) => ({
      id: newReservationId(),
      eventId: input.eventId,
      participationId,
      placementId: input.placementId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      createdAt: input.now,
    })),
  };
}

export type PlaceInput = SchedulePlaceBody & {
  eventId: string;
  actorUserId: string;
  correlationId: string;
};

/**
 * Schedule.Place — place an unscheduled session into a room/time.
 * Returns 409 CONFLICT with conflicts[] on room/speaker double-book.
 */
export async function placeSession(
  deps: ScheduleCommandDeps,
  input: PlaceInput,
): Promise<CommandOk<{ placement: SchedulePlacementDto }> | CommandErr> {
  const session = await deps.decisions.findSessionById(input.sessionId);
  if (!session || session.eventId !== input.eventId) {
    return {
      ok: false,
      status: 404,
      error: "Session not found",
      code: "NOT_FOUND",
    };
  }
  if (session.status === "cancelled") {
    return {
      ok: false,
      status: 400,
      error: "Cannot place a cancelled session",
      code: "VALIDATION_ERROR",
    };
  }

  const room = await deps.events.findRoom(input.eventId, input.roomId);
  if (!room) {
    return {
      ok: false,
      status: 404,
      error: "Room not found",
      code: "NOT_FOUND",
    };
  }

  const existing = await deps.schedule.findPlacementBySession(input.sessionId);
  if (existing) {
    return conflictErr([
      {
        type: "session",
        message: "Session is already scheduled; use Schedule.Move to reschedule",
        sessionId: input.sessionId,
        placementId: existing.id,
      },
    ]);
  }

  const speakers = await deps.decisions.listSessionSpeakers(input.sessionId);
  const participationIds = speakers.map((s) => s.participationId);

  const conflicts = await detectConflicts(deps, {
    eventId: input.eventId,
    roomId: input.roomId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    participationIds,
  });
  if (conflicts.length > 0) {
    return conflictErr(conflicts);
  }

  const now = new Date().toISOString();
  const placementId = newPlacementId();
  const bundle = buildBundle({
    placementId,
    eventId: input.eventId,
    sessionId: input.sessionId,
    roomId: input.roomId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    version: 1,
    now,
    participationIds,
  });

  const inserted = await deps.schedule.insertPlacementBundle(bundle);
  if (!inserted) {
    // Race: concurrent place hit unique constraint
    const raced = await deps.schedule.findPlacementBySession(input.sessionId);
    if (raced) {
      return conflictErr([
        {
          type: "session",
          message:
            "Session is already scheduled; use Schedule.Move to reschedule",
          sessionId: input.sessionId,
          placementId: raced.id,
        },
      ]);
    }
    // Re-detect conflicts for concurrent room/speaker race
    const again = await detectConflicts(deps, {
      eventId: input.eventId,
      roomId: input.roomId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      participationIds,
    });
    if (again.length > 0) return conflictErr(again);
    return {
      ok: false,
      status: 409,
      error: "Schedule conflict",
      code: "CONFLICT",
      conflicts: [
        {
          type: "room",
          message: "Could not reserve room/time (concurrent conflict)",
          roomId: input.roomId,
        },
      ],
      details: { reason: "insert_failed" },
    };
  }

  const placed = (await deps.schedule.findPlacementById(placementId))!;

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: input.eventId,
    actorType: "user",
    actorId: input.actorUserId,
    action: "Schedule.Place",
    entityType: "schedule_placement",
    entityId: placed.id,
    afterJson: JSON.stringify({
      sessionId: placed.sessionId,
      roomId: placed.roomId,
      startsAt: placed.startsAt,
      endsAt: placed.endsAt,
      version: placed.version,
      speakerCount: participationIds.length,
    }),
    correlationId: input.correlationId,
    createdAt: now,
  });

  return {
    ok: true,
    value: {
      placement: toPlacementDto(placed, {
        title: session.title,
        trackId: session.trackId,
      }),
    },
  };
}

export type MoveInput = ScheduleMoveBody & {
  eventId: string;
  actorUserId: string;
  correlationId: string;
};

/**
 * Schedule.Move — reschedule an existing placement (versioned).
 * Stale expectedVersion → 409 VERSION.
 */
export async function movePlacement(
  deps: ScheduleCommandDeps,
  input: MoveInput,
): Promise<CommandOk<{ placement: SchedulePlacementDto }> | CommandErr> {
  const existing = await deps.schedule.findPlacementById(input.placementId);
  if (!existing || existing.eventId !== input.eventId) {
    return {
      ok: false,
      status: 404,
      error: "Placement not found",
      code: "NOT_FOUND",
    };
  }

  if (existing.version !== input.expectedVersion) {
    return versionErr(input.expectedVersion, existing.version);
  }

  const room = await deps.events.findRoom(input.eventId, input.roomId);
  if (!room) {
    return {
      ok: false,
      status: 404,
      error: "Room not found",
      code: "NOT_FOUND",
    };
  }

  const speakers = await deps.decisions.listSessionSpeakers(existing.sessionId);
  const participationIds = speakers.map((s) => s.participationId);

  const conflicts = await detectConflicts(deps, {
    eventId: input.eventId,
    roomId: input.roomId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    participationIds,
    excludePlacementId: existing.id,
  });
  if (conflicts.length > 0) {
    return conflictErr(conflicts);
  }

  const now = new Date().toISOString();
  const bundle = buildBundle({
    placementId: existing.id,
    eventId: existing.eventId,
    sessionId: existing.sessionId,
    roomId: input.roomId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    version: existing.version + 1,
    now,
    participationIds,
    createdAt: existing.createdAt,
  });

  const updated = await deps.schedule.updatePlacementBundle(
    input.expectedVersion,
    bundle,
  );
  if (!updated) {
    // Version race or reservation unique
    const latest = await deps.schedule.findPlacementById(input.placementId);
    if (!latest || latest.version !== input.expectedVersion) {
      return versionErr(
        input.expectedVersion,
        latest?.version ?? "changed",
      );
    }
    const again = await detectConflicts(deps, {
      eventId: input.eventId,
      roomId: input.roomId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      participationIds,
      excludePlacementId: existing.id,
    });
    if (again.length > 0) return conflictErr(again);
    return {
      ok: false,
      status: 409,
      error: "Schedule conflict",
      code: "CONFLICT",
      conflicts: [
        {
          type: "room",
          message: "Could not update reservation (concurrent conflict)",
          roomId: input.roomId,
        },
      ],
    };
  }

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: input.eventId,
    actorType: "user",
    actorId: input.actorUserId,
    action: "Schedule.Move",
    entityType: "schedule_placement",
    entityId: updated.id,
    beforeJson: JSON.stringify({
      roomId: existing.roomId,
      startsAt: existing.startsAt,
      endsAt: existing.endsAt,
      version: existing.version,
    }),
    afterJson: JSON.stringify({
      roomId: updated.roomId,
      startsAt: updated.startsAt,
      endsAt: updated.endsAt,
      version: updated.version,
    }),
    correlationId: input.correlationId,
    createdAt: now,
  });

  const session = await deps.decisions.findSessionById(updated.sessionId);
  return {
    ok: true,
    value: {
      placement: toPlacementDto(updated, {
        title: session?.title,
        trackId: session?.trackId ?? null,
      }),
    },
  };
}

export type UnscheduleInput = ScheduleUnscheduleBody & {
  eventId: string;
  actorUserId: string;
  correlationId: string;
};

/**
 * Schedule.Unschedule — remove placement and free all reservations.
 * Stale expectedVersion → 409 VERSION.
 */
export async function unschedulePlacement(
  deps: ScheduleCommandDeps,
  input: UnscheduleInput,
): Promise<
  CommandOk<{ ok: true; placementId: string }> | CommandErr
> {
  const existing = await deps.schedule.findPlacementById(input.placementId);
  if (!existing || existing.eventId !== input.eventId) {
    return {
      ok: false,
      status: 404,
      error: "Placement not found",
      code: "NOT_FOUND",
    };
  }

  if (existing.version !== input.expectedVersion) {
    return versionErr(input.expectedVersion, existing.version);
  }

  const deleted = await deps.schedule.deletePlacementBundle(
    input.placementId,
    input.expectedVersion,
  );
  if (!deleted) {
    const latest = await deps.schedule.findPlacementById(input.placementId);
    return versionErr(
      input.expectedVersion,
      latest?.version ?? "changed",
    );
  }

  const now = new Date().toISOString();
  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: input.eventId,
    actorType: "user",
    actorId: input.actorUserId,
    action: "Schedule.Unschedule",
    entityType: "schedule_placement",
    entityId: input.placementId,
    beforeJson: JSON.stringify({
      sessionId: existing.sessionId,
      roomId: existing.roomId,
      startsAt: existing.startsAt,
      endsAt: existing.endsAt,
      version: existing.version,
    }),
    afterJson: JSON.stringify({ deleted: true }),
    correlationId: input.correlationId,
    createdAt: now,
  });

  return {
    ok: true,
    value: { ok: true, placementId: input.placementId },
  };
}

/**
 * Schedule.List — placements + unscheduled (confirmed) sessions for event.
 * view is a UI hint; full set always returned (6.1 API).
 */
export async function listSchedule(
  deps: ScheduleCommandDeps,
  input: { eventId: string; view?: string },
): Promise<CommandOk<ScheduleListResponse> | CommandErr> {
  const placements = await deps.schedule.listPlacementsForEvent(input.eventId);
  const placedSessionIds = new Set(placements.map((p) => p.sessionId));

  const sessions = await deps.decisions.listSessionsForEvent(input.eventId);
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  const unscheduled: UnscheduledSessionDto[] = sessions
    .filter(
      (s) => s.status !== "cancelled" && !placedSessionIds.has(s.id),
    )
    .map((s) => ({
      id: s.id,
      eventId: s.eventId,
      title: s.title,
      trackId: s.trackId,
      status: s.status,
      version: s.version,
    }));

  // Stable order: placements by startsAt, unscheduled by title
  // Join session title/track for Schedule Studio five views (6.2 / I01–I16).
  const placementDtos = placements
    .slice()
    .sort((a, b) =>
      a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0,
    )
    .map((p) => {
      const s = sessionById.get(p.sessionId);
      return toPlacementDto(p, {
        title: s?.title,
        trackId: s?.trackId ?? null,
      });
    });
  unscheduled.sort((a, b) => a.title.localeCompare(b.title));

  return {
    ok: true,
    value: {
      placements: placementDtos,
      unscheduled,
      ...(input.view ? { view: input.view } : {}),
    },
  };
}
