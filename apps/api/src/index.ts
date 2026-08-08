/**
 * API composition root — Hono on Cloudflare Workers (section 1.2).
 *
 * In scope for 1.2:
 * - GET /health → { ok: true, version }
 * - Unknown route → 404 E4 envelope
 * - Error envelope middleware
 * - wrangler bindings (DB / R2 / Queues names) — see root wrangler.toml
 *
 * Domain routes from COMMANDS.md register here in later sections.
 * Auth / product commands are out of scope for 1.2.
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
import { createDbPlaceholder } from "@speakerops/db";
import {
  correlationMiddleware,
  notFoundHandler,
  onErrorHandler,
} from "./middleware/errors.js";

/** Default public app version when CF var APP_VERSION is unset (local tests). */
export const DEFAULT_APP_VERSION = "0.1.0";

/**
 * Worker bindings (names only — values from wrangler / CF dashboard).
 * Placeholders match wrangler.toml; real resources land in deploy sections.
 */
export type WorkerBindings = {
  /** D1 database binding name: DB */
  DB?: unknown;
  /** R2 bucket binding name: FILES */
  FILES?: unknown;
  /** Queue producer binding name: JOBS_QUEUE */
  JOBS_QUEUE?: unknown;
  /** Non-secret public version string (wrangler [vars]) */
  APP_VERSION?: string;
};

export type ApiEnv = {
  Bindings: WorkerBindings;
  Variables: {
    correlationId: string;
  };
};

/**
 * Create the Hono app.
 * Used by the Worker default export and by unit tests via `app.request()`.
 */
export function createApp(): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  // Ensure db package is wired at composition root (schema lands in 1.3).
  void createDbPlaceholder();

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

  app.notFound(notFoundHandler);
  app.onError(onErrorHandler);

  return app;
}

/** Default export for Cloudflare Workers (wrangler main). */
const app = createApp();
export default app;
