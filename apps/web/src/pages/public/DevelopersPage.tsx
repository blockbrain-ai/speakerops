/**
 * Public developer kit (`/developers`) — how to talk to the programme.
 *
 * Not a published npm SDK. HTTP + OpenAPI + monorepo CLI + projector contract.
 * Sage & Honey · PublicChrome · Lumen tokens.
 */
import {
  LEARN_CLI_URL,
  OPENAPI_URL,
  PublicChrome,
} from "../../components/public/PublicChrome.js";

const PATHS = [
  {
    href: "#http",
    testId: "developers-path-http",
    title: "HTTP API",
    body: "Mint a scoped key and call the same Worker commands as the admin UI. OpenAPI is the contract.",
    tone: "leaf" as const,
    icon: "{ }",
  },
  {
    href: "#cli",
    testId: "developers-path-cli",
    title: "CLI",
    body: "The first-party client lives in the monorepo. Each supported verb maps to a Worker command.",
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

const STARTER = `const base = process.env.SPEAKEROPS_API_URL ?? "http://127.0.0.1:8787";
const apiKey = process.env.SPEAKEROPS_API_KEY ?? ""; // spk_… never commit

export async function speakerops(
  method: string,
  path: string,
  body?: unknown,
) {
  const res = await fetch(\`\${base}\${path}\`, {
    method,
    headers: {
      accept: "application/json",
      authorization: \`Bearer \${apiKey}\`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : res.statusText;
    throw new Error(msg);
  }
  return data;
}

// speakerops("GET", "/api/events")
`;

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
          SpeakerOps is the system of record. Use the HTTP API or the CLI to
          run Worker commands — or project a published programme out to a
          system you already run.
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
        id="http"
        className="public-dev__section"
        data-testid="developers-http"
      >
        <p className="public-landing__eyebrow">HTTP</p>
        <h2 className="public-dev__h2">Call the API</h2>
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
        <p className="public-dev__prose">
          Starter transport (copy into your repo). This is not an npm package.
        </p>
        <pre className="public-dev__code" data-testid="developers-starter">
          <code>{STARTER}</code>
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
          <strong>private</strong> in the monorepo — not a global npm install.
          Each supported verb maps to a Worker command. The CLI cannot grant
          itself extra scopes. Env names only:{" "}
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
              Write the programme with HTTP or the CLI. D1 stays the system of
              record. Prefer least-privilege keys. Default-deny scopes include{" "}
              <code className="public-dev__inline">comms:send</code>,{" "}
              <code className="public-dev__inline">decisions:write</code>, and{" "}
              <code className="public-dev__inline">keys:admin</code>.
            </p>
          </article>
          <article className="public-dev__dir">
            <h3 className="public-dev__h3">Out of SpeakerOps</h3>
            <p className="public-dev__prose">
              If another system must reflect the programme, build a{" "}
              <strong>one-way projector</strong>. Enqueue an outbox row from a
              domain event (profile save, schedule place, programme publish)
              and drain it on queue or cron. Never call third-party HTTP on the
              user request path. Never dual-write.
            </p>
          </article>
        </div>
        <p className="public-dev__prose">
          Public read of a published programme:{" "}
          <code className="public-dev__inline">
            GET /api/public/programme/:slug
          </code>
          . In-repo patterns: Airtable and Accelevents under{" "}
          <code className="public-dev__inline">apps/api/src/modules/</code>.
          Operators enable those at Admin → Settings → Integrations (sign in
          required — this page does not deep-link the admin shell).
        </p>
      </section>

      <aside
        className="public-dev__honesty"
        data-testid="developers-honesty"
      >
        <h2 className="public-dev__h2">Honest limits</h2>
        <ul className="public-dev__list">
          <li>
            There is <strong>no npm SDK</strong> and no{" "}
            <code className="public-dev__inline">@speakerops/sdk</code>{" "}
            package. The snippet above is transport only.
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
