import { z } from "zod";

/**
 * Auth magic-link DTOs (section 2.1) + event roles (section 2.2).
 * Commands: Auth.RequestMagicLink / Auth.ExchangeMagicLink / Auth.Logout
 * HTTP: POST /api/auth/magic-link | /api/auth/exchange | /api/auth/logout
 */

/**
 * event_memberships.role — SCHEMA.md (section 2.2).
 * Browser map: admin ⊂ most scopes; evaluator ⊂ score only; speaker ⊂ portal.
 */
export const EventRoleSchema = z.enum(["admin", "evaluator", "speaker"]);
export type EventRole = z.infer<typeof EventRoleSchema>;

/**
 * Magic-link purposes map 1:1 to membership roles for bootstrap invites.
 * evaluator added in 2.2 for role-guard journeys (B06).
 */
export const MagicLinkPurposeSchema = z.enum(["admin", "speaker", "evaluator"]);
export type MagicLinkPurpose = z.infer<typeof MagicLinkPurposeSchema>;

/** Auth.RequestMagicLink input */
export const RequestMagicLinkBodySchema = z.object({
  email: z.string().email().max(320),
  purpose: MagicLinkPurposeSchema,
  eventId: z.string().min(1).max(128).optional(),
});
export type RequestMagicLinkBody = z.infer<typeof RequestMagicLinkBodySchema>;

/** Auth.RequestMagicLink output — always sent:true (no email enumeration). */
export const RequestMagicLinkResponseSchema = z.object({
  sent: z.literal(true),
});
export type RequestMagicLinkResponse = z.infer<
  typeof RequestMagicLinkResponseSchema
>;

/** Auth.ExchangeMagicLink input */
export const ExchangeMagicLinkBodySchema = z.object({
  token: z.string().min(16).max(512),
});
export type ExchangeMagicLinkBody = z.infer<typeof ExchangeMagicLinkBodySchema>;

/** Auth.ExchangeMagicLink output (Set-Cookie is a side effect on the response). */
export const ExchangeMagicLinkResponseSchema = z.object({
  ok: z.literal(true),
  purpose: MagicLinkPurposeSchema,
  email: z.string().email(),
});
export type ExchangeMagicLinkResponse = z.infer<
  typeof ExchangeMagicLinkResponseSchema
>;

/** Session cookie name (HttpOnly Secure SameSite=Lax). */
export const SESSION_COOKIE_NAME = "speakerops_session" as const;

/** Magic-link TTL (minutes). */
export const MAGIC_LINK_TTL_MINUTES = 30 as const;

/** Session TTL (days). */
export const SESSION_TTL_DAYS = 14 as const;

/**
 * Dogfood default event id when magic-link purpose needs a membership
 * but no eventId was supplied (admin bootstrap / local e2e).
 */
export const DEFAULT_BOOTSTRAP_EVENT_ID = "evt_dogfood" as const;

/** Event.List item (minimal until full events module). */
export const EventListItemSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
});
export type EventListItem = z.infer<typeof EventListItemSchema>;

/** Event.List response — GET /api/events (admin). */
export const EventListResponseSchema = z.object({
  events: z.array(EventListItemSchema),
});
export type EventListResponse = z.infer<typeof EventListResponseSchema>;

/**
 * Schedule.Place input — POST /api/events/:eventId/schedule/place
 * Full conflict engine is section 6.1; 2.2 enforces role gate + Zod.
 */
export const SchedulePlaceBodySchema = z.object({
  sessionId: z.string().min(1).max(128),
  roomId: z.string().min(1).max(128),
  startsAt: z.string().min(1).max(64),
  endsAt: z.string().min(1).max(64),
  expectedVersion: z.number().int().positive().optional(),
});
export type SchedulePlaceBody = z.infer<typeof SchedulePlaceBodySchema>;

/** Schedule.Place success stub (placement id reserved; engine lands in 6.1). */
export const SchedulePlaceResponseSchema = z.object({
  ok: z.literal(true),
  placement: z.object({
    id: z.string().min(1),
    eventId: z.string().min(1),
    sessionId: z.string().min(1),
    roomId: z.string().min(1),
    startsAt: z.string().min(1),
    endsAt: z.string().min(1),
    version: z.number().int().positive(),
  }),
});
export type SchedulePlaceResponse = z.infer<typeof SchedulePlaceResponseSchema>;
