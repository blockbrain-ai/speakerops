# SpeakerOps

**Run your conference programme, end to end.**

Call for speakers, review and scoring, speaker onboarding, drag-and-drop scheduling, and a beautiful published programme — one open-source system, no per-seat SaaS bill.

Kill My SaaS, one-document brief, as little human input as we could get away with. The bet was a production-hard product anyway. You be the judge.

## Try it

**Live:** <https://www.speakerops.org> · **Judges:** open [`/judge`](https://www.speakerops.org/judge), pick **admin**, **evaluator**, or **speaker**, and enter — no access code. The role switcher (top of every shell) moves between seats. Sessions last about four hours; the demo is shared and reset periodically.

**Source:** [GitHub](https://github.com/blockbrain-ai/speakerops) is primary. A public mirror lives on [SmolForge](https://forge.smol.ai/blockbrain_labs/speakerops). The live site stays on Cloudflare — not Forge Deploy.

**Developers:** [`/developers`](https://www.speakerops.org/developers) — TypeScript SDK and CLI.

## What it is

CFP → score → accept → portal → comms/calendar → schedule → publish.

| For | What you get |
|-----|----------------|
| **Organisers** | Conditional CFP forms, review queues, rubrics, conflict-safe scheduling, a live readiness dashboard |
| **Speakers** | A warm portal: one next task, bio and slides, calendar invites that update when the schedule moves |
| **Your audience** | Sessions, Speakers, Agenda, Itinerary, and a Speaker Gallery — as pages or embeds |

## CLI and SDK — bring your own agent

The UI is one client. The **supported** CLI verbs and the first-party **TypeScript SDK** call the same Worker commands. An agent that can run a shell and hold a scoped API key can operate those verbs without clicking through the app. The CLI is not exhaustive — scopes are enforced on the Worker.

Build on top of it: project a published programme out to Airtable, Accelevents, or your own CMS. D1 stays the system of record. There are no inbound webhooks.

`@speakerops/sdk` lives in this monorepo. It is **not published to the public npm registry**. The CLI is the same client on the command line:

```bash
pnpm --filter @speakerops/cli build
node packages/cli/dist/main.js events list --json
node packages/cli/dist/main.js reports readiness --event evt_… --json
```

Handbook: [`docs/SDK.md`](./docs/SDK.md) · [`docs/CLI.md`](./docs/CLI.md) · [Learn: CLI and keys](https://learn.speakerops.org/agents/cli-and-keys).

## What it is not

- Sessionboard CRM / marketing / CMS
- An in-product multi-agent fleet (your agent talks to **our** CLI and API)
- Ticketing, travel, badges, payments
- Airtable as the database, or dual-write
- Inbound webhooks

The honest coverage matrix — including Accelevents untested on the hosted demo — is in [`docs/COMPETITION.md`](./docs/COMPETITION.md).

## Run locally

**Requirements:** Node **20–24** (`engines` enforced), pnpm 9.

```bash
pnpm install
pnpm db:migrate && pnpm seed    # local SoR + demo graph
pnpm typecheck && pnpm test:ci  # non-watch gates (E5)
# Optional: pnpm test:e2e · pnpm deploy:dogfood (secrets out-of-band)
```

**Never commit secret values** — env **names** only: [`docs/SECRETS.md`](./docs/SECRETS.md).

**10-minute happy path** (on the live demo or local seed): publish a CFP form (`Admin → CFP/Forms`) → submit it from [`/cfp/dogfood-2026`](https://www.speakerops.org/cfp/dogfood-2026) → assign an evaluator → score it (`/eval`) → accept → speaker portal (`/portal`) → place the session on `Schedule` → download the `.ics` → watch `Overview` readiness update.

## Docs

| You are… | Start |
|----------|--------|
| **Judge / reviewer** | This README · [`docs/COMPETITION.md`](./docs/COMPETITION.md) |
| **Human operator** | [`docs/ONBOARDING.md`](./docs/ONBOARDING.md) |
| **Coding agent** | [`docs/AGENT_SETUP.md`](./docs/AGENT_SETUP.md) · [`docs/CLI.md`](./docs/CLI.md) · [`docs/SDK.md`](./docs/SDK.md) |
| **Maintainer** | [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) · [`docs/OPERATIONS.md`](./docs/OPERATIONS.md) · [constitution](./KMS-competition/initiative/00_CONSTITUTION.md) |

Full handbook index: [`docs/`](./docs/). Offline reports: [`reports/index.html`](./reports/index.html).
