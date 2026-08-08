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

/** Task with template title for portal home. */
export const PortalTaskSchema = SpeakerTaskSchema.extend({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  trigger: z.enum(["on_accept", "manual"]).optional(),
});
export type PortalTaskDto = z.infer<typeof PortalTaskSchema>;

/** Portal.GetHome query — GET /api/portal/home?eventId= */
export const PortalHomeQuerySchema = z.object({
  eventId: z.string().min(1).max(128),
});
export type PortalHomeQuery = z.infer<typeof PortalHomeQuerySchema>;

export const PortalHomeResponseSchema = z.object({
  eventId: z.string().min(1),
  participations: z.array(ParticipationProfileSchema),
  tasks: z.array(PortalTaskSchema),
  sessions: z.array(ProgramSessionSchema),
  /** Next incomplete task (pending, not cancelled) ordered by dueAt then createdAt. */
  nextTask: PortalTaskSchema.nullable(),
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

/** Task template CRUD (O05) */
export const TaskTemplateCreateBodySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).nullable().optional(),
  trigger: z.enum(["on_accept", "manual"]).default("on_accept"),
  dueOffsetDays: z.number().int().min(0).max(3650).default(14),
});
export type TaskTemplateCreateBody = z.infer<typeof TaskTemplateCreateBodySchema>;

export const TaskTemplateUpdateBodySchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(4000).nullable().optional(),
    trigger: z.enum(["on_accept", "manual"]).optional(),
    dueOffsetDays: z.number().int().min(0).max(3650).optional(),
    /** Required for optimistic concurrency on task_templates (E1). */
    expectedVersion: z.number().int().positive(),
  })
  .refine(
    (b) =>
      b.title !== undefined ||
      b.description !== undefined ||
      b.trigger !== undefined ||
      b.dueOffsetDays !== undefined,
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
