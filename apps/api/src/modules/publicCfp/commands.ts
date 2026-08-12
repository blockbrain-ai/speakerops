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
  isInputNode,
  computeCfpWindowState,
  richTextPublicAnswerSchema,
  richTextCharCount,
  richTextIsEmpty,
  readRichTextValue,
  type RichTextEnvelope,
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
import { findActivePublicForm } from "../forms/commands.js";
import type { CommsStore } from "../comms/store.js";
import { enqueueSubmissionConfirmation } from "../comms/lifecycle.js";
import type { DesignStore, FileAssetRow } from "../design/store.js";
import {
  FILE_UPLOAD_STORED,
} from "../design/store.js";
import {
  type SubmissionsStore,
  newPersonId,
  newSubmissionId,
  newAnswerId,
  perSubmitterGuardPrefix,
} from "./store.js";
import { invalidateSearchIndex } from "../search/commands.js";
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
  /** B3: optional search invalidation after mutations. */
  search?: { invalidateIndex?: (eventId: string) => Promise<void> };
  searchQueueKick?: { send: (message: unknown) => Promise<unknown> } | null;
  /**
   * Optional comms store — enables the submission confirmation lifecycle
   * email (Wave 1B). A missing store or any comms failure never fails the
   * submission (log + skip).
   */
  comms?: CommsStore;
  /** Best-effort JOBS_QUEUE kick after the lifecycle enqueue (production). */
  commsQueueKick?: { send: (message: unknown) => Promise<unknown> } | null;
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
      thankYouRich: RichTextEnvelope | null;
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

  // Per-submitter cap (Wave 1B, ADDITIVE beside the total limit above):
  // scoped to the logical FORM (every published version of the pinned
  // version's form_id), matching the UI copy ("this form") — a republish
  // still counts, a second form on the same event never does.
  //
  // The effective count merges two race-visible sources:
  // - guard rows (`per-submitter:<formId>:<email>:<n>`): claimed atomically
  //   WITH each submission insert, so an in-flight winner is counted the
  //   instant it commits (the speaker-join count lags until speaker rows land)
  // - legacy submitted rows WITHOUT a guard (created before this fix),
  //   correlated by guard requestHash = submission id so nothing double-counts
  const perSubmitterLimit = version.perSubmitterLimit ?? null;
  const incomingPrimary =
    input.speakers.find((sp) => sp.isPrimary === true) ?? input.speakers[0];
  const incomingPrimaryEmail = incomingPrimary
    ? incomingPrimary.email.toLowerCase().trim()
    : null;
  const perSubmitterCapError = (count: number): CommandErr => ({
    ok: false,
    status: 400,
    error:
      perSubmitterLimit === 1
        ? "You have already submitted a proposal for this event — this form allows one per person"
        : `You have reached this form's limit of ${perSubmitterLimit} proposals per person`,
    code: "VALIDATION_ERROR",
    details: {
      perSubmitterLimit,
      count,
      email: incomingPrimaryEmail,
    },
  });
  const formVersionIds = perSubmitterLimit != null
    ? [
        ...new Set([
          version.id,
          ...(await deps.forms.findPublishedVersions(form.id)).map(
            (v) => v.id,
          ),
        ]),
      ]
    : [];
  const effectivePerSubmitterCount = async (): Promise<number> => {
    if (incomingPrimaryEmail == null) return 0;
    const [submittedIds, guardHashes] = await Promise.all([
      deps.submissions.listSubmittedIdsByPrimaryEmailForVersions(
        formVersionIds,
        incomingPrimaryEmail,
      ),
      deps.submissions.listSubmissionGuardHashes(
        form.id,
        incomingPrimaryEmail,
      ),
    ]);
    const guarded = new Set(guardHashes);
    return (
      guardHashes.length +
      submittedIds.filter((id) => !guarded.has(id)).length
    );
  };
  let perSubmitterCount = 0;
  if (perSubmitterLimit != null && incomingPrimaryEmail) {
    perSubmitterCount = await effectivePerSubmitterCount();
    if (perSubmitterCount >= perSubmitterLimit) {
      return perSubmitterCapError(perSubmitterCount);
    }
  }

  // Speaker bounds come from the PINNED published version (configurable 1–15).
  const minSpeakers = version.minSpeakers ?? CFP_MIN_SPEAKERS;
  const maxSpeakers = version.maxSpeakers ?? CFP_MAX_SPEAKERS;
  const speakers = input.speakers;
  if (speakers.length < minSpeakers) {
    return {
      ok: false,
      status: 400,
      error:
        minSpeakers === 1
          ? "At least 1 speaker required"
          : `This form requires at least ${minSpeakers} speakers`,
      code: "VALIDATION_ERROR",
      details: { minSpeakers, count: speakers.length },
    };
  }
  if (speakers.length > maxSpeakers) {
    return {
      ok: false,
      status: 400,
      error: `At most ${maxSpeakers} speaker${maxSpeakers === 1 ? "" : "s"} allowed on this form`,
      code: "VALIDATION_ERROR",
      details: { maxSpeakers, count: speakers.length },
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
    maxChars?: number | null;
    nodeKind?: FormFieldDto["nodeKind"];
    layoutType?: FormFieldDto["layoutType"];
  }>;
  const rules = (await deps.forms.listRules(version.id)) as Array<{
    id: string;
    when: FormRuleDto["when"];
    routeToCategory: string;
  }>;

  const answerMap = answersToMap(
    input.answers.map((a) => ({ fieldKey: a.fieldKey, value: a.value as unknown })),
  );
  // Layout nodes (section/divider) are structure only — excluded from answer
  // validation, required checks, and stored payloads (Wave 1B).
  const fieldDtos: FormFieldDto[] = fields
    .filter((f) => isInputNode(f))
    .map((f) => ({
      id: f.id,
      fieldKey: f.fieldKey as FormFieldDto["fieldKey"],
      type: f.type as FormFieldDto["type"],
      label: f.label,
      required: f.required,
      options: f.options,
      sortOrder: f.sortOrder,
      conditions: f.conditions,
      maxChars: f.maxChars ?? null,
    }));

  // Required visible fields
  for (const f of fieldDtos) {
    if (!f.required) continue;
    if (!isFieldVisible(f, fieldDtos, answerMap)) continue;
    const v = answerMap[f.fieldKey];
    const empty =
      v == null ||
      v === "" ||
      (Array.isArray(v) && v.length === 0) ||
      // rich_text: a doc with no visible text is an empty answer (F2).
      (f.type === "rich_text" &&
        richTextPublicAnswerSchema.safeParse(v).success &&
        richTextIsEmpty(v as RichTextEnvelope));
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
    const val = answerMap[f.fieldKey];
    // Per-field character cap (text/textarea only; authored knob).
    if (
      f.maxChars != null &&
      (f.type === "text" || f.type === "textarea") &&
      typeof val === "string" &&
      val.length > f.maxChars
    ) {
      return {
        ok: false,
        status: 400,
        error: `“${f.label}” is limited to ${f.maxChars} characters`,
        code: "VALIDATION_ERROR",
        details: {
          fieldKey: f.fieldKey,
          maxChars: f.maxChars,
          length: val.length,
        },
      };
    }
    // Multiselect must be string[] (competition field fidelity).
    if (f.type === "multiselect") {
      if (!Array.isArray(val) || !val.every((x) => typeof x === "string")) {
        return {
          ok: false,
          status: 400,
          error: "Multiselect answers must be an array of strings",
          code: "VALIDATION_ERROR",
          details: { fieldKey: f.fieldKey },
        };
      }
    }
    // rich_text answers must be valid publicAnswer docs — REJECT, never
    // strip, at the API boundary (F2/E4). Caps (depth/nodes/bytes) and the
    // link protocol allowlist are enforced by the schema; maxChars counts
    // plain-text length (richTextCharCount).
    if (f.type === "rich_text") {
      const parsedDoc = richTextPublicAnswerSchema.safeParse(val);
      if (!parsedDoc.success) {
        return {
          ok: false,
          status: 400,
          error: `“${f.label}” must be a valid rich-text answer`,
          code: "VALIDATION_ERROR",
          details: {
            fieldKey: f.fieldKey,
            issues: parsedDoc.error.flatten(),
          },
        };
      }
      const textLength = richTextCharCount(parsedDoc.data);
      if (f.maxChars != null && textLength > f.maxChars) {
        return {
          ok: false,
          status: 400,
          error: `“${f.label}” is limited to ${f.maxChars} characters`,
          code: "VALIDATION_ERROR",
          details: {
            fieldKey: f.fieldKey,
            maxChars: f.maxChars,
            length: textLength,
          },
        };
      }
      storedAnswers.push({ fieldKey: f.fieldKey, value: parsedDoc.data });
      continue;
    }
    // F2-02: non-rich fields must NOT accept arbitrary objects. A structured
    // rich envelope smuggled through a text field would bypass per-context
    // write caps and later be shape-sniffed as rich by admin detail / CSV.
    // Arrays are only valid for multiselect (already checked above).
    if (val !== null && typeof val === "object") {
      if (Array.isArray(val)) {
        // multiselect already validated; any other array is noise/attack.
        if (f.type !== "multiselect") {
          return {
            ok: false,
            status: 400,
            error: `“${f.label}” must be a scalar value`,
            code: "VALIDATION_ERROR",
            details: { fieldKey: f.fieldKey, type: f.type },
          };
        }
      } else {
        return {
          ok: false,
          status: 400,
          error: `“${f.label}” must not be an object`,
          code: "VALIDATION_ERROR",
          details: { fieldKey: f.fieldKey, type: f.type },
        };
      }
    }
    storedAnswers.push({ fieldKey: f.fieldKey, value: val });
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

  // File answers are field-type enforced (contract fix):
  // - a file-typed field's non-empty answer MUST be a `file:<id>` token
  //   referencing a stored, allowlisted upload for THIS event — plain text
  //   is rejected (the token is a server-side reference, not free text)
  // - `file:` tokens on non-file fields are rejected outright
  const fieldByKey = new Map(fieldDtos.map((f) => [f.fieldKey, f]));
  for (const a of storedAnswers) {
    const field = fieldByKey.get(a.fieldKey);
    const isFileField = field?.type === "file";
    const isFileToken =
      typeof a.value === "string" && a.value.startsWith("file:");
    // Empty optional answers are allowed; required-empty was rejected above.
    const isEmpty = a.value == null || a.value === "";

    if (isFileField && !isEmpty && !isFileToken) {
      return {
        ok: false,
        status: 400,
        error: "This field takes an uploaded file, not text",
        code: "VALIDATION_ERROR",
        details: { fieldKey: a.fieldKey },
      };
    }
    if (!isFileField && isFileToken) {
      return {
        ok: false,
        status: 400,
        error: "File uploads are only accepted on file fields",
        code: "VALIDATION_ERROR",
        details: { fieldKey: a.fieldKey },
      };
    }
    if (isFileField && isFileToken) {
      const fileId = (a.value as string).slice("file:".length);
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
      // Persisted upload binding (0033) must match EXACTLY: the asset was
      // authorized for this pinned form version, on this field. Assets bound
      // to an older version (republish), to another logical form, or to a
      // different file field fail closed — as do legacy unbound assets.
      if (file.formVersionId == null || file.formVersionId !== version.id) {
        return {
          ok: false,
          status: 400,
          error: "This file was uploaded for a different form version — please re-attach it",
          code: "VALIDATION_ERROR",
          details: {
            fieldKey: a.fieldKey,
            fileId,
            uploadFormVersionId: file.formVersionId ?? null,
            formVersionId: version.id,
          },
        };
      }
      if (file.fieldKey == null || file.fieldKey !== a.fieldKey) {
        return {
          ok: false,
          status: 400,
          error: "This file was uploaded for a different form field — please re-attach it",
          code: "VALIDATION_ERROR",
          details: {
            fieldKey: a.fieldKey,
            fileId,
            uploadFieldKey: file.fieldKey ?? null,
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
    // Optional "About this speaker" seed fields (Wave 2): trimmed-or-null.
    const bio = sp.bio?.trim() ? sp.bio.trim() : null;
    const company = sp.company?.trim() ? sp.company.trim() : null;
    const speakerTitle = sp.title?.trim() ? sp.title.trim() : null;
    speakerRows.push({
      submissionId,
      personId: person.id,
      isPrimary,
      sortOrder: i,
      bio,
      company,
      title: speakerTitle,
    });
    speakerDtos.push({
      personId: person.id,
      name: person.name,
      email: person.email,
      isPrimary,
      sortOrder: i,
      bio,
      company,
      title: speakerTitle,
    });
  }

  const submissionRow = {
    id: submissionId,
    eventId: event.id,
    formVersionId: version.id,
    title: input.title.trim(),
    category,
    status: "submitted",
    submittedAt: now,
    version: 1,
  };

  // Race-safe per-submitter cap: claim the unique guard row
  // (`per-submitter:<formId>:<email>:<n>`, n = effective count + 1) in the
  // SAME atomic unit as the submission insert. Two concurrent submits under
  // the cap cannot both take the last slot — the loser's guard conflicts, it
  // recomputes the effective count (which now includes the winner's guard)
  // and either 400s (cap reached) or retries the next slot. A conflict always
  // means a new guard exists, so the recomputed count strictly grows —
  // bounded loop, no livelock.
  let submission: typeof submissionRow;
  if (perSubmitterLimit != null && incomingPrimaryEmail) {
    const guardKeyFor = (n: number) =>
      `${perSubmitterGuardPrefix(form.id, incomingPrimaryEmail)}${n}`;
    let slot = perSubmitterCount + 1;
    const maxAttempts = perSubmitterLimit + 25;
    let attempts = 0;
    for (;;) {
      const outcome = await deps.submissions.insertSubmissionWithGuard(
        submissionRow,
        {
          id: uuidv7(),
          key: guardKeyFor(slot),
          requestHash: submissionId,
          responseJson: null,
          createdAt: now,
        },
      );
      if (outcome === "inserted") break;
      attempts += 1;
      const effective = await effectivePerSubmitterCount();
      if (effective >= perSubmitterLimit) {
        return perSubmitterCapError(effective);
      }
      if (attempts >= maxAttempts) {
        return perSubmitterCapError(effective);
      }
      slot = Math.max(slot + 1, effective + 1);
    }
    submission = submissionRow;
  } else {
    submission = await deps.submissions.insertSubmission(submissionRow);
  }

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

  // Wave 1B lifecycle: confirmation email to the submitter (durable outbox
  // enqueue). Guarded so comms problems can NEVER fail the submission.
  if (deps.comms) {
    const primary =
      speakerDtos.find((sp) => sp.isPrimary) ?? speakerDtos[0] ?? null;
    if (primary) {
      await enqueueSubmissionConfirmation(
        {
          comms: deps.comms,
          auth: deps.auth,
          queueKick: deps.commsQueueKick ?? null,
        },
        {
          event: {
            id: event.id,
            name: event.name,
            slug: event.slug,
            settingsJson: event.settingsJson ?? null,
          },
          submission: {
            id: submission.id,
            title: submission.title,
            category: submission.category,
          },
          primarySpeaker: { name: primary.name, email: primary.email },
          correlationId: input.correlationId,
        },
      );
    }
  }

    await invalidateSearchIndex(deps, event.id);

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
      // Dual-read (F2): prefer the frozen rich doc, fall back to legacy text.
      thankYouRich: readRichTextValue(
        version.thankYouRichJson,
        version.thankYouMd,
      ),
    },
  };
}

export type UploadCfpFileInput = CfpFileUploadBody & {
  slug: string;
  correlationId: string;
};

/**
 * Public CFP supporting file upload (allowlist + size), FORM-PINNED to the
 * ACTIVE public form: the request must name the exact form version that
 * Form.GetPublic currently serves for the slug (findActivePublicForm — the
 * same resolution, never re-implemented) and the exact file-typed field the
 * upload answers. Any other published version — an older republished window,
 * a superseded logical form — is rejected, so a stale-but-open version can
 * never keep an anonymous D1 blob-write surface alive.
 *
 * The authorization is PERSISTED on the asset (form_version_id + field_key,
 * migration 0033) and Submission.Create re-checks it: the stored binding
 * must equal the submission's pinned version and the answering field, so an
 * asset authorized via one form/field cannot be replayed against another.
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

  // Pin: uploads bind to the ACTIVE public form version — the exact one
  // Form.GetPublic serves for this slug (same resolution, never a copy).
  // Older published versions/forms of the event are rejected outright.
  const active = await findActivePublicForm(deps.forms, event.id);
  const version = active?.version ?? null;
  if (!version) {
    return {
      ok: false,
      status: 400,
      error: "This event has no published CFP form",
      code: "VALIDATION_ERROR",
      details: { formVersionId: input.formVersionId, reason: "no_active_form" },
    };
  }
  if (version.id !== input.formVersionId) {
    return {
      ok: false,
      status: 400,
      error: "Wrong form_version_id pin; use the active published version",
      code: "VALIDATION_ERROR",
      details: {
        formVersionId: input.formVersionId,
        expectedFormVersionId: version.id,
      },
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

  // The named fieldKey must be a file-typed input field on the ACTIVE
  // version. No file field → no anonymous upload surface (400).
  const versionFields = await deps.forms.listFields(version.id);
  const fileFields = versionFields.filter(
    (f) => isInputNode(f) && f.type === "file",
  );
  const target = fileFields.find((f) => f.fieldKey === input.fieldKey);
  if (!target) {
    return {
      ok: false,
      status: 400,
      error:
        fileFields.length === 0
          ? "This form does not accept file uploads"
          : "This form field does not accept file uploads",
      code: "VALIDATION_ERROR",
      details: { fieldKey: input.fieldKey, formVersionId: version.id },
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
    // Persisted authorization (0033): submit requires this exact binding.
    formVersionId: version.id,
    fieldKey: target.fieldKey,
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
      formVersionId: version.id,
      fieldKey: target.fieldKey,
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
  const draftMaxSpeakers = version.maxSpeakers ?? CFP_MAX_SPEAKERS;
  if (speakers.length > draftMaxSpeakers) {
    return {
      ok: false,
      status: 400,
      error: `At most ${draftMaxSpeakers} speaker${draftMaxSpeakers === 1 ? "" : "s"} allowed on this form`,
      code: "VALIDATION_ERROR",
      details: { maxSpeakers: draftMaxSpeakers, count: speakers.length },
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

  // Published input field keys only — strip unknown / hidden / layout noise
  // (no required gate; layout nodes never take answers).
  const fields = (await deps.forms.listFields(version.id)) as Array<{
    fieldKey: string;
    type?: string;
    nodeKind?: string;
  }>;
  const allowedKeys = new Set(
    fields.filter((f) => isInputNode(f)).map((f) => f.fieldKey),
  );
  const richTextKeys = new Set(
    fields
      .filter((f) => isInputNode(f) && f.type === "rich_text")
      .map((f) => f.fieldKey),
  );
  const storedAnswers: Array<{ fieldKey: string; value: unknown }> = [];
  for (const a of input.answers ?? []) {
    if (!allowedKeys.has(a.fieldKey)) continue;
    // Drafts skip required/maxChars gates, but a rich_text answer must
    // still be a valid publicAnswer doc (caps + link allowlist) — REJECT,
    // never strip (F2/E4).
    if (richTextKeys.has(a.fieldKey) && a.value != null && a.value !== "") {
      const parsedDoc = richTextPublicAnswerSchema.safeParse(a.value);
      if (!parsedDoc.success) {
        return {
          ok: false,
          status: 400,
          error: "Rich-text draft answers must be valid rich-text docs",
          code: "VALIDATION_ERROR",
          details: {
            fieldKey: a.fieldKey,
            issues: parsedDoc.error.flatten(),
          },
        };
      }
      storedAnswers.push({ fieldKey: a.fieldKey, value: parsedDoc.data });
      continue;
    }
    // F2-02: non-rich draft answers must not store arbitrary objects (same
    // smuggle path as final submit — admin/CSV shape-sniffs rich envelopes).
    if (
      !richTextKeys.has(a.fieldKey) &&
      a.value !== null &&
      typeof a.value === "object" &&
      !Array.isArray(a.value)
    ) {
      return {
        ok: false,
        status: 400,
        error: "Draft answers for non-rich fields must not be objects",
        code: "VALIDATION_ERROR",
        details: { fieldKey: a.fieldKey },
      };
    }
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
        // Draft path stores the optional seed fields too (Wave 2).
        bio: sp.bio?.trim() ? sp.bio.trim() : null,
        company: sp.company?.trim() ? sp.company.trim() : null,
        title: sp.title?.trim() ? sp.title.trim() : null,
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
      // Draft path stores the optional seed fields too (Wave 2).
      bio: sp.bio?.trim() ? sp.bio.trim() : null,
      company: sp.company?.trim() ? sp.company.trim() : null,
      title: sp.title?.trim() ? sp.title.trim() : null,
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

    await invalidateSearchIndex(deps, event.id);

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
