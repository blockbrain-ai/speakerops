# Security (SpeakerOps)

> **Owners:** section **8.3** (hardening baseline) · Phase **9.4** expands onboarding copy  
> **Standards:** E10 (HttpOnly cookies, CSP, env **names** only) · E2 · E4 · E8

This document is the workspace security baseline. It does **not** replace a full pen test.

## Content-Security-Policy (CSP)

Canonical policy string: `@speakerops/shared` → `CONTENT_SECURITY_POLICY` / `SECURITY_HEADERS`.

| Surface | Mechanism |
|---------|-----------|
| API Worker (all responses) | `apps/api/src/middleware/security.ts` (production CSP) |
| SPA **preview** / production HTML | Vite `preview.headers` + build meta (`CONTENT_SECURITY_POLICY`) |
| SPA **dev / Playwright** HTML | Vite `server.headers` + transformIndexHtml (`CONTENT_SECURITY_POLICY_DEV`) |
| SPA document defense-in-depth | `<meta http-equiv="Content-Security-Policy">` in `apps/web/index.html` |

Policy intent (production):

- `default-src 'self'`
- Turnstile only at `https://challenges.cloudflare.com` (`script-src` / `frame-src` / `connect-src`)
- Google Fonts CSS/font hosts only
- `frame-ancestors 'none'` + `X-Frame-Options: DENY` (clickjacking)
- `object-src 'none'`; `upgrade-insecure-requests`
- **No** `script-src 'unsafe-inline'` on Worker / production / preview

Dev/E2E exception (`CONTENT_SECURITY_POLICY_DEV`): `@vitejs/plugin-react` injects an inline Fast Refresh preamble that production `script-src 'self'` blocks (empty `#root`, suite FAIL). Dev CSP allows `'unsafe-inline'` for scripts and `ws:`/`wss:` for HMR **only** on the Vite development server — never on the Worker or `vite preview`.

**Do not** weaken production CSP or cookie flags for demo convenience.

Companion headers on every Worker response: `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`.

## Session cookies

Name: `speakerops_session` (code constant).

Flags (production-ready, section 2.1 + 8.3):

- `HttpOnly`
- `Secure` (always in `createAppFromBindings`)
- `SameSite=Lax`
- `Path=/`
- Bounded `Max-Age` (`SESSION_TTL_DAYS`)

No session material in `localStorage` / `sessionStorage`.

## Public CFP bot + abuse controls

| Control | Location |
|---------|----------|
| Cloudflare Turnstile server verify | `apps/api/src/modules/publicCfp/turnstile.ts` |
| Rate limit (per client IP) | `apps/api/src/modules/publicCfp/rateLimit.ts` → `429 RATE_LIMITED` |
| Zod body validation + E4 envelopes | public CFP routes |
| Production Turnstile keys required | `createAppFromBindings` rejects missing/test secrets and always-pass site key |

Env **names** only: `TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY` — see `docs/SECRETS.md`.

## XSS proofs (inventory)

| ID | Journey | Proof |
|----|---------|--------|
| **A10** | CFP abstract XSS string renders as text, not script | `@inv:A10` `playwright/e2e/public_cfp.spec.ts` + unit storage assert |
| **C09** | Design logo SVG / `image/svg+xml` rejected | `@inv:C09` `playwright/e2e/design_kit.spec.ts` |

No `dangerouslySetInnerHTML` for untrusted CFP copy. SVG logos are rejected (raster only).

## Dependency audit policy (pnpm / npm)

**Policy:** fail the gate on **high** or **critical** findings; moderate/low do not fail dogfood.

| Item | Value |
|------|--------|
| Command | `pnpm run audit:deps` → `node scripts/dependency-audit.mjs` |
| Tool | `pnpm audit` (fallback `npm audit`) |
| Level | `--audit-level=high` |
| Lockfile | Required (`pnpm-lock.yaml` committed) |
| Secrets | Never printed; registry metadata only |

```bash
pnpm run audit:deps           # human summary
pnpm run audit:deps -- --json # machine-readable
```

Exit codes: `0` pass · `1` high/critical found · `2` tool/lockfile error.

CI guidance: run on mainline / pre-dogfood; track moderate separately. Pin majors; prefer thin client dependency surface (see architecture REPORT-frontend-stack-security).

**Remediation rule:** when `audit:deps` exits `1`, upgrade or replace the affected packages (prefer minimal major jumps; re-run `pnpm typecheck` + `pnpm test:ci`). Do not silence high/critical with an allowlist except owner-documented time-boxed exceptions in this file.

**Runtime note:** Vitest UI-server advisories do not affect `vitest run` / `pnpm test:ci` (no UI server). Vite Windows path advisories are out of scope for Linux Workers dogfood but still fail the policy until patched.

## Roles & scopes

- Server-side `requireRole` / Bearer scopes on Worker (E2/E8)
- High-risk scopes default-deny: `comms:send`, `decisions:write`, `keys:admin`
- CLI must not bypass Worker authz

## Secrets

- Env **names** only in repo — `docs/SECRETS.md`
- Never commit `.env`, `.dev.vars`, tokens, magic links, or API key plaintext
- Structured logs only; redact secrets and magic links

## Failure modes (API)

| Case | Status | Code |
|------|--------|------|
| Unauthenticated | 401 | `UNAUTHORIZED` |
| Wrong role/scope | 403 (or 404 per policy) | `FORBIDDEN` / `NOT_FOUND` |
| Validation | 400 | `VALIDATION_ERROR` |
| Rate limit | 429 | `RATE_LIMITED` |
| Unexpected throw | 500 | `INTERNAL_ERROR` (no stack to client) |

## Out of scope here

- Full pen-test firm engagement
- SBOM / Dependabot automation (post-dogfood optional)
- Dual-write Airtable; freeform CSS; Next/RSC
