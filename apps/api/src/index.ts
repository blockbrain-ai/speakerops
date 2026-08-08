/**
 * API composition root — Hono on Cloudflare Workers (section 1.1 scaffold).
 *
 * Domain routes from COMMANDS.md register here in later sections.
 * GET /health lands in section 1.2. No invented endpoints in 1.1.
 */
import { Hono } from "hono";
import {
  errorEnvelope,
  INTERNAL_ERROR,
  type ErrorEnvelope,
} from "@speakerops/shared";
import { createDbPlaceholder } from "@speakerops/db";

export type ApiEnv = {
  Variables: {
    correlationId: string;
  };
};

/**
 * Create the Hono app. Middleware for correlationId, Zod validation, and E4
 * error envelopes is extended in 1.2+ as routes are added.
 */
export function createApp(): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  // Ensure db package is wired at composition root (placeholder until 1.3).
  void createDbPlaceholder();

  app.onError((err, c) => {
    // E4: never leak stack traces to the client
    const body: ErrorEnvelope = errorEnvelope(
      "Unexpected error",
      INTERNAL_ERROR,
    );
    void err;
    return c.json(body, 500);
  });

  return app;
}

/** Default export for Worker entry (wrangler binds in 1.2). */
const app = createApp();
export default app;
