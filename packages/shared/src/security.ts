/**
 * Security header constants (section 8.3 — E10 production hardening).
 *
 * Shared by API middleware, Vite SPA headers, and docs so CSP cannot drift.
 * Turnstile + Google Fonts are the only intentional third-party origins.
 */

/**
 * Baseline Content-Security-Policy for HTML documents and API responses.
 *
 * - default-src 'self' — no open third-party by default
 * - script-src: self + Cloudflare Turnstile widget host
 * - style-src: self + Google Fonts CSS; 'unsafe-inline' for React style attrs / Lumen tokens
 * - frame-src: Turnstile challenge iframe only
 * - frame-ancestors 'none' — clickjacking defense (header form; meta cannot set this)
 * - object-src 'none' — no plugins
 * - upgrade-insecure-requests — HTTPS dogfood
 *
 * Production/preview must use this policy (no script 'unsafe-inline').
 * Vite dev/E2E only: see CONTENT_SECURITY_POLICY_DEV.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' https://fonts.gstatic.com data:",
  "connect-src 'self' https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

/**
 * Vite **development server only** CSP (Playwright webServer / local `vite`).
 *
 * `@vitejs/plugin-react` injects an inline React Fast Refresh preamble that
 * production `script-src 'self'` blocks, leaving `#root` empty and failing
 * the browser suite. Dev also needs `ws:`/`wss:` for HMR.
 *
 * Never apply this policy on the Worker, production builds, or `vite preview`.
 * Hash/nonce-capable hosts should prefer production CONTENT_SECURITY_POLICY
 * with a real nonce; this string is the minimal dev/E2E exception.
 */
export const CONTENT_SECURITY_POLICY_DEV = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' https://fonts.gstatic.com data:",
  "connect-src 'self' ws: wss: https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

/** Canonical security response headers (all responses) — production CSP. */
export const SECURITY_HEADERS = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
} as const;

/** Dev/E2E Vite server headers — companion headers + CONTENT_SECURITY_POLICY_DEV. */
export const SECURITY_HEADERS_DEV = {
  ...SECURITY_HEADERS,
  "Content-Security-Policy": CONTENT_SECURITY_POLICY_DEV,
} as const;

export type SecurityHeaderName = keyof typeof SECURITY_HEADERS;

/** Machine-readable code for public CFP rate limit (429). */
export const RATE_LIMITED = "RATE_LIMITED" as const;
