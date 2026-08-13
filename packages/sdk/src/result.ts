import { EXIT_VALIDATION, type CliExitCode } from "./exit-codes.js";
import type { HttpResult } from "./http.js";

export type Parseable<T> = {
  safeParse: (
    data: unknown,
  ) => { success: true; data: T } | { success: false };
};

export type SdkResult<T> = {
  status: number;
  body: T;
  headers: Headers;
  exitCode: CliExitCode;
  ok: boolean;
};

export function asResult<T>(
  result: HttpResult,
  schema?: Parseable<T>,
): SdkResult<T> {
  if (!result.ok || !schema) return result as SdkResult<T>;
  const parsed = schema.safeParse(result.body);
  if (!parsed.success) {
    return {
      status: 0,
      body: {
        error: "Unexpected response",
        code: "VALIDATION_ERROR",
      } as T,
      headers: result.headers,
      exitCode: EXIT_VALIDATION,
      ok: false,
    };
  }
  return { ...result, body: parsed.data };
}
