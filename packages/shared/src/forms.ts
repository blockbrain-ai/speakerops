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
  "file",
]);
export type FormFieldType = z.infer<typeof FormFieldTypeSchema>;

/** Field types that accept a character cap (maxChars). */
export const FORM_FIELD_MAX_CHARS_TYPES = [
  "text",
  "textarea",
] as const satisfies readonly FormFieldType[];

export function fieldTypeSupportsMaxChars(type: string): boolean {
  return (FORM_FIELD_MAX_CHARS_TYPES as readonly string[]).includes(type);
}

/** Bounds for the per-field character cap knob. */
export const FORM_FIELD_MAX_CHARS_MIN = 1 as const;
export const FORM_FIELD_MAX_CHARS_MAX = 50_000 as const;

/** Configurable speaker bounds envelope (per form version; 1–15). */
export const CFP_SPEAKERS_BOUND_MIN = 1 as const;
export const CFP_SPEAKERS_BOUND_MAX = 15 as const;

export const FormStatusSchema = z.enum(["draft", "published"]);
export type FormStatus = z.infer<typeof FormStatusSchema>;

/**
 * Node discrimination (Wave 1B): `input` nodes are answerable fields; `layout`
 * nodes (section heading / divider) are pure structure. Layout nodes never
 * participate in answers, required checks, conditional-rule field lookups,
 * submission payloads, or CSV export columns (I16 untouched).
 */
export const FormNodeKindSchema = z.enum(["input", "layout"]);
export type FormNodeKind = z.infer<typeof FormNodeKindSchema>;

export const FormLayoutTypeSchema = z.enum(["section", "divider"]);
export type FormLayoutType = z.infer<typeof FormLayoutTypeSchema>;

/** Max label length for a section layout node (divider labels are ignored). */
export const FORM_SECTION_LABEL_MAX = 255 as const;

/** True when a node is a layout node (section/divider) — omitted kind = input. */
export function isLayoutNode(node: {
  nodeKind?: string | null;
}): boolean {
  return node.nodeKind === "layout";
}

/** True when a node is an answerable input field (pre-0027 rows included). */
export function isInputNode(node: {
  nodeKind?: string | null;
}): boolean {
  return !isLayoutNode(node);
}

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
export const FormFieldInputSchema = z
  .object({
    fieldKey: FieldKeySchema,
    type: FormFieldTypeSchema,
    label: z.string().min(1).max(256),
    required: z.boolean().default(false),
    options: z.array(FormFieldOptionSchema).max(100).optional().nullable(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    conditions: FormFieldConditionsSchema.optional().nullable(),
    /** Guidance rendered under the label on public CFP + preview. */
    helpText: z.string().max(500).optional().nullable(),
    /** Placeholder copy inside the input. */
    placeholder: z.string().max(200).optional().nullable(),
    /** Character cap (text/textarea only; server-enforced on submit). */
    maxChars: z
      .number()
      .int()
      .min(FORM_FIELD_MAX_CHARS_MIN)
      .max(FORM_FIELD_MAX_CHARS_MAX)
      .optional()
      .nullable(),
    /** Node discrimination (Wave 1B). Omitted = input (pre-0027 clients). */
    nodeKind: FormNodeKindSchema.default("input"),
    /** section | divider — required when nodeKind is layout, never on input. */
    layoutType: FormLayoutTypeSchema.optional().nullable(),
  })
  .superRefine((field, ctx) => {
    if (field.nodeKind === "layout") {
      if (field.layoutType == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["layoutType"],
          message: "layout nodes require layoutType (section or divider)",
        });
      }
      if (field.layoutType === "section" && field.label.length > FORM_SECTION_LABEL_MAX) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["label"],
          message: `Section labels are limited to ${FORM_SECTION_LABEL_MAX} characters`,
        });
      }
      // Layout nodes have no answer participation — reject input-only knobs.
      if (field.required) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["required"],
          message: "layout nodes cannot be required",
        });
      }
      if (field.options != null && field.options.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["options"],
          message: "layout nodes do not take options",
        });
      }
      if (field.conditions?.showWhen != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["conditions"],
          message: "layout nodes do not take conditions",
        });
      }
      if (field.maxChars != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["maxChars"],
          message: "layout nodes do not take maxChars",
        });
      }
      return;
    }
    if (field.layoutType != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["layoutType"],
        message: "layoutType is only allowed on layout nodes",
      });
    }
    if (field.maxChars != null && !fieldTypeSupportsMaxChars(field.type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxChars"],
        message: "maxChars is only allowed on text and textarea fields",
      });
    }
    if (
      field.type === "file" &&
      field.options != null &&
      field.options.length > 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: "file fields do not take options",
      });
    }
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

/** Field DTO (response). Depth fields optional for pre-0023 snapshots. */
export const FormFieldSchema = z.object({
  id: z.string().min(1),
  fieldKey: FieldKeySchema,
  type: FormFieldTypeSchema,
  label: z.string().min(1),
  required: z.boolean(),
  options: z.array(FormFieldOptionSchema).nullable(),
  sortOrder: z.number().int(),
  conditions: FormFieldConditionsSchema.nullable(),
  helpText: z.string().max(500).optional().nullable(),
  placeholder: z.string().max(200).optional().nullable(),
  maxChars: z.number().int().positive().optional().nullable(),
  /** Node discrimination (Wave 1B). Pre-0027 snapshots omit → input. */
  nodeKind: FormNodeKindSchema.optional(),
  layoutType: FormLayoutTypeSchema.optional().nullable(),
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
  /** Per-submitter cap frozen at publish (pre-0028 snapshots omit; unlimited). */
  perSubmitterLimit: z.number().int().positive().optional().nullable(),
  /** Speaker bounds frozen at publish (pre-0024 snapshots omit; defaults apply). */
  minSpeakers: z.number().int().positive().optional(),
  maxSpeakers: z.number().int().positive().optional(),
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
  /** Max submitted proposals per primary-speaker email (null = unlimited). */
  perSubmitterLimit: z.number().int().positive().optional().nullable(),
  /** Configurable speaker bounds (1–15; defaults 1/5 pre-knob). */
  minSpeakers: z.number().int().positive().optional(),
  maxSpeakers: z.number().int().positive().optional(),
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
export const FormUpdateDraftBodySchema = z
  .object({
    fields: z.array(FormFieldInputSchema).max(200),
    rules: z.array(FormRuleInputSchema).max(100).default([]),
    welcomeMd: z.string().max(50_000).optional().nullable(),
    thankYouMd: z.string().max(50_000).optional().nullable(),
    /** ISO-8601 timestamps (window open/close); validated as non-empty strings when set. */
    opensAt: z.string().min(1).max(64).optional().nullable(),
    closesAt: z.string().min(1).max(64).optional().nullable(),
    submissionLimit: z.number().int().positive().max(1_000_000).optional().nullable(),
    /** Max submitted proposals per person (primary-speaker email; null = unlimited). */
    perSubmitterLimit: z
      .number()
      .int()
      .positive()
      .max(1_000_000)
      .optional()
      .nullable(),
    /** Speaker bounds knob (1–15). Omitted → keep current draft values. */
    minSpeakers: z
      .number()
      .int()
      .min(CFP_SPEAKERS_BOUND_MIN)
      .max(CFP_SPEAKERS_BOUND_MAX)
      .optional()
      .nullable(),
    maxSpeakers: z
      .number()
      .int()
      .min(CFP_SPEAKERS_BOUND_MIN)
      .max(CFP_SPEAKERS_BOUND_MAX)
      .optional()
      .nullable(),
  })
  .superRefine((body, ctx) => {
    if (
      body.minSpeakers != null &&
      body.maxSpeakers != null &&
      body.minSpeakers > body.maxSpeakers
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minSpeakers"],
        message: "Minimum speakers cannot exceed maximum speakers",
      });
    }
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
 * Section 3.3 adds window/meta for public submit UX (additive, optional for 3.1 tests).
 */
export const PublicCfpResponseSchema = z.object({
  eventId: z.string().min(1),
  slug: z.string().min(1),
  form: FormSchema.nullable(),
  formVersion: FormVersionSchema.nullable(),
  /** CFP open/closed window (3.3). */
  windowState: z
    .enum(["open", "closed", "not_yet_open", "no_form"])
    .optional(),
  minSpeakers: z.number().int().positive().optional(),
  maxSpeakers: z.number().int().positive().optional(),
  turnstileSiteKey: z.string().min(1).optional(),
  fileMimeAllowlist: z.array(z.string()).optional(),
  fileMaxBytes: z.number().int().positive().optional(),
});
export type PublicCfpResponse = z.infer<typeof PublicCfpResponseSchema>;

/**
 * Form.List response — GET /api/events/:eventId/forms (admin).
 * Shell rows only; use Form.GetAdmin for draft fields/rules.
 */
export const FormListResponseSchema = z.object({
  forms: z.array(FormSchema),
});
export type FormListResponse = z.infer<typeof FormListResponseSchema>;

/**
 * Form.GetAdmin response — GET /api/forms/:formId (admin).
 * Draft version always present (fields/rules); optional latest published meta.
 */
export const FormAdminGetResponseSchema = z.object({
  form: FormSchema,
  draft: FormVersionSchema,
  /** Latest published version when form has been published; null otherwise. */
  published: FormVersionSchema.nullable().optional(),
});
export type FormAdminGetResponse = z.infer<typeof FormAdminGetResponseSchema>;

/** Draft version_num sentinel (never published). */
export const FORM_DRAFT_VERSION_NUM = 0 as const;
