/**
 * API keys + scopes DTOs (section 7.1 / S-CLI).
 *
 * Keys.Create / Keys.Revoke / Keys.List — COMMANDS.md + SCOPES.md.
 * Secret returned once on create; list never includes secret or hash.
 * Default-deny high-risk scopes unless explicitly granted.
 */
import { z } from "zod";

/** Canonical scope strings (SCOPES.md). */
export const API_SCOPES = [
  "events:read",
  "events:write",
  "cfp:read",
  "cfp:write",
  "submissions:read",
  "submissions:write",
  "decisions:write",
  "speakers:read",
  "speakers:write",
  "files:write",
  "schedule:read",
  "schedule:write",
  "comms:draft",
  "comms:send",
  "design:read",
  "design:write",
  "reports:read",
  "airtable:read",
  /** Auth.CreateInvite + setMemberRole (Team admin automation / CLI). */
  "members:write",
  "keys:admin",
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export const ApiScopeSchema = z.enum(API_SCOPES);

/**
 * High-risk scopes that must not be present on a newly minted key unless
 * the client explicitly includes them in scopes[] (default deny — E8 / SCOPES.md).
 */
export const DEFAULT_DENY_SCOPES = [
  "comms:send",
  "decisions:write",
  "keys:admin",
] as const;

export type DefaultDenyScope = (typeof DEFAULT_DENY_SCOPES)[number];

export const DEFAULT_DENY_SCOPE_SET: ReadonlySet<string> = new Set(
  DEFAULT_DENY_SCOPES,
);

/** Scopes safe to offer as default UI multiselect (excludes default-deny). */
export const SAFE_DEFAULT_SCOPES: readonly ApiScope[] = API_SCOPES.filter(
  (s) => !DEFAULT_DENY_SCOPE_SET.has(s),
);

/**
 * Fallback createdAt for api_keys rows minted before migration 0022 added the
 * column (pre-backfill NULLs must list, never 500 — matches 0022 backfill).
 */
export const API_KEY_CREATED_AT_FALLBACK = "2026-08-09T00:00:00.000Z" as const;

export const ApiKeySchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  name: z.string().min(1),
  /** Public prefix only — never the full secret. */
  prefix: z.string().min(1),
  scopes: z.array(ApiScopeSchema),
  eventId: z.string().min(1).nullable(),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
  revokedAt: z.string().datetime({ offset: true }).nullable(),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  lastUsedAt: z.string().datetime({ offset: true }).nullable(),
});

export type ApiKeyDto = z.infer<typeof ApiKeySchema>;

export const KeysListResponseSchema = z.object({
  keys: z.array(ApiKeySchema),
});

export type KeysListResponse = z.infer<typeof KeysListResponseSchema>;

export const KeysCreateBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  scopes: z.array(ApiScopeSchema).min(1),
  eventId: z.string().min(1).nullable().optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  orgId: z.string().min(1).optional(),
});

export type KeysCreateBody = z.infer<typeof KeysCreateBodySchema>;

/**
 * Create response — secret returned once only (never re-fetchable).
 * Interfaces: { id, secret, prefix }
 */
export const KeysCreateResponseSchema = z.object({
  id: z.string().min(1),
  secret: z.string().min(1),
  prefix: z.string().min(1),
  name: z.string().min(1),
  scopes: z.array(ApiScopeSchema),
  eventId: z.string().min(1).nullable(),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
});

export type KeysCreateResponse = z.infer<typeof KeysCreateResponseSchema>;

export const KeysRevokeResponseSchema = z.object({
  ok: z.literal(true),
  id: z.string().min(1),
  revokedAt: z.string().datetime({ offset: true }),
});

export type KeysRevokeResponse = z.infer<typeof KeysRevokeResponseSchema>;

/** True when every scope is in the allowlist. */
export function scopesAreValid(scopes: readonly string[]): boolean {
  const allowed = new Set<string>(API_SCOPES);
  return scopes.every((s) => allowed.has(s));
}

/** True when the key has every required scope. */
export function keyHasScopes(
  keyScopes: readonly string[],
  required: readonly string[],
): boolean {
  const have = new Set(keyScopes);
  return required.every((s) => have.has(s));
}
