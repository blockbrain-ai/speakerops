# Agent setup

> **Soul:** **S-ONB-AGENT** · **Owner prose:** section **9.3** · **Proof:** **9.6** / BC14  
> **Companion:** [CLI.md](./CLI.md) · OpenAPI `GET /openapi.json` · **IA:** [9.1](./sections/9.1-docs-ia.md)

## Purpose

Coding agents and automated operators (with secrets injected **out-of-band**) bootstrap a scoped API key, call the same domain commands as HTTP, and complete readiness + design publish **without human UI** (except secret inject).

## Status (section 9.1)

**Stub.** Full agent runbook, copy-paste prompt block, and deny-scope proof narrative land in **9.3**. Leaf present for tree + link integrity (S-DOCS).

## Orientation (agent)

| Concern | Where |
|---------|--------|
| Standards / gates | [AGENTS.md](../AGENTS.md) · E1–E12 |
| Domain commands | [COMMANDS.md](../KMS-competition/initiative/contracts/COMMANDS.md) · [0.4 domain map](./governance/0.4-domain-map.md) |
| Scopes (default-deny) | [SCOPES.md](../KMS-competition/initiative/contracts/SCOPES.md) · `comms:send`, `decisions:write`, `keys:admin` |
| CLI surface | [CLI.md](./CLI.md) · [CLI_INVENTORY.md](../KMS-competition/initiative/contracts/CLI_INVENTORY.md) |
| Env **names** | [SECRETS.md](./SECRETS.md) — never log secret values |
| Schema / SoR | [ARCHITECTURE.md](./ARCHITECTURE.md) · [SCHEMA.md](../KMS-competition/initiative/contracts/SCHEMA.md) |
| Human path (do not collapse) | [ONBOARDING.md](./ONBOARDING.md) |

## Success criteria (Phase 9)

- Install / run `speakerops` CLI against Worker  
- Mint or use scoped API key (least privilege)  
- Readiness JSON + design publish without admin SPA  
- Deny-scope proof (missing scope → 403)  
- OpenAPI + `--help` as machine contracts  

## Secret rule

Secrets are injected by the host environment (see [SECRETS.md](./SECRETS.md)). Docs list **names only**. Agents must never echo full keys or magic links into logs or evidence files.
