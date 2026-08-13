# SpeakerOps TypeScript SDK

First-party client: **`@speakerops/sdk`** (`packages/sdk`).

The package is **private to this monorepo**. It is **not published to the public npm registry**. There is no `npm i @speakerops/sdk`.

Product overview: **`/developers`**. CLI: [`CLI.md`](./CLI.md).

## What it is for

Use it to **read and write the programme** from another system, or to **project a published programme out** (Airtable, Accelevents, your own CMS).

- D1 stays the system of record.
- Scopes are enforced on the Worker.
- There are **no inbound webhooks**.
- Built-in Accelevents projection is implemented but **untested without a live API key** on the hosted demo.

## Install (monorepo)

```bash
pnpm install
pnpm --filter @speakerops/sdk build
```

Then import from the workspace package:

```ts
import { SpeakerOps, unwrap } from "@speakerops/sdk";
```

## Authenticate

Env **names** only — never commit values.

| Name | Purpose |
|------|---------|
| `SPEAKEROPS_API_KEY` | Bearer secret (`spk_…`) |
| `SPEAKEROPS_API_URL` | API base (default `http://127.0.0.1:8787`) |

```ts
const so = new SpeakerOps({
  baseUrl: process.env.SPEAKEROPS_API_URL ?? "https://www.speakerops.org",
  apiKey: process.env.SPEAKEROPS_API_KEY ?? "",
});
```

Public programme reads work with an empty key.

## Call the programme

```ts
const events = unwrap(await so.events.list());
const ready = unwrap(await so.reports.readiness("evt_…"));
const speakers = unwrap(await so.speakers.list("evt_…"));
const schedule = unwrap(await so.schedule.list("evt_…"));

// Public published snapshot — no key required
const programme = unwrap(await so.programme.getPublished("dogfood-2026"));
```

`unwrap` throws `SpeakerOpsError` on non-2xx (status + Worker `code` when present).

## Project to another platform

```ts
const snapshot = await so.programme.projectPublished("dogfood-2026");
// snapshot.speakers / snapshot.sessions — push these from *your* worker/cron
```

Rules for an outbound connection:

1. Trigger from a domain event or a poll of the published snapshot.
2. Never dual-write. Never call the third party on the SpeakerOps request path.
3. Keep an identity map of SpeakerOps ids → external ids.
4. Missing credentials = pause, do not crash.

In-repo projectors: `apps/api/src/modules/airtable/` and `apps/api/src/modules/accelevents/`.

## Surface (supported methods)

| Area | Methods |
|------|---------|
| Events | `events.list`, `events.get` |
| Programme | `programme.getPublished`, `programme.projectPublished`, `programme.status`, `programme.publish` |
| Readiness | `reports.readiness` |
| Speakers | `speakers.list`, `speakers.get`, `speakers.updateProfile` |
| Schedule | `schedule.list`, `schedule.place`, `schedule.move`, `schedule.unschedule` |
| Submissions | `submissions.list`, `submissions.get`, `submissions.assign`, `submissions.decision` |
| Forms | `forms.list`, `forms.get`, `forms.create`, `forms.publish` |
| Design | `design.get`, `design.setDraft`, `design.publish` |
| Integrations | `integrations.status`, `integrations.saveAccelevents`, `integrations.verifyAccelevents` |
| Airtable | `airtable.status` |
| Comms | `comms.templates`, `comms.preview`, `comms.send` |
| Team | `members.list`, `members.invite`, `members.setRole` |
| Keys / files / eval / OpenAPI | `keys.create`, `files.presign`, `files.complete`, `eval.rollup`, `openapi.get` |

Escape hatch: `so.request(method, path, options)` or `so.http`.

The CLI (`@speakerops/cli`) uses this same client. Each supported CLI verb maps to a Worker command — neither the CLI nor the SDK lists every live route. Discover more at `GET /openapi.json` (itself a **subset**).
