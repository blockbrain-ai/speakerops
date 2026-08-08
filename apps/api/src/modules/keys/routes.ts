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
import { requireKeysAdmin } from "../../middleware/authz.js";
import { createKey, listKeys, revokeKey } from "./commands.js";

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

function actorFromContext(c: Context<ApiEnv>): {
  actorUserId: string;
  actorType: "user" | "api_key";
} {
  const apiKey = c.get("apiKey");
  if (apiKey) {
    return { actorUserId: apiKey.id, actorType: "api_key" };
  }
  const user = c.get("user");
  return {
    actorUserId: user?.id ?? "unknown",
    actorType: "user",
  };
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
   * GET / — Keys.List (no secrets)
   */
  app.get("/", guard, async (c) => {
    const result = await listKeys(deps);
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
   * POST / — Keys.Create (secret once)
   */
  app.post("/", guard, async (c) => {
    const user = c.get("user");
    const apiKey = c.get("apiKey");
    if (!user && !apiKey) {
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

    const actor = actorFromContext(c);
    const result = await createKey(deps, {
      ...parsed.data,
      actorUserId: actor.actorUserId,
      actorType: actor.actorType,
      correlationId: c.get("correlationId"),
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
   * DELETE /:keyId — Keys.Revoke
   */
  app.delete("/:keyId", guard, async (c) => {
    const user = c.get("user");
    const apiKey = c.get("apiKey");
    if (!user && !apiKey) {
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

    const actor = actorFromContext(c);
    const result = await revokeKey(deps, {
      keyId,
      actorUserId: actor.actorUserId,
      actorType: actor.actorType,
      correlationId: c.get("correlationId"),
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
