/**
 * F7 / P11 — public programme read model + publish gate.
 * Group decision: no first-class Group aggregate; Contact/Group/Submission
 * features scope to Person / Participation / Submission (see KMS F7 note).
 */
import { z } from "zod";

export const PublicSpeakerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  title: z.string().nullable(),
  company: z.string().nullable(),
  bio: z.string().nullable(),
  headshotUrl: z.string().nullable(),
  roleLabel: z.string().nullable(),
});
export type PublicSpeaker = z.infer<typeof PublicSpeakerSchema>;

export const PublicSessionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable(),
  trackId: z.string().nullable(),
  trackName: z.string().nullable(),
  trackColor: z.string().nullable(),
  status: z.string(),
  speakers: z.array(
    z.object({
      participationId: z.string(),
      name: z.string(),
      isPrimary: z.boolean(),
    }),
  ),
  /** ISO start when scheduled; null if unscheduled. */
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  roomId: z.string().nullable(),
  roomName: z.string().nullable(),
});
export type PublicSession = z.infer<typeof PublicSessionSchema>;

export const PublicAgendaItemSchema = z.object({
  placementId: z.string(),
  sessionId: z.string(),
  title: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  roomName: z.string().nullable(),
  trackName: z.string().nullable(),
  trackColor: z.string().nullable(),
  speakerNames: z.array(z.string()),
});
export type PublicAgendaItem = z.infer<typeof PublicAgendaItemSchema>;

export const PublicProgrammeResponseSchema = z.object({
  event: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    timezone: z.string(),
    startsAt: z.string().nullable(),
    endsAt: z.string().nullable(),
  }),
  publishedAt: z.string(),
  version: z.number().int().positive(),
  sessions: z.array(PublicSessionSchema),
  speakers: z.array(PublicSpeakerSchema),
  agenda: z.array(PublicAgendaItemSchema),
});
export type PublicProgrammeResponse = z.infer<
  typeof PublicProgrammeResponseSchema
>;

export const ProgrammePublishResponseSchema = z.object({
  publishedAt: z.string(),
  version: z.number().int().positive(),
  sessionCount: z.number().int().nonnegative(),
  speakerCount: z.number().int().nonnegative(),
});
export type ProgrammePublishResponse = z.infer<
  typeof ProgrammePublishResponseSchema
>;

export const ProgrammeStatusResponseSchema = z.object({
  published: z.boolean(),
  publishedAt: z.string().nullable(),
  version: z.number().int().nonnegative(),
});
export type ProgrammeStatusResponse = z.infer<
  typeof ProgrammeStatusResponseSchema
>;
