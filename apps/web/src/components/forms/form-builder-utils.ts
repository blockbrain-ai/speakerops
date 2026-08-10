/**
 * Form builder pure helpers (section 3.2).
 * Cycle detection mirrors API Form.UpdateDraftFields (3.1).
 */
import type {
  FormCondition,
  FormFieldConditions,
  FormFieldInput,
  FormFieldOption,
  FormFieldType,
  FormRuleInput,
  FormUpdateDraftBody,
} from "@speakerops/shared";

/** Client-side field row before/after sync (no server id required for draft replace). */
export type BuilderField = {
  /** Stable client id for React keys / selection (not sent to API). */
  clientId: string;
  fieldKey: string;
  type: FormFieldType;
  label: string;
  required: boolean;
  options: FormFieldOption[] | null;
  sortOrder: number;
  conditions: FormFieldConditions | null;
  /** Depth knobs (post-11.9): help copy, placeholder, character cap. */
  helpText?: string | null;
  placeholder?: string | null;
  maxChars?: number | null;
};

export type BuilderRule = {
  clientId: string;
  when: FormCondition;
  routeToCategory: string;
};

/** Palette entries — closed set from FormFieldTypeSchema + label. */
export const FIELD_PALETTE: ReadonlyArray<{
  type: FormFieldType;
  label: string;
  /** data-testid suffix for inventory anchors */
  testId: string;
  /** Default label when adding from palette */
  defaultLabel: string;
  /** Suggested field_key prefix */
  keyPrefix: string;
  needsOptions: boolean;
}> = [
  {
    type: "text",
    label: "Text",
    testId: "palette-text",
    defaultLabel: "Text field",
    keyPrefix: "text",
    needsOptions: false,
  },
  {
    type: "textarea",
    label: "Textarea",
    testId: "palette-textarea",
    defaultLabel: "Long text",
    keyPrefix: "body",
    needsOptions: false,
  },
  {
    type: "select",
    label: "Select",
    testId: "palette-select",
    defaultLabel: "Select field",
    keyPrefix: "select",
    needsOptions: true,
  },
  {
    type: "multiselect",
    label: "Multi-select",
    testId: "palette-multiselect",
    defaultLabel: "Multi-select",
    keyPrefix: "multi",
    needsOptions: true,
  },
  {
    type: "checkbox",
    label: "Checkbox",
    testId: "palette-checkbox",
    defaultLabel: "Checkbox",
    keyPrefix: "check",
    needsOptions: false,
  },
  {
    type: "email",
    label: "Email",
    testId: "palette-email",
    defaultLabel: "Email",
    keyPrefix: "email",
    needsOptions: false,
  },
  {
    type: "number",
    label: "Number",
    testId: "palette-number",
    defaultLabel: "Number",
    keyPrefix: "number",
    needsOptions: false,
  },
  {
    type: "url",
    label: "URL / file link",
    testId: "palette-url",
    defaultLabel: "File or URL",
    keyPrefix: "file_url",
    needsOptions: false,
  },
  {
    type: "file",
    label: "File upload",
    testId: "palette-file",
    defaultLabel: "Supporting file",
    keyPrefix: "file",
    needsOptions: false,
  },
  {
    type: "date",
    label: "Date",
    testId: "palette-date",
    defaultLabel: "Date",
    keyPrefix: "date",
    needsOptions: false,
  },
  {
    type: "text",
    label: "Speaker name",
    testId: "palette-speaker",
    defaultLabel: "Speaker name",
    keyPrefix: "speaker_name",
    needsOptions: false,
  },
] as const;

export function slugifyFieldKey(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+/g, "_")
    .replace(/_$/, "")
    .slice(0, 64);
  return s.length > 0 ? s : "field";
}

/** Allocate unique field_key among existing keys. */
export function uniqueFieldKey(
  prefix: string,
  existing: Iterable<string>,
): string {
  const used = new Set(existing);
  const base = slugifyFieldKey(prefix);
  if (!used.has(base)) return base;
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${base}_${i}`.slice(0, 64);
    if (!used.has(candidate)) return candidate;
  }
  return `${base}_${Date.now()}`.slice(0, 64);
}

export function defaultOptionsForType(
  type: FormFieldType,
): FormFieldOption[] | null {
  if (type === "select" || type === "multiselect") {
    return [
      { value: "option_a", label: "Option A" },
      { value: "option_b", label: "Option B" },
    ];
  }
  return null;
}

/**
 * Detect circular showWhen chains (A depends on B, B depends on A, …).
 * Mirrors apps/api Form.UpdateDraftFields validateConditionKeys.
 */
export function hasCircularConditions(fields: BuilderField[]): boolean {
  const edges = new Map<string, string>();
  for (const f of fields) {
    const dep = f.conditions?.showWhen?.fieldKey;
    if (dep) edges.set(f.fieldKey, dep);
  }
  for (const start of edges.keys()) {
    const seen = new Set<string>();
    let cur: string | undefined = start;
    while (cur && edges.has(cur)) {
      if (seen.has(cur)) return true;
      seen.add(cur);
      cur = edges.get(cur);
    }
  }
  return false;
}

/** Select/multiselect without options cannot be published or saved. */
export function fieldsMissingOptions(fields: BuilderField[]): string[] {
  return fields
    .filter(
      (f) =>
        (f.type === "select" || f.type === "multiselect") &&
        (!f.options || f.options.length === 0),
    )
    .map((f) => f.fieldKey);
}

/** Condition field_key must exist in the field set. */
export function invalidConditionRefs(fields: BuilderField[]): string[] {
  const keys = new Set(fields.map((f) => f.fieldKey));
  const bad: string[] = [];
  for (const f of fields) {
    const ref = f.conditions?.showWhen?.fieldKey;
    if (ref && !keys.has(ref)) bad.push(f.fieldKey);
  }
  return bad;
}

export function invalidRuleRefs(
  fields: BuilderField[],
  rules: BuilderRule[],
): number[] {
  const keys = new Set(fields.map((f) => f.fieldKey));
  const bad: number[] = [];
  rules.forEach((r, i) => {
    if (!keys.has(r.when.fieldKey)) bad.push(i);
  });
  return bad;
}

export type PublishBlockReason =
  | "no_fields"
  | "circular_conditions"
  | "missing_options"
  | "invalid_condition_ref"
  | "invalid_rule_ref"
  | "duplicate_keys"
  | "no_form";

/**
 * Publish disabled when any invariant is violated.
 * Empty field list is the primary empty-state invariant (AC).
 */
export function publishBlockReasons(input: {
  formId: string | null;
  fields: BuilderField[];
  rules: BuilderRule[];
}): PublishBlockReason[] {
  const reasons: PublishBlockReason[] = [];
  if (!input.formId) reasons.push("no_form");
  if (input.fields.length === 0) reasons.push("no_fields");
  if (hasCircularConditions(input.fields)) reasons.push("circular_conditions");
  if (fieldsMissingOptions(input.fields).length > 0)
    reasons.push("missing_options");
  if (invalidConditionRefs(input.fields).length > 0)
    reasons.push("invalid_condition_ref");
  if (invalidRuleRefs(input.fields, input.rules).length > 0)
    reasons.push("invalid_rule_ref");
  const keys = input.fields.map((f) => f.fieldKey);
  if (new Set(keys).size !== keys.length) reasons.push("duplicate_keys");
  return reasons;
}

export function canPublish(input: {
  formId: string | null;
  fields: BuilderField[];
  rules: BuilderRule[];
}): boolean {
  return publishBlockReasons(input).length === 0;
}

/** Parse a positive-int knob input ("" → null). */
function parsePositiveInt(raw: string): number | null {
  const t = raw.trim();
  if (t.length === 0) return null;
  const n = Number(t);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function toDraftBody(input: {
  fields: BuilderField[];
  rules: BuilderRule[];
  welcomeMd: string;
  thankYouMd: string;
  opensAt: string;
  closesAt: string;
  submissionLimit: string;
  /** Speaker bounds knob values as raw strings ("" keeps server default). */
  minSpeakers?: string;
  maxSpeakers?: string;
}): FormUpdateDraftBody {
  const fields: FormFieldInput[] = input.fields.map((f, index) => ({
    fieldKey: f.fieldKey,
    type: f.type,
    label: f.label,
    required: f.required,
    options: f.options,
    sortOrder: f.sortOrder ?? index,
    conditions: f.conditions,
    helpText: f.helpText?.trim() ? f.helpText.trim() : null,
    placeholder: f.placeholder?.trim() ? f.placeholder.trim() : null,
    maxChars:
      f.maxChars != null && (f.type === "text" || f.type === "textarea")
        ? f.maxChars
        : null,
  }));
  const rules: FormRuleInput[] = input.rules.map((r) => ({
    when: r.when,
    routeToCategory: r.routeToCategory,
  }));
  const submissionLimit = parsePositiveInt(input.submissionLimit);
  return {
    fields,
    rules,
    welcomeMd: input.welcomeMd.trim() ? input.welcomeMd : null,
    thankYouMd: input.thankYouMd.trim() ? input.thankYouMd : null,
    opensAt: input.opensAt.trim() ? input.opensAt.trim() : null,
    closesAt: input.closesAt.trim() ? input.closesAt.trim() : null,
    submissionLimit,
    minSpeakers: parsePositiveInt(input.minSpeakers ?? ""),
    maxSpeakers: parsePositiveInt(input.maxSpeakers ?? ""),
  };
}

/**
 * Whether a field should show in live preview given current preview answers.
 * Recursive dependency walk with cycle guard (hidden if cycle).
 */
export function isFieldVisibleInPreview(
  field: BuilderField,
  fields: BuilderField[],
  answers: Record<string, string>,
  visiting: Set<string> = new Set(),
): boolean {
  const showWhen = field.conditions?.showWhen;
  if (!showWhen) return true;
  if (visiting.has(field.fieldKey)) return false;
  visiting.add(field.fieldKey);

  const dep = fields.find((f) => f.fieldKey === showWhen.fieldKey);
  if (dep && !isFieldVisibleInPreview(dep, fields, answers, visiting)) {
    return false;
  }

  const raw = answers[showWhen.fieldKey] ?? "";
  const op = showWhen.op ?? "eq";
  const expected = showWhen.value;
  if (op === "eq") {
    return raw === String(expected);
  }
  if (op === "neq") {
    return raw !== String(expected);
  }
  if (op === "in") {
    const list = Array.isArray(expected) ? expected : [String(expected)];
    return list.includes(raw);
  }
  return true;
}

export function publicCfpPath(slug: string): string {
  return `/cfp/${encodeURIComponent(slug)}`;
}

export function publicCfpAbsoluteUrl(origin: string, slug: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}${publicCfpPath(slug)}`;
}

export function newClientId(): string {
  return `c_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

export function reorderFields(
  fields: BuilderField[],
  fromIndex: number,
  toIndex: number,
): BuilderField[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= fields.length ||
    toIndex >= fields.length ||
    fromIndex === toIndex
  ) {
    return fields;
  }
  const next = [...fields];
  const [item] = next.splice(fromIndex, 1);
  if (!item) return fields;
  next.splice(toIndex, 0, item);
  return next.map((f, i) => ({ ...f, sortOrder: i }));
}
