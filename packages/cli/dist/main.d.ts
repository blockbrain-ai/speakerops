#!/usr/bin/env node
/**
 * CLI composition root — `speakerops` bin (section 7.2 / S-CLI).
 *
 * Same domain commands as HTTP (COMMANDS.md). Scopes enforced on Worker (E8).
 * Exit codes: 0 ok · 1 validation · 2 authz · 3 conflict · 4 network.
 *
 * Inventory: CLI01–CLI12 in contracts/CLI_INVENTORY.md · docs/CLI.md
 */
import { setClientFactoryForTests, type CommandContext } from "./commands.js";
import { type Io } from "./output.js";
export { setClientFactoryForTests };
export { EXIT_OK, EXIT_VALIDATION, EXIT_AUTHZ, EXIT_CONFLICT, EXIT_NETWORK, exitCodeFromHttp, } from "./exit-codes.js";
export { ApiClient, resolveApiKey, resolveBaseUrl } from "./http.js";
export declare const CLI_VERSION = "0.1.0";
export declare function cliVersion(): string;
export type MainOptions = {
    io?: Io;
    /** Injected for tests (Hono app.request bridge). */
    clientFactory?: Parameters<typeof setClientFactoryForTests>[0];
    readFileImpl?: CommandContext["readFileImpl"];
};
/**
 * Run CLI. Returns process exit code (does not call process.exit when imported).
 */
export declare function main(argv?: string[], options?: MainOptions): Promise<number>;
//# sourceMappingURL=main.d.ts.map