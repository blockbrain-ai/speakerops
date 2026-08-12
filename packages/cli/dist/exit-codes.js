/**
 * Stable CLI exit codes (architecture REPORT-cli-agentic-admin + section 7.2).
 *
 * 0 ok · 1 validation · 2 authz · 3 conflict · 4 network
 */
export const EXIT_OK = 0;
export const EXIT_VALIDATION = 1;
export const EXIT_AUTHZ = 2;
export const EXIT_CONFLICT = 3;
export const EXIT_NETWORK = 4;
/**
 * Map HTTP status + optional E4 code to a stable process exit code.
 * Server remains source of truth for authz/conflict; CLI only maps.
 */
export function exitCodeFromHttp(status, code) {
    if (status >= 200 && status < 300)
        return EXIT_OK;
    if (status === 401 || status === 403)
        return EXIT_AUTHZ;
    if (status === 409 || code === "CONFLICT" || code === "VERSION") {
        return EXIT_CONFLICT;
    }
    if (status === 400 || status === 404 || status === 422) {
        return EXIT_VALIDATION;
    }
    if (status === 0 || status >= 500)
        return EXIT_NETWORK;
    return EXIT_VALIDATION;
}
//# sourceMappingURL=exit-codes.js.map