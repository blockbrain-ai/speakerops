/**
 * Authz middleware — section 2.2 + 7.1 bearer API keys.
 *
 * - requireSession: HttpOnly cookie → user (401 if missing/expired)
 * - requireRole(roles): event_memberships role check
 * - requireKeysAdmin: admin session OR Bearer with keys:admin (7.1)
 * - resolveBearer / authenticateApiKey: Authorization: Bearer (7.1)
 *
 * HTTP matrix (documented):
 * | Condition | Status | Code |
 * |-----------|--------|------|
 * | No / invalid session | 401 | UNAUTHORIZED |
 * | Invalid / revoked / expired API key | 401 | UNAUTHORIZED |
 * | Authenticated but wrong role | 403 | FORBIDDEN |
 * | Authenticated but wrong scope | 403 | FORBIDDEN |
 * | No membership on target event (cross-event) | 404 | NOT_FOUND |
 * | Validation failure | 400 | VALIDATION_ERROR |
 *
 * Cross-event isolation: missing membership returns 404 (not 403) so clients
 * cannot probe existence of events they are not a member of.
 *
 * Server-side only — never trust CLI/UI alone (E2/E10).
 */
import type { MiddlewareHandler, Context } from "hono";
import {
  errorEnvelope,
  UNAUTHORIZED,
  FORBIDDEN,
  NOT_FOUND,
  SESSION_COOKIE_NAME,
  type EventRole,
  type ApiScope,
} from "@speakerops/shared";
import type { ApiEnv, AuthzApiKey } from "../env.js";
import type { AuthStore, MembershipRow, SessionRow, UserRow } from "../modules/auth/store.js";
import { hashToken, isExpired } from "../modules/auth/crypto.js";
import { getSessionTokenFromCookieHeader } from "../modules/auth/cookies.js";
import type { KeysStore } from "../modules/keys/store.js";
import {
  authenticateApiKey,
  parseScopesJson,
} from "../modules/keys/commands.js";

export type AuthzUser = {
  id: string;
  email: string;
};

export type { AuthzApiKey };

/**
 * Consequential-write actor resolved from session cookie or Bearer API key.
 * API-key requests must audit as actorType "api_key" with the key id (E3),
 * not as the key creator human (which is only used for membership/createdBy).
 */
export type RequestActor = {
  /** Audit actor id: user id (session) or api key id (Bearer). */
  actorId: string;
  actorType: "user" | "api_key";
  /** Human user id: session user, or key.createdBy for membership grants. */
  userId: string;
};

/**
 * Resolve audit + human principal after requireRole / requireKeysAdmin /
 * requireSessionOrBearerScopes. Returns null when neither session nor key.
 */
export function actorFromContext(c: Context<ApiEnv>): RequestActor | null {
  const apiKey = c.get("apiKey");
  if (apiKey) {
    return {
      actorId: apiKey.id,
      actorType: "api_key",
      userId: apiKey.createdBy,
    };
  }
  const user = c.get("user");
  if (!user) return null;
  return {
    actorId: user.id,
    actorType: "user",
    userId: user.id,
  };
}

/** Minimal event lookup used for org-scoped API key isolation (E2). */
export type EventOrgLookup = {
  findEventById(id: string): Promise<{ orgId: string } | null>;
};

export type RequireRoleOptions = {
  /**
   * How to resolve eventId for membership lookup.
   * - "param": c.req.param("eventId")
   * - "none": any membership with an allowed role (e.g. Event.List admin)
   * - custom resolver
   */
  eventIdFrom?: "param" | "none" | ((c: Context<ApiEnv>) => string | undefined);
  /**
   * Param name when eventIdFrom === "param" (default "eventId").
   */
  eventIdParam?: string;
  /**
   * When set with keysStore, Authorization: Bearer is accepted if the key
   * has any of these scopes (and is not revoked/expired). Session path unchanged.
   */
  bearerScopes?: readonly string[];
  /** Required when bearerScopes is set. */
  keysStore?: KeysStore;
  /**
   * When set, org-scoped Bearer keys (eventId === null) are constrained to
   * events whose orgId matches principal.orgId. Required for E2 isolation —
   * without this, org-scoped keys would be effectively global on event routes.
   */
  eventsStore?: EventOrgLookup;
};

/** Extract raw secret from Authorization: Bearer header (or null). */
export function extractBearerSecret(
  authorization: string | undefined,
): string | null {
  if (!authorization) return null;
  const m = /^Bearer\s+(\S+)/i.exec(authorization.trim());
  if (!m?.[1]) return null;
  return m[1];
}

/**
 * Resolve Bearer API key and attach to context.
 * Returns 'missing' | 'invalid' | AuthzApiKey.
 */
export async function resolveBearer(
  c: Context<ApiEnv>,
  keysStore: KeysStore,
): Promise<"missing" | "invalid" | AuthzApiKey> {
  const secret = extractBearerSecret(c.req.header("authorization"));
  if (!secret) return "missing";

  const row = await authenticateApiKey(keysStore, secret);
  if (!row) return "invalid";

  const principal: AuthzApiKey = {
    id: row.id,
    scopes: parseScopesJson(row.scopesJson),
    eventId: row.eventId,
    orgId: row.orgId,
    createdBy: row.createdBy,
  };
  c.set("apiKey", principal);
  // Expose createdBy as user for membership/createdBy fields only.
  // Handlers MUST use actorFromContext() for audit actorType/actorId —
  // never attribute API-key writes as actorType "user" (E3).
  c.set("user", { id: row.createdBy, email: "" });
  return principal;
}

/**
 * Resolve session from cookie and attach user to context.
 * Returns false when response already written (401).
 */
export async function resolveSession(
  c: Context<ApiEnv>,
  store: AuthStore,
): Promise<{ user: UserRow; session: SessionRow } | null> {
  const token = getSessionTokenFromCookieHeader(
    c.req.header("cookie"),
    SESSION_COOKIE_NAME,
  );
  if (!token) return null;

  const tokenHash = await hashToken(token);
  const session = await store.findSessionByTokenHash(tokenHash);
  if (!session) return null;
  if (isExpired(session.expiresAt)) return null;

  const user = await store.findUserById(session.userId);
  if (!user) return null;

  c.set("user", { id: user.id, email: user.email });
  c.set("sessionId", session.id);
  return { user, session };
}

/**
 * Middleware factory: require valid session cookie.
 * Sets c.var.user; responds 401 E4 envelope otherwise.
 */
export function requireSession(store: AuthStore): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const resolved = await resolveSession(c, store);
    if (!resolved) {
      return c.json(
        errorEnvelope("Authentication required", UNAUTHORIZED),
        401,
      );
    }
    await next();
  };
}

function resolveEventId(
  c: Context<ApiEnv>,
  options: RequireRoleOptions,
): string | undefined {
  if (options.eventIdFrom === "none") return undefined;
  if (typeof options.eventIdFrom === "function") {
    return options.eventIdFrom(c);
  }
  // default: param
  const param = options.eventIdParam ?? "eventId";
  return c.req.param(param);
}

/**
 * Middleware factory: require session + one of the allowed roles.
 *
 * When eventId is resolved:
 * - no membership → 404 NOT_FOUND (cross-event isolation)
 * - membership role not in allowed → 403 FORBIDDEN
 *
 * When eventIdFrom is "none":
 * - user must have at least one membership with an allowed role (any event)
 * - otherwise 403 FORBIDDEN
 *
 * Optional Bearer path (7.1): when Authorization: Bearer is present and
 * options.bearerScopes + options.keysStore are set, a valid key with any
 * listed scope is accepted. Invalid/revoked/expired key → 401.
 */
export function requireRole(
  store: AuthStore,
  allowedRoles: readonly EventRole[],
  options: RequireRoleOptions = {},
): MiddlewareHandler<ApiEnv> {
  const allowed = new Set(allowedRoles);

  return async (c, next) => {
    // Bearer takes precedence when Authorization header is present (7.1)
    const authHeader = c.req.header("authorization");
    if (
      authHeader &&
      /^Bearer\s+/i.test(authHeader) &&
      options.keysStore &&
      options.bearerScopes &&
      options.bearerScopes.length > 0
    ) {
      const principal = await resolveBearer(c, options.keysStore);
      if (principal === "missing" || principal === "invalid") {
        return c.json(
          errorEnvelope("Authentication required", UNAUTHORIZED),
          401,
        );
      }
      const have = new Set(principal.scopes);
      const ok = options.bearerScopes.some((s) => have.has(s as ApiScope));
      if (!ok) {
        return c.json(
          errorEnvelope("Insufficient scope", FORBIDDEN, {
            required: [...options.bearerScopes],
          }),
          403,
        );
      }
      // Event / org binding (E2): never allow cross-event or cross-org access.
      const eventId = resolveEventId(c, {
        eventIdFrom: options.eventIdFrom ?? "param",
        eventIdParam: options.eventIdParam,
      });
      if (eventId && options.eventIdFrom !== "none") {
        if (principal.eventId && principal.eventId !== eventId) {
          return c.json(
            errorEnvelope("Not found", NOT_FOUND, { path: c.req.path }),
            404,
          );
        }
        // Org-scoped key (eventId === null): target event must belong to key.orgId.
        // Event-scoped keys already match a single event; still verify org when
        // lookup is available so a mismatched orgId cannot widen access.
        if (!principal.eventId) {
          if (!options.eventsStore) {
            return c.json(
              errorEnvelope("Insufficient scope", FORBIDDEN, {
                required: [...options.bearerScopes],
                reason: "org_scoped_key_requires_event_lookup",
              }),
              403,
            );
          }
          const event = await options.eventsStore.findEventById(eventId);
          if (!event || event.orgId !== principal.orgId) {
            return c.json(
              errorEnvelope("Not found", NOT_FOUND, { path: c.req.path }),
              404,
            );
          }
        } else if (options.eventsStore) {
          const event = await options.eventsStore.findEventById(eventId);
          if (event && event.orgId !== principal.orgId) {
            return c.json(
              errorEnvelope("Not found", NOT_FOUND, { path: c.req.path }),
              404,
            );
          }
        }
      }
      await next();
      return;
    }

    const resolved = await resolveSession(c, store);
    if (!resolved) {
      return c.json(
        errorEnvelope("Authentication required", UNAUTHORIZED),
        401,
      );
    }

    const eventId = resolveEventId(c, {
      eventIdFrom: options.eventIdFrom ?? "param",
      eventIdParam: options.eventIdParam,
    });

    if (eventId === undefined || options.eventIdFrom === "none") {
      const memberships = await store.listMembershipsForUser(resolved.user.id);
      const match = memberships.find((m) => allowed.has(m.role));
      if (!match) {
        return c.json(
          errorEnvelope("Insufficient role", FORBIDDEN, {
            required: [...allowedRoles],
          }),
          403,
        );
      }
      c.set("membership", match);
      await next();
      return;
    }

    if (!eventId || eventId.trim().length === 0) {
      return c.json(
        errorEnvelope("eventId required", NOT_FOUND),
        404,
      );
    }

    const membership = await store.findMembership(eventId, resolved.user.id);
    if (!membership) {
      // Cross-event isolation: do not leak whether the event exists
      return c.json(
        errorEnvelope("Not found", NOT_FOUND, { path: c.req.path }),
        404,
      );
    }

    if (!allowed.has(membership.role)) {
      return c.json(
        errorEnvelope("Insufficient role", FORBIDDEN, {
          required: [...allowedRoles],
          role: membership.role,
        }),
        403,
      );
    }

    c.set("membership", membership);
    await next();
  };
}

/**
 * Keys.Create / Keys.Revoke / Keys.List guard (section 7.1).
 *
 * Accepts:
 * - Valid admin session (any event membership with role admin)
 * - Authorization: Bearer with keys:admin scope (not revoked/expired)
 *
 * Invalid/revoked/expired bearer → 401.
 * Valid auth but insufficient role/scope → 403.
 */
export function requireKeysAdmin(
  store: AuthStore,
  keysStore: KeysStore,
): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const authHeader = c.req.header("authorization");
    if (authHeader && /^Bearer\s+/i.test(authHeader)) {
      const principal = await resolveBearer(c, keysStore);
      if (principal === "missing" || principal === "invalid") {
        return c.json(
          errorEnvelope("Authentication required", UNAUTHORIZED),
          401,
        );
      }
      if (!principal.scopes.includes("keys:admin")) {
        return c.json(
          errorEnvelope("Insufficient scope", FORBIDDEN, {
            required: ["keys:admin"],
          }),
          403,
        );
      }
      await next();
      return;
    }

    const resolved = await resolveSession(c, store);
    if (!resolved) {
      return c.json(
        errorEnvelope("Authentication required", UNAUTHORIZED),
        401,
      );
    }

    const memberships = await store.listMembershipsForUser(resolved.user.id);
    const match = memberships.find((m) => m.role === "admin");
    if (!match) {
      return c.json(
        errorEnvelope("Insufficient role", FORBIDDEN, {
          required: ["admin"],
        }),
        403,
      );
    }
    c.set("membership", match);
    await next();
  };
}

/**
 * Session cookie OR Bearer with any of the listed scopes (section 7.2 CLI).
 * Use when the handler does its own event/membership checks after auth
 * (e.g. File.PresignUpload body carries eventId).
 *
 * Invalid/revoked/expired bearer → 401.
 * Valid bearer without required scope → 403.
 * No session and no bearer → 401.
 */
export function requireSessionOrBearerScopes(
  store: AuthStore,
  keysStore: KeysStore | undefined,
  scopes: readonly string[],
): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const authHeader = c.req.header("authorization");
    if (
      authHeader &&
      /^Bearer\s+/i.test(authHeader) &&
      keysStore &&
      scopes.length > 0
    ) {
      const principal = await resolveBearer(c, keysStore);
      if (principal === "missing" || principal === "invalid") {
        return c.json(
          errorEnvelope("Authentication required", UNAUTHORIZED),
          401,
        );
      }
      const have = new Set(principal.scopes);
      const ok = scopes.some((s) => have.has(s as ApiScope));
      if (!ok) {
        return c.json(
          errorEnvelope("Insufficient scope", FORBIDDEN, {
            required: [...scopes],
          }),
          403,
        );
      }
      await next();
      return;
    }

    const resolved = await resolveSession(c, store);
    if (!resolved) {
      return c.json(
        errorEnvelope("Authentication required", UNAUTHORIZED),
        401,
      );
    }
    await next();
  };
}

/** Type helper for handlers that run after requireRole. */
export type MembershipContext = MembershipRow;

// Re-export isExpired for callers that need expiry checks on key rows
export { isExpired, hashToken };
