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

/** Auth.RequestMagicLink input — purpose optional (defaults speaker for invite links). */
export const RequestMagicLinkBodySchema = z.object({
  email: z.string().email().max(320),
  /** Optional when invite/query already carries role; defaults to speaker. */
  purpose: MagicLinkPurposeSchema.optional(),
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

/**
 * Durable outbox topic for magic-link email delivery (E7).
 * Request path inserts encrypted payload; queue/cron consumer decrypts + sends.
 */
export const AUTH_MAGIC_LINK_OUTBOX_TOPIC = "auth.magic_link" as const;

/** Auth.ExchangeMagicLink input */
export const ExchangeMagicLinkBodySchema = z.object({
  token: z.string().min(16).max(512),
});
export type ExchangeMagicLinkBody = z.infer<typeof ExchangeMagicLinkBodySchema>;

/** One real event membership for post-login chooser / shells. */
export const AuthMembershipOptionSchema = z.object({
  eventId: z.string().min(1),
  eventName: z.string().min(1),
  role: EventRoleSchema,
});
export type AuthMembershipOption = z.infer<typeof AuthMembershipOptionSchema>;

/** Auth.ExchangeMagicLink output (Set-Cookie is a side effect on the response). */
export const ExchangeMagicLinkResponseSchema = z.object({
  ok: z.literal(true),
  purpose: MagicLinkPurposeSchema,
  email: z.string().email(),
  /** Optional link event when invite was event-scoped. */
  eventId: z.string().min(1).nullable().optional(),
  /** Real memberships for chooser (empty when none). */
  memberships: z.array(AuthMembershipOptionSchema).default([]),
});
export type ExchangeMagicLinkResponse = z.infer<
  typeof ExchangeMagicLinkResponseSchema
>;

/** GET /api/me/memberships — session identity + event roles. */
export const MeMembershipsResponseSchema = z.object({
  email: z.string().email(),
  userId: z.string().min(1),
  memberships: z.array(AuthMembershipOptionSchema),
});
export type MeMembershipsResponse = z.infer<typeof MeMembershipsResponseSchema>;

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
 * Auth.JudgeAccess — competition judge entry (demo deployment only).
 * POST /api/auth/judge-access — registered when the role switcher is
 * enabled (404 otherwise). No access code: the client chooses only the
 * role. Optional leftover `code` is ignored so old clients still work.
 */
export const JudgeAccessBodySchema = z.object({
  role: EventRoleSchema,
  /** Ignored — kept optional so older clients that still post a code succeed. */
  code: z.string().max(256).optional(),
});
export type JudgeAccessBody = z.infer<typeof JudgeAccessBodySchema>;

/** Response shape matches DevRoleSwitchResponse (same mint semantics). */
export const JudgeAccessResponseSchema = DevRoleSwitchResponseSchema;
export type JudgeAccessResponse = z.infer<typeof JudgeAccessResponseSchema>;

/**
 * Deterministic demo emails for role switcher (must match scripts/seed.ts).
 * Not secrets — public demo accounts for dogfood judges.
 */
export const DEMO_ROLE_EMAILS = {
  admin: "admin@demo.speakerops.local",
  evaluator: "evaluator@demo.speakerops.local",
  speaker: "speaker@demo.speakerops.local",
} as const satisfies Record<EventRole, string>;

/**
 * Email domain suffix identifying shared-demo personas (judge access /
 * role switcher). Matches DEMO_ROLE_EMAILS and scripts/seed.ts.
 */
export const DEMO_EMAIL_DOMAIN = "@demo.speakerops.local" as const;

/** True when the email belongs to a shared-demo persona. */
export function isDemoEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(DEMO_EMAIL_DOMAIN);
}

/**
 * Max lifetime of API keys minted by demo personas (shared-demo blast
 * radius, section 8.4): the server clamps Keys.Create expiresAt to
 * now + this TTL for demo sessions — matching the judge session's 4h window.
 */
export const DEMO_API_KEY_TTL_MS = 4 * 60 * 60 * 1000;

/** Session cookie name (HttpOnly Secure SameSite=Lax). */
export const SESSION_COOKIE_NAME = "speakerops_session" as const;

/**
 * Dogfood role-switch origin cookie (section 8.4).
 * Holds the original judge (event-admin) session token while the active
 * `speakerops_session` cookie is swapped to a demo evaluator/speaker.
 * HttpOnly Secure SameSite=Lax — used only to authorize further role-switch
 * requests so judges can return to admin without re-login. Never used as the
 * primary auth cookie for product APIs.
 */
export const JUDGE_SESSION_COOKIE_NAME = "speakerops_judge_session" as const;

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
