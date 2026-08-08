import { z } from "zod";
import { IsoDateTimeStringSchema } from "./comms.js";

/**
 * Schedule conflict engine DTOs (section 6.1 / S-SCHED).
 * Commands: Schedule.List · Schedule.Place · Schedule.Move · Schedule.Unschedule
 * HTTP map: COMMANDS.md schedule routes.
 * No OR-Tools — hard room/speaker overlap detection only.
 */

/** Plain conflict type codes for 409 CONFLICT responses. */
export const ScheduleConflictTypeSchema = z.enum([
  "room",
  "speaker",
  "session",
]);
export type ScheduleConflictType = z.infer<typeof ScheduleConflictTypeSchema>;

export const ScheduleConflictItemSchema = z.object({
  type: ScheduleConflictTypeSchema,
  message: z.string().min(1),
  /** Optional entity ids for UI recovery (room/speaker/placement). */
  roomId: z.string().min(1).optional(),
  participationId: z.string().min(1).optional(),
  placementId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
});
export type ScheduleConflictItem = z.infer<typeof ScheduleConflictItemSchema>;

export const SchedulePlacementSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  sessionId: z.string().min(1),
  roomId: z.string().min(1),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  version: z.number().int().positive(),
});
export type SchedulePlacementDto = z.infer<typeof SchedulePlacementSchema>;

/**
 * Schedule.Place input — POST /api/events/:eventId/schedule/place
 * expectedVersion is placement version when re-asserting; omitted on first place.
 * (Session already-placed → conflict type session.)
 */
export const SchedulePlaceBodySchema = z
  .object({
    sessionId: z.string().min(1).max(128),
    roomId: z.string().min(1).max(128),
    startsAt: IsoDateTimeStringSchema,
    endsAt: IsoDateTimeStringSchema,
    expectedVersion: z.number().int().positive().optional(),
  })
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), {
    message: "endsAt must be after startsAt",
    path: ["endsAt"],
  });
export type SchedulePlaceBody = z.infer<typeof SchedulePlaceBodySchema>;

export const SchedulePlaceResponseSchema = z.object({
  ok: z.literal(true),
  placement: SchedulePlacementSchema,
});
export type SchedulePlaceResponse = z.infer<typeof SchedulePlaceResponseSchema>;

/**
 * Schedule.Move — POST /api/events/:eventId/schedule/move
 * expectedVersion required (placement.version; E1).
 */
export const ScheduleMoveBodySchema = z
  .object({
    placementId: z.string().min(1).max(128),
    roomId: z.string().min(1).max(128),
    startsAt: IsoDateTimeStringSchema,
    endsAt: IsoDateTimeStringSchema,
    expectedVersion: z.number().int().positive(),
  })
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), {
    message: "endsAt must be after startsAt",
    path: ["endsAt"],
  });
export type ScheduleMoveBody = z.infer<typeof ScheduleMoveBodySchema>;

export const ScheduleMoveResponseSchema = z.object({
  ok: z.literal(true),
  placement: SchedulePlacementSchema,
});
export type ScheduleMoveResponse = z.infer<typeof ScheduleMoveResponseSchema>;

/**
 * Schedule.Unschedule — POST /api/events/:eventId/schedule/unschedule
 * expectedVersion required (placement.version; E1).
 */
export const ScheduleUnscheduleBodySchema = z.object({
  placementId: z.string().min(1).max(128),
  expectedVersion: z.number().int().positive(),
});
export type ScheduleUnscheduleBody = z.infer<
  typeof ScheduleUnscheduleBodySchema
>;

export const ScheduleUnscheduleResponseSchema = z.object({
  ok: z.literal(true),
  placementId: z.string().min(1),
});
export type ScheduleUnscheduleResponse = z.infer<
  typeof ScheduleUnscheduleResponseSchema
>;

/** Optional view hint for Schedule.List (UI 6.2 consumes; API returns full set). */
export const ScheduleViewSchema = z
  .enum(["list", "day", "week", "track", "room"])
  .optional();
export type ScheduleView = z.infer<typeof ScheduleViewSchema>;

export const UnscheduledSessionSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  title: z.string().min(1),
  trackId: z.string().nullable(),
  status: z.string().min(1),
  version: z.number().int().positive(),
});
export type UnscheduledSessionDto = z.infer<typeof UnscheduledSessionSchema>;

export const ScheduleListResponseSchema = z.object({
  placements: z.array(SchedulePlacementSchema),
  unscheduled: z.array(UnscheduledSessionSchema),
  view: z.string().optional(),
});
export type ScheduleListResponse = z.infer<typeof ScheduleListResponseSchema>;

/**
 * 409 CONFLICT body for schedule hard conflicts.
 * E4 envelope + top-level conflicts[] (COMMANDS interface for 6.1).
 */
export const ScheduleConflictErrorSchema = z.object({
  error: z.string().min(1),
  code: z.literal("CONFLICT"),
  conflicts: z.array(ScheduleConflictItemSchema).min(1),
  details: z.unknown().optional(),
});
export type ScheduleConflictError = z.infer<typeof ScheduleConflictErrorSchema>;
