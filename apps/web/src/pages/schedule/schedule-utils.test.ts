/**
 * Unit tests for Schedule Studio helpers (section 6.2).
 */
import { describe, it, expect } from "vitest";
import {
  addMinutesIso,
  apiConflictsToLocal,
  buildDayKeys,
  buildTimeSlots,
  conflictedPlacementIds,
  dayWindowForEvent,
  dayWindowUtc,
  DEFAULT_SLOT_MINUTES,
  detectLocalRoomConflicts,
  DRAG_ACTIVATION_PX,
  durationMinutes,
  exceedsDragThreshold,
  formatConflictMessage,
  groupByRoom,
  groupByTrack,
  intervalsOverlap,
  isDayWithinEventRange,
  isScheduleView,
  LAST_SLOT_FALLBACK_MS,
  mayUseLastSlotFallback,
  placementInSlot,
  placementOccupiesSlot,
  placementsOnDay,
  pointInsideClientRect,
  wouldRoomOverlap,
  safeTrackColor,
  slotKey,
  slotTargetFromElement,
  type SlotHitNode,
  undoForMove,
  undoForPlace,
  undoForUnschedule,
  zonedDayKey,
  zonedWallParts,
  zonedWallToUtcIso,
} from "./schedule-utils.js";
import type { SchedulePlacementDto } from "@speakerops/shared";

const sample: SchedulePlacementDto = {
  id: "plc_1",
  eventId: "evt_1",
  sessionId: "ses_1",
  roomId: "room_a",
  startsAt: "2026-09-01T10:00:00.000Z",
  endsAt: "2026-09-01T11:00:00.000Z",
  version: 1,
  title: "Opening",
  trackId: "track_main",
};

describe("schedule-utils", () => {
  it("durationMinutes and addMinutesIso round-trip slot length", () => {
    expect(
      durationMinutes(
        "2026-09-01T10:00:00.000Z",
        "2026-09-01T11:00:00.000Z",
      ),
    ).toBe(60);
    expect(addMinutesIso("2026-09-01T10:00:00.000Z", 60)).toBe(
      "2026-09-01T11:00:00.000Z",
    );
    expect(durationMinutes("2026-09-01T10:00:00.000Z", "2026-09-01T10:30:00.000Z")).toBe(
      30,
    );
    expect(durationMinutes("2026-09-01T10:00:00.000Z", "2026-09-01T11:30:00.000Z")).toBe(
      90,
    );
    expect(DEFAULT_SLOT_MINUTES).toBe(60);
  });

  it("buildTimeSlots yields hourly grid inside day window", () => {
    const slots = buildTimeSlots(
      "2026-09-01T09:00:00.000Z",
      "2026-09-01T12:00:00.000Z",
      60,
    );
    expect(slots).toEqual([
      "2026-09-01T09:00:00.000Z",
      "2026-09-01T10:00:00.000Z",
      "2026-09-01T11:00:00.000Z",
    ]);
  });

  it("buildDayKeys caps at maxDays and covers event span", () => {
    const keys = buildDayKeys(
      "2026-09-01T09:00:00.000Z",
      "2026-09-05T18:00:00.000Z",
      3,
      "UTC",
    );
    expect(keys).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
  });

  it("buildDayKeys uses event timezone for calendar day grouping", () => {
    // 2026-09-02 01:00 UTC is still 2026-09-01 evening in America/New_York (EDT).
    const keys = buildDayKeys(
      "2026-09-02T01:00:00.000Z",
      "2026-09-02T02:00:00.000Z",
      7,
      "America/New_York",
    );
    expect(keys).toEqual(["2026-09-01"]);
    expect(zonedDayKey("2026-09-02T01:00:00.000Z", "America/New_York")).toBe(
      "2026-09-01",
    );
  });

  it("10.6 AC-10.6-A: mid-week event omits pre-event weekdays (no Mon/Tue chrome)", () => {
    // Wed 2026-09-02 → Fri 2026-09-04 UTC — must not invent Mon 08-31 or Tue 09-01.
    const keys = buildDayKeys(
      "2026-09-02T09:00:00.000Z",
      "2026-09-04T17:00:00.000Z",
      7,
      "UTC",
    );
    expect(keys).toEqual(["2026-09-02", "2026-09-03", "2026-09-04"]);
    expect(keys).not.toContain("2026-08-31");
    expect(keys).not.toContain("2026-09-01");
    expect(keys).not.toContain("2026-09-05");
    expect(keys).not.toContain("2026-09-06");
  });

  it("10.6: half-open end excludes calendar day when endsAt is midnight", () => {
    // Ends exactly at Fri 00:00 UTC → last included day is Thu.
    const keys = buildDayKeys(
      "2026-09-02T09:00:00.000Z",
      "2026-09-05T00:00:00.000Z",
      7,
      "UTC",
    );
    expect(keys).toEqual(["2026-09-02", "2026-09-03", "2026-09-04"]);
    expect(keys).not.toContain("2026-09-05");
  });

  it("zonedWallParts round-trips with zonedWallToUtcIso (UTC)", () => {
    const iso = "2026-09-01T15:30:00.000Z";
    const parts = zonedWallParts(iso, "UTC");
    expect(parts).toEqual({ dayKey: "2026-09-01", hour: 15, minute: 30 });
    expect(zonedWallToUtcIso(parts.dayKey, parts.hour, parts.minute, "UTC")).toBe(
      iso,
    );
  });

  it("10.6: isDayWithinEventRange rejects days outside event", () => {
    expect(
      isDayWithinEventRange(
        "2026-09-01",
        "2026-09-02T09:00:00.000Z",
        "2026-09-04T17:00:00.000Z",
        "UTC",
      ),
    ).toBe(false);
    expect(
      isDayWithinEventRange(
        "2026-09-03",
        "2026-09-02T09:00:00.000Z",
        "2026-09-04T17:00:00.000Z",
        "UTC",
      ),
    ).toBe(true);
  });

  it("dayWindowUtc and dayWindowForEvent clamp multi-day in event TZ", () => {
    expect(dayWindowUtc("2026-09-02", "UTC")).toEqual({
      dayStart: "2026-09-02T09:00:00.000Z",
      dayEnd: "2026-09-02T17:00:00.000Z",
    });
    // America/New_York EDT = UTC-4 → 09:00 local = 13:00Z
    const ny = dayWindowUtc("2026-09-02", "America/New_York");
    expect(ny.dayStart).toBe(zonedWallToUtcIso("2026-09-02", 9, 0, "America/New_York"));
    expect(ny.dayEnd).toBe(zonedWallToUtcIso("2026-09-02", 17, 0, "America/New_York"));
    expect(ny.dayStart).toBe("2026-09-02T13:00:00.000Z");
    expect(ny.dayEnd).toBe("2026-09-02T21:00:00.000Z");

    const single = dayWindowForEvent(
      "2026-09-01",
      "2026-09-01T10:00:00.000Z",
      "2026-09-01T16:00:00.000Z",
      "UTC",
    );
    expect(single.dayStart).toBe("2026-09-01T10:00:00.000Z");
    expect(single.dayEnd).toBe("2026-09-01T16:00:00.000Z");
  });

  it("dayWindowUtc honors configured wall-time params (Wave 2 agenda)", () => {
    expect(dayWindowUtc("2026-09-01", "UTC", "10:00", "16:00")).toEqual({
      dayStart: "2026-09-01T10:00:00.000Z",
      dayEnd: "2026-09-01T16:00:00.000Z",
    });
    expect(dayWindowUtc("2026-09-01", "UTC", "07:30", "18:15")).toEqual({
      dayStart: "2026-09-01T07:30:00.000Z",
      dayEnd: "2026-09-01T18:15:00.000Z",
    });
    // America/New_York EDT: 10:00 local = 14:00Z
    const ny = dayWindowUtc("2026-09-02", "America/New_York", "10:00", "16:00");
    expect(ny.dayStart).toBe("2026-09-02T14:00:00.000Z");
    expect(ny.dayEnd).toBe("2026-09-02T20:00:00.000Z");
    // Malformed wall times fall back to 09:00/17:00 defaults
    expect(dayWindowUtc("2026-09-01", "UTC", "nope", "24:99")).toEqual({
      dayStart: "2026-09-01T09:00:00.000Z",
      dayEnd: "2026-09-01T17:00:00.000Z",
    });
  });

  it("dayWindowForEvent: explicit agenda window wins over event clamping", () => {
    // Without opts (legacy): first day clamps start to event startsAt.
    const legacy = dayWindowForEvent(
      "2026-09-01",
      "2026-09-01T07:00:00.000Z",
      "2026-09-03T17:00:00.000Z",
      "UTC",
    );
    expect(legacy.dayStart).toBe("2026-09-01T07:00:00.000Z");
    // With an explicit window, the configured hours are authoritative —
    // matches the server-side "hours" enforcement.
    const explicit = dayWindowForEvent(
      "2026-09-01",
      "2026-09-01T07:00:00.000Z",
      "2026-09-03T17:00:00.000Z",
      "UTC",
      { startHHMM: "10:00", endHHMM: "16:00" },
    );
    expect(explicit).toEqual({
      dayStart: "2026-09-01T10:00:00.000Z",
      dayEnd: "2026-09-01T16:00:00.000Z",
    });
    // Explicit window also applies when event bounds are missing
    expect(
      dayWindowForEvent("2026-09-01", null, null, "UTC", {
        startHHMM: "10:00",
        endHHMM: "16:00",
      }),
    ).toEqual({
      dayStart: "2026-09-01T10:00:00.000Z",
      dayEnd: "2026-09-01T16:00:00.000Z",
    });
  });

  it("buildTimeSlots at 30-minute interval matches the configured window", () => {
    const slots = buildTimeSlots(
      "2026-09-01T10:00:00.000Z",
      "2026-09-01T16:00:00.000Z",
      30,
    );
    expect(slots).toHaveLength(12);
    expect(slots[0]).toBe("2026-09-01T10:00:00.000Z");
    expect(slots[11]).toBe("2026-09-01T15:30:00.000Z");
    // 15-minute interval quadruples the hourly density
    expect(
      buildTimeSlots(
        "2026-09-01T10:00:00.000Z",
        "2026-09-01T11:00:00.000Z",
        15,
      ),
    ).toEqual([
      "2026-09-01T10:00:00.000Z",
      "2026-09-01T10:15:00.000Z",
      "2026-09-01T10:30:00.000Z",
      "2026-09-01T10:45:00.000Z",
    ]);
  });

  it("placementInSlot stays parameterized by stepMinutes", () => {
    const half: SchedulePlacementDto = {
      ...sample,
      startsAt: "2026-09-01T10:15:00.000Z",
      endsAt: "2026-09-01T10:45:00.000Z",
    };
    // 30-min grid: 10:15 belongs to the 10:00 slot, not 10:30
    expect(
      placementInSlot(half, "room_a", "2026-09-01T10:00:00.000Z", 30),
    ).toBe(true);
    expect(
      placementInSlot(half, "room_a", "2026-09-01T10:30:00.000Z", 30),
    ).toBe(false);
    // 15-min grid: it belongs exactly to the 10:15 slot
    expect(
      placementInSlot(half, "room_a", "2026-09-01T10:15:00.000Z", 15),
    ).toBe(true);
    expect(
      placementInSlot(half, "room_a", "2026-09-01T10:00:00.000Z", 15),
    ).toBe(false);
  });

  it("slot helpers and grouping; off-hour placement still matches hour slot", () => {
    expect(slotKey("room_a", "2026-09-01T10:00:00.000Z")).toBe(
      "room_a|2026-09-01T10:00:00.000Z",
    );
    expect(
      placementInSlot(sample, "room_a", "2026-09-01T10:00:00.000Z"),
    ).toBe(true);
    const halfHour: SchedulePlacementDto = {
      ...sample,
      startsAt: "2026-09-01T10:30:00.000Z",
      endsAt: "2026-09-01T11:30:00.000Z",
    };
    expect(
      placementInSlot(halfHour, "room_a", "2026-09-01T10:00:00.000Z"),
    ).toBe(true);
    expect(
      placementInSlot(halfHour, "room_a", "2026-09-01T11:00:00.000Z"),
    ).toBe(false);
    expect(placementsOnDay([sample], "2026-09-01", "UTC")).toHaveLength(1);
    expect(placementsOnDay([sample], "2026-09-02", "UTC")).toHaveLength(0);
    expect(groupByRoom([sample]).get("room_a")).toHaveLength(1);
    expect(groupByTrack([sample]).get("track_main")).toHaveLength(1);
    expect(groupByTrack([{ ...sample, trackId: null }]).get("untracked")).toHaveLength(
      1,
    );
  });

  it("undo actions invert place/move/unschedule (no frozen expectedVersion)", () => {
    expect(undoForPlace(sample)).toEqual({
      kind: "unschedule",
      placementId: "plc_1",
    });
    expect(
      undoForMove({ ...sample, version: 2 }, {
        roomId: "room_b",
        startsAt: "2026-09-01T14:00:00.000Z",
        endsAt: "2026-09-01T15:00:00.000Z",
      }),
    ).toEqual({
      kind: "move",
      placementId: "plc_1",
      roomId: "room_b",
      startsAt: "2026-09-01T14:00:00.000Z",
      endsAt: "2026-09-01T15:00:00.000Z",
    });
    expect(
      undoForUnschedule({
        sessionId: "ses_1",
        roomId: "room_a",
        startsAt: "2026-09-01T10:00:00.000Z",
        endsAt: "2026-09-01T11:00:00.000Z",
      }),
    ).toEqual({
      kind: "place",
      sessionId: "ses_1",
      roomId: "room_a",
      startsAt: "2026-09-01T10:00:00.000Z",
      endsAt: "2026-09-01T11:00:00.000Z",
    });
  });

  it("formatConflictMessage and isScheduleView", () => {
    expect(formatConflictMessage(undefined)).toBe("Schedule conflict");
    expect(
      formatConflictMessage([
        { type: "room", message: "Room busy" },
        { type: "speaker", message: "Speaker busy" },
      ]),
    ).toBe("Room busy · Speaker busy");
    expect(isScheduleView("day")).toBe(true);
    expect(isScheduleView("auto")).toBe(false);
  });

  it("placementOccupiesSlot marks duration occupancy across later rows", () => {
    // 10:00–12:00 occupies 10:00 and 11:00 hour rows, not 12:00.
    const long = {
      ...sample,
      startsAt: "2026-09-01T10:00:00.000Z",
      endsAt: "2026-09-01T12:00:00.000Z",
    };
    expect(
      placementOccupiesSlot(long, "room_a", "2026-09-01T10:00:00.000Z", 60),
    ).toBe(true);
    expect(
      placementOccupiesSlot(long, "room_a", "2026-09-01T11:00:00.000Z", 60),
    ).toBe(true);
    expect(
      placementOccupiesSlot(long, "room_a", "2026-09-01T12:00:00.000Z", 60),
    ).toBe(false);
    // Start-row only helper still only marks the start hour.
    expect(placementInSlot(long, "room_a", "2026-09-01T11:00:00.000Z", 60)).toBe(
      false,
    );
  });

  it("wouldRoomOverlap pre-flight detects room conflicts and excludes source", () => {
    const a = sample;
    const candidateOverlap = {
      roomId: "room_a",
      startsAt: "2026-09-01T10:30:00.000Z",
      endsAt: "2026-09-01T11:30:00.000Z",
    };
    expect(wouldRoomOverlap([a], candidateOverlap)).toBe(true);
    expect(
      wouldRoomOverlap([a], {
        ...candidateOverlap,
        excludePlacementId: a.id,
      }),
    ).toBe(false);
    expect(
      wouldRoomOverlap([a], {
        roomId: "room_a",
        startsAt: "2026-09-01T12:00:00.000Z",
        endsAt: "2026-09-01T13:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("formatConflictMessage renders embedded ISO instants in the event timezone", () => {
    // Server copy embeds raw UTC ISO — banner must show event-local grid times
    const msg = formatConflictMessage(
      [
        {
          type: "room",
          message:
            "Room is already booked from 2026-09-01T16:00:00.000Z to 2026-09-01T17:30:00.000Z",
        },
      ],
      "Australia/Sydney",
    );
    expect(msg).toBe("Room is already booked from 02:00 to 03:30");
    expect(msg).not.toMatch(/\d{4}-\d{2}-\d{2}T/);

    // Without a timezone the times fall back to UTC wall clock
    expect(
      formatConflictMessage([
        {
          type: "speaker",
          message: "Speaker is already booked from 2026-09-01T16:00:00.000Z",
        },
      ]),
    ).toBe("Speaker is already booked from 16:00");
  });

  it("apiConflictsToLocal localizes summary row messages too", () => {
    const rows = apiConflictsToLocal(
      [
        {
          type: "room",
          message: "Room is already booked from 2026-09-01T16:00:00.000Z",
          placementId: "plc_9",
        },
      ],
      "Australia/Sydney",
    );
    expect(rows[0]!.message).toBe("Room is already booked from 02:00");
    expect(rows[0]!.affectedPlacementIds).toEqual(["plc_9"]);
  });

  it("intervalsOverlap and detectLocalRoomConflicts for tile + summary", () => {
    expect(
      intervalsOverlap(
        "2026-09-01T10:00:00.000Z",
        "2026-09-01T11:00:00.000Z",
        "2026-09-01T10:30:00.000Z",
        "2026-09-01T11:30:00.000Z",
      ),
    ).toBe(true);
    expect(
      intervalsOverlap(
        "2026-09-01T10:00:00.000Z",
        "2026-09-01T11:00:00.000Z",
        "2026-09-01T11:00:00.000Z",
        "2026-09-01T12:00:00.000Z",
      ),
    ).toBe(false);

    const a: SchedulePlacementDto = {
      ...sample,
      id: "plc_a",
      title: "Talk A",
    };
    const b: SchedulePlacementDto = {
      ...sample,
      id: "plc_b",
      sessionId: "ses_b",
      title: "Talk B",
      startsAt: "2026-09-01T10:30:00.000Z",
      endsAt: "2026-09-01T11:30:00.000Z",
    };
    const otherRoom: SchedulePlacementDto = {
      ...sample,
      id: "plc_c",
      roomId: "room_b",
      title: "Other room",
    };
    const conflicts = detectLocalRoomConflicts([a, b, otherRoom]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.type).toBe("room");
    expect(conflicts[0]!.affectedPlacementIds).toEqual(
      expect.arrayContaining(["plc_a", "plc_b"]),
    );
    expect(conflictedPlacementIds(conflicts).has("plc_a")).toBe(true);
    expect(conflictedPlacementIds(conflicts).has("plc_c")).toBe(false);
  });

  it("apiConflictsToLocal and safeTrackColor", () => {
    const local = apiConflictsToLocal([
      {
        type: "speaker",
        message: "Speaker is already booked",
        placementId: "plc_x",
      },
    ]);
    expect(local[0]!.affectedPlacementIds).toEqual(["plc_x"]);
    expect(safeTrackColor("#7ba88b")).toBe("#7ba88b");
    expect(safeTrackColor("#abc")).toBe("#abc");
    expect(safeTrackColor("red")).toBeNull();
    expect(safeTrackColor(null)).toBeNull();
  });

  it("exceedsDragThreshold discriminates click vs drag at ~6px", () => {
    expect(DRAG_ACTIVATION_PX).toBe(6);
    // No movement / tiny jitter → still a click
    expect(exceedsDragThreshold(100, 100, 100, 100)).toBe(false);
    expect(exceedsDragThreshold(100, 100, 103, 103)).toBe(false); // ~4.24px
    expect(exceedsDragThreshold(100, 100, 106, 100)).toBe(false); // exactly 6
    // Beyond threshold in any direction → drag
    expect(exceedsDragThreshold(100, 100, 107, 100)).toBe(true);
    expect(exceedsDragThreshold(100, 100, 100, 93)).toBe(true);
    expect(exceedsDragThreshold(100, 100, 95, 95)).toBe(true); // ~7.07px
    // Custom threshold honored
    expect(exceedsDragThreshold(0, 0, 3, 0, 2)).toBe(true);
    expect(exceedsDragThreshold(0, 0, 1, 0, 2)).toBe(false);
  });

  it("mayUseLastSlotFallback only when recent and inside board", () => {
    const board = { left: 100, top: 100, right: 400, bottom: 400 };
    const now = 10_000;
    expect(
      mayUseLastSlotFallback({
        lastSlotAt: now - 100,
        nowMs: now,
        clientX: 200,
        clientY: 200,
        boardRect: board,
      }),
    ).toBe(true);
    // Stale last hover
    expect(
      mayUseLastSlotFallback({
        lastSlotAt: now - 400,
        nowMs: now,
        clientX: 200,
        clientY: 200,
        boardRect: board,
      }),
    ).toBe(false);
    // Outside board (tray / toolbar)
    expect(
      mayUseLastSlotFallback({
        lastSlotAt: now - 50,
        nowMs: now,
        clientX: 50,
        clientY: 50,
        boardRect: board,
      }),
    ).toBe(false);
    expect(
      mayUseLastSlotFallback({
        lastSlotAt: null,
        nowMs: now,
        clientX: 200,
        clientY: 200,
        boardRect: board,
      }),
    ).toBe(false);
    expect(pointInsideClientRect(200, 200, board)).toBe(true);
    expect(pointInsideClientRect(10, 10, board)).toBe(false);
    expect(LAST_SLOT_FALLBACK_MS).toBe(250);
  });

  it("slotTargetFromElement walks up to the enclosing slot", () => {
    const node = (
      attrs: Record<string, string>,
      parent: SlotHitNode | null = null,
    ): SlotHitNode => ({
      getAttribute: (name: string) => attrs[name] ?? null,
      parentElement: parent,
    });

    const slot = node({
      "data-testid": "schedule-slot-room_a|2026-09-01T10:00:00.000Z",
      "data-room-id": "room_a",
      "data-starts-at": "2026-09-01T10:00:00.000Z",
    });
    // Hit directly on the slot
    expect(slotTargetFromElement(slot)).toEqual({
      roomId: "room_a",
      startsAt: "2026-09-01T10:00:00.000Z",
      key: slotKey("room_a", "2026-09-01T10:00:00.000Z"),
    });

    // Hit on a tile (and its inner span) nested inside the slot resolves to it
    const tile = node(
      { "data-testid": "schedule-placement-plc_1" },
      slot,
    );
    const tileSpan = node({}, tile);
    expect(slotTargetFromElement(tile)?.roomId).toBe("room_a");
    expect(slotTargetFromElement(tileSpan)?.key).toBe(
      slotKey("room_a", "2026-09-01T10:00:00.000Z"),
    );

    // Hits outside any slot cancel cleanly
    expect(slotTargetFromElement(null)).toBeNull();
    expect(slotTargetFromElement(node({ "data-testid": "schedule-tray" })))
      .toBeNull();

    // Slot missing data attributes → null (never a bogus drop)
    const broken = node({ "data-testid": "schedule-slot-x" });
    expect(slotTargetFromElement(node({}, broken))).toBeNull();
  });
});
