/**
 * CLI output helpers — --json machine shape vs human lines.
 */
import type { ApiResult } from "./http.js";
import type { CliExitCode } from "./exit-codes.js";

export type Io = {
  writeOut: (s: string) => void;
  writeErr: (s: string) => void;
};

export function defaultIo(): Io {
  return {
    writeOut: (s) => {
      process.stdout.write(s);
    },
    writeErr: (s) => {
      process.stderr.write(s);
    },
  };
}

/** Print success or E4 error body. Always JSON when json=true. */
export function emitResult(
  io: Io,
  result: ApiResult,
  json: boolean,
  humanOk?: (body: unknown) => string,
): CliExitCode {
  if (json) {
    io.writeOut(`${JSON.stringify(result.body, null, 0)}\n`);
    return result.exitCode;
  }
  if (!result.ok) {
    const msg =
      result.body &&
      typeof result.body === "object" &&
      "error" in result.body &&
      typeof (result.body as { error: unknown }).error === "string"
        ? (result.body as { error: string }).error
        : `Request failed (${result.status})`;
    const code =
      result.body &&
      typeof result.body === "object" &&
      "code" in result.body &&
      typeof (result.body as { code: unknown }).code === "string"
        ? (result.body as { code: string }).code
        : undefined;
    io.writeErr(
      code ? `speakerops: ${msg} [${code}]\n` : `speakerops: ${msg}\n`,
    );
    return result.exitCode;
  }
  if (humanOk) {
    io.writeOut(humanOk(result.body));
  } else {
    io.writeOut(`${JSON.stringify(result.body, null, 2)}\n`);
  }
  return result.exitCode;
}

export function emitJson(io: Io, value: unknown, exit: CliExitCode): CliExitCode {
  io.writeOut(`${JSON.stringify(value)}\n`);
  return exit;
}

export function emitError(
  io: Io,
  message: string,
  code: string,
  exit: CliExitCode,
  json: boolean,
): CliExitCode {
  if (json) {
    io.writeOut(JSON.stringify({ error: message, code }) + "\n");
  } else {
    io.writeErr(`speakerops: ${message} [${code}]\n`);
  }
  return exit;
}
