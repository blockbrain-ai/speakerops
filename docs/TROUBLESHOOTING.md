# Troubleshooting

> **Soul:** **S-DOCS** · **Owner prose:** section **9.4** · **IA:** [9.1](./sections/9.1-docs-ia.md)  
> **Audience:** operators, agents, clean-room readers · **Secrets:** names only (E10)

## Purpose

Common failures and recovery: local migrate/seed issues, auth/session, scope denials, inventory/E2E gates, deploy health, projection lag, validation envelopes. Points operators at the right runbook without tribal knowledge.

---

## 1. Quick recovery map

| Symptom | First look |
|---------|------------|
| Typecheck / test hang | Gates must be non-watch — [AGENTS.md](../AGENTS.md) · E5 |
| Inventory lint fail | [E2E.md](./E2E.md) · [0.3 law](./governance/0.3-e2e-inventory-law.md) |
| Auth 401 / role 403 | [SECURITY.md](./SECURITY.md) · [0.4 domain map](./governance/0.4-domain-map.md) |
| Missing env / deploy fail | [SECRETS.md](./SECRETS.md) · [OPERATIONS.md](./OPERATIONS.md) |
| Airtable not updating | [AIRTABLE.md](./AIRTABLE.md) (one-way; optional) |
| CLI scope denied | [CLI.md](./CLI.md) · [AGENT_SETUP.md](./AGENT_SETUP.md) |
| Schema / migrate | [ARCHITECTURE.md](./ARCHITECTURE.md) · `pnpm db:migrate` |
| Demo seed drift | [OPERATIONS.md](./OPERATIONS.md) · `pnpm seed` · [8.4](./sections/8.4-demo-seed.md) |
| Blank public CFP / CSP | [SECURITY.md](./SECURITY.md) CSP section (dev vs prod) |
| Email not arriving | Outbox + `EMAIL_PROVIDER` — not request path |
| Conflict 409 on save | Optimistic `version` — refresh and retry |

---

## 2. Local environment

### 2.1 Install / typecheck / unit gates

| Problem | Recovery |
|---------|----------|
| `pnpm install` fails | Node ≥20; use workspace `packageManager` (pnpm pin) |
| `pnpm typecheck` fails | Fix project references; do not skip with `// @ts-ignore` on contracts |
| `pnpm test:ci` hangs | Ensure vitest `watch: false`; no concurrent `--watch` |
| Governance test fails | Read assertion message; usually docs/contracts drift |
| Secret pattern false positive in docs | Avoid quoting fake long tokens; use **names** and placeholders like `<token>` |

### 2.2 Database / seed

| Problem | Recovery |
|---------|----------|
| Migrate fails | Check `SPEAKEROPS_DB_PATH` parent dir; linear migrations present under `packages/db/migrations/` |
| Empty tables after seed | Re-run `pnpm db:migrate && pnpm seed` on clean file |
| Stale SQLite | Delete gitignored `.data/speakerops.local.sqlite` and recreate |
| Person/speaker confusion | Person ≠ Speaker — see [0.4](./governance/0.4-domain-map.md) · [FIELD_FLOW.md](./FIELD_FLOW.md) |

### 2.3 Local API + web

| Problem | Recovery |
|---------|----------|
| Health not 200 | Start e2e API helper / Worker local binding per ONBOARDING |
| CORS / wrong port | Align `E2E_BASE_URL`, Vite port, API port (see E2E.md env table) |
| Magic link missing in UI | Local `AUTH_DEV_OUTBOX=1` for Playwright only — never production default |
| Role switcher missing | Dev mode or `VITE_ROLE_SWITCHER=1`; server needs `ROLE_SWITCHER_ENABLED=1` + admin session |

---

## 3. Auth & authorization

### 3.1 HTTP status cheat sheet

| Status | Meaning | Typical cause |
|--------|---------|---------------|
| **401** | Unauthenticated | Missing/expired cookie or Bearer |
| **403** | Forbidden | Wrong role or missing scope |
| **404** | Not found / isolation | Cross-event or hidden resource policy |
| **400** | Validation | Zod failure — read `code` + `details` |
| **409** | Conflict | Stale `version` / idempotency |
| **429** | Rate limited | Public CFP abuse controls |
| **500** | Internal | Server bug — **no stack** in body; use logs + `correlationId` |

Envelope: `{ error, code, details? }` (E4).

### 3.2 Session / magic link

| Problem | Recovery |
|---------|----------|
| Cookie not set | Must be HTTPS or localhost Secure rules; check `SameSite` |
| Link expired | Request new magic link; do not paste full token into tickets |
| Bootstrap denied | Set `BOOTSTRAP_ADMIN_EMAIL` to intended first admin only |
| Speaker cannot open admin | Expected — role guard; use admin invite |

### 3.3 CLI / API keys

| Problem | Recovery |
|---------|----------|
| Exit **2** FORBIDDEN | Key lacks scope — mint with required scopes; high-risk default-deny |
| Exit for 401 | `SPEAKEROPS_API_KEY` unset or revoked |
| Wrong base URL | `SPEAKEROPS_API_URL` (name only) |
| Deny proof fails | Follow [AGENT_SETUP.md](./AGENT_SETUP.md) schedule:write without scope |

---

## 4. E2E & inventory

| Problem | Recovery |
|---------|----------|
| Missing `@inv:ID` | Add Playwright `test()` title tag in same PR as UI |
| Shrinkage fail | Do **not** delete REQUIRED rows; owner DEFER only |
| Phase 8 run report missing | Run `pnpm test:e2e` → `reports/playwright-run.json` |
| Crawl unmapped control | Add inventory row + test **or** remove control; allowlist pure chrome only |
| Flaky browser | Prefer inventory seed helpers; avoid sleep-only waits |
| Coverage HTML stale | `pnpm docs:e2e-report` |

Law: [0.3-e2e-inventory-law.md](./governance/0.3-e2e-inventory-law.md) · runbook [E2E.md](./E2E.md).

---

## 5. Deploy / Cloudflare

| Problem | Recovery |
|---------|----------|
| Deploy exits immediately | Export `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` via with-secrets |
| Placeholder D1 id | Create D1; set `SPEAKEROPS_D1_DATABASE_ID` |
| Boot crash (health not 200) | Production requires real Turnstile keys — not test always-pass |
| R2 upload fail | Bucket binding `FILES`; mime/size policy; SVG logo reject expected |
| Queue not draining | Consumer wiring; check Worker queue/scheduled handlers |
| Need data rollback | **D1 Time Travel** bookmark — [OPERATIONS.md](./OPERATIONS.md) § Rollback |

---

## 6. Side effects (email / Airtable)

| Problem | Recovery |
|---------|----------|
| No email in sandbox | Expected — `EMAIL_PROVIDER=sandbox` does not network |
| Live send no-op | `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` secret; check outbox |
| Double send | Idempotency key path; do not retry with new key blindly |
| Airtable empty | Pause if keys unset; check O06 lag status |
| Want dual-write | **Stop** — forbidden; fix D1 instead ([AIRTABLE.md](./AIRTABLE.md)) |

---

## 7. Field flow / product data

| Problem | Recovery |
|---------|----------|
| Form changes not on old submission | Form version pinned at submit — expected |
| Accept without portal tasks | Check decision side-effects / task templates |
| File missing in portal | Complete upload flow; virus_scan_status; R2 key in `file_assets` |
| Schedule conflict not shown | Re-fetch schedule; conflict rules are deterministic server-side |
| Readiness stale | Portal complete should update; hard refresh; check event scope |

Narrative: [FIELD_FLOW.md](./FIELD_FLOW.md).

---

## 8. Capturing support evidence (redaction)

When filing issues or BC evidence:

1. Include `correlationId` if available.  
2. Include HTTP status + E4 `code` (not raw secrets).  
3. Redact cookies, `spk_…` keys, magic links, Turnstile tokens, Cloudflare tokens.  
4. Prefer env **names** (`AIRTABLE_API_KEY unset`) over values.  
5. Screenshots: mask email tokens in URL bars.

---

## 9. Competition / scope confusion

| Expectation | Reality |
|-------------|---------|
| Sessionboard CRM / marketing | **Out** — [COMPETITION.md](./COMPETITION.md) struck |
| AI multi-round review | **Struck** — human eval only |
| OR-Tools auto place | **Out** — drag-drop + conflicts |
| Airtable is database | **Out** — D1 SoR, one-way projection |
| Next/RSC or Postgres dual-stack | **Out** — stack lock |

---

## 10. Escalation order

1. This matrix + linked deep doc  
2. Section note under `docs/sections/` for the owning phase  
3. Binding contracts (SCHEMA / COMMANDS / SCOPES / inventory)  
4. Constitution souls — do not dilute pass criteria for schedule  

## Related

- Human onboarding: [ONBOARDING.md](./ONBOARDING.md)  
- Agent setup: [AGENT_SETUP.md](./AGENT_SETUP.md)  
- Architecture: [ARCHITECTURE.md](./ARCHITECTURE.md)  
- Security: [SECURITY.md](./SECURITY.md)  
- Operations: [OPERATIONS.md](./OPERATIONS.md)  
- Competition non-goals: [COMPETITION.md](./COMPETITION.md)  
- Section 9.4: [9.4-deep-docs.md](./sections/9.4-deep-docs.md)  
