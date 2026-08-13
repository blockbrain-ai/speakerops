import { z } from "zod";

export const IntegrationProviderSchema = z.enum(["airtable", "accelevents"]);
export type IntegrationProvider = z.infer<typeof IntegrationProviderSchema>;

export const VerificationStateSchema = z.enum([
  "never",
  "pending",
  "verified",
  "failed",
  "paused",
]);
export type VerificationState = z.infer<typeof VerificationStateSchema>;

/** Outbox topic — queue/cron only (E7). Never drained on the request path. */
export const ACCELEVENTS_VERIFY_TOPIC = "accelevents.verify" as const;
export const ACCELEVENTS_PROJECT_TOPIC = "accelevents.project" as const;

export const IntegrationConnectionSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  provider: IntegrationProviderSchema,
  enabled: z.boolean(),
  eventUrl: z.string().nullable(),
  externalEventId: z.string().nullable(),
  connectionGeneration: z.number().int(),
  verificationState: VerificationStateSchema,
  lastAttemptAt: z.string().nullable(),
  lastVerifiedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  version: z.number().int().positive(),
  credentialPresent: z.boolean(),
  metadataComplete: z.boolean(),
  pausedReason: z.string().nullable(),
});
export type IntegrationConnection = z.infer<typeof IntegrationConnectionSchema>;

export const IntegrationsStatusResponseSchema = z.object({
  connections: z.array(IntegrationConnectionSchema),
});
export type IntegrationsStatusResponse = z.infer<
  typeof IntegrationsStatusResponseSchema
>;

export const SaveAcceleventsBodySchema = z.object({
  eventUrl: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  externalEventId: z.string().min(1).max(32).regex(/^[0-9]+$/),
  enabled: z.boolean(),
  expectedVersion: z.number().int().positive().optional(),
});
export type SaveAcceleventsBody = z.infer<typeof SaveAcceleventsBodySchema>;

export const SaveAcceleventsResponseSchema = z.object({
  connection: IntegrationConnectionSchema,
});

export const VerifyAcceleventsBodySchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
});
export type VerifyAcceleventsBody = z.infer<typeof VerifyAcceleventsBodySchema>;

export const VerifyAcceleventsResponseSchema = z.object({
  queued: z.literal(true),
  connection: IntegrationConnectionSchema,
});

export const AcceleventsOutboxKindSchema = z.enum(["verify", "project"]);
export type AcceleventsOutboxKind = z.infer<typeof AcceleventsOutboxKindSchema>;

export const AcceleventsOutboxPayloadSchema = z.object({
  kind: AcceleventsOutboxKindSchema,
  eventId: z.string().min(1),
  programmeVersion: z.number().int().nonnegative().optional(),
  correlationId: z.string().min(1),
});
export type AcceleventsOutboxPayload = z.infer<
  typeof AcceleventsOutboxPayloadSchema
>;
