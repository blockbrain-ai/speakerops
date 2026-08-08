/**
 * In-memory rate limiter for public CFP Submission.Create (section 3.3).
 * Headers: X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After on 429.
 */
import {
  CFP_RATE_LIMIT_MAX,
  CFP_RATE_LIMIT_WINDOW_MS,
} from "@speakerops/shared";

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until window reset (for Retry-After). */
  retryAfterSec: number;
};

type Bucket = {
  count: number;
  windowStartMs: number;
};

/**
 * Fixed-window counter keyed by client id (IP or correlation fallback).
 * Process-local only — fine for dogfood single-isolate; multi-isolate later.
 */
export class CfpRateLimiter {
  private buckets = new Map<string, Bucket>();
  readonly max: number;
  readonly windowMs: number;

  constructor(
    max: number = CFP_RATE_LIMIT_MAX,
    windowMs: number = CFP_RATE_LIMIT_WINDOW_MS,
  ) {
    this.max = max;
    this.windowMs = windowMs;
  }

  check(key: string, nowMs: number = Date.now()): RateLimitResult {
    const existing = this.buckets.get(key);
    if (!existing || nowMs - existing.windowStartMs >= this.windowMs) {
      this.buckets.set(key, { count: 1, windowStartMs: nowMs });
      return {
        allowed: true,
        limit: this.max,
        remaining: Math.max(0, this.max - 1),
        retryAfterSec: Math.ceil(this.windowMs / 1000),
      };
    }
    existing.count += 1;
    const elapsed = nowMs - existing.windowStartMs;
    const retryAfterSec = Math.max(
      1,
      Math.ceil((this.windowMs - elapsed) / 1000),
    );
    if (existing.count > this.max) {
      return {
        allowed: false,
        limit: this.max,
        remaining: 0,
        retryAfterSec,
      };
    }
    return {
      allowed: true,
      limit: this.max,
      remaining: Math.max(0, this.max - existing.count),
      retryAfterSec,
    };
  }

  /** Test helper — reset all buckets. */
  reset(): void {
    this.buckets.clear();
  }
}

/** Shared process limiter for public CFP posts. */
export const defaultCfpRateLimiter = new CfpRateLimiter();

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
  };
  if (!result.allowed) {
    headers["Retry-After"] = String(result.retryAfterSec);
  }
  return headers;
}

/** Best-effort client key from request headers (no trust for authz). */
export function clientKeyFromRequest(c: {
  req: { header: (name: string) => string | undefined };
  get: (key: "correlationId") => string;
}): string {
  const forwarded = c.req.header("cf-connecting-ip")
    ?? c.req.header("x-forwarded-for")
    ?? c.req.header("x-real-ip");
  if (forwarded) {
    return forwarded.split(",")[0]!.trim() || "unknown";
  }
  return `corr:${c.get("correlationId")}`;
}
