# SpeakerOps CLI

Machine-facing admin surface for **S-CLI**. The `speakerops` binary maps **1:1** to domain commands in [`COMMANDS.md`](../KMS-competition/initiative/contracts/COMMANDS.md). Scopes are enforced **server-side** on the Worker — the CLI never elevates itself (E8).

**Inventory (proof IDs):** [`CLI_INVENTORY.md`](../KMS-competition/initiative/contracts/CLI_INVENTORY.md) CLI01–CLI12  
**OpenAPI:** `GET /openapi.json` (local: `http://127.0.0.1:8787/openapi.json`)  
**Package:** `@speakerops/cli` (`packages/cli`)  
**Agent path:** [`AGENT_SETUP.md`](./AGENT_SETUP.md) (**S-ONB-AGENT**) · Section note: [9.3](./sections/9.3-agent-setup.md) · **Docs map:** [README](../README.md) · [9.1 IA](./sections/9.1-docs-ia.md)

> **Section 9.3:** This runbook is the human + agent CLI reference. Agent-first copy-paste prompt, readiness/design walkthrough, and deny-scope narrative live in [AGENT_SETUP.md](./AGENT_SETUP.md).

## Install / run

```bash
# From monorepo root (after pnpm install + build)
pnpm --filter @speakerops/cli build
pnpm exec speakerops --help
# or: node packages/cli/dist/main.js --help
```

## Auth (env **names** only — never commit values)

| Env name | Purpose |
|----------|---------|
| `SPEAKEROPS_API_KEY` | Bearer secret (`spk_…`) minted via admin UI or `keys create` |
| `SPEAKEROPS_API_URL` | API base URL (default `http://127.0.0.1:8787`) |
| `SPEAKEROPS_CORRELATION_ID` | Optional fixed correlation id (else CLI generates `cli_…`) |

Flags: `--api-key`, `--api-url` override env for a single invocation.

Mint keys in **Admin → Settings → API keys** (section 7.1). Prefer least privilege:

| Agent role | Example scopes |
|------------|----------------|
| Reporting | `events:read`, `reports:read` |
| Design | `design:read`, `design:write`, `events:read` |
| Schedule | `schedule:read`, `schedule:write`, `events:read` |
| Comms draft | `comms:draft` (not `comms:send`) |
| Full send / keys | opt-in `comms:send`, `keys:admin` (**default-deny**) |

## Exit codes

| Code | Meaning |
|------|---------|
| **0** | Success |
| **1** | Validation / not found / client config (missing key) |
| **2** | Authz (401/403 — wrong/missing scope) |
| **3** | Conflict (409 CONFLICT/VERSION, e.g. schedule double-book) |
| **4** | Network / 5xx |

## Global flags

```text
--json, -j           JSON on stdout (stable for agents)
--api-key <secret>   Override SPEAKEROPS_API_KEY
--api-url <url>      Override SPEAKEROPS_API_URL
--help, -h
--version, -V
```

## Commands (CLI_INVENTORY)

### CLI01 — `events list`

```bash
speakerops events list --json
```

- **Scope:** `events:read`
- **HTTP:** `GET /api/events` → `Event.List`
- **Assert:** JSON `{ events: [...] }`

### CLI02 — `reports readiness`

```bash
speakerops reports readiness --event <eventId> --json
```

- **Scope:** `reports:read`
- **HTTP:** `GET /api/events/:eventId/readiness` → `Reports.Readiness`
- **Assert:** `{ eventId, stats, outstanding[], generatedAt }` — readiness schema stable

Optional: `--overdue-only` → query `overdueOnly=true`.

### CLI03 — `design get`

```bash
speakerops design get --event <eventId> --json
```

- **Scope:** `design:read` (or `design:write`)
- **HTTP:** `GET /api/events/:eventId/design` → `Design.Get`
- **Assert:** `{ draft, published }`

### CLI04 — `design set`

```bash
speakerops design set --event <eventId> --brand '#4F46E5' [--radius soft|curvy|round]
```

- **Scope:** `design:write`
- **HTTP:** `PUT /api/events/:eventId/design` → `Design.SetDraft`
- Merges `--brand` into current draft (or defaults). No freeform CSS (E6).

### CLI05 — `design publish`

```bash
speakerops design publish --event <eventId>
```

- **Scope:** `design:write`
- **HTTP:** `POST /api/events/:eventId/design/publish` → `Design.Publish`
- Fetches draft version, then publishes. Contrast gate may return **400** `CONTRAST_FAILED` (exit 1).

### CLI06 — `schedule place`

```bash
speakerops schedule place \
  --event <eventId> \
  --session <sessionId> \
  --room <roomId> \
  --start <ISO-8601> \
  --end <ISO-8601>
```

- **Scope:** `schedule:write`
- **HTTP:** `POST /api/events/:eventId/schedule/place` → `Schedule.Place`
- Success **0**; hard conflict **exit 3** with `conflicts[]` in JSON body.

### CLI07 — scope deny (proven)

```bash
# Key with only reports:read + events:read
speakerops schedule place --event E --session S --room R --start … --end … --json
# → exit 2, body { error, code: "FORBIDDEN", details.required: ["schedule:write"] }
```

- **Unit:** `packages/cli/src/cli.test.ts` (CLI07)
- **Phase-7 keystone:** `playwright/e2e/phase7_keystone.spec.ts` spawns CLI against e2e API (section 7.4)

### CLI08 — `files upload`

```bash
speakerops files upload --event <eventId> --file ./logo.png [--purpose logo]
```

- **Scope:** `files:write`
- **HTTP:** `File.PresignUpload` → `File.Upload` → `File.CompleteUpload`
- **Assert:** JSON `{ fileId, uploaded: true, … }`
- Headshot/slides: `--participation <participationId>` (owner binding)

### CLI09 — `comms draft --preview`

```bash
speakerops comms draft --template <templateId> --preview --json
```

- **Scope:** `comms:draft`
- **HTTP:** `POST /api/comms/preview` → `Comms.Preview`
- **Assert:** `{ previewId, recipients[], bodies[], missingFields[] }`

### CLI10 — `comms send` (high-risk)

```bash
speakerops comms send --preview-id <previewId> [--idempotency-key <key>]
```

- **Scope:** `comms:send` (**default-deny** on new keys)
- Without scope → **exit 2**
- **HTTP:** `POST /api/comms/send` (enqueue only; no provider HTTP on request path)

### CLI11 — `keys create` (high-risk)

```bash
speakerops keys create --name "agent" --scopes events:read,reports:read
```

- **Scope:** `keys:admin` (**default-deny**)
- Without scope → **exit 2**
- Secret returned **once** in the create response; list never includes secret.

### CLI12 — OpenAPI

```bash
speakerops openapi --json
# or: curl -s "$SPEAKEROPS_API_URL/openapi.json"
```

- **HTTP:** `GET /openapi.json` (public discovery document)
- **Assert:** paths include `/api/events`, schedule, readiness, design, keys, …

## Agent notes

1. Prefer `--json` for all automation.
2. Treat exit **2** as “wrong key / need broader scope” — not a retry loop without human scope grant.
3. Treat exit **3** as schedule conflict — surface `conflicts[]` to the operator.
4. Never log full API key secrets or magic links (E10).
5. Same audit path as UI: mutations write `audit_events` with `correlationId` (and `key_id` when Bearer).

## Related docs

- [`docs/SECRETS.md`](./SECRETS.md) — env **names** only
- [`docs/governance/0.4-domain-map.md`](./governance/0.4-domain-map.md) — domain map + CLI parity
- [`docs/sections/7.1-api-keys.md`](./sections/7.1-api-keys.md) — key mint/revoke
- [`docs/sections/7.2-cli.md`](./sections/7.2-cli.md) — this section delivery notes
