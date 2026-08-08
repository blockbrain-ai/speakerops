/**
 * Security headers middleware (section 8.3 — E10).
 *
 * Applies CSP + baseline hardening headers on **all** responses
 * (JSON API, health, and any HTML document served through the Worker).
 *
 * Policy source: @speakerops/shared SECURITY_HEADERS / CONTENT_SECURITY_POLICY
 * so SPA (Vite) and Worker cannot drift.
 */
import type { MiddlewareHandler } from "hono";
import {
  CONTENT_SECURITY_POLICY,
  SECURITY_HEADERS,
} from "@speakerops/shared";

export { CONTENT_SECURITY_POLICY, SECURITY_HEADERS };

/**
 * Set production security headers on the Hono context.
 * Safe to call multiple times; last write wins with the same values.
 */
export function applySecurityHeaders(
  setHeader: (name: string, value: string) => void,
): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    setHeader(name, value);
  }
}

/**
 * Global middleware — CSP and companion headers on every response.
 * Registered early in createApp (after correlation) so 404/500 also carry CSP.
 */
export const securityHeadersMiddleware: MiddlewareHandler = async (c, next) => {
  // Apply before handler so even early returns / stream starts include headers.
  applySecurityHeaders((name, value) => {
    c.header(name, value);
  });
  await next();
  // Re-assert after handler in case a sub-route cleared response headers.
  applySecurityHeaders((name, value) => {
    if (!c.res.headers.has(name)) {
      c.res.headers.set(name, value);
    }
  });
};
