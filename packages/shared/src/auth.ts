import { z } from "zod";

/**
 * Auth magic-link DTOs (section 2.1).
 * Commands: Auth.RequestMagicLink / Auth.ExchangeMagicLink / Auth.Logout
 * HTTP: POST /api/auth/magic-link | /api/auth/exchange | /api/auth/logout
 */

/** Magic-link purposes for admin and speaker sessions (evaluator invite is 2.2+). */
export const MagicLinkPurposeSchema = z.enum(["admin", "speaker"]);
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
