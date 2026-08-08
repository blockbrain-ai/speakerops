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

export type CreateKeyInput = KeysCreateBody & {
  actorUserId: string;
  actorType?: "user" | "api_key";
  correlationId: string;
};

/**
 * Keys.Create — mint key; return secret once; store hash only.
 * Scopes are exactly those requested (default-deny is "no auto-grant").
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

  const eventId = input.eventId ?? null;
  if (eventId) {
    const event = await deps.events.findEventById(eventId);
    if (!event) {
      return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
    }
  }

  const expiresAt = input.expiresAt ?? null;
  if (expiresAt && isExpired(expiresAt)) {
    return {
      ok: false,
      status: 400,
      error: "expiresAt must be in the future",
      code: "VALIDATION_ERROR",
      details: { expiresAt },
    };
  }

  const orgId = input.orgId?.trim() || DEFAULT_ORG_ID;
  // Ensure org shell exists for FK (dogfood single-org)
  await deps.events.ensureOrg({ id: orgId });

  const { secret, prefix } = generateApiKeyMaterial();
  const keyHash = await hashToken(secret);
  const id = uuidv7();

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
    lastUsedAt: null,
  };

  await deps.keys.insertKey(row);

  const now = new Date().toISOString();
  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId,
    actorType: input.actorType ?? "user",
    actorId: input.actorUserId,
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
 */
export async function listKeys(
  deps: KeysCommandDeps,
  options?: { orgId?: string },
): Promise<CommandOk<{ keys: ApiKeyDto[] }>> {
  const rows = await deps.keys.listKeys(
    options?.orgId ? { orgId: options.orgId } : undefined,
  );
  return {
    ok: true,
    value: { keys: rows.map(toApiKeyDto) },
  };
}

export type RevokeKeyInput = {
  keyId: string;
  actorUserId: string;
  actorType?: "user" | "api_key";
  correlationId: string;
};

/**
 * Keys.Revoke — soft-revoke; subsequent bearer auth → 401.
 */
export async function revokeKey(
  deps: KeysCommandDeps,
  input: RevokeKeyInput,
): Promise<CommandOk<{ ok: true; id: string; revokedAt: string }> | CommandErr> {
  const existing = await deps.keys.findById(input.keyId);
  if (!existing) {
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
