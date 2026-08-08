/**
 * API composition root — Hono on Cloudflare Workers.
 *
 * Section 1.2: GET /health, E4 errors, correlation
 * Section 2.1: Auth magic-link routes (session cookies)
 * Section 2.2: requireRole + Event.List / Schedule.Place role gates
 * Section 2.3: Event.Create/Update + Room/Track upsert + active event data
 * Section 2.4: Design Kit draft/publish + logo presign + public tokens
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
  type HealthResponse,
} from "@speakerops/shared";
import { createDbMarker, SCHEMA_READY, type D1DatabaseLike } from "@speakerops/db";
import {
  correlationMiddleware,
  notFoundHandler,
  onErrorHandler,
} from "./middleware/errors.js";
import type { ApiEnv, WorkerBindings } from "./env.js";
import { createAuthRoutes } from "./modules/auth/routes.js";
import { createEventsRoutes } from "./modules/events/routes.js";
import { createScheduleRoutes } from "./modules/schedule/routes.js";
import {
  createDesignRoutes,
  createPublicDesignRoutes,
  createFileRoutes,
} from "./modules/design/routes.js";
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
  /** Shared test outbox for magic-link capture. */
  magicLinkOutbox?: MagicLinkTestOutbox;
  /** Cookie Secure flag (default true). */
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
  const magicLinkOutbox = options.magicLinkOutbox ?? new MagicLinkTestOutbox();
  // Dev outbox is opt-in only (e2e / tests). Production default export sets false.
  const enableDevOutbox = options.enableDevOutbox === true;
  // Production: controlled. createAppWithAuth overrides to open for e2e.
  const bootstrapPolicy = options.bootstrapPolicy ?? "controlled";

  app.use("*", correlationMiddleware);

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
      cookieSecure: options.cookieSecure,
      enableDevOutbox,
      bootstrapPolicy,
    }),
  );

  // Section 2.3 — Event.Create/Update/List + rooms/tracks (admin role gate)
  app.route(
    "/api/events",
    createEventsRoutes({ store: authStore, events: eventsStore }),
  );

  // Section 2.4 — Design.Get/SetDraft/Publish under /api/events/:eventId/design
  app.route(
    "/api/events",
    createDesignRoutes({
      store: authStore,
      events: eventsStore,
      design: designStore,
    }),
  );

  // Section 2.2 — Schedule.Place under /api/events/:eventId/... (admin role gate)
  // Mounted at /api/events so path is /:eventId/schedule/place
  app.route("/api/events", createScheduleRoutes({ store: authStore }));

  // Section 2.4 — public published design tokens (never draft)
  app.route(
    "/api/public",
    createPublicDesignRoutes({
      store: authStore,
      events: eventsStore,
      design: designStore,
    }),
  );

  // Section 2.4 — File.PresignUpload + upload body (logo PNG only)
  app.route(
    "/api/files",
    createFileRoutes({
      store: authStore,
      events: eventsStore,
      design: designStore,
    }),
  );

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
  outbox: MagicLinkTestOutbox;
} {
  const store = options.authStore ?? new MemoryAuthStore();
  const events = options.eventsStore ?? new MemoryEventsStore();
  const design = options.designStore ?? new MemoryDesignStore();
  const outbox = options.magicLinkOutbox ?? new MagicLinkTestOutbox();
  const app = createApp({
    ...options,
    authStore: store,
    eventsStore: events,
    designStore: design,
    magicLinkOutbox: outbox,
    enableDevOutbox: options.enableDevOutbox ?? true,
    // Open bootstrap for e2e/unit tests only — never production.
    bootstrapPolicy: options.bootstrapPolicy ?? "open",
  });
  return { app, store, events, design, outbox };
}

/**
 * Build production app from Worker bindings (D1 SoR).
 * Throws if DB binding is missing — Memory stores are never used in production.
 */
export function createAppFromBindings(env: WorkerBindings): Hono<ApiEnv> {
  if (!env.DB) {
    throw new Error(
      "Worker binding DB is required for production SoR (E1). Memory stores are test-only.",
    );
  }
  const d1 = env.DB as D1DatabaseLike;
  return createApp({
    authStore: new D1AuthStore(d1),
    eventsStore: new D1EventsStore(d1),
    designStore: new D1DesignStore(d1, env.FILES),
    enableDevOutbox: false,
    bootstrapPolicy: "controlled",
  });
}

/** Cache one Hono app per env object (isolates reuse bindings). */
const appByEnv = new WeakMap<object, Hono<ApiEnv>>();

/**
 * Cloudflare Workers default export.
 * Constructs D1-backed stores from env.DB on first request for this env.
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
};
