/**
 * API composition root — Hono on Cloudflare Workers.
 *
 * Section 1.2: GET /health, E4 errors, correlation
 * Section 2.1: Auth magic-link routes (session cookies)
 * Section 2.2: requireRole + Event.List / Schedule.Place role gates
 * Section 2.3: Event.Create/Update + Room/Track upsert + active event data
 * Section 2.4: Design Kit draft/publish + logo presign + public tokens
 * Section 3.1: Form builder Create/UpdateDraft/Publish + public CFP get + OpenAPI
 * Section 3.3: Public CFP Submission.Create + file upload + Turnstile + rate limit
 * Section 3.4: Eval rubric / assignments / queue / scoring (S-EVAL)
 * Section 3.5: Decision.Record accept/reject/waitlist + direct session (S-EVAL)
 * Section 4.1: Portal.GetHome / Task.Complete / Participation.UpdateProfile
 *             + admin speakers list/detail + task templates O05 (S-PORTAL)
 * Section 4.2: File.PresignUpload headshot/slides + File.CompleteUpload + R2 metadata
 * Section 5.1: Comms.UpsertTemplate / Preview / Send enqueue (S-COMMS outbox)
 * Section 5.2: Send idempotency_keys + recipients + ICS UID/SEQUENCE + sandbox consumer
 * Section 5.3: Comms admin UI reads — ListTemplates/Jobs/Ics + IcsForPlacement HTTP
 * Section 6.1: Schedule.List/Place/Move/Unschedule + hard room/speaker conflict engine
 * Section 6.3: Reports.Readiness outstanding + stats (S-READY live dashboard)
 * Section 7.1: Keys.Create/Revoke/List + hashed secrets + Bearer auth (S-CLI)
 * Section 7.2: OpenAPI + speakerops CLI parity; bearerScopes on domain routes (S-CLI)
 * Section 7.3: Airtable one-way projection outbox drain + Reports.AirtableStatus (S-AIRTABLE)
 * Section 8.3: CSP + security headers on all responses; cookie flags; CFP rate limit/Turnstile review
 *
 * Domain routes from COMMANDS.md register here.
 *
 * CORS: same-origin policy by default — no open Access-Control-Allow-Origin.
 * SPA and Worker share the dogfood origin (or Vite proxy in local dev);
 * cross-origin headers are not added until an explicit public surface needs them.
 *
 * Production: default export builds stores from env.DB (D1) — never Memory*.
 * Tests/e2e: createApp / createAppWithAuth inject Memory* stores.
 */
import { Hono } from "hono";
import {
  HealthResponseSchema,
  TURNSTILE_TEST_SECRET_FAIL,
  TURNSTILE_TEST_SECRET_PASS,
  TURNSTILE_TEST_SITE_KEY,
  type HealthResponse,
} from "@speakerops/shared";
import { createDbMarker, SCHEMA_READY, type D1DatabaseLike } from "@speakerops/db";
import {
  correlationMiddleware,
  notFoundHandler,
  onErrorHandler,
} from "./middleware/errors.js";
import { securityHeadersMiddleware } from "./middleware/security.js";
import type { ApiEnv, WorkerBindings } from "./env.js";
import type { CfpRateLimiter } from "./modules/publicCfp/rateLimit.js";
import { createAuthRoutes } from "./modules/auth/routes.js";
import { createEventsRoutes } from "./modules/events/routes.js";
import { createScheduleRoutes } from "./modules/schedule/routes.js";
import {
  MemoryScheduleStore,
  D1ScheduleStore,
  type ScheduleStore,
} from "./modules/schedule/store.js";
import {
  createDesignRoutes,
  createPublicDesignRoutes,
  createFileRoutes,
} from "./modules/design/routes.js";
import {
  createEventFormsRoutes,
  createFormsRoutes,
  createPublicFormsRoutes,
} from "./modules/forms/routes.js";
import {
  MemoryAuthStore,
  D1AuthStore,
  MagicLinkTestOutbox,
  type AuthStore,
} from "./modules/auth/store.js";
import type { BootstrapPolicy } from "./modules/auth/commands.js";
import {
  MemoryEventsStore,
  D1EventsStore,
  type EventsStore,
} from "./modules/events/store.js";
import {
  MemoryDesignStore,
  D1DesignStore,
  type DesignStore,
} from "./modules/design/store.js";
import {
  MemoryFormsStore,
  D1FormsStore,
  type FormsStore,
} from "./modules/forms/store.js";
import {
  MemorySubmissionsStore,
  D1SubmissionsStore,
  type SubmissionsStore,
} from "./modules/publicCfp/store.js";
import { createPublicCfpRoutes } from "./modules/publicCfp/routes.js";
import {
  MemoryEvalStore,
  D1EvalStore,
  type EvalStore,
} from "./modules/eval/store.js";
import {
  createEventEvalRoutes,
  createAssignmentRoutes,
  createMeEvalRoutes,
  createSubmissionAssignRoutes,
} from "./modules/eval/routes.js";
import {
  MemoryDecisionsStore,
  D1DecisionsStore,
  type DecisionsStore,
} from "./modules/decisions/store.js";
import {
  createEventDecisionRoutes,
  createSubmissionDecisionRoutes,
} from "./modules/decisions/routes.js";
import {
  createPortalRoutes,
  createEventPortalRoutes,
} from "./modules/portal/routes.js";
import {
  createEventCommsRoutes,
  createCommsRoutes,
} from "./modules/comms/routes.js";
import {
  MemoryCommsStore,
  D1CommsStore,
  type CommsStore,
} from "./modules/comms/store.js";
import { createReadinessRoutes } from "./modules/readiness/routes.js";
import { createKeysRoutes } from "./modules/keys/routes.js";
import {
  MemoryKeysStore,
  D1KeysStore,
  type KeysStore,
} from "./modules/keys/store.js";
import {
  MemoryAirtableStore,
  D1AirtableStore,
  type AirtableStore,
} from "./modules/airtable/store.js";
import { createAirtableRoutes } from "./modules/airtable/routes.js";
import {
  processCommsOutbox,
  type ProcessOutboxResult,
} from "./workers/emailConsumer.js";
import {
  processAirtableOutbox,
  type ProcessAirtableOutboxResult,
} from "./workers/airtableConsumer.js";
import { registerOpenApiRoute } from "./openapi.js";

export type { ApiEnv, WorkerBindings } from "./env.js";

/** Default public app version when CF var APP_VERSION is unset (local tests). */
export const DEFAULT_APP_VERSION = "0.1.0";

export type CreateAppOptions = {
  /** Inject auth store (defaults to in-memory for local/test). */
  authStore?: AuthStore;
  /** Inject events store (defaults to in-memory for local/test). */
  eventsStore?: EventsStore;
  /** Inject design store (defaults to in-memory for local/test). */
  designStore?: DesignStore;
  /** Inject forms store (defaults to in-memory for local/test). */
  formsStore?: FormsStore;
  /** Inject submissions store (defaults to in-memory for local/test). */
  submissionsStore?: SubmissionsStore;
  /** Inject eval store (defaults to in-memory for local/test). */
  evalStore?: EvalStore;
  /** Inject decisions store (defaults to in-memory for local/test). */
  decisionsStore?: DecisionsStore;
  /** Inject comms store (defaults to in-memory for local/test). */
  commsStore?: CommsStore;
  /** Inject schedule store (defaults to in-memory for local/test). */
  scheduleStore?: ScheduleStore;
  /** Inject API keys store (defaults to in-memory for local/test). */
  keysStore?: KeysStore;
  /** Inject Airtable projection store (defaults to in-memory for local/test). */
  airtableStore?: AirtableStore;
  /** TURNSTILE_SECRET_KEY for tests (env name only in production). */
  turnstileSecret?: string;
  /**
   * Optional public CFP rate limiter inject (tests — deterministic 429).
   * Production uses process-local defaultCfpRateLimiter.
   */
  rateLimiter?: CfpRateLimiter;
  /** Shared test outbox for magic-link capture. */
  magicLinkOutbox?: MagicLinkTestOutbox;
  /**
   * Cookie Secure flag. Default true (E10 production-ready).
   * Tests may pass true explicitly; never disable in createAppFromBindings.
   */
  cookieSecure?: boolean;
  /**
   * Register GET /api/auth/dev/outbox.
   * Default: true when options.magicLinkOutbox is provided or AUTH_DEV_OUTBOX=1.
   */
  enableDevOutbox?: boolean;
  /**
   * Auth bootstrap policy. Production Worker: "controlled".
   * createAppWithAuth (e2e/tests): "open".
   */
  bootstrapPolicy?: BootstrapPolicy;
};

/**
 * Create the Hono app.
 * Used by the Worker default export and by unit tests via `app.request()`.
 *
 * When stores are omitted, Memory* is used (unit tests / createApp health only).
 * Production Worker must pass D1-backed stores from env.DB.
 */
export function createApp(options: CreateAppOptions = {}): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  // DB package wired at composition root (1.3 schema ready; domain repos later).
  void createDbMarker();
  void SCHEMA_READY;

  const authStore = options.authStore ?? new MemoryAuthStore();
  const eventsStore = options.eventsStore ?? new MemoryEventsStore();
  const designStore = options.designStore ?? new MemoryDesignStore();
  const formsStore = options.formsStore ?? new MemoryFormsStore();
  const submissionsStore =
    options.submissionsStore ?? new MemorySubmissionsStore();
  const evalStore = options.evalStore ?? new MemoryEvalStore();
  const decisionsStore = options.decisionsStore ?? new MemoryDecisionsStore();
  const commsStore = options.commsStore ?? new MemoryCommsStore();
  const scheduleStore = options.scheduleStore ?? new MemoryScheduleStore();
  const keysStore = options.keysStore ?? new MemoryKeysStore();
  const airtableStore = options.airtableStore ?? new MemoryAirtableStore();
  const magicLinkOutbox = options.magicLinkOutbox ?? new MagicLinkTestOutbox();
  // Dev outbox is opt-in only (e2e / tests). Production default export sets false.
  const enableDevOutbox = options.enableDevOutbox === true;
  // Production: controlled. createAppWithAuth overrides to open for e2e.
  const bootstrapPolicy = options.bootstrapPolicy ?? "controlled";
  const turnstileSecret = options.turnstileSecret;
  // Production-ready cookie flags (HttpOnly Secure SameSite=Lax) — default secure.
  const cookieSecure = options.cookieSecure !== false;

  app.use("*", correlationMiddleware);
  // Section 8.3 — CSP + security headers on all responses (including 404/500).
  app.use("*", securityHeadersMiddleware);

  /**
   * GET /health — COMMANDS.md HTTP map.
   * Response validated with Zod (E4) before send.
   * No auth; safe for CF and local smoke (S-CF health).
   */
  app.get("/health", (c) => {
    const version =
      typeof c.env?.APP_VERSION === "string" && c.env.APP_VERSION.length > 0
        ? c.env.APP_VERSION
        : DEFAULT_APP_VERSION;

    const payload: HealthResponse = { ok: true, version };
    const parsed = HealthResponseSchema.safeParse(payload);
    if (!parsed.success) {
      // Should never happen for static shape; fail closed with E4 envelope.
      throw new Error("Health response failed Zod validation");
    }
    return c.json(parsed.data, 200);
  });

  // Section 2.1 — magic-link session auth
  app.route(
    "/api/auth",
    createAuthRoutes({
      store: authStore,
      outbox: magicLinkOutbox,
      cookieSecure,
      enableDevOutbox,
      bootstrapPolicy,
    }),
  );

  // Section 2.3 — Event.Create/Update/List + rooms/tracks (admin role gate)
  // Section 7.2 — Bearer events:read|write for CLI
  // Section 7.3 — enqueue airtable.project on Event.Create/Update (S-AIRTABLE)
  app.route(
    "/api/events",
    createEventsRoutes({
      store: authStore,
      events: eventsStore,
      keys: keysStore,
      airtable: airtableStore,
    }),
  );

  // Section 2.4 — Design.Get/SetDraft/Publish under /api/events/:eventId/design
  // Section 7.2 — Bearer design:read|write for CLI
  app.route(
    "/api/events",
    createDesignRoutes({
      store: authStore,
      events: eventsStore,
      design: designStore,
      keys: keysStore,
    }),
  );

  // Section 2.2 role gate + 6.1 conflict engine — Schedule.* under /api/events/:eventId/schedule*
  // Section 7.2 — Bearer schedule:read|write (scope deny for reports-only keys)
  app.route(
    "/api/events",
    createScheduleRoutes({
      store: authStore,
      events: eventsStore,
      decisions: decisionsStore,
      schedule: scheduleStore,
      keys: keysStore,
    }),
  );

  // Section 2.4 — public published design tokens (never draft)
  app.route(
    "/api/public",
    createPublicDesignRoutes({
      store: authStore,
      events: eventsStore,
      design: designStore,
    }),
  );

  // Section 2.4 + 4.2 — File.PresignUpload / Upload / CompleteUpload (logo + headshot/slides)
  // Section 7.2 — Bearer files:write for CLI upload
  app.route(
    "/api/files",
    createFileRoutes({
      store: authStore,
      events: eventsStore,
      design: designStore,
      decisions: decisionsStore,
      submissions: submissionsStore,
      keys: keysStore,
    }),
  );

  // Section 3.1 — Form.Create under /api/events/:eventId/forms
  app.route(
    "/api/events",
    createEventFormsRoutes({
      store: authStore,
      events: eventsStore,
      forms: formsStore,
    }),
  );

  // Section 3.1 — Form.UpdateDraftFields / Form.Publish
  app.route(
    "/api/forms",
    createFormsRoutes({
      store: authStore,
      events: eventsStore,
      forms: formsStore,
    }),
  );

  // Section 3.1 — Form.GetPublic (published only; 3.3 window meta)
  app.route(
    "/api/public",
    createPublicFormsRoutes({
      store: authStore,
      events: eventsStore,
      forms: formsStore,
    }),
  );

  // Section 3.3 — Submission.Create + public CFP file upload
  // Section 8.3 — rate limit inject for deterministic 429 proofs
  app.route(
    "/api/public",
    createPublicCfpRoutes({
      store: authStore,
      events: eventsStore,
      forms: formsStore,
      design: designStore,
      submissions: submissionsStore,
      turnstileSecret,
      rateLimiter: options.rateLimiter,
    }),
  );

  const evalRouteOpts = {
    store: authStore,
    events: eventsStore,
    submissions: submissionsStore,
    eval: evalStore,
  };

  // Section 3.4 — Eval.UpsertRubric + admin rollup under /api/events/:eventId/eval/*
  app.route("/api/events", createEventEvalRoutes(evalRouteOpts));

  // Section 3.4 — Eval.Score
  app.route("/api/assignments", createAssignmentRoutes(evalRouteOpts));

  // Section 3.4 — evaluator queue (assigned only)
  app.route("/api/me", createMeEvalRoutes(evalRouteOpts));

  // Section 3.4 — Submission.AssignEvaluators
  app.route("/api/submissions", createSubmissionAssignRoutes(evalRouteOpts));

  const decisionRouteOpts = {
    store: authStore,
    events: eventsStore,
    submissions: submissionsStore,
    decisions: decisionsStore,
  };

  // Section 3.5 — Submission.List + Session.CreateDirect + bulk preview
  app.route("/api/events", createEventDecisionRoutes(decisionRouteOpts));

  // Section 3.5 — Decision.Record + Submission.Get
  app.route("/api/submissions", createSubmissionDecisionRoutes(decisionRouteOpts));

  const portalRouteOpts = {
    store: authStore,
    events: eventsStore,
    submissions: submissionsStore,
    decisions: decisionsStore,
    design: designStore,
  };

  // Section 4.1 — Portal.GetHome / Task.Complete / Participation.UpdateProfile
  app.route("/api/portal", createPortalRoutes(portalRouteOpts));

  // Section 4.1 — admin speakers list/detail + task templates (O05)
  app.route("/api/events", createEventPortalRoutes(portalRouteOpts));

  const commsRouteOpts = {
    store: authStore,
    events: eventsStore,
    submissions: submissionsStore,
    decisions: decisionsStore,
    comms: commsStore,
    keys: keysStore,
  };

  // Section 5.1 — Comms.UpsertTemplate under /api/events/:eventId/templates/:key
  app.route("/api/events", createEventCommsRoutes(commsRouteOpts));

  // Section 5.1–5.2 — Comms.Preview + Comms.Send (enqueue only, no provider HTTP)
  // Section 7.2 — Bearer comms:draft / comms:send for CLI
  app.route("/api/comms", createCommsRoutes(commsRouteOpts));

  // Section 6.3 — Reports.Readiness under /api/events/:eventId/readiness
  // Section 7.2 — Bearer reports:read for CLI
  app.route(
    "/api/events",
    createReadinessRoutes({
      store: authStore,
      events: eventsStore,
      submissions: submissionsStore,
      decisions: decisionsStore,
      keys: keysStore,
    }),
  );

  // Section 7.3 — Reports.AirtableStatus under /api/events/:eventId/airtable/status
  // Bearer airtable:read; lag fields only — no request-path Airtable (E7)
  app.route(
    "/api/events",
    createAirtableRoutes({
      store: authStore,
      events: eventsStore,
      airtable: airtableStore,
      keys: keysStore,
    }),
  );

  // Section 7.1 — Keys.List/Create/Revoke + Bearer keys:admin
  app.route(
    "/api/keys",
    createKeysRoutes({
      store: authStore,
      events: eventsStore,
      keys: keysStore,
    }),
  );

  // Section 3.1 / 3.3 / 3.4 / 3.5 / 4.1 / 5.1 / 5.2 / 6.1 / 6.3 / 7.1 / 7.2 / 7.3 — OpenAPI lists domain commands
  registerOpenApiRoute(app);

  app.notFound(notFoundHandler);
  app.onError(onErrorHandler);

  return app;
}

/**
 * Create app with always-on dev outbox (local e2e / vitest).
 * Production Worker default export does not enable this.
 * Uses open bootstrap so magic-link purpose can seed memberships for tests.
 */
export function createAppWithAuth(
  options: CreateAppOptions = {},
): {
  app: Hono<ApiEnv>;
  store: AuthStore;
  events: EventsStore;
  design: DesignStore;
  forms: FormsStore;
  submissions: SubmissionsStore;
  eval: EvalStore;
  decisions: DecisionsStore;
  comms: CommsStore;
  schedule: ScheduleStore;
  keys: KeysStore;
  airtable: AirtableStore;
  outbox: MagicLinkTestOutbox;
} {
  const store = options.authStore ?? new MemoryAuthStore();
  const events = options.eventsStore ?? new MemoryEventsStore();
  const design = options.designStore ?? new MemoryDesignStore();
  const forms = options.formsStore ?? new MemoryFormsStore();
  const submissions = options.submissionsStore ?? new MemorySubmissionsStore();
  const evalStore = options.evalStore ?? new MemoryEvalStore();
  const decisionsStore = options.decisionsStore ?? new MemoryDecisionsStore();
  const commsStore = options.commsStore ?? new MemoryCommsStore();
  const scheduleStore = options.scheduleStore ?? new MemoryScheduleStore();
  const keysStore = options.keysStore ?? new MemoryKeysStore();
  const airtableStore = options.airtableStore ?? new MemoryAirtableStore();
  const outbox = options.magicLinkOutbox ?? new MagicLinkTestOutbox();
  const app = createApp({
    ...options,
    authStore: store,
    eventsStore: events,
    designStore: design,
    formsStore: forms,
    submissionsStore: submissions,
    evalStore,
    decisionsStore,
    commsStore,
    scheduleStore,
    keysStore,
    airtableStore,
    magicLinkOutbox: outbox,
    enableDevOutbox: options.enableDevOutbox ?? true,
    // Open bootstrap for e2e/unit tests only — never production.
    bootstrapPolicy: options.bootstrapPolicy ?? "open",
  });
  return {
    app,
    store,
    events,
    design,
    forms,
    submissions,
    eval: evalStore,
    decisions: decisionsStore,
    comms: commsStore,
    schedule: scheduleStore,
    keys: keysStore,
    airtable: airtableStore,
    outbox,
  };
}

/**
 * Build production app from Worker bindings (D1 SoR).
 * Throws if DB binding is missing — Memory stores are never used in production.
 * Throws if TURNSTILE_SECRET_KEY is missing/empty or is a known development/Cloudflare
 * test secret (literal "test", always-pass, always-fail) — production must not fall
 * open to the public TURNSTILE_DEV_PASS_TOKEN or always-pass siteverify modes.
 * Throws if TURNSTILE_SITE_KEY is missing/empty or is the always-pass test site key —
 * otherwise the public CFP SPA falls back to the test UI and submits
 * TURNSTILE_DEV_PASS_TOKEN, which disables or breaks effective bot protection.
 */
export function createAppFromBindings(env: WorkerBindings): Hono<ApiEnv> {
  if (!env.DB) {
    throw new Error(
      "Worker binding DB is required for production SoR (E1). Memory stores are test-only.",
    );
  }
  const turnstileSecret =
    typeof env.TURNSTILE_SECRET_KEY === "string"
      ? env.TURNSTILE_SECRET_KEY.trim()
      : "";
  if (!turnstileSecret) {
    throw new Error(
      "Worker binding TURNSTILE_SECRET_KEY is required for production CFP bot protection (E10). " +
        "Omitting it would accept the public development pass token and disable effective protection.",
    );
  }
  // verifyTurnstile treats these as local/always-pass/always-fail modes; production
  // must use a real Cloudflare siteverify secret only.
  const isDevOrTestSecret =
    turnstileSecret === "test" ||
    turnstileSecret === TURNSTILE_TEST_SECRET_PASS ||
    turnstileSecret === TURNSTILE_TEST_SECRET_FAIL;
  if (isDevOrTestSecret) {
    throw new Error(
      "Worker binding TURNSTILE_SECRET_KEY must not be a development or Cloudflare test secret (E10). " +
        "Known test values (literal \"test\", always-pass, always-fail) disable effective CFP bot " +
        "protection by accepting public development tokens or always-pass siteverify modes.",
    );
  }
  const turnstileSiteKey =
    typeof env.TURNSTILE_SITE_KEY === "string"
      ? env.TURNSTILE_SITE_KEY.trim()
      : "";
  if (!turnstileSiteKey) {
    throw new Error(
      "Worker binding TURNSTILE_SITE_KEY is required for production CFP bot protection (E10). " +
        "Omitting it serves the Cloudflare always-pass test site key; the SPA then submits " +
        "TURNSTILE_DEV_PASS_TOKEN, which a real TURNSTILE_SECRET_KEY rejects and blocks all CFP submissions.",
    );
  }
  if (turnstileSiteKey === TURNSTILE_TEST_SITE_KEY) {
    throw new Error(
      "Worker binding TURNSTILE_SITE_KEY must not be the Cloudflare always-pass test site key (E10). " +
        "That key makes the SPA submit TURNSTILE_DEV_PASS_TOKEN and disables effective CFP bot protection.",
    );
  }
  const d1 = env.DB as D1DatabaseLike;
  return createApp({
    authStore: new D1AuthStore(d1),
    eventsStore: new D1EventsStore(d1),
    designStore: new D1DesignStore(d1, env.FILES),
    formsStore: new D1FormsStore(d1),
    submissionsStore: new D1SubmissionsStore(d1),
    evalStore: new D1EvalStore(d1),
    decisionsStore: new D1DecisionsStore(d1),
    commsStore: new D1CommsStore(d1),
    scheduleStore: new D1ScheduleStore(d1),
    keysStore: new D1KeysStore(d1),
    airtableStore: new D1AirtableStore(d1),
    turnstileSecret,
    enableDevOutbox: false,
    bootstrapPolicy: "controlled",
    // E10 / 8.3 — production session cookies always Secure + HttpOnly + SameSite=Lax
    cookieSecure: true,
  });
}

/** Cache one Hono app per env object (isolates reuse bindings). */
const appByEnv = new WeakMap<object, Hono<ApiEnv>>();

/**
 * Drain `comms.send` outbox with D1 stores + provider env (sandbox default).
 * Used by queue consumer and scheduled cron — never on the request path (E7).
 */
export async function drainCommsOutboxFromEnv(
  env: WorkerBindings,
  options: { correlationId?: string; limit?: number } = {},
): Promise<ProcessOutboxResult> {
  if (!env.DB) {
    throw new Error(
      "Worker binding DB is required to drain comms outbox (E1).",
    );
  }
  const d1 = env.DB as D1DatabaseLike;
  return processCommsOutbox({
    comms: new D1CommsStore(d1),
    auth: new D1AuthStore(d1),
    providerEnv: {
      EMAIL_PROVIDER: env.EMAIL_PROVIDER,
      RESEND_API_KEY: env.RESEND_API_KEY,
      EMAIL_FROM: env.EMAIL_FROM,
    },
  }, options);
}

/**
 * Drain `airtable.project` outbox with D1 stores + Airtable env.
 * When AIRTABLE_API_KEY unset, pauses without crash (S-AIRTABLE).
 * Never on the request path (E7).
 */
export async function drainAirtableOutboxFromEnv(
  env: WorkerBindings,
  options: { correlationId?: string; limit?: number } = {},
): Promise<ProcessAirtableOutboxResult> {
  if (!env.DB) {
    throw new Error(
      "Worker binding DB is required to drain airtable outbox (E1).",
    );
  }
  const d1 = env.DB as D1DatabaseLike;
  return processAirtableOutbox(
    {
      airtable: new D1AirtableStore(d1),
      auth: new D1AuthStore(d1),
      clientEnv: {
        AIRTABLE_API_KEY: env.AIRTABLE_API_KEY,
        AIRTABLE_BASE_ID: env.AIRTABLE_BASE_ID,
        AIRTABLE_TABLE_SUBMISSIONS: env.AIRTABLE_TABLE_SUBMISSIONS,
        AIRTABLE_TABLE_SPEAKERS: env.AIRTABLE_TABLE_SPEAKERS,
        AIRTABLE_TABLE_SESSIONS: env.AIRTABLE_TABLE_SESSIONS,
        AIRTABLE_TABLE_TASKS: env.AIRTABLE_TABLE_TASKS,
        AIRTABLE_TABLE_SCHEDULE: env.AIRTABLE_TABLE_SCHEDULE,
        AIRTABLE_TABLE_EVENTS: env.AIRTABLE_TABLE_EVENTS,
      },
    },
    options,
  );
}

/** Minimal queue batch surface (Cloudflare Queues consumer). */
export type QueueMessageBatch = {
  messages: ReadonlyArray<{
    id: string;
    body: unknown;
    ack: () => void;
    retry: () => void;
  }>;
};

/**
 * Cloudflare Workers default export.
 * - fetch: Hono HTTP (D1-backed stores)
 * - queue: drain comms + airtable outbox after JOBS_QUEUE kicks
 * - scheduled: cron backup drain so rows are never permanently stuck
 */
export default {
  fetch(
    request: Request,
    env: WorkerBindings,
    ctx?: unknown,
  ): Response | Promise<Response> {
    const key = env as object;
    let app = appByEnv.get(key);
    if (!app) {
      app = createAppFromBindings(env);
      appByEnv.set(key, app);
    }
    return app.fetch(request, env, ctx as never);
  },

  async queue(
    batch: QueueMessageBatch,
    env: WorkerBindings,
    _ctx?: unknown,
  ): Promise<void> {
    const correlationId = `queue:${batch.messages[0]?.id ?? "batch"}`;
    await drainCommsOutboxFromEnv(env, { correlationId });
    // S-AIRTABLE: drain projection outbox (pauses safely when key unset)
    await drainAirtableOutboxFromEnv(env, { correlationId });
    for (const msg of batch.messages) {
      msg.ack();
    }
  },

  async scheduled(
    _controller: { cron?: string; scheduledTime?: number },
    env: WorkerBindings,
    _ctx?: unknown,
  ): Promise<void> {
    const correlationId = `cron:${new Date().toISOString()}`;
    await drainCommsOutboxFromEnv(env, { correlationId });
    await drainAirtableOutboxFromEnv(env, { correlationId });
  },
};
