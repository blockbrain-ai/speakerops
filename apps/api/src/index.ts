/**
 * API composition root — Hono on Cloudflare Workers.
 *
 * Section 1.2: GET /health, E4 errors, correlation
 * Section 2.1: Auth magic-link routes (session cookies)
 *
 * Domain routes from COMMANDS.md register here.
 *
 * CORS: same-origin policy by default — no open Access-Control-Allow-Origin.
 * SPA and Worker share the dogfood origin (or Vite proxy in local dev);
 * cross-origin headers are not added until an explicit public surface needs them.
 */
import { Hono } from "hono";
import {
  HealthResponseSchema,
  type HealthResponse,
} from "@speakerops/shared";
import { createDbMarker, SCHEMA_READY } from "@speakerops/db";
import {
  correlationMiddleware,
  notFoundHandler,
  onErrorHandler,
} from "./middleware/errors.js";
import type { ApiEnv } from "./env.js";
import { createAuthRoutes } from "./modules/auth/routes.js";
import {
  MemoryAuthStore,
  MagicLinkTestOutbox,
  type AuthStore,
} from "./modules/auth/store.js";

export type { ApiEnv, WorkerBindings } from "./env.js";

/** Default public app version when CF var APP_VERSION is unset (local tests). */
export const DEFAULT_APP_VERSION = "0.1.0";

export type CreateAppOptions = {
  /** Inject auth store (defaults to in-memory for local/test). */
  authStore?: AuthStore;
  /** Shared test outbox for magic-link capture. */
  magicLinkOutbox?: MagicLinkTestOutbox;
  /** Cookie Secure flag (default true). */
  cookieSecure?: boolean;
  /**
   * Register GET /api/auth/dev/outbox.
   * Default: true when options.magicLinkOutbox is provided or AUTH_DEV_OUTBOX=1.
   */
  enableDevOutbox?: boolean;
};

/**
 * Create the Hono app.
 * Used by the Worker default export and by unit tests via `app.request()`.
 */
export function createApp(options: CreateAppOptions = {}): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  // DB package wired at composition root (1.3 schema ready; domain repos later).
  void createDbMarker();
  void SCHEMA_READY;

  const authStore = options.authStore ?? new MemoryAuthStore();
  const magicLinkOutbox = options.magicLinkOutbox ?? new MagicLinkTestOutbox();
  // Dev outbox is opt-in only (e2e / tests). Production default export sets false.
  const enableDevOutbox = options.enableDevOutbox === true;

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
    }),
  );

  app.notFound(notFoundHandler);
  app.onError(onErrorHandler);

  return app;
}

/**
 * Create app with always-on dev outbox (local e2e / vitest).
 * Production Worker default export does not enable this.
 */
export function createAppWithAuth(
  options: CreateAppOptions = {},
): {
  app: Hono<ApiEnv>;
  store: AuthStore;
  outbox: MagicLinkTestOutbox;
} {
  const store = options.authStore ?? new MemoryAuthStore();
  const outbox = options.magicLinkOutbox ?? new MagicLinkTestOutbox();
  const app = createApp({
    ...options,
    authStore: store,
    magicLinkOutbox: outbox,
    enableDevOutbox: options.enableDevOutbox ?? true,
  });
  return { app, store, outbox };
}

/** Default export for Cloudflare Workers (wrangler main). */
const app = createApp({
  // Production: no dev outbox. AUTH_DEV_OUTBOX is never read here by default.
  enableDevOutbox: false,
});
export default app;
