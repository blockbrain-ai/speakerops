/**
 * API keys HTTP routes (section 7.1 / S-CLI).
 *
 * GET    /api/keys          → Keys.List
 * POST   /api/keys          → Keys.Create
 * DELETE /api/keys/:keyId   → Keys.Revoke
 *
 * Auth: admin session cookie OR Bearer with keys:admin scope.
 * Zod + E4 envelopes; secret never re-listed.
 *
 * Canonical registry: KMS-competition/initiative/contracts/COMMANDS.md
 */
import { Hono, type Context } from "hono";
import {
  KeysCreateBodySchema,
  KeysCreateResponseSchema,
  KeysListResponseSchema,
  KeysRevokeResponseSchema,
  errorEnvelope,
  VALIDATION_ERROR,
  INTERNAL_ERROR,
  NOT_FOUND,
  FORBIDDEN,
  type ErrorCode,
} from "@speakerops/shared";
import type { ApiEnv } from "../../env.js";
import type { AuthStore } from "../auth/store.js";
import type { EventsStore } from "../events/store.js";
import type { KeysStore } from "./store.js";
import {
  requireKeysAdmin,
  actorFromContext,
} from "../../middleware/authz.js";
import {
  createKey,
  listKeys,
  revokeKey,
  type KeysAdminScope,
} from "./commands.js";

export type KeysRouteOptions = {
  store: AuthStore;
  events: EventsStore;
  keys: KeysStore;
};

function commandError(
  c: Context<ApiEnv>,
  err: {
    status: 400 | 403 | 404;
    error: string;
    code: string;
    details?: unknown;
  },
) {
  const code: ErrorCode =
    err.code === "NOT_FOUND"
      ? NOT_FOUND
      : err.code === "FORBIDDEN"
        ? FORBIDDEN
        : err.code === "VALIDATION_ERROR"
          ? VALIDATION_ERROR
          : (err.code as ErrorCode);
  return c.json(errorEnvelope(err.error, code, err.details), err.status);
}

/**
 * Build event/org authorization boundary for the authenticated principal.
 */
async function resolveKeysAdminScope(
  c: Context<ApiEnv>,
  store: AuthStore,
  events: EventsStore,
): Promise<KeysAdminScope | null> {
  const apiKey = c.get("apiKey");
  if (apiKey) {
    return {
      callerEventId: apiKey.eventId,
      callerOrgId: apiKey.orgId,
    };
  }
  const user = c.get("user");
  if (!user) return null;
  const memberships = await store.listMembershipsForUser(user.id);
  const adminEventIds = memberships
    .filter((m) => m.role === "admin")
    .map((m) => m.eventId);
  const adminOrgIds: string[] = [];
  if (adminEventIds.length > 0) {
    const rows = await events.listEventsByIds(adminEventIds);
    const seen = new Set<string>();
    for (const r of rows) {
      if (!seen.has(r.orgId)) {
        seen.add(r.orgId);
        adminOrgIds.push(r.orgId);
      }
    }
  }
  return { adminEventIds, adminOrgIds };
}

/**
 * Mount at /api/keys
 */
export function createKeysRoutes(options: KeysRouteOptions): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const { store, events, keys } = options;
  const deps = { keys, auth: store, events };
  const guard = requireKeysAdmin(store, keys);

  /**
   * GET / — Keys.List (no secrets); filtered to caller event/org boundary.
   */
  app.get("/", guard, async (c) => {
    const scope = await resolveKeysAdminScope(c, store, events);
    if (!scope) {
      return c.json(
        errorEnvelope("Authentication required", "UNAUTHORIZED"),
        401,
      );
    }
    const result = await listKeys(deps, scope);
    const out = KeysListResponseSchema.safeParse(result.value);
    if (!out.success) {
      return c.json(
        errorEnvelope("Response validation failed", INTERNAL_ERROR),
        500,
      );
    }
    return c.json(out.data, 200);
  });

  /**
   * POST / — Keys.Create (secret once); target must be within boundary.
   */
  app.post("/", guard, async (c) => {
    const actor = actorFromContext(c);
    if (!actor) {
      return c.json(
        errorEnvelope("Authentication required", "UNAUTHORIZED"),
        401,
      );
    }
    const scope = await resolveKeysAdminScope(c, store, events);
    if (!scope) {
      return c.json(
        errorEnvelope("Authentication required", "UNAUTHORIZED"),
        401,
      );
    }

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(
        errorEnvelope("Invalid JSON body", VALIDATION_ERROR),
        400,
      );
    }

    const parsed = KeysCreateBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        errorEnvelope("Validation failed", VALIDATION_ERROR, {
          issues: parsed.error.flatten(),
        }),
        400,
      );
    }

    const result = await createKey(deps, {
      ...parsed.data,
      actorUserId: actor.actorId,
      actorType: actor.actorType,
      correlationId: c.get("correlationId"),
      scope,
    });

    if (!result.ok) {
      return commandError(c, result);
    }

    const out = KeysCreateResponseSchema.safeParse(result.value);
    if (!out.success) {
      return c.json(
        errorEnvelope("Response validation failed", INTERNAL_ERROR),
        500,
      );
    }
    return c.json(out.data, 201);
  });

  /**
   * DELETE /:keyId — Keys.Revoke; target must be within boundary.
   */
  app.delete("/:keyId", guard, async (c) => {
    const actor = actorFromContext(c);
    if (!actor) {
      return c.json(
        errorEnvelope("Authentication required", "UNAUTHORIZED"),
        401,
      );
    }
    const scope = await resolveKeysAdminScope(c, store, events);
    if (!scope) {
      return c.json(
        errorEnvelope("Authentication required", "UNAUTHORIZED"),
        401,
      );
    }

    const keyId = c.req.param("keyId");
    if (!keyId || keyId.trim().length === 0) {
      return c.json(
        errorEnvelope("keyId required", VALIDATION_ERROR),
        400,
      );
    }

    const result = await revokeKey(deps, {
      keyId,
      actorUserId: actor.actorId,
      actorType: actor.actorType,
      correlationId: c.get("correlationId"),
      scope,
    });

    if (!result.ok) {
      return commandError(c, result);
    }

    const out = KeysRevokeResponseSchema.safeParse(result.value);
    if (!out.success) {
      return c.json(
        errorEnvelope("Response validation failed", INTERNAL_ERROR),
        500,
      );
    }
    return c.json(out.data, 200);
  });

  return app;
}
