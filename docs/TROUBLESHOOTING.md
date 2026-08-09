# Troubleshooting

> **Soul:** **S-DOCS** · **Owner prose:** section **9.4** · **IA:** [9.1](./sections/9.1-docs-ia.md)

## Purpose

Common failures and recovery: local migrate/seed issues, auth/session, scope denials, inventory/E2E gates, deploy health, projection lag. Points operators at the right runbook without tribal knowledge.

## Status (section 9.1)

**Stub.** Full failure matrix lands in **9.4**. Leaf present for coherent docs tree (S-DOCS).

## Quick recovery map

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

## Secret rule

When capturing logs for support or evidence: **redact** tokens, cookies, and magic links. Names only in docs (E10).

## Related

- Human onboarding: [ONBOARDING.md](./ONBOARDING.md)  
- Field flow: [FIELD_FLOW.md](./FIELD_FLOW.md)  
- Competition non-goals: [COMPETITION.md](./COMPETITION.md)
