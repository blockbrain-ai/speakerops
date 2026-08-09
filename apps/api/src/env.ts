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

/** Minimal queue producer surface (binding name: JOBS_QUEUE). */
export type QueueProducerLike = {
  send(message: unknown): Promise<void>;
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
  /** Queue producer binding name: JOBS_QUEUE (kick after Comms.Send) */
  JOBS_QUEUE?: QueueProducerLike;
  /** Non-secret public version string (wrangler [vars]) */
  APP_VERSION?: string;
  /**
   * When "1", e2e may enable dev outbox route (env name only — E10).
   * Never enable in production dogfood without explicit ops decision.
   */
  AUTH_DEV_OUTBOX?: string;
  /**
   * When "1", register Auth.DevRoleSwitch for dogfood judges (section 8.4).
   * Env **name** only (E10). Default off — never enable on public production.
   * Pair with SPA `VITE_ROLE_SWITCHER=1` and `pnpm seed` demo accounts.
   */
  ROLE_SWITCHER_ENABLED?: string;
  /**
   * Optional first-admin allowlist (email). Env **name** only in repo (E10).
   * When set under controlled bootstrap, only this email may self-bootstrap admin.
   */
  BOOTSTRAP_ADMIN_EMAIL?: string;
  /**
   * Cloudflare Turnstile secret for public CFP (section 3.3).
   * Env **name** only — never commit values (E10).
   * Production (`createAppFromBindings`): required; rejects empty and known
   * development/Cloudflare test secrets (`test`, always-pass, always-fail).
   * Local/e2e may omit → local test-token path only.
   */
  TURNSTILE_SECRET_KEY?: string;
  /**
   * Public Turnstile site key for SPA widget. Env **name** only.
   * Production (`createAppFromBindings`): required with TURNSTILE_SECRET_KEY;
   * rejects empty and the Cloudflare always-pass test site key.
   * Local/e2e may omit — public CFP falls back to Cloudflare always-pass test key.
   * When DEMO_MODE=1, public CFP forces the always-pass test site key (section 10.3).
   */
  TURNSTILE_SITE_KEY?: string;
  /**
   * When "1", enable DEMO Turnstile path for public CFP (section 10.3 / S-CFP-SUBMIT).
   * Env **name** only (E10). Accepts TURNSTILE_DEV_PASS_TOKEN only when allowlist
   * rules pass (see DEMO_ALLOWLIST_*). Forces test site key on Form.GetPublic.
   * Default off — never enable on public production without an explicit allowlist.
   * Dogfood deploy documents this in docs/DEMO_HOST.md + OPERATIONS.md.
   */
  DEMO_MODE?: string;
  /**
   * When "1" with DEMO_MODE=1, DEV_PASS is accepted only for hosts listed in
   * DEMO_ALLOWLIST_HOSTS (and optional DEMO_ALLOWLIST_EVENT_SLUGS). Env name only.
   */
  DEMO_ALLOWLIST_ENABLED?: string;
  /**
   * Comma-separated hostnames allowed for DEMO Turnstile pass token
   * (e.g. "www.speakerops.org,localhost"). Env name only — not a secret.
   */
  DEMO_ALLOWLIST_HOSTS?: string;
  /**
   * Optional comma-separated event slugs allowed for DEMO pass token.
   * Empty/unset = any event on an allowlisted host. Env name only.
   */
  DEMO_ALLOWLIST_EVENT_SLUGS?: string;
  /**
   * Email provider mode (section 5.2). Env **name** only (E10).
   * Default: sandbox (no live HTTP). Set to "resend" only with RESEND_API_KEY.
   */
  EMAIL_PROVIDER?: string;
  /**
   * Resend API key for live email. Env **name** only — never commit values (E10).
   * Ignored unless EMAIL_PROVIDER=resend. Sandbox remains default without it.
   */
  RESEND_API_KEY?: string;
  /**
   * Default From: address for provider sends. Env **name** only.
   */
  EMAIL_FROM?: string;
  /**
   * Airtable personal access token / API key (section 7.3 / S-AIRTABLE).
   * Env **name** only — never commit values (E10).
   * When unset, projection drain pauses; product mutations still succeed (outbox lags).
   */
  AIRTABLE_API_KEY?: string;
  /**
   * Airtable base id for one-way projection. Env **name** only.
   * Required together with AIRTABLE_API_KEY for live drain; unset → paused.
   */
  AIRTABLE_BASE_ID?: string;
  /** Optional table name overrides (defaults: SpeakerOps_*). Env names only. */
  AIRTABLE_TABLE_SUBMISSIONS?: string;
  AIRTABLE_TABLE_SPEAKERS?: string;
  AIRTABLE_TABLE_SESSIONS?: string;
  AIRTABLE_TABLE_TASKS?: string;
  AIRTABLE_TABLE_SCHEDULE?: string;
  AIRTABLE_TABLE_EVENTS?: string;
};

import type { MembershipRow } from "./modules/auth/store.js";
import type { ApiScope } from "@speakerops/shared";

/** API key principal attached after successful Bearer auth (section 7.1). */
export type AuthzApiKey = {
  id: string;
  scopes: ApiScope[];
  eventId: string | null;
  orgId: string;
  createdBy: string;
};

export type ApiEnv = {
  Bindings: WorkerBindings;
  Variables: {
    correlationId: string;
    /** Set by requireSession / requireRole (section 2.2). */
    user?: { id: string; email: string };
    sessionId?: string;
    membership?: MembershipRow;
    /** Set by Bearer API key auth (section 7.1). */
    apiKey?: AuthzApiKey;
  };
};
