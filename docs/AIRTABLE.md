# Airtable (one-way projection)

> **Soul:** **S-AIRTABLE** / **S-DOCS** · **Owner prose:** section **9.4** · **Implementation:** section **7.3**  
> **IA:** [9.1](./sections/9.1-docs-ia.md) · **Non-goal:** dual-write / Airtable as SoR  
> **Contracts:** [SCHEMA](../KMS-competition/initiative/contracts/SCHEMA.md) · [COMMANDS](../KMS-competition/initiative/contracts/COMMANDS.md) · [SCOPES](../KMS-competition/initiative/contracts/SCOPES.md)

## Purpose

Operator and agent guide for **one-way** projection from **D1** (system of record) → **Airtable** (optional external read model). Covers setup, scopes, lag expectations, pause survival, status API, and what never ships (writes back to D1 from Airtable).

---

## 1. Rules (locked)

| Rule | Detail |
|------|--------|
| Direction | **D1 → Airtable only** (one-way projection) |
| SoR | **D1** always; Airtable is never authoritative |
| Request path | **Never** call Airtable HTTP on user requests (E7) |
| Mechanism | Domain mutation → `outbox_events` topic `airtable.project` → queue/cron consumer upserts |
| Identity | Upsert by **`internal_id`** (I16) into Airtable + `projection_records` |
| Secrets | Env **names** only — `AIRTABLE_*` in [SECRETS.md](./SECRETS.md) |
| Pause | When `AIRTABLE_API_KEY` / `AIRTABLE_BASE_ID` unset: drain **pauses**; product still **200** |
| Dual-write | **Forbidden** — no Airtable → D1, no bidirectional sync |

---

## 2. Why one-way

SpeakerOps keeps conference program integrity in D1: optimistic versions, audit, event-scoped authz, and domain commands. Airtable is a familiar ops mirror for spreadsheets and external workflows. Making Airtable a second SoR would:

- Break optimistic concurrency and audit as single truth  
- Invite dual-write races and “which system won?”  
- Contradict constitution non-goals and [COMPETITION.md](./COMPETITION.md) struck integration patterns  

If Airtable is wrong, **fix D1 and re-drain** — never “fix Airtable and sync back.”

---

## 3. Setup (operators)

### 3.1 Env **names** only

| Name | Required for live drain | Purpose |
|------|-------------------------|---------|
| `AIRTABLE_API_KEY` | yes | PAT / key for projection drain only |
| `AIRTABLE_BASE_ID` | yes | Target base |
| `AIRTABLE_TABLE_SUBMISSIONS` | optional | Override default table name |
| `AIRTABLE_TABLE_SPEAKERS` | optional | Override |
| `AIRTABLE_TABLE_SESSIONS` | optional | Override |
| `AIRTABLE_TABLE_TASKS` | optional | Override |
| `AIRTABLE_TABLE_SCHEDULE` | optional | Override |
| `AIRTABLE_TABLE_EVENTS` | optional | Override |

Default table names (when overrides unset): `SpeakerOps_*` family documented in SECRETS.md.  
**Never commit values.** Use `wrangler secret put AIRTABLE_API_KEY` for dogfood Worker secrets.

### 3.2 Base layout expectations

Airtable tables should accept projected fields including **`internal_id`** (unique identity for upsert). Additional display fields (title, status, event label) are projection payload — not reverse-synced.

### 3.3 Dogfood without Airtable

Unset keys → projection **paused**. Product E2E and dogfood health **do not require** Airtable. Status UI shows configured/paused/lag ([inventory O06](../KMS-competition/initiative/BROWSER_E2E_INVENTORY.md)).

---

## 4. Runtime path

```text
Command (e.g. Event.Update, Decision.Record, …)
        │  D1 transaction
        ├─► domain row write
        └─► outbox_events insert  topic=airtable.project
                    │
                    │  (async) queue / scheduled
                    ▼
           processAirtableOutbox
                    │
         credentials? ──no──► pause (leave processed_at null)
                    │ yes
                    ▼
           Airtable upsert by internal_id
                    │
                    ▼
           projection_records upsert + mark outbox processed
```

Implementation pointers:

| Piece | Path |
|-------|------|
| Module | `apps/api/src/modules/airtable/*` |
| Consumer | `apps/api/src/workers/airtableConsumer.ts` |
| Migration | `projection_records` (`0019_projection_records.sql`) |
| Status API | `GET /api/events/:eventId/airtable/status` → `Reports.AirtableStatus` |
| Admin UI | `/admin/settings/airtable` · `@inv:O06` |
| Section note | [7.3-airtable-projection.md](./sections/7.3-airtable-projection.md) |

---

## 5. Outbox payload (sketch)

Topic `airtable.project` payload shape (illustrative — match code/DTO):

```json
{
  "eventId": "…",
  "entityType": "event|submission|speaker|session|task|schedule",
  "internalId": "…",
  "sourceVersion": 1,
  "fields": { "internal_id": "…", "…": "…" },
  "correlationId": "…"
}
```

`processed_at` stays null until successful drain (or while paused). Rate limits (HTTP 429) leave the row pending with a safe last_error — **no silent drop**.

---

## 6. Authz for status

| Client | Requirement |
|--------|-------------|
| Session admin | Event admin role |
| Bearer | Scope `airtable:read` |
| Unauthenticated | **401** |
| Wrong role / cross-event | **403** or **404** |

Status endpoint is **D1-only** (outbox lag + projection_records) — no Airtable HTTP on the request path.

---

## 7. Lag expectations

| Situation | Expected lag |
|-----------|--------------|
| Credentials set, queue healthy | Seconds to low minutes after mutation |
| Queue backpressure / 429 | Pending rows accumulate; product still 200 |
| Keys unset (pause) | Infinite lag until configure + drain |
| Consumer crash | Rows remain unprocessed; restart drain |

Operators should use **Airtable status** (O06) for lag counters, not assume Airtable UI is real-time.

---

## 8. Pause survival (S-AIRTABLE acceptance)

| Condition | Behavior |
|-----------|----------|
| `AIRTABLE_API_KEY` / `AIRTABLE_BASE_ID` unset | Drain **pauses** (no crash); outbox pending |
| Domain mutation while paused | **200**; inserts `airtable.project` outbox only |
| Resume with credentials | Drain upserts by `internal_id`; marks processed |
| HTTP 429 from Airtable | Row stays unprocessed; retry later |

Proofs: unit/integration in `apps/api/src/modules/airtable/`; keystone [7.4](./sections/7.4-cli-airtable-e2e.md); Playwright `@inv:O06`.

---

## 9. I16 field-flow (projection slice)

| Field | Source | Command path | Storage | Consumer |
|-------|--------|--------------|---------|----------|
| `internal_id` | domain entity id | projector | `projection_records.internal_id` + Airtable field | Airtable upsert key |
| `source_version` | aggregate version | outbox | `projection_records.source_version` | staleness / lag UI |
| entity fields | domain snapshot | outbox `fields` | Airtable columns | external ops |

Full program field flow (forms → portal): [FIELD_FLOW.md](./FIELD_FLOW.md).

---

## 10. Scopes & CLI

| Scope | Use |
|-------|-----|
| `airtable:read` | Status / lag report |
| (none for write-back) | **No** Airtable write-back scope exists by design |

CLI/agent: use OpenAPI + status via HTTP with a scoped key; never inject Airtable keys into the CLI for dual-write experiments. See [AGENT_SETUP.md](./AGENT_SETUP.md).

---

## 11. Troubleshooting projection

| Symptom | Check |
|---------|--------|
| Airtable not updating | Keys set? Drain running? Status lag? |
| Product errors after Airtable outage | Should not — pause path must keep product 200 |
| Duplicate Airtable rows | Missing unique `internal_id`; fix base, re-project |
| Secrets in logs | Rotate; redact; never log `AIRTABLE_API_KEY` value |

More matrix: [TROUBLESHOOTING.md](./TROUBLESHOOTING.md).

---

## 12. Out of scope

- Bidirectional sync / dual-write  
- Request-path Airtable  
- Treating Airtable as SoR for decisions or schedule  
- Live e2e against production Airtable as CI hard gate (dogfood optional)  

## Related

- Architecture: [ARCHITECTURE.md](./ARCHITECTURE.md)  
- Operations: [OPERATIONS.md](./OPERATIONS.md)  
- Competition non-goals: [COMPETITION.md](./COMPETITION.md)  
- SECRETS names: [SECRETS.md](./SECRETS.md)  
- Implementation: [7.3](./sections/7.3-airtable-projection.md)  
