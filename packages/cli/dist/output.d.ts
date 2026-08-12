/**
 * CLI output helpers — --json machine shape vs human lines.
 */
import type { ApiResult } from "./http.js";
import type { CliExitCode } from "./exit-codes.js";
export type Io = {
    writeOut: (s: string) => void;
    writeErr: (s: string) => void;
};
export declare function defaultIo(): Io;
/** Print success or E4 error body. Always JSON when json=true. */
export declare function emitResult(io: Io, result: ApiResult, json: boolean, humanOk?: (body: unknown) => string): CliExitCode;
export declare function emitJson(io: Io, value: unknown, exit: CliExitCode): CliExitCode;
export declare function emitError(io: Io, message: string, code: string, exit: CliExitCode, json: boolean): CliExitCode;
//# sourceMappingURL=output.d.ts.map