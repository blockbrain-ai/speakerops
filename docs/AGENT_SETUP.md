# Agent setup (S-ONB-AGENT)

> **Soul:** **S-ONB-AGENT** · **Owner prose:** section **9.3** · **Proof:** **9.6** / BC14  
> **Companion:** [CLI.md](./CLI.md) · OpenAPI `GET /openapi.json` · **IA:** [9.1](./sections/9.1-docs-ia.md)  
> **Section note:** [9.3-agent-setup.md](./sections/9.3-agent-setup.md) · Outline: [0.5](./governance/0.5-docs-onboarding-outline.md)

## Purpose

Coding agents and automated operators (with secrets injected **out-of-band**) bootstrap a **scoped API key**, call the same domain commands as HTTP, and complete **readiness JSON** + **design publish** **without human UI** (except secret inject).

Do **not** collapse this path into [ONBOARDING.md](./ONBOARDING.md) (human). Both are first-class constitution souls.

---

## Success criteria

| Criterion | How to prove |
|-----------|----------------|
| Install / run `speakerops` CLI against Worker | `speakerops --help` · exit 0 |
| Mint or use scoped API key (least privilege) | Admin UI or `keys create` (needs `keys:admin`) |
| Readiness JSON without admin SPA | `speakerops reports readiness --event <id> --json` |
| Design publish without admin SPA | `speakerops design publish --event <id>` |
| Deny-scope proof | Missing scope → HTTP **403** `FORBIDDEN` → CLI **exit 2** |
| Machine contracts | OpenAPI `GET /openapi.json` + CLI `--help` + [CLI_INVENTORY.md](../KMS-competition/initiative/contracts/CLI_INVENTORY.md) |

---

## Orientation (agent)

| Concern | Where |
|---------|--------|
| Standards / gates | [AGENTS.md](../AGENTS.md) · E1–E12 |
| Domain commands | [COMMANDS.md](../KMS-competition/initiative/contracts/COMMANDS.md) · [0.4 domain map](./governance/0.4-domain-map.md) |
| Scopes (default-deny) | [SCOPES.md](../KMS-competition/initiative/contracts/SCOPES.md) · high-risk: `comms:send`, `decisions:write`, `keys:admin` |
| CLI surface | [CLI.md](./CLI.md) · [CLI_INVENTORY.md](../KMS-competition/initiative/contracts/CLI_INVENTORY.md) (CLI01–CLI12) |
| Env **names** | [SECRETS.md](./SECRETS.md) — never log secret values |
| Schema / SoR | [ARCHITECTURE.md](./ARCHITECTURE.md) · [SCHEMA.md](../KMS-competition/initiative/contracts/SCHEMA.md) |
| Human path (do not collapse) | [ONBOARDING.md](./ONBOARDING.md) |

---

## Secret rule (E10)

Secrets are injected by the **host environment** (see [SECRETS.md](./SECRETS.md)). Docs list **variable names only**. Agents must never echo full API keys, JWTs, or magic-link tokens into logs, evidence files, or commits.

| Env name | Purpose |
|----------|---------|
| `SPEAKEROPS_API_KEY` | Bearer secret (`spk_…` prefix shape) — minted; never commit value |
| `SPEAKEROPS_API_URL` | API base URL (default `http://127.0.0.1:8787`) |
| `SPEAKEROPS_CORRELATION_ID` | Optional fixed correlation id (else CLI generates `cli_…`) |

Flags `--api-key` / `--api-url` override env for a single invocation. Prefer env inject over CLI args so secrets stay out of shell history when possible.

---

## Copy-paste agent prompt block

Give the following block to a coding agent after secrets are injected out-of-band. Replace `<EVENT_ID>` with a real event id (demo seed: `evt_dogfood`).

```text
You are operating SpeakerOps as an automated agent (constitution soul S-ONB-AGENT).

Contracts (do not invent endpoints or tables):
- docs/AGENT_SETUP.md (this path)
- docs/CLI.md
- KMS-competition/initiative/contracts/COMMANDS.md
- KMS-competition/initiative/contracts/SCOPES.md
- KMS-competition/initiative/contracts/CLI_INVENTORY.md
- OpenAPI: GET $SPEAKEROPS_API_URL/openapi.json

Auth:
- Use env SPEAKEROPS_API_KEY (Bearer) and optional SPEAKEROPS_API_URL.
- Scopes are enforced server-side on the Worker. Never assume the CLI elevates privileges.
- High-risk scopes are default-deny: comms:send, decisions:write, keys:admin.
- Never log or commit full API keys, magic links, or JWTs (E10). Prefer redacting secrets as [REDACTED_KEY].

Required smoke (prefer --json):
1. speakerops openapi --json
   # or: curl -s "$SPEAKEROPS_API_URL/openapi.json"
2. speakerops events list --json
3. speakerops reports readiness --event <EVENT_ID> --json
4. speakerops design get --event <EVENT_ID> --json
5. speakerops design publish --event <EVENT_ID>
   # contrast gate may return 400 CONTRAST_FAILED (exit 1) — that is a product rule, not authz failure

Deny-scope proof (use a reports-only key: events:read + reports:read only):
6. speakerops schedule place --event <EVENT_ID> --session S --room R \
     --start 2030-01-01T10:00:00Z --end 2030-01-01T11:00:00Z --json
   # Expect exit 2 and E4 body { "error": "...", "code": "FORBIDDEN", "details": { "required": ["schedule:write"] } }

Exit codes: 0 ok · 1 validation/not-found · 2 authz (401/403) · 3 conflict (409) · 4 network/5xx.
Treat exit 2 as wrong key / missing scope — do not retry with broader privileges without an explicit human scope grant.
Same domain commands as HTTP; audit_events + correlationId on consequential writes.
```

---

## 1. Install CLI

From monorepo root (after `pnpm install`):

```bash
pnpm --filter @speakerops/cli build
pnpm exec speakerops --help
# or: node packages/cli/dist/main.js --help
```

Package: `@speakerops/cli` (`packages/cli`). Composition root: `packages/cli/src/main.ts`.

---

## 2. Key mint (scoped)

### Preferred: least-privilege agent key

Mint via **Admin → Settings → API keys** (session role `admin`) or CLI when you already hold `keys:admin`:

```bash
# Requires SPEAKEROPS_API_KEY with keys:admin (default-deny on new keys)
speakerops keys create \
  --name "agent-readiness" \
  --scopes events:read,reports:read,design:read,design:write \
  --json
```

- Secret is returned **once** in the create response. Store it in the host secret channel as `SPEAKEROPS_API_KEY`.
- List endpoints never re-display the secret.
- Without `keys:admin` → **exit 2** / HTTP **403** `FORBIDDEN` (CLI11).
- **Shared-demo note:** demo-persona sessions (role switcher / `/judge` judge access) cannot create API keys — key mint needs a real admin login.

### Scope recipes (examples — not values)

| Agent role | Example scopes (comma-separated) |
|------------|----------------------------------|
| Reporting only | `events:read`, `reports:read` |
| Design publish | `events:read`, `design:read`, `design:write` |
| Schedule ops | `events:read`, `schedule:read`, `schedule:write` |
| Comms draft | `comms:draft` (**not** `comms:send`) |
| Key admin | `keys:admin` (**default-deny** — grant explicitly) |

Full matrix: [SCOPES.md](../KMS-competition/initiative/contracts/SCOPES.md).

```bash
export SPEAKEROPS_API_URL="${SPEAKEROPS_API_URL:-http://127.0.0.1:8787}"
# Host injects SPEAKEROPS_API_KEY — do not paste the value into docs or logs
export SPEAKEROPS_API_KEY   # set by operator out-of-band
```

---

## 3. OpenAPI URL

Machine discovery document (public; no secret):

```bash
# CLI12
speakerops openapi --json
# equivalent:
curl -s "${SPEAKEROPS_API_URL}/openapi.json"
```

**URL:** `{SPEAKEROPS_API_URL}/openapi.json` (local default `http://127.0.0.1:8787/openapi.json`). The deployed site serves it live too: `https://www.speakerops.org/openapi.json`.

Expect paths that include `/api/events`, design, schedule, readiness, keys, and other COMMANDS.md routes. Do not invent routes that are absent from OpenAPI / COMMANDS.

---

## 4. Readiness JSON (`speakerops reports readiness`)

```bash
# CLI02 — scope reports:read
speakerops reports readiness --event evt_dogfood --json
```

**HTTP:** `GET /api/events/:eventId/readiness` → domain command `Reports.Readiness`.

**Stable shape (illustrative — field presence matters more than sample values):**

```json
{
  "eventId": "evt_dogfood",
  "stats": {},
  "outstanding": [],
  "generatedAt": "2026-01-01T00:00:00.000Z"
}
```

Optional: `--overdue-only` → query `overdueOnly=true`.

Without `reports:read` → **exit 2** / **403**.

---

## 5. Design publish (no human SPA)

```bash
# CLI03 — inspect
speakerops design get --event evt_dogfood --json

# CLI04 — set draft tokens only (no freeform CSS — E6 Lumen)
speakerops design set --event evt_dogfood --brand '#4F46E5' --radius soft

# CLI05 — publish (fetches draft version then publishes)
speakerops design publish --event evt_dogfood --json
```

| Command | Scope | HTTP |
|---------|-------|------|
| `design get` | `design:read` | `GET /api/events/:eventId/design` |
| `design set` | `design:write` | `PUT /api/events/:eventId/design` |
| `design publish` | `design:write` | `POST /api/events/:eventId/design/publish` |

Contrast gate may return **400** `CONTRAST_FAILED` → CLI **exit 1** (validation), not authz. That is expected product policy.

---

## 6. Scope deny example (required proof)

Use a key that has **only** `events:read` + `reports:read` (no `schedule:write`):

```bash
# CLI07 — scope deny proof
speakerops schedule place \
  --event evt_dogfood \
  --session sess_example \
  --room room_example \
  --start 2030-01-01T10:00:00.000Z \
  --end 2030-01-01T11:00:00.000Z \
  --json
# → process exit 2
# → body includes code FORBIDDEN and required schedule:write
```

**Expected E4 envelope (shape):**

```json
{
  "error": "Missing required scope",
  "code": "FORBIDDEN",
  "details": {
    "required": ["schedule:write"]
  }
}
```

| HTTP | CLI exit | Meaning |
|------|----------|---------|
| **401** | **2** | Unauthenticated / invalid key |
| **403** | **2** | Wrong role/scope (e.g. missing `schedule:write`) |
| **400** | **1** | Validation (machine-readable `code`) |
| **409** | **3** | Conflict (e.g. schedule double-book) |
| **5xx** | **4** | Server / network |

Additional deny paths (same exit **2**):

```bash
# CLI10 — high-risk default-deny
speakerops comms send --preview-id prev_example --json
# without comms:send → FORBIDDEN exit 2

# CLI11
speakerops keys create --name "x" --scopes events:read --json
# without keys:admin → FORBIDDEN exit 2
```

Server-side enforcement only — never trust CLI/UI alone (E2/E8).

---

## 7. Exit codes (summary)

| Code | Meaning |
|------|---------|
| **0** | Success |
| **1** | Validation / not found / client config (missing key) |
| **2** | Authz (401/403 — wrong/missing scope) |
| **3** | Conflict (409 CONFLICT/VERSION) |
| **4** | Network / 5xx |

Full command table: [CLI.md](./CLI.md). Inventory IDs CLI01–CLI12: [CLI_INVENTORY.md](../KMS-competition/initiative/contracts/CLI_INVENTORY.md).

---

## 8. Upload path (optional agent ops)

```bash
# CLI08 — scope files:write
speakerops files upload --event evt_dogfood --file ./logo.png --purpose logo --json
```

Presign → upload bytes → complete. Headshot/slides bind with `--participation <participationId>` when required by COMMANDS.

---

## 9. Agent operating rules

1. Prefer `--json` for all automation; parse E4 `{ error, code, details? }` on failure.
2. Treat exit **2** as “wrong key / need broader scope” — not a retry loop without human grant.
3. Treat exit **3** as schedule conflict — surface `conflicts[]` to the operator.
4. Never log full API key secrets or magic links (E10). Redact as `[REDACTED_KEY]`.
5. Same audit path as UI: mutations write `audit_events` with `correlationId` (and `key_id` when Bearer).
6. Do not invent endpoints or schema columns outside COMMANDS.md / SCHEMA.md.
7. No dual-write Airtable, OR-Tools, Next/RSC, or in-product agent fleet (programme non-goals).

---

## 10. Minimal end-to-end script (agent)

Assumes Worker is up, seed applied (`evt_dogfood`), and `SPEAKEROPS_API_KEY` injected with design + reports scopes:

```bash
set -euo pipefail
: "${SPEAKEROPS_API_KEY:?set SPEAKEROPS_API_KEY out-of-band}"
export SPEAKEROPS_API_URL="${SPEAKEROPS_API_URL:-http://127.0.0.1:8787}"
EVENT_ID="${EVENT_ID:-evt_dogfood}"

speakerops openapi --json >/dev/null
speakerops events list --json
speakerops reports readiness --event "$EVENT_ID" --json
speakerops design get --event "$EVENT_ID" --json
# design publish may exit 1 on CONTRAST_FAILED — product rule
speakerops design publish --event "$EVENT_ID" --json || test $? -eq 1
```

Deny proof uses a **separate** reports-only key (do not mix with the design key above).

---

## Related docs

- [CLI.md](./CLI.md) — full command reference  
- [CLI_INVENTORY.md](../KMS-competition/initiative/contracts/CLI_INVENTORY.md) — CLI01–CLI12  
- [SECRETS.md](./SECRETS.md) — env **names** only  
- [ONBOARDING.md](./ONBOARDING.md) — human path (S-ONB-HUMAN)  
- [sections/7.1-api-keys.md](./sections/7.1-api-keys.md) · [sections/7.2-cli.md](./sections/7.2-cli.md)  
- [sections/9.3-agent-setup.md](./sections/9.3-agent-setup.md) — this section delivery note  

---

*— Section 9.3 · S-ONB-AGENT agent setup and CLI runbook*
