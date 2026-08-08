/**
 * Schedule Studio pure helpers (section 6.2 / S-SCHED).
 *
 * Slot grid generation, duration defaults, undo inverse planning,
 * conflict message formatting — no React / fetch.
 */

import type {
  ScheduleConflictItem,
  SchedulePlacementDto,
  ScheduleView,
} from "@speakerops/shared";

/** Default session length when placing into a grid slot (minutes). */
export const DEFAULT_SLOT_MINUTES = 60;

/** Canonical five views (COMMANDS Schedule.List view hint). */
export const SCHEDULE_VIEWS = [
  "list",
  "day",
  "week",
  "track",
  "room",
] as const satisfies readonly NonNullable<ScheduleView>[];

export type ScheduleViewMode = (typeof SCHEDULE_VIEWS)[number];

export type UndoAction =
  | {
      kind: "unschedule";
      placementId: string;
      expectedVersion: number;
    }
  | {
      kind: "place";
      sessionId: string;
      roomId: string;
      startsAt: string;
      endsAt: string;
    }
  | {
      kind: "move";
      placementId: string;
      roomId: string;
      startsAt: string;
      endsAt: string;
      expectedVersion: number;
    };

/** Half-open interval length in minutes; ends after starts. */
export function durationMinutes(startsAt: string, endsAt: string): number {
  const ms = Date.parse(endsAt) - Date.parse(startsAt);
  if (!Number.isFinite(ms) || ms <= 0) return DEFAULT_SLOT_MINUTES;
  return Math.round(ms / 60_000);
}

/** endsAt = startsAt + minutes. */
export function addMinutesIso(startsAt: string, minutes: number): string {
  const t = Date.parse(startsAt);
  if (!Number.isFinite(t)) return startsAt;
  return new Date(t + minutes * 60_000).toISOString();
}

/**
 * Build hourly (or custom step) slot start times for a half-open day window.
 * Uses UTC wall clock of the ISO instants (event times stored as ISO).
 */
export function buildTimeSlots(
  dayStartIso: string,
  dayEndIso: string,
  stepMinutes: number = DEFAULT_SLOT_MINUTES,
): string[] {
  const start = Date.parse(dayStartIso);
  const end = Date.parse(dayEndIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return [];
  }
  const stepMs = Math.max(1, stepMinutes) * 60_000;
  const slots: string[] = [];
  for (let t = start; t < end; t += stepMs) {
    slots.push(new Date(t).toISOString());
  }
  return slots;
}

/**
 * Calendar day keys (YYYY-MM-DD from UTC ISO) spanning event starts→ends inclusive.
 * Caps at 7 days for week view.
 */
export function buildDayKeys(
  startsAt: string | null | undefined,
  endsAt: string | null | undefined,
  maxDays = 7,
): string[] {
  const fallbackStart = "2026-09-01T09:00:00.000Z";
  const fallbackEnd = "2026-09-01T17:00:00.000Z";
  const s = Date.parse(startsAt || fallbackStart);
  const e = Date.parse(endsAt || fallbackEnd);
  if (!Number.isFinite(s) || !Number.isFinite(e)) {
    return [fallbackStart.slice(0, 10)];
  }
  const startDay = new Date(s);
  startDay.setUTCHours(0, 0, 0, 0);
  const endDay = new Date(e);
  endDay.setUTCHours(0, 0, 0, 0);
  const keys: string[] = [];
  for (
    let d = startDay.getTime();
    d <= endDay.getTime() && keys.length < maxDays;
    d += 24 * 60 * 60 * 1000
  ) {
    keys.push(new Date(d).toISOString().slice(0, 10));
  }
  if (keys.length === 0) {
    keys.push(new Date(s).toISOString().slice(0, 10));
  }
  return keys;
}

/** Default working-day window on a YYYY-MM-DD (UTC 09:00–17:00). */
export function dayWindowUtc(dayKey: string): {
  dayStart: string;
  dayEnd: string;
} {
  return {
    dayStart: `${dayKey}T09:00:00.000Z`,
    dayEnd: `${dayKey}T17:00:00.000Z`,
  };
}

/** Prefer event day bounds when they fall on the same calendar day. */
export function dayWindowForEvent(
  dayKey: string,
  eventStartsAt: string | null | undefined,
  eventEndsAt: string | null | undefined,
): { dayStart: string; dayEnd: string } {
  const def = dayWindowUtc(dayKey);
  if (!eventStartsAt || !eventEndsAt) return def;
  const s = Date.parse(eventStartsAt);
  const e = Date.parse(eventEndsAt);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return def;
  const sKey = new Date(s).toISOString().slice(0, 10);
  const eKey = new Date(e).toISOString().slice(0, 10);
  // Multi-day event: clamp this day to working hours unless single-day.
  if (sKey === eKey && sKey === dayKey) {
    return {
      dayStart: new Date(s).toISOString(),
      dayEnd: new Date(e).toISOString(),
    };
  }
  if (dayKey === sKey) {
    return {
      dayStart: new Date(s).toISOString(),
      dayEnd: def.dayEnd,
    };
  }
  if (dayKey === eKey) {
    return {
      dayStart: def.dayStart,
      dayEnd: new Date(e).toISOString(),
    };
  }
  return def;
}

export function formatTimeLabel(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      ...(timeZone ? { timeZone } : { timeZone: "UTC" }),
    }).format(d);
  } catch {
    return iso.slice(11, 16);
  }
}

export function formatConflictMessage(
  conflicts: ScheduleConflictItem[] | undefined,
): string {
  if (!conflicts || conflicts.length === 0) {
    return "Schedule conflict";
  }
  return conflicts.map((c) => c.message).join(" · ");
}

/** Slot identity for drop targets and keyboard place. */
export function slotKey(roomId: string, startsAt: string): string {
  return `${roomId}|${startsAt}`;
}

export function placementInSlot(
  p: SchedulePlacementDto,
  roomId: string,
  startsAt: string,
): boolean {
  return p.roomId === roomId && p.startsAt === startsAt;
}

/**
 * Inverse of a successful user mutation for client undo stack.
 * Place → unschedule; Move → move-back; Unschedule → place.
 */
export function undoForPlace(placement: SchedulePlacementDto): UndoAction {
  return {
    kind: "unschedule",
    placementId: placement.id,
    expectedVersion: placement.version,
  };
}

export function undoForMove(
  placementAfter: SchedulePlacementDto,
  previous: {
    roomId: string;
    startsAt: string;
    endsAt: string;
  },
): UndoAction {
  return {
    kind: "move",
    placementId: placementAfter.id,
    roomId: previous.roomId,
    startsAt: previous.startsAt,
    endsAt: previous.endsAt,
    expectedVersion: placementAfter.version,
  };
}

export function undoForUnschedule(previous: {
  sessionId: string;
  roomId: string;
  startsAt: string;
  endsAt: string;
}): UndoAction {
  return {
    kind: "place",
    sessionId: previous.sessionId,
    roomId: previous.roomId,
    startsAt: previous.startsAt,
    endsAt: previous.endsAt,
  };
}

/** Group placements by room for room view. */
export function groupByRoom(
  placements: SchedulePlacementDto[],
): Map<string, SchedulePlacementDto[]> {
  const map = new Map<string, SchedulePlacementDto[]>();
  for (const p of placements) {
    const list = map.get(p.roomId) ?? [];
    list.push(p);
    map.set(p.roomId, list);
  }
  return map;
}

/** Group by trackId (null → "untracked"). */
export function groupByTrack(
  placements: SchedulePlacementDto[],
): Map<string, SchedulePlacementDto[]> {
  const map = new Map<string, SchedulePlacementDto[]>();
  for (const p of placements) {
    const key = p.trackId ?? "untracked";
    const list = map.get(key) ?? [];
    list.push(p);
    map.set(key, list);
  }
  return map;
}

/** Placements whose startsAt falls on dayKey (UTC). */
export function placementsOnDay(
  placements: SchedulePlacementDto[],
  dayKey: string,
): SchedulePlacementDto[] {
  return placements.filter((p) => p.startsAt.slice(0, 10) === dayKey);
}

export function isScheduleView(v: string): v is ScheduleViewMode {
  return (SCHEDULE_VIEWS as readonly string[]).includes(v);
}
