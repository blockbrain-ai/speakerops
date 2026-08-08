/**
 * Session cookie helpers (section 2.1 + 8.3 production flags).
 * Flags (E10, never weaken for demo): HttpOnly; Secure; SameSite=Lax; Path=/
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

const DEFAULT_MAX_AGE = SESSION_TTL_DAYS * 24 * 60 * 60;

/**
 * Build Set-Cookie value for a new session token (plaintext only in the cookie).
 */
export function buildSessionSetCookie(
  token: string,
  options: SessionCookieOptions = {},
): string {
  const secure = options.secure !== false;
  const maxAge = options.maxAgeSeconds ?? DEFAULT_MAX_AGE;
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
