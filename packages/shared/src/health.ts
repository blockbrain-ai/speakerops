import { z } from "zod";

/**
 * Shared health DTO (API GET /health + any client checks).
 * Shape locked to COMMANDS.md / section 1.2: { ok: true, version: string }.
 */
export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  version: z.string().min(1),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** Partial helper for callers that only need the ok flag before version is known. */
export const HEALTH_OK = { ok: true as const };
