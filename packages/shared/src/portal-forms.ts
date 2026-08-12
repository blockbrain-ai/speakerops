/**
 * N1 Portal Forms DTOs — post-acceptance data collection (participation-scoped).
 */
import { z } from "zod";

export const PortalFormFieldTypeSchema = z.enum([
  "text",
  "textarea",
  "url",
  "checkbox",
]);
export type PortalFormFieldType = z.infer<typeof PortalFormFieldTypeSchema>;

export const PortalFormFieldSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, "field key must be snake_case"),
  label: z.string().min(1).max(200),
  type: PortalFormFieldTypeSchema,
  required: z.boolean().default(false),
  help: z.string().max(500).optional(),
});
export type PortalFormField = z.infer<typeof PortalFormFieldSchema>;

export const PortalFormStatusSchema = z.enum([
  "draft",
  "published",
  "archived",
]);
export type PortalFormStatus = z.infer<typeof PortalFormStatusSchema>;

export const PortalFormDtoSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable(),
  scope: z.literal("participation"),
  status: PortalFormStatusSchema,
  fields: z.array(PortalFormFieldSchema).max(40),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  version: z.number().int().positive(),
});
export type PortalFormDto = z.infer<typeof PortalFormDtoSchema>;

export const PortalFormListResponseSchema = z.object({
  forms: z.array(PortalFormDtoSchema),
});
export type PortalFormListResponse = z.infer<typeof PortalFormListResponseSchema>;

export const PortalFormCreateBodySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  fields: z.array(PortalFormFieldSchema).max(40).default([]),
});
export type PortalFormCreateBody = z.infer<typeof PortalFormCreateBodySchema>;

export const PortalFormUpdateBodySchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    fields: z.array(PortalFormFieldSchema).max(40).optional(),
    status: PortalFormStatusSchema.optional(),
    expectedVersion: z.number().int().positive(),
  })
  .refine(
    (b) =>
      b.title !== undefined ||
      b.description !== undefined ||
      b.fields !== undefined ||
      b.status !== undefined,
    { message: "At least one field required" },
  );
export type PortalFormUpdateBody = z.infer<typeof PortalFormUpdateBodySchema>;

export const PortalFormResponseDtoSchema = z.object({
  id: z.string().min(1),
  formId: z.string().min(1),
  eventId: z.string().min(1),
  participationId: z.string().min(1),
  answers: z.record(z.string(), z.union([z.string(), z.boolean()])),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  version: z.number().int().positive(),
});
export type PortalFormResponseDto = z.infer<typeof PortalFormResponseDtoSchema>;

export const PortalFormSubmitBodySchema = z.object({
  participationId: z.string().min(1).max(128),
  answers: z.record(z.string(), z.union([z.string(), z.boolean()])),
  expectedVersion: z.number().int().positive().optional(),
});
export type PortalFormSubmitBody = z.infer<typeof PortalFormSubmitBodySchema>;
