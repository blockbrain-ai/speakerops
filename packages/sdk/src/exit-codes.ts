/**
 * Stable process / client codes shared by the SDK and CLI.
 * 0 ok · 1 validation · 2 authz · 3 conflict · 4 network
 */
export const EXIT_OK = 0 as const;
export const EXIT_VALIDATION = 1 as const;
export const EXIT_AUTHZ = 2 as const;
export const EXIT_CONFLICT = 3 as const;
export const EXIT_NETWORK = 4 as const;

export type CliExitCode =
  | typeof EXIT_OK
  | typeof EXIT_VALIDATION
  | typeof EXIT_AUTHZ
  | typeof EXIT_CONFLICT
  | typeof EXIT_NETWORK;

export function exitCodeFromHttp(
  status: number,
  code?: string,
): CliExitCode {
  if (status >= 200 && status < 300) return EXIT_OK;
  if (status === 401 || status === 403) return EXIT_AUTHZ;
  if (status === 409 || code === "CONFLICT" || code === "VERSION") {
    return EXIT_CONFLICT;
  }
  if (status === 400 || status === 404 || status === 422) {
    return EXIT_VALIDATION;
  }
  if (status === 0 || status >= 500) return EXIT_NETWORK;
  return EXIT_VALIDATION;
}
