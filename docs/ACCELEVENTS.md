# Accelevents one-way projector

> **Honest residual:** this dogfood estate has **no API key**. Live HTTP against [developer.accelevents.com](https://developer.accelevents.com) has **not** been executed. Sandbox + contract tests cover mapping, 4068906 email match, pause-when-unset, and outbox drain. Do not claim “syncing to Accelevents” on the hosted demo.

## Shape

- D1 remains the system of record. Accelevents is a **one-way** projector (same law as Airtable).
- Auth: header `Key` only (`ACCELEVENTS_API_KEY` Worker secret). Never typed into the SPA. Never stored in D1.
- Connection metadata (event URL slug + numeric event id + enabled) lives in `integration_connections`.
- External ids live in `accelevents_identities`, scoped by `connection_generation`. Changing the external event increments generation so old ids are never PUT into the wrong event.

## Request path (E7)

`GET /api/events/:eventId/integrations`, `PUT …/accelevents`, and `POST …/verify` **do not** call Accelevents. Verify enqueues `accelevents.verify`. Programme publish enqueues `accelevents.project` only when the connection is enabled **and** a key is present.

Queue/cron drain performs HTTP.

## Projection

Source is the **published programme snapshot**:

1. Speakers (email required; skip if missing).
2. Sessions with `startsAt` + `endsAt`. Unscheduled sessions are not created.
3. Sessions present in a previous identity map but missing from a later snapshot are `HIDDEN`.

Times are formatted `yyyy/MM/dd HH:mm` in the **event timezone**. `sessionTypeFormat` defaults to `IN_PERSON`.

Duplicate speaker email (`4068906`) → list speakers, adopt the single exact normalized-email match, fail closed if zero or many.

Timeout after create is fail-closed (no blind retry create). Next drain lists first.

## Modes

| Mode | When | Live HTTP | Can set `verified` |
|------|------|-----------|--------------------|
| `paused` | key unset | no | no |
| `sandbox` | tests | no | no |
| `http` | key present | yes | yes, after a successful ping |

Worker construction **does not throw** when the key is missing.

## UI

Settings → Integrations (`/admin/settings/integrations`). `/admin/settings/airtable` is the same page (O06 Airtable testids preserved).

## Secret name

`ACCELEVENTS_API_KEY` — `wrangler secret put ACCELEVENTS_API_KEY`. There is **no** silent `ACCELEVENTS_EVENT_URL` env fallback.

Live ping (not part of CI): `scripts/accelevents-live-ping.sh` exits **30** when the key is unset.
