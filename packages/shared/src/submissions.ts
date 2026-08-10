import { z } from "zod";
import { FieldKeySchema, FormFieldSchema, FormRuleSchema } from "./forms.js";

/**
 * Public CFP submission DTOs (section 3.3).
 * Commands: Submission.Create (public) — COMMANDS.md
 * HTTP: POST /api/public/cfp/:slug/submissions
 *        POST /api/public/cfp/:slug/files
 */

/** Submission lifecycle status (SCHEMA.md). */
export const SubmissionStatusSchema = z.enum([
  "draft",
  "submitted",
  "in_review",
  "accepted",
  "rejected",
  "waitlist",
  "withdrawn",
]);
export type SubmissionStatus = z.infer<typeof SubmissionStatusSchema>;

/**
 * Statuses eligible for evaluator assignment (section 10.5 + S-EVAL).
 * Incomplete public drafts must never enter the scoring queue.
 */
export const SUBMISSION_EVAL_ELIGIBLE_STATUSES = [
  "submitted",
  "in_review",
] as const satisfies readonly SubmissionStatus[];

/**
 * Valid source statuses for Decision.Record / bulk preview.
 * Drafts are incomplete CFP rows — accept must not materialize sessions/tasks.
 * Terminal withdrawn is not a decision source; re-decision among
 * accepted/rejected/waitlist remains allowed.
 */
export const SUBMISSION_DECISION_SOURCE_STATUSES = [
  "submitted",
  "in_review",
  "accepted",
  "rejected",
  "waitlist",
] as const satisfies readonly SubmissionStatus[];

export function isSubmissionEvalEligible(status: string): boolean {
  return (SUBMISSION_EVAL_ELIGIBLE_STATUSES as readonly string[]).includes(
    status,
  );
}

export function isSubmissionDecisionSource(status: string): boolean {
  return (SUBMISSION_DECISION_SOURCE_STATUSES as readonly string[]).includes(
    status,
  );
}

/** Default multi-speaker bounds on public CFP (A04). Per-version knob (D14)
 * may override within CFP_SPEAKERS_HARD_MIN..CFP_SPEAKERS_HARD_MAX. */
export const CFP_MIN_SPEAKERS = 1 as const;
export const CFP_MAX_SPEAKERS = 5 as const;
/** Hard envelope for the configurable per-form speaker bounds (1–15). */
export const CFP_SPEAKERS_HARD_MIN = 1 as const;
export const CFP_SPEAKERS_HARD_MAX = 15 as const;

/**
 * Cloudflare Turnstile test keys (docs — not secrets).
 * Always-pass secret: 1x0000…AA · Always-fail secret: 2x0000…AA
 * Site key always-pass: 1x00000000000000000000AA
 */
export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA" as const;
export const TURNSTILE_TEST_SECRET_PASS =
  "1x0000000000000000000000000000000AA" as const;
export const TURNSTILE_TEST_SECRET_FAIL =
  "2x0000000000000000000000000000000AA" as const;
/** Dev/e2e token that passes when secret is unset or always-pass test key. */
export const TURNSTILE_DEV_PASS_TOKEN = "XXXX.DUMMY.TOKEN" as const;
/** Explicit fail token for negative tests (local verify path). */
export const TURNSTILE_DEV_FAIL_TOKEN = "XXXX.FAIL.TOKEN" as const;

/** Rate limit for public Submission.Create (per IP). */
export const CFP_RATE_LIMIT_MAX = 20 as const;
export const CFP_RATE_LIMIT_WINDOW_MS = 60_000 as const;

/** CFP supporting-file allowlist (A05) — no SVG/HTML/JS. */
export const CFP_FILE_MIME_ALLOWLIST = [
  "application/pdf",
  "image/png",
  "image/jpeg",
] as const;
export type CfpFileMime = (typeof CFP_FILE_MIME_ALLOWLIST)[number];

/** Max supporting file size on public CFP (5 MiB). */
export const CFP_FILE_MAX_BYTES = 5 * 1024 * 1024;

/** Window state derived from form_version opens_at/closes_at. */
export const CfpWindowStateSchema = z.enum([
  "open",
  "closed",
  "not_yet_open",
  "no_form",
]);
export type CfpWindowState = z.infer<typeof CfpWindowStateSchema>;

/** Speaker block on Submission.Create. */
export const SubmissionSpeakerInputSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(320),
  isPrimary: z.boolean().optional(),
});
export type SubmissionSpeakerInput = z.infer<
  typeof SubmissionSpeakerInputSchema
>;

/** One answer keyed by stable field_key (I16). */
export const SubmissionAnswerInputSchema = z.object({
  fieldKey: FieldKeySchema,
  /** JSON-serializable value; strings for text/select; arrays for multiselect. */
  value: z.unknown(),
});
export type SubmissionAnswerInput = z.infer<typeof SubmissionAnswerInputSchema>;

/**
 * Submission.Create body — POST /api/public/cfp/:slug/submissions
 */
export const SubmissionCreateBodySchema = z.object({
  /** Must match the published form_version for this event (immutable pin). */
  formVersionId: z.string().min(1),
  title: z.string().min(1).max(500),
  answers: z.array(SubmissionAnswerInputSchema).max(200).default([]),
  /** Hard envelope only — the pinned form version's min/max speakers is
   * enforced server-side in Submission.Create (configurable 1–15). */
  speakers: z
    .array(SubmissionSpeakerInputSchema)
    .min(CFP_SPEAKERS_HARD_MIN)
    .max(CFP_SPEAKERS_HARD_MAX),
  /** Turnstile response token (required). */
  turnstileToken: z.string().min(1).max(4096),
  /**
   * Optional client-observed category; server re-derives from form_rules
   * and rejects when client sends a conflicting non-empty value.
   */
  category: z.string().min(1).max(128).optional().nullable(),
});
export type SubmissionCreateBody = z.infer<typeof SubmissionCreateBodySchema>;

export const SubmissionSpeakerDtoSchema = z.object({
  personId: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  isPrimary: z.boolean(),
  sortOrder: z.number().int(),
});
export type SubmissionSpeakerDto = z.infer<typeof SubmissionSpeakerDtoSchema>;

export const SubmissionAnswerDtoSchema = z.object({
  fieldKey: FieldKeySchema,
  value: z.unknown(),
  /**
   * Human label from the pinned form version when available.
   * Clients must not show raw fieldKey as the primary heading when label is set.
   */
  label: z.string().min(1).max(256).optional(),
});
export type SubmissionAnswerDto = z.infer<typeof SubmissionAnswerDtoSchema>;

export const SubmissionSchema = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  formVersionId: z.string().min(1),
  title: z.string().min(1),
  category: z.string().nullable(),
  status: SubmissionStatusSchema,
  submittedAt: z.string().min(1),
  version: z.number().int().positive(),
});
export type SubmissionDto = z.infer<typeof SubmissionSchema>;

/** Submission.Create response */
export const SubmissionCreateResponseSchema = z.object({
  submission: SubmissionSchema,
  answers: z.array(SubmissionAnswerDtoSchema),
  speakers: z.array(SubmissionSpeakerDtoSchema),
  /** Thank-you copy from pinned form version (text, never HTML-exec). */
  thankYouMd: z.string().nullable(),
});
export type SubmissionCreateResponse = z.infer<
  typeof SubmissionCreateResponseSchema
>;

/**
 * Submission.SaveDraft body — POST /api/public/cfp/:slug/drafts (section 10.5).
 * Title-only is valid; speakers/answers optional; no Turnstile; no required-field gate.
 */
export const SubmissionSaveDraftBodySchema = z.object({
  /** Must match the published form_version for this event (immutable pin). */
  formVersionId: z.string().min(1),
  /** Minimal required field for a draft (empty title rejected). */
  title: z.string().min(1).max(500),
  answers: z.array(SubmissionAnswerInputSchema).max(200).default([]),
  /** Optional speakers; empty allowed on draft (unlike full submit). */
  speakers: z
    .array(SubmissionSpeakerInputSchema)
    .max(CFP_SPEAKERS_HARD_MAX)
    .default([]),
  /**
   * When set, update an existing draft (status must remain draft).
   * Omitted → create a new draft row.
   */
  draftId: z.string().min(1).optional(),
  category: z.string().min(1).max(128).optional().nullable(),
});
export type SubmissionSaveDraftBody = z.infer<
  typeof SubmissionSaveDraftBodySchema
>;

/**
 * Form-field snapshot returned on save/resume (field_key → value, speakers).
 * Keys align with published form_fields (form_versions-compatible).
 */
export const SubmissionDraftSnapshotSchema = z.object({
  title: z.string().min(1),
  answers: z.array(SubmissionAnswerDtoSchema),
  speakers: z.array(
    z.object({
      name: z.string(),
      email: z.string(),
      isPrimary: z.boolean(),
      sortOrder: z.number().int(),
      personId: z.string().optional(),
    }),
  ),
  category: z.string().nullable(),
});
export type SubmissionDraftSnapshot = z.infer<
  typeof SubmissionDraftSnapshotSchema
>;

/** Submission.SaveDraft response */
export const SubmissionSaveDraftResponseSchema = z.object({
  submission: SubmissionSchema,
  /** Snapshot of form fields for resume (roundtrip with GetDraft). */
  snapshot: SubmissionDraftSnapshotSchema,
});
export type SubmissionSaveDraftResponse = z.infer<
  typeof SubmissionSaveDraftResponseSchema
>;

/** Submission.GetDraft response — GET /api/public/cfp/:slug/drafts/:draftId */
export const SubmissionGetDraftResponseSchema = z.object({
  submission: SubmissionSchema,
  snapshot: SubmissionDraftSnapshotSchema,
});
export type SubmissionGetDraftResponse = z.infer<
  typeof SubmissionGetDraftResponseSchema
>;

/**
 * Public CFP supporting file upload — POST /api/public/cfp/:slug/files
 * JSON body with base64 content for local/e2e; mime allowlist enforced.
 */
export const CfpFileUploadBodySchema = z.object({
  filename: z.string().min(1).max(255),
  mime: z.string().min(1).max(128),
  /** Declared size; must match decoded content length. */
  size: z.number().int().positive().max(CFP_FILE_MAX_BYTES),
  /** Base64-encoded file bytes (no data: prefix). */
  contentBase64: z.string().min(1).max(Math.ceil((CFP_FILE_MAX_BYTES * 4) / 3) + 64),
});
export type CfpFileUploadBody = z.infer<typeof CfpFileUploadBodySchema>;

export const CfpFileUploadResponseSchema = z.object({
  fileId: z.string().min(1),
  mime: z.string().min(1),
  size: z.number().int().positive(),
  filename: z.string().min(1),
});
export type CfpFileUploadResponse = z.infer<typeof CfpFileUploadResponseSchema>;

/**
 * Extended Form.GetPublic fields used by public SPA (window + speaker bounds).
 * Additive on PublicCfpResponseSchema via intersection in consumers.
 */
export const PublicCfpMetaSchema = z.object({
  windowState: CfpWindowStateSchema,
  minSpeakers: z.number().int().positive(),
  maxSpeakers: z.number().int().positive(),
  turnstileSiteKey: z.string().min(1),
  fileMimeAllowlist: z.array(z.string()),
  fileMaxBytes: z.number().int().positive(),
});
export type PublicCfpMeta = z.infer<typeof PublicCfpMetaSchema>;

/** Helper: evaluate form condition against answer map (server + client). */
export function evaluateFormCondition(
  op: "eq" | "neq" | "in" | undefined,
  expected: string | string[],
  raw: unknown,
): boolean {
  const value =
    raw == null
      ? ""
      : Array.isArray(raw)
        ? raw.map(String).join(",")
        : String(raw);
  const resolvedOp = op ?? "eq";
  if (resolvedOp === "eq") {
    return value === String(expected);
  }
  if (resolvedOp === "neq") {
    return value !== String(expected);
  }
  if (resolvedOp === "in") {
    const list = Array.isArray(expected) ? expected.map(String) : [String(expected)];
    return list.includes(value);
  }
  return true;
}

/**
 * Derive category from form_rules given answers (first matching rule wins).
 */
export function deriveCategoryFromRules(
  rules: Array<{ when: { fieldKey: string; op?: "eq" | "neq" | "in"; value: string | string[] }; routeToCategory: string }>,
  answers: Record<string, unknown>,
): string | null {
  for (const rule of rules) {
    const raw = answers[rule.when.fieldKey];
    if (evaluateFormCondition(rule.when.op, rule.when.value, raw)) {
      return rule.routeToCategory;
    }
  }
  return null;
}

/**
 * Whether a field is visible given showWhen conditions (cycle-safe).
 */
export function isFieldVisible(
  field: {
    fieldKey: string;
    conditions?: { showWhen?: { fieldKey: string; op?: "eq" | "neq" | "in"; value: string | string[] } } | null;
  },
  fields: Array<{
    fieldKey: string;
    conditions?: { showWhen?: { fieldKey: string; op?: "eq" | "neq" | "in"; value: string | string[] } } | null;
  }>,
  answers: Record<string, unknown>,
  visiting: Set<string> = new Set(),
): boolean {
  const showWhen = field.conditions?.showWhen;
  if (!showWhen) return true;
  if (visiting.has(field.fieldKey)) return false;
  visiting.add(field.fieldKey);

  const dep = fields.find((f) => f.fieldKey === showWhen.fieldKey);
  if (dep && !isFieldVisible(dep, fields, answers, visiting)) {
    return false;
  }

  return evaluateFormCondition(showWhen.op, showWhen.value, answers[showWhen.fieldKey]);
}

/**
 * Compute CFP window state from published version timestamps.
 */
export function computeCfpWindowState(input: {
  hasPublishedForm: boolean;
  opensAt: string | null | undefined;
  closesAt: string | null | undefined;
  nowMs?: number;
}): CfpWindowState {
  if (!input.hasPublishedForm) return "no_form";
  const now = input.nowMs ?? Date.now();
  if (input.opensAt) {
    const openMs = Date.parse(input.opensAt);
    if (Number.isFinite(openMs) && now < openMs) return "not_yet_open";
  }
  if (input.closesAt) {
    const closeMs = Date.parse(input.closesAt);
    if (Number.isFinite(closeMs) && now > closeMs) return "closed";
  }
  return "open";
}

// Re-export field/rule shapes for public consumers that only import submissions.
export { FormFieldSchema, FormRuleSchema };
