/**
 * Public CFP HTTP routes (section 3.3 + 10.5 draft).
 *
 * POST /api/public/cfp/:slug/submissions  → Submission.Create
 * POST /api/public/cfp/:slug/files        → public file upload (allowlist)
 * POST /api/public/cfp/:slug/drafts       → Submission.SaveDraft
 * GET  /api/public/cfp/:slug/drafts/:id   → Submission.GetDraft
 *
 * GET  /api/public/cfp/:slug remains Form.GetPublic (forms module, enriched in 3.3).
 *
 * Canonical registry: KMS-competition/initiative/contracts/COMMANDS.md
 */
import { Hono, type Context } from "hono";
import {
  SubmissionCreateBodySchema,
  SubmissionCreateResponseSchema,
  SubmissionSaveDraftBodySchema,
  SubmissionSaveDraftResponseSchema,
  SubmissionGetDraftResponseSchema,
  CfpFileUploadBodySchema,
  CfpFileUploadResponseSchema,
  errorEnvelope,
  VALIDATION_ERROR,
  INTERNAL_ERROR,
  NOT_FOUND,
  CONFLICT,
  RATE_LIMITED,
  type ErrorCode,
} from "@speakerops/shared";
import type { ApiEnv } from "../../env.js";
import type { AuthStore } from "../auth/store.js";
import type { EventsStore } from "../events/store.js";
import type { FormsStore } from "../forms/store.js";
import type { CommsStore } from "../comms/store.js";
import type { DesignStore } from "../design/store.js";
import type { SubmissionsStore } from "./store.js";
import {
  createSubmission,
  uploadCfpFile,
  saveDraft,
  getDraft,
} from "./commands.js";
import {
  defaultCfpRateLimiter,
  rateLimitHeaders,
  clientKeyFromRequest,
  type CfpRateLimiter,
} from "./rateLimit.js";
import type { DemoTurnstileContext } from "./turnstile.js";

export type PublicCfpRouteOptions = {
  store: AuthStore;
  events: EventsStore;
  forms: FormsStore;
  design: DesignStore;
  submissions: SubmissionsStore;
  /** Optional comms store — submission confirmation lifecycle email (Wave 1B). */
  comms?: CommsStore;
  /** Optional rate limiter inject (tests). */
  rateLimiter?: CfpRateLimiter;
  /** TURNSTILE_SECRET_KEY from Worker env (name only in docs). */
  turnstileSecret?: string;
  /** DEMO_MODE + allowlist for Turnstile (section 10.3). */
  demoTurnstile?: DemoTurnstileContext;
  search?: { invalidateIndex?: (eventId: string) => Promise<void> };
  searchQueueKick?: { send: (message: unknown) => Promise<unknown> } | null;
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
        : err.code === RATE_LIMITED || err.code === "RATE_LIMITED"
          ? RATE_LIMITED
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
    comms: options.comms,
    turnstileSecret: options.turnstileSecret,
    demoTurnstile: options.demoTurnstile,
    search: options.search,
    searchQueueKick: options.searchQueueKick,
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
          code: RATE_LIMITED,
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

    // Host for DEMO allowlist (section 10.3) — prefer Host header over URL host.
    const hostHeader = c.req.header("host") ?? undefined;

    // Per-request queue kick binding (production JOBS_QUEUE; absent locally).
    const jobsQueue = (c.env as { JOBS_QUEUE?: { send?: unknown } } | undefined)
      ?.JOBS_QUEUE;
    const commsQueueKick =
      jobsQueue && typeof jobsQueue.send === "function"
        ? (jobsQueue as { send: (message: unknown) => Promise<unknown> })
        : null;

    const result = await createSubmission(
      { ...submitDeps, commsQueueKick },
      {
        ...parsed.data,
        slug,
        correlationId: c.get("correlationId"),
        remoteIp: key.startsWith("corr:") ? undefined : key,
        host: hostHeader,
      },
    );

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
   * POST /cfp/:slug/drafts — Submission.SaveDraft (public, rate limited, no Turnstile).
   * Cache-Control: no-store — draft body may include speaker PII.
   */
  app.post("/cfp/:slug/drafts", async (c) => {
    const slug = c.req.param("slug");
    const key = clientKeyFromRequest(c);
    const rl = limiter.check(`draft:${key}`);
    const headers: Record<string, string> = {
      ...rateLimitHeaders(rl),
      "Cache-Control": "no-store",
    };

    if (!rl.allowed) {
      return commandError(
        c,
        {
          status: 429,
          error: "Rate limit exceeded",
          code: RATE_LIMITED,
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

    const parsed = SubmissionSaveDraftBodySchema.safeParse(raw);
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

    const result = await saveDraft(submitDeps, {
      ...parsed.data,
      slug,
      correlationId: c.get("correlationId"),
    });

    if (!result.ok) {
      return commandError(c, result, headers);
    }

    const out = SubmissionSaveDraftResponseSchema.safeParse(result.value);
    if (!out.success) {
      const res = c.json(
        errorEnvelope("Response validation failed", INTERNAL_ERROR),
        500,
      );
      for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
      return res;
    }

    const status = parsed.data.draftId ? 200 : 201;
    const res = c.json(out.data, status);
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
    return res;
  });

  /**
   * GET /cfp/:slug/drafts/:draftId — Submission.GetDraft (resume snapshot).
   * Cache-Control: no-store — capability-protected proposal + speaker PII.
   */
  app.get("/cfp/:slug/drafts/:draftId", async (c) => {
    const slug = c.req.param("slug");
    const draftId = c.req.param("draftId");
    const noStore = { "Cache-Control": "no-store" };

    const result = await getDraft(submitDeps, {
      slug,
      draftId,
      correlationId: c.get("correlationId"),
    });

    if (!result.ok) {
      return commandError(c, result, noStore);
    }

    const out = SubmissionGetDraftResponseSchema.safeParse(result.value);
    if (!out.success) {
      const res = c.json(
        errorEnvelope("Response validation failed", INTERNAL_ERROR),
        500,
      );
      res.headers.set("Cache-Control", "no-store");
      return res;
    }

    const res = c.json(out.data, 200);
    res.headers.set("Cache-Control", "no-store");
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
          code: RATE_LIMITED,
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
