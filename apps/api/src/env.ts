/**
 * Shared Worker env types (composition root + modules).
 * Kept separate so modules can import without circular deps on index.ts.
 */

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
  /**
   * When "1", e2e may enable dev outbox route (env name only — E10).
   * Never enable in production dogfood without explicit ops decision.
   */
  AUTH_DEV_OUTBOX?: string;
};

export type ApiEnv = {
  Bindings: WorkerBindings;
  Variables: {
    correlationId: string;
  };
};
