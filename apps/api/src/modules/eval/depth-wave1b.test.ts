/**
 * Post-11.9 depth Wave 1B — hide speaker roster from evaluators (Vitest).
 *
 * Item 2 — eval_rounds.hide_speakers:
 * - Eval.UpsertRubric roundtrips hideSpeakers; omitted keeps current value
 * - proposal DTO omits speakers[] entirely when hidden (server-side) —
 *   serialized response carries no seeded name/email tokens
 * - toggle off restores the roster
 * - admin Submission.Get remains complete (speakers always present)
 */
import { describe, it, expect } from "vitest";
import {
  EventResponseSchema,
  FormCreateResponseSchema,
  FormPublishResponseSchema,
  SubmissionCreateResponseSchema,
  SubmissionAssignResponseSchema,
  EvalRubricResponseSchema,
  EvalProposalResponseSchema,
  SubmissionDetailResponseSchema,
  SESSION_COOKIE_NAME,
  TURNSTILE_DEV_PASS_TOKEN,
} from "@speakerops/shared";
import { createAppWithAuth } from "../../index.js";

const env = { APP_VERSION: "0.1.0" };

type AppCtx = ReturnType<typeof createAppWithAuth>;

/** Distinctive tokens that must never leak into a hidden-roster DTO. */
const SPEAKER_NAME = "Zephyrine Quill";
const SPEAKER_EMAIL = "zephyrine.quill@hidden-example.com";

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
  return { cookie: `${SESSION_COOKIE_NAME}=${value}`, userId: link.userId! };
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
        "x-correlation-id": "corr-w1b-eval",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
    env,
  );
}

async function seedAssignedProposal(ctx: AppCtx): Promise<{
  adminCookie: string;
  evaluatorCookie: string;
  eventId: string;
  submissionId: string;
  assignmentId: string;
}> {
  const admin = await session(ctx, "admin", "w1b-hide-admin@example.com");
  const evRes = await jsonReq(ctx, "POST", "/api/events", admin.cookie, {
    name: "Hide Roster Event",
    timezone: "UTC",
  });
  expect(evRes.status).toBe(201);
  const event = EventResponseSchema.parse(await evRes.json()).event;

  const formRes = await jsonReq(
    ctx,
    "POST",
    `/api/events/${event.id}/forms`,
    admin.cookie,
    { name: "Hide CFP" },
  );
  const formId = FormCreateResponseSchema.parse(await formRes.json()).form.id;
  const draftRes = await jsonReq(
    ctx,
    "PUT",
    `/api/forms/${formId}/draft`,
    admin.cookie,
    {
      fields: [
        {
          fieldKey: "abstract",
          type: "textarea",
          label: "Abstract",
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
    admin.cookie,
    {},
  );
  const versionId = FormPublishResponseSchema.parse(await pubRes.json())
    .formVersion.id;

  const subRes = await jsonReq(
    ctx,
    "POST",
    `/api/public/cfp/${event.slug}/submissions`,
    null,
    {
      formVersionId: versionId,
      title: "Blind review candidate",
      answers: [{ fieldKey: "abstract", value: "A talk about signals." }],
      speakers: [{ name: SPEAKER_NAME, email: SPEAKER_EMAIL }],
      turnstileToken: TURNSTILE_DEV_PASS_TOKEN,
    },
  );
  expect(subRes.status).toBe(201);
  const submissionId = SubmissionCreateResponseSchema.parse(
    await subRes.json(),
  ).submission.id;

  const rubricRes = await jsonReq(
    ctx,
    "PUT",
    `/api/events/${event.id}/eval/rubric`,
    admin.cookie,
    {
      name: "Hide rubric",
      criteria: [{ name: "Overall", maxScore: 10, weight: 1 }],
      hideSpeakers: true,
    },
  );
  expect(rubricRes.status).toBe(200);
  const rubric = EvalRubricResponseSchema.parse(await rubricRes.json());
  expect(rubric.round.hideSpeakers).toBe(true);

  const evaluator = await session(
    ctx,
    "evaluator",
    "w1b-hide-eval@example.com",
    event.id,
  );
  const assignRes = await jsonReq(
    ctx,
    "POST",
    `/api/submissions/${submissionId}/assign`,
    admin.cookie,
    { userIds: [evaluator.userId] },
  );
  expect(assignRes.status).toBe(200);
  const assignmentId = SubmissionAssignResponseSchema.parse(
    await assignRes.json(),
  ).assignments[0]!.id;

  return {
    adminCookie: admin.cookie,
    evaluatorCookie: evaluator.cookie,
    eventId: event.id,
    submissionId,
    assignmentId,
  };
}

describe("Wave 1B item 2 — hide speaker roster from evaluators", () => {
  it("omits speakers[] entirely from the proposal DTO when hidden", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const seeded = await seedAssignedProposal(ctx);

    const res = await jsonReq(
      ctx,
      "GET",
      `/api/me/eval-assignments/${seeded.assignmentId}/proposal`,
      seeded.evaluatorCookie,
    );
    expect(res.status).toBe(200);
    const rawText = await res.text();
    // The seeded identity tokens must not appear anywhere in the response.
    expect(rawText).not.toContain(SPEAKER_NAME);
    expect(rawText).not.toContain(SPEAKER_EMAIL);
    expect(rawText).not.toContain("Zephyrine");

    const parsed = EvalProposalResponseSchema.parse(JSON.parse(rawText));
    expect(parsed.speakers).toBeUndefined();
    expect(parsed.speakersHidden).toBe(true);
    // Content still available for honest scoring.
    expect(parsed.submission.title).toBe("Blind review candidate");
    expect(parsed.answers.length).toBeGreaterThan(0);
  });

  it("restores the roster when the toggle is switched off (omitted keeps current)", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const seeded = await seedAssignedProposal(ctx);

    // Omitting hideSpeakers keeps the current (hidden) value.
    const keep = await jsonReq(
      ctx,
      "PUT",
      `/api/events/${seeded.eventId}/eval/rubric`,
      seeded.adminCookie,
      {
        name: "Hide rubric",
        criteria: [{ name: "Overall", maxScore: 10, weight: 1 }],
      },
    );
    expect(keep.status).toBe(200);
    expect(
      EvalRubricResponseSchema.parse(await keep.json()).round.hideSpeakers,
    ).toBe(true);

    // Explicit false reveals the roster again.
    const off = await jsonReq(
      ctx,
      "PUT",
      `/api/events/${seeded.eventId}/eval/rubric`,
      seeded.adminCookie,
      {
        name: "Hide rubric",
        criteria: [{ name: "Overall", maxScore: 10, weight: 1 }],
        hideSpeakers: false,
      },
    );
    expect(off.status).toBe(200);
    expect(
      EvalRubricResponseSchema.parse(await off.json()).round.hideSpeakers,
    ).toBe(false);

    const res = await jsonReq(
      ctx,
      "GET",
      `/api/me/eval-assignments/${seeded.assignmentId}/proposal`,
      seeded.evaluatorCookie,
    );
    expect(res.status).toBe(200);
    const parsed = EvalProposalResponseSchema.parse(await res.json());
    expect(parsed.speakersHidden).toBeUndefined();
    expect(parsed.speakers).toBeDefined();
    expect(parsed.speakers![0]!.name).toBe(SPEAKER_NAME);
    expect(parsed.speakers![0]!.email).toBe(SPEAKER_EMAIL.toLowerCase());
  });

  it("keeps the admin submission detail complete while the roster is hidden", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const seeded = await seedAssignedProposal(ctx);

    const res = await jsonReq(
      ctx,
      "GET",
      `/api/submissions/${seeded.submissionId}`,
      seeded.adminCookie,
    );
    expect(res.status).toBe(200);
    const detail = SubmissionDetailResponseSchema.parse(await res.json());
    expect(detail.speakers.map((s) => s.name)).toContain(SPEAKER_NAME);
    expect(detail.speakers.map((s) => s.email)).toContain(
      SPEAKER_EMAIL.toLowerCase(),
    );
  });
});
