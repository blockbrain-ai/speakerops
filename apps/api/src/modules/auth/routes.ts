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
  JUDGE_SESSION_COOKIE_NAME,
  DEFAULT_BOOTSTRAP_EVENT_ID,
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

/**
 * Resolve a session cookie to an event-admin user id when the session is
 * valid and holds admin membership on `eventId`. Returns null otherwise.
 */
async function resolveAdminActorForEvent(
  store: AuthStore,
  sessionToken: string | null,
  eventId: string,
): Promise<{ userId: string; sessionToken: string } | null> {
  if (!sessionToken) return null;
  const tokenHash = await hashToken(sessionToken);
  const session = await store.findSessionByTokenHash(tokenHash);
  if (!session || isExpired(session.expiresAt)) return null;
  const actor = await store.findUserById(session.userId);
  if (!actor) return null;
  const membership = await store.findMembership(eventId, actor.id);
  if (!membership || membership.role !== "admin") return null;
  return { userId: actor.id, sessionToken };
}

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
   * POST /api/auth/logout → 204 + clear session (+ judge origin) cookies
   *
   * Revokes both the active product session and any distinct judge-origin
   * session in the store (not only browser cookies). Otherwise admin→evaluator
   * logout would leave the preserved admin token valid for role-switch replay.
   */
  auth.post("/logout", async (c) => {
    const correlationId = c.get("correlationId");
    const cookieHeader = c.req.header("cookie");
    const sessionToken = getSessionTokenFromCookieHeader(
      cookieHeader,
      SESSION_COOKIE_NAME,
    );
    const judgeSessionToken = getSessionTokenFromCookieHeader(
      cookieHeader,
      JUDGE_SESSION_COOKIE_NAME,
    );
    await logoutSession(deps, {
      sessionToken,
      judgeSessionToken,
      correlationId,
    });
    c.header(
      "Set-Cookie",
      buildClearSessionCookie({ secure: cookieSecure }),
      { append: true },
    );
    // Clear dogfood judge-origin cookie so impersonation cannot outlive logout.
    c.header(
      "Set-Cookie",
      buildClearSessionCookie({
        secure: cookieSecure,
        name: JUDGE_SESSION_COOKIE_NAME,
      }),
      { append: true },
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
   * Controlled/production dogfood requires:
   *   1) an existing valid session cookie **or** a preserved judge-origin
   *      cookie from a prior authorized switch (no anonymous mint), and
   *   2) the authorizing actor holds **admin** membership on the **exact**
   *      target event (E2 multi-event isolation — admin on A cannot mint
   *      sessions for B; bare speakers/evaluators cannot escalate to admin).
   *
   * When an event admin switches into evaluator/speaker, the original admin
   * session token is preserved in `speakerops_judge_session` so the switcher
   * remains usable (admin→evaluator→admin) without re-login. The judge cookie
   * is never accepted as the primary product session.
   *
   * Local e2e (open bootstrap) may allow unauthenticated switch for harness.
   */
  if (options.enableRoleSwitcher) {
    auth.post("/dev/role-switch", async (c) => {
      const bootstrap = options.bootstrapPolicy ?? "controlled";
      const allowUnauthenticated =
        options.roleSwitcherAllowUnauthenticated === true ||
        (options.roleSwitcherAllowUnauthenticated !== false &&
          bootstrap === "open");

      const cookieHeader = c.req.header("cookie");
      const sessionToken = getSessionTokenFromCookieHeader(
        cookieHeader,
        SESSION_COOKIE_NAME,
      );
      const judgeCookieToken = getSessionTokenFromCookieHeader(
        cookieHeader,
        JUDGE_SESSION_COOKIE_NAME,
      );

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

      const targetEventId =
        parsed.data.eventId ?? DEFAULT_BOOTSTRAP_EVENT_ID;

      /**
       * Judge session token to preserve across impersonation (controlled path).
       * Prefer the active session when it is event-admin; otherwise the
       * existing judge-origin cookie when it still authorizes as admin.
       */
      let preserveJudgeToken: string | null = null;

      // Controlled/production: only event admins (judges) — or a preserved
      // judge-origin cookie from a prior authorized switch — may mint demo roles.
      // Authorization is **event-scoped** (E2). Bare evaluators/speakers without
      // a judge-origin cookie must not escalate to admin.
      if (!allowUnauthenticated) {
        if (!sessionToken && !judgeCookieToken) {
          return c.json(
            errorEnvelope(
              "Authentication required for role switch",
              UNAUTHORIZED,
            ),
            401,
          );
        }

        const fromSession = await resolveAdminActorForEvent(
          options.store,
          sessionToken,
          targetEventId,
        );
        if (fromSession) {
          preserveJudgeToken = fromSession.sessionToken;
        } else {
          const fromJudge = await resolveAdminActorForEvent(
            options.store,
            judgeCookieToken,
            targetEventId,
          );
          if (fromJudge) {
            preserveJudgeToken = fromJudge.sessionToken;
          }
        }

        if (!preserveJudgeToken) {
          // Present but non-admin (or expired) credentials → forbid escalation.
          return c.json(
            errorEnvelope(
              "Admin role required for role switch on target event",
              FORBIDDEN,
            ),
            403,
          );
        }
      } else {
        // Open bootstrap: still preserve judge origin when the active session
        // is event-admin so chained switches work if the Worker later gates.
        const fromSession = await resolveAdminActorForEvent(
          options.store,
          sessionToken,
          targetEventId,
        );
        if (fromSession) {
          preserveJudgeToken = fromSession.sessionToken;
        } else if (judgeCookieToken) {
          const fromJudge = await resolveAdminActorForEvent(
            options.store,
            judgeCookieToken,
            targetEventId,
          );
          if (fromJudge) {
            preserveJudgeToken = fromJudge.sessionToken;
          }
        }
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

      // Active product session → demo role user.
      c.header(
        "Set-Cookie",
        buildSessionSetCookie(result.sessionToken, { secure: cookieSecure }),
        { append: true },
      );
      // Preserve original judge authorization across impersonation so the
      // switcher remains functional after admin → evaluator/speaker.
      if (preserveJudgeToken) {
        c.header(
          "Set-Cookie",
          buildSessionSetCookie(preserveJudgeToken, {
            secure: cookieSecure,
            name: JUDGE_SESSION_COOKIE_NAME,
          }),
          { append: true },
        );
      }
      return c.json(out.data, 200);
    });
  }

  return auth;
}
