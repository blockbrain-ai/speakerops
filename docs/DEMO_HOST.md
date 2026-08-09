# DEMO host — public CFP captcha path (section 10.3)

Dogfood and local e2e use an explicit **DEMO_MODE** Turnstile path so public CFP
submissions are not blocked by a live captcha widget that is misconfigured or
unavailable. Production (no `DEMO_MODE`) remains fail-closed: the development
pass token is never accepted.

**Env names only (E10). Never commit secret values.**

## When to enable

| Surface | `DEMO_MODE` | Notes |
|---------|-------------|--------|
| Local Playwright / unit (`createAppWithAuth`) | implicit `demoMode: true` | Allowlist off; `XXXX.DUMMY.TOKEN` accepted |
| Cloudflare dogfood Worker | `"1"` in `[env.dogfood] vars` | Pair with allowlist hosts |
| Public production | **omit / not `"1"`** | Real `TURNSTILE_*` keys required |

## Worker bindings (names)

| Name | Values | Role |
|------|--------|------|
| `DEMO_MODE` | `"1"` to enable | Forces Cloudflare **always-pass test site key** on `Form.GetPublic`; enables server acceptance of `TURNSTILE_DEV_PASS_TOKEN` under allowlist rules |
| `DEMO_ALLOWLIST_ENABLED` | `"1"` to enforce | When set with DEMO_MODE, DEV_PASS is accepted **only** for listed hosts (and optional event slugs) |
| `DEMO_ALLOWLIST_HOSTS` | comma-separated hostnames | e.g. `www.speakerops.org,speakerops.org,localhost,127.0.0.1` |
| `DEMO_ALLOWLIST_EVENT_SLUGS` | optional comma-separated slugs | Empty = any event on an allowlisted host |
| `TURNSTILE_SECRET_KEY` | secret put | Under DEMO_MODE may be omitted (local-style `"test"` path) or a real key |
| `TURNSTILE_SITE_KEY` | public | Under DEMO_MODE ignored for public CFP (test site key forced) |

Dogfood defaults are in root [`wrangler.toml`](../wrangler.toml) `[env.dogfood]` vars
(names + public host list only — no secrets).

## Deploy requirement (dogfood)

1. Ensure `[env.dogfood]` (or dashboard vars) includes:
   - `DEMO_MODE=1`
   - `DEMO_ALLOWLIST_ENABLED=1`
   - `DEMO_ALLOWLIST_HOSTS` covering the live host (`www.speakerops.org`) and any
     workers.dev preview host you need for smoke
2. Deploy via `pnpm deploy:dogfood` / `scripts/deploy-dogfood.sh` (see
   [`OPERATIONS.md`](./OPERATIONS.md)).
3. Confirm public CFP serves test Turnstile control (`data-turnstile-mode="test"`)
   and submit succeeds with the checkbox control.
4. Confirm a request with `Host` outside the allowlist rejects `XXXX.DUMMY.TOKEN`
   with 400 (unit: AC-10.3-D; live optional).

## Security invariants

- **AC-10.3-C:** `demoMode === false` always rejects `TURNSTILE_DEV_PASS_TOKEN`.
- **AC-10.3-D:** With allowlist enabled, non-allowlisted hosts reject DEV_PASS.
- UI closed state is not authz — closed window is enforced server-side on
  `Submission.Create` (400 when past `closesAt`).
- Never enable `DEMO_MODE` on a public multi-tenant production host without an
  explicit host allowlist.

## Related

- Turnstile verify: `apps/api/src/modules/publicCfp/turnstile.ts`
- Unit negatives: `apps/api/src/modules/publicCfp/turnstile.test.ts`
- E2E submit + closed: `playwright/e2e/public_cfp_submit_demo.spec.ts`
- Secrets index: [`SECRETS.md`](./SECRETS.md)
- Ops runbook: [`OPERATIONS.md`](./OPERATIONS.md)
