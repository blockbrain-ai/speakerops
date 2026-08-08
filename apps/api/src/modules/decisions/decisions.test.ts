/**
 * Section 3.5 — Decision.Record / direct session (Vitest).
 *
 * Named assertions from spec:
 * - assert accept creates speaker_tasks count matching templates
 * - assert second accept is idempotent
 * - assert evaluator decision 403
 *
 * Plus: audit_events + correlationId, expectedVersion 409, Zod 400, unauth 401.
 */
import { describe, it, expect } from "vitest";
import {
  ErrorEnvelopeSchema,
  DecisionRecordResponseSchema,
  DirectSessionResponseSchema,
  SubmissionListResponseSchema,
  SubmissionDetailResponseSchema,
  BulkDecisionPreviewResponseSchema,
  SubmissionCreateResponseSchema,
  EventResponseSchema,
  FormCreateResponseSchema,
  FormPublishResponseSchema,
  VALIDATION_ERROR,
  UNAUTHORIZED,
  FORBIDDEN,
  CONFLICT,
  SESSION_COOKIE_NAME,
  TURNSTILE_DEV_PASS_TOKEN,
} from "@speakerops/shared";
import { createAppWithAuth } from "../../index.js";
import { OPENAPI_COMMANDS } from "../../openapi.js";
import { newTaskTemplateId } from "./store.js";

const env = { APP_VERSION: "0.1.0" };

async function magicLinkSession(
  purpose: "admin" | "speaker" | "evaluator",
  email: string,
  eventId?: string,
  shared?: ReturnType<typeof createAppWithAuth>,
): Promise<{
  app: ReturnType<typeof createAppWithAuth>["app"];
  store: ReturnType<typeof createAppWithAuth>["store"];
  events: ReturnType<typeof createAppWithAuth>["events"];
  forms: ReturnType<typeof createAppWithAuth>["forms"];
  submissions: ReturnType<typeof createAppWithAuth>["submissions"];
  decisions: ReturnType<typeof createAppWithAuth>["decisions"];
  cookie: string;
  userId: string;
}> {
  const ctx = shared ?? createAppWithAuth({ cookieSecure: true });
  const {
    app,
    store,
    events,
    forms,
    submissions,
    decisions,
    outbox,
  } = ctx;
  const body: Record<string, string> = { email, purpose };
  if (eventId) body.eventId = eventId;

  await app.request(
    "http://localhost/api/auth/magic-link",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
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
  const user = await store.findUserByEmail(email);
  expect(user).toBeTruthy();
  return {
    app,
    store,
    events,
    forms,
    submissions,
    decisions,
    cookie: `${SESSION_COOKIE_NAME}=${sessionValue}`,
    userId: user!.id,
  };
}

async function createEvent(
  app: ReturnType<typeof createAppWithAuth>["app"],
  cookie: string,
  name = "Decision Event",
): Promise<{ id: string; slug: string }> {
  const res = await app.request(
    "http://localhost/api/events",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-correlation-id": "corr-create-for-decision",
      },
      body: JSON.stringify({
        name,
        timezone: "UTC",
        startsAt: "2026-06-01T09:00:00.000Z",
        endsAt: "2026-06-02T17:00:00.000Z",
      }),
    },
    env,
  );
  expect(res.status).toBe(201);
  const parsed = EventResponseSchema.safeParse(await res.json());
  expect(parsed.success).toBe(true);
  return { id: parsed.data!.event.id, slug: parsed.data!.event.slug };
}

async function publishAndSubmit(
  app: ReturnType<typeof createAppWithAuth>["app"],
  adminCookie: string,
  eventId: string,
  slug: string,
  title: string,
  category?: string,
): Promise<{ submissionId: string; version: number }> {
  const create = await app.request(
    `http://localhost/api/events/${eventId}/forms`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
      },
      body: JSON.stringify({ name: "Decision CFP" }),
    },
    env,
  );
  expect(create.status).toBe(201);
  const form = FormCreateResponseSchema.parse(await create.json());

  const draft = await app.request(
    `http://localhost/api/forms/${form.form.id}/draft`,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
      },
      body: JSON.stringify({
        fields: [
          {
            fieldKey: "talk_title",
            type: "text",
            label: "Talk title",
            required: true,
            sortOrder: 0,
          },
        ],
        rules: category
          ? [
              {
                when: { fieldKey: "talk_title", op: "eq", value: title },
                routeToCategory: category,
              },
            ]
          : [],
      }),
    },
    env,
  );
  expect(draft.status).toBe(200);

  const publish = await app.request(
    `http://localhost/api/forms/${form.form.id}/publish`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
      },
      body: JSON.stringify({}),
    },
    env,
  );
  expect(publish.status).toBe(200);
  const published = FormPublishResponseSchema.parse(await publish.json());

  const submit = await app.request(
    `http://localhost/api/public/cfp/${slug}/submissions`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        formVersionId: published.formVersion.id,
        title,
        answers: [{ fieldKey: "talk_title", value: title }],
        speakers: [
          {
            name: "Speaker One",
            email: `speaker-${title.replace(/\s+/g, "-").toLowerCase()}@example.com`,
            isPrimary: true,
          },
        ],
        turnstileToken: TURNSTILE_DEV_PASS_TOKEN,
      }),
    },
    env,
  );
  expect(submit.status).toBe(201);
  const body = SubmissionCreateResponseSchema.parse(await submit.json());
  return {
    submissionId: body.submission.id,
    version: body.submission.version,
  };
}

describe("3.5 Decision.Record", () => {
  it("assert accept creates speaker_tasks count matching templates", async () => {
    const admin = await magicLinkSession("admin", "dec-admin-accept@example.com");
    const event = await createEvent(admin.app, admin.cookie, "Accept Tasks Event");
    const { submissionId } = await publishAndSubmit(
      admin.app,
      admin.cookie,
      event.id,
      event.slug,
      "Accept Talk",
    );

    // Seed explicit templates (overrides auto-default by pre-inserting)
    const tplA = await admin.decisions.insertTaskTemplate({
      id: newTaskTemplateId(),
      eventId: event.id,
      title: "Template A",
      description: "A",
      trigger: "on_accept",
      dueOffsetDays: 7,
      createdAt: new Date().toISOString(),
    });
    const tplB = await admin.decisions.insertTaskTemplate({
      id: newTaskTemplateId(),
      eventId: event.id,
      title: "Template B",
      description: "B",
      trigger: "on_accept",
      dueOffsetDays: 14,
      createdAt: new Date().toISOString(),
    });
    const tplC = await admin.decisions.insertTaskTemplate({
      id: newTaskTemplateId(),
      eventId: event.id,
      title: "Template C",
      description: "C",
      trigger: "on_accept",
      dueOffsetDays: 21,
      createdAt: new Date().toISOString(),
    });

    const res = await admin.app.request(
      `http://localhost/api/submissions/${submissionId}/decision`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
          "x-correlation-id": "corr-accept-tasks",
        },
        body: JSON.stringify({ decision: "accept", reason: "Strong fit" }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = DecisionRecordResponseSchema.parse(await res.json());
    expect(body.decision.decision).toBe("accept");
    expect(body.submission.status).toBe("accepted");
    expect(body.session).not.toBeNull();
    expect(body.session!.sourceSubmissionId).toBe(submissionId);
    // 3 templates × 1 speaker participation
    expect(body.tasks.length).toBe(3);
    const templateIds = new Set(body.tasks.map((t) => t.templateId));
    expect(templateIds.has(tplA.id)).toBe(true);
    expect(templateIds.has(tplB.id)).toBe(true);
    expect(templateIds.has(tplC.id)).toBe(true);
    expect(body.participations.length).toBe(1);
    expect(body.idempotent).toBe(false);

    // Audit row with correlationId
    const audits = await admin.store.listAudits();
    const decisionAudit = audits.find(
      (a) =>
        a.action === "Decision.Record" &&
        a.entityId === submissionId &&
        a.correlationId === "corr-accept-tasks",
    );
    expect(decisionAudit).toBeTruthy();
    expect(decisionAudit!.eventId).toBe(event.id);
  });

  it("assert second accept is idempotent", async () => {
    const admin = await magicLinkSession("admin", "dec-admin-idem@example.com");
    const event = await createEvent(admin.app, admin.cookie, "Idempotent Event");
    const { submissionId } = await publishAndSubmit(
      admin.app,
      admin.cookie,
      event.id,
      event.slug,
      "Idem Talk",
    );

    await admin.decisions.insertTaskTemplate({
      id: newTaskTemplateId(),
      eventId: event.id,
      title: "Only One",
      description: null,
      trigger: "on_accept",
      dueOffsetDays: 3,
      createdAt: new Date().toISOString(),
    });

    const first = await admin.app.request(
      `http://localhost/api/submissions/${submissionId}/decision`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
          "x-correlation-id": "corr-idem-1",
        },
        body: JSON.stringify({ decision: "accept" }),
      },
      env,
    );
    expect(first.status).toBe(200);
    const firstBody = DecisionRecordResponseSchema.parse(await first.json());
    expect(firstBody.idempotent).toBe(false);
    expect(firstBody.tasks.length).toBe(1);
    const sessionId = firstBody.session!.id;
    const taskIds = firstBody.tasks.map((t) => t.id).sort();

    const second = await admin.app.request(
      `http://localhost/api/submissions/${submissionId}/decision`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
          "x-correlation-id": "corr-idem-2",
        },
        body: JSON.stringify({ decision: "accept" }),
      },
      env,
    );
    expect(second.status).toBe(200);
    const secondBody = DecisionRecordResponseSchema.parse(await second.json());
    expect(secondBody.idempotent).toBe(true);
    expect(secondBody.session!.id).toBe(sessionId);
    expect(secondBody.tasks.map((t) => t.id).sort()).toEqual(taskIds);
    expect(secondBody.tasks.length).toBe(1);
  });

  it("assert evaluator decision 403", async () => {
    const shared = createAppWithAuth({ cookieSecure: true });
    const admin = await magicLinkSession(
      "admin",
      "dec-admin-eval403@example.com",
      undefined,
      shared,
    );
    const event = await createEvent(admin.app, admin.cookie, "Eval 403 Event");
    const { submissionId } = await publishAndSubmit(
      admin.app,
      admin.cookie,
      event.id,
      event.slug,
      "Eval Deny Talk",
    );
    const evaluator = await magicLinkSession(
      "evaluator",
      "dec-evaluator@example.com",
      event.id,
      shared,
    );

    const res = await evaluator.app.request(
      `http://localhost/api/submissions/${submissionId}/decision`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: evaluator.cookie,
        },
        body: JSON.stringify({ decision: "accept" }),
      },
      env,
    );
    expect(res.status).toBe(403);
    const envBody = ErrorEnvelopeSchema.parse(await res.json());
    expect(envBody.code).toBe(FORBIDDEN);
  });

  it("expectedVersion conflict returns 409", async () => {
    const admin = await magicLinkSession("admin", "dec-admin-409@example.com");
    const event = await createEvent(admin.app, admin.cookie, "Conflict Event");
    const { submissionId, version } = await publishAndSubmit(
      admin.app,
      admin.cookie,
      event.id,
      event.slug,
      "Conflict Talk",
    );

    const res = await admin.app.request(
      `http://localhost/api/submissions/${submissionId}/decision`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
        },
        body: JSON.stringify({
          decision: "reject",
          reason: "No",
          expectedVersion: version + 99,
        }),
      },
      env,
    );
    expect(res.status).toBe(409);
    const envBody = ErrorEnvelopeSchema.parse(await res.json());
    expect(envBody.code).toBe(CONFLICT);
  });

  it("reject with reason updates status", async () => {
    const admin = await magicLinkSession("admin", "dec-admin-reject@example.com");
    const event = await createEvent(admin.app, admin.cookie, "Reject Event");
    const { submissionId } = await publishAndSubmit(
      admin.app,
      admin.cookie,
      event.id,
      event.slug,
      "Reject Talk",
    );

    const res = await admin.app.request(
      `http://localhost/api/submissions/${submissionId}/decision`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
          "x-correlation-id": "corr-reject",
        },
        body: JSON.stringify({
          decision: "reject",
          reason: "Out of scope",
        }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = DecisionRecordResponseSchema.parse(await res.json());
    expect(body.decision.decision).toBe("reject");
    expect(body.decision.reason).toBe("Out of scope");
    expect(body.submission.status).toBe("rejected");
    expect(body.session).toBeNull();
    expect(body.tasks).toEqual([]);
  });

  it("accept then reject dematerializes session speakers and tasks", async () => {
    const admin = await magicLinkSession(
      "admin",
      "dec-admin-accept-reject@example.com",
    );
    const event = await createEvent(
      admin.app,
      admin.cookie,
      "Accept Then Reject Event",
    );
    const { submissionId } = await publishAndSubmit(
      admin.app,
      admin.cookie,
      event.id,
      event.slug,
      "Flip Talk",
    );

    await admin.decisions.insertTaskTemplate({
      id: newTaskTemplateId(),
      eventId: event.id,
      title: "Headshot",
      description: null,
      trigger: "on_accept",
      dueOffsetDays: 7,
      createdAt: new Date().toISOString(),
    });

    const accept = await admin.app.request(
      `http://localhost/api/submissions/${submissionId}/decision`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
          "x-correlation-id": "corr-flip-accept",
        },
        body: JSON.stringify({ decision: "accept" }),
      },
      env,
    );
    expect(accept.status).toBe(200);
    const acceptBody = DecisionRecordResponseSchema.parse(await accept.json());
    expect(acceptBody.session).not.toBeNull();
    expect(acceptBody.tasks.length).toBeGreaterThan(0);
    const sessionId = acceptBody.session!.id;

    const reject = await admin.app.request(
      `http://localhost/api/submissions/${submissionId}/decision`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
          "x-correlation-id": "corr-flip-reject",
        },
        body: JSON.stringify({
          decision: "reject",
          reason: "Changed mind",
        }),
      },
      env,
    );
    expect(reject.status).toBe(200);
    const rejectBody = DecisionRecordResponseSchema.parse(await reject.json());
    expect(rejectBody.submission.status).toBe("rejected");
    expect(rejectBody.session).toBeNull();
    expect(rejectBody.tasks).toEqual([]);

    // Program artifacts no longer active
    const session = await admin.decisions.findSessionById(sessionId);
    expect(session?.status).toBe("cancelled");
    const speakers = await admin.decisions.listSessionSpeakers(sessionId);
    expect(speakers).toEqual([]);

    // Detail view must not expose cancelled accept session
    const detail = await admin.app.request(
      `http://localhost/api/submissions/${submissionId}`,
      { headers: { cookie: admin.cookie } },
      env,
    );
    expect(detail.status).toBe(200);
    const detailBody = SubmissionDetailResponseSchema.parse(
      await detail.json(),
    );
    expect(detailBody.session).toBeNull();
    expect(detailBody.submission.status).toBe("rejected");
  });

  it("waitlist status updates submission", async () => {
    const admin = await magicLinkSession("admin", "dec-admin-wait@example.com");
    const event = await createEvent(admin.app, admin.cookie, "Waitlist Event");
    const { submissionId } = await publishAndSubmit(
      admin.app,
      admin.cookie,
      event.id,
      event.slug,
      "Wait Talk",
    );

    const res = await admin.app.request(
      `http://localhost/api/submissions/${submissionId}/decision`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
        },
        body: JSON.stringify({ decision: "waitlist" }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = DecisionRecordResponseSchema.parse(await res.json());
    expect(body.decision.decision).toBe("waitlist");
    expect(body.submission.status).toBe("waitlist");
    expect(body.session).toBeNull();
  });

  it("unauthenticated decision returns 401", async () => {
    const admin = await magicLinkSession("admin", "dec-admin-401@example.com");
    const event = await createEvent(admin.app, admin.cookie, "Unauth Event");
    const { submissionId } = await publishAndSubmit(
      admin.app,
      admin.cookie,
      event.id,
      event.slug,
      "Unauth Talk",
    );

    const res = await admin.app.request(
      `http://localhost/api/submissions/${submissionId}/decision`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "accept" }),
      },
      env,
    );
    expect(res.status).toBe(401);
    const envBody = ErrorEnvelopeSchema.parse(await res.json());
    expect(envBody.code).toBe(UNAUTHORIZED);
  });

  it("invalid decision body returns 400", async () => {
    const admin = await magicLinkSession("admin", "dec-admin-400@example.com");
    const event = await createEvent(admin.app, admin.cookie, "Validation Event");
    const { submissionId } = await publishAndSubmit(
      admin.app,
      admin.cookie,
      event.id,
      event.slug,
      "Val Talk",
    );

    const res = await admin.app.request(
      `http://localhost/api/submissions/${submissionId}/decision`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
        },
        body: JSON.stringify({ decision: "maybe" }),
      },
      env,
    );
    expect(res.status).toBe(400);
    const envBody = ErrorEnvelopeSchema.parse(await res.json());
    expect(envBody.code).toBe(VALIDATION_ERROR);
  });

  it("Submission.List filters by status and category", async () => {
    const admin = await magicLinkSession("admin", "dec-admin-list@example.com");
    const event = await createEvent(admin.app, admin.cookie, "List Event");
    const a = await publishAndSubmit(
      admin.app,
      admin.cookie,
      event.id,
      event.slug,
      "List Talk A",
      "keynote",
    );
    await publishAndSubmit(
      admin.app,
      admin.cookie,
      event.id,
      event.slug,
      "List Talk B",
      "panel",
    );

    await admin.app.request(
      `http://localhost/api/submissions/${a.submissionId}/decision`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
        },
        body: JSON.stringify({ decision: "accept" }),
      },
      env,
    );

    const listAll = await admin.app.request(
      `http://localhost/api/events/${event.id}/submissions`,
      { headers: { cookie: admin.cookie } },
      env,
    );
    expect(listAll.status).toBe(200);
    const allBody = SubmissionListResponseSchema.parse(await listAll.json());
    expect(allBody.submissions.length).toBeGreaterThanOrEqual(2);

    const listAccepted = await admin.app.request(
      `http://localhost/api/events/${event.id}/submissions?status=accepted`,
      { headers: { cookie: admin.cookie } },
      env,
    );
    expect(listAccepted.status).toBe(200);
    const acceptedBody = SubmissionListResponseSchema.parse(
      await listAccepted.json(),
    );
    expect(acceptedBody.submissions.every((s) => s.status === "accepted")).toBe(
      true,
    );
    expect(acceptedBody.submissions.some((s) => s.id === a.submissionId)).toBe(
      true,
    );

    const listCat = await admin.app.request(
      `http://localhost/api/events/${event.id}/submissions?category=panel`,
      { headers: { cookie: admin.cookie } },
      env,
    );
    expect(listCat.status).toBe(200);
    const catBody = SubmissionListResponseSchema.parse(await listCat.json());
    expect(catBody.submissions.every((s) => s.category === "panel")).toBe(true);
  });

  it("Submission.Get returns answers and speakers", async () => {
    const admin = await magicLinkSession("admin", "dec-admin-get@example.com");
    const event = await createEvent(admin.app, admin.cookie, "Get Event");
    const { submissionId } = await publishAndSubmit(
      admin.app,
      admin.cookie,
      event.id,
      event.slug,
      "Detail Talk",
    );

    const res = await admin.app.request(
      `http://localhost/api/submissions/${submissionId}`,
      { headers: { cookie: admin.cookie } },
      env,
    );
    expect(res.status).toBe(200);
    const body = SubmissionDetailResponseSchema.parse(await res.json());
    expect(body.submission.id).toBe(submissionId);
    expect(body.answers.length).toBeGreaterThan(0);
    expect(body.speakers.length).toBe(1);
    expect(body.speakers[0]!.name).toBe("Speaker One");
    expect(body.decision).toBeNull();
  });

  it("Session.CreateDirect creates sponsor session without CFP", async () => {
    const admin = await magicLinkSession("admin", "dec-admin-direct@example.com");
    const event = await createEvent(admin.app, admin.cookie, "Direct Event");

    const res = await admin.app.request(
      `http://localhost/api/events/${event.id}/sessions/direct`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
          "x-correlation-id": "corr-direct",
        },
        body: JSON.stringify({
          title: "Sponsor Keynote",
          description: "Paid placement",
          speakers: [
            {
              name: "Sponsor Speaker",
              email: "sponsor@example.com",
              isPrimary: true,
            },
          ],
        }),
      },
      env,
    );
    expect(res.status).toBe(201);
    const body = DirectSessionResponseSchema.parse(await res.json());
    expect(body.session.title).toBe("Sponsor Keynote");
    expect(body.session.sourceSubmissionId).toBeNull();
    expect(body.participations.length).toBe(1);
    expect(body.tasks.length).toBeGreaterThan(0);

    const audits = await admin.store.listAudits();
    expect(
      audits.some(
        (a) =>
          a.action === "Session.CreateDirect" &&
          a.correlationId === "corr-direct",
      ),
    ).toBe(true);
  });

  it("bulk preview blocks empty selection and returns items", async () => {
    const admin = await magicLinkSession("admin", "dec-admin-bulk@example.com");
    const event = await createEvent(admin.app, admin.cookie, "Bulk Event");
    const a = await publishAndSubmit(
      admin.app,
      admin.cookie,
      event.id,
      event.slug,
      "Bulk A",
    );
    const b = await publishAndSubmit(
      admin.app,
      admin.cookie,
      event.id,
      event.slug,
      "Bulk B",
    );

    const empty = await admin.app.request(
      `http://localhost/api/events/${event.id}/submissions/bulk-preview`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
        },
        body: JSON.stringify({
          submissionIds: [],
          decision: "reject",
        }),
      },
      env,
    );
    expect(empty.status).toBe(400);

    const preview = await admin.app.request(
      `http://localhost/api/events/${event.id}/submissions/bulk-preview`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
        },
        body: JSON.stringify({
          submissionIds: [a.submissionId, b.submissionId],
          decision: "waitlist",
        }),
      },
      env,
    );
    expect(preview.status).toBe(200);
    const body = BulkDecisionPreviewResponseSchema.parse(await preview.json());
    expect(body.count).toBe(2);
    expect(body.decision).toBe("waitlist");
    expect(body.items.every((i) => i.nextStatus === "waitlist")).toBe(true);
  });

  it("OpenAPI registers Decision.Record and Session.CreateDirect", () => {
    expect(OPENAPI_COMMANDS).toContain("Decision.Record");
    expect(OPENAPI_COMMANDS).toContain("Session.CreateDirect");
    expect(OPENAPI_COMMANDS).toContain("Submission.List");
    expect(OPENAPI_COMMANDS).toContain("Submission.Get");
  });
});
