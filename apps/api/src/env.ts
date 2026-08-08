/**
 * Shared Worker env types (composition root + modules).
 * Kept separate so modules can import without circular deps on index.ts.
 */

import type { D1DatabaseLike } from "@speakerops/db";

/** Minimal R2 surface for logo object storage (binding name: FILES). */
export type R2BucketLike = {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | Blob,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{
    arrayBuffer(): Promise<ArrayBuffer>;
    httpMetadata?: { contentType?: string };
  } | null>;
};

/**
 * Worker bindings (names only — values from wrangler / CF dashboard).
 * Placeholders match wrangler.toml; real resources land in deploy sections.
 */
export type WorkerBindings = {
  /** D1 database binding name: DB (required for production SoR) */
  DB?: D1DatabaseLike;
  /** R2 bucket binding name: FILES (logo bytes) */
  FILES?: R2BucketLike;
  /** Queue producer binding name: JOBS_QUEUE */
  JOBS_QUEUE?: unknown;
  /** Non-secret public version string (wrangler [vars]) */
  APP_VERSION?: string;
  /**
   * When "1", e2e may enable dev outbox route (env name only — E10).
   * Never enable in production dogfood without explicit ops decision.
   */
  AUTH_DEV_OUTBOX?: string;
  /**
   * Optional first-admin allowlist (email). Env **name** only in repo (E10).
   * When set under controlled bootstrap, only this email may self-bootstrap admin.
   */
  BOOTSTRAP_ADMIN_EMAIL?: string;
  /**
   * Cloudflare Turnstile secret for public CFP (section 3.3).
   * Env **name** only — never commit values (E10). Unset → local test-token path.
   */
  TURNSTILE_SECRET_KEY?: string;
  /**
   * Public Turnstile site key for SPA widget. Env **name** only.
   * Defaults to Cloudflare always-pass test site key when unset.
   */
  TURNSTILE_SITE_KEY?: string;
};

import type { MembershipRow } from "./modules/auth/store.js";

export type ApiEnv = {
  Bindings: WorkerBindings;
  Variables: {
    correlationId: string;
    /** Set by requireSession / requireRole (section 2.2). */
    user?: { id: string; email: string };
    sessionId?: string;
    membership?: MembershipRow;
  };
};
