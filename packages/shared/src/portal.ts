import { z } from "zod";
import {
  EventParticipationSchema,
  ProgramSessionSchema,
  SpeakerTaskSchema,
  TaskTemplateSchema,
} from "./decisions.js";

/**
 * Portal + admin speakers + task templates DTOs (section 4.1 / S-PORTAL).
 *
 * Commands: Portal.GetHome · Task.Complete · Participation.UpdateProfile
 *           TaskTemplate.List/Create/Update/Delete · Speakers.List/Get
 * HTTP: GET  /api/portal/home
 *       PATCH /api/portal/participations/:id
 *       POST  /api/portal/tasks/:taskId/complete
 *       GET   /api/events/:eventId/speakers
 *       GET   /api/events/:eventId/speakers/:participationId
 *       GET|POST /api/events/:eventId/task-templates
 *       PATCH|DELETE /api/events/:eventId/task-templates/:templateId
 */

/** Full participation profile (portal + admin detail). */
export const ParticipationProfileSchema = EventParticipationSchema.extend({
  bio: z.string().nullable(),
  company: z.string().nullable(),
  title: z.string().nullable(),
  headshotFileId: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  /** Person display name when joined. */
  personName: z.string().nullable().optional(),
  /** Person email when joined (admin list / portal own). */
  personEmail: z.string().nullable().optional(),
});
export type ParticipationProfileDto = z.infer<typeof ParticipationProfileSchema>;

/** Max length accepted for a task-template resource link (Wave 2). */
export const TASK_LINK_URL_MAX_LENGTH = 2000 as const;

/**
 * True only for a well-formed absolute https:// URL (Wave 2 task links).
 * http:// is rejected on purpose — portal task links open in a new tab and
 * must never downgrade the speaker to an insecure origin.
 */
export function isHttpsUrl(value: string): boolean {
  if (value.length > TASK_LINK_URL_MAX_LENGTH) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Optional-nullable https link field shared by template create/update bodies. */
const TaskLinkUrlSchema = z
  .string()
  .max(TASK_LINK_URL_MAX_LENGTH)
  .refine(isHttpsUrl, {
    message: "linkUrl must be a valid https:// URL",
  })
  .nullable()
  .optional();

/** Task with template title for portal home. */
export const PortalTaskSchema = SpeakerTaskSchema.extend({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  trigger: z.enum(["on_accept", "manual"]).optional(),
  /** Template resource link, denormalized for portal cards (Wave 2). */
  linkUrl: z.string().nullable().optional(),
  /** True when this task blocks portal readiness until complete (Wave 2). */
  required: z.boolean().optional(),
});
export type PortalTaskDto = z.infer<typeof PortalTaskSchema>;

/** Portal.GetHome query — GET /api/portal/home?eventId= */
export const PortalHomeQuerySchema = z.object({
  eventId: z.string().min(1).max(128),
});
export type PortalHomeQuery = z.infer<typeof PortalHomeQuerySchema>;

/** Speaker readiness — single truth model for API + UI. */
export const PortalReadinessStateSchema = z.enum([
  "needs_action",
  "waiting_on_organiser",
  "ready",
  "complete",
]);
export type PortalReadinessState = z.infer<typeof PortalReadinessStateSchema>;

export const PortalReadinessSchema = z.object({
  state: PortalReadinessStateSchema,
  /** 0–100 combined profile + tasks. */
  percent: z.number().int().min(0).max(100),
  profileComplete: z.boolean(),
  profileDone: z.number().int().nonnegative(),
  profileTotal: z.number().int().positive(),
  tasksTotal: z.number().int().nonnegative(),
  tasksPending: z.number().int().nonnegative(),
  tasksCompleted: z.number().int().nonnegative(),
  /** Human headline for the next-action card. */
  headline: z.string().min(1),
  /** Supporting copy — never contradict headline. */
  detail: z.string().min(1),
});
export type PortalReadiness = z.infer<typeof PortalReadinessSchema>;

/** Uploaded file on portal home (headshot/slides) — durable after reload. */
export const PortalFileItemSchema = z.object({
  id: z.string().min(1),
  purpose: z.enum(["headshot", "slides", "logo"]),
  filename: z.string().nullable(),
  mime: z.string().min(1),
  uploaded: z.boolean(),
  updatedAt: z.string().min(1),
});
export type PortalFileItem = z.infer<typeof PortalFileItemSchema>;

/** Session placement when/where for the speaker. */
export const PortalSessionPlacementSchema = z.object({
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  roomId: z.string().nullable(),
  roomName: z.string().nullable(),
});
export type PortalSessionPlacement = z.infer<
  typeof PortalSessionPlacementSchema
>;

/** Portal session = programme session + optional schedule placement. */
export const PortalSessionSchema = ProgramSessionSchema.extend({
  placement: PortalSessionPlacementSchema.nullable().optional(),
});
export type PortalSessionDto = z.infer<typeof PortalSessionSchema>;

export const PortalHomeResponseSchema = z.object({
  eventId: z.string().min(1),
  /** Display name for the event (paid-product identity). */
  eventName: z.string().min(1),
  eventSlug: z.string().min(1).optional().nullable(),
  /** Event timezone for session when/where display. */
  eventTimezone: z.string().min(1).optional().nullable(),
  /** Published design tokens only (draft never leaked). */
  brandColor: z.string().nullable().optional(),
  brandSoft: z.string().nullable().optional(),
  brandFg: z.string().nullable().optional(),
  logoFileId: z.string().nullable().optional(),
  participations: z.array(ParticipationProfileSchema),
  tasks: z.array(PortalTaskSchema),
  sessions: z.array(PortalSessionSchema),
  /** Own uploaded files (headshot/slides) for durable UI. */
  files: z.array(PortalFileItemSchema).default([]),
  /** Next incomplete task (pending, not cancelled) ordered by dueAt then createdAt. */
  nextTask: PortalTaskSchema.nullable(),
  /** Single readiness contract — never celebrate incomplete profile as ready. */
  readiness: PortalReadinessSchema.optional(),
});
export type PortalHomeResponse = z.infer<typeof PortalHomeResponseSchema>;

/** Participation.UpdateProfile body */
export const ParticipationUpdateProfileBodySchema = z
  .object({
    bio: z.string().max(8000).nullable().optional(),
    company: z.string().max(200).nullable().optional(),
    title: z.string().max(200).nullable().optional(),
    headshotFileId: z.string().min(1).max(128).nullable().optional(),
    expectedVersion: z.number().int().positive(),
  })
  .refine(
    (b) =>
      b.bio !== undefined ||
      b.company !== undefined ||
      b.title !== undefined ||
      b.headshotFileId !== undefined,
    { message: "At least one profile field is required" },
  );
export type ParticipationUpdateProfileBody = z.infer<
  typeof ParticipationUpdateProfileBodySchema
>;

export const ParticipationUpdateProfileResponseSchema = z.object({
  participation: ParticipationProfileSchema,
});
export type ParticipationUpdateProfileResponse = z.infer<
  typeof ParticipationUpdateProfileResponseSchema
>;

/** Task.Complete body */
export const TaskCompleteBodySchema = z.object({
  expectedVersion: z.number().int().positive(),
});
export type TaskCompleteBody = z.infer<typeof TaskCompleteBodySchema>;

export const TaskCompleteResponseSchema = z.object({
  task: SpeakerTaskSchema,
});
export type TaskCompleteResponse = z.infer<typeof TaskCompleteResponseSchema>;

/** Admin speakers list item */
export const AdminSpeakerListItemSchema = z.object({
  participation: ParticipationProfileSchema,
  pendingTaskCount: z.number().int().nonnegative(),
  completedTaskCount: z.number().int().nonnegative(),
  sessionCount: z.number().int().nonnegative(),
});
export type AdminSpeakerListItem = z.infer<typeof AdminSpeakerListItemSchema>;

export const AdminSpeakersListQuerySchema = z.object({
  q: z.string().max(200).optional(),
  status: z.string().max(64).optional(),
});
export type AdminSpeakersListQuery = z.infer<typeof AdminSpeakersListQuerySchema>;

export const AdminSpeakersListResponseSchema = z.object({
  speakers: z.array(AdminSpeakerListItemSchema),
  eventId: z.string().min(1),
});
export type AdminSpeakersListResponse = z.infer<
  typeof AdminSpeakersListResponseSchema
>;

/** File metadata for admin speaker detail (N03/N04) — no binary bytes. */
export const SpeakerFileMetaSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  ownerParticipationId: z.string().nullable(),
  filename: z.string().min(1),
  mime: z.string().min(1),
  size: z.number().int().nonnegative(),
  purpose: z.string().min(1),
  uploaded: z.number().int(),
  checksum: z.string().nullable().optional(),
  createdAt: z.string().min(1),
});
export type SpeakerFileMetaDto = z.infer<typeof SpeakerFileMetaSchema>;

export const AdminSpeakerDetailResponseSchema = z.object({
  participation: ParticipationProfileSchema,
  tasks: z.array(PortalTaskSchema),
  sessions: z.array(ProgramSessionSchema),
  files: z.array(SpeakerFileMetaSchema),
});
export type AdminSpeakerDetailResponse = z.infer<
  typeof AdminSpeakerDetailResponseSchema
>;

/**
 * Speakers.UpdateProfile — admin edits speaker programme profile
 * (bio / company / title / headshot) on behalf of the speaker.
 * Same body shape as Participation.UpdateProfile.
 */
export const SpeakersUpdateProfileBodySchema =
  ParticipationUpdateProfileBodySchema;
export type SpeakersUpdateProfileBody = ParticipationUpdateProfileBody;

export const SpeakersUpdateProfileResponseSchema =
  ParticipationUpdateProfileResponseSchema;
export type SpeakersUpdateProfileResponse = ParticipationUpdateProfileResponse;

/** Task template CRUD (O05) */
export const TaskTemplateCreateBodySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).nullable().optional(),
  trigger: z.enum(["on_accept", "manual"]).default("on_accept"),
  dueOffsetDays: z.number().int().min(0).max(3650).default(14),
  /** Optional https:// resource link for portal task cards (Wave 2). */
  linkUrl: TaskLinkUrlSchema,
  /**
   * When true, incomplete tasks from this template block readiness (Wave 2).
   * Defaults to TRUE (0032 repair): tasks block readiness unless the
   * organizer explicitly opts into optional.
   */
  required: z.boolean().default(true),
});
export type TaskTemplateCreateBody = z.infer<typeof TaskTemplateCreateBodySchema>;

export const TaskTemplateUpdateBodySchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(4000).nullable().optional(),
    trigger: z.enum(["on_accept", "manual"]).optional(),
    dueOffsetDays: z.number().int().min(0).max(3650).optional(),
    /** Set an https:// link, or null to clear it (Wave 2). */
    linkUrl: TaskLinkUrlSchema,
    /** Toggle whether incomplete tasks block readiness (Wave 2). */
    required: z.boolean().optional(),
    /** Required for optimistic concurrency on task_templates (E1). */
    expectedVersion: z.number().int().positive(),
  })
  .refine(
    (b) =>
      b.title !== undefined ||
      b.description !== undefined ||
      b.trigger !== undefined ||
      b.dueOffsetDays !== undefined ||
      b.linkUrl !== undefined ||
      b.required !== undefined,
    { message: "At least one field is required" },
  );
export type TaskTemplateUpdateBody = z.infer<typeof TaskTemplateUpdateBodySchema>;

export const TaskTemplateListResponseSchema = z.object({
  templates: z.array(TaskTemplateSchema),
  eventId: z.string().min(1),
});
export type TaskTemplateListResponse = z.infer<
  typeof TaskTemplateListResponseSchema
>;

export const TaskTemplateResponseSchema = z.object({
  template: TaskTemplateSchema,
});
export type TaskTemplateResponse = z.infer<typeof TaskTemplateResponseSchema>;

/** TaskTemplate.Delete body — optimistic concurrency (E1). */
export const TaskTemplateDeleteBodySchema = z.object({
  expectedVersion: z.number().int().positive(),
});
export type TaskTemplateDeleteBody = z.infer<typeof TaskTemplateDeleteBodySchema>;

export const TaskTemplateDeleteResponseSchema = z.object({
  deleted: z.literal(true),
  id: z.string().min(1),
});
export type TaskTemplateDeleteResponse = z.infer<
  typeof TaskTemplateDeleteResponseSchema
>;
