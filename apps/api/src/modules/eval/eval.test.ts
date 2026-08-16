/**
 * Section 3.4 — Evaluation scoring (Vitest) + section 10.2 progress contract.
 *
 * Named assertions from spec:
 * - assert unassigned submission absent from evaluator queue
 * - assert score > max returns 400
 * - assert evaluator UI has no accept button (UI e2e; API has no Decision for evaluator)
 *
 * Plus: Zod 400, authz 401/403, audit_events + correlationId, aggregate rollup.
 *
 * 10.2 (S-EVAL-UI):
 * - eval progress response schema accepts production-shaped rows
 * - rollup never returns "Response validation failed"
 * - empty progress (no rubric) is honest empty 200
 * - unauthenticated / non-admin denied
 */
import { describe, it, expect } from "vitest";
import {
  ErrorEnvelopeSchema,
  EvalRubricResponseSchema,
  EvalScoreResponseSchema,
  EvalQueueResponseSchema,
  EvalProposalResponseSchema,
  SubmissionAssignResponseSchema,
  EvalAdminRollupResponseSchema,
  SubmissionCreateResponseSchema,
  EventResponseSchema,
  FormCreateResponseSchema,
  FormPublishResponseSchema,
  VALIDATION_ERROR,
  UNAUTHORIZED,
  FORBIDDEN,
  NOT_FOUND,
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
    const rollupBody = await rollupRes.json();
    // Must never surface the pre-10.2 product wall
    expect(
      JSON.stringify(rollupBody).toLowerCase(),
    ).not.toContain("response validation failed");
    const rollup = EvalAdminRollupResponseSchema.parse(rollupBody);
    const row = rollup.submissions.find((s) => s.submissionId === submissionId);
    expect(row).toBeTruthy();
    expect(row!.aggregateScore).toBe(7);
    expect(row!.assignments).toHaveLength(1);
    expect(row!.assignments[0]!.status).toBe("scored");
  });

  it("10.2: unit progress schema accepts production-shaped empty + scored", () => {
    const empty = EvalAdminRollupResponseSchema.parse({
      round: null,
      criteria: [],
      submissions: [],
    });
    expect(empty.round).toBeNull();

    const scored = EvalAdminRollupResponseSchema.parse({
      round: {
        id: "r1",
        eventId: "evt_dogfood",
        name: "Main",
        status: "open",
        closesAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      criteria: [
        {
          id: "c1",
          roundId: "r1",
          name: "Clarity",
          maxScore: "5",
          weight: "1",
          sortOrder: "0",
        },
      ],
      submissions: [
        {
          submissionId: "sub1",
          title: "Talk",
          category: null,
          status: "submitted",
          aggregateScore: 4,
          assignments: [
            {
              id: "a1",
              evaluatorUserId: "u1",
              status: "scored",
              aggregateScore: 4,
            },
          ],
        },
      ],
    });
    expect(scored.criteria[0]!.maxScore).toBe(5);
    expect(scored.submissions[0]!.aggregateScore).toBe(4);
  });

  it("10.2: rollup with no rubric returns honest empty (not validation failed)", async () => {
    const admin = await magicLinkSession(
      "admin",
      "eval-admin-empty-rollup@example.com",
    );
    const event = await createEvent(admin.app, admin.cookie, "Empty Rollup");
    const res = await admin.app.request(
      `http://localhost/api/events/${event.id}/eval/rollup`,
      { headers: { cookie: admin.cookie } },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(JSON.stringify(body).toLowerCase()).not.toContain(
      "response validation failed",
    );
    const rollup = EvalAdminRollupResponseSchema.parse(body);
    expect(rollup.round).toBeNull();
    expect(rollup.criteria).toEqual([]);
    expect(rollup.submissions).toEqual([]);
  });

  it("10.2: unauthenticated rollup returns 401 (must-not leak progress)", async () => {
    const { app } = createAppWithAuth({ cookieSecure: true });
    const res = await app.request(
      "http://localhost/api/events/evt_x/eval/rollup",
      { method: "GET" },
      env,
    );
    expect(res.status).toBe(401);
    expect(ErrorEnvelopeSchema.parse(await res.json()).code).toBe(
      UNAUTHORIZED,
    );
  });

  it("10.2: evaluator cannot read admin rollup (403)", async () => {
    const shared = createAppWithAuth({ cookieSecure: true });
    const admin = await magicLinkSession(
      "admin",
      "eval-admin-rollup-authz@example.com",
      undefined,
      shared,
    );
    const event = await createEvent(admin.app, admin.cookie, "Authz Rollup");
    const evaluator = await magicLinkSession(
      "evaluator",
      "eval-evaluator-rollup-authz@example.com",
      event.id,
      shared,
    );
    const res = await admin.app.request(
      `http://localhost/api/events/${event.id}/eval/rollup`,
      { headers: { cookie: evaluator.cookie } },
      env,
    );
    expect(res.status).toBe(403);
    expect(ErrorEnvelopeSchema.parse(await res.json()).code).toBe(FORBIDDEN);
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

  it("10.6: admin CSV export sorts by score and includes status columns", async () => {
    const shared = createAppWithAuth({ cookieSecure: true });
    const admin = await magicLinkSession(
      "admin",
      "eval-admin-export@example.com",
      undefined,
      shared,
    );
    const event = await createEvent(admin.app, admin.cookie, "Export Event");
    const evaluator = await magicLinkSession(
      "evaluator",
      "eval-evaluator-export@example.com",
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
          criteria: [{ name: "Quality", maxScore: 10, weight: 1 }],
        }),
      },
      env,
    );
    const rubric = EvalRubricResponseSchema.parse(await rubricRes.json());
    const criterionId = rubric.criteria[0]!.id;

    // Publish CFP once, then submit two proposals on the same form version.
    const formCreate = await admin.app.request(
      `http://localhost/api/events/${event.id}/forms`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
        },
        body: JSON.stringify({ name: "Export CFP" }),
      },
      env,
    );
    const form = FormCreateResponseSchema.parse(await formCreate.json());
    await admin.app.request(
      `http://localhost/api/forms/${form.form.id}/draft`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
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
    const publish = await admin.app.request(
      `http://localhost/api/forms/${form.form.id}/publish`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
        },
        body: JSON.stringify({}),
      },
      env,
    );
    const published = FormPublishResponseSchema.parse(await publish.json());
    const formVersionId = published.formVersion.id;

    async function submitTalk(title: string, email: string): Promise<string> {
      const res = await admin.app.request(
        `http://localhost/api/public/cfp/${event.slug}/submissions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            formVersionId,
            title,
            answers: [{ fieldKey: "talk_title", value: title }],
            speakers: [{ name: "Speaker", email, isPrimary: true }],
            turnstileToken: TURNSTILE_DEV_PASS_TOKEN,
          }),
        },
        env,
      );
      expect(res.status).toBe(201);
      return SubmissionCreateResponseSchema.parse(await res.json()).submission
        .id;
    }

    const lowId = await submitTalk("Low Score Talk", "low-export@example.com");
    const highId = await submitTalk(
      "High Score Talk",
      "high-export@example.com",
    );

    for (const [submissionId, value] of [
      [lowId, 3],
      [highId, 9],
    ] as const) {
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
            scores: [{ criterionId, value }],
          }),
        },
        env,
      );
    }

    const exportRes = await admin.app.request(
      `http://localhost/api/events/${event.id}/eval/export?sort=score_desc`,
      { method: "GET", headers: { cookie: admin.cookie, accept: "text/csv" } },
      env,
    );
    expect(exportRes.status).toBe(200);
    expect(exportRes.headers.get("content-type") ?? "").toMatch(/text\/csv/);
    expect(exportRes.headers.get("content-disposition") ?? "").toMatch(
      /attachment/,
    );
    const csv = await exportRes.text();
    const lines = csv.trim().split(/\r?\n/);
    expect(lines[0]).toContain("aggregateScore");
    expect(lines[0]).toContain("status");
    // High score row before low score row
    const highIdx = lines.findIndex((l) => l.includes(highId));
    const lowIdx = lines.findIndex((l) => l.includes(lowId));
    expect(highIdx).toBeGreaterThan(0);
    expect(lowIdx).toBeGreaterThan(0);
    expect(highIdx).toBeLessThan(lowIdx);

    const rollupSorted = await admin.app.request(
      `http://localhost/api/events/${event.id}/eval/rollup?sort=score_desc`,
      { headers: { cookie: admin.cookie } },
      env,
    );
    expect(rollupSorted.status).toBe(200);
    const rollup = EvalAdminRollupResponseSchema.parse(
      await rollupSorted.json(),
    );
    expect(rollup.submissions[0]!.submissionId).toBe(highId);
    expect(rollup.submissions[1]!.submissionId).toBe(lowId);
  });

  it("10.6: unauthenticated export returns 401; evaluator 403", async () => {
    const shared = createAppWithAuth({ cookieSecure: true });
    const admin = await magicLinkSession(
      "admin",
      "eval-admin-export-authz@example.com",
      undefined,
      shared,
    );
    const event = await createEvent(admin.app, admin.cookie, "Export Authz");
    const evaluator = await magicLinkSession(
      "evaluator",
      "eval-evaluator-export-authz@example.com",
      event.id,
      shared,
    );

    const anon = await admin.app.request(
      `http://localhost/api/events/${event.id}/eval/export`,
      { method: "GET" },
      env,
    );
    expect(anon.status).toBe(401);

    const evalRes = await admin.app.request(
      `http://localhost/api/events/${event.id}/eval/export`,
      { headers: { cookie: evaluator.cookie } },
      env,
    );
    expect(evalRes.status).toBe(403);
    expect(ErrorEnvelopeSchema.parse(await evalRes.json()).code).toBe(
      FORBIDDEN,
    );
  });

  it("must-not: draft submissions excluded from rollup/export and assign", async () => {
    const shared = createAppWithAuth({ cookieSecure: true });
    const admin = await magicLinkSession(
      "admin",
      "eval-admin-draft-guard@example.com",
      undefined,
      shared,
    );
    const event = await createEvent(admin.app, admin.cookie, "Draft Eval Guard");
    const evaluator = await magicLinkSession(
      "evaluator",
      "eval-evaluator-draft-guard@example.com",
      event.id,
      shared,
    );

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

    const submittedId = await publishAndSubmit(
      admin.app,
      admin.cookie,
      event.id,
      event.slug,
      "Real Submitted Talk",
    );

    // Public form pin for draft save
    const publicCfp = await admin.app.request(
      `http://localhost/api/public/cfp/${event.slug}`,
      { method: "GET" },
      env,
    );
    const formVersionId = (
      (await publicCfp.json()) as { formVersion: { id: string } }
    ).formVersion.id;

    const draftRes = await admin.app.request(
      `http://localhost/api/public/cfp/${event.slug}/drafts`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          formVersionId,
          title: "Title-only Draft Must Not Eval",
        }),
      },
      env,
    );
    expect(draftRes.status).toBe(201);
    const draftBody = (await draftRes.json()) as {
      submission: { id: string; status: string };
    };
    expect(draftBody.submission.status).toBe("draft");
    const draftId = draftBody.submission.id;

    // Assign to draft → 400
    const assignDraft = await admin.app.request(
      `http://localhost/api/submissions/${draftId}/assign`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
          "x-correlation-id": "corr-assign-draft",
        },
        body: JSON.stringify({ userIds: [evaluator.userId] }),
      },
      env,
    );
    expect(assignDraft.status).toBe(400);
    const assignErr = ErrorEnvelopeSchema.parse(await assignDraft.json());
    expect(assignErr.code).toBe(VALIDATION_ERROR);
    expect(assignErr.error.toLowerCase()).toMatch(/draft/);

    // Rollup must include submitted, exclude draft
    const rollupRes = await admin.app.request(
      `http://localhost/api/events/${event.id}/eval/rollup`,
      { headers: { cookie: admin.cookie } },
      env,
    );
    expect(rollupRes.status).toBe(200);
    const rollup = EvalAdminRollupResponseSchema.parse(await rollupRes.json());
    expect(rollup.submissions.some((s) => s.submissionId === draftId)).toBe(
      false,
    );
    expect(
      rollup.submissions.some((s) => s.submissionId === submittedId),
    ).toBe(true);

    // CSV export must not list draft id/title
    const exportRes = await admin.app.request(
      `http://localhost/api/events/${event.id}/eval/export`,
      { headers: { cookie: admin.cookie } },
      env,
    );
    expect(exportRes.status).toBe(200);
    const csv = await exportRes.text();
    expect(csv).not.toContain(draftId);
    expect(csv).not.toContain("Title-only Draft Must Not Eval");
    expect(csv).toContain(submittedId);
  });

  it("Eval.GetProposal returns answers/speakers; wrong evaluator forbidden", async () => {
    const shared = createAppWithAuth({ cookieSecure: true });
    const admin = await magicLinkSession(
      "admin",
      "eval-admin-proposal@example.com",
      undefined,
      shared,
    );
    const event = await createEvent(admin.app, admin.cookie, "Proposal Event");
    const evaluator = await magicLinkSession(
      "evaluator",
      "eval-owner-proposal@example.com",
      event.id,
      shared,
    );
    const otherEval = await magicLinkSession(
      "evaluator",
      "eval-other-proposal@example.com",
      event.id,
      shared,
    );

    await admin.app.request(
      `http://localhost/api/events/${event.id}/eval/rubric`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
        },
        body: JSON.stringify({
          criteria: [{ name: "Clarity", maxScore: 5, weight: 1 }],
        }),
      },
      env,
    );

    const submissionId = await publishAndSubmit(
      admin.app,
      admin.cookie,
      event.id,
      event.slug,
      "Proposal Talk With Body",
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
    expect(assign.status).toBe(200);
    const assignBody = SubmissionAssignResponseSchema.parse(
      await assign.json(),
    );
    const assignmentId = assignBody.assignments[0]!.id;

    // Owner can load proposal with answers + speakers
    const okRes = await admin.app.request(
      `http://localhost/api/me/eval-assignments/${assignmentId}/proposal`,
      { method: "GET", headers: { cookie: evaluator.cookie } },
      env,
    );
    expect(okRes.status).toBe(200);
    const proposal = EvalProposalResponseSchema.parse(await okRes.json());
    expect(proposal.assignmentId).toBe(assignmentId);
    expect(proposal.submission.id).toBe(submissionId);
    expect(proposal.submission.title).toBe("Proposal Talk With Body");
    expect(proposal.answers.length).toBeGreaterThan(0);
    expect(proposal.answers.some((a) => a.fieldKey === "talk_title")).toBe(
      true,
    );
    expect(proposal.speakers.length).toBeGreaterThanOrEqual(1);
    expect(proposal.speakers[0]!.email).toContain("@");

    // Different evaluator on same event cannot read this assignment (404, no leak)
    const forbidden = await admin.app.request(
      `http://localhost/api/me/eval-assignments/${assignmentId}/proposal`,
      { method: "GET", headers: { cookie: otherEval.cookie } },
      env,
    );
    expect(forbidden.status).toBe(404);
    const forbBody = ErrorEnvelopeSchema.parse(await forbidden.json());
    expect(forbBody.code).toBe(NOT_FOUND);

    // Unknown assignment 404
    const missing = await admin.app.request(
      "http://localhost/api/me/eval-assignments/assign_does_not_exist/proposal",
      { method: "GET", headers: { cookie: evaluator.cookie } },
      env,
    );
    expect(missing.status).toBe(404);

    // Unauthenticated 401
    const unauth = await admin.app.request(
      `http://localhost/api/me/eval-assignments/${assignmentId}/proposal`,
      { method: "GET" },
      env,
    );
    expect(unauth.status).toBe(401);
  });

  it("demoted evaluator cannot read proposal or abstain", async () => {
    const shared = createAppWithAuth({ cookieSecure: true });
    const admin = await magicLinkSession(
      "admin",
      "eval-admin-demote@example.com",
      undefined,
      shared,
    );
    const event = await createEvent(admin.app, admin.cookie, "Demote Event");
    const evaluator = await magicLinkSession(
      "evaluator",
      "eval-demote-owner@example.com",
      event.id,
      shared,
    );

    await admin.app.request(
      `http://localhost/api/events/${event.id}/eval/rubric`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
        },
        body: JSON.stringify({
          criteria: [{ name: "Clarity", maxScore: 5, weight: 1 }],
        }),
      },
      env,
    );
    const submissionId = await publishAndSubmit(
      admin.app,
      admin.cookie,
      event.id,
      event.slug,
      "Demote Talk",
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
    expect(assign.status).toBe(200);
    const assignmentId = SubmissionAssignResponseSchema.parse(
      await assign.json(),
    ).assignments[0]!.id;

    // Mark scored so demotion is allowed (pending-assignment guard).
    await shared.eval.updateAssignment(assignmentId, {
      status: "scored",
      updatedAt: new Date().toISOString(),
    });

    const demote = await admin.app.request(
      `http://localhost/api/events/${event.id}/members/${evaluator.userId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
        },
        body: JSON.stringify({ role: "speaker" }),
      },
      env,
    );
    expect(demote.status).toBe(200);

    const proposal = await admin.app.request(
      `http://localhost/api/me/eval-assignments/${assignmentId}/proposal`,
      { method: "GET", headers: { cookie: evaluator.cookie } },
      env,
    );
    // Still a member (speaker) — wrong-role is 403, not a 404 leak.
    expect(proposal.status).toBe(403);

    const abstain = await admin.app.request(
      `http://localhost/api/me/eval-assignments/${assignmentId}/abstain`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: evaluator.cookie,
        },
        body: JSON.stringify({}),
      },
      env,
    );
    expect(abstain.status).toBe(403);
  });

  it("thin-area: peer reviews reveal-after-submit only", async () => {
    const shared = createAppWithAuth({ cookieSecure: true });
    const admin = await magicLinkSession(
      "admin",
      "eval-peer-admin@example.com",
      undefined,
      shared,
    );
    const event = await createEvent(admin.app, admin.cookie, "Peer Reveal Event");
    const evalA = await magicLinkSession(
      "evaluator",
      "eval-peer-a@example.com",
      event.id,
      shared,
    );
    const evalB = await magicLinkSession(
      "evaluator",
      "eval-peer-b@example.com",
      event.id,
      shared,
    );

    const submissionId = await publishAndSubmit(
      admin.app,
      admin.cookie,
      event.id,
      event.slug,
      "Peer Talk",
    );

    // Rubric required before assign (matches existing eval tests)
    const rubric = await admin.app.request(
      `http://localhost/api/events/${event.id}/eval/rubric`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
        },
        body: JSON.stringify({
          name: "Peer Round",
          criteria: [{ name: "Impact", maxScore: 5, weight: 1 }],
        }),
      },
      env,
    );
    expect(rubric.status).toBe(200);
    const rubricBody = EvalRubricResponseSchema.parse(await rubric.json());

    const assignRes = await admin.app.request(
      `http://localhost/api/submissions/${submissionId}/assign`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
        },
        body: JSON.stringify({
          userIds: [evalA.userId, evalB.userId],
        }),
      },
      env,
    );
    expect(assignRes.status).toBe(200);
    void rubricBody;

    // A scores first
    const queueA = await admin.app.request(
      "http://localhost/api/me/eval-queue",
      { method: "GET", headers: { cookie: evalA.cookie } },
      env,
    );
    const queueABody = await queueA.json();
    const itemA = (
      queueABody as {
        items: Array<{
          assignment: { id: string };
          criteria: Array<{ id: string; maxScore: number }>;
        }>;
      }
    ).items.find((i) => i.assignment);
    expect(itemA).toBeTruthy();

    // Before B scores, A should not see B's pending peer comment
    const reviewsBefore = await admin.app.request(
      `http://localhost/api/submissions/${submissionId}/eval-reviews`,
      { method: "GET", headers: { cookie: evalA.cookie } },
      env,
    );
    expect(reviewsBefore.status).toBe(200);
    const beforeBody = (await reviewsBefore.json()) as {
      reviews: Array<{
        evaluatorUserId: string;
        status: string;
        overallComment: string | null;
      }>;
    };
    const peerBBefore = beforeBody.reviews.find(
      (r) => r.evaluatorUserId === evalB.userId,
    );
    expect(peerBBefore).toBeUndefined();

    // Score A
    const crit = itemA!.criteria[0];
    if (crit) {
      await admin.app.request(
        `http://localhost/api/assignments/${itemA!.assignment.id}/scores`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: evalA.cookie,
          },
          body: JSON.stringify({
            scores: [{ criterionId: crit.id, value: crit.maxScore }],
            comment: "A says great",
          }),
        },
        env,
      );
    }

    // Score B
    const queueB = await admin.app.request(
      "http://localhost/api/me/eval-queue",
      { method: "GET", headers: { cookie: evalB.cookie } },
      env,
    );
    const queueBBody = await queueB.json();
    const itemB = (
      queueBBody as {
        items: Array<{
          assignment: { id: string };
          criteria: Array<{ id: string; maxScore: number }>;
        }>;
      }
    ).items[0];
    expect(itemB).toBeTruthy();
    const critB = itemB!.criteria[0];
    if (critB) {
      await admin.app.request(
        `http://localhost/api/assignments/${itemB!.assignment.id}/scores`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: evalB.cookie,
          },
          body: JSON.stringify({
            scores: [{ criterionId: critB.id, value: 1 }],
            comment: "B says solid",
          }),
        },
        env,
      );
    }

    // After B scored, A can see B's review
    const reviewsAfter = await admin.app.request(
      `http://localhost/api/submissions/${submissionId}/eval-reviews`,
      { method: "GET", headers: { cookie: evalA.cookie } },
      env,
    );
    expect(reviewsAfter.status).toBe(200);
    const afterBody = (await reviewsAfter.json()) as {
      reviews: Array<{
        evaluatorUserId: string;
        overallComment: string | null;
        evaluatorEmail: string | null;
      }>;
    };
    const peerBAfter = afterBody.reviews.find(
      (r) => r.evaluatorUserId === evalB.userId,
    );
    expect(peerBAfter).toBeTruthy();
    expect(peerBAfter!.overallComment).toBe("B says solid");
    expect(peerBAfter!.evaluatorEmail).toContain("@");

    // Admin sees all
    const adminReviews = await admin.app.request(
      `http://localhost/api/submissions/${submissionId}/eval-reviews`,
      { method: "GET", headers: { cookie: admin.cookie } },
      env,
    );
    expect(adminReviews.status).toBe(200);
    const adminBody = (await adminReviews.json()) as {
      reviews: unknown[];
    };
    expect(adminBody.reviews.length).toBeGreaterThanOrEqual(2);
  });
});
