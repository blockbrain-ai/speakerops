/**
 * Wave 2 — event agenda settings unit tests (settings_json passthrough).
 */
import { describe, it, expect } from "vitest";
import {
  AGENDA_SLOT_INTERVALS,
  HHMM_REGEX,
  EventAgendaSettingsSchema,
  parseEventAgendaSettings,
  mergeEventAgendaSettings,
  hasExplicitAgendaWindow,
  hhmmToMinutes,
  wallMinutesInZone,
  wallDayKeyInZone,
} from "./agenda.js";
import {
  mergeEventNotificationSettings,
  parseEventNotificationSettings,
} from "./lifecycle.js";

describe("event agenda settings (Wave 2)", () => {
  it("parse falls back to defaults for null/empty/malformed settings_json", () => {
    const expected = {
      agendaDayStart: "09:00",
      agendaDayEnd: "17:00",
      slotIntervalMin: 60,
    };
    expect(parseEventAgendaSettings(null)).toEqual(expected);
    expect(parseEventAgendaSettings(undefined)).toEqual(expected);
    expect(parseEventAgendaSettings("")).toEqual(expected);
    expect(parseEventAgendaSettings("   ")).toEqual(expected);
    expect(parseEventAgendaSettings("{not json")).toEqual(expected);
    expect(parseEventAgendaSettings('"just a string"')).toEqual(expected);
    // Invalid shapes fall back too (never throw)
    expect(
      parseEventAgendaSettings(
        JSON.stringify({ agendaDayStart: "25:99", slotIntervalMin: 45 }),
      ),
    ).toEqual(expected);
  });

  it("parse resolves configured values and keeps per-key defaults", () => {
    expect(
      parseEventAgendaSettings(
        JSON.stringify({
          agendaDayStart: "10:00",
          agendaDayEnd: "16:00",
          slotIntervalMin: 30,
        }),
      ),
    ).toEqual({
      agendaDayStart: "10:00",
      agendaDayEnd: "16:00",
      slotIntervalMin: 30,
    });
    // Partial config: unset keys use defaults
    expect(
      parseEventAgendaSettings(JSON.stringify({ slotIntervalMin: 15 })),
    ).toEqual({
      agendaDayStart: "09:00",
      agendaDayEnd: "17:00",
      slotIntervalMin: 15,
    });
  });

  it("parse sanity-falls-back when start >= end (keeps interval)", () => {
    expect(
      parseEventAgendaSettings(
        JSON.stringify({
          agendaDayStart: "18:00",
          agendaDayEnd: "09:00",
          slotIntervalMin: 15,
        }),
      ),
    ).toEqual({
      agendaDayStart: "09:00",
      agendaDayEnd: "17:00",
      slotIntervalMin: 15,
    });
    expect(
      parseEventAgendaSettings(
        JSON.stringify({ agendaDayStart: "12:00", agendaDayEnd: "12:00" }),
      ),
    ).toEqual({
      agendaDayStart: "09:00",
      agendaDayEnd: "17:00",
      slotIntervalMin: 60,
    });
  });

  it("schema passthrough preserves unknown keys", () => {
    const parsed = EventAgendaSettingsSchema.parse({
      agendaDayStart: "08:00",
      submissionConfirmationEnabled: false,
      someFutureKey: { nested: true },
    });
    expect(
      (parsed as Record<string, unknown>).submissionConfirmationEnabled,
    ).toBe(false);
    expect((parsed as Record<string, unknown>).someFutureKey).toEqual({
      nested: true,
    });
  });

  it("merge preserves notification keys and unknown keys", () => {
    const base = mergeEventNotificationSettings(null, {
      submissionConfirmationEnabled: false,
      notifySubmissionEmails: ["team@example.com"],
    });
    const merged = mergeEventAgendaSettings(base, {
      agendaDayStart: "10:00",
      agendaDayEnd: "16:00",
      slotIntervalMin: 30,
    });
    const obj = JSON.parse(merged) as Record<string, unknown>;
    expect(obj.agendaDayStart).toBe("10:00");
    expect(obj.agendaDayEnd).toBe("16:00");
    expect(obj.slotIntervalMin).toBe(30);
    expect(obj.submissionConfirmationEnabled).toBe(false);
    expect(obj.notifySubmissionEmails).toEqual(["team@example.com"]);
    // And the other direction: notification parse still sees its keys
    const notify = parseEventNotificationSettings(merged);
    expect(notify.submissionConfirmationEnabled).toBe(false);
    expect(notify.notifySubmissionEmails).toEqual(["team@example.com"]);
  });

  it("merge tolerates malformed base JSON", () => {
    const merged = mergeEventAgendaSettings("{oops", {
      agendaDayStart: "10:30",
    });
    expect(JSON.parse(merged)).toEqual({ agendaDayStart: "10:30" });
  });

  it("hasExplicitAgendaWindow only true when a bound is configured", () => {
    expect(hasExplicitAgendaWindow(null)).toBe(false);
    expect(hasExplicitAgendaWindow("{bad json")).toBe(false);
    expect(
      hasExplicitAgendaWindow(JSON.stringify({ slotIntervalMin: 30 })),
    ).toBe(false);
    expect(
      hasExplicitAgendaWindow(JSON.stringify({ agendaDayStart: "10:00" })),
    ).toBe(true);
    expect(
      hasExplicitAgendaWindow(JSON.stringify({ agendaDayEnd: "16:00" })),
    ).toBe(true);
  });

  it("hhmmToMinutes and HHMM regex validate 24h wall times", () => {
    expect(hhmmToMinutes("00:00")).toBe(0);
    expect(hhmmToMinutes("09:30")).toBe(570);
    expect(hhmmToMinutes("23:59")).toBe(1439);
    expect(hhmmToMinutes("24:00")).toBeNull();
    expect(hhmmToMinutes("9:00")).toBeNull();
    expect(hhmmToMinutes("nope")).toBeNull();
    expect(HHMM_REGEX.test("17:00")).toBe(true);
    expect(HHMM_REGEX.test("17:60")).toBe(false);
    expect(AGENDA_SLOT_INTERVALS).toEqual([15, 30, 60]);
  });

  it("wallMinutesInZone computes wall minutes across timezones", () => {
    // UTC: 14:30Z → 14:30 wall
    expect(wallMinutesInZone("2026-09-01T14:30:00.000Z", "UTC")).toBe(
      14 * 60 + 30,
    );
    // America/New_York (EDT, UTC-4): 14:00Z → 10:00 wall
    expect(
      wallMinutesInZone("2026-09-01T14:00:00.000Z", "America/New_York"),
    ).toBe(10 * 60);
    // Australia/Sydney (AEST, UTC+10): 01:00Z → 11:00 wall
    expect(
      wallMinutesInZone("2026-09-01T01:00:00.000Z", "Australia/Sydney"),
    ).toBe(11 * 60);
    // Invalid timezone falls back to UTC wall clock
    expect(wallMinutesInZone("2026-09-01T08:15:00.000Z", "Not/AZone")).toBe(
      8 * 60 + 15,
    );
    // Invalid ISO → null
    expect(wallMinutesInZone("not-a-date", "UTC")).toBeNull();
  });

  it("wallDayKeyInZone resolves local calendar day", () => {
    expect(wallDayKeyInZone("2026-09-01T23:30:00.000Z", "UTC")).toBe(
      "2026-09-01",
    );
    // 01:00Z on Sep 2 is still Sep 1 evening in New York
    expect(
      wallDayKeyInZone("2026-09-02T01:00:00.000Z", "America/New_York"),
    ).toBe("2026-09-01");
    expect(wallDayKeyInZone("nope", "UTC")).toBeNull();
    // Invalid timezone → UTC fallback
    expect(wallDayKeyInZone("2026-09-01T10:00:00.000Z", "Not/AZone")).toBe(
      "2026-09-01",
    );
  });
});
