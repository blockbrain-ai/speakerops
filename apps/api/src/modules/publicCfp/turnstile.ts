/**
 * Cloudflare Turnstile verification (section 3.3 public CFP + 10.3 DEMO path).
 *
 * Env names only (E10 — never commit values):
 * - TURNSTILE_SECRET_KEY
 * - DEMO_MODE — when "1", accept TURNSTILE_DEV_PASS_TOKEN under allowlist rules
 * - DEMO_ALLOWLIST_ENABLED / DEMO_ALLOWLIST_HOSTS / DEMO_ALLOWLIST_EVENT_SLUGS
 *
 * Local/e2e (createAppWithAuth): demoMode true, allowlist off → DEV_PASS only.
 * Production (createAppFromBindings without DEMO_MODE): demoMode false → DEV_PASS
 * always rejected (AC-10.3-C).
 * Dogfood DEMO_MODE=1 + allowlist: DEV_PASS only on allowlisted host/event
 * (AC-10.3-A / AC-10.3-D).
 */
import {
  TURNSTILE_DEV_FAIL_TOKEN,
  TURNSTILE_DEV_PASS_TOKEN,
  TURNSTILE_TEST_SECRET_FAIL,
  TURNSTILE_TEST_SECRET_PASS,
} from "@speakerops/shared";

export type TurnstileVerifyResult =
  | { ok: true }
  | { ok: false; error: string; code: string };

export type DemoTurnstileContext = {
  /**
   * Explicit DEMO_MODE path. When false/undefined, TURNSTILE_DEV_PASS_TOKEN
   * is never accepted (AC-10.3-C).
   */
  demoMode?: boolean;
  /**
   * Request Host (may include port). Normalized before allowlist match.
   */
  host?: string;
  /**
   * Public CFP event slug (optional event-scoped allowlist).
   */
  eventSlug?: string;
  /**
   * When true, host (and optional event slug) must match allowlists.
   * When false/undefined with demoMode, DEV_PASS is accepted without host check
   * (local/e2e).
   */
  demoAllowlistEnabled?: boolean;
  /** Allowlisted hostnames (case-insensitive; port stripped). */
  demoAllowlistHosts?: string[];
  /** Optional allowlisted event slugs (case-insensitive). Empty = any event. */
  demoAllowlistEventSlugs?: string[];
};

/**
 * Normalize Host header / hostname for allowlist comparison.
 * Strips port; lowercases; ignores empty.
 */
export function normalizeDemoHost(host: string | undefined | null): string {
  if (!host) return "";
  const raw = host.trim().toLowerCase();
  if (!raw) return "";
  // IPv6 [::1]:port or host:port
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    if (end !== -1) return raw.slice(0, end + 1);
  }
  const colon = raw.lastIndexOf(":");
  if (colon > 0 && raw.includes(".") === false && /^\d+$/.test(raw.slice(colon + 1))) {
    // bare hostname without dots but with port (e.g. localhost:8787)
    return raw.slice(0, colon);
  }
  if (colon > 0 && /^\d+$/.test(raw.slice(colon + 1))) {
    return raw.slice(0, colon);
  }
  return raw;
}

/**
 * Whether TURNSTILE_DEV_PASS_TOKEN may be accepted under DEMO rules.
 * Fail-closed: requires demoMode; when allowlist enabled, host (and optional
 * event) must match.
 */
export function isDemoPassTokenAllowed(ctx: DemoTurnstileContext): boolean {
  if (ctx.demoMode !== true) return false;

  if (ctx.demoAllowlistEnabled === true) {
    const host = normalizeDemoHost(ctx.host);
    const hosts = (ctx.demoAllowlistHosts ?? [])
      .map((h) => normalizeDemoHost(h))
      .filter((h) => h.length > 0);
    if (!host || hosts.length === 0 || !hosts.includes(host)) {
      return false;
    }

    const eventAllow = (ctx.demoAllowlistEventSlugs ?? [])
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0);
    if (eventAllow.length > 0) {
      const slug = (ctx.eventSlug ?? "").trim().toLowerCase();
      if (!slug || !eventAllow.includes(slug)) {
        return false;
      }
    }
  }

  return true;
}

/** Parse comma-separated allowlist env values (names only). */
export function parseDemoAllowlist(raw: string | undefined | null): string[] {
  if (!raw || typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Verify a Turnstile response token.
 *
 * DEMO path (demoMode true + allowlist rules):
 * - TURNSTILE_DEV_PASS_TOKEN → pass when isDemoPassTokenAllowed
 *
 * Local/e2e path (secret unset or literal "test", non-DEV_PASS tokens):
 * - empty → fail
 * - DEV_FAIL / explicit fail tokens → fail
 * - any other non-empty token → fail (fail-closed)
 *
 * Cloudflare always-pass test secret: siteverify for real widget tokens.
 *
 * Production: POST https://challenges.cloudflare.com/turnstile/v0/siteverify
 * DEV_PASS is never accepted when demoMode is false (AC-10.3-C).
 */
export async function verifyTurnstile(input: {
  token: string;
  secret: string | undefined;
  remoteIp?: string;
  /**
   * Optional fetch override (tests). Defaults to global fetch.
   */
  fetchImpl?: typeof fetch;
} & DemoTurnstileContext): Promise<TurnstileVerifyResult> {
  const token = input.token.trim();
  if (!token) {
    return {
      ok: false,
      error: "Turnstile token required",
      code: "VALIDATION_ERROR",
    };
  }

  const secret = input.secret?.trim() || undefined;

  // Explicit always-fail test secret
  if (secret === TURNSTILE_TEST_SECRET_FAIL) {
    return {
      ok: false,
      error: "Turnstile verification failed",
      code: "VALIDATION_ERROR",
    };
  }

  // DEMO / local e2e pass token — gated by demoMode + optional host/event allowlist.
  // Never accepted when demoMode is false (AC-10.3-C) or host not allowlisted (AC-10.3-D).
  if (token === TURNSTILE_DEV_PASS_TOKEN) {
    if (isDemoPassTokenAllowed(input)) {
      return { ok: true };
    }
    return {
      ok: false,
      error: "Turnstile verification failed",
      code: "VALIDATION_ERROR",
    };
  }

  // Explicit fail tokens (local + always-pass secret path)
  if (
    token === TURNSTILE_DEV_FAIL_TOKEN ||
    token === "invalid" ||
    token === "fail"
  ) {
    return {
      ok: false,
      error: "Turnstile verification failed",
      code: "VALIDATION_ERROR",
    };
  }

  // Local / e2e: no secret or placeholder "test" → fail-closed for non-demo tokens.
  if (!secret || secret === "test") {
    return {
      ok: false,
      error: "Turnstile verification failed",
      code: "VALIDATION_ERROR",
    };
  }

  // Always-pass test secret falls through to siteverify for real widget tokens.
  // Production real secret: siteverify.
  void TURNSTILE_TEST_SECRET_PASS; // documented mode; same network path below

  const fetchFn = input.fetchImpl ?? fetch;
  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  if (input.remoteIp) body.set("remoteip", input.remoteIp);

  try {
    const res = await fetchFn(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      },
    );
    if (!res.ok) {
      return {
        ok: false,
        error: "Turnstile verification failed",
        code: "VALIDATION_ERROR",
      };
    }
    const data = (await res.json()) as { success?: boolean };
    if (data.success === true) return { ok: true };
    return {
      ok: false,
      error: "Turnstile verification failed",
      code: "VALIDATION_ERROR",
    };
  } catch {
    return {
      ok: false,
      error: "Turnstile verification failed",
      code: "VALIDATION_ERROR",
    };
  }
}
