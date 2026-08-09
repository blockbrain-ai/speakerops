/**
 * Dogfood session mint for Phase 11.9 D proofs (S-DOGFOOD).
 *
 * Live dogfood does not expose AUTH_DEV_OUTBOX. For automated keystone
 * against https://www.speakerops.org we insert a short-lived auth_sessions
 * row into the dogfood D1 (speakerops-demo) via the Cloudflare API, then
 * set the HttpOnly session cookie with the plaintext token.
 *
 * Requires env **names** (values never committed — E10):
 *   CLOUDFLARE_API_TOKEN
 *   CLOUDFLARE_ACCOUNT_ID
 * Optional:
 *   SPEAKEROPS_D1_DATABASE_ID — defaults to dogfood speakerops-demo id
 *
 * Demo user ids match scripts/seed.ts (section 8.4).
 */
import { createHash, randomBytes } from "node:crypto";
import type { BrowserContext } from "@playwright/test";

/** Binding dogfood origin (constitution S-DOGFOOD). */
export const DOGFOOD_ORIGIN = "https://www.speakerops.org";

/** Seeded demo event (scripts/seed.ts). */
export const DOGFOOD_EVENT_ID = "evt_dogfood";
export const DOGFOOD_EVENT_SLUG = "dogfood-2026";

/** Default dogfood D1 database id for speakerops-demo (resource id, not secret). */
export const DOGFOOD_D1_DEFAULT =
  "f01cd279-e505-4e4e-92b2-56ff2661b74a";

export const DEMO_USERS = {
  admin: {
    id: "user_demo_admin",
    email: "admin@demo.speakerops.local",
  },
  evaluator: {
    id: "user_demo_evaluator",
    email: "evaluator@demo.speakerops.local",
  },
  speaker: {
    id: "user_demo_speaker",
    email: "speaker@demo.speakerops.local",
  },
} as const;

export type DemoRole = keyof typeof DEMO_USERS;

export function dogfoodCredsPresent(): boolean {
  return Boolean(
    process.env.CLOUDFLARE_API_TOKEN?.trim() &&
      process.env.CLOUDFLARE_ACCOUNT_ID?.trim(),
  );
}

function d1DatabaseId(): string {
  return (
    process.env.SPEAKEROPS_D1_DATABASE_ID?.trim() ||
    process.env.DOGFOOD_D1_DATABASE_ID?.trim() ||
    DOGFOOD_D1_DEFAULT
  );
}

function sha256Hex(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

async function d1Query(sql: string, params: unknown[] = []): Promise<void> {
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!token || !accountId) {
    throw new Error(
      "dogfood-session: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID required to mint sessions",
    );
  }
  const dbId = d1DatabaseId();
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
  });
  const body = (await res.json()) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
  };
  if (!res.ok || body.success === false) {
    const msg =
      body.errors?.map((e) => e.message).filter(Boolean).join("; ") ||
      `HTTP ${res.status}`;
    throw new Error(`dogfood-session: D1 query failed: ${msg}`);
  }
}

/**
 * Insert a short-lived auth_sessions row and return the plaintext session token.
 * Token is never logged or written to evidence files.
 */
export async function mintDogfoodSessionToken(
  role: DemoRole = "admin",
  ttlHours = 2,
): Promise<{ session: string; userId: string; email: string }> {
  const user = DEMO_USERS[role];
  const session = randomBytes(32).toString("base64url");
  const tokenHash = sha256Hex(session);
  const now = new Date();
  const expires = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
  const id = newId("sess_dogfood");
  await d1Query(
    `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      id,
      user.id,
      tokenHash,
      expires.toISOString(),
      now.toISOString(),
    ],
  );
  return { session, userId: user.id, email: user.email };
}

/** Seed speakerops_session cookie for Playwright against dogfood origin. */
export async function seedDogfoodSessionCookie(
  context: BrowserContext,
  sessionValue: string,
  origin: string = DOGFOOD_ORIGIN,
): Promise<void> {
  await context.addCookies([
    {
      name: "speakerops_session",
      value: sessionValue,
      url: origin,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
}

/** Mint + cookie for a demo role on dogfood. */
export async function loginDogfoodRole(
  context: BrowserContext,
  role: DemoRole,
  origin: string = DOGFOOD_ORIGIN,
): Promise<{ session: string; userId: string; email: string }> {
  const minted = await mintDogfoodSessionToken(role);
  await seedDogfoodSessionCookie(context, minted.session, origin);
  return minted;
}

export function sessionHeaders(session: string): Record<string, string> {
  return {
    cookie: `speakerops_session=${session}`,
    "content-type": "application/json",
  };
}
