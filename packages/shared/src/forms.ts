import { z } from "zod";

/**
 * Form builder DTOs (section 3.1).
 * Commands: Form.Create / Form.UpdateDraftFields / Form.Publish / Form.GetPublic
 * HTTP: COMMANDS.md CFP map
 *
 * field_key is stable across draft edits and published versions (I16 → submission_answers).
 */

/** Stable field key: starts with letter, then alnum/underscore. */
export const FieldKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "field_key must be snake_case starting with a letter",
  );
export type FieldKey = z.infer<typeof FieldKeySchema>;

/** Closed field type set (no freeform widgets). */
export const FormFieldTypeSchema = z.enum([
  "text",
  "textarea",
  "select",
  "multiselect",
  "checkbox",
  "number",
  "email",
  "url",
  "date",
]);
export type FormFieldType = z.infer<typeof FormFieldTypeSchema>;

export const FormStatusSchema = z.enum(["draft", "published"]);
export type FormStatus = z.infer<typeof FormStatusSchema>;

/** Condition op for show/hide and category routing. */
export const FormConditionOpSchema = z.enum(["eq", "neq", "in"]);
export type FormConditionOp = z.infer<typeof FormConditionOpSchema>;

/**
 * Condition referencing another field by stable field_key.
 * Used in form_fields.conditions_json and form_rules.when_json.
 */
export const FormConditionSchema = z.object({
  fieldKey: FieldKeySchema,
  op: FormConditionOpSchema.default("eq"),
  value: z.union([z.string(), z.array(z.string()).min(1)]),
});
export type FormCondition = z.infer<typeof FormConditionSchema>;

/** Optional show-when wrapper for field conditions_json. */
export const FormFieldConditionsSchema = z
  .object({
    showWhen: FormConditionSchema.optional(),
  })
  .strict();
export type FormFieldConditions = z.infer<typeof FormFieldConditionsSchema>;

export const FormFieldOptionSchema = z.object({
  value: z.string().min(1).max(128),
  label: z.string().min(1).max(256),
});
export type FormFieldOption = z.infer<typeof FormFieldOptionSchema>;

/** Field input for Form.UpdateDraftFields. */
export const FormFieldInputSchema = z.object({
  fieldKey: FieldKeySchema,
  type: FormFieldTypeSchema,
  label: z.string().min(1).max(256),
  required: z.boolean().default(false),
  options: z.array(FormFieldOptionSchema).max(100).optional().nullable(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  conditions: FormFieldConditionsSchema.optional().nullable(),
});
export type FormFieldInput = z.infer<typeof FormFieldInputSchema>;

/** Category routing rule input. */
export const FormRuleInputSchema = z.object({
  when: FormConditionSchema,
  routeToCategory: z.string().min(1).max(128),
});
export type FormRuleInput = z.infer<typeof FormRuleInputSchema>;

/** Form shell DTO. */
export const FormSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  name: z.string().min(1),
  status: FormStatusSchema,
  createdAt: z.string().min(1),
});
export type FormDto = z.infer<typeof FormSchema>;

/** Field DTO (response). */
export const FormFieldSchema = z.object({
  id: z.string().min(1),
  fieldKey: FieldKeySchema,
  type: FormFieldTypeSchema,
  label: z.string().min(1),
  required: z.boolean(),
  options: z.array(FormFieldOptionSchema).nullable(),
  sortOrder: z.number().int(),
  conditions: FormFieldConditionsSchema.nullable(),
});
export type FormFieldDto = z.infer<typeof FormFieldSchema>;

/** Rule DTO (response). */
export const FormRuleSchema = z.object({
  id: z.string().min(1),
  when: FormConditionSchema,
  routeToCategory: z.string().min(1),
});
export type FormRuleDto = z.infer<typeof FormRuleSchema>;

/**
 * Published snapshot payload stored in form_versions.snapshot_json.
 * Frozen at publish; draft updates must not mutate this JSON.
 */
export const FormSnapshotSchema = z.object({
  welcomeMd: z.string().nullable(),
  thankYouMd: z.string().nullable(),
  opensAt: z.string().nullable(),
  closesAt: z.string().nullable(),
  submissionLimit: z.number().int().positive().nullable(),
  fields: z.array(FormFieldSchema),
  rules: z.array(FormRuleSchema),
});
export type FormSnapshot = z.infer<typeof FormSnapshotSchema>;

/** Form version DTO (draft or published). */
export const FormVersionSchema = z.object({
  id: z.string().min(1),
  formId: z.string().min(1),
  versionNum: z.number().int().min(0),
  welcomeMd: z.string().nullable(),
  thankYouMd: z.string().nullable(),
  opensAt: z.string().nullable(),
  closesAt: z.string().nullable(),
  submissionLimit: z.number().int().positive().nullable(),
  publishedAt: z.string().nullable(),
  /** Present on published versions; null on draft. */
  snapshotJson: FormSnapshotSchema.nullable(),
  fields: z.array(FormFieldSchema),
  rules: z.array(FormRuleSchema),
  immutable: z.boolean(),
});
export type FormVersionDto = z.infer<typeof FormVersionSchema>;

/** Form.Create body — POST /api/events/:eventId/forms */
export const FormCreateBodySchema = z.object({
  name: z.string().min(1).max(200),
});
export type FormCreateBody = z.infer<typeof FormCreateBodySchema>;

/** Form.Create response */
export const FormCreateResponseSchema = z.object({
  form: FormSchema,
  draft: FormVersionSchema,
});
export type FormCreateResponse = z.infer<typeof FormCreateResponseSchema>;

/** Form.UpdateDraftFields body — PUT /api/forms/:formId/draft */
export const FormUpdateDraftBodySchema = z.object({
  fields: z.array(FormFieldInputSchema).max(200),
  rules: z.array(FormRuleInputSchema).max(100).default([]),
  welcomeMd: z.string().max(50_000).optional().nullable(),
  thankYouMd: z.string().max(50_000).optional().nullable(),
  /** ISO-8601 timestamps (window open/close); validated as non-empty strings when set. */
  opensAt: z.string().min(1).max(64).optional().nullable(),
  closesAt: z.string().min(1).max(64).optional().nullable(),
  submissionLimit: z.number().int().positive().max(1_000_000).optional().nullable(),
});
export type FormUpdateDraftBody = z.infer<typeof FormUpdateDraftBodySchema>;

/** Form.UpdateDraftFields response */
export const FormUpdateDraftResponseSchema = z.object({
  formVersion: FormVersionSchema,
});
export type FormUpdateDraftResponse = z.infer<typeof FormUpdateDraftResponseSchema>;

/** Form.Publish body — optional empty object */
export const FormPublishBodySchema = z
  .object({})
  .passthrough()
  .optional()
  .default({});
export type FormPublishBody = z.infer<typeof FormPublishBodySchema>;

/** Form.Publish response */
export const FormPublishResponseSchema = z.object({
  formVersion: FormVersionSchema,
  form: FormSchema,
});
export type FormPublishResponse = z.infer<typeof FormPublishResponseSchema>;

/**
 * Form.GetPublic response — GET /api/public/cfp/:slug
 * Published form only (never draft). Design tokens optional until Design.Publish.
 */
export const PublicCfpResponseSchema = z.object({
  eventId: z.string().min(1),
  slug: z.string().min(1),
  form: FormSchema.nullable(),
  formVersion: FormVersionSchema.nullable(),
});
export type PublicCfpResponse = z.infer<typeof PublicCfpResponseSchema>;

/** Draft version_num sentinel (never published). */
export const FORM_DRAFT_VERSION_NUM = 0 as const;
