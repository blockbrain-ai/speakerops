/**
 * Public CFP domain commands (section 3.3 + 10.5 draft).
 *
 * Submission.Create — public multi-speaker submit with Turnstile, window checks,
 * form_version pin, category routing, file allowlist reference in answers.
 * Submission.SaveDraft / Submission.GetDraft — title-only draft + resume snapshot.
 *
 * Canonical registry: KMS-competition/initiative/contracts/COMMANDS.md
 */
import {
  uuidv7,
  CFP_MIN_SPEAKERS,
  CFP_MAX_SPEAKERS,
  CFP_FILE_MIME_ALLOWLIST,
  CFP_FILE_MAX_BYTES,
  deriveCategoryFromRules,
  isFieldVisible,
  computeCfpWindowState,
  type SubmissionCreateBody,
  type SubmissionSaveDraftBody,
  type SubmissionDto,
  type SubmissionAnswerDto,
  type SubmissionSpeakerDto,
  type SubmissionDraftSnapshot,
  type CfpFileUploadBody,
  type FormFieldDto,
  type FormRuleDto,
} from "@speakerops/shared";
import type { AuthStore } from "../auth/store.js";
import type { EventsStore } from "../events/store.js";
import type { FormsStore } from "../forms/store.js";
import type { DesignStore, FileAssetRow } from "../design/store.js";
import {
  FILE_UPLOAD_STORED,
} from "../design/store.js";
import {
  type SubmissionsStore,
  newPersonId,
  newSubmissionId,
  newAnswerId,
} from "./store.js";
import {
  verifyTurnstile,
  type DemoTurnstileContext,
} from "./turnstile.js";

export type PublicCfpCommandDeps = {
  submissions: SubmissionsStore;
  forms: FormsStore;
  events: EventsStore;
  auth: AuthStore;
  design: DesignStore;
  /** TURNSTILE_SECRET_KEY binding (env name only in docs). */
  turnstileSecret?: string;
  /** DEMO_MODE / allowlist context for Turnstile (section 10.3). */
  demoTurnstile?: DemoTurnstileContext;
};

export type CommandOk<T> = { ok: true; value: T };
export type CommandErr = {
  ok: false;
  status: 400 | 404 | 409 | 429;
  error: string;
  code: string;
  details?: unknown;
};

function toSubmissionDto(row: {
  id: string;
  eventId: string;
  formVersionId: string;
  title: string;
  category: string | null;
  status: string;
  submittedAt: string;
  version: number;
}): SubmissionDto {
  return {
    id: row.id,
    eventId: row.eventId,
    formVersionId: row.formVersionId,
    title: row.title,
    category: row.category,
    status: row.status as SubmissionDto["status"],
    submittedAt: row.submittedAt,
    version: row.version,
  };
}

function answersToMap(
  answers: Array<{ fieldKey: string; value: unknown }>,
): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const a of answers) {
    map[a.fieldKey] = a.value;
  }
  return map;
}

export type CreateSubmissionInput = SubmissionCreateBody & {
  slug: string;
  correlationId: string;
  remoteIp?: string;
  turnstileFetch?: typeof fetch;
  /** Request Host for DEMO allowlist (section 10.3). */
  host?: string;
};

/**
 * Submission.Create — public CFP submit.
 *
 * Guards:
 * - event + published form exist
 * - formVersionId pins exact published version for this event form
 * - window open (opens_at / closes_at)
 * - submission_limit not exceeded
 * - Turnstile ok
 * - speakers min/max
 * - required visible fields present
 * - hidden fields stripped (not stored)
 * - category derived from rules; client mismatch rejected
 */
export async function createSubmission(
  deps: PublicCfpCommandDeps,
  input: CreateSubmissionInput,
): Promise<
  | CommandOk<{
      submission: SubmissionDto;
      answers: SubmissionAnswerDto[];
      speakers: SubmissionSpeakerDto[];
      thankYouMd: string | null;
    }>
  | CommandErr
> {
  const event = await deps.events.findEventBySlug(input.slug);
  if (!event) {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }

  // Turnstile first (cheap fail on spam). DEMO_MODE + allowlist gate DEV_PASS (10.3).
  const demoCtx = deps.demoTurnstile ?? {};
  const captcha = await verifyTurnstile({
    token: input.turnstileToken,
    secret: deps.turnstileSecret,
    remoteIp: input.remoteIp,
    fetchImpl: input.turnstileFetch,
    demoMode: demoCtx.demoMode,
    demoAllowlistEnabled: demoCtx.demoAllowlistEnabled,
    demoAllowlistHosts: demoCtx.demoAllowlistHosts,
    demoAllowlistEventSlugs: demoCtx.demoAllowlistEventSlugs,
    host: input.host ?? demoCtx.host,
    eventSlug: input.slug,
  });
  if (!captcha.ok) {
    return {
      ok: false,
      status: 400,
      error: captcha.error,
      code: captcha.code,
      details: { reason: "turnstile" },
    };
  }

  const version = await deps.forms.findVersionById(input.formVersionId);
  if (!version || version.publishedAt == null) {
    return {
      ok: false,
      status: 400,
      error: "Invalid form_version_id",
      code: "VALIDATION_ERROR",
      details: { formVersionId: input.formVersionId, reason: "not_published" },
    };
  }

  const form = await deps.forms.findFormById(version.formId);
  if (!form || form.eventId !== event.id) {
    return {
      ok: false,
      status: 400,
      error: "form_version_id does not belong to this event",
      code: "VALIDATION_ERROR",
      details: { formVersionId: input.formVersionId },
    };
  }

  // Pin must match latest published for the form (wrong pin rejected)
  const latest = await deps.forms.findLatestPublishedVersion(form.id);
  if (!latest || latest.id !== version.id) {
    return {
      ok: false,
      status: 400,
      error: "Wrong form_version_id pin; use latest published version",
      code: "VALIDATION_ERROR",
      details: {
        formVersionId: input.formVersionId,
        expectedFormVersionId: latest?.id ?? null,
      },
    };
  }

  const windowState = computeCfpWindowState({
    hasPublishedForm: true,
    opensAt: version.opensAt,
    closesAt: version.closesAt,
  });
  if (windowState === "closed" || windowState === "not_yet_open") {
    return {
      ok: false,
      status: 400,
      error:
        windowState === "not_yet_open"
          ? "CFP is not open yet"
          : "CFP is closed",
      code: "VALIDATION_ERROR",
      details: {
        windowState,
        opensAt: version.opensAt,
        closesAt: version.closesAt,
      },
    };
  }

  if (version.submissionLimit != null) {
    const count = await deps.submissions.countSubmittedForFormVersion(
      version.id,
    );
    if (count >= version.submissionLimit) {
      return {
        ok: false,
        status: 400,
        error: "Submission limit reached",
        code: "VALIDATION_ERROR",
        details: {
          submissionLimit: version.submissionLimit,
          count,
        },
      };
    }
  }

  const speakers = input.speakers;
  if (speakers.length < CFP_MIN_SPEAKERS) {
    return {
      ok: false,
      status: 400,
      error: `At least ${CFP_MIN_SPEAKERS} speaker required`,
      code: "VALIDATION_ERROR",
      details: { minSpeakers: CFP_MIN_SPEAKERS, count: speakers.length },
    };
  }
  if (speakers.length > CFP_MAX_SPEAKERS) {
    return {
      ok: false,
      status: 400,
      error: `At most ${CFP_MAX_SPEAKERS} speakers allowed`,
      code: "VALIDATION_ERROR",
      details: { maxSpeakers: CFP_MAX_SPEAKERS, count: speakers.length },
    };
  }

  // Duplicate emails in speakers
  const emails = speakers.map((s) => s.email.toLowerCase());
  if (new Set(emails).size !== emails.length) {
    return {
      ok: false,
      status: 400,
      error: "Duplicate speaker emails",
      code: "VALIDATION_ERROR",
    };
  }

  const fields = (await deps.forms.listFields(version.id)) as Array<{
    id: string;
    fieldKey: string;
    type: string;
    label: string;
    required: boolean;
    options: FormFieldDto["options"];
    sortOrder: number;
    conditions: FormFieldDto["conditions"];
  }>;
  const rules = (await deps.forms.listRules(version.id)) as Array<{
    id: string;
    when: FormRuleDto["when"];
    routeToCategory: string;
  }>;

  const answerMap = answersToMap(
    input.answers.map((a) => ({ fieldKey: a.fieldKey, value: a.value as unknown })),
  );
  const fieldDtos: FormFieldDto[] = fields.map((f) => ({
    id: f.id,
    fieldKey: f.fieldKey as FormFieldDto["fieldKey"],
    type: f.type as FormFieldDto["type"],
    label: f.label,
    required: f.required,
    options: f.options,
    sortOrder: f.sortOrder,
    conditions: f.conditions,
  }));

  // Required visible fields
  for (const f of fieldDtos) {
    if (!f.required) continue;
    if (!isFieldVisible(f, fieldDtos, answerMap)) continue;
    const v = answerMap[f.fieldKey];
    const empty =
      v == null ||
      v === "" ||
      (Array.isArray(v) && v.length === 0);
    if (empty) {
      return {
        ok: false,
        status: 400,
        error: "Required field missing",
        code: "VALIDATION_ERROR",
        details: { fieldKey: f.fieldKey },
      };
    }
  }

  // Strip hidden fields — do not store (A02 negative)
  const storedAnswers: Array<{ fieldKey: string; value: unknown }> = [];
  for (const f of fieldDtos) {
    if (!isFieldVisible(f, fieldDtos, answerMap)) continue;
    if (!(f.fieldKey in answerMap)) continue;
    storedAnswers.push({ fieldKey: f.fieldKey, value: answerMap[f.fieldKey] });
  }
  // Also allow unknown? No — only published field keys
  // Extra keys not in form are dropped (XSS/noise).

  // Category routing
  const derivedCategory = deriveCategoryFromRules(
    rules.map((r) => ({ when: r.when, routeToCategory: r.routeToCategory })),
    answerMap,
  );
  if (
    input.category != null &&
    input.category !== "" &&
    derivedCategory != null &&
    input.category !== derivedCategory
  ) {
    return {
      ok: false,
      status: 400,
      error: "Invalid category for answers",
      code: "VALIDATION_ERROR",
      details: {
        category: input.category,
        derivedCategory,
      },
    };
  }
  // If client sent category with no matching rule, reject when rules exist
  if (
    input.category != null &&
    input.category !== "" &&
    derivedCategory == null &&
    rules.length > 0
  ) {
    return {
      ok: false,
      status: 400,
      error: "Invalid category",
      code: "VALIDATION_ERROR",
      details: { category: input.category },
    };
  }
  const category = derivedCategory ?? input.category ?? null;

  // Validate file ids in answers reference uploaded allowlisted files
  for (const a of storedAnswers) {
    if (typeof a.value === "string" && a.value.startsWith("file:")) {
      const fileId = a.value.slice("file:".length);
      const file = await deps.design.findFile(event.id, fileId);
      if (!file || !file.uploaded || file.purpose !== "other") {
        return {
          ok: false,
          status: 400,
          error: "Invalid file reference",
          code: "VALIDATION_ERROR",
          details: { fieldKey: a.fieldKey, fileId },
        };
      }
      if (
        !(CFP_FILE_MIME_ALLOWLIST as readonly string[]).includes(file.mime)
      ) {
        return {
          ok: false,
          status: 400,
          error: "File type not allowed",
          code: "VALIDATION_ERROR",
          details: {
            mime: file.mime,
            allowlist: [...CFP_FILE_MIME_ALLOWLIST],
          },
        };
      }
    }
  }

  const now = new Date().toISOString();
  const submissionId = newSubmissionId();

  // Upsert people + speakers
  const speakerDtos: SubmissionSpeakerDto[] = [];
  const speakerRows = [];
  for (let i = 0; i < speakers.length; i++) {
    const sp = speakers[i]!;
    const email = sp.email.toLowerCase().trim();
    let person = await deps.submissions.findPersonByOrgEmail(
      event.orgId,
      email,
    );
    if (!person) {
      person = await deps.submissions.insertPerson({
        id: newPersonId(),
        orgId: event.orgId,
        email,
        name: sp.name.trim(),
        createdAt: now,
        updatedAt: now,
      });
    } else if (person.name !== sp.name.trim()) {
      await deps.submissions.updatePersonName(
        person.id,
        sp.name.trim(),
        now,
      );
      person = { ...person, name: sp.name.trim(), updatedAt: now };
    }
    const isPrimary = sp.isPrimary === true || (sp.isPrimary == null && i === 0);
    speakerRows.push({
      submissionId,
      personId: person.id,
      isPrimary,
      sortOrder: i,
    });
    speakerDtos.push({
      personId: person.id,
      name: person.name,
      email: person.email,
      isPrimary,
      sortOrder: i,
    });
  }

  const submission = await deps.submissions.insertSubmission({
    id: submissionId,
    eventId: event.id,
    formVersionId: version.id,
    title: input.title.trim(),
    category,
    status: "submitted",
    submittedAt: now,
    version: 1,
  });

  const answerRows = storedAnswers.map((a) => ({
    id: newAnswerId(),
    submissionId,
    fieldKey: a.fieldKey,
    valueJson: JSON.stringify(a.value ?? null),
  }));
  await deps.submissions.insertAnswers(answerRows);
  await deps.submissions.insertSpeakers(speakerRows);

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: event.id,
    actorType: "system",
    actorId: speakerDtos[0]?.email ?? "public-cfp",
    action: "Submission.Create",
    entityType: "submission",
    entityId: submissionId,
    afterJson: JSON.stringify({
      formVersionId: version.id,
      title: submission.title,
      category: submission.category,
      speakerCount: speakerDtos.length,
      answerKeys: storedAnswers.map((a) => a.fieldKey),
      actor: "public",
    }),
    correlationId: input.correlationId,
    createdAt: now,
  });

  return {
    ok: true,
    value: {
      submission: toSubmissionDto(submission),
      answers: storedAnswers.map((a) => ({
        fieldKey: a.fieldKey as SubmissionAnswerDto["fieldKey"],
        value: a.value,
      })),
      speakers: speakerDtos,
      thankYouMd: version.thankYouMd,
    },
  };
}

export type UploadCfpFileInput = CfpFileUploadBody & {
  slug: string;
  correlationId: string;
};

/**
 * Public CFP supporting file upload (allowlist + size).
 * Stores as file_assets purpose=other; returns fileId for answer value `file:{id}`.
 */
export async function uploadCfpFile(
  deps: PublicCfpCommandDeps,
  input: UploadCfpFileInput,
): Promise<
  | CommandOk<{
      fileId: string;
      mime: string;
      size: number;
      filename: string;
    }>
  | CommandErr
> {
  const event = await deps.events.findEventBySlug(input.slug);
  if (!event) {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }

  // Ensure a published form exists (files only for live CFP)
  const eventForms = await deps.forms.findFormsByEventId(event.id);
  const published = eventForms.find((f) => f.status === "published");
  if (!published) {
    return {
      ok: false,
      status: 400,
      error: "No published CFP form",
      code: "VALIDATION_ERROR",
    };
  }
  const version = await deps.forms.findLatestPublishedVersion(published.id);
  if (!version) {
    return {
      ok: false,
      status: 400,
      error: "No published CFP form",
      code: "VALIDATION_ERROR",
    };
  }
  const windowState = computeCfpWindowState({
    hasPublishedForm: true,
    opensAt: version.opensAt,
    closesAt: version.closesAt,
  });
  if (windowState !== "open") {
    return {
      ok: false,
      status: 400,
      error: "CFP is closed",
      code: "VALIDATION_ERROR",
      details: { windowState },
    };
  }

  const mime = input.mime.trim().toLowerCase();
  if (
    mime === "image/svg+xml" ||
    mime.includes("svg") ||
    mime === "text/html" ||
    mime === "application/javascript" ||
    mime === "text/javascript"
  ) {
    return {
      ok: false,
      status: 400,
      error: "File type not allowed",
      code: "VALIDATION_ERROR",
      details: { mime: input.mime, allowlist: [...CFP_FILE_MIME_ALLOWLIST] },
    };
  }
  if (!(CFP_FILE_MIME_ALLOWLIST as readonly string[]).includes(mime)) {
    return {
      ok: false,
      status: 400,
      error: "File type not allowed",
      code: "VALIDATION_ERROR",
      details: { mime: input.mime, allowlist: [...CFP_FILE_MIME_ALLOWLIST] },
    };
  }

  if (input.size > CFP_FILE_MAX_BYTES) {
    return {
      ok: false,
      status: 400,
      error: "File exceeds maximum size",
      code: "VALIDATION_ERROR",
      details: { size: input.size, max: CFP_FILE_MAX_BYTES },
    };
  }

  let bytes: Uint8Array;
  try {
    const binary = atob(input.contentBase64.replace(/\s/g, ""));
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
  } catch {
    return {
      ok: false,
      status: 400,
      error: "Invalid base64 content",
      code: "VALIDATION_ERROR",
    };
  }

  if (bytes.byteLength !== input.size) {
    return {
      ok: false,
      status: 400,
      error: "Declared size does not match content",
      code: "VALIDATION_ERROR",
      details: { declared: input.size, actual: bytes.byteLength },
    };
  }
  if (bytes.byteLength > CFP_FILE_MAX_BYTES) {
    return {
      ok: false,
      status: 400,
      error: "File exceeds maximum size",
      code: "VALIDATION_ERROR",
      details: { size: bytes.byteLength, max: CFP_FILE_MAX_BYTES },
    };
  }

  const now = new Date().toISOString();
  const fileId = uuidv7();
  const filename = input.filename.trim().slice(0, 255) || `upload-${fileId}`;
  const ext =
    mime === "application/pdf"
      ? "pdf"
      : mime === "image/png"
        ? "png"
        : mime === "image/jpeg"
          ? "jpg"
          : "bin";
  const r2Key = `events/${event.id}/cfp/${fileId}.${ext}`;

  const row: FileAssetRow = {
    id: fileId,
    eventId: event.id,
    ownerParticipationId: null,
    r2Key,
    filename,
    mime,
    size: bytes.byteLength,
    checksum: null,
    purpose: "other",
    createdAt: now,
    uploaded: true,
    uploadState: FILE_UPLOAD_STORED,
  };
  await deps.design.insertFile(row);
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  await deps.design.putFileBytes(event.id, fileId, {
    bytes: ab,
    mime,
  });

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: event.id,
    actorType: "system",
    actorId: "public-cfp",
    action: "Cfp.FileUpload",
    entityType: "file_asset",
    entityId: fileId,
    afterJson: JSON.stringify({
      purpose: "other",
      mime,
      size: bytes.byteLength,
      filename,
      actor: "public",
    }),
    correlationId: input.correlationId,
    createdAt: now,
  });

  return {
    ok: true,
    value: {
      fileId,
      mime,
      size: bytes.byteLength,
      filename,
    },
  };
}

/**
 * Build public CFP meta (window + speaker bounds) for GET response enrichment.
 */
export function publicCfpMetaFromVersion(input: {
  hasPublishedForm: boolean;
  opensAt: string | null | undefined;
  closesAt: string | null | undefined;
  turnstileSiteKey: string;
}): {
  windowState: ReturnType<typeof computeCfpWindowState>;
  minSpeakers: number;
  maxSpeakers: number;
  turnstileSiteKey: string;
  fileMimeAllowlist: string[];
  fileMaxBytes: number;
} {
  return {
    windowState: computeCfpWindowState({
      hasPublishedForm: input.hasPublishedForm,
      opensAt: input.opensAt,
      closesAt: input.closesAt,
    }),
    minSpeakers: CFP_MIN_SPEAKERS,
    maxSpeakers: CFP_MAX_SPEAKERS,
    turnstileSiteKey: input.turnstileSiteKey,
    fileMimeAllowlist: [...CFP_FILE_MIME_ALLOWLIST],
    fileMaxBytes: CFP_FILE_MAX_BYTES,
  };
}

export type SaveDraftInput = SubmissionSaveDraftBody & {
  slug: string;
  correlationId: string;
};

export type GetDraftInput = {
  slug: string;
  draftId: string;
  correlationId: string;
};

async function resolvePublishedFormVersion(
  deps: PublicCfpCommandDeps,
  slug: string,
  formVersionId: string,
): Promise<
  | CommandOk<{
      event: NonNullable<Awaited<ReturnType<EventsStore["findEventBySlug"]>>>;
      form: NonNullable<Awaited<ReturnType<FormsStore["findFormById"]>>>;
      version: NonNullable<
        Awaited<ReturnType<FormsStore["findVersionById"]>>
      >;
    }>
  | CommandErr
> {
  const event = await deps.events.findEventBySlug(slug);
  if (!event) {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }

  const version = await deps.forms.findVersionById(formVersionId);
  if (!version || version.publishedAt == null) {
    return {
      ok: false,
      status: 400,
      error: "Invalid form_version_id",
      code: "VALIDATION_ERROR",
      details: { formVersionId, reason: "not_published" },
    };
  }

  const form = await deps.forms.findFormById(version.formId);
  if (!form || form.eventId !== event.id) {
    return {
      ok: false,
      status: 400,
      error: "form_version_id does not belong to this event",
      code: "VALIDATION_ERROR",
      details: { formVersionId },
    };
  }

  const latest = await deps.forms.findLatestPublishedVersion(form.id);
  if (!latest || latest.id !== version.id) {
    return {
      ok: false,
      status: 400,
      error: "Wrong form_version_id pin; use latest published version",
      code: "VALIDATION_ERROR",
      details: {
        formVersionId,
        expectedFormVersionId: latest?.id ?? null,
      },
    };
  }

  const windowState = computeCfpWindowState({
    hasPublishedForm: true,
    opensAt: version.opensAt,
    closesAt: version.closesAt,
  });
  if (windowState === "closed" || windowState === "not_yet_open") {
    return {
      ok: false,
      status: 400,
      error:
        windowState === "not_yet_open"
          ? "CFP is not open yet"
          : "CFP is closed",
      code: "VALIDATION_ERROR",
      details: {
        windowState,
        opensAt: version.opensAt,
        closesAt: version.closesAt,
      },
    };
  }

  return { ok: true, value: { event, form, version } };
}

function parseAnswerValue(valueJson: string): unknown {
  try {
    return JSON.parse(valueJson) as unknown;
  } catch {
    return valueJson;
  }
}

async function buildDraftSnapshot(
  deps: PublicCfpCommandDeps,
  submission: {
    title: string;
    category: string | null;
  },
  submissionId: string,
): Promise<SubmissionDraftSnapshot> {
  const answerRows = await deps.submissions.listAnswers(submissionId);
  const speakerRows = await deps.submissions.listSpeakers(submissionId);
  const speakers: SubmissionDraftSnapshot["speakers"] = [];
  for (const sp of speakerRows
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)) {
    const person = await deps.submissions.findPersonById(sp.personId);
    speakers.push({
      name: person?.name ?? "",
      email: person?.email ?? "",
      isPrimary: sp.isPrimary,
      sortOrder: sp.sortOrder,
      personId: sp.personId,
    });
  }
  return {
    title: submission.title,
    answers: answerRows.map((a) => ({
      fieldKey: a.fieldKey as SubmissionAnswerDto["fieldKey"],
      value: parseAnswerValue(a.valueJson),
    })),
    speakers,
    category: submission.category,
  };
}

/**
 * Submission.SaveDraft — public CFP draft with minimal fields (title required).
 * No Turnstile, no required-field validation, speakers optional.
 * Closed / not-yet-open CFP → 400. Updates existing draft when draftId set.
 */
export async function saveDraft(
  deps: PublicCfpCommandDeps,
  input: SaveDraftInput,
): Promise<
  | CommandOk<{
      submission: SubmissionDto;
      snapshot: SubmissionDraftSnapshot;
    }>
  | CommandErr
> {
  const title = input.title.trim();
  if (!title) {
    return {
      ok: false,
      status: 400,
      error: "Title is required",
      code: "VALIDATION_ERROR",
      details: { field: "title" },
    };
  }

  const resolved = await resolvePublishedFormVersion(
    deps,
    input.slug,
    input.formVersionId,
  );
  if (!resolved.ok) return resolved;
  const { event, version } = resolved.value;

  const speakers = input.speakers ?? [];
  if (speakers.length > CFP_MAX_SPEAKERS) {
    return {
      ok: false,
      status: 400,
      error: `At most ${CFP_MAX_SPEAKERS} speakers allowed`,
      code: "VALIDATION_ERROR",
      details: { maxSpeakers: CFP_MAX_SPEAKERS, count: speakers.length },
    };
  }
  if (speakers.length > 0) {
    const emails = speakers.map((s) => s.email.toLowerCase());
    if (new Set(emails).size !== emails.length) {
      return {
        ok: false,
        status: 400,
        error: "Duplicate speaker emails",
        code: "VALIDATION_ERROR",
      };
    }
  }

  // Published field keys only — strip unknown / hidden noise (no required gate).
  const fields = (await deps.forms.listFields(version.id)) as Array<{
    fieldKey: string;
  }>;
  const allowedKeys = new Set(fields.map((f) => f.fieldKey));
  const storedAnswers: Array<{ fieldKey: string; value: unknown }> = [];
  for (const a of input.answers ?? []) {
    if (!allowedKeys.has(a.fieldKey)) continue;
    storedAnswers.push({ fieldKey: a.fieldKey, value: a.value });
  }

  // Optional category; re-derive when answers present (soft — no reject on mismatch for draft)
  const rules = (await deps.forms.listRules(version.id)) as Array<{
    when: FormRuleDto["when"];
    routeToCategory: string;
  }>;
  const answerMap = answersToMap(storedAnswers);
  const derivedCategory = deriveCategoryFromRules(
    rules.map((r) => ({ when: r.when, routeToCategory: r.routeToCategory })),
    answerMap,
  );
  const category = derivedCategory ?? input.category ?? null;

  const now = new Date().toISOString();

  // --- Update existing draft ---
  if (input.draftId) {
    const existing = await deps.submissions.findSubmissionById(input.draftId);
    if (
      !existing ||
      existing.eventId !== event.id ||
      existing.status !== "draft"
    ) {
      return {
        ok: false,
        status: 404,
        error: "Draft not found",
        code: "NOT_FOUND",
      };
    }
    // Re-pin formVersionId to the published version used for this snapshot
    // rewrite so answers/fields stay on the same immutable form version
    // (audit + row + response must agree). Stale client pins are upgraded
    // atomically when resolvePublishedFormVersion accepts the request body.
    const nextVersion = existing.version + 1;
    const updated = await deps.submissions.updateDraftSubmission(
      existing.id,
      {
        title,
        category,
        version: nextVersion,
        formVersionId: version.id,
      },
      existing.version,
    );
    if (!updated) {
      return {
        ok: false,
        status: 409,
        error: "Draft version conflict",
        code: "CONFLICT",
      };
    }

    const answerRows = storedAnswers.map((a) => ({
      id: newAnswerId(),
      submissionId: existing.id,
      fieldKey: a.fieldKey,
      valueJson: JSON.stringify(a.value ?? null),
    }));
    await deps.submissions.replaceAnswers(existing.id, answerRows);

    const speakerRows = [];
    const speakerSnapshot: SubmissionDraftSnapshot["speakers"] = [];
    for (let i = 0; i < speakers.length; i++) {
      const sp = speakers[i]!;
      const email = sp.email.toLowerCase().trim();
      let person = await deps.submissions.findPersonByOrgEmail(
        event.orgId,
        email,
      );
      if (!person) {
        person = await deps.submissions.insertPerson({
          id: newPersonId(),
          orgId: event.orgId,
          email,
          name: sp.name.trim(),
          createdAt: now,
          updatedAt: now,
        });
      } else if (person.name !== sp.name.trim()) {
        await deps.submissions.updatePersonName(
          person.id,
          sp.name.trim(),
          now,
        );
        person = { ...person, name: sp.name.trim(), updatedAt: now };
      }
      const isPrimary =
        sp.isPrimary === true || (sp.isPrimary == null && i === 0);
      speakerRows.push({
        submissionId: existing.id,
        personId: person.id,
        isPrimary,
        sortOrder: i,
      });
      speakerSnapshot.push({
        name: person.name,
        email: person.email,
        isPrimary,
        sortOrder: i,
        personId: person.id,
      });
    }
    await deps.submissions.replaceSpeakers(existing.id, speakerRows);

    await deps.auth.insertAudit({
      id: uuidv7(),
      eventId: event.id,
      actorType: "system",
      actorId: speakerSnapshot[0]?.email ?? "public-cfp",
      action: "Submission.SaveDraft",
      entityType: "submission",
      entityId: existing.id,
      afterJson: JSON.stringify({
        formVersionId: version.id,
        title,
        category,
        status: "draft",
        answerKeys: storedAnswers.map((a) => a.fieldKey),
        speakerCount: speakerSnapshot.length,
        actor: "public",
        mode: "update",
      }),
      correlationId: input.correlationId,
      createdAt: now,
    });

    const snapshot: SubmissionDraftSnapshot = {
      title: updated.title,
      answers: storedAnswers.map((a) => ({
        fieldKey: a.fieldKey as SubmissionAnswerDto["fieldKey"],
        value: a.value,
      })),
      speakers: speakerSnapshot,
      category: updated.category,
    };

    return {
      ok: true,
      value: {
        submission: toSubmissionDto(updated),
        snapshot,
      },
    };
  }

  // --- Create new draft ---
  const submissionId = newSubmissionId();
  const speakerRows = [];
  const speakerSnapshot: SubmissionDraftSnapshot["speakers"] = [];
  for (let i = 0; i < speakers.length; i++) {
    const sp = speakers[i]!;
    const email = sp.email.toLowerCase().trim();
    let person = await deps.submissions.findPersonByOrgEmail(
      event.orgId,
      email,
    );
    if (!person) {
      person = await deps.submissions.insertPerson({
        id: newPersonId(),
        orgId: event.orgId,
        email,
        name: sp.name.trim(),
        createdAt: now,
        updatedAt: now,
      });
    } else if (person.name !== sp.name.trim()) {
      await deps.submissions.updatePersonName(person.id, sp.name.trim(), now);
      person = { ...person, name: sp.name.trim(), updatedAt: now };
    }
    const isPrimary =
      sp.isPrimary === true || (sp.isPrimary == null && i === 0);
    speakerRows.push({
      submissionId,
      personId: person.id,
      isPrimary,
      sortOrder: i,
    });
    speakerSnapshot.push({
      name: person.name,
      email: person.email,
      isPrimary,
      sortOrder: i,
      personId: person.id,
    });
  }

  const submission = await deps.submissions.insertSubmission({
    id: submissionId,
    eventId: event.id,
    formVersionId: version.id,
    title,
    category,
    status: "draft",
    submittedAt: now,
    version: 1,
  });

  const answerRows = storedAnswers.map((a) => ({
    id: newAnswerId(),
    submissionId,
    fieldKey: a.fieldKey,
    valueJson: JSON.stringify(a.value ?? null),
  }));
  await deps.submissions.insertAnswers(answerRows);
  await deps.submissions.insertSpeakers(speakerRows);

  await deps.auth.insertAudit({
    id: uuidv7(),
    eventId: event.id,
    actorType: "system",
    actorId: speakerSnapshot[0]?.email ?? "public-cfp",
    action: "Submission.SaveDraft",
    entityType: "submission",
    entityId: submissionId,
    afterJson: JSON.stringify({
      formVersionId: version.id,
      title: submission.title,
      category: submission.category,
      status: "draft",
      answerKeys: storedAnswers.map((a) => a.fieldKey),
      speakerCount: speakerSnapshot.length,
      actor: "public",
      mode: "create",
    }),
    correlationId: input.correlationId,
    createdAt: now,
  });

  const snapshot: SubmissionDraftSnapshot = {
    title: submission.title,
    answers: storedAnswers.map((a) => ({
      fieldKey: a.fieldKey as SubmissionAnswerDto["fieldKey"],
      value: a.value,
    })),
    speakers: speakerSnapshot,
    category: submission.category,
  };

  return {
    ok: true,
    value: {
      submission: toSubmissionDto(submission),
      snapshot,
    },
  };
}

/**
 * Submission.GetDraft — resume a public draft by id (capability URL).
 * Event-scoped: wrong slug/event → 404. Non-draft status → 404.
 */
export async function getDraft(
  deps: PublicCfpCommandDeps,
  input: GetDraftInput,
): Promise<
  | CommandOk<{
      submission: SubmissionDto;
      snapshot: SubmissionDraftSnapshot;
    }>
  | CommandErr
> {
  const event = await deps.events.findEventBySlug(input.slug);
  if (!event) {
    return { ok: false, status: 404, error: "Not found", code: "NOT_FOUND" };
  }

  const row = await deps.submissions.findSubmissionById(input.draftId);
  if (!row || row.eventId !== event.id || row.status !== "draft") {
    return {
      ok: false,
      status: 404,
      error: "Draft not found",
      code: "NOT_FOUND",
    };
  }

  const snapshot = await buildDraftSnapshot(deps, row, row.id);
  return {
    ok: true,
    value: {
      submission: toSubmissionDto(row),
      snapshot,
    },
  };
}
