/**
 * Post-11.9 depth Wave 1A — evaluation knobs (Vitest).
 *
 * Item 4 — Eval.Abstain:
 * - owner-verified (peer 403), reason stored, status abstained
 * - second abstain 409; abstained excluded from aggregates; rollup counts distinctly
 *
 * Item 5 — round close enforcement:
 * - rubric closesAt + instructionsMd roundtrip
 * - Eval.Score and Eval.Abstain 409 after close
 *
 * Item 6 — insights data:
 * - rollup DTO carries scoreSpread (max−min across scored aggregates)
 * - CSV export counts abstentions distinctly
 */
import { describe, it, expect } from "vitest";
import {
  EventResponseSchema,
  FormCreateResponseSchema,
  FormPublishResponseSchema,
  SubmissionCreateResponseSchema,
  SubmissionAssignResponseSchema,
  EvalRubricResponseSchema,
  EvalAbstainResponseSchema,
  EvalQueueResponseSchema,
  EvalAdminRollupResponseSchema,
  ErrorEnvelopeSchema,
  SESSION_COOKIE_NAME,
  TURNSTILE_DEV_PASS_TOKEN,
} from "@speakerops/shared";
import { createAppWithAuth } from "../../index.js";

const env = { APP_VERSION: "0.1.0" };

type AppCtx = ReturnType<typeof createAppWithAuth>;

async function session(
  ctx: AppCtx,
  purpose: "admin" | "evaluator",
  email: string,
  eventId?: string,
): Promise<{ cookie: string; userId: string }> {
  const { app, outbox } = ctx;
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
  const link = outbox.lastForEmail(email)!;
  const exchange = await app.request(
    "http://localhost/api/auth/exchange",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: link.token }),
    },
    env,
  );
  expect(exchange.status).toBe(200);
  const setCookie = exchange.headers.get("set-cookie")!;
  const value = setCookie.split(";")[0]!.split("=").slice(1).join("=");
  return {
    cookie: `${SESSION_COOKIE_NAME}=${value}`,
    userId: link.userId!,
  };
}

async function jsonReq(
  ctx: AppCtx,
  method: string,
  path: string,
  cookie: string | null,
  body?: unknown,
): Promise<Response> {
  return ctx.app.request(
    `http://localhost${path}`,
    {
      method,
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
        "x-correlation-id": "corr-w1a-eval",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
    env,
  );
}

/** Seed event + published CFP + one submission; return ids. */
async function seedSubmission(
  ctx: AppCtx,
  adminCookie: string,
  title: string,
): Promise<{ eventId: string; slug: string; submissionId: string }> {
  const evRes = await jsonReq(ctx, "POST", "/api/events", adminCookie, {
    name: `W1A Eval ${title}`,
    timezone: "UTC",
  });
  expect(evRes.status).toBe(201);
  const event = EventResponseSchema.parse(await evRes.json()).event;

  const formRes = await jsonReq(
    ctx,
    "POST",
    `/api/events/${event.id}/forms`,
    adminCookie,
    { name: "Eval CFP" },
  );
  expect(formRes.status).toBe(201);
  const formId = FormCreateResponseSchema.parse(await formRes.json()).form.id;

  const draftRes = await jsonReq(
    ctx,
    "PUT",
    `/api/forms/${formId}/draft`,
    adminCookie,
    {
      fields: [
        {
          fieldKey: "talk_title",
          type: "text",
          label: "Talk title",
          required: true,
          sortOrder: 0,
        },
      ],
    },
  );
  expect(draftRes.status).toBe(200);

  const pubRes = await jsonReq(
    ctx,
    "POST",
    `/api/forms/${formId}/publish`,
    adminCookie,
    {},
  );
  expect(pubRes.status).toBe(200);
  const versionId = FormPublishResponseSchema.parse(await pubRes.json())
    .formVersion.id;

  const subRes = await jsonReq(
    ctx,
    "POST",
    `/api/public/cfp/${event.slug}/submissions`,
    null,
    {
      formVersionId: versionId,
      title,
      answers: [{ fieldKey: "talk_title", value: title }],
      speakers: [
        {
          name: "Speaker",
          email: `speaker-${title.replace(/\s+/g, "-").toLowerCase()}@example.com`,
        },
      ],
      turnstileToken: TURNSTILE_DEV_PASS_TOKEN,
    },
  );
  expect(subRes.status).toBe(201);
  const submissionId = SubmissionCreateResponseSchema.parse(
    await subRes.json(),
  ).submission.id;
  return { eventId: event.id, slug: event.slug, submissionId };
}

async function putRubric(
  ctx: AppCtx,
  adminCookie: string,
  eventId: string,
  extra?: Record<string, unknown>,
): Promise<{ roundId: string; criteria: Array<{ id: string }> }> {
  const res = await jsonReq(
    ctx,
    "PUT",
    `/api/events/${eventId}/eval/rubric`,
    adminCookie,
    {
      name: "Depth rubric",
      criteria: [{ name: "Overall", maxScore: 10, weight: 1 }],
      ...(extra ?? {}),
    },
  );
  expect(res.status).toBe(200);
  const parsed = EvalRubricResponseSchema.parse(await res.json());
  return { roundId: parsed.round.id, criteria: parsed.criteria };
}

async function assign(
  ctx: AppCtx,
  adminCookie: string,
  submissionId: string,
  userIds: string[],
): Promise<Map<string, string>> {
  const res = await jsonReq(
    ctx,
    "POST",
    `/api/submissions/${submissionId}/assign`,
    adminCookie,
    { userIds },
  );
  expect(res.status).toBe(200);
  const parsed = SubmissionAssignResponseSchema.parse(await res.json());
  return new Map(
    parsed.assignments.map((a) => [a.evaluatorUserId, a.id]),
  );
}

describe("Wave 1A item 4 — Eval.Abstain", () => {
  it("abstains with reason, excludes from aggregates, blocks repeat + peers", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const admin = await session(ctx, "admin", "w1a-abstain-admin@example.com");
    const { eventId, submissionId } = await seedSubmission(
      ctx,
      admin.cookie,
      "Abstain Talk",
    );
    const { criteria } = await putRubric(ctx, admin.cookie, eventId);

    const evalA = await session(
      ctx,
      "evaluator",
      "w1a-eval-a@example.com",
      eventId,
    );
    const evalB = await session(
      ctx,
      "evaluator",
      "w1a-eval-b@example.com",
      eventId,
    );
    const byUser = await assign(ctx, admin.cookie, submissionId, [
      evalA.userId,
      evalB.userId,
    ]);
    const assignmentA = byUser.get(evalA.userId)!;
    const assignmentB = byUser.get(evalB.userId)!;

    // Peer cannot abstain someone else's assignment (owner-verified).
    const peer = await jsonReq(
      ctx,
      "POST",
      `/api/me/eval-assignments/${assignmentA}/abstain`,
      evalB.cookie,
      { reason: "not mine" },
    );
    expect(peer.status).toBe(403);

    // B scores 6; A abstains with reason.
    const score = await jsonReq(
      ctx,
      "POST",
      `/api/assignments/${assignmentB}/scores`,
      evalB.cookie,
      { scores: [{ criterionId: criteria[0]!.id, value: 6 }] },
    );
    expect(score.status).toBe(200);

    const abstain = await jsonReq(
      ctx,
      "POST",
      `/api/me/eval-assignments/${assignmentA}/abstain`,
      evalA.cookie,
      { reason: "Conflict of interest" },
    );
    expect(abstain.status).toBe(200);
    const abstained = EvalAbstainResponseSchema.parse(await abstain.json());
    expect(abstained.assignment.status).toBe("abstained");
    expect(abstained.assignment.abstainReason).toBe("Conflict of interest");
    expect(abstained.assignment.aggregateScore).toBeNull();

    // Second abstain → 409.
    const again = await jsonReq(
      ctx,
      "POST",
      `/api/me/eval-assignments/${assignmentA}/abstain`,
      evalA.cookie,
      {},
    );
    expect(again.status).toBe(409);

    // Queue reflects abstained status for A.
    const queue = await ctx.app.request(
      "http://localhost/api/me/eval-queue",
      { headers: { cookie: evalA.cookie, accept: "application/json" } },
      env,
    );
    const queueBody = EvalQueueResponseSchema.parse(await queue.json());
    expect(
      queueBody.items.find((i) => i.assignment.id === assignmentA)?.assignment
        .status,
    ).toBe("abstained");

    // Rollup: aggregate stays at B's 6; abstention counted distinctly with reason.
    const rollupRes = await ctx.app.request(
      `http://localhost/api/events/${eventId}/eval/rollup`,
      { headers: { cookie: admin.cookie, accept: "application/json" } },
      env,
    );
    expect(rollupRes.status).toBe(200);
    const rollup = EvalAdminRollupResponseSchema.parse(await rollupRes.json());
    const row = rollup.submissions.find(
      (s) => s.submissionId === submissionId,
    )!;
    expect(row.aggregateScore).toBe(6);
    expect(row.abstainedCount).toBe(1);
    const abstainedAssignment = row.assignments.find(
      (a) => a.status === "abstained",
    )!;
    expect(abstainedAssignment.abstainReason).toBe("Conflict of interest");

    // CSV export counts abstentions distinctly.
    const csvRes = await ctx.app.request(
      `http://localhost/api/events/${eventId}/eval/export`,
      { headers: { cookie: admin.cookie, accept: "text/csv" } },
      env,
    );
    expect(csvRes.status).toBe(200);
    const csv = await csvRes.text();
    expect(csv.split(/\r?\n/)[0]).toContain("abstainedCount");
    expect(csv).toContain("Conflict of interest");
  });
});

describe("Wave 1A item 5 — round close enforcement", () => {
  it("roundtrips closesAt + instructionsMd and 409s score/abstain after close", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const admin = await session(ctx, "admin", "w1a-close-admin@example.com");
    const { eventId, submissionId } = await seedSubmission(
      ctx,
      admin.cookie,
      "Close Talk",
    );
    const { criteria } = await putRubric(ctx, admin.cookie, eventId, {
      closesAt: "2030-01-01T00:00:00.000Z",
      instructionsMd: "Judge fairly; deadline strict.",
    });

    // Roundtrip via GET.
    const get = await ctx.app.request(
      `http://localhost/api/events/${eventId}/eval/rubric`,
      { headers: { cookie: admin.cookie, accept: "application/json" } },
      env,
    );
    const rubric = EvalRubricResponseSchema.parse(await get.json());
    expect(rubric.round.closesAt).toBe("2030-01-01T00:00:00.000Z");
    expect(rubric.round.instructionsMd).toBe(
      "Judge fairly; deadline strict.",
    );

    const evaluator = await session(
      ctx,
      "evaluator",
      "w1a-close-eval@example.com",
      eventId,
    );
    const byUser = await assign(ctx, admin.cookie, submissionId, [
      evaluator.userId,
    ]);
    const assignmentId = byUser.get(evaluator.userId)!;

    // Close the round (deadline in the past — keep same roundId).
    await putRubric(ctx, admin.cookie, eventId, {
      roundId: rubric.round.id,
      criteria: rubric.criteria.map((c) => ({
        id: c.id,
        name: c.name,
        maxScore: c.maxScore,
        weight: c.weight,
      })),
      closesAt: "2020-01-01T00:00:00.000Z",
    });

    const lateScore = await jsonReq(
      ctx,
      "POST",
      `/api/assignments/${assignmentId}/scores`,
      evaluator.cookie,
      { scores: [{ criterionId: criteria[0]!.id, value: 5 }] },
    );
    expect(lateScore.status).toBe(409);
    const scoreEnv = ErrorEnvelopeSchema.parse(await lateScore.json());
    expect(scoreEnv.error.toLowerCase()).toContain("closed");

    const lateAbstain = await jsonReq(
      ctx,
      "POST",
      `/api/me/eval-assignments/${assignmentId}/abstain`,
      evaluator.cookie,
      { reason: "too late" },
    );
    expect(lateAbstain.status).toBe(409);
  });
});

describe("Wave 1A item 6 — divergence insights data", () => {
  it("rollup carries scoreSpread = max−min over scored aggregates", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const admin = await session(ctx, "admin", "w1a-spread-admin@example.com");
    const { eventId, submissionId } = await seedSubmission(
      ctx,
      admin.cookie,
      "Spread Talk",
    );
    const { criteria } = await putRubric(ctx, admin.cookie, eventId);

    const evalA = await session(
      ctx,
      "evaluator",
      "w1a-spread-a@example.com",
      eventId,
    );
    const evalB = await session(
      ctx,
      "evaluator",
      "w1a-spread-b@example.com",
      eventId,
    );
    const byUser = await assign(ctx, admin.cookie, submissionId, [
      evalA.userId,
      evalB.userId,
    ]);

    for (const [who, value] of [
      [evalA, 2],
      [evalB, 9],
    ] as const) {
      const res = await jsonReq(
        ctx,
        "POST",
        `/api/assignments/${byUser.get(who.userId)!}/scores`,
        who.cookie,
        { scores: [{ criterionId: criteria[0]!.id, value }] },
      );
      expect(res.status).toBe(200);
    }

    const rollupRes = await ctx.app.request(
      `http://localhost/api/events/${eventId}/eval/rollup`,
      { headers: { cookie: admin.cookie, accept: "application/json" } },
      env,
    );
    const rollup = EvalAdminRollupResponseSchema.parse(await rollupRes.json());
    const row = rollup.submissions.find(
      (s) => s.submissionId === submissionId,
    )!;
    expect(row.scoreSpread).toBe(7);
    expect(row.aggregateScore).toBe(5.5);
  });
});
