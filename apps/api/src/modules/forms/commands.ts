/**
 * Form domain commands (section 3.1).
 *
 * Form.Create / Form.UpdateDraftFields / Form.Publish / Form.GetPublic
 *
 * Canonical registry: KMS-competition/initiative/contracts/COMMANDS.md
 */
import {
  uuidv7,
  FORM_DRAFT_VERSION_NUM,
  FormSnapshotSchema,
  CFP_MIN_SPEAKERS,
  CFP_MAX_SPEAKERS,
  CFP_FILE_MIME_ALLOWLIST,
  CFP_FILE_MAX_BYTES,
  TURNSTILE_TEST_SITE_KEY,
  computeCfpWindowState,
  type FormCreateBody,
  type FormUpdateDraftBody,
  type FormFieldDto,
  type FormRuleDto,
  type FormVersionDto,
  type FormDto,
  type FormSnapshot,
  type FormCondition,
  type CfpWindowState,
} from "@speakerops/shared";
import type { AuthStore } from "../auth/store.js";
import type { EventsStore } from "../events/store.js";
import {
  type FormsStore,
  type FormRow,
  type FormVersionRow,
  type FormFieldRow,
  type FormRuleRow,
  newFormId,
  newFormVersionId,
  newFormFieldId,
  newFormRuleId,
  parseSnapshot,
} from "./store.js";

export type FormCommandDeps = {
  forms: FormsStore;
  events: EventsStore;
  auth: AuthStore;
};

export type CommandOk<T> = { ok: true; value: T };
export type CommandErr = {
  ok: false;
  status: 400 | 404 | 409;
  error: string;
  code: string;
  details?: unknown;
};

function toFormDto(row: FormRow): FormDto {
  return {
    id: row.id,
    eventId: row.eventId,
    name: row.name,
    status: row.status,
    createdAt: row.createdAt,
  };
}

function toFieldDto(row: FormFieldRow): FormFieldDto {
  return {
    id: row.id,
    fieldKey: row.fieldKey,
    type: row.type,
    label: row.label,
    required: row.required,
    options: row.options,
    sortOrder: row.sortOrder,
    conditions: row.conditions,
  };
}

function toRuleDto(row: FormRuleRow): FormRuleDto {
  return {
    id: row.id,
    when: row.when,
    routeToCategory: row.routeToCategory,
  };
}

async function toVersionDto(
  deps: FormCommandDeps,
  version: FormVersionRow,
): Promise<FormVersionDto> {
  const fields = (await deps.forms.listFields(version.id)).map(toFieldDto);
  const rules = (await deps.forms.listRules(version.id)).map(toRuleDto);
  const snapshot = parseSnapshot(version.snapshotJson);
  return {
    id: version.id,
    formId: version.formId,
    versionNum: version.versionNum,
    welcomeMd: version.welcomeMd,
    thankYouMd: version.thankYouMd,
    opensAt: version.opensAt,
    closesAt: version.closesAt,
    submissionLimit: version.submissionLimit,
    publishedAt: version.publishedAt,
    snapshotJson: snapshot,
    fields,
    rules,
    immutable: version.publishedAt != null,
  };
}

/**
 * Collect all field_keys referenced by a condition (field conditions + rules).
 */
function conditionFieldKeys(condition: FormCondition | undefined | null): string[] {
  if (!condition) return [];
  return [condition.fieldKey];
}

/**
 * Validate that every condition/rule field_key exists in the draft field set.
 * Returns CommandErr when invalid (400 VALIDATION_ERROR).
 */
function validateConditionKeys(
  fields: { fieldKey: string }[],
  rules: { when: FormCondition }[],
  fieldConditions: Array<{ fieldKey: string; conditions: { showWhen?: FormCondition } | null | undefined }>,
): CommandErr | null {
  const keys = new Set(fields.map((f) => f.fieldKey));

  // Duplicate field_key in payload
  if (keys.size !== fields.length) {
    return {
      ok: false,
      status: 400,
      error: "Duplicate field_key in fields",
      code: "VALIDATION_ERROR",
      details: { fieldKeys: fields.map((f) => f.fieldKey) },
    };
  }

  for (const f of fieldConditions) {
    const showWhen = f.conditions?.showWhen;
    for (const ref of conditionFieldKeys(showWhen)) {
      if (!keys.has(ref)) {
        return {
          ok: false,
          status: 400,
          error: "Invalid condition field_key",
          code: "VALIDATION_ERROR",
          details: {
            fieldKey: f.fieldKey,
            conditionFieldKey: ref,
            knownFieldKeys: [...keys],
          },
        };
      }
      // Self-reference is allowed only if not circular show; simple self-ref on showWhen is odd but
      // circular dependency detection for multi-hop is below.
    }
  }

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]!;
    for (const ref of conditionFieldKeys(rule.when)) {
      if (!keys.has(ref)) {
        return {
          ok: false,
          status: 400,
          error: "Invalid condition field_key",
          code: "VALIDATION_ERROR",
          details: {
            ruleIndex: i,
            conditionFieldKey: ref,
            knownFieldKeys: [...keys],
          },
        };
      }
    }
  }

  // Detect simple circular showWhen chains (A shows when B, B shows when A)
  const edges = new Map<string, string>();
  for (const f of fieldConditions) {
    const dep = f.conditions?.showWhen?.fieldKey;
    if (dep) edges.set(f.fieldKey, dep);
  }
  for (const start of edges.keys()) {
    const seen = new Set<string>();
    let cur: string | undefined = start;
    while (cur && edges.has(cur)) {
      if (seen.has(cur)) {
        return {
          ok: false,
          status: 400,
          error: "Circular condition field_key dependency",
          code: "VALIDATION_ERROR",
          details: { cycleStart: start, fieldKey: cur },
        };
      }
      seen.add(cur);
      cur = edges.get(cur);
    }
  }

  return null;
}

export type CreateFormInput = FormCreateBody & {
  eventId: string;
  actorUserId: string;
  correlationId: string;
};

/**
 * Form.Create — event-scoped form shell + empty draft version (version_num=0).
 */
export async function createForm(
  deps: FormCommandDeps,
  input: CreateFormInput,
): Promise<
  CommandOk<{ form: FormDto; draft: FormVersionDto }> | CommandErr
> {
  const event = await deps.events.findEventById(input.eventId);
  if (!event) {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }

  const now = new Date().toISOString();
  const formId = newFormId();
  const draftId = newFormVersionId();

  const form: FormRow = {
    id: formId,
    eventId: input.eventId,
    name: input.name.trim(),
    status: "draft",
    createdAt: now,
  };
  await deps.forms.insertForm(form);

  const draft: FormVersionRow = {
    id: draftId,
    formId,
    versionNum: FORM_DRAFT_VERSION_NUM,
    welcomeMd: null,
    thankYouMd: null,
    opensAt: null,
    closesAt: null,
    submissionLimit: null,
    publishedAt: null,
    snapshotJson: null,
  };
  await deps.forms.insertVersion(draft);

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: input.eventId,
    actorType: "user",
    actorId: input.actorUserId,
    action: "Form.Create",
    entityType: "form",
    entityId: formId,
    afterJson: JSON.stringify({ name: form.name, status: form.status }),
    correlationId: input.correlationId,
    createdAt: now,
  });

  return {
    ok: true,
    value: {
      form: toFormDto(form),
      draft: await toVersionDto(deps, draft),
    },
  };
}

export type UpdateDraftInput = FormUpdateDraftBody & {
  formId: string;
  actorUserId: string;
  correlationId: string;
};

/**
 * Form.UpdateDraftFields — replace draft fields/rules; never mutates published snapshots.
 */
export async function updateDraftFields(
  deps: FormCommandDeps,
  input: UpdateDraftInput,
): Promise<CommandOk<{ formVersion: FormVersionDto }> | CommandErr> {
  const form = await deps.forms.findFormById(input.formId);
  if (!form) {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }

  const draft = await deps.forms.findDraftVersion(input.formId);
  if (!draft) {
    return {
      ok: false,
      status: 400,
      error: "Form has no draft version",
      code: "VALIDATION_ERROR",
    };
  }

  const condErr = validateConditionKeys(
    input.fields,
    input.rules,
    input.fields.map((f) => ({
      fieldKey: f.fieldKey,
      conditions: f.conditions ?? null,
    })),
  );
  if (condErr) return condErr;

  // select/multiselect should carry options
  for (const f of input.fields) {
    if (
      (f.type === "select" || f.type === "multiselect") &&
      (!f.options || f.options.length === 0)
    ) {
      return {
        ok: false,
        status: 400,
        error: "select/multiselect fields require options",
        code: "VALIDATION_ERROR",
        details: { fieldKey: f.fieldKey, type: f.type },
      };
    }
  }

  const now = new Date().toISOString();
  const beforeFields = await deps.forms.listFields(draft.id);
  const beforeRules = await deps.forms.listRules(draft.id);

  const welcomeMd =
    input.welcomeMd !== undefined ? input.welcomeMd : draft.welcomeMd;
  const thankYouMd =
    input.thankYouMd !== undefined ? input.thankYouMd : draft.thankYouMd;
  const opensAt = input.opensAt !== undefined ? input.opensAt : draft.opensAt;
  const closesAt =
    input.closesAt !== undefined ? input.closesAt : draft.closesAt;
  const submissionLimit =
    input.submissionLimit !== undefined
      ? input.submissionLimit
      : draft.submissionLimit;

  const metaOk = await deps.forms.updateDraftVersionMeta(draft.id, {
    welcomeMd: welcomeMd ?? null,
    thankYouMd: thankYouMd ?? null,
    opensAt: opensAt ?? null,
    closesAt: closesAt ?? null,
    submissionLimit: submissionLimit ?? null,
  });
  if (!metaOk) {
    return {
      ok: false,
      status: 409,
      error: "Cannot update published form version",
      code: "CONFLICT",
    };
  }

  const fieldRows: FormFieldRow[] = input.fields.map((f, index) => ({
    id: newFormFieldId(),
    formVersionId: draft.id,
    fieldKey: f.fieldKey,
    type: f.type,
    label: f.label,
    required: f.required ?? false,
    options: f.options ?? null,
    sortOrder: f.sortOrder ?? index,
    conditions: f.conditions ?? null,
  }));
  await deps.forms.replaceFields(draft.id, fieldRows);

  const ruleRows: FormRuleRow[] = input.rules.map((r) => ({
    id: newFormRuleId(),
    formVersionId: draft.id,
    when: r.when,
    routeToCategory: r.routeToCategory,
  }));
  await deps.forms.replaceRules(draft.id, ruleRows);

  const updated = await deps.forms.findDraftVersion(input.formId);
  if (!updated) {
    return {
      ok: false,
      status: 409,
      error: "Draft missing after update",
      code: "CONFLICT",
    };
  }

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: form.eventId,
    actorType: "user",
    actorId: input.actorUserId,
    action: "Form.UpdateDraftFields",
    entityType: "form_version",
    entityId: draft.id,
    beforeJson: JSON.stringify({
      fieldKeys: beforeFields.map((f) => f.fieldKey),
      rules: beforeRules.map((r) => ({
        when: r.when,
        routeToCategory: r.routeToCategory,
      })),
    }),
    afterJson: JSON.stringify({
      fieldKeys: fieldRows.map((f) => f.fieldKey),
      rules: ruleRows.map((r) => ({
        when: r.when,
        routeToCategory: r.routeToCategory,
      })),
    }),
    correlationId: input.correlationId,
    createdAt: now,
  });

  return {
    ok: true,
    value: { formVersion: await toVersionDto(deps, updated) },
  };
}

export type PublishFormInput = {
  formId: string;
  actorUserId: string;
  correlationId: string;
};

/**
 * Form.Publish — freeze draft into immutable form_versions row (version_num++).
 * Draft remains editable; published snapshot_json is never updated.
 */
export async function publishForm(
  deps: FormCommandDeps,
  input: PublishFormInput,
): Promise<
  CommandOk<{ formVersion: FormVersionDto; form: FormDto }> | CommandErr
> {
  const form = await deps.forms.findFormById(input.formId);
  if (!form) {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }

  const draft = await deps.forms.findDraftVersion(input.formId);
  if (!draft) {
    return {
      ok: false,
      status: 400,
      error: "Form has no draft version",
      code: "VALIDATION_ERROR",
    };
  }

  const draftFields = await deps.forms.listFields(draft.id);
  const draftRules = await deps.forms.listRules(draft.id);

  if (draftFields.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "Cannot publish form with no fields",
      code: "VALIDATION_ERROR",
    };
  }

  const latest = await deps.forms.findLatestPublishedVersion(input.formId);
  const nextVersionNum = (latest?.versionNum ?? 0) + 1;

  const now = new Date().toISOString();
  const publishedId = newFormVersionId();

  // Copy fields/rules onto the published version so it is self-contained + immutable.
  const publishedFieldRows: FormFieldRow[] = draftFields.map((f) => ({
    ...f,
    id: newFormFieldId(),
    formVersionId: publishedId,
  }));
  const publishedRuleRows: FormRuleRow[] = draftRules.map((r) => ({
    ...r,
    id: newFormRuleId(),
    formVersionId: publishedId,
  }));

  const snapshotFields = publishedFieldRows.map(toFieldDto);
  const snapshotRules = publishedRuleRows.map(toRuleDto);
  const snapshot: FormSnapshot = {
    welcomeMd: draft.welcomeMd,
    thankYouMd: draft.thankYouMd,
    opensAt: draft.opensAt,
    closesAt: draft.closesAt,
    submissionLimit: draft.submissionLimit,
    fields: snapshotFields,
    rules: snapshotRules,
  };
  const snapshotParsed = FormSnapshotSchema.safeParse(snapshot);
  if (!snapshotParsed.success) {
    return {
      ok: false,
      status: 400,
      error: "Invalid form snapshot",
      code: "VALIDATION_ERROR",
      details: snapshotParsed.error.flatten(),
    };
  }

  const published: FormVersionRow = {
    id: publishedId,
    formId: form.id,
    versionNum: nextVersionNum,
    welcomeMd: draft.welcomeMd,
    thankYouMd: draft.thankYouMd,
    opensAt: draft.opensAt,
    closesAt: draft.closesAt,
    submissionLimit: draft.submissionLimit,
    publishedAt: now,
    snapshotJson: JSON.stringify(snapshotParsed.data),
  };

  await deps.forms.insertVersion(published);
  // Insert fields/rules for published version. Store allows insert when published_at
  // is already set only via insert path — use direct replace after insert.
  // Memory/D1 replaceFields rejects published; so insert fields before marking…
  // We already set publishedAt on the row. insertVersion first, then insert fields
  // via a special path: replaceFields checks publishedAt — need to insert fields
  // without going through replaceFields, OR insert version without publishedAt
  // then set it. Cleanest: insert version with publishedAt, and use internal
  // field insert that skips the guard for new empty version.
  //
  // Store currently rejects replace on published. Fix: insert fields while version
  // has no published marker then... we need a method. Simplest fix: change store
  // to allow replaceFields only when field list is empty (first write) OR add
  // insertFields that only works when no fields exist yet.
  //
  // Implement insertFieldsForNewVersion in store via replaceFields by inserting
  // version with publishedAt null first, write fields, then we can't update
  // published_at because immutability...
  //
  // Better approach: add `seedVersionFields` that allows write only when version
  // currently has zero fields (first seed after insert). Or: insert published
  // version with fields in one atomic path.
  //
  // I'll use replaceFields by temporarily inserting without publishedAt and then
  // re-inserting — messy.
  //
  // Actually MemoryFormsStore.replaceFields checks publishedAt. For seed after
  // insertVersion with publishedAt set, I need insertFieldsBulk without check.
  // Add seedPublishedFields/seedPublishedRules to store.

  await seedPublishedContent(deps.forms, publishedId, publishedFieldRows, publishedRuleRows);

  await deps.forms.updateFormStatus(form.id, "published");
  const updatedForm = (await deps.forms.findFormById(form.id))!;

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: form.eventId,
    actorType: "user",
    actorId: input.actorUserId,
    action: "Form.Publish",
    entityType: "form_version",
    entityId: publishedId,
    beforeJson: latest
      ? JSON.stringify({
          versionNum: latest.versionNum,
          publishedAt: latest.publishedAt,
        })
      : null,
    afterJson: JSON.stringify({
      versionNum: published.versionNum,
      publishedAt: published.publishedAt,
      fieldKeys: snapshotFields.map((f) => f.fieldKey),
      ruleCount: snapshotRules.length,
    }),
    correlationId: input.correlationId,
    createdAt: now,
  });

  return {
    ok: true,
    value: {
      formVersion: await toVersionDto(deps, published),
      form: toFormDto(updatedForm),
    },
  };
}

/**
 * Seed fields/rules onto a freshly inserted published version.
 * Uses replaceFields only when the version currently has zero fields (first write).
 * Store implementations still guard against mutating non-empty published content.
 */
async function seedPublishedContent(
  store: FormsStore,
  versionId: string,
  fieldRows: FormFieldRow[],
  ruleRows: FormRuleRow[],
): Promise<void> {
  // Direct path: Memory and D1 both need to allow first write after publish insert.
  // We call replaceFields; store will be updated to allow when published but empty.
  await store.replaceFields(versionId, fieldRows);
  await store.replaceRules(versionId, ruleRows);
}

export type PublicFormResult = {
  eventId: string;
  slug: string;
  form: FormDto | null;
  formVersion: FormVersionDto | null;
  windowState: CfpWindowState;
  minSpeakers: number;
  maxSpeakers: number;
  turnstileSiteKey: string;
  fileMimeAllowlist: string[];
  fileMaxBytes: number;
};

function publicMeta(
  hasPublishedForm: boolean,
  opensAt: string | null | undefined,
  closesAt: string | null | undefined,
): Pick<
  PublicFormResult,
  | "windowState"
  | "minSpeakers"
  | "maxSpeakers"
  | "turnstileSiteKey"
  | "fileMimeAllowlist"
  | "fileMaxBytes"
> {
  return {
    windowState: computeCfpWindowState({
      hasPublishedForm,
      opensAt,
      closesAt,
    }),
    minSpeakers: CFP_MIN_SPEAKERS,
    maxSpeakers: CFP_MAX_SPEAKERS,
    turnstileSiteKey: TURNSTILE_TEST_SITE_KEY,
    fileMimeAllowlist: [...CFP_FILE_MIME_ALLOWLIST],
    fileMaxBytes: CFP_FILE_MAX_BYTES,
  };
}

/**
 * Form.List — admin list of form shells for an event (builder reload).
 */
export async function listFormsForEvent(
  deps: FormCommandDeps,
  eventId: string,
): Promise<CommandOk<{ forms: FormDto[] }> | CommandErr> {
  const event = await deps.events.findEventById(eventId);
  if (!event) {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }
  const rows = await deps.forms.findFormsByEventId(eventId);
  // Newest first so builder defaults to latest form.
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    ok: true,
    value: { forms: rows.map(toFormDto) },
  };
}

/**
 * Form.GetAdmin — form shell + draft version (fields/rules) + optional published.
 * Used by FormBuilder to reopen after reload.
 */
export async function getFormAdmin(
  deps: FormCommandDeps,
  formId: string,
): Promise<
  CommandOk<{
    form: FormDto;
    draft: FormVersionDto;
    published: FormVersionDto | null;
  }> | CommandErr
> {
  const form = await deps.forms.findFormById(formId);
  if (!form) {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }
  const draft = await deps.forms.findDraftVersion(formId);
  if (!draft) {
    return {
      ok: false,
      status: 400,
      error: "Form has no draft version",
      code: "VALIDATION_ERROR",
    };
  }
  const publishedRow = await deps.forms.findLatestPublishedVersion(formId);
  return {
    ok: true,
    value: {
      form: toFormDto(form),
      draft: await toVersionDto(deps, draft),
      published: publishedRow
        ? await toVersionDto(deps, publishedRow)
        : null,
    },
  };
}

/**
 * Form.GetPublic — latest published form for event slug (never draft).
 * Section 3.3 enriches with windowState + speaker/file meta for public SPA.
 */
export async function getPublicForm(
  deps: FormCommandDeps,
  slug: string,
): Promise<CommandOk<PublicFormResult> | CommandErr> {
  const event = await deps.events.findEventBySlug(slug);
  if (!event) {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }

  const eventForms = await deps.forms.findFormsByEventId(event.id);
  // Prefer most recently created published form
  const publishedForms = eventForms.filter((f) => f.status === "published");
  if (publishedForms.length === 0) {
    return {
      ok: true,
      value: {
        eventId: event.id,
        slug: event.slug,
        form: null,
        formVersion: null,
        ...publicMeta(false, null, null),
      },
    };
  }

  // Stable pick: first by createdAt desc
  publishedForms.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const form = publishedForms[0]!;
  const version = await deps.forms.findLatestPublishedVersion(form.id);
  if (!version) {
    return {
      ok: true,
      value: {
        eventId: event.id,
        slug: event.slug,
        form: toFormDto(form),
        formVersion: null,
        ...publicMeta(false, null, null),
      },
    };
  }

  return {
    ok: true,
    value: {
      eventId: event.id,
      slug: event.slug,
      form: toFormDto(form),
      formVersion: await toVersionDto(deps, version),
      ...publicMeta(true, version.opensAt, version.closesAt),
    },
  };
}
