import { z } from "zod";

/**
 * Agenda settings — event-level schedule grid configuration (Wave 2).
 *
 * Stored inside events.settings_json (same passthrough blob the Wave 1B
 * notification settings use — no migration, unknown keys preserved).
 *
 * Keys:
 *   agendaDayStart  "HH:MM" wall time in the event timezone (default 09:00)
 *   agendaDayEnd    "HH:MM" wall time in the event timezone (default 17:00)
 *   slotIntervalMin 15 | 30 | 60 grid/snap step in minutes (default 60)
 *
 * The API enforces the day window on Schedule.Place / Schedule.Move
 * (409 CONFLICT, conflicts[] type "hours") — the grid UI mirrors it.
 */

/** Allowed schedule grid steps in minutes. */
export const AGENDA_SLOT_INTERVALS = [15, 30, 60] as const;
export type AgendaSlotInterval = (typeof AGENDA_SLOT_INTERVALS)[number];

/** 24h wall-clock "HH:MM" (00:00–23:59). */
export const HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
export const HhMmSchema = z.string().regex(HHMM_REGEX, "Use HH:MM (24h)");

export const AGENDA_DEFAULT_DAY_START = "09:00" as const;
export const AGENDA_DEFAULT_DAY_END = "17:00" as const;
export const AGENDA_DEFAULT_SLOT_INTERVAL: AgendaSlotInterval = 60;

/**
 * Structured agenda settings stored inside events.settings_json.
 * Unknown keys are preserved (passthrough) so notification settings and
 * future features can share the same JSON blob without clobbering.
 */
export const EventAgendaSettingsSchema = z
  .object({
    agendaDayStart: HhMmSchema.optional(),
    agendaDayEnd: HhMmSchema.optional(),
    slotIntervalMin: z
      .union([z.literal(15), z.literal(30), z.literal(60)])
      .optional(),
  })
  .passthrough();
export type EventAgendaSettings = z.infer<typeof EventAgendaSettingsSchema>;

/** Normalized view of the agenda settings with defaults applied. */
export type ResolvedEventAgendaSettings = {
  agendaDayStart: string;
  agendaDayEnd: string;
  slotIntervalMin: AgendaSlotInterval;
};

/** "HH:MM" → minutes since local midnight; null when malformed. */
export function hhmmToMinutes(s: string): number | null {
  if (!HHMM_REGEX.test(s)) return null;
  const [h, m] = s.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

/**
 * Parse events.settings_json into agenda settings.
 * Malformed JSON, unexpected shapes, or an inverted window (start >= end)
 * fall back to defaults — settings parsing must never break scheduling.
 */
export function parseEventAgendaSettings(
  settingsJson: string | null | undefined,
): ResolvedEventAgendaSettings {
  const defaults: ResolvedEventAgendaSettings = {
    agendaDayStart: AGENDA_DEFAULT_DAY_START,
    agendaDayEnd: AGENDA_DEFAULT_DAY_END,
    slotIntervalMin: AGENDA_DEFAULT_SLOT_INTERVAL,
  };
  if (settingsJson == null || settingsJson.trim() === "") return defaults;
  let raw: unknown;
  try {
    raw = JSON.parse(settingsJson);
  } catch {
    return defaults;
  }
  const parsed = EventAgendaSettingsSchema.safeParse(raw);
  if (!parsed.success) return defaults;
  const resolved: ResolvedEventAgendaSettings = {
    agendaDayStart: parsed.data.agendaDayStart ?? defaults.agendaDayStart,
    agendaDayEnd: parsed.data.agendaDayEnd ?? defaults.agendaDayEnd,
    slotIntervalMin: parsed.data.slotIntervalMin ?? defaults.slotIntervalMin,
  };
  // Sanity: an inverted or empty window would produce a zero-slot day.
  const start = hhmmToMinutes(resolved.agendaDayStart);
  const end = hhmmToMinutes(resolved.agendaDayEnd);
  if (start == null || end == null || start >= end) {
    return { ...defaults, slotIntervalMin: resolved.slotIntervalMin };
  }
  return resolved;
}

/**
 * True when settings_json explicitly configures the agenda day window
 * (either bound). The Schedule Studio grid uses this to decide between the
 * configured window and its legacy event-start/end clamping behavior.
 */
export function hasExplicitAgendaWindow(
  settingsJson: string | null | undefined,
): boolean {
  if (settingsJson == null || settingsJson.trim() === "") return false;
  let raw: unknown;
  try {
    raw = JSON.parse(settingsJson);
  } catch {
    return false;
  }
  const parsed = EventAgendaSettingsSchema.safeParse(raw);
  if (!parsed.success) return false;
  return (
    parsed.data.agendaDayStart !== undefined ||
    parsed.data.agendaDayEnd !== undefined
  );
}

/**
 * Merge agenda settings into an existing settings_json string, preserving
 * unrelated keys (notification settings etc). Returns the JSON to PATCH back.
 * Mirrors mergeEventNotificationSettings (Wave 1B).
 */
export function mergeEventAgendaSettings(
  settingsJson: string | null | undefined,
  patch: Partial<
    Pick<
      EventAgendaSettings,
      "agendaDayStart" | "agendaDayEnd" | "slotIntervalMin"
    >
  >,
): string {
  let base: Record<string, unknown> = {};
  if (settingsJson != null && settingsJson.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(settingsJson);
      if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
        base = parsed as Record<string, unknown>;
      }
    } catch {
      base = {};
    }
  }
  return JSON.stringify({ ...base, ...patch });
}

/**
 * Wall-clock minutes since local midnight for an instant in an IANA timezone.
 * Invalid ISO → null. Invalid/unknown timezone → falls back to UTC wall time.
 * Used by the API to check placements against the configured day window.
 */
export function wallMinutesInZone(
  iso: string,
  timeZone: string,
): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      hourCycle: "h23",
    });
    const parts = dtf.formatToParts(d);
    let hour = 0;
    let minute = 0;
    for (const p of parts) {
      if (p.type === "hour") hour = Number(p.value) % 24;
      if (p.type === "minute") minute = Number(p.value);
    }
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return hour * 60 + minute;
  } catch {
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }
}

/**
 * Calendar day key (YYYY-MM-DD) of an instant in an IANA timezone.
 * Invalid ISO → null. Invalid timezone → UTC fallback. The API uses this to
 * reject placements that cross local midnight (start/end on different days).
 */
export function wallDayKeyInZone(
  iso: string,
  timeZone: string,
): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
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
