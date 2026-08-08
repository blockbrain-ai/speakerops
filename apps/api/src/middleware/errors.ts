/**
 * E4 error envelope middleware (section 1.2).
 *
 * - Unknown routes → 404 envelope with machine-readable `code`
 * - Unhandled throws → 500 envelope without stack leakage
 * - correlationId attached for observability (E3)
 *
 * Domain handlers added in later sections must return the same envelope
 * shape via `@speakerops/shared` `errorEnvelope`.
 */
import type { Context, ErrorHandler, NotFoundHandler, MiddlewareHandler } from "hono";
import {
  errorEnvelope,
  INTERNAL_ERROR,
  NOT_FOUND,
  uuidv7,
  type ErrorEnvelope,
} from "@speakerops/shared";

/** Header name for request correlation (propagated to audit/outbox later). */
export const CORRELATION_HEADER = "x-correlation-id";

/**
 * Attach or generate a correlationId for the request.
 * Prefer client-provided id when present; never regenerate mid-chain (E3).
 * Generated ids are UUIDv7 (RFC 9562) at request entry — not UUIDv4.
 */
export const correlationMiddleware: MiddlewareHandler = async (c, next) => {
  const incoming = c.req.header(CORRELATION_HEADER)?.trim();
  const correlationId =
    incoming && incoming.length > 0 ? incoming : uuidv7();
  c.set("correlationId", correlationId);
  c.header(CORRELATION_HEADER, correlationId);
  await next();
};

/** 404 for unregistered routes — COMMANDS.md routes only. */
export const notFoundHandler: NotFoundHandler = (c: Context) => {
  const body: ErrorEnvelope = errorEnvelope("Not found", NOT_FOUND, {
    path: c.req.path,
  });
  return c.json(body, 404);
};

/**
 * Global onError — never leak stack traces or secrets to the client (E4/E10).
 * Logs stay structured server-side; body is envelope-only.
 */
export const onErrorHandler: ErrorHandler = (err, c) => {
  // Structured log placeholder: message only, no stack/secrets to client.
  // Real logger lands with observability sections; void keeps no console in product path.
  void err;
  const body: ErrorEnvelope = errorEnvelope(
    "Unexpected error",
    INTERNAL_ERROR,
  );
  return c.json(body, 500);
};
