/**
 * Public developer kit (`/developers`) — SDK, CLI, and custom connections.
 *
 * Sage & Honey · PublicChrome · Lumen tokens.
 */
import {
  LEARN_CLI_URL,
  OPENAPI_URL,
  PublicChrome,
} from "../../components/public/PublicChrome.js";

const PATHS = [
  {
    href: "#sdk",
    testId: "developers-path-sdk",
    title: "TypeScript SDK",
    body: "First-party client in the monorepo. Call Worker commands and project a published programme out.",
    tone: "leaf" as const,
    icon: "{ }",
  },
  {
    href: "#cli",
    testId: "developers-path-cli",
    title: "CLI",
    body: "Same client, command line. Each supported verb maps to a Worker command.",
    tone: "honey" as const,
    icon: ">_",
  },
  {
    href: "#connect",
    testId: "developers-path-connect",
    title: "Custom connection",
    body: "Write into SpeakerOps, or project a published programme out. D1 stays the system of record.",
    tone: "clay" as const,
    icon: "⇄",
  },
];

const SDK_SNIPPET = `import { SpeakerOps, unwrap } from "@speakerops/sdk";

const so = new SpeakerOps({
  baseUrl: process.env.SPEAKEROPS_API_URL ?? "https://www.speakerops.org",
  apiKey: process.env.SPEAKEROPS_API_KEY ?? "", // spk_… never commit
});

const events = unwrap(await so.events.list());
const snapshot = await so.programme.projectPublished("your-event-slug");
// snapshot.speakers / snapshot.sessions → push from your own worker/cron`;

const CLI_SNIPPET = `# From the monorepo root (package is private — not on npm)
pnpm --filter @speakerops/cli build
node packages/cli/dist/main.js events list --json
node packages/cli/dist/main.js reports readiness --event evt_… --json
node packages/cli/dist/main.js openapi --json`;

const CURL_SNIPPET = `export SPEAKEROPS_API_URL="https://www.speakerops.org"
export SPEAKEROPS_API_KEY="spk_…"   # never commit

curl -sS -H "Authorization: Bearer $SPEAKEROPS_API_KEY" \\
  -H "Accept: application/json" \\
  "$SPEAKEROPS_API_URL/api/events"

curl -sS "$SPEAKEROPS_API_URL/openapi.json"`;

export function DevelopersPage() {
  return (
    <PublicChrome surface="developers">
      <section className="public-landing__hero" data-testid="developers-hero">
        <p className="public-landing__eyebrow">Developer kit</p>
        <h1 className="public-landing__title">
          Connect your tools to the programme.
        </h1>
        <p className="public-landing__lede">
          SpeakerOps is the system of record. Use the TypeScript SDK or the
          CLI to run Worker commands — or project a published programme out
          to a platform you already run.
        </p>
      </section>

      <section
        className="public-landing__pillars"
        data-testid="developers-paths"
        aria-label="Ways to build"
      >
        {PATHS.map((p) => (
          <a
            key={p.href}
            href={p.href}
            className={`public-landing__pillar public-landing__pillar--${p.tone} public-dev__path`}
            data-testid={p.testId}
          >
            <div className="public-landing__pillar-ic" aria-hidden>
              {p.icon}
            </div>
            <h2 className="public-landing__pillar-title">{p.title}</h2>
            <p className="public-landing__pillar-body">{p.body}</p>
          </a>
        ))}
      </section>

      <section
        id="sdk"
        className="public-dev__section"
        data-testid="developers-sdk"
      >
        <p className="public-landing__eyebrow">SDK</p>
        <h2 className="public-dev__h2">Use the TypeScript client</h2>
        <p className="public-dev__prose">
          <code className="public-dev__inline">@speakerops/sdk</code> is the
          first-party client. It lives in this monorepo and is{" "}
          <strong>not published to the public npm registry</strong>. Build it,
          then import it from the workspace:
        </p>
        <pre className="public-dev__code" data-testid="developers-sdk-install">
          <code>{`pnpm --filter @speakerops/sdk build`}</code>
        </pre>
        <pre className="public-dev__code" data-testid="developers-starter">
          <code>{SDK_SNIPPET}</code>
        </pre>
        <p className="public-dev__prose">
          Methods cover events, programme, speakers, schedule, submissions,
          forms, design, integrations, comms, and team. Escape hatch:{" "}
          <code className="public-dev__inline">so.request(method, path)</code>.
          Full handbook in the repo: <code className="public-dev__inline">docs/SDK.md</code>.
        </p>
      </section>

      <section
        id="http"
        className="public-dev__section"
        data-testid="developers-http"
      >
        <p className="public-landing__eyebrow">HTTP</p>
        <h2 className="public-dev__h2">Or call the API directly</h2>
        <p className="public-dev__prose">
          Authenticate with{" "}
          <code className="public-dev__inline">Authorization: Bearer</code>{" "}
          and a key minted at Admin → Settings → API keys. Scopes are enforced
          on the Worker.{" "}
          <a
            href={OPENAPI_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="developers-openapi"
          >
            GET /openapi.json
          </a>{" "}
          documents the core command surface. It is a <strong>subset</strong>{" "}
          — some later routes are live but not all listed.
        </p>
        <pre className="public-dev__code" data-testid="developers-http-curl">
          <code>{CURL_SNIPPET}</code>
        </pre>
      </section>

      <section
        id="cli"
        className="public-dev__section"
        data-testid="developers-cli"
      >
        <p className="public-landing__eyebrow">CLI</p>
        <h2 className="public-dev__h2">Run the first-party client</h2>
        <p className="public-dev__prose">
          <code className="public-dev__inline">@speakerops/cli</code> is{" "}
          <strong>private</strong> in the monorepo and uses{" "}
          <code className="public-dev__inline">@speakerops/sdk</code> under
          the hood. Each supported verb maps to a Worker command. Env names
          only:{" "}
          <code className="public-dev__inline">SPEAKEROPS_API_KEY</code>,{" "}
          <code className="public-dev__inline">SPEAKEROPS_API_URL</code>.
        </p>
        <pre className="public-dev__code" data-testid="developers-cli-snippet">
          <code>{CLI_SNIPPET}</code>
        </pre>
        <p className="public-dev__prose">
          Exit codes: 0 ok · 1 validation · 2 authz · 3 conflict · 4 network.
          Full handbook:{" "}
          <a
            href={LEARN_CLI_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="developers-cli-learn"
          >
            CLI and keys
          </a>
          .
        </p>
      </section>

      <section
        id="connect"
        className="public-dev__section"
        data-testid="developers-connect"
      >
        <p className="public-landing__eyebrow">Connections</p>
        <h2 className="public-dev__h2">Two directions</h2>
        <div className="public-dev__dirs">
          <article className="public-dev__dir">
            <h3 className="public-dev__h3">Into SpeakerOps</h3>
            <p className="public-dev__prose">
              Write the programme with the SDK, HTTP, or the CLI. D1 stays the
              system of record. Prefer least-privilege keys. Default-deny
              scopes include{" "}
              <code className="public-dev__inline">comms:send</code>,{" "}
              <code className="public-dev__inline">decisions:write</code>, and{" "}
              <code className="public-dev__inline">keys:admin</code>.
            </p>
          </article>
          <article className="public-dev__dir">
            <h3 className="public-dev__h3">Out of SpeakerOps</h3>
            <p className="public-dev__prose">
              Call{" "}
              <code className="public-dev__inline">
                programme.projectPublished(slug)
              </code>{" "}
              and push the snapshot from <em>your</em> worker or cron. Or copy
              the in-repo Airtable / Accelevents outbox projectors. Never call
              third-party HTTP on the SpeakerOps request path. Never dual-write.
            </p>
          </article>
        </div>
        <p className="public-dev__prose">
          Public read of a published programme:{" "}
          <code className="public-dev__inline">
            GET /api/public/programme/:slug
          </code>
          . Operators enable built-in projectors at Admin → Settings →
          Integrations (sign in required — this page does not deep-link the
          admin shell).
        </p>
      </section>

      <aside
        className="public-dev__honesty"
        data-testid="developers-honesty"
      >
        <h2 className="public-dev__h2">Honest limits</h2>
        <ul className="public-dev__list">
          <li>
            <code className="public-dev__inline">@speakerops/sdk</code> is
            the first-party TypeScript SDK. It is{" "}
            <strong>not published to the public npm registry</strong>.
          </li>
          <li>
            There are <strong>no inbound webhooks</strong>. SpeakerOps does not
            accept provider callbacks.
          </li>
          <li>
            <strong>OpenAPI is a subset</strong> of the live Worker. Generate a
            client if you want; do not assume every route is listed.
          </li>
          <li>
            Built-in Accelevents projection is implemented but{" "}
            <strong>untested without a live API key</strong> on the hosted
            demo.
          </li>
        </ul>
      </aside>
    </PublicChrome>
  );
}

export default DevelopersPage;
