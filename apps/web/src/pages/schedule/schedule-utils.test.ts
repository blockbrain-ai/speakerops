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
  durationMinutes,
  formatConflictMessage,
  groupByRoom,
  groupByTrack,
  intervalsOverlap,
  isDayWithinEventRange,
  isScheduleView,
  placementInSlot,
  placementsOnDay,
  safeTrackColor,
  slotKey,
  undoForMove,
  undoForPlace,
  undoForUnschedule,
  zonedDayKey,
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

  it("undo actions invert place/move/unschedule", () => {
    expect(undoForPlace(sample)).toEqual({
      kind: "unschedule",
      placementId: "plc_1",
      expectedVersion: 1,
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
      expectedVersion: 2,
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
    expect(safeTrackColor("#4f46e5")).toBe("#4f46e5");
    expect(safeTrackColor("#abc")).toBe("#abc");
    expect(safeTrackColor("red")).toBeNull();
    expect(safeTrackColor(null)).toBeNull();
  });
});
