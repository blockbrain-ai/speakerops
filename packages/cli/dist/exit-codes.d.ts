/**
 * Stable CLI exit codes (architecture REPORT-cli-agentic-admin + section 7.2).
 *
 * 0 ok · 1 validation · 2 authz · 3 conflict · 4 network
 */
export declare const EXIT_OK: 0;
export declare const EXIT_VALIDATION: 1;
export declare const EXIT_AUTHZ: 2;
export declare const EXIT_CONFLICT: 3;
export declare const EXIT_NETWORK: 4;
export type CliExitCode = typeof EXIT_OK | typeof EXIT_VALIDATION | typeof EXIT_AUTHZ | typeof EXIT_CONFLICT | typeof EXIT_NETWORK;
/**
 * Map HTTP status + optional E4 code to a stable process exit code.
 * Server remains source of truth for authz/conflict; CLI only maps.
 */
export declare function exitCodeFromHttp(status: number, code?: string): CliExitCode;
//# sourceMappingURL=exit-codes.d.ts.map