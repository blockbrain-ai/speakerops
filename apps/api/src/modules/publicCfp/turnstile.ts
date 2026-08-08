/**
 * Cloudflare Turnstile verification (section 3.3 public CFP).
 *
 * Env name only: TURNSTILE_SECRET_KEY (E10 — never commit values).
 * Test keys from Cloudflare docs are constants in @speakerops/shared.
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

/**
 * Verify a Turnstile response token.
 *
 * Local/e2e path (secret unset or Cloudflare always-pass test secret):
 * - empty → fail
 * - TURNSTILE_DEV_FAIL_TOKEN or always-fail site responses → fail
 * - non-empty → pass
 *
 * Production: POST https://challenges.cloudflare.com/turnstile/v0/siteverify
 */
export async function verifyTurnstile(input: {
  token: string;
  secret: string | undefined;
  remoteIp?: string;
  /**
   * Optional fetch override (tests). Defaults to global fetch.
   */
  fetchImpl?: typeof fetch;
}): Promise<TurnstileVerifyResult> {
  const token = input.token.trim();
  if (!token) {
    return {
      ok: false,
      error: "Turnstile token required",
      code: "VALIDATION_ERROR",
    };
  }

  const secret = input.secret?.trim() || undefined;

  // Local / e2e: no secret or always-pass test secret → deterministic path.
  if (
    !secret ||
    secret === "test" ||
    secret === TURNSTILE_TEST_SECRET_PASS
  ) {
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
    // Accept Cloudflare always-pass style tokens and dev dummy.
    if (token === TURNSTILE_DEV_PASS_TOKEN || token.length > 0) {
      return { ok: true };
    }
    return {
      ok: false,
      error: "Turnstile verification failed",
      code: "VALIDATION_ERROR",
    };
  }

  // Explicit always-fail test secret
  if (secret === TURNSTILE_TEST_SECRET_FAIL) {
    return {
      ok: false,
      error: "Turnstile verification failed",
      code: "VALIDATION_ERROR",
    };
  }

  // Production siteverify
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
