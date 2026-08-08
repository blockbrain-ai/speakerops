import { z } from "zod";

/**
 * Shared health DTO (consumed by API in 1.2+ and any client checks).
 * Kept here so FE/API do not diverge on shape.
 */
export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  version: z.string().optional(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const HEALTH_OK = { ok: true as const };
