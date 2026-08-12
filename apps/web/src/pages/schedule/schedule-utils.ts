/**
 * Schedule Studio pure helpers (section 6.2 / S-SCHED).
 *
 * Slot grid generation, duration defaults, undo inverse planning,
 * conflict message formatting — no React / fetch.
 *
 * Calendar day keys and working windows are computed in the event timezone
 * (not UTC-only). Labels and drop targets share the same semantics.
 */

import type {
  ScheduleConflictItem,
  SchedulePlacementDto,
  ScheduleView,
} from "@speakerops/shared";

/** Default session length when placing into a grid slot (minutes). */
export const DEFAULT_SLOT_MINUTES = 60;

/** API-backed schedule views (COMMANDS Schedule.List view hint). */
export const SCHEDULE_API_VIEWS = [
  "list",
  "day",
  "week",
  "track",
  "room",
] as const satisfies readonly NonNullable<ScheduleView>[];

/** UI views including P8 Month + Conflicts work-queue. */
export const SCHEDULE_VIEWS = [
  ...SCHEDULE_API_VIEWS,
  "month",
  "conflicts",
] as const;

export type ScheduleViewMode = (typeof SCHEDULE_VIEWS)[number];

/**
 * Undo stack entries store placementId + coordinates only.
 * `expectedVersion` is resolved from live client state at undo execution time
 * (DnD verdict: frozen versions on the stack manufacture single-user 409s).
 */
export type UndoAction =
  | {
      kind: "unschedule";
      placementId: string;
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
 * Calendar day key (YYYY-MM-DD) for an instant in the given IANA timezone.
 * Uses en-CA so the formatted date is ISO-ordered YYYY-MM-DD.
 */
export function zonedDayKey(iso: string, timeZone: string = "UTC"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/**
 * Offset of `timeZone` at instant `date`: wall_as_utc_ms - utc_ms.
 * wall = utc + offset ⇒ utc = wall - offset.
 */
function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - date.getTime();
}

/**
 * Convert a wall-clock local time on dayKey in timeZone to UTC ISO.
 * dayKey is YYYY-MM-DD in the event timezone.
 */
/**
 * Wall-clock parts of an instant in timeZone for inspector/date inputs.
 * Returns 24h hour/minute and YYYY-MM-DD day key.
 */
export function zonedWallParts(
  iso: string,
  timeZone: string = "UTC",
): { dayKey: string; hour: number; minute: number } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return { dayKey: iso.slice(0, 10), hour: 9, minute: 0 };
  }
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    const parts = dtf.formatToParts(d);
    const map: Record<string, string> = {};
    for (const p of parts) {
      if (p.type !== "literal") map[p.type] = p.value;
    }
    return {
      dayKey: `${map.year}-${map.month}-${map.day}`,
      hour: Number(map.hour) || 0,
      minute: Number(map.minute) || 0,
    };
  } catch {
    return {
      dayKey: d.toISOString().slice(0, 10),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
    };
  }
}

export function zonedWallToUtcIso(
  dayKey: string,
  hour: number,
  minute: number,
  timeZone: string = "UTC",
): string {
  const [ys, ms, ds] = dayKey.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return `${dayKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;
  }
  // Interpret wall components as if UTC, then subtract TZ offset (refine for DST).
  let utcMs = Date.UTC(y, m - 1, d, hour, minute, 0, 0);
  for (let i = 0; i < 2; i++) {
    const offset = timeZoneOffsetMs(new Date(utcMs), timeZone);
    utcMs = Date.UTC(y, m - 1, d, hour, minute, 0, 0) - offset;
  }
  return new Date(utcMs).toISOString();
}

/**
 * Build hourly (or custom step) slot start times for a half-open day window.
 * Window bounds are absolute instants (ISO); step advances by wall minutes.
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
 * True when calendar dayKey (YYYY-MM-DD in timeZone) intersects the half-open
 * event interval [startsAt, endsAt). Used so week/day chrome never invents
 * pre-event or post-event empty days (section 10.6 / S-SCHED-CHROME).
 *
 * Semantics: day D is in range when
 *   [local midnight D, local midnight D+1) ∩ [startsAt, endsAt) is non-empty.
 * If endsAt falls exactly on midnight of day D, day D is excluded (half-open).
 */
export function isDayWithinEventRange(
  dayKey: string,
  startsAt: string | null | undefined,
  endsAt: string | null | undefined,
  timeZone: string = "UTC",
): boolean {
  if (!startsAt || !endsAt) return false;
  const s = Date.parse(startsAt);
  const e = Date.parse(endsAt);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return false;
  const dayStartMs = Date.parse(zonedWallToUtcIso(dayKey, 0, 0, timeZone));
  if (!Number.isFinite(dayStartMs)) return false;
  // Next local midnight: advance one calendar day via noon snap then re-zero.
  const noon = zonedWallToUtcIso(dayKey, 12, 0, timeZone);
  const nextMsApprox = Date.parse(noon) + 24 * 60 * 60 * 1000;
  const nextKey = zonedDayKey(new Date(nextMsApprox).toISOString(), timeZone);
  let dayEndMs = Date.parse(zonedWallToUtcIso(nextKey, 0, 0, timeZone));
  if (!Number.isFinite(dayEndMs) || dayEndMs <= dayStartMs) {
    // Pathological TZ / same key: fall back to +24h from local midnight.
    dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;
  }
  // Intervals [dayStart, dayEnd) and [s, e) overlap?
  return dayStartMs < e && dayEndMs > s;
}

/**
 * Calendar day keys (YYYY-MM-DD in event timezone) spanning event starts→ends.
 * Caps at maxDays for week view.
 *
 * **Does not pad to a calendar week** — if the event starts mid-week, earlier
 * weekdays are omitted (S-SCHED-CHROME: no pre-event empty day chrome).
 * Days are included only when they intersect half-open [startsAt, endsAt).
 */
export function buildDayKeys(
  startsAt: string | null | undefined,
  endsAt: string | null | undefined,
  maxDays = 7,
  timeZone: string = "UTC",
): string[] {
  const fallbackStart = "2026-09-01T09:00:00.000Z";
  const fallbackEnd = "2026-09-01T17:00:00.000Z";
  const effectiveStart = startsAt || fallbackStart;
  const effectiveEnd = endsAt || fallbackEnd;
  const s = Date.parse(effectiveStart);
  const e = Date.parse(effectiveEnd);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) {
    return [zonedDayKey(fallbackStart, timeZone)];
  }
  const startKey = zonedDayKey(new Date(s).toISOString(), timeZone);
  // Inclusive last day is the last calendar day that still intersects [s,e).
  // If endsAt is exactly midnight of a day, that day is excluded (half-open).
  const endInstantKey = zonedDayKey(new Date(e).toISOString(), timeZone);
  const endOnMidnight =
    Date.parse(zonedWallToUtcIso(endInstantKey, 0, 0, timeZone)) === e;
  let lastKey = endInstantKey;
  if (endOnMidnight) {
    // Step back one calendar day from endInstantKey.
    const noon = zonedWallToUtcIso(endInstantKey, 12, 0, timeZone);
    const prevMs = Date.parse(noon) - 24 * 60 * 60 * 1000;
    lastKey = zonedDayKey(new Date(prevMs).toISOString(), timeZone);
  }
  const keys: string[] = [];
  // Walk day-by-day via local noon to avoid DST edge skips.
  let cursor = zonedWallToUtcIso(startKey, 12, 0, timeZone);
  const endNoon = zonedWallToUtcIso(lastKey, 12, 0, timeZone);
  let guard = 0;
  while (
    Date.parse(cursor) <= Date.parse(endNoon) &&
    keys.length < maxDays &&
    guard < 366
  ) {
    const key = zonedDayKey(cursor, timeZone);
    if (
      !keys.includes(key) &&
      isDayWithinEventRange(key, effectiveStart, effectiveEnd, timeZone)
    ) {
      keys.push(key);
    }
    // Advance ~24h then re-snap to local noon of next calendar day.
    const nextMs = Date.parse(cursor) + 24 * 60 * 60 * 1000;
    const nextKey = zonedDayKey(new Date(nextMs).toISOString(), timeZone);
    cursor = zonedWallToUtcIso(nextKey, 12, 0, timeZone);
    // If nextKey didn't advance (pathological TZ), force key step via string.
    if (nextKey === key) {
      const [ys, ms, ds] = key.split("-").map(Number) as [
        number,
        number,
        number,
      ];
      const nd = new Date(Date.UTC(ys, ms - 1, ds + 1, 12, 0, 0));
      cursor = zonedWallToUtcIso(nd.toISOString().slice(0, 10), 12, 0, timeZone);
    }
    guard += 1;
  }
  if (keys.length === 0) {
    // At least show the start day when the interval is non-empty (degenerate).
    if (isDayWithinEventRange(startKey, effectiveStart, effectiveEnd, timeZone)) {
      keys.push(startKey);
    }
  }
  return keys;
}

/** "HH:MM" → {hour, minute} with a fallback hour when malformed. */
function parseWallHhmm(
  s: string,
  fallbackHour: number,
): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return { hour: fallbackHour, minute: 0 };
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return { hour: fallbackHour, minute: 0 };
  }
  return { hour, minute };
}

/**
 * Working-day window on a YYYY-MM-DD in the event timezone.
 * Defaults 09:00–17:00; agenda settings (Wave 2) pass configured wall times.
 */
export function dayWindowUtc(
  dayKey: string,
  timeZone: string = "UTC",
  startHHMM: string = "09:00",
  endHHMM: string = "17:00",
): {
  dayStart: string;
  dayEnd: string;
} {
  const start = parseWallHhmm(startHHMM, 9);
  const end = parseWallHhmm(endHHMM, 17);
  return {
    dayStart: zonedWallToUtcIso(dayKey, start.hour, start.minute, timeZone),
    dayEnd: zonedWallToUtcIso(dayKey, end.hour, end.minute, timeZone),
  };
}

/** Optional explicit agenda window (Wave 2 event settings). */
export type DayWindowOpts = {
  startHHMM?: string;
  endHHMM?: string;
};

/**
 * Prefer event day bounds when they fall on the same calendar day (event TZ).
 * When an explicit agenda window is configured (opts), that window wins —
 * the server enforces it, so the grid must show exactly the same envelope.
 */
export function dayWindowForEvent(
  dayKey: string,
  eventStartsAt: string | null | undefined,
  eventEndsAt: string | null | undefined,
  timeZone: string = "UTC",
  opts?: DayWindowOpts,
): { dayStart: string; dayEnd: string } {
  const explicit = Boolean(opts?.startHHMM || opts?.endHHMM);
  const def = dayWindowUtc(
    dayKey,
    timeZone,
    opts?.startHHMM ?? "09:00",
    opts?.endHHMM ?? "17:00",
  );
  if (explicit) return def;
  if (!eventStartsAt || !eventEndsAt) return def;
  const s = Date.parse(eventStartsAt);
  const e = Date.parse(eventEndsAt);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return def;
  const sKey = zonedDayKey(eventStartsAt, timeZone);
  const eKey = zonedDayKey(eventEndsAt, timeZone);
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

/** ISO-8601 instants embedded in API conflict copy (UTC or offset form). */
const ISO_INSTANT_RE =
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})/g;

/**
 * Rewrite raw ISO instants inside server copy (e.g. "Room is already booked
 * from 2026-09-01T16:00:00.000Z…") to event-local grid times via
 * formatTimeLabel, so the banner matches the schedule grid.
 */
export function localizeIsoTimesInText(
  text: string,
  timeZone?: string,
): string {
  return text.replace(ISO_INSTANT_RE, (iso) => formatTimeLabel(iso, timeZone));
}

export function formatConflictMessage(
  conflicts: ScheduleConflictItem[] | undefined,
  timeZone?: string,
): string {
  if (!conflicts || conflicts.length === 0) {
    return "Schedule conflict";
  }
  return conflicts
    .map((c) => localizeIsoTimesInText(c.message, timeZone))
    .join(" · ");
}

/**
 * Half-open interval overlap: [aStart, aEnd) ∩ [bStart, bEnd) ≠ ∅.
 * Used for client-side room conflict tiles + summary (section 11.5).
 */
export function intervalsOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  const as = Date.parse(aStart);
  const ae = Date.parse(aEnd);
  const bs = Date.parse(bStart);
  const be = Date.parse(bEnd);
  if (![as, ae, bs, be].every(Number.isFinite)) return false;
  return as < be && bs < ae;
}

/** Local conflict row for navigable summary + tile markers (S-L2-SCHED). */
export type LocalScheduleConflict = {
  type: ScheduleConflictItem["type"];
  message: string;
  roomId?: string;
  placementId?: string;
  sessionId?: string;
  /** All placement ids involved (for tile highlight). */
  affectedPlacementIds: string[];
};

/**
 * Detect hard room overlaps among already-loaded placements.
 * Speaker conflicts require participation graphs (server-only); room overlaps
 * are pure geometry and surface on tiles + summary without a failed mutation.
 */
export function detectLocalRoomConflicts(
  placements: SchedulePlacementDto[],
): LocalScheduleConflict[] {
  const conflicts: LocalScheduleConflict[] = [];
  for (let i = 0; i < placements.length; i++) {
    const a = placements[i]!;
    for (let j = i + 1; j < placements.length; j++) {
      const b = placements[j]!;
      if (a.roomId !== b.roomId) continue;
      if (!intervalsOverlap(a.startsAt, a.endsAt, b.startsAt, b.endsAt)) {
        continue;
      }
      const aLabel = a.title ?? a.sessionId;
      const bLabel = b.title ?? b.sessionId;
      conflicts.push({
        type: "room",
        message: `Room overlap: "${aLabel}" and "${bLabel}"`,
        roomId: a.roomId,
        placementId: a.id,
        sessionId: a.sessionId,
        affectedPlacementIds: [a.id, b.id],
      });
    }
  }
  return conflicts;
}

/** Map API conflict items into local rows (failed place/move). */
export function apiConflictsToLocal(
  conflicts: ScheduleConflictItem[],
  timeZone?: string,
): LocalScheduleConflict[] {
  return conflicts.map((c) => ({
    type: c.type,
    message: localizeIsoTimesInText(c.message, timeZone),
    roomId: c.roomId,
    placementId: c.placementId,
    sessionId: c.sessionId,
    affectedPlacementIds: c.placementId ? [c.placementId] : [],
  }));
}

/** Placement ids that should show conflict chrome on tiles. */
export function conflictedPlacementIds(
  conflicts: LocalScheduleConflict[],
): Set<string> {
  const ids = new Set<string>();
  for (const c of conflicts) {
    for (const id of c.affectedPlacementIds) ids.add(id);
    if (c.placementId) ids.add(c.placementId);
  }
  return ids;
}

/**
 * Accept only #RGB / #RRGGBB for track encoding strip (E6 — no freeform CSS hex).
 * Invalid or missing → null (tile falls back to brand-soft).
 */
export function safeTrackColor(
  color: string | null | undefined,
): string | null {
  if (!color) return null;
  const trimmed = color.trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) return trimmed;
  return null;
}

/** Slot identity for drop targets and keyboard place. */
export function slotKey(roomId: string, startsAt: string): string {
  return `${roomId}|${startsAt}`;
}

/**
 * Pointer-drag activation threshold in px. A press that never travels beyond
 * this distance is a click (select / open inspector); beyond it, a drag starts.
 * Deterministic discriminator — replaces flaky native HTML5 dragstart.
 */
export const DRAG_ACTIVATION_PX = 6;

/** True once pointer movement from (startX,startY) exceeds the threshold. */
export function exceedsDragThreshold(
  startX: number,
  startY: number,
  x: number,
  y: number,
  threshold: number = DRAG_ACTIVATION_PX,
): boolean {
  return Math.hypot(x - startX, y - startY) > threshold;
}

/**
 * Minimal structural view of a DOM element for slot hit-testing.
 * Real Elements satisfy this; keeps the walker unit-testable in node.
 */
export type SlotHitNode = {
  getAttribute(name: string): string | null;
  parentElement: SlotHitNode | null;
};

export type SlotHitTarget = {
  roomId: string;
  startsAt: string;
  key: string;
};

/**
 * Resolve the schedule slot under a pointer hit (document.elementFromPoint):
 * walk up from the hit element to the nearest `[data-testid^="schedule-slot-"]`
 * ancestor and read its room/start data attributes. Tiles render inside slots,
 * so a hit on a filled tile resolves to that tile's slot (nested-drop honesty).
 * Hits outside any slot return null (drop cancels cleanly).
 */
export function slotTargetFromElement(
  el: SlotHitNode | null,
): SlotHitTarget | null {
  let cur: SlotHitNode | null = el;
  let guard = 0;
  while (cur && guard < 100) {
    const testId = cur.getAttribute("data-testid");
    if (testId && testId.startsWith("schedule-slot-")) {
      const roomId = cur.getAttribute("data-room-id");
      const startsAt = cur.getAttribute("data-starts-at");
      if (roomId && startsAt) {
        return { roomId, startsAt, key: slotKey(roomId, startsAt) };
      }
      return null;
    }
    cur = cur.parentElement;
    guard += 1;
  }
  return null;
}

/**
 * Max age for board-gap last-slot fallback (R2 intermittent miss).
 * Only used when pointerup is still inside the board rect but not on a slot
 * (grid gutters / sticky chrome). Never used for tray/toolbar/outside release.
 */
export const LAST_SLOT_FALLBACK_MS = 250;

/** Axis-aligned hit test against a client rect (unit-testable without DOM). */
export function pointInsideClientRect(
  x: number,
  y: number,
  rect: { left: number; top: number; right: number; bottom: number } | null,
): boolean {
  if (!rect) return false;
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/**
 * Whether board-gap lastSlot fallback may auto-place on pointerup.
 * Requires: recent last slot, and release still inside the board rect.
 */
export function mayUseLastSlotFallback(input: {
  lastSlotAt: number | null | undefined;
  nowMs: number;
  clientX: number;
  clientY: number;
  boardRect: { left: number; top: number; right: number; bottom: number } | null;
  maxAgeMs?: number;
}): boolean {
  if (input.lastSlotAt == null) return false;
  const age = input.nowMs - input.lastSlotAt;
  if (age < 0 || age > (input.maxAgeMs ?? LAST_SLOT_FALLBACK_MS)) return false;
  return pointInsideClientRect(input.clientX, input.clientY, input.boardRect);
}

/**
 * True when placement **starts** in this grid slot (start-row only).
 * Occupies the slot whose [startsAt, startsAt+step) window contains placement.startsAt
 * (not only exact equality), so off-hour placements like 10:30 remain visible.
 */
export function placementInSlot(
  p: SchedulePlacementDto,
  roomId: string,
  startsAt: string,
  stepMinutes: number = DEFAULT_SLOT_MINUTES,
): boolean {
  if (p.roomId !== roomId) return false;
  const slotStart = Date.parse(startsAt);
  const pStart = Date.parse(p.startsAt);
  if (!Number.isFinite(slotStart) || !Number.isFinite(pStart)) {
    return p.startsAt === startsAt;
  }
  const slotEnd = slotStart + Math.max(1, stepMinutes) * 60_000;
  return pStart >= slotStart && pStart < slotEnd;
}

/**
 * True when placement's half-open interval [startsAt, endsAt) intersects the
 * slot window [slotStart, slotStart+step). Used for honest multi-row occupancy
 * (60/90-min sessions mark every row they cover, not only the start slot).
 */
export function placementOccupiesSlot(
  p: SchedulePlacementDto,
  roomId: string,
  startsAt: string,
  stepMinutes: number = DEFAULT_SLOT_MINUTES,
): boolean {
  if (p.roomId !== roomId) return false;
  const slotStart = Date.parse(startsAt);
  const pStart = Date.parse(p.startsAt);
  const pEnd = Date.parse(p.endsAt);
  if (
    !Number.isFinite(slotStart) ||
    !Number.isFinite(pStart) ||
    !Number.isFinite(pEnd)
  ) {
    return placementInSlot(p, roomId, startsAt, stepMinutes);
  }
  const slotEnd = slotStart + Math.max(1, stepMinutes) * 60_000;
  // half-open interval overlap
  return pStart < slotEnd && pEnd > slotStart;
}

/**
 * Local pre-flight: placements that would room-overlap a candidate interval
 * (excluding the source placement being moved). Speaker conflicts stay
 * server-authoritative; this only cuts avoidable room 409 noise.
 */
export function findRoomOverlaps(
  placements: SchedulePlacementDto[],
  candidate: {
    roomId: string;
    startsAt: string;
    endsAt: string;
    excludePlacementId?: string;
  },
): SchedulePlacementDto[] {
  const cStart = Date.parse(candidate.startsAt);
  const cEnd = Date.parse(candidate.endsAt);
  if (!Number.isFinite(cStart) || !Number.isFinite(cEnd) || cEnd <= cStart) {
    return [];
  }
  const hits: SchedulePlacementDto[] = [];
  for (const p of placements) {
    if (p.roomId !== candidate.roomId) continue;
    if (
      candidate.excludePlacementId != null &&
      p.id === candidate.excludePlacementId
    ) {
      continue;
    }
    const pStart = Date.parse(p.startsAt);
    const pEnd = Date.parse(p.endsAt);
    if (!Number.isFinite(pStart) || !Number.isFinite(pEnd)) continue;
    if (pStart < cEnd && pEnd > cStart) hits.push(p);
  }
  return hits;
}

/** Convenience boolean over `findRoomOverlaps`. */
export function wouldRoomOverlap(
  placements: SchedulePlacementDto[],
  candidate: {
    roomId: string;
    startsAt: string;
    endsAt: string;
    excludePlacementId?: string;
  },
): boolean {
  return findRoomOverlaps(placements, candidate).length > 0;
}

/** Build ScheduleConflictItem rows for a local room-overlap block. */
export function localRoomConflictItems(
  overlaps: SchedulePlacementDto[],
  roomId: string,
): ScheduleConflictItem[] {
  // Message must match e2e /Room|booked|conflict/i assertions.
  const message = "Room conflict: already booked for that time";
  if (overlaps.length === 0) {
    return [
      {
        type: "room",
        message,
        roomId,
      },
    ];
  }
  return overlaps.map((p) => ({
    type: "room" as const,
    message,
    roomId,
    placementId: p.id,
    sessionId: p.sessionId,
  }));
}

/**
 * Inverse of a successful user mutation for client undo stack.
 * Place → unschedule; Move → move-back; Unschedule → place.
 * Versions are intentionally omitted — resolve at execution from live state.
 */
export function undoForPlace(placement: SchedulePlacementDto): UndoAction {
  return {
    kind: "unschedule",
    placementId: placement.id,
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

/** Placements whose startsAt falls on dayKey in the event timezone. */
export function placementsOnDay(
  placements: SchedulePlacementDto[],
  dayKey: string,
  timeZone: string = "UTC",
): SchedulePlacementDto[] {
  return placements.filter((p) => zonedDayKey(p.startsAt, timeZone) === dayKey);
}

export function isScheduleView(v: string): v is ScheduleViewMode {
  return (SCHEDULE_VIEWS as readonly string[]).includes(v);
}
