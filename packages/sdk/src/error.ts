import type { HttpResult } from "./http.js";

export class SpeakerOpsError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly result: HttpResult;

  constructor(result: HttpResult) {
    const body = result.body;
    const message =
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : `SpeakerOps request failed (${result.status})`;
    const code =
      body &&
      typeof body === "object" &&
      "code" in body &&
      typeof (body as { code: unknown }).code === "string"
        ? (body as { code: string }).code
        : undefined;
    super(code ? `${code}: ${message}` : message);
    this.name = "SpeakerOpsError";
    this.status = result.status;
    this.code = code;
    this.result = result;
  }
}

export function unwrap<T = unknown>(result: HttpResult): T {
  if (!result.ok) throw new SpeakerOpsError(result);
  return result.body as T;
}
