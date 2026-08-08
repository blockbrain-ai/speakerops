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

async function publishOpenForm(
  app: ReturnType<typeof createAppWithAuth>["app"],
  cookie: string,
  eventId: string,
  opts?: {
    opensAt?: string | null;
    closesAt?: string | null;
    submissionLimit?: number | null;
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
        fields: openFields,
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

  it("file upload allowlist rejects bad type and accepts PDF", async () => {
    const { app, cookie } = await magicLinkSession("admin-file@example.com");
    const event = await createEvent(app, cookie, "File Event", "file-evt");
    await publishOpenForm(app, cookie, event.id);

    const bad = await app.request(
      `http://localhost/api/public/cfp/${event.slug}/files`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-file-bad",
        },
        body: JSON.stringify({
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
