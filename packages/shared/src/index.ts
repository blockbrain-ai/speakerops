/**
 * @speakerops/shared — shared DTOs, Zod schemas, E4 error envelope.
 * Imported by apps/web, apps/api, and packages/cli (no duplicate types).
 */
export {
  ErrorEnvelopeSchema,
  type ErrorEnvelope,
  type ErrorCode,
  errorEnvelope,
  VALIDATION_ERROR,
  UNAUTHORIZED,
  FORBIDDEN,
  NOT_FOUND,
  CONFLICT,
  INTERNAL_ERROR,
} from "./errors.js";

export { HEALTH_OK, type HealthResponse, HealthResponseSchema } from "./health.js";
