/**
 * Post-11.9 depth Wave 2 — speaker-info seeding on accept (Vitest).
 *
 * materializeAccept copies the submission speaker's optional bio/company/title
 * ("About this speaker") onto the event_participation profile:
 * - (a) accept seeds bio/company/title on the new participation
 * - (b) existing participation: non-empty bio is kept, empty company is filled
 * - (c) idempotent accept replay neither duplicates nor overwrites (version
 *       stays stable when nothing needs to change)
 */
import { describe, it, expect } from "vitest";
import {
  EventResponseSchema,
  FormCreateResponseSchema,
  FormPublishResponseSchema,
  SubmissionCreateResponseSchema,
  DecisionRecordResponseSchema,
  SESSION_COOKIE_NAME,
  TURNSTILE_DEV_PASS_TOKEN,
} from "@speakerops/shared";
import { createAppWithAuth } from "../../index.js";

const env = { APP_VERSION: "0.1.0" };

type AppCtx = ReturnType<typeof createAppWithAuth>;

async function adminSession(ctx: AppCtx, email: string): Promise<string> {
  const { app, outbox } = ctx;
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
  const value = setCookie.split(";")[0]!.split("=").slice(1).join("=");
  return `${SESSION_COOKIE_NAME}=${value}`;
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
        "x-correlation-id": "corr-w2-accept-seed",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
    env,
  );
}

async function seedPublished(
  ctx: AppCtx,
  cookie: string,
  name: string,
): Promise<{ event: { id: string; slug: string }; versionId: string }> {
  const eventRes = await jsonReq(ctx, "POST", "/api/events", cookie, {
    name,
    timezone: "UTC",
  });
  expect(eventRes.status).toBe(201);
  const event = EventResponseSchema.parse(await eventRes.json()).event;
  const formRes = await jsonReq(
    ctx,
    "POST",
    `/api/events/${event.id}/forms`,
    cookie,
    { name: "Wave 2 accept seed CFP" },
  );
  expect(formRes.status).toBe(201);
  const formId = FormCreateResponseSchema.parse(await formRes.json()).form.id;
  const draft = await jsonReq(ctx, "PUT", `/api/forms/${formId}/draft`, cookie, {
    fields: [
      {
        fieldKey: "talk_title",
        type: "text",
        label: "Talk title",
        required: true,
        sortOrder: 0,
      },
    ],
  });
  expect(draft.status).toBe(200);
  const pub = await jsonReq(
    ctx,
    "POST",
    `/api/forms/${formId}/publish`,
    cookie,
    {},
  );
  expect(pub.status).toBe(200);
  const versionId = FormPublishResponseSchema.parse(await pub.json())
    .formVersion.id;
  return { event, versionId };
}

async function submitTalk(
  ctx: AppCtx,
  slug: string,
  versionId: string,
  title: string,
  speaker: Record<string, unknown>,
): Promise<string> {
  const res = await jsonReq(
    ctx,
    "POST",
    `/api/public/cfp/${slug}/submissions`,
    null,
    {
      formVersionId: versionId,
      title,
      answers: [{ fieldKey: "talk_title", value: title }],
      speakers: [speaker],
      turnstileToken: TURNSTILE_DEV_PASS_TOKEN,
    },
  );
  expect(res.status).toBe(201);
  return SubmissionCreateResponseSchema.parse(await res.json()).submission.id;
}

async function accept(
  ctx: AppCtx,
  cookie: string,
  submissionId: string,
): Promise<void> {
  const res = await jsonReq(
    ctx,
    "POST",
    `/api/submissions/${submissionId}/decision`,
    cookie,
    { decision: "accept" },
  );
  expect(res.status).toBe(200);
  DecisionRecordResponseSchema.parse(await res.json());
}

describe("Wave 2 — accept seeds the participation profile from CFP fields", () => {
  it("(a) accept seeds bio/company/title on the new participation", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const cookie = await adminSession(ctx, "w2-accept-seed@example.com");
    const { event, versionId } = await seedPublished(
      ctx,
      cookie,
      "Accept Seed Event",
    );
    const submissionId = await submitTalk(
      ctx,
      event.slug,
      versionId,
      "Seeded accept talk",
      {
        name: "Nadia Ferreira",
        email: "nadia@example.com",
        isPrimary: true,
        bio: "Nadia builds event pipelines and mentors first-time speakers.",
        company: "Orbital Coffee",
        title: "Head of Data",
      },
    );
    await accept(ctx, cookie, submissionId);

    const [speakerRow] = await ctx.submissions.listSpeakers(submissionId);
    const part = await ctx.decisions.findParticipation(
      event.id,
      speakerRow!.personId,
    );
    expect(part).not.toBeNull();
    expect(part!.bio).toBe(
      "Nadia builds event pipelines and mentors first-time speakers.",
    );
    expect(part!.company).toBe("Orbital Coffee");
    expect(part!.title).toBe("Head of Data");
  });

  it("(b) never overwrites a non-empty bio; fills the still-empty company", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const cookie = await adminSession(ctx, "w2-accept-keep@example.com");
    const { event, versionId } = await seedPublished(
      ctx,
      cookie,
      "Accept Keep Event",
    );

    // First talk without about fields → participation with NULL profile.
    const firstId = await submitTalk(
      ctx,
      event.slug,
      versionId,
      "First plain talk",
      { name: "Ravi Chand", email: "ravi@example.com", isPrimary: true },
    );
    await accept(ctx, cookie, firstId);
    const [firstSpeaker] = await ctx.submissions.listSpeakers(firstId);
    const personId = firstSpeaker!.personId;
    let part = await ctx.decisions.findParticipation(event.id, personId);
    expect(part!.bio).toBeNull();
    expect(part!.company).toBeNull();

    // Speaker hand-writes a bio in the portal (store-level profile edit).
    const edited = await ctx.decisions.updateParticipation(part!.id, {
      version: part!.version + 1,
      updatedAt: new Date().toISOString(),
      bio: "Hand-written portal bio — mine, do not touch.",
    });
    expect(edited).not.toBeNull();

    // Second talk by the same person carries CFP about fields.
    const secondId = await submitTalk(
      ctx,
      event.slug,
      versionId,
      "Second seeded talk",
      {
        name: "Ravi Chand",
        email: "ravi@example.com",
        isPrimary: true,
        bio: "CFP bio that must never replace the portal one.",
        company: "Lantern Systems",
      },
    );
    await accept(ctx, cookie, secondId);

    part = await ctx.decisions.findParticipation(event.id, personId);
    // Non-empty bio kept; empty company filled from the CFP seed.
    expect(part!.bio).toBe("Hand-written portal bio — mine, do not touch.");
    expect(part!.company).toBe("Lantern Systems");
  });

  it("(c) idempotent accept replay does not duplicate or overwrite", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const cookie = await adminSession(ctx, "w2-accept-idem@example.com");
    const { event, versionId } = await seedPublished(
      ctx,
      cookie,
      "Accept Idem Event",
    );
    const submissionId = await submitTalk(
      ctx,
      event.slug,
      versionId,
      "Idempotent seeded talk",
      {
        name: "Wren Alvarez",
        email: "wren@example.com",
        isPrimary: true,
        bio: "Original CFP bio.",
        company: "Quiet Harbor",
        title: "CTO",
      },
    );
    await accept(ctx, cookie, submissionId);
    const [speakerRow] = await ctx.submissions.listSpeakers(submissionId);
    const personId = speakerRow!.personId;
    const seeded = await ctx.decisions.findParticipation(event.id, personId);
    expect(seeded!.bio).toBe("Original CFP bio.");

    // Speaker replaces the seeded bio with their own words.
    const custom = await ctx.decisions.updateParticipation(seeded!.id, {
      version: seeded!.version + 1,
      updatedAt: new Date().toISOString(),
      bio: "Custom bio after seeding.",
    });
    expect(custom).not.toBeNull();

    // Replay the accept (idempotent decision path).
    await accept(ctx, cookie, submissionId);

    const after = await ctx.decisions.findParticipation(event.id, personId);
    // No overwrite, no duplicate participation, no phantom version bump.
    expect(after!.bio).toBe("Custom bio after seeding.");
    expect(after!.company).toBe("Quiet Harbor");
    expect(after!.title).toBe("CTO");
    expect(after!.version).toBe(custom!.version);
    const parts = await ctx.decisions.listParticipationsForEvent(event.id);
    expect(parts.filter((p) => p.personId === personId)).toHaveLength(1);
  });
});
