import { z } from "zod";

/**
 * E4 canonical API error envelope.
 * `{ error, code, details? }` — machine-readable `code` on every failure path.
 */
export const ErrorEnvelopeSchema = z.object({
  error: z.string(),
  code: z.string(),
  details: z.unknown().optional(),
});

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

/** Common machine-readable codes (extend per command surface, do not invent CRUD). */
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL_ERROR"
  | (string & {});

export const VALIDATION_ERROR = "VALIDATION_ERROR" as const;
export const UNAUTHORIZED = "UNAUTHORIZED" as const;
export const FORBIDDEN = "FORBIDDEN" as const;
export const NOT_FOUND = "NOT_FOUND" as const;
export const CONFLICT = "CONFLICT" as const;
export const INTERNAL_ERROR = "INTERNAL_ERROR" as const;

export function errorEnvelope(
  error: string,
  code: ErrorCode,
  details?: unknown,
): ErrorEnvelope {
  const body: ErrorEnvelope = { error, code };
  if (details !== undefined) {
    body.details = details;
  }
  return body;
}
