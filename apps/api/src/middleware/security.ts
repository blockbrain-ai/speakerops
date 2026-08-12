/**
 * Security headers middleware (section 8.3 — E10).
 *
 * Applies CSP + baseline hardening headers on **all** responses
 * (JSON API, health, and any HTML document served through the Worker).
 *
 * Policy source: @speakerops/shared SECURITY_HEADERS / CONTENT_SECURITY_POLICY
 * so SPA (Vite) and Worker cannot drift.
 *
 * `/embed/*` uses SECURITY_HEADERS_EMBED so third-party sites and the admin
 * device preview can iframe the embed bundle (N4).
 */
import type { MiddlewareHandler } from "hono";
import {
  CONTENT_SECURITY_POLICY,
  CONTENT_SECURITY_POLICY_EMBED,
  SECURITY_HEADERS,
  SECURITY_HEADERS_EMBED,
} from "@speakerops/shared";

export {
  CONTENT_SECURITY_POLICY,
  CONTENT_SECURITY_POLICY_EMBED,
  SECURITY_HEADERS,
  SECURITY_HEADERS_EMBED,
};

function isEmbedPath(pathname: string): boolean {
  return pathname === "/embed" || pathname.startsWith("/embed/");
}

/**
 * Set production security headers on the Hono context.
 * Safe to call multiple times; last write wins with the same values.
 */
export function applySecurityHeaders(
  setHeader: (name: string, value: string) => void,
  embed = false,
): void {
  const headers = embed ? SECURITY_HEADERS_EMBED : SECURITY_HEADERS;
  for (const [name, value] of Object.entries(headers)) {
    setHeader(name, value);
  }
  if (embed) {
    // Ensure DENY from a prior default write cannot stick on embed documents.
    setHeader("X-Frame-Options", "");
  }
}

/**
 * Global middleware — CSP and companion headers on every response.
 * Registered early in createApp (after correlation) so 404/500 also carry CSP.
 */
export const securityHeadersMiddleware: MiddlewareHandler = async (c, next) => {
  const pathname = new URL(c.req.url).pathname;
  const embed = isEmbedPath(pathname);
  // Apply before handler so even early returns / stream starts include headers.
  applySecurityHeaders((name, value) => {
    if (name === "X-Frame-Options" && embed && value === "") {
      c.res.headers.delete("X-Frame-Options");
      return;
    }
    c.header(name, value);
  }, embed);
  await next();
  // Re-assert after handler in case a sub-route cleared response headers.
  applySecurityHeaders((name, value) => {
    if (name === "X-Frame-Options" && embed) {
      c.res.headers.delete("X-Frame-Options");
      return;
    }
    if (!c.res.headers.has(name)) {
      c.res.headers.set(name, value);
    } else if (embed && name === "Content-Security-Policy") {
      c.res.headers.set(name, value);
    }
  }, embed);
  if (embed) {
    c.res.headers.delete("X-Frame-Options");
  }
};
