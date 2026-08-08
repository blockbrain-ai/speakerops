/**
 * Cloudflare Turnstile verification (section 3.3 public CFP).
 *
 * Env name only: TURNSTILE_SECRET_KEY (E10 — never commit values).
 * Test keys from Cloudflare docs are constants in @speakerops/shared.
 *
 * Local/e2e (createApp / createAppWithAuth): when the secret is absent, only
 * the explicit development pass token is accepted. Arbitrary tokens fail closed.
 *
 * Production (createAppFromBindings): TURNSTILE_SECRET_KEY and TURNSTILE_SITE_KEY
 * are both required at construction and must not be development/Cloudflare test
 * values — a missing or test secret must not deploy with the public
 * TURNSTILE_DEV_PASS_TOKEN accepted, and a missing/test site key must not serve
 * the SPA test UI that submits that token.
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
 * Local/e2e path (secret unset or literal "test"):
 * - empty → fail
 * - TURNSTILE_DEV_FAIL_TOKEN / explicit fail tokens → fail
 * - TURNSTILE_DEV_PASS_TOKEN only → pass
 * - any other non-empty token → fail (fail-closed)
 *
 * Cloudflare always-pass test secret: same deterministic local tokens,
 * then siteverify for real widget tokens.
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

  // Explicit always-fail test secret
  if (secret === TURNSTILE_TEST_SECRET_FAIL) {
    return {
      ok: false,
      error: "Turnstile verification failed",
      code: "VALIDATION_ERROR",
    };
  }

  // Local / e2e: no secret or placeholder "test" → deterministic fail-closed path.
  // Only the explicit development pass token is allowed (docs/SECRETS.md).
  if (!secret || secret === "test") {
    if (token === TURNSTILE_DEV_PASS_TOKEN) {
      return { ok: true };
    }
    return {
      ok: false,
      error: "Turnstile verification failed",
      code: "VALIDATION_ERROR",
    };
  }

  // Cloudflare always-pass test secret: accept explicit dev token without network;
  // otherwise verify via siteverify (always-pass widget tokens work there).
  if (secret === TURNSTILE_TEST_SECRET_PASS) {
    if (token === TURNSTILE_DEV_FAIL_TOKEN || token === "invalid" || token === "fail") {
      return {
        ok: false,
        error: "Turnstile verification failed",
        code: "VALIDATION_ERROR",
      };
    }
    if (token === TURNSTILE_DEV_PASS_TOKEN) {
      return { ok: true };
    }
    // Fall through to siteverify for real widget tokens under the test secret.
  }

  // Production (or test-secret widget tokens): siteverify
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
