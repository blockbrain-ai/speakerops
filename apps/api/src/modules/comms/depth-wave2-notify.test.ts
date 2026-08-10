/**
 * Post-11.9 depth Wave 2 — decision → notify hand-off (S-COMMS depth).
 *
 * Comms.Preview accepts segment.submissionIds (the exact decision result
 * set): recipients are the primary speakers of those submissions, including
 * rejected/waitlisted proposals with NO participation yet (participationId
 * null). Event scope is enforced (cross-event ids silently dropped) and the
 * existing preview → send flow is unchanged (previewId gate + idempotent
 * enqueue) — no new send path.
 */
import { describe, it, expect } from "vitest";
import {
  CommsPreviewResponseSchema,
  CommsSendResponseSchema,
  EventResponseSchema,
  SESSION_COOKIE_NAME,
  DECISION_NOTIFY_TEMPLATES,
} from "@speakerops/shared";
import { createAppWithAuth } from "../../index.js";

const env = { APP_VERSION: "0.1.0" };

async function adminSession(email: string) {
  const ctx = createAppWithAuth({ cookieSecure: true });
  const { app, store, submissions, decisions, comms, outbox } = ctx;
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
  const cookieValue = exchange.headers
    .get("set-cookie")!
    .split(";")[0]!
    .split("=")
    .slice(1)
    .join("=");
  return {
    app,
    store,
    submissions,
    decisions,
    comms,
    cookie: `${SESSION_COOKIE_NAME}=${cookieValue}`,
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
        "x-correlation-id": "corr-w2-notify-event",
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
  return parsed.data!.event;
}

type Ctx = Awaited<ReturnType<typeof adminSession>>;

async function seedSubmissionWithSpeaker(
  ctx: Ctx,
  eventId: string,
  suffix: string,
  status: string,
) {
  const now = new Date().toISOString();
  const person = await ctx.submissions.insertPerson({
    id: `person_w2n_${suffix}`,
    orgId: "org_dogfood",
    email: `speaker-w2n-${suffix}@example.com`,
    name: `Wave Two ${suffix}`,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.submissions.insertSubmission({
    id: `sub_w2n_${suffix}`,
    eventId,
    formVersionId: `fv_w2n_${suffix}`,
    title: `Depth talk ${suffix}`,
    category: null,
    status,
    submittedAt: now,
    version: 1,
  });
  await ctx.submissions.insertSpeakers([
    {
      submissionId: `sub_w2n_${suffix}`,
      personId: person.id,
      isPrimary: true,
      sortOrder: 0,
    },
  ]);
  return { person, submissionId: `sub_w2n_${suffix}` };
}

async function upsertTemplate(
  ctx: Ctx,
  eventId: string,
  key: string,
  subject: string,
  body: string,
): Promise<string> {
  const res = await ctx.app.request(
    `http://localhost/api/events/${eventId}/templates/${key}`,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: ctx.cookie,
        "x-correlation-id": "corr-w2-notify-template",
      },
      body: JSON.stringify({ subject, body }),
    },
    env,
  );
  expect([200, 201]).toContain(res.status);
  const json = (await res.json()) as { template: { id: string } };
  return json.template.id;
}

describe("Wave 2 — decision → notify hand-off audience", () => {
  it("preview over submissionIds builds the exact audience incl. no-participation speakers", async () => {
    const ctx = await adminSession("w2-notify-admin@example.com");
    const event = await createEvent(ctx.app, ctx.cookie, "W2 Notify Event");

    // One rejected submission (no participation) + one accepted with a
    // participation carrying a company for merge fields.
    const rejected = await seedSubmissionWithSpeaker(
      ctx,
      event.id,
      "rej",
      "rejected",
    );
    const accepted = await seedSubmissionWithSpeaker(
      ctx,
      event.id,
      "acc",
      "accepted",
    );
    const now = new Date().toISOString();
    await ctx.decisions.insertParticipation({
      id: "part_w2n_acc",
      eventId: event.id,
      personId: accepted.person.id,
      userId: null,
      roleLabel: "speaker",
      status: "accepted",
      bio: null,
      company: "Acme Rockets",
      title: null,
      headshotFileId: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    const def = DECISION_NOTIFY_TEMPLATES.reject;
    const templateId = await upsertTemplate(
      ctx,
      event.id,
      def.key,
      def.subject,
      "Hi {{name}}, about {{submissionTitle}} at {{eventName}}.",
    );

    const previewRes = await ctx.app.request(
      "http://localhost/api/comms/preview",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: ctx.cookie,
          "x-correlation-id": "corr-w2-notify-preview",
        },
        body: JSON.stringify({
          templateId,
          segment: {
            submissionIds: [rejected.submissionId, accepted.submissionId],
          },
        }),
      },
      env,
    );
    expect(previewRes.status).toBe(200);
    const parsed = CommsPreviewResponseSchema.safeParse(
      await previewRes.json(),
    );
    expect(parsed.success).toBe(true);
    const preview = parsed.data!;
    expect(preview.recipientCount).toBe(2);
    // Exact audience, in submissionIds order.
    expect(preview.recipients.map((r) => r.email)).toEqual([
      "speaker-w2n-rej@example.com",
      "speaker-w2n-acc@example.com",
    ]);
    // Rejected speaker has no participation — null participationId.
    expect(preview.recipients[0]!.participationId).toBeNull();
    expect(preview.recipients[0]!.submissionId).toBe(rejected.submissionId);
    // Accepted speaker resolves to the existing participation.
    expect(preview.recipients[1]!.participationId).toBe("part_w2n_acc");
    // Merge fields rendered per submission.
    expect(preview.bodies[0]!.body).toContain("Depth talk rej");
    expect(preview.bodies[1]!.body).toContain("Depth talk acc");
    expect(preview.missingFields).toEqual([]);
  });

  it("cross-event submission ids are dropped, never leaked", async () => {
    const ctx = await adminSession("w2-notify-scope@example.com");
    const eventA = await createEvent(ctx.app, ctx.cookie, "W2 Scope A");
    const eventB = await createEvent(ctx.app, ctx.cookie, "W2 Scope B");
    const inA = await seedSubmissionWithSpeaker(ctx, eventA.id, "a1", "accepted");
    const inB = await seedSubmissionWithSpeaker(ctx, eventB.id, "b1", "accepted");

    const templateId = await upsertTemplate(
      ctx,
      eventA.id,
      "decision_accepted",
      "S {{eventName}}",
      "Hi {{name}}",
    );
    const previewRes = await ctx.app.request(
      "http://localhost/api/comms/preview",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: ctx.cookie,
          "x-correlation-id": "corr-w2-notify-scope",
        },
        body: JSON.stringify({
          templateId,
          segment: { submissionIds: [inA.submissionId, inB.submissionId] },
        }),
      },
      env,
    );
    expect(previewRes.status).toBe(200);
    const preview = CommsPreviewResponseSchema.parse(await previewRes.json());
    expect(preview.recipientCount).toBe(1);
    expect(preview.recipients[0]!.email).toBe("speaker-w2n-a1@example.com");
  });

  it("send over a decision audience stays on the idempotent enqueue path with durable recipients", async () => {
    const ctx = await adminSession("w2-notify-send@example.com");
    const event = await createEvent(ctx.app, ctx.cookie, "W2 Notify Send");
    const rejected = await seedSubmissionWithSpeaker(
      ctx,
      event.id,
      "send1",
      "rejected",
    );

    const templateId = await upsertTemplate(
      ctx,
      event.id,
      "decision_rejected",
      "Update on {{submissionTitle}}",
      "Hi {{name}} — {{submissionTitle}}.",
    );
    const previewRes = await ctx.app.request(
      "http://localhost/api/comms/preview",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: ctx.cookie,
          "x-correlation-id": "corr-w2-notify-send-preview",
        },
        body: JSON.stringify({
          templateId,
          segment: { submissionIds: [rejected.submissionId] },
        }),
      },
      env,
    );
    const preview = CommsPreviewResponseSchema.parse(await previewRes.json());

    const sendOnce = async () =>
      ctx.app.request(
        "http://localhost/api/comms/send",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: ctx.cookie,
            "x-correlation-id": "corr-w2-notify-send",
          },
          body: JSON.stringify({
            previewId: preview.previewId,
            idempotencyKey: "w2-notify-send-key",
          }),
        },
        env,
      );

    const first = await sendOnce();
    expect(first.status).toBe(201);
    const firstParsed = CommsSendResponseSchema.parse(await first.json());
    expect(firstParsed.enqueued).toBe(true);
    expect(firstParsed.job.status).toBe("queued");

    // Exactly-once: second invoke replays, durable recipient count stays 1.
    const second = await sendOnce();
    expect(second.status).toBe(200);
    const secondParsed = CommsSendResponseSchema.parse(await second.json());
    expect(secondParsed.enqueued).toBe(false);
    expect(secondParsed.job.id).toBe(firstParsed.job.id);

    const recipients = await ctx.comms.listRecipientsForJob(firstParsed.job.id);
    expect(recipients).toHaveLength(1);
    expect(recipients[0]!.toEmail).toBe("speaker-w2n-send1@example.com");
    expect(recipients[0]!.participationId).toBeNull();
    expect(recipients[0]!.body).toContain("Depth talk send1");
  });
});
