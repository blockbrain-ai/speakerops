# Onboarding (human path)

> **Soul:** **S-ONB-HUMAN** · **Owner prose:** section **9.2** · **Proof:** **9.6** / BC13  
> **IA map:** section [9.1](./sections/9.1-docs-ia.md) · Outline: [0.5](./governance/0.5-docs-onboarding-outline.md)

## Purpose

New human operators (AIE staff, judges, clean-room readers) go from **zero → running** without tribal knowledge: env **names** → migrate → seed → deploy notes → first login → demo path (CFP → eval → portal → schedule → readiness).

## Status (section 9.1)

**Stub.** Full timed checklist and step-by-step prose land in **9.2**. This leaf exists so the docs tree matches the [0.5 outline](./governance/0.5-docs-onboarding-outline.md) and internal links resolve.

## Start here (orientation)

| Step | Doc / command | Notes |
|------|---------------|--------|
| 1. Programme + stack | [README](../README.md) · [0.1 contract](./governance/0.1-programme-contract.md) | Non-goals and soul pointers |
| 2. Env **names** only | [SECRETS.md](./SECRETS.md) | Never commit secret values (E10) |
| 3. Local DB | `pnpm db:migrate` · `pnpm seed` | See [OPERATIONS.md](./OPERATIONS.md) |
| 4. Gates | `pnpm typecheck` · `pnpm test:ci` | [AGENTS.md](../AGENTS.md) |
| 5. E2E | [E2E.md](./E2E.md) · `pnpm test:e2e` | Inventory law [0.3](./governance/0.3-e2e-inventory-law.md) |
| 6. Deploy (dogfood) | [OPERATIONS.md](./OPERATIONS.md) | S-CF / section 8.6 |
| 7. Security baseline | [SECURITY.md](./SECURITY.md) | CSP, cookies, scopes |

## Related paths

| Audience | Primary doc |
|----------|-------------|
| **Human** (this file) | `docs/ONBOARDING.md` → HTML `reports/onboarding.html` (9.5) |
| **Agent** | [AGENT_SETUP.md](./AGENT_SETUP.md) · [CLI.md](./CLI.md) |
| **Deep reference** | [ARCHITECTURE.md](./ARCHITECTURE.md) · [FIELD_FLOW.md](./FIELD_FLOW.md) · [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) |
| **Contracts** | [CONTRACTS.md](./CONTRACTS.md) |

## Secret rule

Document **variable names only** (`CLOUDFLARE_*`, `AIRTABLE_*`, `RESEND_*`, `TURNSTILE_*`, …). Never commit or log API keys, session cookies, or magic-link tokens in full.
