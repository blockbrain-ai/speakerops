/**
 * Auth HTTP routes — COMMANDS.md map (section 2.1 + 8.4 role switcher).
 *
 * POST /api/auth/magic-link  → Auth.RequestMagicLink
 * POST /api/auth/exchange    → Auth.ExchangeMagicLink
 * POST /api/auth/logout      → Auth.Logout
 *
 * Optional (AUTH_DEV_OUTBOX / enableDevOutbox):
 * GET  /api/auth/dev/outbox  → test capture (no secrets in prod)
 *
 * Optional (ROLE_SWITCHER_ENABLED / enableRoleSwitcher) — section 8.4:
 * POST /api/auth/dev/role-switch → Auth.DevRoleSwitch (dogfood/dev only)
 */
import { Hono } from "hono";
import {
  RequestMagicLinkBodySchema,
  RequestMagicLinkResponseSchema,
  ExchangeMagicLinkBodySchema,
  ExchangeMagicLinkResponseSchema,
  DevRoleSwitchBodySchema,
  DevRoleSwitchResponseSchema,
  errorEnvelope,
  VALIDATION_ERROR,
  UNAUTHORIZED,
  FORBIDDEN,
  NOT_FOUND,
  INTERNAL_ERROR,
  SESSION_COOKIE_NAME,
} from "@speakerops/shared";
import type { ApiEnv } from "../../env.js";
import {
  requestMagicLink,
  exchangeMagicLink,
  logoutSession,
  devRoleSwitch,
  type BootstrapPolicy,
} from "./commands.js";
import type { AuthStore, MagicLinkTestOutbox } from "./store.js";
import {
  buildSessionSetCookie,
  buildClearSessionCookie,
  getSessionTokenFromCookieHeader,
} from "./cookies.js";
import { hashToken, isExpired } from "./crypto.js";

export type AuthRouteOptions = {
  store: AuthStore;
  outbox: MagicLinkTestOutbox;
  /** Cookie Secure flag (default true). */
  cookieSecure?: boolean;
  /** Register GET /api/auth/dev/outbox for e2e (default false). */
  enableDevOutbox?: boolean;
  /**
   * Register POST /api/auth/dev/role-switch (section 8.4 dogfood/dev only).
   * Default false. Production createAppFromBindings never enables unless
   * ROLE_SWITCHER_ENABLED=1 is set explicitly for private dogfood.
   */
  enableRoleSwitcher?: boolean;
  /**
   * When role switcher is on, allow creating missing demo users (open bootstrap / e2e).
   * Dogfood with seed: false. Tests: true when bootstrap open.
   */
  roleSwitcherAllowCreate?: boolean;
  /**
   * When true, allow unauthenticated role-switch (local e2e/open bootstrap only).
   * Production/controlled dogfood always requires an existing valid session so a
   * public workers.dev host cannot mint event-admin cookies without prior auth.
   * Default: true only when bootstrapPolicy is "open".
   */
  roleSwitcherAllowUnauthenticated?: boolean;
  /** Production: "controlled". Tests/e2e: "open". */
  bootstrapPolicy?: BootstrapPolicy;
};

export function createAuthRoutes(options: AuthRouteOptions): Hono<ApiEnv> {
  const auth = new Hono<ApiEnv>();
  const deps = {
    store: options.store,
    outbox: options.outbox,
    bootstrapPolicy: options.bootstrapPolicy ?? "controlled",
  };
  const cookieSecure = options.cookieSecure !== false;

  /**
   * POST /api/auth/magic-link
   * Always 200 { sent: true } for valid body (no email enumeration).
   */
  auth.post("/magic-link", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(
        errorEnvelope("Invalid JSON body", VALIDATION_ERROR),
        400,
      );
    }

    const parsed = RequestMagicLinkBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        errorEnvelope("Validation failed", VALIDATION_ERROR, {
          issues: parsed.error.flatten(),
        }),
        400,
      );
    }

    const correlationId = c.get("correlationId");
    const bootstrapAdminEmail =
      typeof c.env?.BOOTSTRAP_ADMIN_EMAIL === "string"
        ? c.env.BOOTSTRAP_ADMIN_EMAIL
        : null;
    const result = await requestMagicLink(deps, {
      email: parsed.data.email,
      purpose: parsed.data.purpose,
      eventId: parsed.data.eventId,
      correlationId,
      bootstrapAdminEmail,
    });

    const out = RequestMagicLinkResponseSchema.safeParse(result);
    if (!out.success) {
      return c.json(
        errorEnvelope("Response validation failed", INTERNAL_ERROR),
        500,
      );
    }
    return c.json(out.data, 200);
  });

  /**
   * POST /api/auth/exchange
   * Single-use token → Set-Cookie session (HttpOnly Secure SameSite=Lax).
   */
  auth.post("/exchange", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(
        errorEnvelope("Invalid JSON body", VALIDATION_ERROR),
        400,
      );
    }

    const parsed = ExchangeMagicLinkBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        errorEnvelope("Validation failed", VALIDATION_ERROR, {
          issues: parsed.error.flatten(),
        }),
        400,
      );
    }

    const correlationId = c.get("correlationId");
    const result = await exchangeMagicLink(deps, {
      token: parsed.data.token,
      correlationId,
    });

    if (!result.ok) {
      return c.json(
        errorEnvelope("Invalid or expired magic link", UNAUTHORIZED, {
          reason: result.reason,
        }),
        401,
      );
    }

    const body = ExchangeMagicLinkResponseSchema.safeParse(result.response);
    if (!body.success) {
      return c.json(
        errorEnvelope("Response validation failed", INTERNAL_ERROR),
        500,
      );
    }

    c.header(
      "Set-Cookie",
      buildSessionSetCookie(result.sessionToken, { secure: cookieSecure }),
    );
    return c.json(body.data, 200);
  });

  /**
   * POST /api/auth/logout → 204 + clear cookie
   */
  auth.post("/logout", async (c) => {
    const correlationId = c.get("correlationId");
    const sessionToken = getSessionTokenFromCookieHeader(
      c.req.header("cookie"),
      SESSION_COOKIE_NAME,
    );
    await logoutSession(deps, { sessionToken, correlationId });
    c.header(
      "Set-Cookie",
      buildClearSessionCookie({ secure: cookieSecure }),
    );
    return c.body(null, 204);
  });

  /**
   * Dev/test only: inspect captured magic links (no production registration).
   * Response intentionally omits bulk dumps in structured logs.
   */
  if (options.enableDevOutbox) {
    auth.get("/dev/outbox", (c) => {
      const email = c.req.query("email");
      if (email) {
        const last = options.outbox.lastForEmail(email);
        if (!last) {
          return c.json({ link: null }, 200);
        }
        return c.json(
          {
            link: {
              email: last.email,
              purpose: last.purpose,
              token: last.token,
              eventId: last.eventId,
              /** User id for e2e assign flows (not a secret). */
              userId: last.userId,
              createdAt: last.createdAt,
            },
          },
          200,
        );
      }
      // List metadata without tokens when no email filter (safer default)
      return c.json(
        {
          count: options.outbox.all().length,
          emails: options.outbox.all().map((l) => l.email),
        },
        200,
      );
    });
  }

  /**
   * POST /api/auth/dev/role-switch → Auth.DevRoleSwitch (section 8.4)
   * Dogfood/dev only — route absent when enableRoleSwitcher is false (404).
   *
   * Security (E10 / phase audit): workers.dev is not private by itself.
   * Controlled/production dogfood requires an existing valid session cookie
   * before minting a demo role session — unauthenticated callers cannot
   * obtain event-admin access by discovering this endpoint.
   * Local e2e (open bootstrap) may allow unauthenticated switch for harness.
   */
  if (options.enableRoleSwitcher) {
    auth.post("/dev/role-switch", async (c) => {
      const bootstrap = options.bootstrapPolicy ?? "controlled";
      const allowUnauthenticated =
        options.roleSwitcherAllowUnauthenticated === true ||
        (options.roleSwitcherAllowUnauthenticated !== false &&
          bootstrap === "open");

      if (!allowUnauthenticated) {
        const sessionToken = getSessionTokenFromCookieHeader(
          c.req.header("cookie"),
          SESSION_COOKIE_NAME,
        );
        if (!sessionToken) {
          return c.json(
            errorEnvelope(
              "Authentication required for role switch",
              UNAUTHORIZED,
            ),
            401,
          );
        }
        const tokenHash = await hashToken(sessionToken);
        const session = await options.store.findSessionByTokenHash(tokenHash);
        if (!session || isExpired(session.expiresAt)) {
          return c.json(
            errorEnvelope(
              "Authentication required for role switch",
              UNAUTHORIZED,
            ),
            401,
          );
        }
        const actor = await options.store.findUserById(session.userId);
        if (!actor) {
          return c.json(
            errorEnvelope(
              "Authentication required for role switch",
              UNAUTHORIZED,
            ),
            401,
          );
        }
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
      const parsed = DevRoleSwitchBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, {
            issues: parsed.error.flatten(),
          }),
          400,
        );
      }

      const correlationId = c.get("correlationId");
      const allowCreate =
        options.roleSwitcherAllowCreate === true || bootstrap === "open";

      const result = await devRoleSwitch(deps, {
        role: parsed.data.role,
        eventId: parsed.data.eventId,
        correlationId,
        allowCreate,
      });

      if (!result.ok) {
        const code =
          result.status === 404
            ? NOT_FOUND
            : result.status === 403
              ? FORBIDDEN
              : INTERNAL_ERROR;
        return c.json(errorEnvelope(result.error, code), result.status);
      }

      const out = DevRoleSwitchResponseSchema.safeParse(result.response);
      if (!out.success) {
        return c.json(
          errorEnvelope("Response validation failed", INTERNAL_ERROR),
          500,
        );
      }

      c.header(
        "Set-Cookie",
        buildSessionSetCookie(result.sessionToken, { secure: cookieSecure }),
      );
      return c.json(out.data, 200);
    });
  }

  return auth;
}
