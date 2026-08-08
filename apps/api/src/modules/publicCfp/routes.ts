/**
 * Public CFP HTTP routes (section 3.3).
 *
 * POST /api/public/cfp/:slug/submissions  → Submission.Create
 * POST /api/public/cfp/:slug/files        → public file upload (allowlist)
 *
 * GET  /api/public/cfp/:slug remains Form.GetPublic (forms module, enriched in 3.3).
 *
 * Canonical registry: KMS-competition/initiative/contracts/COMMANDS.md
 */
import { Hono, type Context } from "hono";
import {
  SubmissionCreateBodySchema,
  SubmissionCreateResponseSchema,
  CfpFileUploadBodySchema,
  CfpFileUploadResponseSchema,
  errorEnvelope,
  VALIDATION_ERROR,
  INTERNAL_ERROR,
  NOT_FOUND,
  CONFLICT,
  type ErrorCode,
} from "@speakerops/shared";
import type { ApiEnv } from "../../env.js";
import type { AuthStore } from "../auth/store.js";
import type { EventsStore } from "../events/store.js";
import type { FormsStore } from "../forms/store.js";
import type { DesignStore } from "../design/store.js";
import type { SubmissionsStore } from "./store.js";
import { createSubmission, uploadCfpFile } from "./commands.js";
import {
  defaultCfpRateLimiter,
  rateLimitHeaders,
  clientKeyFromRequest,
  type CfpRateLimiter,
} from "./rateLimit.js";

export type PublicCfpRouteOptions = {
  store: AuthStore;
  events: EventsStore;
  forms: FormsStore;
  design: DesignStore;
  submissions: SubmissionsStore;
  /** Optional rate limiter inject (tests). */
  rateLimiter?: CfpRateLimiter;
  /** TURNSTILE_SECRET_KEY from Worker env (name only in docs). */
  turnstileSecret?: string;
};

function commandError(
  c: Context<ApiEnv>,
  err: {
    status: 400 | 404 | 409 | 429;
    error: string;
    code: string;
    details?: unknown;
  },
  extraHeaders?: Record<string, string>,
) {
  const code: ErrorCode =
    err.code === "CONFLICT"
      ? CONFLICT
      : err.code === "NOT_FOUND"
        ? NOT_FOUND
        : err.code === "RATE_LIMITED"
          ? "RATE_LIMITED"
          : (err.code as ErrorCode);
  const res = c.json(errorEnvelope(err.error, code, err.details), err.status);
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      res.headers.set(k, v);
    }
  }
  return res;
}

/**
 * Public CFP routes mounted at /api/public
 */
export function createPublicCfpRoutes(
  options: PublicCfpRouteOptions,
): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const limiter = options.rateLimiter ?? defaultCfpRateLimiter;

  const submitDeps = {
    submissions: options.submissions,
    forms: options.forms,
    events: options.events,
    auth: options.store,
    design: options.design,
    turnstileSecret: options.turnstileSecret,
  };

  /**
   * POST /cfp/:slug/submissions — Submission.Create (public, rate limited).
   */
  app.post("/cfp/:slug/submissions", async (c) => {
    const slug = c.req.param("slug");
    const key = clientKeyFromRequest(c);
    const rl = limiter.check(key);
    const headers = rateLimitHeaders(rl);

    if (!rl.allowed) {
      return commandError(
        c,
        {
          status: 429,
          error: "Rate limit exceeded",
          code: "RATE_LIMITED",
          details: {
            limit: rl.limit,
            retryAfterSec: rl.retryAfterSec,
          },
        },
        headers,
      );
    }

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      const res = c.json(
        errorEnvelope("Invalid JSON body", VALIDATION_ERROR),
        400,
      );
      for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
      return res;
    }

    const parsed = SubmissionCreateBodySchema.safeParse(raw);
    if (!parsed.success) {
      const res = c.json(
        errorEnvelope("Validation failed", VALIDATION_ERROR, {
          issues: parsed.error.flatten(),
        }),
        400,
      );
      for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
      return res;
    }

    const result = await createSubmission(submitDeps, {
      ...parsed.data,
      slug,
      correlationId: c.get("correlationId"),
      remoteIp: key.startsWith("corr:") ? undefined : key,
    });

    if (!result.ok) {
      return commandError(c, result, headers);
    }

    const out = SubmissionCreateResponseSchema.safeParse(result.value);
    if (!out.success) {
      const res = c.json(
        errorEnvelope("Response validation failed", INTERNAL_ERROR),
        500,
      );
      for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
      return res;
    }

    const res = c.json(out.data, 201);
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
    return res;
  });

  /**
   * POST /cfp/:slug/files — public supporting file upload (mime/size allowlist).
   */
  app.post("/cfp/:slug/files", async (c) => {
    const slug = c.req.param("slug");
    const key = clientKeyFromRequest(c);
    const rl = limiter.check(`file:${key}`);
    const headers = rateLimitHeaders(rl);

    if (!rl.allowed) {
      return commandError(
        c,
        {
          status: 429,
          error: "Rate limit exceeded",
          code: "RATE_LIMITED",
          details: {
            limit: rl.limit,
            retryAfterSec: rl.retryAfterSec,
          },
        },
        headers,
      );
    }

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      const res = c.json(
        errorEnvelope("Invalid JSON body", VALIDATION_ERROR),
        400,
      );
      for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
      return res;
    }

    const parsed = CfpFileUploadBodySchema.safeParse(raw);
    if (!parsed.success) {
      const res = c.json(
        errorEnvelope("Validation failed", VALIDATION_ERROR, {
          issues: parsed.error.flatten(),
        }),
        400,
      );
      for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
      return res;
    }

    const result = await uploadCfpFile(submitDeps, {
      ...parsed.data,
      slug,
      correlationId: c.get("correlationId"),
    });

    if (!result.ok) {
      return commandError(c, result, headers);
    }

    const out = CfpFileUploadResponseSchema.safeParse(result.value);
    if (!out.success) {
      const res = c.json(
        errorEnvelope("Response validation failed", INTERNAL_ERROR),
        500,
      );
      for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
      return res;
    }

    const res = c.json(out.data, 201);
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
    return res;
  });

  return app;
}
