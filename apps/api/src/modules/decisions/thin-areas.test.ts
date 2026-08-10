/**
 * Competition thin-area mechanical proofs (accept handoff, bulk commit).
 *
 * Named assertions:
 * - accept binds participation.userId and grants speaker membership when none
 * - accept never demotes existing admin membership
 * - bulk-decision commits via recordDecision with per-item results
 */
import { describe, it, expect } from "vitest";
import {
  ErrorEnvelopeSchema,
  DecisionRecordResponseSchema,
  BulkDecisionCommitResponseSchema,
  SubmissionCreateResponseSchema,
  EventResponseSchema,
  FormCreateResponseSchema,
  FormPublishResponseSchema,
  SESSION_COOKIE_NAME,
  TURNSTILE_DEV_PASS_TOKEN,
} from "@speakerops/shared";
import { createAppWithAuth } from "../../index.js";

const env = { APP_VERSION: "0.1.0" };

async function magicLinkSession(
  purpose: "admin" | "speaker" | "evaluator",
  email: string,
  eventId?: string,
  shared?: ReturnType<typeof createAppWithAuth>,
) {
  const ctx = shared ?? createAppWithAuth({ cookieSecure: true });
  const { app, store, events, forms, submissions, decisions, outbox } = ctx;
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
  const setCookie = exchange.headers.get("set-cookie") ?? "";
  const match = setCookie.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  expect(match).toBeTruthy();
  const user = await store.findUserByEmail(email);
  return {
    app,
    store,
    events,
    forms,
    submissions,
    decisions,
    outbox,
    cookie: `${SESSION_COOKIE_NAME}=${match![1]}`,
    userId: user!.id,
  };
}

async function createEvent(
  app: ReturnType<typeof createAppWithAuth>["app"],
  cookie: string,
  name: string,
) {
  const res = await app.request(
    "http://localhost/api/events",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        name,
        timezone: "UTC",
        startsAt: "2026-09-01T09:00:00.000Z",
        endsAt: "2026-09-03T17:00:00.000Z",
      }),
    },
    env,
  );
  expect(res.status).toBe(201);
  return EventResponseSchema.parse(await res.json()).event;
}

async function publishCfpAndSubmit(
  admin: Awaited<ReturnType<typeof magicLinkSession>>,
  eventId: string,
  eventSlug: string,
  title: string,
  speakerEmail: string,
) {
  const createForm = await admin.app.request(
    `http://localhost/api/events/${eventId}/forms`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: admin.cookie,
      },
      body: JSON.stringify({ name: `CFP ${title}` }),
    },
    env,
  );
  expect(createForm.status).toBe(201);
  const formBody = FormCreateResponseSchema.parse(await createForm.json());
  const formId = formBody.form.id;

  const draft = await admin.app.request(
    `http://localhost/api/forms/${formId}/draft`,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: admin.cookie,
      },
      body: JSON.stringify({
        fields: [
          {
            fieldKey: "abstract",
            type: "textarea",
            label: "Abstract",
            required: true,
            sortOrder: 0,
          },
        ],
        rules: [],
        welcomeMd: "Welcome",
        thankYouMd: "Thanks",
      }),
    },
    env,
  );
  expect(draft.status).toBe(200);

  const publish = await admin.app.request(
    `http://localhost/api/forms/${formId}/publish`,
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
  expect(publish.status).toBe(200);
  const pub = FormPublishResponseSchema.parse(await publish.json());
  const formVersionId = pub.formVersion.id;

  const submit = await admin.app.request(
    `http://localhost/api/public/cfp/${encodeURIComponent(eventSlug)}/submissions`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        formVersionId,
        title,
        answers: [{ fieldKey: "abstract", value: "A solid abstract for scoring." }],
        speakers: [
          {
            name: "Entrant Speaker",
            email: speakerEmail,
            isPrimary: true,
          },
        ],
        turnstileToken: TURNSTILE_DEV_PASS_TOKEN,
      }),
    },
    env,
  );
  expect(submit.status).toBe(201);
  const sub = SubmissionCreateResponseSchema.parse(await submit.json());
  return { submissionId: sub.submission.id, formVersionId };
}

describe("thin areas — accept handoff + bulk commit", () => {
  it("accept binds userId, grants speaker membership, issues program invite", async () => {
    const admin = await magicLinkSession(
      "admin",
      "thin-accept-admin@example.com",
    );
    const event = await createEvent(
      admin.app,
      admin.cookie,
      "Thin Accept Event",
    );
    const speakerEmail = "real-cfp-entrant@example.com";
    const { submissionId } = await publishCfpAndSubmit(
      admin,
      event.id,
      event.slug,
      "Accepted Talk",
      speakerEmail,
    );

    const decide = await admin.app.request(
      `http://localhost/api/submissions/${submissionId}/decision`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
          "x-correlation-id": "corr-thin-accept",
        },
        body: JSON.stringify({ decision: "accept" }),
      },
      env,
    );
    expect(decide.status).toBe(200);
    const body = DecisionRecordResponseSchema.parse(await decide.json());
    expect(body.participations.length).toBeGreaterThanOrEqual(1);
    const part = body.participations[0]!;
    expect(part.userId).toBeTruthy();

    const user = await admin.store.findUserByEmail(speakerEmail);
    expect(user).toBeTruthy();
    expect(part.userId).toBe(user!.id);

    const mem = await admin.store.findMembership(event.id, user!.id);
    expect(mem).toBeTruthy();
    expect(mem!.role).toBe("speaker");

    // Program invite captured in magic-link test outbox
    const invite = admin.outbox.lastForEmail(speakerEmail);
    expect(invite).toBeTruthy();
    expect(invite!.purpose).toBe("speaker");
    expect(invite!.eventId).toBe(event.id);
  });

  it("accept does not demote existing admin membership on same event", async () => {
    const admin = await magicLinkSession(
      "admin",
      "thin-admin-speaker@example.com",
    );
    const event = await createEvent(
      admin.app,
      admin.cookie,
      "Thin Role Preserve Event",
    );
    // Admin is also the CFP speaker email (dual role collision case)
    const { submissionId } = await publishCfpAndSubmit(
      admin,
      event.id,
      event.slug,
      "Admin Also Speaks",
      "thin-admin-speaker@example.com",
    );

    const before = await admin.store.findMembership(event.id, admin.userId);
    expect(before?.role).toBe("admin");

    const decide = await admin.app.request(
      `http://localhost/api/submissions/${submissionId}/decision`,
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
    expect(decide.status).toBe(200);
    const body = DecisionRecordResponseSchema.parse(await decide.json());
    expect(body.participations[0]?.userId).toBe(admin.userId);

    const after = await admin.store.findMembership(event.id, admin.userId);
    expect(after?.role).toBe("admin");
  });

  it("bulk-decision commits accept for selected submissions", async () => {
    const admin = await magicLinkSession(
      "admin",
      "thin-bulk-admin@example.com",
    );
    const event = await createEvent(admin.app, admin.cookie, "Thin Bulk Event");
    const a = await publishCfpAndSubmit(
      admin,
      event.id,
      event.slug,
      "Bulk Talk A",
      "bulk-a@example.com",
    );
    const b = await publishCfpAndSubmit(
      admin,
      event.id,
      event.slug,
      "Bulk Talk B",
      "bulk-b@example.com",
    );

    const res = await admin.app.request(
      `http://localhost/api/events/${event.id}/submissions/bulk-decision`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
        },
        body: JSON.stringify({
          submissionIds: [a.submissionId, b.submissionId],
          decision: "accept",
        }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = BulkDecisionCommitResponseSchema.parse(await res.json());
    expect(body.applied).toBe(2);
    expect(body.failed).toBe(0);
    expect(body.items.every((i) => i.ok)).toBe(true);

    const detailA = await admin.submissions.findSubmissionById(a.submissionId);
    const detailB = await admin.submissions.findSubmissionById(b.submissionId);
    expect(detailA?.status).toBe("accepted");
    expect(detailB?.status).toBe("accepted");
  });

  it("bulk-decision reports failure for unknown submission without aborting others", async () => {
    const admin = await magicLinkSession(
      "admin",
      "thin-bulk-partial@example.com",
    );
    const event = await createEvent(
      admin.app,
      admin.cookie,
      "Thin Bulk Partial Event",
    );
    const a = await publishCfpAndSubmit(
      admin,
      event.id,
      event.slug,
      "Partial OK",
      "partial-ok@example.com",
    );

    const res = await admin.app.request(
      `http://localhost/api/events/${event.id}/submissions/bulk-decision`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
        },
        body: JSON.stringify({
          submissionIds: [a.submissionId, "sub_does_not_exist"],
          decision: "waitlist",
        }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = BulkDecisionCommitResponseSchema.parse(await res.json());
    expect(body.applied).toBe(1);
    expect(body.failed).toBe(1);
    const fail = body.items.find((i) => i.submissionId === "sub_does_not_exist");
    expect(fail?.ok).toBe(false);
    expect(fail?.code).toBeTruthy();
  });
});
