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
 * Section 8.4: Demo seed support + Auth.DevRoleSwitch (dogfood/dev only flag)
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
  MemorySavedViewsStore,
  D1SavedViewsStore,
  type SavedViewsStore,
} from "./modules/grid/store.js";
import { createEventGridRoutes } from "./modules/grid/routes.js";
import {
  MemorySearchStore,
  D1SearchStore,
  type SearchStore,
} from "./modules/search/store.js";
import { createEventSearchRoutes } from "./modules/search/routes.js";
import {
  MemoryProgrammeStore,
  D1ProgrammeStore,
  type ProgrammeStore,
} from "./modules/programme/store.js";
import {
  createEventProgrammeRoutes,
  createPublicProgrammeRoutes,
} from "./modules/programme/routes.js";
import {
  processCommsOutbox,
  type ProcessOutboxResult,
} from "./workers/emailConsumer.js";
import {
  processAirtableOutbox,
  type ProcessAirtableOutboxResult,
} from "./workers/airtableConsumer.js";
import {
  processAuthMagicLinkOutbox,
  type ProcessAuthOutboxResult,
} from "./workers/authEmailConsumer.js";
import type { MagicLinkMailDeps } from "./modules/auth/commands.js";
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
  /** Inject saved views store (F3; defaults to in-memory for local/test). */
  savedViewsStore?: SavedViewsStore;
  /** Inject search store (F5; defaults to in-memory for local/test). */
  searchStore?: SearchStore;
  /** Inject programme publication store (F7; defaults to in-memory). */
  programmeStore?: ProgrammeStore;
  /** TURNSTILE_SECRET_KEY for tests (env name only in production). */
  turnstileSecret?: string;
  /**
   * DEMO_MODE Turnstile path (section 10.3). When true, TURNSTILE_DEV_PASS_TOKEN
   * may be accepted under allowlist rules. createAppWithAuth defaults true (e2e);
   * createAppFromBindings sets from DEMO_MODE env (default false).
   */
  demoMode?: boolean;
  /**
   * When true with demoMode, DEV_PASS requires host (and optional event) allowlist.
   */
  demoAllowlistEnabled?: boolean;
  /** Allowlisted hostnames for DEMO pass token. */
  demoAllowlistHosts?: string[];
  /** Optional allowlisted event slugs for DEMO pass token. */
  demoAllowlistEventSlugs?: string[];
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
   * Register POST /api/auth/dev/role-switch (section 8.4).
   * Default false. createAppWithAuth enables for e2e; production only when
   * ROLE_SWITCHER_ENABLED=1 (dogfood judges).
   *
   * Production/controlled path requires an existing **admin** session cookie
   * (workers.dev is not private — no open admin mint; non-admins cannot escalate).
   */
  enableRoleSwitcher?: boolean;
  /**
   * Competition judge entry code (JUDGE_ACCESS_CODE secret). Judge-access
   * route registers only when set together with enableRoleSwitcher.
   */
  judgeAccessCode?: string | null;
  /**
   * When true, allow unauthenticated Auth.DevRoleSwitch (local e2e only).
   * Default: true when bootstrapPolicy is "open"; false under controlled/production.
   */
  roleSwitcherAllowUnauthenticated?: boolean;
  /**
   * Auth bootstrap policy. Production Worker: "controlled".
   * createAppWithAuth (e2e/tests): "open".
   */
  bootstrapPolicy?: BootstrapPolicy;
  /**
   * Durable magic-link email (encrypt + outbox). Production: from env.
   * Tests may inject MemoryCommsStore + encryption key.
   */
  magicLinkMail?: MagicLinkMailDeps | null;
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
  const savedViewsStore =
    options.savedViewsStore ?? new MemorySavedViewsStore();
  const searchStore = options.searchStore ?? new MemorySearchStore();
  const programmeStore = options.programmeStore ?? new MemoryProgrammeStore();
  const magicLinkOutbox = options.magicLinkOutbox ?? new MagicLinkTestOutbox();
  // Dev outbox is opt-in only (e2e / tests). Production default export sets false.
  const enableDevOutbox = options.enableDevOutbox === true;
  // Role switcher is opt-in only (section 8.4 dogfood/dev). Production default false.
  const enableRoleSwitcher = options.enableRoleSwitcher === true;
  // Production: controlled. createAppWithAuth overrides to open for e2e.
  const bootstrapPolicy = options.bootstrapPolicy ?? "controlled";
  const turnstileSecret = options.turnstileSecret;
  // Section 10.3 — DEMO Turnstile (default off for bare createApp; createAppWithAuth opts in).
  const demoMode = options.demoMode === true;
  const demoAllowlistEnabled = options.demoAllowlistEnabled === true;
  const demoAllowlistHosts = options.demoAllowlistHosts ?? [];
  const demoAllowlistEventSlugs = options.demoAllowlistEventSlugs ?? [];
  const demoTurnstile = {
    demoMode,
    demoAllowlistEnabled,
    demoAllowlistHosts,
    demoAllowlistEventSlugs,
  };
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

  // Section 2.1 — magic-link session auth (+ optional durable email outbox)
  // Section 8.4 — optional Auth.DevRoleSwitch when enableRoleSwitcher
  app.route(
    "/api/auth",
    createAuthRoutes({
      store: authStore,
      outbox: magicLinkOutbox,
      events: eventsStore,
      cookieSecure,
      enableDevOutbox,
      enableRoleSwitcher,
      judgeAccessCode: options.judgeAccessCode ?? null,
      roleSwitcherAllowCreate: bootstrapPolicy === "open",
      roleSwitcherAllowUnauthenticated:
        options.roleSwitcherAllowUnauthenticated,
      bootstrapPolicy,
      magicLinkMail: options.magicLinkMail ?? null,
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
  // Section 7.2 — Bearer cfp:read|write for CLI
  app.route(
    "/api/events",
    createEventFormsRoutes({
      store: authStore,
      events: eventsStore,
      forms: formsStore,
      keys: keysStore,
    }),
  );

  // Section 3.1 — Form.UpdateDraftFields / Form.Publish
  // Section 7.2 — Bearer cfp:read|write for CLI
  app.route(
    "/api/forms",
    createFormsRoutes({
      store: authStore,
      events: eventsStore,
      forms: formsStore,
      keys: keysStore,
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
  // Section 10.3 — DEMO_MODE Turnstile allowlist
  // Wave 1B — comms store for the submission confirmation lifecycle email
  app.route(
    "/api/public",
    createPublicCfpRoutes({
      store: authStore,
      events: eventsStore,
      forms: formsStore,
      design: designStore,
      submissions: submissionsStore,
      comms: commsStore,
      turnstileSecret,
      demoTurnstile,
      rateLimiter: options.rateLimiter,
    }),
  );

  const evalRouteOpts = {
    store: authStore,
    events: eventsStore,
    submissions: submissionsStore,
    eval: evalStore,
    forms: formsStore,
    keys: keysStore,
  };

  // Section 3.4 — Eval.UpsertRubric + admin rollup under /api/events/:eventId/eval/*
  app.route("/api/events", createEventEvalRoutes(evalRouteOpts));

  // Section 3.4 — Eval.Score
  app.route("/api/assignments", createAssignmentRoutes(evalRouteOpts));

  // Section 3.4 — evaluator queue (assigned only)
  app.route("/api/me", createMeEvalRoutes(evalRouteOpts));

  // Section 3.4 — Submission.AssignEvaluators
  app.route("/api/submissions", createSubmissionAssignRoutes(evalRouteOpts));

  const magicLinkMail = options.magicLinkMail ?? null;
  const decisionRouteOpts = {
    store: authStore,
    events: eventsStore,
    submissions: submissionsStore,
    decisions: decisionsStore,
    forms: formsStore,
    keys: keysStore,
    programInvite: magicLinkMail
      ? {
          issue: async (input: {
            email: string;
            userId: string;
            eventId: string;
            correlationId: string;
          }) => {
            const { issueProgramInviteMagicLink } = await import(
              "./modules/auth/commands.js"
            );
            // Minimal AuthCommandDeps for program invite only.
            return issueProgramInviteMagicLink(
              {
                store: authStore,
                outbox: magicLinkOutbox,
                magicLinkMail,
              },
              input,
            );
          },
        }
      : // Always issue magic_links rows even without mail (test outbox capture).
        {
          issue: async (input: {
            email: string;
            userId: string;
            eventId: string;
            correlationId: string;
          }) => {
            const { issueProgramInviteMagicLink } = await import(
              "./modules/auth/commands.js"
            );
            return issueProgramInviteMagicLink(
              {
                store: authStore,
                outbox: magicLinkOutbox,
                magicLinkMail: null,
              },
              input,
            );
          },
        },
  };

  // Section 3.5 — Submission.List + Session.CreateDirect + bulk preview
  app.route("/api/events", createEventDecisionRoutes(decisionRouteOpts));

  // Section 3.5 — Decision.Record + Submission.Get
  app.route("/api/submissions", createSubmissionDecisionRoutes(decisionRouteOpts));

  // F3 — saved views (grid)
  app.route(
    "/api/events",
    createEventGridRoutes({
      store: authStore,
      savedViews: savedViewsStore,
    }),
  );

  // F5 — global permissioned Find
  app.route(
    "/api/events",
    createEventSearchRoutes({
      store: authStore,
      search: searchStore,
      events: eventsStore,
      submissions: submissionsStore,
      decisions: decisionsStore,
      forms: formsStore,
      eval: evalStore,
      auth: authStore,
    }),
  );

  const programmeDeps = {
    programme: programmeStore,
    events: eventsStore,
    decisions: decisionsStore,
    submissions: submissionsStore,
    schedule: scheduleStore,
    listRooms: (eventId: string) => eventsStore.listRooms(eventId),
    listTracks: (eventId: string) => eventsStore.listTracks(eventId),
  };

  // F7 — programme publish (admin)
  app.route(
    "/api/events",
    createEventProgrammeRoutes({
      store: authStore,
      ...programmeDeps,
    }),
  );

  // P11 — public programme pages
  app.route("/api/public", createPublicProgrammeRoutes(programmeDeps));

  const portalRouteOpts = {
    store: authStore,
    events: eventsStore,
    submissions: submissionsStore,
    decisions: decisionsStore,
    design: designStore,
    schedule: scheduleStore,
    keys: keysStore,
    // Portal.SessionIcs — UID/SEQUENCE continuity with admin comms invites.
    comms: commsStore,
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
    // Section 8.4 — role switcher on for local e2e / unit tests (opt-out available).
    enableRoleSwitcher: options.enableRoleSwitcher ?? true,
    // B07 — judge access for local e2e (harness passes a fixed code).
    judgeAccessCode: options.judgeAccessCode ?? null,
    // Open bootstrap for e2e/unit tests only — never production.
    bootstrapPolicy: options.bootstrapPolicy ?? "open",
    // Section 10.3 — local/e2e accept DEV_PASS without host allowlist (opt-out available).
    demoMode: options.demoMode ?? true,
    demoAllowlistEnabled: options.demoAllowlistEnabled ?? false,
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
 *
 * Turnstile (section 3.3 + 10.3):
 * - Without DEMO_MODE: TURNSTILE_SECRET_KEY and TURNSTILE_SITE_KEY are required
 *   and must not be development/Cloudflare test values — production must not fall
 *   open to TURNSTILE_DEV_PASS_TOKEN or always-pass siteverify modes.
 * - With DEMO_MODE=1 (dogfood): accepts test secret path, forces test site key on
 *   Form.GetPublic, and accepts TURNSTILE_DEV_PASS_TOKEN only for allowlisted
 *   hosts/events (DEMO_ALLOWLIST_*). See docs/DEMO_HOST.md.
 */
export function createAppFromBindings(env: WorkerBindings): Hono<ApiEnv> {
  if (!env.DB) {
    throw new Error(
      "Worker binding DB is required for production SoR (E1). Memory stores are test-only.",
    );
  }

  const demoMode =
    typeof env.DEMO_MODE === "string" && env.DEMO_MODE.trim() === "1";
  const demoAllowlistEnabled =
    typeof env.DEMO_ALLOWLIST_ENABLED === "string" &&
    env.DEMO_ALLOWLIST_ENABLED.trim() === "1";
  // Inline parse (avoid circular import at module top for wrangler bundling)
  const parseList = (raw: string | undefined): string[] => {
    if (!raw || typeof raw !== "string") return [];
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  };
  const demoAllowlistHosts = parseList(env.DEMO_ALLOWLIST_HOSTS);
  const demoAllowlistEventSlugs = parseList(env.DEMO_ALLOWLIST_EVENT_SLUGS);

  let turnstileSecret: string;

  if (demoMode) {
    // DEMO dogfood path: allow missing/test secret (local-style verify) or a real one.
    // DEV_PASS is still gated by demoMode + allowlist in verifyTurnstile.
    const raw =
      typeof env.TURNSTILE_SECRET_KEY === "string"
        ? env.TURNSTILE_SECRET_KEY.trim()
        : "";
    if (!raw || raw === TURNSTILE_TEST_SECRET_FAIL) {
      turnstileSecret = "test";
    } else {
      turnstileSecret = raw;
    }
    // When allowlist is enabled, require at least one host so DEMO cannot fall open.
    if (demoAllowlistEnabled && demoAllowlistHosts.length === 0) {
      throw new Error(
        "Worker binding DEMO_ALLOWLIST_HOSTS is required when DEMO_MODE=1 and " +
          "DEMO_ALLOWLIST_ENABLED=1 (section 10.3). Empty allowlist would reject all " +
          "DEMO tokens; set dogfood hostnames (see docs/DEMO_HOST.md).",
      );
    }
  } else {
    turnstileSecret =
      typeof env.TURNSTILE_SECRET_KEY === "string"
        ? env.TURNSTILE_SECRET_KEY.trim()
        : "";
    if (!turnstileSecret) {
      throw new Error(
        "Worker binding TURNSTILE_SECRET_KEY is required for production CFP bot protection (E10). " +
          "Omitting it would accept the public development pass token and disable effective protection. " +
          "For dogfood DEMO captcha, set DEMO_MODE=1 (docs/DEMO_HOST.md).",
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
          "protection by accepting public development tokens or always-pass siteverify modes. " +
          "For dogfood DEMO captcha, set DEMO_MODE=1 (docs/DEMO_HOST.md).",
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
          "TURNSTILE_DEV_PASS_TOKEN, which a real TURNSTILE_SECRET_KEY rejects and blocks all CFP submissions. " +
          "For dogfood DEMO captcha, set DEMO_MODE=1 (docs/DEMO_HOST.md).",
      );
    }
    if (turnstileSiteKey === TURNSTILE_TEST_SITE_KEY) {
      throw new Error(
        "Worker binding TURNSTILE_SITE_KEY must not be the Cloudflare always-pass test site key (E10). " +
          "That key makes the SPA submit TURNSTILE_DEV_PASS_TOKEN and disables effective CFP bot protection. " +
          "For dogfood DEMO captcha, set DEMO_MODE=1 (docs/DEMO_HOST.md).",
      );
    }
  }

  const d1 = env.DB as D1DatabaseLike;
  // Section 8.4 — ROLE_SWITCHER_ENABLED=1 for private dogfood judges only (default off).
  const roleSwitcherEnabled =
    typeof env.ROLE_SWITCHER_ENABLED === "string" &&
    env.ROLE_SWITCHER_ENABLED.trim() === "1";

  // Durable magic-link email when encryption key is present (dogfood secrets).
  const authLinkKey =
    typeof env.AUTH_LINK_ENCRYPTION_KEY === "string"
      ? env.AUTH_LINK_ENCRYPTION_KEY.trim()
      : "";
  const magicLinkMail: MagicLinkMailDeps | null =
    authLinkKey.length > 0
      ? {
          comms: new D1CommsStore(d1),
          authLinkEncryptionKey: authLinkKey,
          queueKick:
            env.JOBS_QUEUE && typeof env.JOBS_QUEUE.send === "function"
              ? env.JOBS_QUEUE
              : null,
        }
      : null;

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
    savedViewsStore: new D1SavedViewsStore(d1),
    searchStore: new D1SearchStore(d1),
    programmeStore: new D1ProgrammeStore(d1),
    turnstileSecret,
    demoMode,
    demoAllowlistEnabled,
    demoAllowlistHosts,
    demoAllowlistEventSlugs,
    enableDevOutbox: false,
    enableRoleSwitcher: roleSwitcherEnabled,
    // Competition judge entry: active only when both the switcher flag and
    // the JUDGE_ACCESS_CODE secret are set on the dogfood Worker (names only).
    judgeAccessCode:
      typeof env.JUDGE_ACCESS_CODE === "string" &&
      env.JUDGE_ACCESS_CODE.trim().length >= 16
        ? env.JUDGE_ACCESS_CODE.trim()
        : null,
    bootstrapPolicy: "controlled",
    // E10 / 8.3 — production session cookies always Secure + HttpOnly + SameSite=Lax
    cookieSecure: true,
    magicLinkMail,
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
/**
 * Drain `auth.magic_link` outbox — decrypt + send login email (E7).
 * Requires APP_PUBLIC_BASE_URL + AUTH_LINK_ENCRYPTION_KEY.
 */
export async function drainAuthMagicLinkOutboxFromEnv(
  env: WorkerBindings,
  options: { limit?: number } = {},
): Promise<ProcessAuthOutboxResult> {
  if (!env.DB) {
    throw new Error(
      "Worker binding DB is required to drain auth magic-link outbox (E1).",
    );
  }
  const key =
    typeof env.AUTH_LINK_ENCRYPTION_KEY === "string"
      ? env.AUTH_LINK_ENCRYPTION_KEY.trim()
      : "";
  const base =
    typeof env.APP_PUBLIC_BASE_URL === "string"
      ? env.APP_PUBLIC_BASE_URL.trim()
      : "";
  if (!key || !base) {
    return { processed: 0, failed: 0, skipped: 0 };
  }
  const d1 = env.DB as D1DatabaseLike;
  const from =
    (typeof env.AUTH_EMAIL_FROM === "string" && env.AUTH_EMAIL_FROM.trim()) ||
    (typeof env.EMAIL_FROM === "string" && env.EMAIL_FROM.trim()) ||
    "SpeakerOps <noreply@speakerops.org>";
  return processAuthMagicLinkOutbox(
    {
      comms: new D1CommsStore(d1),
      appPublicBaseUrl: base,
      authLinkEncryptionKey: key,
      authEmailProvider:
        typeof env.AUTH_EMAIL_PROVIDER === "string"
          ? env.AUTH_EMAIL_PROVIDER
          : typeof env.EMAIL_PROVIDER === "string"
            ? env.EMAIL_PROVIDER
            : "cloudflare",
      authEmailFrom: from,
      cloudflareAccountId: env.CLOUDFLARE_ACCOUNT_ID,
      cloudflareEmailApiToken: env.CLOUDFLARE_EMAIL_API_TOKEN,
      authResendApiKey: env.RESEND_API_KEY,
      cloudflareEmail: env.EMAIL,
    },
    options,
  );
}

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
 * True when the request must hit the Hono API (not SPA assets).
 * Used with Workers Static Assets + run_worker_first (section 11.9 dogfood).
 */
function isApiOrHealthPath(pathname: string): boolean {
  return (
    pathname === "/health" ||
    pathname === "/health/" ||
    // CLI12 / S-ONB-AGENT: served by Hono, not SPA assets (a fall-through
    // returns index.html to `speakerops openapi` on the deployed Worker).
    pathname === "/openapi.json" ||
    pathname === "/api" ||
    pathname.startsWith("/api/")
  );
}

/**
 * Cloudflare Workers default export.
 * - fetch: Hono HTTP (D1-backed stores) + optional SPA ASSETS fallback
 * - queue: drain comms + airtable outbox after JOBS_QUEUE kicks
 * - scheduled: cron backup drain so rows are never permanently stuck
 */
export default {
  async fetch(
    request: Request,
    env: WorkerBindings,
    ctx?: unknown,
  ): Promise<Response> {
    const url = new URL(request.url);
    // API + health always go through Hono (auth, domain commands, E4).
    if (isApiOrHealthPath(url.pathname)) {
      const key = env as object;
      let app = appByEnv.get(key);
      if (!app) {
        app = createAppFromBindings(env);
        appByEnv.set(key, app);
      }
      return app.fetch(request, env, ctx as never);
    }
    // Dogfood SPA: Workers Assets binding (wrangler [assets]).
    if (env.ASSETS && typeof env.ASSETS.fetch === "function") {
      return env.ASSETS.fetch(request);
    }
    // No assets binding (workers.dev API-only): still serve API app for unknown paths
    // so Hono can return E4 404 envelopes.
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
    // Auth magic-link email (encrypted outbox → Cloudflare Email / Resend)
    await drainAuthMagicLinkOutboxFromEnv(env);
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
    await drainAuthMagicLinkOutboxFromEnv(env);
    await drainAirtableOutboxFromEnv(env, { correlationId });
  },
};
