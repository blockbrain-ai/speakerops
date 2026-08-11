#!/usr/bin/env node
/**
 * CLI composition root — `speakerops` bin (section 7.2 / S-CLI).
 *
 * Same domain commands as HTTP (COMMANDS.md). Scopes enforced on Worker (E8).
 * Exit codes: 0 ok · 1 validation · 2 authz · 3 conflict · 4 network.
 *
 * Inventory: CLI01–CLI12 in contracts/CLI_INVENTORY.md · docs/CLI.md
 */
import {
  cmdCommsDraft,
  cmdCommsSend,
  cmdDesignGet,
  cmdDesignPublish,
  cmdDesignSet,
  cmdEventsList,
  cmdEvalExport,
  cmdEvalRollup,
  cmdFilesUpload,
  cmdFormsCreate,
  cmdFormsDraft,
  cmdFormsGet,
  cmdFormsList,
  cmdFormsPublish,
  cmdKeysCreate,
  cmdOpenApi,
  cmdReportsReadiness,
  cmdSchedulePlace,
  cmdSpeakersUpdateProfile,
  cmdSubmissionsAssign,
  cmdSubmissionsBulkDecision,
  cmdSubmissionsDecision,
  cmdSubmissionsGet,
  cmdSubmissionsList,
  parseArgs,
  resolveClient,
  setClientFactoryForTests,
  type CommandContext,
} from "./commands.js";
import {
  EXIT_OK,
  EXIT_VALIDATION,
  type CliExitCode,
} from "./exit-codes.js";
import { defaultIo, emitError, type Io } from "./output.js";

export { setClientFactoryForTests };
export {
  EXIT_OK,
  EXIT_VALIDATION,
  EXIT_AUTHZ,
  EXIT_CONFLICT,
  EXIT_NETWORK,
  exitCodeFromHttp,
} from "./exit-codes.js";
export { ApiClient, resolveApiKey, resolveBaseUrl } from "./http.js";

export const CLI_VERSION = "0.1.0";

export function cliVersion(): string {
  return CLI_VERSION;
}

const HELP = `speakerops — scoped CLI over domain commands (S-CLI)

Usage:
  speakerops <resource> <verb> [options]

Auth (env names only in docs; values never committed):
  SPEAKEROPS_API_KEY   Bearer secret (spk_…)
  SPEAKEROPS_API_URL   API base (default http://127.0.0.1:8787)

Global flags:
  --json, -j           Machine-readable JSON on stdout
  --api-key <secret>   Override SPEAKEROPS_API_KEY
  --api-url <url>      Override SPEAKEROPS_API_URL
  --help, -h           Show help
  --version, -V        Print version

Commands (CLI_INVENTORY.md):
  events list [--json]                                    CLI01  events:read
  reports readiness --event E [--json]                    CLI02  reports:read
  design get --event E [--json]                           CLI03  design:read
  design set --event E --brand '#7BA88B'                  CLI04  design:write
  design publish --event E                                CLI05  design:write
  schedule place --event E --session S --room R \\
                 --start ISO --end ISO                    CLI06  schedule:write
  files upload --event E --file PATH [--purpose logo]     CLI08  files:write
                 [--participation ID] [--bind-profile]    headshot + Speakers.UpdateProfile
  speakers update-profile --event E --participation ID \\
                 [--bio T] [--company C] [--title T] \\
                 [--headshot-file-id F] [--expected-version N]  speakers:write
  comms draft --template T [--preview] [--json]           CLI09  comms:draft
  comms send --preview-id P [--idempotency-key K]         CLI10  comms:send
  keys create --name N --scopes s1,s2                     CLI11  keys:admin
  openapi [--json]                                        CLI12  GET /openapi.json

  forms list --event E                                    cfp:read
  forms get --form F                                      cfp:read
  forms create --event E --name N                         cfp:write
  forms draft --form F --fields '[...]'                   cfp:write
  forms publish --form F                                  cfp:write
  submissions list --event E [--status S] [--q Q]         submissions:read
  submissions get --submission S                          submissions:read
  submissions assign --submission S --users u1,u2         submissions:write
  submissions decision --submission S --decision accept|reject|waitlist
                                                          decisions:write
  submissions bulk-decision --event E --decision D --ids a,b
                                                          decisions:write
  eval rollup --event E [--sort score_desc]               submissions:read
  eval export --event E [--sort score_desc]               submissions:read

Exit codes: 0 ok · 1 validation · 2 authz · 3 conflict · 4 network

See docs/CLI.md and GET /openapi.json for full contract.
`;

export type MainOptions = {
  io?: Io;
  /** Injected for tests (Hono app.request bridge). */
  clientFactory?: Parameters<typeof setClientFactoryForTests>[0];
  readFileImpl?: CommandContext["readFileImpl"];
};

/**
 * Run CLI. Returns process exit code (does not call process.exit when imported).
 */
export async function main(
  argv: string[] = process.argv.slice(2),
  options: MainOptions = {},
): Promise<number> {
  const io = options.io ?? defaultIo();

  if (options.clientFactory) {
    setClientFactoryForTests(options.clientFactory);
  }

  try {
    if (argv.includes("--help") || argv.includes("-h") || argv[0] === "help") {
      io.writeOut(HELP);
      return EXIT_OK;
    }
    if (argv.includes("--version") || argv.includes("-V") || argv[0] === "version") {
      io.writeOut(`${cliVersion()}\n`);
      return EXIT_OK;
    }

    const resource = argv[0];
    const verb = argv[1];
    const rest = argv.slice(resource && verb ? 2 : resource ? 1 : 0);
    // For single-token commands like `openapi`, rest is argv.slice(1)
    const restForParse =
      resource === "openapi" || resource === "help" || resource === "version"
        ? argv.slice(1)
        : rest;

    const args = parseArgs(
      resource && verb && resource !== "openapi"
        ? rest
        : resource === "openapi"
          ? restForParse
          : argv,
    );
    // Global --json may appear before resource
    const json =
      args.flags.has("json") ||
      argv.includes("--json") ||
      argv.includes("-j");

    if (!resource) {
      io.writeOut(HELP);
      return EXIT_OK;
    }

    const client = resolveClient(
      parseArgs(argv), // include global --api-key from full argv
    );

    const ctx: CommandContext = {
      argv,
      args: parseArgs(
        resource === "openapi"
          ? argv.slice(1)
          : verb
            ? argv.slice(2)
            : argv.slice(1),
      ),
      json,
      io,
      client,
      readFileImpl: options.readFileImpl,
    };

    const code = await dispatch(resource, verb, ctx);
    return code;
  } finally {
    if (options.clientFactory) {
      setClientFactoryForTests(null);
    }
  }
}

async function dispatch(
  resource: string,
  verb: string | undefined,
  ctx: CommandContext,
): Promise<CliExitCode> {
  switch (resource) {
    case "events":
      if (verb === "list") return cmdEventsList(ctx);
      break;
    case "reports":
      if (verb === "readiness") return cmdReportsReadiness(ctx);
      break;
    case "design":
      if (verb === "get") return cmdDesignGet(ctx);
      if (verb === "set") return cmdDesignSet(ctx);
      if (verb === "publish") return cmdDesignPublish(ctx);
      break;
    case "schedule":
      if (verb === "place") return cmdSchedulePlace(ctx);
      break;
    case "files":
      if (verb === "upload") return cmdFilesUpload(ctx);
      break;
    case "speakers":
      if (
        verb === "update-profile" ||
        verb === "update" ||
        verb === "profile"
      ) {
        return cmdSpeakersUpdateProfile(ctx);
      }
      break;
    case "comms":
      if (verb === "draft" || verb === "preview") return cmdCommsDraft(ctx);
      if (verb === "send") return cmdCommsSend(ctx);
      break;
    case "keys":
      if (verb === "create") return cmdKeysCreate(ctx);
      break;
    case "forms":
      if (verb === "list") return cmdFormsList(ctx);
      if (verb === "get") return cmdFormsGet(ctx);
      if (verb === "create") return cmdFormsCreate(ctx);
      if (verb === "draft") return cmdFormsDraft(ctx);
      if (verb === "publish") return cmdFormsPublish(ctx);
      break;
    case "submissions":
      if (verb === "list") return cmdSubmissionsList(ctx);
      if (verb === "get") return cmdSubmissionsGet(ctx);
      if (verb === "assign") return cmdSubmissionsAssign(ctx);
      if (verb === "decision") return cmdSubmissionsDecision(ctx);
      if (verb === "bulk-decision" || verb === "bulk") {
        return cmdSubmissionsBulkDecision(ctx);
      }
      break;
    case "eval":
      if (verb === "rollup") return cmdEvalRollup(ctx);
      if (verb === "export") return cmdEvalExport(ctx);
      break;
    case "openapi":
      return cmdOpenApi(ctx);
    default:
      break;
  }

  return emitError(
    ctx.io,
    `Unknown command: ${resource}${verb ? ` ${verb}` : ""}. See --help or docs/CLI.md`,
    "VALIDATION_ERROR",
    EXIT_VALIDATION,
    ctx.json,
  );
}

// Run when executed as bin entry (not when imported by tests).
const isDirect =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("main.js") || process.argv[1].endsWith("main.ts"));

if (isDirect) {
  main().then((code) => {
    process.exitCode = code;
  });
}
