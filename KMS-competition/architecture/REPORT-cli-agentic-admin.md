# Agentic admin: CLI + scoped API keys

**Date:** 2026-08-08  
**Status:** Owner requirement (personal) — first-class product surface  
**Source:** `design/OWNER-PREFERENCES-VERBATIM.md`  
**Fits:** Software 3.0 / AI Engineer culture; does **not** resurrect the pack’s in-app agent fleet

---

## Intent (owner)

Build a **CLI tool** so the team can **administer the platform agentically** if they choose:

- Their agents (Claude, Codex, scripts, internal bots) operate the product.
- Actions go through **existing commands and features** (including design-kit tweaks, uploads, data changes, reporting) — not manual UI-only paths and not a privileged bypass.
- **Secure auth** via **API keys with different permissions** so people/departments can run agents with **limited** scopes.

---

## What this is / is not

| This is | This is not |
|---------|-------------|
| Machine-facing admin surface for **customer-owned** agents | Built-in multi-agent product UI (pack’s 13 agents / autonomy ledger) |
| Thin CLI over the **same domain command layer** as the web app | Second write path that skips validation, authz, or audit |
| Scoped API keys (least privilege) | One god-mode “admin token” for everything |
| Software 3.0: product as tool surface | Replacing the web UI for humans |

**Principle (aligned with data architecture):**  
*UI, CLI, and customer agents all call the same typed commands. D1 decides; authz is server-side; audit is mandatory.*

---

## Architecture

```
Customer agent / human shell
        │
        ▼
  speakerops CLI  ──(HTTPS + API key)──►  Worker API
        │                                      │
        │                              same domain commands
        │                              (Zod + role/scope checks)
        │                                      │
        └──────────────────────────────►  D1 audit: actor = key_id
```

### Components

1. **API keys (server)**  
   - Create/revoke in admin UI (and `speakerops keys …` for bootstrap).  
   - Store **hash only** (never plaintext after mint).  
   - Metadata: name, owner, scopes, event scope (optional), expiry, last used, created by.  
   - Prefix for detection (`spk_live_…` / `spk_test_…`).

2. **Scopes (permission model)**  
   Coarse scopes map to domain capabilities (not raw SQL):

   | Scope | Example capabilities |
   |-------|----------------------|
   | `events:read` | List events, settings read |
   | `events:write` | Create/update event settings |
   | `cfp:read` / `cfp:write` | Forms, public link meta (not public submit) |
   | `submissions:read` / `submissions:write` | Inbox, scores (write may be evaluator-limited) |
   | `decisions:write` | Accept/reject (high risk — default off for dept keys) |
   | `speakers:read` / `speakers:write` | Profiles, tasks |
   | `files:write` | Upload headshots/slides metadata + R2 presign |
   | `schedule:read` / `schedule:write` | Place sessions, conflict-checked moves |
   | `comms:read` / `comms:draft` / `comms:send` | Templates, preview; **send** separate and rare |
   | `design:read` / `design:write` | Design kit tokens, logo, brand publish |
   | `reports:read` | Readiness, exports, aggregates |
   | `airtable:read` | Projection status/lag (no Airtable credentials in CLI) |
   | `keys:admin` | Mint/revoke keys (super-admin only) |

   Department examples:
   - **Program ops agent:** broad write except `keys:admin`; maybe require human for `comms:send`.  
   - **Design agent:** `design:*` + `events:read` only.  
   - **Reporting agent:** `*:read` + `reports:read` only.  
   - **Eval assistant:** `submissions:read` + limited score write.

3. **CLI (`speakerops` or `programos`)**  
   - Install: npm global / single binary (Bun/Node).  
   - Auth: `SPEAKEROPS_API_KEY` env or `speakerops auth login` storing key in OS keychain when possible.  
   - Commands mirror product nouns, not HTTP verbs only:

   ```text
   speakerops events list
   speakerops cfp publish --event <id>
   speakerops submissions list --status in_review
   speakerops speakers tasks --outstanding
   speakerops schedule place --session <id> --room <id> --start ...
   speakerops design set --brand-color '#4F46E5' --preview
   speakerops design publish
   speakerops reports readiness --format json
   speakerops files upload --speaker <id> --type headshot ./photo.jpg
   speakerops comms draft --template task_reminder --preview
   speakerops comms send --draft <id>          # requires comms:send
   speakerops keys create --name design-bot --scopes design:write,events:read
   ```

   - **JSON in / JSON out** (`--json`) for agent parsing; human-friendly tables by default.  
   - **Dry-run / preview** flags on destructive or external side effects.  
   - Exit codes: 0 ok, 1 validation, 2 authz, 3 conflict (e.g. schedule), 4 network.

4. **HTTP API**  
   - Same routes the SPA uses **or** a thin `/api/v1/...` that only wraps domain commands.  
   - Auth: `Authorization: Bearer <api_key>` for machines; cookie session for browser.  
   - OpenAPI generated from Zod → agents and CLI share one contract.

---

## Security requirements

| Control | Detail |
|---------|--------|
| Key storage | Hash at rest; show secret **once** at creation |
| Transport | HTTPS only |
| Scope enforcement | Server-side on every command; CLI cannot self-elevate |
| Event binding | Optional key limited to one `event_id` |
| Expiry & rotation | Supported; revoke is immediate |
| Rate limits | Per key |
| Audit | Every CLI/API mutation logs `actor_type=api_key`, `key_id`, scopes used, command, entity versions |
| High-risk gates | `comms:send`, `decisions:write`, `keys:admin` default-deny for new keys; optional dual-control later |
| No secrets in repo | Keys never committed; CI uses short-lived test keys |
| Design writes | Only token fields — no freeform CSS/JS (XSS) |

---

## Relationship to competition scope

| Layer | Status |
|-------|--------|
| Domain commands + web UI for six workflows | MUST (brief) |
| **API keys + OpenAPI + scoped authz** | **MUST** (enables CLI; low marginal cost if commands exist) |
| **CLI covering core admin/report/design/upload flows** | **MUST (owner)** — production-hard surface, not a hackathon afterthought |
| Built-in chat agent / MCP product / multi-agent ledger | DEFER (customer disinterest; pack overfit) |
| Every future command auto-CLI | SHOULD — generate from command registry |

**Software 3.0 story for judges:**  
Humans use the beautiful web app. Agents use the **same** capabilities via CLI + keys. Departments don’t share a root token. Design can be agent-tweaked through the Design Kit commands, not raw CSS injection.

---

## Implementation order (no over-engineering)

1. Domain command registry with stable names + Zod I/O (already required for SPA).  
2. API key table + middleware (scope check).  
3. OpenAPI export.  
4. CLI v1: auth, events, submissions list, readiness report, design get/set/publish, file upload, schedule place (conflict errors), dry-run sends.  
5. E2E: key with `reports:read` cannot `schedule:write`; design key cannot `comms:send`.  
6. Docs: `docs/cli.md` + agent prompt snippet (“use speakerops --json”).

Avoid: separate gRPC stack, per-agent sandboxes in-product, embedding an LLM in the CLI.

---

## Acceptance criteria (planning)

- [ ] Admin can mint a key with a subset of scopes and revoke it.  
- [ ] CLI authenticates with that key and only succeeds on allowed commands.  
- [ ] CLI can complete a non-trivial admin path without the browser (e.g. list outstanding tasks → draft reminder preview).  
- [ ] CLI can update design tokens and publish (within Design Kit rules).  
- [ ] CLI can upload a file and update speaker task state.  
- [ ] All actions appear in audit log with key identity.  
- [ ] Denied scope returns clear machine-readable error.  
- [ ] Same conflict/validation errors as UI for schedule/place.

---

*— Architecture note for KMS-competition; fold into Section Runner packs as a first-class surface.*
