/**
 * Session cookie helpers (section 2.1 + 8.3 production flags + 10.4 dogfood).
 *
 * Flags (E10, never weaken for demo / www.speakerops.org):
 * - HttpOnly — not readable by SPA JS
 * - Secure — required on HTTPS dogfood (and set true in production bindings)
 * - SameSite=Lax — same-site navigations + top-level GET; no cross-site CSRF via POST
 * - Path=/ — available to SPA + /api on the same host
 * - Max-Age = SESSION_TTL_DAYS (bounded; not Session-only)
 * - **No Domain attribute** — host-only cookie for the request host
 *   (www.speakerops.org or workers.dev). Avoids accidental sharing to sibling hosts.
 */
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_DAYS,
} from "@speakerops/shared";

export type SessionCookieOptions = {
  /** Default true — required in production (E10). Tests may still assert flag present. */
  secure?: boolean;
  maxAgeSeconds?: number;
  name?: string;
};

/** Default Max-Age seconds for product session cookies (14d → seconds). */
export const SESSION_COOKIE_MAX_AGE_SECONDS =
  SESSION_TTL_DAYS * 24 * 60 * 60;

/**
 * Build Set-Cookie value for a new session token (plaintext only in the cookie).
 * Host-only (no Domain=) so dogfood www.speakerops.org sessions do not leak to
 * unrelated hosts under the same registrable domain.
 */
export function buildSessionSetCookie(
  token: string,
  options: SessionCookieOptions = {},
): string {
  const secure = options.secure !== false;
  const maxAge = options.maxAgeSeconds ?? SESSION_COOKIE_MAX_AGE_SECONDS;
  const name = options.name ?? SESSION_COOKIE_NAME;
  const parts = [
    `${name}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

/**
 * Build Set-Cookie that clears the session cookie.
 * Mirrors set flags (Path / SameSite / Secure) so browsers clear the right jar entry.
 */
export function buildClearSessionCookie(
  options: SessionCookieOptions = {},
): string {
  const secure = options.secure !== false;
  const name = options.name ?? SESSION_COOKIE_NAME;
  const parts = [
    `${name}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

/** Parse a Cookie header value into a map. */
export function parseCookieHeader(
  header: string | undefined | null,
): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

export function getSessionTokenFromCookieHeader(
  header: string | undefined | null,
  name: string = SESSION_COOKIE_NAME,
): string | null {
  const cookies = parseCookieHeader(header);
  const token = cookies[name];
  return token && token.length > 0 ? token : null;
}
