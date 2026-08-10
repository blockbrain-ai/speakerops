/**
 * Wave 2 — Eval.BulkAssign wizard (Vitest).
 *
 * POST /api/events/:eventId/eval/bulk-assign
 * - preview (dryRun=true) → deterministic plan + previewId (estate hash)
 * - commit (dryRun=false) requires previewId; drift → 409; single-use via
 *   idempotency_keys (replay returns stored response, inserts nothing)
 * - modes: all_to_all / round_robin (reviewersPerSubmission, maxPerEvaluator)
 * - existing preserve keeps + skips; replace removes pending-not-in-plan only
 */
import { describe, it, expect } from "vitest";
import {
  EventResponseSchema,
  FormCreateResponseSchema,
  FormPublishResponseSchema,
  SubmissionCreateResponseSchema,
  SubmissionAssignResponseSchema,
  EvalRubricResponseSchema,
  EvalAdminRollupResponseSchema,
  EvalBulkAssignResponseSchema,
  ErrorEnvelopeSchema,
  SESSION_COOKIE_NAME,
  TURNSTILE_DEV_PASS_TOKEN,
  type EvalBulkAssignResponse,
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
        "x-correlation-id": "corr-bulk-assign",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
    env,
  );
}

/** Seed event + published CFP form; returns ids for adding submissions. */
async function seedEvent(
  ctx: AppCtx,
  adminCookie: string,
  name: string,
): Promise<{ eventId: string; slug: string; versionId: string }> {
  const evRes = await jsonReq(ctx, "POST", "/api/events", adminCookie, {
    name,
    timezone: "UTC",
  });
  expect(evRes.status).toBe(201);
  const event = EventResponseSchema.parse(await evRes.json()).event;

  const formRes = await jsonReq(
    ctx,
    "POST",
    `/api/events/${event.id}/forms`,
    adminCookie,
    { name: "Bulk CFP" },
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
  return { eventId: event.id, slug: event.slug, versionId };
}

/** Unique per-call client IP so the shared CFP rate limiter never trips. */
let addSubmissionIpCounter = 0;

async function addSubmission(
  ctx: AppCtx,
  slug: string,
  versionId: string,
  title: string,
): Promise<string> {
  addSubmissionIpCounter += 1;
  const subRes = await ctx.app.request(
    `http://localhost/api/public/cfp/${slug}/submissions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-correlation-id": "corr-bulk-assign",
        "x-forwarded-for": `198.51.100.${addSubmissionIpCounter % 250}, 203.0.113.${Math.floor(addSubmissionIpCounter / 250) % 250}`,
      },
      body: JSON.stringify({
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
      }),
    },
    env,
  );
  expect(subRes.status).toBe(201);
  return SubmissionCreateResponseSchema.parse(await subRes.json()).submission
    .id;
}

async function putRubric(
  ctx: AppCtx,
  adminCookie: string,
  eventId: string,
): Promise<{ roundId: string; criteria: Array<{ id: string }> }> {
  const res = await jsonReq(
    ctx,
    "PUT",
    `/api/events/${eventId}/eval/rubric`,
    adminCookie,
    {
      name: "Bulk rubric",
      criteria: [{ name: "Overall", maxScore: 10, weight: 1 }],
    },
  );
  expect(res.status).toBe(200);
  const parsed = EvalRubricResponseSchema.parse(await res.json());
  return { roundId: parsed.round.id, criteria: parsed.criteria };
}

async function assignDirect(
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
  return new Map(parsed.assignments.map((a) => [a.evaluatorUserId, a.id]));
}

async function bulkAssign(
  ctx: AppCtx,
  adminCookie: string,
  eventId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return jsonReq(
    ctx,
    "POST",
    `/api/events/${eventId}/eval/bulk-assign`,
    adminCookie,
    body,
  );
}

async function parseBulk(res: Response): Promise<EvalBulkAssignResponse> {
  expect(res.status).toBe(200);
  return EvalBulkAssignResponseSchema.parse(await res.json());
}

/** Durable state: (submissionId → evaluatorUserId[] + statuses) from rollup. */
async function rollupPairs(
  ctx: AppCtx,
  adminCookie: string,
  eventId: string,
): Promise<Map<string, Array<{ evaluatorUserId: string; status: string }>>> {
  const res = await ctx.app.request(
    `http://localhost/api/events/${eventId}/eval/rollup`,
    { headers: { cookie: adminCookie, accept: "application/json" } },
    env,
  );
  expect(res.status).toBe(200);
  const rollup = EvalAdminRollupResponseSchema.parse(await res.json());
  const map = new Map<
    string,
    Array<{ evaluatorUserId: string; status: string }>
  >();
  for (const s of rollup.submissions) {
    map.set(
      s.submissionId,
      s.assignments
        .map((a) => ({ evaluatorUserId: a.evaluatorUserId, status: a.status }))
        .sort((a, b) => a.evaluatorUserId.localeCompare(b.evaluatorUserId)),
    );
  }
  return map;
}

describe("Eval.BulkAssign — capacity", () => {
  it("zero remaining capacity yields capacityFailures and inserts nothing", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const admin = await session(ctx, "admin", "bulk-cap-admin@example.com");
    const { eventId, slug, versionId } = await seedEvent(
      ctx,
      admin.cookie,
      "Bulk Cap Event",
    );
    const s1 = await addSubmission(ctx, slug, versionId, "Cap Talk One");
    const s2 = await addSubmission(ctx, slug, versionId, "Cap Talk Two");
    const { roundId } = await putRubric(ctx, admin.cookie, eventId);
    const evalA = await session(
      ctx,
      "evaluator",
      "bulk-cap-eval@example.com",
      eventId,
    );
    // Consume the whole cap up front.
    await assignDirect(ctx, admin.cookie, s1, [evalA.userId]);

    const preview = await parseBulk(
      await bulkAssign(ctx, admin.cookie, eventId, {
        roundId,
        evaluatorIds: [evalA.userId],
        submissionFilter: {},
        mode: "round_robin",
        reviewersPerSubmission: 1,
        maxPerEvaluator: 1,
        existing: "preserve",
        dryRun: true,
      }),
    );
    expect(preview.additions).toHaveLength(0);
    expect(preview.capacityFailures).toEqual([
      expect.objectContaining({ submissionId: s2, needed: 1, got: 0 }),
    ]);
    expect(preview.skipped).toEqual([
      expect.objectContaining({
        submissionId: s1,
        evaluatorUserId: evalA.userId,
        reason: "already assigned",
      }),
    ]);

    const commit = await parseBulk(
      await bulkAssign(ctx, admin.cookie, eventId, {
        roundId,
        evaluatorIds: [evalA.userId],
        submissionFilter: {},
        mode: "round_robin",
        reviewersPerSubmission: 1,
        maxPerEvaluator: 1,
        existing: "preserve",
        dryRun: false,
        previewId: preview.previewId,
      }),
    );
    expect(commit.counts.additions).toBe(0);

    const pairs = await rollupPairs(ctx, admin.cookie, eventId);
    expect(pairs.get(s1)).toHaveLength(1);
    expect(pairs.get(s2)).toHaveLength(0);
  });
});

describe("Eval.BulkAssign — existing=preserve", () => {
  it("keeps existing pairs, skips them as already assigned, adds the rest", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const admin = await session(ctx, "admin", "bulk-pres-admin@example.com");
    const { eventId, slug, versionId } = await seedEvent(
      ctx,
      admin.cookie,
      "Bulk Preserve Event",
    );
    const s1 = await addSubmission(ctx, slug, versionId, "Preserve One");
    const s2 = await addSubmission(ctx, slug, versionId, "Preserve Two");
    const { roundId } = await putRubric(ctx, admin.cookie, eventId);
    const evalA = await session(
      ctx,
      "evaluator",
      "bulk-pres-a@example.com",
      eventId,
    );
    const evalB = await session(
      ctx,
      "evaluator",
      "bulk-pres-b@example.com",
      eventId,
    );
    await assignDirect(ctx, admin.cookie, s1, [evalA.userId]);

    const preview = await parseBulk(
      await bulkAssign(ctx, admin.cookie, eventId, {
        roundId,
        evaluatorIds: [evalA.userId, evalB.userId],
        submissionFilter: {},
        mode: "all_to_all",
        existing: "preserve",
        dryRun: true,
      }),
    );
    expect(preview.counts.additions).toBe(3);
    expect(preview.counts.removals).toBe(0);
    expect(preview.skipped).toEqual([
      expect.objectContaining({
        submissionId: s1,
        evaluatorUserId: evalA.userId,
        reason: "already assigned",
      }),
    ]);

    const commit = await parseBulk(
      await bulkAssign(ctx, admin.cookie, eventId, {
        roundId,
        evaluatorIds: [evalA.userId, evalB.userId],
        submissionFilter: {},
        mode: "all_to_all",
        existing: "preserve",
        dryRun: false,
        previewId: preview.previewId,
      }),
    );
    expect(commit.counts.additions).toBe(3);
    expect(commit.idempotent).toBeUndefined();

    const pairs = await rollupPairs(ctx, admin.cookie, eventId);
    const want = [evalA.userId, evalB.userId].sort();
    expect(pairs.get(s1)!.map((a) => a.evaluatorUserId)).toEqual(want);
    expect(pairs.get(s2)!.map((a) => a.evaluatorUserId)).toEqual(want);
  });
});

describe("Eval.BulkAssign — existing=replace", () => {
  it("removes pending assignments not in the plan but never scored ones", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const admin = await session(ctx, "admin", "bulk-repl-admin@example.com");
    const { eventId, slug, versionId } = await seedEvent(
      ctx,
      admin.cookie,
      "Bulk Replace Event",
    );
    const s1 = await addSubmission(ctx, slug, versionId, "Replace One");
    const s2 = await addSubmission(ctx, slug, versionId, "Replace Two");
    const { roundId, criteria } = await putRubric(ctx, admin.cookie, eventId);
    const evalA = await session(
      ctx,
      "evaluator",
      "bulk-repl-a@example.com",
      eventId,
    );
    const evalB = await session(
      ctx,
      "evaluator",
      "bulk-repl-b@example.com",
      eventId,
    );
    const evalC = await session(
      ctx,
      "evaluator",
      "bulk-repl-c@example.com",
      eventId,
    );
    // A + C on s1; A scores (protected), C stays pending (removable).
    const byUser = await assignDirect(ctx, admin.cookie, s1, [
      evalA.userId,
      evalC.userId,
    ]);
    const scoreRes = await jsonReq(
      ctx,
      "POST",
      `/api/assignments/${byUser.get(evalA.userId)!}/scores`,
      evalA.cookie,
      { scores: [{ criterionId: criteria[0]!.id, value: 7 }] },
    );
    expect(scoreRes.status).toBe(200);

    const preview = await parseBulk(
      await bulkAssign(ctx, admin.cookie, eventId, {
        roundId,
        evaluatorIds: [evalB.userId],
        submissionFilter: {},
        mode: "all_to_all",
        existing: "replace",
        dryRun: true,
      }),
    );
    // Plan: B on s1 + s2; C's pending removed; A's scored kept (never removed).
    expect(preview.counts.additions).toBe(2);
    expect(preview.removals).toEqual([
      { submissionId: s1, evaluatorUserId: evalC.userId },
    ]);
    expect(preview.skipped).toContainEqual({
      submissionId: s1,
      evaluatorUserId: evalA.userId,
      reason: "has a score — kept",
    });

    await parseBulk(
      await bulkAssign(ctx, admin.cookie, eventId, {
        roundId,
        evaluatorIds: [evalB.userId],
        submissionFilter: {},
        mode: "all_to_all",
        existing: "replace",
        dryRun: false,
        previewId: preview.previewId,
      }),
    );

    const pairs = await rollupPairs(ctx, admin.cookie, eventId);
    expect(pairs.get(s1)).toEqual(
      [
        { evaluatorUserId: evalA.userId, status: "scored" },
        { evaluatorUserId: evalB.userId, status: "pending" },
      ].sort((a, b) => a.evaluatorUserId.localeCompare(b.evaluatorUserId)),
    );
    expect(pairs.get(s2)).toEqual([
      { evaluatorUserId: evalB.userId, status: "pending" },
    ]);
  });
});

describe("Eval.BulkAssign — idempotent commit", () => {
  it("replays a duplicate commit from idempotency_keys without new rows", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const admin = await session(ctx, "admin", "bulk-idem-admin@example.com");
    const { eventId, slug, versionId } = await seedEvent(
      ctx,
      admin.cookie,
      "Bulk Idem Event",
    );
    const s1 = await addSubmission(ctx, slug, versionId, "Idem Talk");
    const { roundId } = await putRubric(ctx, admin.cookie, eventId);
    const evalA = await session(
      ctx,
      "evaluator",
      "bulk-idem-eval@example.com",
      eventId,
    );

    const body = {
      roundId,
      evaluatorIds: [evalA.userId],
      submissionFilter: {},
      mode: "round_robin",
      reviewersPerSubmission: 1,
      existing: "preserve",
    };
    const preview = await parseBulk(
      await bulkAssign(ctx, admin.cookie, eventId, { ...body, dryRun: true }),
    );
    expect(preview.counts.additions).toBe(1);

    const first = await parseBulk(
      await bulkAssign(ctx, admin.cookie, eventId, {
        ...body,
        dryRun: false,
        previewId: preview.previewId,
      }),
    );
    expect(first.counts.additions).toBe(1);
    expect(first.idempotent).toBeUndefined();

    // Same previewId again → stored response, no additional durable rows.
    const second = await parseBulk(
      await bulkAssign(ctx, admin.cookie, eventId, {
        ...body,
        dryRun: false,
        previewId: preview.previewId,
      }),
    );
    expect(second.idempotent).toBe(true);
    expect(second.counts.additions).toBe(1);
    expect(second.previewId).toBe(preview.previewId);

    const pairs = await rollupPairs(ctx, admin.cookie, eventId);
    expect(pairs.get(s1)).toEqual([
      { evaluatorUserId: evalA.userId, status: "pending" },
    ]);
  });
});

describe("Eval.BulkAssign — stale preview", () => {
  it("409s when the matching estate drifted between preview and commit", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const admin = await session(ctx, "admin", "bulk-drift-admin@example.com");
    const { eventId, slug, versionId } = await seedEvent(
      ctx,
      admin.cookie,
      "Bulk Drift Event",
    );
    await addSubmission(ctx, slug, versionId, "Drift Talk One");
    const { roundId } = await putRubric(ctx, admin.cookie, eventId);
    const evalA = await session(
      ctx,
      "evaluator",
      "bulk-drift-eval@example.com",
      eventId,
    );

    const body = {
      roundId,
      evaluatorIds: [evalA.userId],
      submissionFilter: {},
      mode: "all_to_all",
      existing: "preserve",
    };
    const preview = await parseBulk(
      await bulkAssign(ctx, admin.cookie, eventId, { ...body, dryRun: true }),
    );

    // Estate drifts: a new matching submission arrives before the commit.
    await addSubmission(ctx, slug, versionId, "Drift Talk Two");

    const commit = await bulkAssign(ctx, admin.cookie, eventId, {
      ...body,
      dryRun: false,
      previewId: preview.previewId,
    });
    expect(commit.status).toBe(409);
    const envlp = ErrorEnvelopeSchema.parse(await commit.json());
    expect(envlp.error).toContain("The preview is stale");

    // Nothing was applied.
    const pairs = await rollupPairs(ctx, admin.cookie, eventId);
    for (const assignments of pairs.values()) {
      expect(assignments).toHaveLength(0);
    }
  });
});

describe("Eval.BulkAssign — validation", () => {
  it("400s listing unknown / cross-event evaluator ids", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const admin = await session(ctx, "admin", "bulk-x-admin@example.com");
    const { eventId, slug, versionId } = await seedEvent(
      ctx,
      admin.cookie,
      "Bulk XEvent A",
    );
    await addSubmission(ctx, slug, versionId, "XEvent Talk");
    const { roundId } = await putRubric(ctx, admin.cookie, eventId);
    const other = await seedEvent(ctx, admin.cookie, "Bulk XEvent B");
    const stranger = await session(
      ctx,
      "evaluator",
      "bulk-x-stranger@example.com",
      other.eventId,
    );

    const res = await bulkAssign(ctx, admin.cookie, eventId, {
      roundId,
      evaluatorIds: [stranger.userId, "usr-does-not-exist"],
      submissionFilter: {},
      mode: "all_to_all",
      existing: "preserve",
      dryRun: true,
    });
    expect(res.status).toBe(400);
    const envlp = ErrorEnvelopeSchema.parse(await res.json());
    const details = envlp.details as { userIds: string[] };
    expect(details.userIds.sort()).toEqual(
      [stranger.userId, "usr-does-not-exist"].sort(),
    );
  });

  it("400s all_to_all combined with reviewersPerSubmission", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const admin = await session(ctx, "admin", "bulk-mode-admin@example.com");
    const { eventId, slug, versionId } = await seedEvent(
      ctx,
      admin.cookie,
      "Bulk Mode Event",
    );
    await addSubmission(ctx, slug, versionId, "Mode Talk");
    const { roundId } = await putRubric(ctx, admin.cookie, eventId);
    const evalA = await session(
      ctx,
      "evaluator",
      "bulk-mode-eval@example.com",
      eventId,
    );

    const res = await bulkAssign(ctx, admin.cookie, eventId, {
      roundId,
      evaluatorIds: [evalA.userId],
      submissionFilter: {},
      mode: "all_to_all",
      reviewersPerSubmission: 2,
      existing: "preserve",
      dryRun: true,
    });
    expect(res.status).toBe(400);
    const envlp = ErrorEnvelopeSchema.parse(await res.json());
    expect(envlp.error).toBe(
      "reviewersPerSubmission only applies to round-robin",
    );
  });
});

describe("Eval.BulkAssign — round_robin determinism", () => {
  it("same inputs produce an identical plan; distribution honors both knobs", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const admin = await session(ctx, "admin", "bulk-rr-admin@example.com");
    const { eventId, slug, versionId } = await seedEvent(
      ctx,
      admin.cookie,
      "Bulk RR Event",
    );
    const subs = [
      await addSubmission(ctx, slug, versionId, "RR Talk One"),
      await addSubmission(ctx, slug, versionId, "RR Talk Two"),
      await addSubmission(ctx, slug, versionId, "RR Talk Three"),
    ];
    const { roundId } = await putRubric(ctx, admin.cookie, eventId);
    const evaluators = [
      await session(ctx, "evaluator", "bulk-rr-a@example.com", eventId),
      await session(ctx, "evaluator", "bulk-rr-b@example.com", eventId),
      await session(ctx, "evaluator", "bulk-rr-c@example.com", eventId),
    ];
    const evaluatorIds = evaluators.map((e) => e.userId);

    const body = {
      roundId,
      evaluatorIds,
      submissionFilter: {},
      mode: "round_robin",
      reviewersPerSubmission: 2,
      maxPerEvaluator: 2,
      existing: "preserve",
      dryRun: true,
    };
    const p1 = await parseBulk(await bulkAssign(ctx, admin.cookie, eventId, body));
    const p2 = await parseBulk(await bulkAssign(ctx, admin.cookie, eventId, body));

    // Deterministic: identical previewId and identical plan.
    expect(p2.previewId).toBe(p1.previewId);
    expect(p2.additions).toEqual(p1.additions);
    expect(p2.perEvaluator).toEqual(p1.perEvaluator);

    // Exactly reviewersPerSubmission per submission …
    expect(p1.counts.additions).toBe(6);
    for (const sub of subs) {
      expect(
        p1.additions.filter((a) => a.submissionId === sub),
      ).toHaveLength(2);
    }
    // … and exactly maxPerEvaluator per evaluator, no capacity failures.
    for (const userId of evaluatorIds) {
      expect(
        p1.additions.filter((a) => a.evaluatorUserId === userId),
      ).toHaveLength(2);
      expect(
        p1.perEvaluator.find((e) => e.userId === userId)?.planned,
      ).toBe(2);
    }
    expect(p1.capacityFailures).toHaveLength(0);

    // Submissions are allocated in id order — first sub gets the first two
    // evaluators in id order.
    const sortedSubs = [...subs].sort();
    const sortedEvals = [...evaluatorIds].sort();
    const firstSubAdds = p1.additions
      .filter((a) => a.submissionId === sortedSubs[0])
      .map((a) => a.evaluatorUserId);
    expect(firstSubAdds).toEqual([sortedEvals[0], sortedEvals[1]]);
  });
});

/**
 * Contract fix — the previewId binds the FULL assignment estate. Any change
 * to existing assignments (added / scored / abstained / removed), submission
 * eligibility (even without a status filter), or evaluator membership between
 * preview and commit must 409; a post-commit re-preview mints a NEW token;
 * concurrent duplicate commits apply exactly once (durable row count).
 */
describe("Eval.BulkAssign — full-estate previewId (drift → 409)", () => {
  /** Common seed: event + 2 submissions + rubric + evaluators A/B. */
  async function seedDrift(tag: string) {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const admin = await session(ctx, "admin", `bulk-fe-${tag}-admin@example.com`);
    const { eventId, slug, versionId } = await seedEvent(
      ctx,
      admin.cookie,
      `Bulk FullEstate ${tag}`,
    );
    const s1 = await addSubmission(ctx, slug, versionId, `FE ${tag} One`);
    const s2 = await addSubmission(ctx, slug, versionId, `FE ${tag} Two`);
    const rubric = await putRubric(ctx, admin.cookie, eventId);
    const evalA = await session(
      ctx,
      "evaluator",
      `bulk-fe-${tag}-a@example.com`,
      eventId,
    );
    const evalB = await session(
      ctx,
      "evaluator",
      `bulk-fe-${tag}-b@example.com`,
      eventId,
    );
    return { ctx, admin, eventId, slug, versionId, s1, s2, rubric, evalA, evalB };
  }

  function planBody(roundId: string, evaluatorIds: string[]) {
    return {
      roundId,
      evaluatorIds,
      submissionFilter: {},
      mode: "all_to_all",
      existing: "preserve",
    };
  }

  it("409s when an assignment is ADDED between preview and commit", async () => {
    const { ctx, admin, eventId, s1, rubric, evalA, evalB } =
      await seedDrift("add");
    const body = planBody(rubric.roundId, [evalB.userId]);
    const preview = await parseBulk(
      await bulkAssign(ctx, admin.cookie, eventId, { ...body, dryRun: true }),
    );

    // Out-of-band single assignment lands after the preview.
    await assignDirect(ctx, admin.cookie, s1, [evalA.userId]);

    const commit = await bulkAssign(ctx, admin.cookie, eventId, {
      ...body,
      dryRun: false,
      previewId: preview.previewId,
    });
    expect(commit.status).toBe(409);
    const envlp = ErrorEnvelopeSchema.parse(await commit.json());
    expect(envlp.error).toContain("The preview is stale");

    // Nothing beyond the out-of-band row was applied.
    const pairs = await rollupPairs(ctx, admin.cookie, eventId);
    expect(pairs.get(s1)).toEqual([
      { evaluatorUserId: evalA.userId, status: "pending" },
    ]);
  });

  it("409s when an existing assignment is SCORED between preview and commit", async () => {
    const { ctx, admin, eventId, s1, rubric, evalA, evalB } =
      await seedDrift("score");
    const byUser = await assignDirect(ctx, admin.cookie, s1, [evalA.userId]);
    const body = planBody(rubric.roundId, [evalB.userId]);
    const preview = await parseBulk(
      await bulkAssign(ctx, admin.cookie, eventId, { ...body, dryRun: true }),
    );

    const scoreRes = await jsonReq(
      ctx,
      "POST",
      `/api/assignments/${byUser.get(evalA.userId)!}/scores`,
      evalA.cookie,
      { scores: [{ criterionId: rubric.criteria[0]!.id, value: 8 }] },
    );
    expect(scoreRes.status).toBe(200);

    const commit = await bulkAssign(ctx, admin.cookie, eventId, {
      ...body,
      dryRun: false,
      previewId: preview.previewId,
    });
    expect(commit.status).toBe(409);
  });

  it("409s when an existing assignment is ABSTAINED between preview and commit", async () => {
    const { ctx, admin, eventId, s1, rubric, evalA, evalB } =
      await seedDrift("abstain");
    const byUser = await assignDirect(ctx, admin.cookie, s1, [evalA.userId]);
    const body = planBody(rubric.roundId, [evalB.userId]);
    const preview = await parseBulk(
      await bulkAssign(ctx, admin.cookie, eventId, { ...body, dryRun: true }),
    );

    const abstainRes = await jsonReq(
      ctx,
      "POST",
      `/api/me/eval-assignments/${byUser.get(evalA.userId)!}/abstain`,
      evalA.cookie,
      { reason: "Conflict of interest" },
    );
    expect(abstainRes.status).toBe(200);

    const commit = await bulkAssign(ctx, admin.cookie, eventId, {
      ...body,
      dryRun: false,
      previewId: preview.previewId,
    });
    expect(commit.status).toBe(409);
  });

  it("409s when an existing assignment is REMOVED between preview and commit", async () => {
    const { ctx, admin, eventId, s1, rubric, evalA, evalB } =
      await seedDrift("remove");
    const byUser = await assignDirect(ctx, admin.cookie, s1, [evalA.userId]);
    const body = planBody(rubric.roundId, [evalB.userId]);
    const preview = await parseBulk(
      await bulkAssign(ctx, admin.cookie, eventId, { ...body, dryRun: true }),
    );

    // Out-of-band removal (store-level; no admin delete endpoint).
    expect(
      await ctx.eval.deleteAssignment(byUser.get(evalA.userId)!),
    ).toBe(true);

    const commit = await bulkAssign(ctx, admin.cookie, eventId, {
      ...body,
      dryRun: false,
      previewId: preview.previewId,
    });
    expect(commit.status).toBe(409);
  });

  it("409s when submission ELIGIBILITY changes with NO status filter", async () => {
    const { ctx, admin, eventId, s2, rubric, evalB } =
      await seedDrift("elig");
    const body = planBody(rubric.roundId, [evalB.userId]);
    const preview = await parseBulk(
      await bulkAssign(ctx, admin.cookie, eventId, { ...body, dryRun: true }),
    );
    expect(preview.counts.additions).toBe(2);

    // Rejecting s2 flips it ineligible — same matched id set, new status.
    const decision = await jsonReq(
      ctx,
      "POST",
      `/api/submissions/${s2}/decision`,
      admin.cookie,
      { decision: "reject" },
    );
    expect(decision.status).toBe(200);

    const commit = await bulkAssign(ctx, admin.cookie, eventId, {
      ...body,
      dryRun: false,
      previewId: preview.previewId,
    });
    expect(commit.status).toBe(409);

    // Nothing applied.
    const pairs = await rollupPairs(ctx, admin.cookie, eventId);
    for (const assignments of pairs.values()) {
      expect(assignments).toHaveLength(0);
    }
  });

  it("post-commit re-preview mints a NEW token; committing it applies a fresh 0-addition plan (not a cached replay)", async () => {
    const { ctx, admin, eventId, s1, s2, rubric, evalA } =
      await seedDrift("fresh");
    const body = planBody(rubric.roundId, [evalA.userId]);
    const preview1 = await parseBulk(
      await bulkAssign(ctx, admin.cookie, eventId, { ...body, dryRun: true }),
    );
    expect(preview1.counts.additions).toBe(2);

    const commit1 = await parseBulk(
      await bulkAssign(ctx, admin.cookie, eventId, {
        ...body,
        dryRun: false,
        previewId: preview1.previewId,
      }),
    );
    expect(commit1.counts.additions).toBe(2);
    expect(commit1.idempotent).toBeUndefined();

    // The committed rows are part of the estate → re-preview gets a NEW id.
    const preview2 = await parseBulk(
      await bulkAssign(ctx, admin.cookie, eventId, { ...body, dryRun: true }),
    );
    expect(preview2.previewId).not.toBe(preview1.previewId);
    expect(preview2.counts.additions).toBe(0);
    expect(preview2.counts.skipped).toBe(2);

    // Committing the fresh 0-addition plan is a REAL commit of that plan —
    // never the cached "already applied" replay of the earlier 2-addition one.
    const commit2 = await parseBulk(
      await bulkAssign(ctx, admin.cookie, eventId, {
        ...body,
        dryRun: false,
        previewId: preview2.previewId,
      }),
    );
    expect(commit2.idempotent).toBeUndefined();
    expect(commit2.counts.additions).toBe(0);
    expect(commit2.previewId).toBe(preview2.previewId);

    // Durable rows unchanged by the no-op plan.
    const pairs = await rollupPairs(ctx, admin.cookie, eventId);
    expect(pairs.get(s1)).toEqual([
      { evaluatorUserId: evalA.userId, status: "pending" },
    ]);
    expect(pairs.get(s2)).toEqual([
      { evaluatorUserId: evalA.userId, status: "pending" },
    ]);
  });
});

describe("Eval.BulkAssign — atomic commit (concurrent duplicates)", () => {
  it("two concurrent commits of the same plan apply exactly once (durable row count)", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const admin = await session(ctx, "admin", "bulk-conc-admin@example.com");
    const { eventId, slug, versionId } = await seedEvent(
      ctx,
      admin.cookie,
      "Bulk Concurrent Event",
    );
    const s1 = await addSubmission(ctx, slug, versionId, "Conc Talk One");
    const s2 = await addSubmission(ctx, slug, versionId, "Conc Talk Two");
    const { roundId } = await putRubric(ctx, admin.cookie, eventId);
    const evalA = await session(
      ctx,
      "evaluator",
      "bulk-conc-eval@example.com",
      eventId,
    );

    const body = {
      roundId,
      evaluatorIds: [evalA.userId],
      submissionFilter: {},
      mode: "all_to_all",
      existing: "preserve",
    };
    const preview = await parseBulk(
      await bulkAssign(ctx, admin.cookie, eventId, { ...body, dryRun: true }),
    );
    expect(preview.counts.additions).toBe(2);

    const [resA, resB] = await Promise.all([
      bulkAssign(ctx, admin.cookie, eventId, {
        ...body,
        dryRun: false,
        previewId: preview.previewId,
      }),
      bulkAssign(ctx, admin.cookie, eventId, {
        ...body,
        dryRun: false,
        previewId: preview.previewId,
      }),
    ]);
    const parsedA = await parseBulk(resA);
    const parsedB = await parseBulk(resB);
    // Exactly one performed the commit; the other replayed idempotently.
    const idempotentFlags = [parsedA, parsedB].map(
      (p) => p.idempotent === true,
    );
    expect(idempotentFlags.filter(Boolean)).toHaveLength(1);

    // Durable count: exactly one assignment per submission — never doubled.
    const durable = await ctx.eval.listAssignmentsForRound(roundId);
    expect(durable).toHaveLength(2);
    expect(durable.map((a) => a.submissionId).sort()).toEqual(
      [s1, s2].sort(),
    );
    const pairs = await rollupPairs(ctx, admin.cookie, eventId);
    expect(pairs.get(s1)).toEqual([
      { evaluatorUserId: evalA.userId, status: "pending" },
    ]);
    expect(pairs.get(s2)).toEqual([
      { evaluatorUserId: evalA.userId, status: "pending" },
    ]);
  });
});
