/**
 * Keys domain commands (section 7.1 / S-CLI).
 *
 * Keys.Create / Keys.Revoke / Keys.List
 * Secret returned once on create; hash only stored (E10).
 * Default-deny: high-risk scopes only when explicitly listed in input.
 *
 * Canonical registry: KMS-competition/initiative/contracts/COMMANDS.md
 */
import {
  uuidv7,
  DEFAULT_ORG_ID,
  API_KEY_CREATED_AT_FALLBACK,
  type ApiScope,
  type KeysCreateBody,
  type ApiKeyDto,
} from "@speakerops/shared";
import type { AuthStore } from "../auth/store.js";
import type { EventsStore } from "../events/store.js";
import type { KeysStore, ApiKeyRow } from "./store.js";
import { generateToken, hashToken, isExpired } from "../auth/crypto.js";

export type KeysCommandDeps = {
  keys: KeysStore;
  auth: AuthStore;
  events: EventsStore;
};

/**
 * Max active (not revoked, not expired) keys created by demo personas —
 * durable shared-demo quota across sessions AND descendant bearer keys (8.4).
 * Self-healing: the 4h demo expiry clamp drains the count automatically.
 */
export const DEMO_ACTIVE_KEY_LIMIT = 25;

/**
 * Non-releasing rolling mint cap: max demo mints per 24h window counted over
 * ALL demo-created rows regardless of revoked/expired state — so a
 * create→revoke loop cannot grow api_keys/audit rows unbounded by freeing
 * the active quota.
 */
export const DEMO_MINT_LIMIT = 100;
export const DEMO_MINT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Human copy — active cap (releasing: revoke or expiry frees it). */
export const DEMO_ACTIVE_KEY_LIMIT_COPY = `Demo key limit reached — the shared demo allows ${DEMO_ACTIVE_KEY_LIMIT} active demo-created keys. Revoke keys you no longer need (or wait for older demo keys to expire) and try again.`;

/** Human copy — rolling mint cap (non-releasing: only time frees it). */
export const DEMO_MINT_LIMIT_COPY = `Demo key mint limit reached for today — the shared demo allows ${DEMO_MINT_LIMIT} new keys per 24 hours. Try again later.`;

export type CommandOk<T> = { ok: true; value: T };
export type CommandErr = {
  ok: false;
  status: 400 | 403 | 404;
  error: string;
  code: string;
  details?: unknown;
};

/** Parse scopes_json safely; returns empty on corrupt storage. */
export function parseScopesJson(scopesJson: string): ApiScope[] {
  try {
    const raw: unknown = JSON.parse(scopesJson);
    if (!Array.isArray(raw)) return [];
    return raw.filter((s): s is ApiScope => typeof s === "string");
  } catch {
    return [];
  }
}

/** Public DTO — never includes secret or key_hash. */
export function toApiKeyDto(row: ApiKeyRow): ApiKeyDto {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    prefix: row.keyPrefix,
    scopes: parseScopesJson(row.scopesJson),
    eventId: row.eventId,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdBy: row.createdBy,
    // Defensive: pre-0022 rows may surface without created_at.
    createdAt: row.createdAt || API_KEY_CREATED_AT_FALLBACK,
    lastUsedAt: row.lastUsedAt,
  };
}

/**
 * Generate secret + public prefix.
 * Format: spk_<8 hex>_<32-byte base64url>
 * Prefix (listable): spk_<8 hex>
 */
export function generateApiKeyMaterial(): {
  secret: string;
  prefix: string;
} {
  const prefixBytes = new Uint8Array(4);
  crypto.getRandomValues(prefixBytes);
  const hex = Array.from(prefixBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const prefix = `spk_${hex}`;
  const secretPart = generateToken(32);
  const secret = `${prefix}_${secretPart}`;
  return { secret, prefix };
}

/**
 * Authorization boundary for key administration (E2).
 * - Event-scoped API key: only keys bound to that eventId; cannot mint unscoped.
 * - Org-scoped API key (no eventId): only keys in that orgId (incl. unscoped).
 * - Session admin: only event-bound keys for events they administer.
 *   Unscoped org-wide keys are never visible to session users — preventing
 *   event admins from listing/revoking organization-wide integrations (E2).
 */
export type KeysAdminScope = {
  /** Bound event when caller is an event-scoped API key. */
  callerEventId?: string | null;
  /** Bound org when caller is an API key (always set for keys). */
  callerOrgId?: string | null;
  /** Event ids where session user is admin (session path). */
  adminEventIds?: string[];
  /** Org ids derived from admin events (session path; mint path only). */
  adminOrgIds?: string[];
};

export function keyVisibleToScope(
  row: { eventId: string | null; orgId: string },
  scope: KeysAdminScope,
): boolean {
  if (scope.callerEventId) {
    return row.eventId === scope.callerEventId;
  }
  if (scope.callerOrgId) {
    return row.orgId === scope.callerOrgId;
  }
  if (scope.adminEventIds && scope.adminEventIds.length > 0) {
    if (row.eventId) {
      return scope.adminEventIds.includes(row.eventId);
    }
    // Session admins never list/revoke unscoped org-wide keys (E2).
    // Only org-scoped Bearer keys:admin may manage those integrations.
    return false;
  }
  // No scope → deny (should not list globally)
  return false;
}

export type CreateKeyInput = KeysCreateBody & {
  /**
   * Human user id stored as api_keys.created_by (membership context for child keys).
   * Must always be a users.id — never an api_keys.id (E2 / FK).
   */
  actorUserId: string;
  /**
   * Audit actor id: session user id or minting api key id.
   * Defaults to actorUserId when omitted.
   */
  actorId?: string;
  actorType?: "user" | "api_key";
  correlationId: string;
  /** Caller authorization boundary — required for event/org isolation. */
  scope: KeysAdminScope;
  /**
   * Present when the acting principal is demo-linked (8.4): the demo persona
   * user ids sharing the durable mint quota. Enforced atomically at the
   * insert (never only by a pre-check — TOCTOU).
   */
  demoQuotaCreatorIds?: string[];
};

/**
 * Keys.Create — mint key; return secret once; store hash only.
 * Scopes are exactly those requested (default-deny is "no auto-grant").
 * Target eventId/orgId must fall within the caller's admin boundary.
 */
export async function createKey(
  deps: KeysCommandDeps,
  input: CreateKeyInput,
): Promise<
  CommandOk<{
    id: string;
    secret: string;
    prefix: string;
    name: string;
    scopes: ApiScope[];
    eventId: string | null;
    expiresAt: string | null;
  }>
  | CommandErr
> {
  // Deduplicate scopes while preserving order
  const seen = new Set<string>();
  const scopes: ApiScope[] = [];
  for (const s of input.scopes) {
    if (!seen.has(s)) {
      seen.add(s);
      scopes.push(s);
    }
  }
  if (scopes.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "At least one scope is required",
      code: "VALIDATION_ERROR",
    };
  }

  let eventId = input.eventId ?? null;
  /** Session path sets adminEventIds; API-key path sets callerOrgId / callerEventId. */
  const isSessionCaller = Array.isArray(input.scope.adminEventIds);

  // Event-scoped caller cannot mint unscoped or cross-event keys
  if (input.scope.callerEventId) {
    if (eventId && eventId !== input.scope.callerEventId) {
      return {
        ok: false,
        status: 403,
        error: "Cannot create key for another event",
        code: "FORBIDDEN",
        details: { eventId },
      };
    }
    // Force binding to caller's event (never mint unscoped from event key)
    eventId = input.scope.callerEventId;
  }

  // Session admins must never mint organization-wide (unscoped) keys (E2):
  // event-scoped browser role must not escalate to org-wide Bearer privileges.
  if (!eventId && isSessionCaller) {
    const adminIds = input.scope.adminEventIds ?? [];
    if (adminIds.length === 1) {
      eventId = adminIds[0]!;
    } else if (adminIds.length > 1) {
      return {
        ok: false,
        status: 400,
        error: "eventId is required when administering multiple events",
        code: "VALIDATION_ERROR",
        details: { adminEventIds: adminIds },
      };
    } else {
      return {
        ok: false,
        status: 403,
        error: "Insufficient authorization to create keys",
        code: "FORBIDDEN",
      };
    }
  }

  if (eventId) {
    const event = await deps.events.findEventById(eventId);
    if (!event) {
      // Bootstrap membership may exist without an Event.Create row — allow
      // binding only when the session (or event-scoped key) administers it.
      const allowedBootstrap =
        (input.scope.adminEventIds?.includes(eventId) ?? false) ||
        input.scope.callerEventId === eventId;
      if (!allowedBootstrap) {
        return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
      }
    } else {
      // Session admin must administer the target event
      if (
        isSessionCaller &&
        input.scope.adminEventIds &&
        !input.scope.adminEventIds.includes(eventId)
      ) {
        return {
          ok: false,
          status: 403,
          error: "Cannot create key for an event you do not administer",
          code: "FORBIDDEN",
          details: { eventId },
        };
      }
      // Org-scoped key must stay in org
      if (
        input.scope.callerOrgId &&
        event.orgId !== input.scope.callerOrgId
      ) {
        return {
          ok: false,
          status: 403,
          error: "Cannot create key outside key organization",
          code: "FORBIDDEN",
        };
      }
    }
  } else {
    // Unscoped key create: only org-scoped API keys (keys:admin) — never session
    if (!input.scope.callerOrgId) {
      return {
        ok: false,
        status: 403,
        error: "Insufficient authorization to create unscoped keys",
        code: "FORBIDDEN",
      };
    }
  }

  // Normalize ALL stored expiry to UTC Z-form at write time: offset-form ISO
  // ("…-10:00") must never reach storage, where lexical comparisons could
  // mis-order it against Z-form instants.
  const expiresAt = input.expiresAt
    ? new Date(input.expiresAt).toISOString()
    : null;
  if (expiresAt && isExpired(expiresAt)) {
    return {
      ok: false,
      status: 400,
      error: "expiresAt must be in the future",
      code: "VALIDATION_ERROR",
      details: { expiresAt },
    };
  }

  let orgId = input.orgId?.trim() || DEFAULT_ORG_ID;
  if (input.scope.callerOrgId) {
    orgId = input.scope.callerOrgId;
  } else if (eventId) {
    const event = await deps.events.findEventById(eventId);
    if (event) orgId = event.orgId;
  } else if (
    input.scope.adminOrgIds &&
    input.scope.adminOrgIds.length > 0 &&
    !input.scope.adminOrgIds.includes(orgId)
  ) {
    // Prefer caller's first admin org for unscoped mint
    orgId = input.scope.adminOrgIds[0]!;
  }

  // Ensure org shell exists for FK (dogfood single-org)
  await deps.events.ensureOrg({ id: orgId });

  // Final visibility check on target
  if (
    !keyVisibleToScope(
      { eventId, orgId },
      input.scope,
    )
  ) {
    return {
      ok: false,
      status: 403,
      error: "Cannot create key outside authorization boundary",
      code: "FORBIDDEN",
    };
  }

  const { secret, prefix } = generateApiKeyMaterial();
  const keyHash = await hashToken(secret);
  const id = uuidv7();

  // createdBy is always a human users.id (membership context for resolveBearer).
  // Audit actorId may be the minting API key id when actorType is api_key.
  const auditActorId = input.actorId ?? input.actorUserId;
  const now = new Date().toISOString();
  const row: ApiKeyRow = {
    id,
    orgId,
    name: input.name.trim(),
    keyPrefix: prefix,
    keyHash,
    scopesJson: JSON.stringify(scopes),
    eventId,
    expiresAt,
    revokedAt: null,
    createdBy: input.actorUserId,
    createdAt: now,
    lastUsedAt: null,
  };

  if (input.demoQuotaCreatorIds && input.demoQuotaCreatorIds.length > 0) {
    // Demo-linked mint: the INSERT itself enforces both caps atomically
    // (TOCTOU-safe). "quota" means no row was written.
    const outcome = await deps.keys.insertKeyWithinDemoQuota(row, {
      creatorIds: input.demoQuotaCreatorIds,
      nowIso: now,
      activeLimit: DEMO_ACTIVE_KEY_LIMIT,
      mintWindowStartIso: new Date(
        Date.parse(now) - DEMO_MINT_WINDOW_MS,
      ).toISOString(),
      mintLimit: DEMO_MINT_LIMIT,
    });
    if (outcome === "quota") {
      // Follow-up read is for the error message only — enforcement already
      // happened at the insert.
      const active = await deps.keys.countActiveKeysByCreators(
        input.demoQuotaCreatorIds,
        now,
      );
      const error =
        active >= DEMO_ACTIVE_KEY_LIMIT
          ? DEMO_ACTIVE_KEY_LIMIT_COPY
          : DEMO_MINT_LIMIT_COPY;
      return { ok: false, status: 403, error, code: "FORBIDDEN" };
    }
  } else {
    await deps.keys.insertKey(row);
  }

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId,
    actorType: input.actorType ?? "user",
    actorId: auditActorId,
    action: "Keys.Create",
    entityType: "api_key",
    entityId: id,
    // Never log secret or hash
    afterJson: JSON.stringify({
      name: row.name,
      prefix,
      scopes,
      eventId,
      expiresAt,
      orgId,
    }),
    correlationId: input.correlationId,
    createdAt: now,
  });

  return {
    ok: true,
    value: {
      id,
      secret,
      prefix,
      name: row.name,
      scopes,
      eventId,
      expiresAt,
    },
  };
}

/**
 * Keys.List — metadata only; never secret or hash.
 * Filtered to the caller's event/org authorization boundary.
 */
export async function listKeys(
  deps: KeysCommandDeps,
  scope: KeysAdminScope,
): Promise<CommandOk<{ keys: ApiKeyDto[] }>> {
  // Prefetch by org when known to reduce scan; then filter event boundary.
  const orgFilter =
    scope.callerOrgId ??
    (scope.adminOrgIds?.length === 1 ? scope.adminOrgIds[0] : undefined);
  const rows = await deps.keys.listKeys(
    orgFilter ? { orgId: orgFilter } : undefined,
  );
  const filtered = rows.filter((r) => keyVisibleToScope(r, scope));
  return {
    ok: true,
    value: { keys: filtered.map(toApiKeyDto) },
  };
}

export type RevokeKeyInput = {
  keyId: string;
  actorUserId: string;
  actorType?: "user" | "api_key";
  correlationId: string;
  scope: KeysAdminScope;
};

/**
 * Keys.Revoke — soft-revoke; subsequent bearer auth → 401.
 * Target must fall within the caller's event/org boundary.
 */
export async function revokeKey(
  deps: KeysCommandDeps,
  input: RevokeKeyInput,
): Promise<CommandOk<{ ok: true; id: string; revokedAt: string }> | CommandErr> {
  const existing = await deps.keys.findById(input.keyId);
  if (!existing) {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }
  if (!keyVisibleToScope(existing, input.scope)) {
    // Cross-boundary: do not leak existence
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }
  if (existing.revokedAt) {
    return {
      ok: false,
      status: 400,
      error: "Key already revoked",
      code: "VALIDATION_ERROR",
      details: { id: input.keyId, revokedAt: existing.revokedAt },
    };
  }

  const revokedAt = new Date().toISOString();
  const updated = await deps.keys.revokeKey(input.keyId, revokedAt);
  if (!updated) {
    return {
      ok: false,
      status: 400,
      error: "Key already revoked",
      code: "VALIDATION_ERROR",
      details: { id: input.keyId },
    };
  }

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: existing.eventId,
    actorType: input.actorType ?? "user",
    actorId: input.actorUserId,
    action: "Keys.Revoke",
    entityType: "api_key",
    entityId: input.keyId,
    beforeJson: JSON.stringify({
      name: existing.name,
      prefix: existing.keyPrefix,
      revokedAt: null,
    }),
    afterJson: JSON.stringify({
      name: existing.name,
      prefix: existing.keyPrefix,
      revokedAt,
    }),
    correlationId: input.correlationId,
    createdAt: revokedAt,
  });

  return {
    ok: true,
    value: { ok: true, id: input.keyId, revokedAt },
  };
}

/**
 * Authenticate a raw bearer secret against stored hash.
 * Returns row when active (not revoked, not expired); null otherwise.
 * Touches last_used_at on success (best-effort).
 */
export async function authenticateApiKey(
  keys: KeysStore,
  secret: string,
): Promise<ApiKeyRow | null> {
  const trimmed = secret.trim();
  if (!trimmed) return null;
  const keyHash = await hashToken(trimmed);
  const row = await keys.findByHash(keyHash);
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && isExpired(row.expiresAt)) return null;
  // Best-effort last_used touch — do not fail auth on store errors
  try {
    await keys.touchLastUsed(row.id, new Date().toISOString());
  } catch {
    // ignore
  }
  return row;
}
