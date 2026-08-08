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

/**
 * Auth.DevRoleSwitch — dogfood/dev only (section 8.4).
 * POST /api/auth/dev/role-switch — never registered in production default.
 */
export const DevRoleSwitchBodySchema = z.object({
  role: EventRoleSchema,
  /** Optional event for membership verification (defaults to dogfood event). */
  eventId: z.string().min(1).max(128).optional(),
});
export type DevRoleSwitchBody = z.infer<typeof DevRoleSwitchBodySchema>;

export const DevRoleSwitchResponseSchema = z.object({
  ok: z.literal(true),
  role: EventRoleSchema,
  email: z.string().email(),
  eventId: z.string().min(1),
  /** Path hint for the SPA after switch. */
  redirectTo: z.string().min(1),
});
export type DevRoleSwitchResponse = z.infer<typeof DevRoleSwitchResponseSchema>;

/**
 * Deterministic demo emails for role switcher (must match scripts/seed.ts).
 * Not secrets — public demo accounts for dogfood judges.
 */
export const DEMO_ROLE_EMAILS = {
  admin: "admin@demo.speakerops.local",
  evaluator: "evaluator@demo.speakerops.local",
  speaker: "speaker@demo.speakerops.local",
} as const satisfies Record<EventRole, string>;

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

/**
 * Event.List item — id + name always; full fields optional for 2.3+ consumers.
 * Keep backward-compatible with earlier admin list probes.
 */
export const EventListItemSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  orgId: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  timezone: z.string().min(1).optional(),
  startsAt: z.string().nullable().optional(),
  endsAt: z.string().nullable().optional(),
  settingsJson: z.string().nullable().optional(),
  createdAt: z.string().min(1).optional(),
  updatedAt: z.string().min(1).optional(),
  version: z.number().int().positive().optional(),
});
export type EventListItem = z.infer<typeof EventListItemSchema>;

/** Event.List response — GET /api/events (admin). */
export const EventListResponseSchema = z.object({
  events: z.array(EventListItemSchema),
});
export type EventListResponse = z.infer<typeof EventListResponseSchema>;

/**
 * Schedule DTOs live in schedule.ts (section 6.1).
 * Re-exported here for backward-compatible imports from auth-era 2.2 gates.
 */
export {
  SchedulePlaceBodySchema,
  type SchedulePlaceBody,
  SchedulePlaceResponseSchema,
  type SchedulePlaceResponse,
} from "./schedule.js";
