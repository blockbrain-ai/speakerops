# SpeakerOps TypeScript SDK

First-party client: **`@speakerops/sdk`** (`packages/sdk`).

The package is **private to this monorepo**. It is **not published to the public npm registry**. There is no `npm i @speakerops/sdk`.

Product overview: **`/developers`**. CLI: [`CLI.md`](./CLI.md).

## What it is for

Use it to **read and write the programme** from another system, or to **project a published programme out** (Airtable, Accelevents, your own CMS).

- D1 stays the system of record.
- Scopes are enforced on the Worker.
- There are **no inbound webhooks**.
- The API is **server-side**. There is no `Access-Control-Allow-Origin`. Do not call it from a browser page.
- Built-in Accelevents projection is implemented but **untested without a live API key** on the hosted demo.

## Runtime

Pass `baseUrl` and `apiKey` explicitly if you are not in Node. The client reads `process.env` only when `process` exists — a bare Worker or browser will not throw.

Bearer is attached **only** when the request URL is the same origin as `baseUrl`. Signed upload URLs and other hosts never receive the key.

## Install (monorepo)

```bash
pnpm install
pnpm --filter @speakerops/sdk build
```

Then import from the workspace package:

```ts
import { SpeakerOps, unwrap } from "@speakerops/sdk";

const so = new SpeakerOps({
  baseUrl: "https://www.speakerops.org",
  apiKey: "spk_…", // never commit
});
```

Public programme reads work with an empty key.

## Call the programme

```ts
const events = unwrap(await so.events.list());
const ready = unwrap(await so.reports.readiness("evt_…"));

// Public published snapshot — no key required
const programme = unwrap(await so.programme.getPublished("dogfood-2026"));

// Admin / Bearer events:read
const status = unwrap(await so.programme.status("evt_…"));

// Admin / Bearer events:write
unwrap(await so.programme.publish("evt_…"));
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

`integrations.saveAccelevents` takes **`eventUrl` as the Accelevents event slug** (`^[a-zA-Z0-9_-]+$`), not `https://…`.

## Surface (supported methods)

| Area | Methods | Auth |
|------|---------|------|
| Events | `events.list`, `events.get`, `events.create` | events:read / events:write |
| Programme | `programme.getPublished`, `programme.projectPublished` | public |
| Programme | `programme.status`, `programme.publish` | events:read / events:write |
| Readiness | `reports.readiness` | reports:read |
| Speakers | `speakers.list`, `speakers.get`, `speakers.updateProfile` | speakers:read / write (`expectedVersion` required) |
| Schedule | `schedule.list`, `schedule.place`, `schedule.move`, `schedule.unschedule` | schedule:read / write |
| Submissions | `submissions.list`, `submissions.get`, `submissions.assign`, `submissions.decision` | submissions:* / decisions:write |
| Forms | `forms.list`, `forms.get`, `forms.create`, `forms.updateDraft`, `forms.publish` | cfp:read / write |
| Design | `design.get`, `design.setDraft`, `design.publish` | design:* (`expectedVersion` required on publish) |
| Integrations | `integrations.status`, `integrations.saveAccelevents`, `integrations.verifyAccelevents` | integrations:* |
| Airtable | `airtable.status` | airtable:read |
| Comms | `comms.templates`, `comms.preview`, `comms.send` | comms:draft / send |
| Team | `members.list`, `members.invite`, `members.setRole` | members:write |
| Keys / files / eval / OpenAPI | `keys.list/create/revoke`, `files.presign/upload/complete`, `eval.rollup`, `openapi.get` | keys:admin / files:write |

Escape hatch: `so.request(method, path, options)` or `so.http`. Cross-origin absolute URLs do **not** get the Bearer header.

The CLI (`@speakerops/cli`) uses this same HTTP client (correlation ids `cli_…`). SDK-constructed clients use `sdk_…`. Each supported verb maps to a Worker command — neither lists every live route. Discover more at `GET /openapi.json` (still a **subset**, now including the public programme + publish/status paths).
