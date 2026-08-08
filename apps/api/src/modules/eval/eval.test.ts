/**
 * Section 3.4 — Evaluation scoring (Vitest).
 *
 * Named assertions from spec:
 * - assert unassigned submission absent from evaluator queue
 * - assert score > max returns 400
 * - assert evaluator UI has no accept button (UI e2e; API has no Decision for evaluator)
 *
 * Plus: Zod 400, authz 401/403, audit_events + correlationId, aggregate rollup.
 */
import { describe, it, expect } from "vitest";
import {
  ErrorEnvelopeSchema,
  EvalRubricResponseSchema,
  EvalScoreResponseSchema,
  EvalQueueResponseSchema,
  SubmissionAssignResponseSchema,
  EvalAdminRollupResponseSchema,
  SubmissionCreateResponseSchema,
  EventResponseSchema,
  FormCreateResponseSchema,
  FormPublishResponseSchema,
  VALIDATION_ERROR,
  UNAUTHORIZED,
  FORBIDDEN,
  SESSION_COOKIE_NAME,
  TURNSTILE_DEV_PASS_TOKEN,
} from "@speakerops/shared";
import { createAppWithAuth } from "../../index.js";
import { OPENAPI_COMMANDS } from "../../openapi.js";

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
  eval: ReturnType<typeof createAppWithAuth>["eval"];
  cookie: string;
  userId: string;
}> {
  const ctx = shared ?? createAppWithAuth({ cookieSecure: true });
  const { app, store, events, forms, submissions, eval: evalStore, outbox } =
    ctx;
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
    eval: evalStore,
    cookie: `${SESSION_COOKIE_NAME}=${sessionValue}`,
    userId: user!.id,
  };
}

async function createEvent(
  app: ReturnType<typeof createAppWithAuth>["app"],
  cookie: string,
  name = "Eval Event",
): Promise<{ id: string; slug: string }> {
  const res = await app.request(
    "http://localhost/api/events",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-correlation-id": "corr-create-for-eval",
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
): Promise<string> {
  const create = await app.request(
    `http://localhost/api/events/${eventId}/forms`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: adminCookie,
      },
      body: JSON.stringify({ name: "Eval CFP" }),
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
          },
        ],
        turnstileToken: TURNSTILE_DEV_PASS_TOKEN,
      }),
    },
    env,
  );
  expect(submit.status).toBe(201);
  const created = SubmissionCreateResponseSchema.parse(await submit.json());
  return created.submission.id;
}

describe("3.4 evaluation scoring", () => {
  it("OpenAPI lists Eval commands", () => {
    expect(OPENAPI_COMMANDS).toContain("Eval.UpsertRubric");
    expect(OPENAPI_COMMANDS).toContain("Eval.Score");
    expect(OPENAPI_COMMANDS).toContain("Eval.GetQueue");
    expect(OPENAPI_COMMANDS).toContain("Submission.AssignEvaluators");
  });

  it("unauthenticated eval routes return 401", async () => {
    const { app } = createAppWithAuth({ cookieSecure: true });
    const rubric = await app.request(
      "http://localhost/api/events/evt_x/eval/rubric",
      { method: "GET" },
      env,
    );
    expect(rubric.status).toBe(401);
    expect(ErrorEnvelopeSchema.parse(await rubric.json()).code).toBe(
      UNAUTHORIZED,
    );

    const queue = await app.request(
      "http://localhost/api/me/eval-queue",
      { method: "GET" },
      env,
    );
    expect(queue.status).toBe(401);

    const score = await app.request(
      "http://localhost/api/assignments/asn_x/scores",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scores: [{ criterionId: "c1", value: 1 }],
        }),
      },
      env,
    );
    expect(score.status).toBe(401);
  });

  it("Eval.UpsertRubric creates rubric and audits correlationId", async () => {
    const admin = await magicLinkSession("admin", "eval-admin-rubric@example.com");
    const event = await createEvent(admin.app, admin.cookie, "Rubric Event");

    const res = await admin.app.request(
      `http://localhost/api/events/${event.id}/eval/rubric`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
          "x-correlation-id": "corr-upsert-rubric-1",
        },
        body: JSON.stringify({
          name: "Main review",
          criteria: [
            { name: "Relevance", maxScore: 5, weight: 2 },
            { name: "Clarity", maxScore: 5, weight: 1 },
          ],
        }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = EvalRubricResponseSchema.parse(await res.json());
    expect(body.round.name).toBe("Main review");
    expect(body.criteria).toHaveLength(2);
    expect(body.criteria[0]!.maxScore).toBe(5);

    const audits = await admin.store.listAudits();
    const audit = audits.find((a) => a.action === "Eval.UpsertRubric");
    expect(audit).toBeTruthy();
    expect(audit!.correlationId).toBe("corr-upsert-rubric-1");
  });

  it("assert unassigned submission absent from evaluator queue", async () => {
    const shared = createAppWithAuth({ cookieSecure: true });
    const admin = await magicLinkSession(
      "admin",
      "eval-admin-queue@example.com",
      undefined,
      shared,
    );
    const event = await createEvent(admin.app, admin.cookie, "Queue Event");

    // Evaluator membership on same event
    const evaluator = await magicLinkSession(
      "evaluator",
      "eval-evaluator-queue@example.com",
      event.id,
      shared,
    );

    // Rubric required before assign
    await admin.app.request(
      `http://localhost/api/events/${event.id}/eval/rubric`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
        },
        body: JSON.stringify({
          criteria: [{ name: "Impact", maxScore: 10, weight: 1 }],
        }),
      },
      env,
    );

    const assignedTitle = "Assigned Talk";
    const unassignedTitle = "Unassigned Talk";
    const assignedId = await publishAndSubmit(
      admin.app,
      admin.cookie,
      event.id,
      event.slug,
      assignedTitle,
    );
    // Second submission on same form — publish already done; submit again via public
    const formList = await admin.app.request(
      `http://localhost/api/public/cfp/${event.slug}`,
      { method: "GET" },
      env,
    );
    const publicCfp = (await formList.json()) as {
      formVersion: { id: string } | null;
    };
    const formVersionId = publicCfp.formVersion!.id;
    const unassignedSubmit = await admin.app.request(
      `http://localhost/api/public/cfp/${event.slug}/submissions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          formVersionId,
          title: unassignedTitle,
          answers: [{ fieldKey: "talk_title", value: unassignedTitle }],
          speakers: [
            { name: "Other", email: "other-unassigned@example.com" },
          ],
          turnstileToken: TURNSTILE_DEV_PASS_TOKEN,
        }),
      },
      env,
    );
    expect(unassignedSubmit.status).toBe(201);
    const unassigned = SubmissionCreateResponseSchema.parse(
      await unassignedSubmit.json(),
    );

    // Assign only the first submission
    const assign = await admin.app.request(
      `http://localhost/api/submissions/${assignedId}/assign`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
          "x-correlation-id": "corr-assign-1",
        },
        body: JSON.stringify({ userIds: [evaluator.userId] }),
      },
      env,
    );
    expect(assign.status).toBe(200);
    const assignBody = SubmissionAssignResponseSchema.parse(await assign.json());
    expect(assignBody.assignments).toHaveLength(1);

    const queueRes = await admin.app.request(
      "http://localhost/api/me/eval-queue",
      {
        method: "GET",
        headers: { cookie: evaluator.cookie },
      },
      env,
    );
    expect(queueRes.status).toBe(200);
    const queue = EvalQueueResponseSchema.parse(await queueRes.json());
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]!.submission.id).toBe(assignedId);
    expect(queue.items[0]!.submission.title).toBe(assignedTitle);
    // Unassigned must be absent
    expect(
      queue.items.some((i) => i.submission.id === unassigned.submission.id),
    ).toBe(false);
    expect(
      queue.items.some((i) => i.submission.title === unassignedTitle),
    ).toBe(false);
  });

  it("assert score > max returns 400", async () => {
    const shared = createAppWithAuth({ cookieSecure: true });
    const admin = await magicLinkSession(
      "admin",
      "eval-admin-max@example.com",
      undefined,
      shared,
    );
    const event = await createEvent(admin.app, admin.cookie, "Max Score Event");
    const evaluator = await magicLinkSession(
      "evaluator",
      "eval-evaluator-max@example.com",
      event.id,
      shared,
    );

    const rubricRes = await admin.app.request(
      `http://localhost/api/events/${event.id}/eval/rubric`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
        },
        body: JSON.stringify({
          criteria: [{ name: "Depth", maxScore: 5, weight: 1 }],
        }),
      },
      env,
    );
    const rubric = EvalRubricResponseSchema.parse(await rubricRes.json());
    const criterionId = rubric.criteria[0]!.id;

    const submissionId = await publishAndSubmit(
      admin.app,
      admin.cookie,
      event.id,
      event.slug,
      "Max Score Talk",
    );

    const assign = await admin.app.request(
      `http://localhost/api/submissions/${submissionId}/assign`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
        },
        body: JSON.stringify({ userIds: [evaluator.userId] }),
      },
      env,
    );
    const { assignments } = SubmissionAssignResponseSchema.parse(
      await assign.json(),
    );
    const assignmentId = assignments[0]!.id;

    const over = await admin.app.request(
      `http://localhost/api/assignments/${assignmentId}/scores`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: evaluator.cookie,
          "x-correlation-id": "corr-score-over-max",
        },
        body: JSON.stringify({
          scores: [{ criterionId, value: 6 }],
          comment: "too high",
        }),
      },
      env,
    );
    expect(over.status).toBe(400);
    const err = ErrorEnvelopeSchema.parse(await over.json());
    expect(err.code).toBe(VALIDATION_ERROR);
    expect(err.error.toLowerCase()).toMatch(/max|score/);

    // Valid score succeeds + audits
    const ok = await admin.app.request(
      `http://localhost/api/assignments/${assignmentId}/scores`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: evaluator.cookie,
          "x-correlation-id": "corr-score-ok",
        },
        body: JSON.stringify({
          scores: [{ criterionId, value: 4, comment: "solid" }],
          comment: "Overall good",
        }),
      },
      env,
    );
    expect(ok.status).toBe(200);
    const scored = EvalScoreResponseSchema.parse(await ok.json());
    expect(scored.assignment.status).toBe("scored");
    expect(scored.assignment.aggregateScore).toBe(4);

    const audits = await admin.store.listAudits();
    const scoreAudit = audits.find(
      (a) =>
        a.action === "Eval.Score" && a.correlationId === "corr-score-ok",
    );
    expect(scoreAudit).toBeTruthy();
  });

  it("admin rollup shows aggregate score", async () => {
    const shared = createAppWithAuth({ cookieSecure: true });
    const admin = await magicLinkSession(
      "admin",
      "eval-admin-rollup@example.com",
      undefined,
      shared,
    );
    const event = await createEvent(admin.app, admin.cookie, "Rollup Event");
    const evaluator = await magicLinkSession(
      "evaluator",
      "eval-evaluator-rollup@example.com",
      event.id,
      shared,
    );

    const rubricRes = await admin.app.request(
      `http://localhost/api/events/${event.id}/eval/rubric`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
        },
        body: JSON.stringify({
          criteria: [
            { name: "A", maxScore: 10, weight: 1 },
            { name: "B", maxScore: 10, weight: 1 },
          ],
        }),
      },
      env,
    );
    const rubric = EvalRubricResponseSchema.parse(await rubricRes.json());
    const c0 = rubric.criteria[0]!.id;
    const c1 = rubric.criteria[1]!.id;

    const submissionId = await publishAndSubmit(
      admin.app,
      admin.cookie,
      event.id,
      event.slug,
      "Rollup Talk",
    );
    const assign = await admin.app.request(
      `http://localhost/api/submissions/${submissionId}/assign`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
        },
        body: JSON.stringify({ userIds: [evaluator.userId] }),
      },
      env,
    );
    const { assignments } = SubmissionAssignResponseSchema.parse(
      await assign.json(),
    );

    await admin.app.request(
      `http://localhost/api/assignments/${assignments[0]!.id}/scores`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: evaluator.cookie,
        },
        body: JSON.stringify({
          scores: [
            { criterionId: c0, value: 8 },
            { criterionId: c1, value: 6 },
          ],
        }),
      },
      env,
    );

    const rollupRes = await admin.app.request(
      `http://localhost/api/events/${event.id}/eval/rollup`,
      {
        method: "GET",
        headers: { cookie: admin.cookie },
      },
      env,
    );
    expect(rollupRes.status).toBe(200);
    const rollup = EvalAdminRollupResponseSchema.parse(await rollupRes.json());
    const row = rollup.submissions.find((s) => s.submissionId === submissionId);
    expect(row).toBeTruthy();
    expect(row!.aggregateScore).toBe(7);
  });

  it("speaker cannot access eval queue (403)", async () => {
    const speaker = await magicLinkSession(
      "speaker",
      "eval-speaker-deny@example.com",
    );
    const res = await speaker.app.request(
      "http://localhost/api/me/eval-queue",
      {
        method: "GET",
        headers: { cookie: speaker.cookie },
      },
      env,
    );
    expect(res.status).toBe(403);
    expect(ErrorEnvelopeSchema.parse(await res.json()).code).toBe(FORBIDDEN);
  });

  it("evaluator cannot score another evaluator's assignment (403)", async () => {
    const shared = createAppWithAuth({ cookieSecure: true });
    const admin = await magicLinkSession(
      "admin",
      "eval-admin-forbid@example.com",
      undefined,
      shared,
    );
    const event = await createEvent(admin.app, admin.cookie, "Forbid Event");
    const e1 = await magicLinkSession(
      "evaluator",
      "eval-e1-forbid@example.com",
      event.id,
      shared,
    );
    const e2 = await magicLinkSession(
      "evaluator",
      "eval-e2-forbid@example.com",
      event.id,
      shared,
    );

    const rubricRes = await admin.app.request(
      `http://localhost/api/events/${event.id}/eval/rubric`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
        },
        body: JSON.stringify({
          criteria: [{ name: "X", maxScore: 5, weight: 1 }],
        }),
      },
      env,
    );
    const rubric = EvalRubricResponseSchema.parse(await rubricRes.json());
    const submissionId = await publishAndSubmit(
      admin.app,
      admin.cookie,
      event.id,
      event.slug,
      "Forbid Talk",
    );
    const assign = await admin.app.request(
      `http://localhost/api/submissions/${submissionId}/assign`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
        },
        body: JSON.stringify({ userIds: [e1.userId] }),
      },
      env,
    );
    const { assignments } = SubmissionAssignResponseSchema.parse(
      await assign.json(),
    );

    const res = await admin.app.request(
      `http://localhost/api/assignments/${assignments[0]!.id}/scores`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: e2.cookie,
        },
        body: JSON.stringify({
          scores: [{ criterionId: rubric.criteria[0]!.id, value: 3 }],
        }),
      },
      env,
    );
    expect(res.status).toBe(403);
    expect(ErrorEnvelopeSchema.parse(await res.json()).code).toBe(FORBIDDEN);
  });
});
