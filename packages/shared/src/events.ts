import { z } from "zod";

/**
 * Event settings DTOs (section 2.3).
 * Commands: Event.Create / Event.Update / Event.List / Room.Upsert / Track.Upsert
 * HTTP: COMMANDS.md event + rooms/tracks map
 */

/** Dogfood default organization when Event.Create has no orgId. */
export const DEFAULT_ORG_ID = "org_dogfood" as const;

/** IANA-ish timezone string (not full IANA enum — accept common labels). */
export const TimezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_+\-\/]+$/, "Invalid timezone");

/** Event aggregate response shape (SCHEMA.md events). */
export const EventSchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  timezone: z.string().min(1),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  settingsJson: z.string().nullable().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  version: z.number().int().positive(),
});
export type EventDto = z.infer<typeof EventSchema>;

/** Event.Create input — POST /api/events */
export const EventCreateBodySchema = z.object({
  name: z.string().min(1).max(200),
  timezone: TimezoneSchema,
  startsAt: z.string().min(1).max(64).optional().nullable(),
  endsAt: z.string().min(1).max(64).optional().nullable(),
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be kebab-case")
    .optional(),
  orgId: z.string().min(1).max(128).optional(),
});
export type EventCreateBody = z.infer<typeof EventCreateBodySchema>;

/** Event.Create / Event.Update response */
export const EventResponseSchema = z.object({
  event: EventSchema,
});
export type EventResponse = z.infer<typeof EventResponseSchema>;

/** Event.Update input — PATCH /api/events/:eventId */
export const EventUpdateBodySchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    timezone: TimezoneSchema.optional(),
    startsAt: z.string().min(1).max(64).nullable().optional(),
    endsAt: z.string().min(1).max(64).nullable().optional(),
    settingsJson: z.string().max(16_000).nullable().optional(),
    expectedVersion: z.number().int().positive(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.timezone !== undefined ||
      v.startsAt !== undefined ||
      v.endsAt !== undefined ||
      v.settingsJson !== undefined,
    { message: "At least one field to update is required" },
  );
export type EventUpdateBody = z.infer<typeof EventUpdateBodySchema>;

/** Event.List item — full enough for switcher + settings. */
export const EventListItemFullSchema = EventSchema;
export type EventListItemFull = z.infer<typeof EventListItemFullSchema>;

/** Event.List response — GET /api/events (admin). */
export const EventListResponseFullSchema = z.object({
  events: z.array(EventListItemFullSchema),
});
export type EventListResponseFull = z.infer<typeof EventListResponseFullSchema>;

/**
 * Event members roster — GET /api/events/:eventId/members?role=evaluator
 * Admin cohort ops (assignment picker + workload counts).
 */
export const EventMemberSchema = z.object({
  userId: z.string().min(1),
  email: z.string().min(1),
  role: z.enum(["admin", "evaluator", "speaker"]),
  /** Assignments on the event's active eval round; 0 when no round. */
  assignmentCount: z.number().int().nonnegative(),
});
export type EventMember = z.infer<typeof EventMemberSchema>;

export const EventMembersResponseSchema = z.object({
  members: z.array(EventMemberSchema),
});
export type EventMembersResponse = z.infer<typeof EventMembersResponseSchema>;

/** Room entity (SCHEMA.md rooms). */
export const RoomSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  name: z.string().min(1),
  capacity: z.number().int().nonnegative().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  version: z.number().int().positive(),
});
export type RoomDto = z.infer<typeof RoomSchema>;

/** Room.Upsert body — PUT /api/events/:eventId/rooms/:roomId */
export const RoomUpsertBodySchema = z.object({
  name: z.string().min(1).max(200),
  capacity: z.number().int().nonnegative().nullable().optional(),
  expectedVersion: z.number().int().positive().optional(),
});
export type RoomUpsertBody = z.infer<typeof RoomUpsertBodySchema>;

export const RoomResponseSchema = z.object({
  room: RoomSchema,
});
export type RoomResponse = z.infer<typeof RoomResponseSchema>;

export const RoomListResponseSchema = z.object({
  rooms: z.array(RoomSchema),
});
export type RoomListResponse = z.infer<typeof RoomListResponseSchema>;

/** Track entity (SCHEMA.md tracks). */
export const TrackSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  name: z.string().min(1),
  color: z.string().max(32).nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  version: z.number().int().positive(),
});
export type TrackDto = z.infer<typeof TrackSchema>;

/** Track.Upsert body — PUT /api/events/:eventId/tracks/:trackId */
export const TrackUpsertBodySchema = z.object({
  name: z.string().min(1).max(200),
  color: z.string().max(32).nullable().optional(),
  expectedVersion: z.number().int().positive().optional(),
});
export type TrackUpsertBody = z.infer<typeof TrackUpsertBodySchema>;

export const TrackResponseSchema = z.object({
  track: TrackSchema,
});
export type TrackResponse = z.infer<typeof TrackResponseSchema>;

export const TrackListResponseSchema = z.object({
  tracks: z.array(TrackSchema),
});
export type TrackListResponse = z.infer<typeof TrackListResponseSchema>;
