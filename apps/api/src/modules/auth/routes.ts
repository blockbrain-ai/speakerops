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
  MeMembershipsResponseSchema,
  DevRoleSwitchBodySchema,
  DevRoleSwitchResponseSchema,
  JudgeAccessBodySchema,
  JudgeAccessResponseSchema,
  errorEnvelope,
  VALIDATION_ERROR,
  UNAUTHORIZED,
  FORBIDDEN,
  NOT_FOUND,
  INTERNAL_ERROR,
  RATE_LIMITED,
  SESSION_COOKIE_NAME,
  JUDGE_SESSION_COOKIE_NAME,
  DEFAULT_BOOTSTRAP_EVENT_ID,
  type AuthMembershipOption,
  type EventRole,
} from "@speakerops/shared";
import type { ApiEnv } from "../../env.js";
import {
  requestMagicLink,
  exchangeMagicLink,
  logoutSession,
  devRoleSwitch,
  parseMagicLinkAllowlist,
  type BootstrapPolicy,
  type MagicLinkMailDeps,
} from "./commands.js";
import type { AuthStore, MagicLinkTestOutbox } from "./store.js";
import type { EventsStore } from "../events/store.js";
import {
  CfpRateLimiter,
  clientKeyFromRequest,
  rateLimitHeaders,
} from "../publicCfp/rateLimit.js";
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
): Promise<{ userId: string; sessionToken: string; expiresAt: string } | null> {
  if (!sessionToken) return null;
  const tokenHash = await hashToken(sessionToken);
  const session = await store.findSessionByTokenHash(tokenHash);
  if (!session || isExpired(session.expiresAt)) return null;
  const actor = await store.findUserById(session.userId);
  if (!actor) return null;
  const membership = await store.findMembership(eventId, actor.id);
  if (!membership || membership.role !== "admin") return null;
  // expiresAt lets role-switch cap child sessions at the authorizing
  // session's remaining lifetime (judge 4h TTL must survive hops).
  return { userId: actor.id, sessionToken, expiresAt: session.expiresAt };
}

export type AuthRouteOptions = {
  store: AuthStore;
  outbox: MagicLinkTestOutbox;
  /** When set, membership lists include event names. */
  events?: EventsStore;
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
  /** Durable magic-link email (encrypt + outbox). Optional. */
  magicLinkMail?: MagicLinkMailDeps | null;
  /**
   * Competition judge entry code (JUDGE_ACCESS_CODE env name; value is a
   * secret). POST /api/auth/judge-access registers only when this is set AND
   * enableRoleSwitcher is true; otherwise the path 404s. Never logged.
   */
  judgeAccessCode?: string | null;
};

async function membershipOptionsForUser(
  store: AuthStore,
  events: EventsStore | undefined,
  userId: string,
): Promise<AuthMembershipOption[]> {
  const rows = await store.listMembershipsForUser(userId);
  const out: AuthMembershipOption[] = [];
  for (const m of rows) {
    let eventName = m.eventId;
    if (events) {
      const ev = await events.findEventById(m.eventId);
      if (ev?.name) eventName = ev.name;
    }
    out.push({
      eventId: m.eventId,
      eventName,
      role: m.role as EventRole,
    });
  }
  return out;
}

export function createAuthRoutes(options: AuthRouteOptions): Hono<ApiEnv> {
  const auth = new Hono<ApiEnv>();
  const deps = {
    store: options.store,
    outbox: options.outbox,
    bootstrapPolicy: options.bootstrapPolicy ?? "controlled",
    magicLinkMail: options.magicLinkMail ?? null,
  };
  const cookieSecure = options.cookieSecure !== false;

  /**
   * POST /api/auth/magic-link
   * Always 200 { sent: true } for valid body (no email enumeration).
   * A5: dual-bucket rate limit — per IP (~10/15min) AND per email (~5/15min).
   */
  // Process-local dual buckets (matches CFP limiter; multi-isolate later).
  const magicLinkIpLimiter = new CfpRateLimiter(10, 15 * 60_000);
  const magicLinkEmailLimiter = new CfpRateLimiter(5, 15 * 60_000);

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

    const ipKey = `ml-ip:${clientKeyFromRequest(c)}`;
    const emailKey = `ml-email:${parsed.data.email.trim().toLowerCase()}`;
    const ipRl = magicLinkIpLimiter.check(ipKey);
    const emailRl = magicLinkEmailLimiter.check(emailKey);
    if (!ipRl.allowed || !emailRl.allowed) {
      const blocked = !ipRl.allowed ? ipRl : emailRl;
      const headers = rateLimitHeaders(blocked);
      return c.json(
        errorEnvelope("Too many magic-link requests", RATE_LIMITED, {
          limit: blocked.limit,
          remaining: blocked.remaining,
        }),
        429,
        headers,
      );
    }

    const correlationId = c.get("correlationId");
    const bootstrapAdminEmail =
      typeof c.env?.BOOTSTRAP_ADMIN_EMAIL === "string"
        ? c.env.BOOTSTRAP_ADMIN_EMAIL
        : null;
    const magicLinkAllowlist = parseMagicLinkAllowlist(
      typeof c.env?.MAGIC_LINK_ALLOWLIST === "string"
        ? c.env.MAGIC_LINK_ALLOWLIST
        : null,
    );
    const result = await requestMagicLink(deps, {
      email: parsed.data.email,
      // Preserve omitted purpose so membership-aware login does not default-grant speaker.
      purpose: parsed.data.purpose,
      eventId: parsed.data.eventId,
      correlationId,
      bootstrapAdminEmail,
      magicLinkAllowlist,
    });

    const out = RequestMagicLinkResponseSchema.safeParse(result);
    if (!out.success) {
      return c.json(
        errorEnvelope("Response validation failed", INTERNAL_ERROR),
        500,
      );
    }
    return c.json(out.data, 200, {
      ...rateLimitHeaders(
        emailRl.remaining <= ipRl.remaining ? emailRl : ipRl,
      ),
    });
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

    const memberships = await membershipOptionsForUser(
      options.store,
      options.events,
      result.userId,
    );
    const body = ExchangeMagicLinkResponseSchema.safeParse({
      ...result.response,
      memberships,
    });
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
   * GET /api/auth/me — session identity + event memberships for shells/chooser.
   */
  auth.get("/me", async (c) => {
    const token = getSessionTokenFromCookieHeader(
      c.req.header("cookie") ?? null,
    );
    if (!token) {
      return c.json(
        errorEnvelope("Authentication required", UNAUTHORIZED),
        401,
      );
    }
    const tokenHash = await hashToken(token);
    const session = await options.store.findSessionByTokenHash(tokenHash);
    if (!session || isExpired(session.expiresAt)) {
      return c.json(
        errorEnvelope("Authentication required", UNAUTHORIZED),
        401,
      );
    }
    const user = await options.store.findUserById(session.userId);
    if (!user) {
      return c.json(
        errorEnvelope("Authentication required", UNAUTHORIZED),
        401,
      );
    }
    const memberships = await membershipOptionsForUser(
      options.store,
      options.events,
      user.id,
    );
    const body = MeMembershipsResponseSchema.safeParse({
      email: user.email,
      userId: user.id,
      memberships,
    });
    if (!body.success) {
      return c.json(
        errorEnvelope("Response validation failed", INTERNAL_ERROR),
        500,
      );
    }
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
      /**
       * Expiry of the authorizing session (ISO). The minted child session —
       * DB row AND cookies — must never outlive it: a judge's 4h TTL must not
       * be laundered into a 14-day session via a role-switch hop.
       */
      let authorizingExpiresAt: string | null = null;

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
          authorizingExpiresAt = fromSession.expiresAt;
        } else {
          const fromJudge = await resolveAdminActorForEvent(
            options.store,
            judgeCookieToken,
            targetEventId,
          );
          if (fromJudge) {
            preserveJudgeToken = fromJudge.sessionToken;
            authorizingExpiresAt = fromJudge.expiresAt;
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
          authorizingExpiresAt = fromSession.expiresAt;
        } else if (judgeCookieToken) {
          const fromJudge = await resolveAdminActorForEvent(
            options.store,
            judgeCookieToken,
            targetEventId,
          );
          if (fromJudge) {
            preserveJudgeToken = fromJudge.sessionToken;
            authorizingExpiresAt = fromJudge.expiresAt;
          }
        }
      }

      // Cap the child session at the authorizing session's remaining TTL —
      // never extend on a hop (child ≤ authorizing session). When there is no
      // authorizing session (open-bootstrap harness), the default TTL applies.
      let sessionTtlSeconds: number | undefined;
      if (authorizingExpiresAt) {
        const remainingMs =
          new Date(authorizingExpiresAt).getTime() - Date.now();
        sessionTtlSeconds = Math.max(1, Math.floor(remainingMs / 1000));
      }

      const correlationId = c.get("correlationId");
      const allowCreate =
        options.roleSwitcherAllowCreate === true || bootstrap === "open";

      const result = await devRoleSwitch(deps, {
        role: parsed.data.role,
        eventId: parsed.data.eventId,
        correlationId,
        allowCreate,
        sessionTtlSeconds,
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

      // Active product session → demo role user. Cookie Max-Age shares the
      // capped TTL so browser state never outlives the credential.
      c.header(
        "Set-Cookie",
        buildSessionSetCookie(result.sessionToken, {
          secure: cookieSecure,
          maxAgeSeconds: sessionTtlSeconds,
        }),
        { append: true },
      );
      // Preserve original judge authorization across impersonation so the
      // switcher remains functional after admin → evaluator/speaker. Same cap:
      // the preserved cookie must not outlive the session it points at.
      if (preserveJudgeToken) {
        c.header(
          "Set-Cookie",
          buildSessionSetCookie(preserveJudgeToken, {
            secure: cookieSecure,
            name: JUDGE_SESSION_COOKIE_NAME,
            maxAgeSeconds: sessionTtlSeconds,
          }),
          { append: true },
        );
      }
      return c.json(out.data, 200);
    });
  }

  /**
   * POST /api/auth/judge-access → Auth.JudgeAccess (competition judge entry).
   *
   * Registered ONLY when enableRoleSwitcher AND a judgeAccessCode are
   * configured — otherwise the path is absent (404), indistinguishable from
   * a non-existent route. Server-fixed demo event; the client chooses only
   * the role label. Constant-time code comparison (both sides SHA-256 hashed
   * before compare). Mints a 4-hour session (DB row AND cookie share the
   * TTL). Rate-limited per isolate. Audit event Auth.JudgeAccess on mint.
   * Failures are generic (401, no reason detail) and never logged with body.
   */
  if (options.enableRoleSwitcher && options.judgeAccessCode) {
    const judgeCode = options.judgeAccessCode;
    const JUDGE_SESSION_TTL_SECONDS = 4 * 60 * 60;
    /** Isolate-local limiter: 10 attempts / 5 min per client IP. */
    const judgeLimiter = new Map<string, { count: number; windowStartMs: number }>();
    const JUDGE_RATE_MAX = 10;
    const JUDGE_RATE_WINDOW_MS = 5 * 60 * 1000;

    auth.post("/judge-access", async (c) => {
      const ip =
        c.req.header("cf-connecting-ip") ??
        c.req.header("x-forwarded-for") ??
        "unknown";
      const nowMs = Date.now();
      const bucket = judgeLimiter.get(ip);
      if (!bucket || nowMs - bucket.windowStartMs > JUDGE_RATE_WINDOW_MS) {
        judgeLimiter.set(ip, { count: 1, windowStartMs: nowMs });
      } else if (bucket.count >= JUDGE_RATE_MAX) {
        return c.json(
          errorEnvelope("Too many attempts — try again later", UNAUTHORIZED),
          429,
        );
      } else {
        bucket.count += 1;
      }

      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json(errorEnvelope("Invalid JSON body", VALIDATION_ERROR), 400);
      }
      const parsed = JudgeAccessBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR),
          400,
        );
      }

      // Constant-time comparison: hash both sides (fixed-length digests) so
      // compare time is independent of match position or code length.
      const [suppliedHash, expectedHash] = await Promise.all([
        hashToken(parsed.data.code),
        hashToken(judgeCode),
      ]);
      let diff = 0;
      for (let i = 0; i < expectedHash.length; i++) {
        diff |= suppliedHash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
      }
      if (diff !== 0 || suppliedHash.length !== expectedHash.length) {
        // Generic failure — no distinction between wrong code and other causes.
        return c.json(errorEnvelope("Invalid access code", UNAUTHORIZED), 401);
      }

      const correlationId = c.get("correlationId");
      // Server-fixed demo event; personas must be pre-seeded (never created).
      const result = await devRoleSwitch(deps, {
        role: parsed.data.role,
        eventId: DEFAULT_BOOTSTRAP_EVENT_ID,
        correlationId,
        allowCreate: false,
        sessionTtlSeconds: JUDGE_SESSION_TTL_SECONDS,
        auditAction: "Auth.JudgeAccess",
      });
      if (!result.ok) {
        // Persona not seeded / role mismatch — still generic to the caller.
        return c.json(errorEnvelope("Invalid access code", UNAUTHORIZED), 401);
      }

      const out = JudgeAccessResponseSchema.safeParse(result.response);
      if (!out.success) {
        return c.json(
          errorEnvelope("Response validation failed", INTERNAL_ERROR),
          500,
        );
      }
      c.header(
        "Set-Cookie",
        buildSessionSetCookie(result.sessionToken, {
          secure: cookieSecure,
          maxAgeSeconds: JUDGE_SESSION_TTL_SECONDS,
        }),
        { append: true },
      );
      return c.json(out.data, 200);
    });
  }

  return auth;
}
