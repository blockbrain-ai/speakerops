/**
 * Token generation + hashing for magic links and sessions (section 2.1).
 * Plaintext tokens never persist — only SHA-256 hex digests (E10).
 */

/** Generate a URL-safe random token (32 bytes → base64url). */
export function generateToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** SHA-256 hex digest of a token string (async Web Crypto). */
export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  // btoa is available on Workers and Node ≥16
  const b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** ISO timestamp offset by minutes from now. */
export function expiresAtMinutesFromNow(minutes: number, now = new Date()): string {
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

/** ISO timestamp offset by days from now. */
export function expiresAtDaysFromNow(days: number, now = new Date()): string {
  return new Date(now.getTime() + days * 24 * 60 * 60_000).toISOString();
}

/** True when expiresAt ISO string is in the past relative to now. */
export function isExpired(expiresAt: string, now = new Date()): boolean {
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return true;
  return t <= now.getTime();
}
