/**
 * Authz middleware — section 2.2.
 *
 * - requireSession: HttpOnly cookie → user (401 if missing/expired)
 * - requireRole(roles): event_memberships role check
 *
 * HTTP matrix (documented):
 * | Condition | Status | Code |
 * |-----------|--------|------|
 * | No / invalid session | 401 | UNAUTHORIZED |
 * | Authenticated but wrong role | 403 | FORBIDDEN |
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
} from "@speakerops/shared";
import type { ApiEnv } from "../env.js";
import type { AuthStore, MembershipRow, SessionRow, UserRow } from "../modules/auth/store.js";
import { hashToken, isExpired } from "../modules/auth/crypto.js";
import { getSessionTokenFromCookieHeader } from "../modules/auth/cookies.js";

export type AuthzUser = {
  id: string;
  email: string;
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
};

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
 */
export function requireRole(
  store: AuthStore,
  allowedRoles: readonly EventRole[],
  options: RequireRoleOptions = {},
): MiddlewareHandler<ApiEnv> {
  const allowed = new Set(allowedRoles);

  return async (c, next) => {
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

/** Type helper for handlers that run after requireRole. */
export type MembershipContext = MembershipRow;
