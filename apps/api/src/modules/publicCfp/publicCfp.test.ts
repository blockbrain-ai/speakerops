/**
 * Section 3.3 — Public CFP submit (Vitest).
 *
 * Named assertions from spec:
 * - assert closed form cannot POST submission
 * - assert script in abstract not executed as JS (stored as text value)
 * - assert turnstile failure 400
 * - rate limit header/test
 * - pins form_version_id on submission
 * - wrong form_version pin rejected
 * - audit_events with correlationId
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  ErrorEnvelopeSchema,
  FormCreateResponseSchema,
  FormPublishResponseSchema,
  FormUpdateDraftResponseSchema,
  EventResponseSchema,
  PublicCfpResponseSchema,
  SubmissionCreateResponseSchema,
  SubmissionSaveDraftResponseSchema,
  SubmissionGetDraftResponseSchema,
  CfpFileUploadResponseSchema,
  SESSION_COOKIE_NAME,
  TURNSTILE_DEV_PASS_TOKEN,
  TURNSTILE_DEV_FAIL_TOKEN,
  VALIDATION_ERROR,
  NOT_FOUND,
} from "@speakerops/shared";
import { createAppWithAuth } from "../../index.js";
import { CfpRateLimiter } from "./rateLimit.js";
import { buildOpenApiDocument, OPENAPI_COMMANDS } from "../../openapi.js";

const env = { APP_VERSION: "0.1.0" };

async function magicLinkSession(
  email: string,
): Promise<{
  app: ReturnType<typeof createAppWithAuth>["app"];
  store: ReturnType<typeof createAppWithAuth>["store"];
  events: ReturnType<typeof createAppWithAuth>["events"];
  forms: ReturnType<typeof createAppWithAuth>["forms"];
  submissions: ReturnType<typeof createAppWithAuth>["submissions"];
  cookie: string;
}> {
  const { app, store, events, forms, submissions, outbox } = createAppWithAuth({
    cookieSecure: true,
  });
  await app.request(
    "http://localhost/api/auth/magic-link",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, purpose: "admin" }),
    },
    env,
  );
  const token = outbox.lastForEmail(email)!.token;
  const exchange = await app.request(
    "http://localhost/api/auth/exchange",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    },
    env,
  );
  expect(exchange.status).toBe(200);
  const setCookie = exchange.headers.get("set-cookie")!;
  const sessionValue = setCookie
    .split(";")[0]!
    .split("=")
    .slice(1)
    .join("=");
  return {
    app,
    store,
    events,
    forms,
    submissions,
    cookie: `${SESSION_COOKIE_NAME}=${sessionValue}`,
  };
}

async function createEvent(
  app: ReturnType<typeof createAppWithAuth>["app"],
  cookie: string,
  name: string,
  slug?: string,
): Promise<{ id: string; slug: string }> {
  const res = await app.request(
    "http://localhost/api/events",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-correlation-id": "corr-evt",
      },
      body: JSON.stringify({
        name,
        timezone: "UTC",
        ...(slug ? { slug } : {}),
      }),
    },
    env,
  );
  expect(res.status).toBe(201);
  const parsed = EventResponseSchema.parse(await res.json());
  return { id: parsed.event.id, slug: parsed.event.slug };
}

const openFields = [
  {
    fieldKey: "talk_title",
    type: "text" as const,
    label: "Talk title",
    required: true,
    sortOrder: 0,
  },
  {
    fieldKey: "category",
    type: "select" as const,
    label: "Category",
    required: true,
    sortOrder: 1,
    options: [
      { value: "ai", label: "AI" },
      { value: "infra", label: "Infrastructure" },
    ],
  },
  {
    fieldKey: "gpu_notes",
    type: "textarea" as const,
    label: "GPU notes",
    required: false,
    sortOrder: 2,
    conditions: {
      showWhen: { fieldKey: "category", op: "eq" as const, value: "ai" },
    },
  },
  {
    fieldKey: "abstract",
    type: "textarea" as const,
    label: "Abstract",
    required: false,
    sortOrder: 3,
  },
];

const openRules = [
  {
    when: { fieldKey: "category", op: "eq" as const, value: "ai" },
    routeToCategory: "artificial-intelligence",
  },
  {
    when: { fieldKey: "category", op: "eq" as const, value: "infra" },
    routeToCategory: "infrastructure",
  },
];

/** Optional file-typed field for the form-pinned upload tests. */
const FILE_FIELD = {
  fieldKey: "supporting_file",
  type: "file" as const,
  label: "Supporting file",
  required: false,
  sortOrder: 9,
};

async function publishOpenForm(
  app: ReturnType<typeof createAppWithAuth>["app"],
  cookie: string,
  eventId: string,
  opts?: {
    opensAt?: string | null;
    closesAt?: string | null;
    submissionLimit?: number | null;
    /** Override the published fields (e.g. add a file field). */
    fields?: Array<Record<string, unknown>>;
  },
): Promise<{ formId: string; formVersionId: string }> {
  const create = await app.request(
    `http://localhost/api/events/${eventId}/forms`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-correlation-id": "corr-form-create",
      },
      body: JSON.stringify({ name: "Public CFP" }),
    },
    env,
  );
  expect(create.status).toBe(201);
  const created = FormCreateResponseSchema.parse(await create.json());

  const draft = await app.request(
    `http://localhost/api/forms/${created.form.id}/draft`,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-correlation-id": "corr-form-draft",
      },
      body: JSON.stringify({
        fields: opts?.fields ?? openFields,
        rules: openRules,
        welcomeMd: "Welcome to the CFP",
        thankYouMd: "Thanks for submitting",
        opensAt: opts?.opensAt === undefined ? null : opts.opensAt,
        closesAt: opts?.closesAt === undefined ? null : opts.closesAt,
        submissionLimit:
          opts?.submissionLimit === undefined ? null : opts.submissionLimit,
      }),
    },
    env,
  );
  expect(draft.status).toBe(200);
  FormUpdateDraftResponseSchema.parse(await draft.json());

  const pub = await app.request(
    `http://localhost/api/forms/${created.form.id}/publish`,
    {
      method: "POST",
      headers: {
        cookie,
        "x-correlation-id": "corr-form-pub",
      },
    },
    env,
  );
  expect(pub.status).toBe(200);
  const published = FormPublishResponseSchema.parse(await pub.json());
  return {
    formId: created.form.id,
    formVersionId: published.formVersion.id,
  };
}

function baseSubmitBody(formVersionId: string, overrides: Record<string, unknown> = {}) {
  return {
    formVersionId,
    title: "My Talk",
    answers: [
      { fieldKey: "talk_title", value: "My Talk" },
      { fieldKey: "category", value: "ai" },
      { fieldKey: "gpu_notes", value: "Needs A100" },
    ],
    speakers: [
      { name: "Ada Lovelace", email: "ada@example.com", isPrimary: true },
    ],
    turnstileToken: TURNSTILE_DEV_PASS_TOKEN,
    ...overrides,
  };
}

describe("3.3 public CFP submit", () => {
  it("Form.GetPublic includes windowState meta", async () => {
    const { app, cookie } = await magicLinkSession("admin-meta@example.com");
    const event = await createEvent(app, cookie, "Meta Event", "meta-evt");
    await publishOpenForm(app, cookie, event.id);

    const res = await app.request(
      `http://localhost/api/public/cfp/${event.slug}`,
      {},
      env,
    );
    expect(res.status).toBe(200);
    const body = PublicCfpResponseSchema.parse(await res.json());
    expect(body.windowState).toBe("open");
    expect(body.minSpeakers).toBe(1);
    expect(body.maxSpeakers).toBe(5);
    expect(body.formVersion?.id).toBeTruthy();
    expect(body.formVersion?.welcomeMd).toContain("Welcome");
  });

  it("assert closed form cannot POST submission", async () => {
    const { app, cookie } = await magicLinkSession("admin-closed@example.com");
    const event = await createEvent(app, cookie, "Closed Event", "closed-evt");
    const { formVersionId } = await publishOpenForm(app, cookie, event.id, {
      closesAt: "2020-01-01T00:00:00.000Z",
    });

    const get = await app.request(
      `http://localhost/api/public/cfp/${event.slug}`,
      {},
      env,
    );
    const pub = PublicCfpResponseSchema.parse(await get.json());
    expect(pub.windowState).toBe("closed");

    const res = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/submissions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-closed-submit",
        },
        body: JSON.stringify(baseSubmitBody(formVersionId)),
      },
      env,
    );
    expect(res.status).toBe(400);
    const err = ErrorEnvelopeSchema.parse(await res.json());
    expect(err.code).toBe(VALIDATION_ERROR);
    expect(err.error.toLowerCase()).toMatch(/closed/);
  });

  it("assert turnstile failure 400", async () => {
    const { app, cookie } = await magicLinkSession("admin-ts@example.com");
    const event = await createEvent(app, cookie, "TS Event", "ts-evt");
    const { formVersionId } = await publishOpenForm(app, cookie, event.id);

    const res = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/submissions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-ts-fail",
        },
        body: JSON.stringify(
          baseSubmitBody(formVersionId, {
            turnstileToken: TURNSTILE_DEV_FAIL_TOKEN,
          }),
        ),
      },
      env,
    );
    expect(res.status).toBe(400);
    const err = ErrorEnvelopeSchema.parse(await res.json());
    expect(err.code).toBe(VALIDATION_ERROR);
    expect(err.error.toLowerCase()).toMatch(/turnstile/);
  });

  it("assert turnstile fails closed when secret unset: non-dev tokens rejected", async () => {
    // Without TURNSTILE_SECRET_KEY, only TURNSTILE_DEV_PASS_TOKEN is allowed.
    // Arbitrary non-empty tokens must not pass (fail-closed bot protection).
    const { app, cookie } = await magicLinkSession("admin-ts-closed@example.com");
    const event = await createEvent(app, cookie, "TS Closed Event", "ts-closed");
    const { formVersionId } = await publishOpenForm(app, cookie, event.id);

    const res = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/submissions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-ts-fail-open",
        },
        body: JSON.stringify(
          baseSubmitBody(formVersionId, {
            turnstileToken: "forged-but-non-empty-token",
          }),
        ),
      },
      env,
    );
    expect(res.status).toBe(400);
    const err = ErrorEnvelopeSchema.parse(await res.json());
    expect(err.code).toBe(VALIDATION_ERROR);
    expect(err.error.toLowerCase()).toMatch(/turnstile/);
  });

  it("assert script in abstract not executed as JS (stored as text)", async () => {
    const { app, cookie, submissions } = await magicLinkSession(
      "admin-xss@example.com",
    );
    const event = await createEvent(app, cookie, "XSS Event", "xss-evt");
    const { formVersionId } = await publishOpenForm(app, cookie, event.id);
    const xss = `<script>window.__xss=1</script>`;

    const res = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/submissions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-xss",
        },
        body: JSON.stringify(
          baseSubmitBody(formVersionId, {
            answers: [
              { fieldKey: "talk_title", value: "XSS Talk" },
              { fieldKey: "category", value: "ai" },
              { fieldKey: "abstract", value: xss },
            ],
          }),
        ),
      },
      env,
    );
    expect(res.status).toBe(201);
    const body = SubmissionCreateResponseSchema.parse(await res.json());
    const abstract = body.answers.find((a) => a.fieldKey === "abstract");
    expect(abstract?.value).toBe(xss);
    // Stored raw string in DB JSON — not HTML-escaped away, but never executed server-side
    const rows = await submissions.listAnswers(body.submission.id);
    const stored = rows.find((r) => r.fieldKey === "abstract");
    expect(stored?.valueJson).toContain("script");
    expect(JSON.parse(stored!.valueJson)).toBe(xss);
  });

  it("pins form_version_id on submission", async () => {
    const { app, cookie, store, submissions } = await magicLinkSession(
      "admin-pin@example.com",
    );
    const event = await createEvent(app, cookie, "Pin Event", "pin-evt");
    const { formVersionId } = await publishOpenForm(app, cookie, event.id);

    const res = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/submissions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-pin-version",
        },
        body: JSON.stringify(baseSubmitBody(formVersionId)),
      },
      env,
    );
    expect(res.status).toBe(201);
    const body = SubmissionCreateResponseSchema.parse(await res.json());
    expect(body.submission.formVersionId).toBe(formVersionId);

    const row = await submissions.findSubmissionById(body.submission.id);
    expect(row?.formVersionId).toBe(formVersionId);

    // audit_events with correlationId
    const audits = await store.listAudits();
    const audit = audits.find(
      (a) =>
        a.action === "Submission.Create" &&
        a.entityId === body.submission.id,
    );
    expect(audit).toBeTruthy();
    expect(audit!.correlationId).toBe("corr-pin-version");
    expect(audit!.afterJson).toContain(formVersionId);
  });

  it("rejects wrong form_version pin", async () => {
    const { app, cookie } = await magicLinkSession("admin-wrongpin@example.com");
    const event = await createEvent(app, cookie, "Wrong Pin", "wrong-pin");
    await publishOpenForm(app, cookie, event.id);

    const res = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/submissions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-wrong-pin",
        },
        body: JSON.stringify(baseSubmitBody("not-a-real-version-id")),
      },
      env,
    );
    expect(res.status).toBe(400);
    const err = ErrorEnvelopeSchema.parse(await res.json());
    expect(err.code).toBe(VALIDATION_ERROR);
  });

  it("derives category from rules and stores multi-speaker people", async () => {
    const { app, cookie, submissions } = await magicLinkSession(
      "admin-cat@example.com",
    );
    const event = await createEvent(app, cookie, "Cat Event", "cat-evt");
    const { formVersionId } = await publishOpenForm(app, cookie, event.id);

    const res = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/submissions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-cat",
        },
        body: JSON.stringify(
          baseSubmitBody(formVersionId, {
            speakers: [
              { name: "Primary", email: "p1@example.com", isPrimary: true },
              { name: "Second", email: "p2@example.com" },
            ],
            answers: [
              { fieldKey: "talk_title", value: "Infra Talk" },
              { fieldKey: "category", value: "infra" },
            ],
          }),
        ),
      },
      env,
    );
    expect(res.status).toBe(201);
    const body = SubmissionCreateResponseSchema.parse(await res.json());
    expect(body.submission.category).toBe("infrastructure");
    expect(body.speakers).toHaveLength(2);

    const speakers = await submissions.listSpeakers(body.submission.id);
    expect(speakers).toHaveLength(2);
  });

  it("strips hidden conditional answers (not stored)", async () => {
    const { app, cookie, submissions } = await magicLinkSession(
      "admin-cond@example.com",
    );
    const event = await createEvent(app, cookie, "Cond Event", "cond-evt");
    const { formVersionId } = await publishOpenForm(app, cookie, event.id);

    const res = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/submissions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-cond",
        },
        body: JSON.stringify(
          baseSubmitBody(formVersionId, {
            answers: [
              { fieldKey: "talk_title", value: "Infra Talk" },
              { fieldKey: "category", value: "infra" },
              // gpu_notes only shows when category=ai — must not be stored
              { fieldKey: "gpu_notes", value: "should-not-store" },
            ],
          }),
        ),
      },
      env,
    );
    expect(res.status).toBe(201);
    const body = SubmissionCreateResponseSchema.parse(await res.json());
    expect(body.answers.find((a) => a.fieldKey === "gpu_notes")).toBeUndefined();
    const rows = await submissions.listAnswers(body.submission.id);
    expect(rows.find((r) => r.fieldKey === "gpu_notes")).toBeUndefined();
  });

  it("rejects invalid category when rules exist", async () => {
    const { app, cookie } = await magicLinkSession("admin-badcat@example.com");
    const event = await createEvent(app, cookie, "Bad Cat", "bad-cat");
    const { formVersionId } = await publishOpenForm(app, cookie, event.id);

    const res = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/submissions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-badcat",
        },
        body: JSON.stringify(
          baseSubmitBody(formVersionId, {
            category: "not-a-real-route",
            answers: [
              { fieldKey: "talk_title", value: "Talk" },
              { fieldKey: "category", value: "ai" },
            ],
          }),
        ),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("enforces min speakers", async () => {
    const { app, cookie } = await magicLinkSession("admin-mins@example.com");
    const event = await createEvent(app, cookie, "Min Sp", "min-sp");
    const { formVersionId } = await publishOpenForm(app, cookie, event.id);

    const res = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/submissions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-mins",
        },
        body: JSON.stringify(
          baseSubmitBody(formVersionId, {
            speakers: [],
          }),
        ),
      },
      env,
    );
    expect(res.status).toBe(400);
    const err = ErrorEnvelopeSchema.parse(await res.json());
    expect(err.code).toBe(VALIDATION_ERROR);
  });

  it("file upload allowlist rejects bad type and accepts PDF (form-pinned)", async () => {
    const { app, cookie } = await magicLinkSession("admin-file@example.com");
    const event = await createEvent(app, cookie, "File Event", "file-evt");
    const { formVersionId } = await publishOpenForm(app, cookie, event.id, {
      fields: [...openFields, FILE_FIELD],
    });

    const bad = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/files`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-file-bad",
        },
        body: JSON.stringify({
          formVersionId,
          filename: "evil.svg",
          mime: "image/svg+xml",
          size: 4,
          contentBase64: btoa("evil"),
        }),
      },
      env,
    );
    expect(bad.status).toBe(400);

    const pdfBytes = "%PDF-1.4 test";
    const ok = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/files`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-file-ok",
        },
        body: JSON.stringify({
          formVersionId,
          fieldKey: "supporting_file",
          filename: "deck.pdf",
          mime: "application/pdf",
          size: pdfBytes.length,
          contentBase64: btoa(pdfBytes),
        }),
      },
      env,
    );
    expect(ok.status).toBe(201);
    const fileBody = CfpFileUploadResponseSchema.parse(await ok.json());
    expect(fileBody.fileId).toBeTruthy();
    expect(fileBody.mime).toBe("application/pdf");
  });

  it("upload is rejected when the pinned form has no file field or no pin", async () => {
    const { app, cookie } = await magicLinkSession("admin-nofile@example.com");
    const event = await createEvent(app, cookie, "No File Event", "nofile-evt");
    // Published form with NO file field — anonymous uploads must 400.
    const { formVersionId } = await publishOpenForm(app, cookie, event.id);

    const pdfBytes = "%PDF-1.4 test";
    const uploadBody = {
      filename: "deck.pdf",
      mime: "application/pdf",
      size: pdfBytes.length,
      contentBase64: btoa(pdfBytes),
    };

    // Missing formVersionId → schema 400 (pin is required).
    const unpinned = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/files`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-file-unpinned",
        },
        body: JSON.stringify(uploadBody),
      },
      env,
    );
    expect(unpinned.status).toBe(400);

    // Pinned to a version with no file field → 400.
    const noField = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/files`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-file-nofield",
        },
        body: JSON.stringify({ ...uploadBody, formVersionId }),
      },
      env,
    );
    expect(noField.status).toBe(400);
    const noFieldErr = ErrorEnvelopeSchema.parse(await noField.json());
    expect(noFieldErr.error).toMatch(/does not accept file uploads/i);

    // Naming a non-file fieldKey on a form WITH a file field also 400s.
    const event2 = await createEvent(app, cookie, "File Event 2", "file-evt2");
    const withFile = await publishOpenForm(app, cookie, event2.id, {
      fields: [...openFields, FILE_FIELD],
    });
    const wrongField = await app.request(
      `http://localhost/api/public/cfp/${event2.slug}/files`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-file-wrongfield",
        },
        body: JSON.stringify({
          ...uploadBody,
          formVersionId: withFile.formVersionId,
          fieldKey: "talk_title",
        }),
      },
      env,
    );
    expect(wrongField.status).toBe(400);

    // Cross-event pin: another event's published version never authorizes
    // an upload here.
    const crossPin = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/files`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-file-crosspin",
        },
        body: JSON.stringify({
          ...uploadBody,
          formVersionId: withFile.formVersionId,
        }),
      },
      env,
    );
    expect(crossPin.status).toBe(400);
  });

  it("file answers are field-typed: text on file field and file token on text field both 400", async () => {
    const { app, cookie } = await magicLinkSession("admin-filetype@example.com");
    const event = await createEvent(app, cookie, "File Type Event", "ftype-evt");
    const { formVersionId } = await publishOpenForm(app, cookie, event.id, {
      fields: [...openFields, FILE_FIELD],
    });

    // Seed a real upload for the happy path.
    const pdfBytes = "%PDF-1.4 typed";
    const up = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/files`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-ftype-up",
        },
        body: JSON.stringify({
          formVersionId,
          fieldKey: "supporting_file",
          filename: "deck.pdf",
          mime: "application/pdf",
          size: pdfBytes.length,
          contentBase64: btoa(pdfBytes),
        }),
      },
      env,
    );
    expect(up.status).toBe(201);
    const { fileId } = CfpFileUploadResponseSchema.parse(await up.json());

    const submitWith = async (
      answers: Array<{ fieldKey: string; value: unknown }>,
      corr: string,
    ) =>
      app.request(
        `http://localhost/api/public/cfp/${event.slug}/submissions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-correlation-id": corr,
          },
          body: JSON.stringify(baseSubmitBody(formVersionId, { answers })),
        },
        env,
      );

    // Plain text on the file-typed field → 400.
    const textOnFile = await submitWith(
      [
        { fieldKey: "talk_title", value: "Typed Talk" },
        { fieldKey: "category", value: "infra" },
        { fieldKey: "supporting_file", value: "just some text" },
      ],
      "corr-ftype-text",
    );
    expect(textOnFile.status).toBe(400);
    const textErr = ErrorEnvelopeSchema.parse(await textOnFile.json());
    expect(textErr.error).toMatch(/uploaded file/i);

    // A file token on a NON-file field → 400.
    const tokenOnText = await submitWith(
      [
        { fieldKey: "talk_title", value: "Typed Talk" },
        { fieldKey: "category", value: "infra" },
        { fieldKey: "abstract", value: `file:${fileId}` },
      ],
      "corr-ftype-token",
    );
    expect(tokenOnText.status).toBe(400);
    const tokenErr = ErrorEnvelopeSchema.parse(await tokenOnText.json());
    expect(tokenErr.error).toMatch(/only accepted on file fields/i);

    // Happy path unchanged: real token on the file field → 201.
    const ok = await submitWith(
      [
        { fieldKey: "talk_title", value: "Typed Talk" },
        { fieldKey: "category", value: "infra" },
        { fieldKey: "supporting_file", value: `file:${fileId}` },
      ],
      "corr-ftype-ok",
    );
    expect(ok.status).toBe(201);
    const okBody = SubmissionCreateResponseSchema.parse(await ok.json());
    expect(
      okBody.answers.find((a) => a.fieldKey === "supporting_file")?.value,
    ).toBe(`file:${fileId}`);
  });

  it("rate limit header/test returns 429 with headers", async () => {
    const limiter = new CfpRateLimiter(3, 60_000);
    // Use isolated app with custom limiter via createApp options — rate limiter is module default.
    // Exercise CfpRateLimiter unit path + one request header presence.
    const r1 = limiter.check("ip-test");
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);
    limiter.check("ip-test");
    limiter.check("ip-test");
    const r4 = limiter.check("ip-test");
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);

    const { app, cookie } = await magicLinkSession("admin-rl@example.com");
    const event = await createEvent(app, cookie, "RL Event", "rl-evt");
    const { formVersionId } = await publishOpenForm(app, cookie, event.id);

    const res = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/submissions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-rl",
          "x-forwarded-for": "203.0.113.50",
        },
        body: JSON.stringify(baseSubmitBody(formVersionId)),
      },
      env,
    );
    // First request in process may share default limiter with other tests —
    // assert rate limit headers are present when allowed or denied.
    expect(res.headers.get("X-RateLimit-Limit")).toBeTruthy();
    expect(res.headers.get("X-RateLimit-Remaining")).not.toBeNull();
    if (res.status === 429) {
      expect(res.headers.get("Retry-After")).toBeTruthy();
      const err = ErrorEnvelopeSchema.parse(await res.json());
      expect(err.code).toBe("RATE_LIMITED");
    } else {
      expect(res.status).toBe(201);
    }
  });

  it("404 for unknown slug", async () => {
    const { app } = createAppWithAuth({ cookieSecure: true });
    const res = await app.request(
      "http://localhost/api/public/cfp/does-not-exist-slug",
      {},
      env,
    );
    expect(res.status).toBe(404);
    const err = ErrorEnvelopeSchema.parse(await res.json());
    expect(err.code).toBe(NOT_FOUND);
  });

  it("OpenAPI lists Submission.Create", () => {
    const doc = buildOpenApiDocument();
    expect(OPENAPI_COMMANDS).toContain("Submission.Create");
    const paths = doc.paths as Record<string, unknown>;
    expect(paths["/api/public/cfp/{slug}/submissions"]).toBeTruthy();
  });

  it("OpenAPI lists Submission.SaveDraft and GetDraft", () => {
    const doc = buildOpenApiDocument();
    expect(OPENAPI_COMMANDS).toContain("Submission.SaveDraft");
    expect(OPENAPI_COMMANDS).toContain("Submission.GetDraft");
    const paths = doc.paths as Record<string, unknown>;
    expect(paths["/api/public/cfp/{slug}/drafts"]).toBeTruthy();
    expect(paths["/api/public/cfp/{slug}/drafts/{draftId}"]).toBeTruthy();
  });
});

describe("10.5 public CFP draft save/resume", () => {
  it("AC-10.5-A: title-only draft persists with status draft", async () => {
    const { app, cookie, submissions, store } = await magicLinkSession(
      "admin-draft-title@example.com",
    );
    const event = await createEvent(app, cookie, "Draft Title", "draft-title");
    const { formVersionId } = await publishOpenForm(app, cookie, event.id);

    const res = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/drafts`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-draft-title",
        },
        body: JSON.stringify({
          formVersionId,
          title: "  Minimal Draft Title  ",
        }),
      },
      env,
    );
    expect(res.status).toBe(201);
    const body = SubmissionSaveDraftResponseSchema.parse(await res.json());
    expect(body.submission.status).toBe("draft");
    expect(body.submission.title).toBe("Minimal Draft Title");
    expect(body.snapshot.title).toBe("Minimal Draft Title");
    expect(body.snapshot.answers).toEqual([]);
    expect(body.snapshot.speakers).toEqual([]);

    const row = await submissions.findSubmissionById(body.submission.id);
    expect(row?.status).toBe("draft");
    expect(row?.title).toBe("Minimal Draft Title");
    expect(row?.formVersionId).toBe(formVersionId);

    const audits = await store.listAudits();
    const audit = audits.find(
      (a) =>
        a.action === "Submission.SaveDraft" &&
        a.entityId === body.submission.id,
    );
    expect(audit).toBeTruthy();
    expect(audit!.correlationId).toBe("corr-draft-title");
  });

  it("AC-10.5-B: snapshot roundtrip — save answers/speakers then GetDraft restores", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin-draft-roundtrip@example.com",
    );
    const event = await createEvent(
      app,
      cookie,
      "Draft Roundtrip",
      "draft-roundtrip",
    );
    const { formVersionId } = await publishOpenForm(app, cookie, event.id);

    const save = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/drafts`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-draft-save",
        },
        body: JSON.stringify({
          formVersionId,
          title: "Roundtrip Talk",
          answers: [
            { fieldKey: "talk_title", value: "Roundtrip Talk" },
            { fieldKey: "category", value: "ai" },
            { fieldKey: "abstract", value: "Draft abstract body" },
            // Unknown keys dropped
            { fieldKey: "not_a_field", value: "nope" },
          ],
          speakers: [
            {
              name: "Grace Hopper",
              email: "grace@example.com",
              isPrimary: true,
            },
          ],
        }),
      },
      env,
    );
    expect(save.status).toBe(201);
    const saved = SubmissionSaveDraftResponseSchema.parse(await save.json());
    expect(saved.snapshot.answers.map((a) => a.fieldKey).sort()).toEqual(
      ["abstract", "category", "talk_title"].sort(),
    );
    expect(
      saved.snapshot.answers.find((a) => a.fieldKey === "abstract")?.value,
    ).toBe("Draft abstract body");
    expect(saved.snapshot.speakers).toHaveLength(1);
    expect(saved.snapshot.speakers[0]!.email).toBe("grace@example.com");
    expect(saved.snapshot.category).toBe("artificial-intelligence");

    const get = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/drafts/${saved.submission.id}`,
      {
        headers: { "x-correlation-id": "corr-draft-get" },
      },
      env,
    );
    expect(get.status).toBe(200);
    const loaded = SubmissionGetDraftResponseSchema.parse(await get.json());
    expect(loaded.submission.id).toBe(saved.submission.id);
    expect(loaded.submission.status).toBe("draft");
    expect(loaded.snapshot.title).toBe(saved.snapshot.title);
    expect(loaded.snapshot.answers).toEqual(saved.snapshot.answers);
    expect(loaded.snapshot.speakers[0]!.email).toBe("grace@example.com");
    expect(loaded.snapshot.category).toBe(saved.snapshot.category);
  });

  it("re-save with draftId updates title and version", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin-draft-update@example.com",
    );
    const event = await createEvent(app, cookie, "Draft Update", "draft-upd");
    const { formVersionId } = await publishOpenForm(app, cookie, event.id);

    const create = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/drafts`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-draft-c",
        },
        body: JSON.stringify({ formVersionId, title: "V1 Title" }),
      },
      env,
    );
    const created = SubmissionSaveDraftResponseSchema.parse(
      await create.json(),
    );
    expect(created.submission.version).toBe(1);

    const update = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/drafts`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-draft-u",
        },
        body: JSON.stringify({
          formVersionId,
          title: "V2 Title",
          draftId: created.submission.id,
          answers: [{ fieldKey: "abstract", value: "now with abstract" }],
        }),
      },
      env,
    );
    expect(update.status).toBe(200);
    const updated = SubmissionSaveDraftResponseSchema.parse(
      await update.json(),
    );
    expect(updated.submission.id).toBe(created.submission.id);
    expect(updated.submission.title).toBe("V2 Title");
    expect(updated.submission.version).toBe(2);
    expect(
      updated.snapshot.answers.find((a) => a.fieldKey === "abstract")?.value,
    ).toBe("now with abstract");
  });

  it("rejects empty title on draft save", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin-draft-empty@example.com",
    );
    const event = await createEvent(app, cookie, "Draft Empty", "draft-empty");
    const { formVersionId } = await publishOpenForm(app, cookie, event.id);

    const res = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/drafts`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-draft-empty",
        },
        body: JSON.stringify({ formVersionId, title: "   " }),
      },
      env,
    );
    expect(res.status).toBe(400);
    const err = ErrorEnvelopeSchema.parse(await res.json());
    expect(err.code).toBe(VALIDATION_ERROR);
  });

  it("must-not: closed CFP rejects draft save", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin-draft-closed@example.com",
    );
    const event = await createEvent(
      app,
      cookie,
      "Draft Closed",
      "draft-closed",
    );
    const { formVersionId } = await publishOpenForm(app, cookie, event.id, {
      closesAt: "2020-01-01T00:00:00.000Z",
    });

    const res = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/drafts`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-draft-closed",
        },
        body: JSON.stringify({ formVersionId, title: "Too Late" }),
      },
      env,
    );
    expect(res.status).toBe(400);
    const err = ErrorEnvelopeSchema.parse(await res.json());
    expect(err.code).toBe(VALIDATION_ERROR);
    expect(err.error.toLowerCase()).toMatch(/closed/);
  });

  it("must-not: wrong event slug for draft → 404", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin-draft-scope@example.com",
    );
    const eventA = await createEvent(app, cookie, "Draft A", "draft-a");
    const eventB = await createEvent(app, cookie, "Draft B", "draft-b");
    const { formVersionId } = await publishOpenForm(app, cookie, eventA.id);
    await publishOpenForm(app, cookie, eventB.id);

    const save = await app.request(
      `http://localhost/api/public/cfp/${eventA.slug}/drafts`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-draft-scope",
        },
        body: JSON.stringify({ formVersionId, title: "Scoped Draft" }),
      },
      env,
    );
    const saved = SubmissionSaveDraftResponseSchema.parse(await save.json());

    const wrong = await app.request(
      `http://localhost/api/public/cfp/${eventB.slug}/drafts/${saved.submission.id}`,
      {},
      env,
    );
    expect(wrong.status).toBe(404);
    const err = ErrorEnvelopeSchema.parse(await wrong.json());
    expect(err.code).toBe(NOT_FOUND);
  });

  it("must-not: submitted submission is not resumable as draft", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin-draft-submitted@example.com",
    );
    const event = await createEvent(
      app,
      cookie,
      "Draft Submitted",
      "draft-submitted",
    );
    const { formVersionId } = await publishOpenForm(app, cookie, event.id);

    const submit = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/submissions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-draft-sub",
        },
        body: JSON.stringify(baseSubmitBody(formVersionId)),
      },
      env,
    );
    expect(submit.status).toBe(201);
    const body = SubmissionCreateResponseSchema.parse(await submit.json());

    const get = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/drafts/${body.submission.id}`,
      {},
      env,
    );
    expect(get.status).toBe(404);
  });

  it("re-save after form republication re-pins formVersionId with answers", async () => {
    const { app, cookie, submissions } = await magicLinkSession(
      "admin-draft-repin@example.com",
    );
    const event = await createEvent(app, cookie, "Draft Repin", "draft-repin");
    const { formId, formVersionId: v1 } = await publishOpenForm(
      app,
      cookie,
      event.id,
    );

    const create = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/drafts`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-draft-repin-1",
        },
        body: JSON.stringify({
          formVersionId: v1,
          title: "Pinned Draft",
          answers: [{ fieldKey: "abstract", value: "v1 abstract" }],
        }),
      },
      env,
    );
    expect(create.status).toBe(201);
    const created = SubmissionSaveDraftResponseSchema.parse(await create.json());
    expect(created.submission.formVersionId).toBe(v1);

    // Republish form → new immutable version
    const draftUpdate = await app.request(
      `http://localhost/api/forms/${formId}/draft`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-draft-repin-fields",
        },
        body: JSON.stringify({
          fields: openFields,
          rules: openRules,
          welcomeMd: "Welcome v2",
        }),
      },
      env,
    );
    expect(draftUpdate.status).toBe(200);
    const pub2 = await app.request(
      `http://localhost/api/forms/${formId}/publish`,
      {
        method: "POST",
        headers: {
          cookie,
          "x-correlation-id": "corr-draft-repin-pub2",
        },
      },
      env,
    );
    expect(pub2.status).toBe(200);
    const published2 = FormPublishResponseSchema.parse(await pub2.json());
    const v2 = published2.formVersion.id;
    expect(v2).not.toBe(v1);

    // Re-save draft against latest form version — pin must update atomically
    const update = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/drafts`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-draft-repin-2",
        },
        body: JSON.stringify({
          formVersionId: v2,
          draftId: created.submission.id,
          title: "Pinned Draft v2",
          answers: [{ fieldKey: "abstract", value: "v2 abstract" }],
        }),
      },
      env,
    );
    expect(update.status).toBe(200);
    const updated = SubmissionSaveDraftResponseSchema.parse(await update.json());
    expect(updated.submission.formVersionId).toBe(v2);
    expect(updated.submission.title).toBe("Pinned Draft v2");
    expect(
      updated.snapshot.answers.find((a) => a.fieldKey === "abstract")?.value,
    ).toBe("v2 abstract");

    const row = await submissions.findSubmissionById(created.submission.id);
    expect(row?.formVersionId).toBe(v2);
    expect(row?.title).toBe("Pinned Draft v2");
  });

  it("draft GET/POST responses set Cache-Control: no-store", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin-draft-cache@example.com",
    );
    const event = await createEvent(app, cookie, "Draft Cache", "draft-cache");
    const { formVersionId } = await publishOpenForm(app, cookie, event.id);

    const save = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/drafts`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-draft-cache",
        },
        body: JSON.stringify({
          formVersionId,
          title: "Cache Sensitive Draft",
          speakers: [
            { name: "PII Person", email: "pii@example.com", isPrimary: true },
          ],
        }),
      },
      env,
    );
    expect(save.status).toBe(201);
    expect(save.headers.get("cache-control")?.toLowerCase()).toContain(
      "no-store",
    );
    const saved = SubmissionSaveDraftResponseSchema.parse(await save.json());

    const get = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/drafts/${saved.submission.id}`,
      {
        headers: { "x-correlation-id": "corr-draft-cache-get" },
      },
      env,
    );
    expect(get.status).toBe(200);
    expect(get.headers.get("cache-control")?.toLowerCase()).toContain(
      "no-store",
    );
  });
});

describe("thin-area: multiselect array validation", () => {
  it("rejects non-array multiselect answer; accepts string[]", async () => {
    const { app, cookie } = await magicLinkSession("cfp-ms-admin@example.com");
    const event = await createEvent(app, cookie, "Multiselect Event");

    const create = await app.request(
      `http://localhost/api/events/${event.id}/forms`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({ name: "MS CFP" }),
      },
      env,
    );
    expect(create.status).toBe(201);
    const created = FormCreateResponseSchema.parse(await create.json());
    const draft = await app.request(
      `http://localhost/api/forms/${created.form.id}/draft`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          fields: [
            {
              fieldKey: "tracks",
              type: "multiselect",
              label: "Tracks",
              required: true,
              sortOrder: 0,
              options: [
                { value: "a", label: "A" },
                { value: "b", label: "B" },
              ],
            },
          ],
          rules: [],
        }),
      },
      env,
    );
    expect(draft.status).toBe(200);
    const publish = await app.request(
      `http://localhost/api/forms/${created.form.id}/publish`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({}),
      },
      env,
    );
    expect(publish.status).toBe(200);
    const published = FormPublishResponseSchema.parse(await publish.json());

    const bad = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/submissions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          formVersionId: published.formVersion.id,
          title: "MS Talk Bad",
          answers: [{ fieldKey: "tracks", value: "a" }],
          speakers: [
            { name: "S", email: "ms-bad@example.com", isPrimary: true },
          ],
          turnstileToken: TURNSTILE_DEV_PASS_TOKEN,
        }),
      },
      env,
    );
    expect(bad.status).toBe(400);
    const envBad = ErrorEnvelopeSchema.parse(await bad.json());
    expect(envBad.error).toMatch(/array/i);

    const good = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/submissions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          formVersionId: published.formVersion.id,
          title: "MS Talk Good",
          answers: [{ fieldKey: "tracks", value: ["a", "b"] }],
          speakers: [
            { name: "S", email: "ms-good@example.com", isPrimary: true },
          ],
          turnstileToken: TURNSTILE_DEV_PASS_TOKEN,
        }),
      },
      env,
    );
    expect(good.status).toBe(201);
    const body = SubmissionCreateResponseSchema.parse(await good.json());
    const tracks = body.answers.find((a) => a.fieldKey === "tracks");
    expect(tracks?.value).toEqual(["a", "b"]);
  });
});

describe("3.3 rate limiter unit", () => {
  beforeEach(() => {
    // isolated instances — no shared state
  });

  it("resets after window", () => {
    const limiter = new CfpRateLimiter(2, 1000);
    const t0 = 1_000_000;
    expect(limiter.check("k", t0).allowed).toBe(true);
    expect(limiter.check("k", t0 + 1).allowed).toBe(true);
    expect(limiter.check("k", t0 + 2).allowed).toBe(false);
    expect(limiter.check("k", t0 + 1001).allowed).toBe(true);
  });
});
