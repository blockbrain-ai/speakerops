# Security (SpeakerOps)

> **Owners:** section **8.3** (hardening baseline) · section **9.4** (deep onboarding prose)  
> **Standards:** **E10** (HttpOnly cookies, CSP, env **names** only) · E2 · E3 · E4 · E8  
> **Docs map:** [README](../README.md) · [9.1 IA](./sections/9.1-docs-ia.md) · [ARCHITECTURE](./ARCHITECTURE.md) · [SECRETS](./SECRETS.md) · [9.4](./sections/9.4-deep-docs.md)

This document is the workspace security baseline for operators, agents, and auditors. It does **not** replace a full pen-test engagement. It **matches E10** and the failure modes required by the programme.

---

## 1. E10 summary (binding)

| Rule | Practice |
|------|----------|
| Session cookies | `HttpOnly` + `Secure` + `SameSite=Lax` — never auth material in `localStorage` / `sessionStorage` |
| CSP | Production Worker / preview: strict `script-src 'self'` (no `'unsafe-inline'` on production paths) |
| Secrets in repo | **Env names only** — never values, never magic-link tokens, never raw API keys |
| Logging | Structured logs; **redact** secrets, cookies, magic links, Bearer tokens |
| Trust boundary | Authz on **Worker** only — CLI/UI never sufficient alone |

Canonical secret **names** index: [`docs/SECRETS.md`](./SECRETS.md).

---

## 2. Content-Security-Policy (CSP)

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

---

## 3. Session cookies (humans)

Name: `speakerops_session` (code constant).

Flags (production-ready, section 2.1 + 8.3):

- `HttpOnly`
- `Secure` (always in `createAppFromBindings`)
- `SameSite=Lax`
- `Path=/`
- Bounded `Max-Age` (`SESSION_TTL_DAYS`)

Magic-link exchange issues the cookie server-side. Tokens themselves are single-use, short-lived, and must **never** appear in git, evidence logs, or structured log fields at full length.

---

## 4. API keys & scopes (agents / CLI)

| Concern | Rule |
|---------|------|
| Format | Bearer secret prefix `spk_…` (minted once; store hashed server-side) |
| Enforcement | Worker `requireScope` — CLI cannot bypass |
| High-risk default-deny | `comms:send`, `decisions:write`, `keys:admin` on new keys |
| Mint / revoke | Admin role + `keys:admin` for key admin operations |
| Env for CLI | `SPEAKEROPS_API_KEY` (name only in docs) |

Canonical scopes: [SCOPES.md](../KMS-competition/initiative/contracts/SCOPES.md).  
Agent deny proof: [AGENT_SETUP.md](./AGENT_SETUP.md) · [CLI.md](./CLI.md).

---

## 5. Roles (event-scoped)

| Role | Typical surfaces |
|------|------------------|
| `admin` | Event settings, forms, decisions, schedule, comms send, keys, readiness |
| `evaluator` | Assigned scoring only |
| `speaker` | Portal tasks / profile / uploads for own participation |
| `public` | Public CFP get/submit (Turnstile) |

Cross-event access: **403** or **404** per policy (isolation preferred over information leak). Server-side `requireRole` is mandatory (E2).

---

## 6. Public CFP bot + abuse controls

| Control | Location |
|---------|----------|
| Cloudflare Turnstile server verify | `apps/api/src/modules/publicCfp/turnstile.ts` |
| Rate limit (per client IP) | `apps/api/src/modules/publicCfp/rateLimit.ts` → `429 RATE_LIMITED` |
| Zod body validation + E4 envelopes | public CFP routes |
| Production Turnstile keys required | `createAppFromBindings` rejects missing/test secrets and always-pass site key |

Env **names** only: `TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY` — see `docs/SECRETS.md`.

---

## 7. XSS proofs (inventory)

| ID | Journey | Proof |
|----|---------|--------|
| **A10** | CFP abstract XSS string renders as text, not script | `@inv:A10` `playwright/e2e/public_cfp.spec.ts` + unit storage assert |
| **C09** | Design logo SVG / `image/svg+xml` rejected | `@inv:C09` `playwright/e2e/design_kit.spec.ts` |

No `dangerouslySetInnerHTML` for untrusted CFP copy. SVG logos are rejected (raster only). Comms templates use controlled merge fields — not arbitrary HTML execution in admin chrome.

---

## 8. Dependency audit policy (pnpm / npm)

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

**Remediation rule:** when `audit:deps` exits `1`, upgrade or replace the affected packages (prefer minimal major jumps; re-run `pnpm typecheck` + `pnpm test:ci`). Do not silence high/critical with an allowlist except owner-documented time-boxed exceptions in this file.

**Runtime note:** Vitest UI-server advisories do not affect `vitest run` / `pnpm test:ci` (no UI server). Vite Windows path advisories are out of scope for Linux Workers dogfood but still fail the policy until patched.

---

## 9. Failure modes (API) — E4

| Case | Status | Code | Client body |
|------|--------|------|-------------|
| Unauthenticated | **401** | `UNAUTHORIZED` | `{ error, code, details? }` |
| Wrong role/scope | **403** (or **404** per policy) | `FORBIDDEN` / `NOT_FOUND` | no stack |
| Validation | **400** | `VALIDATION_ERROR` | machine-readable details |
| Conflict (version) | **409** | per COMMANDS | when optimistic concurrency fails |
| Rate limit | **429** | `RATE_LIMITED` | retry guidance optional |
| Unexpected throw | **500** | `INTERNAL_ERROR` | **no stack trace to client** |

Envelope shape is stable across HTTP and CLI (CLI maps HTTP status to exit codes — see [CLI.md](./CLI.md)).

---

## 10. Correlation & audit (E3)

- Propagate `correlationId` end-to-end; never regenerate mid-request
- Consequential product writes insert `audit_events` with actor, action, entity, before/after (as designed), `correlation_id`
- Side-effect drains (email, Airtable) retain correlation for support forensics
- **Do not** log full magic links, session cookies, or API key secrets in audit or structured logs

---

## 11. Secrets handling (names only)

| Do | Do not |
|----|--------|
| Document env **names** in SECRETS.md | Commit `.env`, `.dev.vars`, tokens |
| Use `scripts/with-secrets.sh` for deploy only | Source secrets into `pnpm test:ci` / `typecheck` |
| Redact evidence (BC10 URL rules in OPERATIONS) | Paste Bearer values into issues or docs |
| Rotate via `wrangler secret put` | Put tokens in wrangler `[vars]` |

Demo role switcher (`ROLE_SWITCHER_ENABLED`) is **default off** and still requires an existing admin session when enabled — workers.dev alone is not an auth boundary.

---

## 12. Threat notes (non-exhaustive)

| Threat | Control |
|--------|---------|
| Session theft via XSS | HttpOnly cookie + CSP + no unsafe HTML |
| CSRF on cookie session | SameSite=Lax + careful mutation methods |
| Scope escalation via CLI | Server-side scopes; deny tests CLI07 |
| Public CFP spam / bots | Turnstile + rate limit |
| Logo XSS | SVG reject; raster only |
| Dual-write integrity | Airtable one-way only; D1 SoR |
| Secret leakage in CI logs | Gates never inject secrets |

---

## 13. Out of scope here

- Full pen-test firm engagement  
- SBOM / Dependabot automation (post-dogfood optional)  
- Dual-write Airtable; freeform CSS; Next/RSC  
- Multi-region HA as Phase 0–9 requirement  

## Related

- Architecture: [ARCHITECTURE.md](./ARCHITECTURE.md)  
- Operations / deploy: [OPERATIONS.md](./OPERATIONS.md)  
- Secrets names: [SECRETS.md](./SECRETS.md)  
- Hardening section: [8.3](./sections/8.3-security-hardening.md)  
- Troubleshooting auth: [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)  
