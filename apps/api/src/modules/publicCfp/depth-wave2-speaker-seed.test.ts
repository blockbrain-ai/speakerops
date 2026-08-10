/**
 * Post-11.9 depth Wave 2 — speaker-info seeding on the public CFP (Vitest).
 *
 * Submission.Create accepts optional bio/company/title per speaker
 * ("About this speaker"):
 * - create persists the fields on the submission speaker rows (trimmed)
 * - the create response DTO returns them per speaker
 * - omitted / blank fields stay honest NULLs
 * - oversize values are rejected by the shared schema (400)
 */
import { describe, it, expect } from "vitest";
import {
  EventResponseSchema,
  FormCreateResponseSchema,
  FormPublishResponseSchema,
  SubmissionCreateResponseSchema,
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
        "x-correlation-id": "corr-w2-speaker-seed",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
    env,
  );
}

const TITLE_FIELD = {
  fieldKey: "talk_title",
  type: "text",
  label: "Talk title",
  required: true,
  sortOrder: 0,
};

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
    { name: "Wave 2 speaker seed CFP" },
  );
  expect(formRes.status).toBe(201);
  const formId = FormCreateResponseSchema.parse(await formRes.json()).form.id;
  const draft = await jsonReq(ctx, "PUT", `/api/forms/${formId}/draft`, cookie, {
    fields: [TITLE_FIELD],
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

describe("Wave 2 — Submission.Create speaker-info seeding fields", () => {
  it("persists trimmed bio/company/title per speaker and returns them in the DTO", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const cookie = await adminSession(ctx, "w2-seed@example.com");
    const { event, versionId } = await seedPublished(
      ctx,
      cookie,
      "Speaker Seed Event",
    );

    const res = await jsonReq(
      ctx,
      "POST",
      `/api/public/cfp/${event.slug}/submissions`,
      null,
      {
        formVersionId: versionId,
        title: "Seeded talk",
        answers: [{ fieldKey: "talk_title", value: "Seeded talk" }],
        speakers: [
          {
            name: "Amara Osei",
            email: "amara@example.com",
            isPrimary: true,
            bio: "  Platform engineer who writes about resilient queues.  ",
            company: "  Brightloom  ",
            title: "  Staff Engineer  ",
          },
          {
            name: "Plain Partner",
            email: "partner@example.com",
            // No about fields — must round-trip as nulls.
          },
        ],
        turnstileToken: TURNSTILE_DEV_PASS_TOKEN,
      },
    );
    expect(res.status).toBe(201);
    const created = SubmissionCreateResponseSchema.parse(await res.json());

    // DTO carries the trimmed fields per speaker.
    const primary = created.speakers.find((s) => s.isPrimary)!;
    expect(primary.bio).toBe(
      "Platform engineer who writes about resilient queues.",
    );
    expect(primary.company).toBe("Brightloom");
    expect(primary.title).toBe("Staff Engineer");
    const partner = created.speakers.find((s) => !s.isPrimary)!;
    expect(partner.bio).toBeNull();
    expect(partner.company).toBeNull();
    expect(partner.title).toBeNull();

    // Store rows persist the same values (SoR, not response-only).
    const rows = await ctx.submissions.listSpeakers(created.submission.id);
    const byPerson = new Map(rows.map((r) => [r.personId, r]));
    const primaryRow = byPerson.get(primary.personId)!;
    expect(primaryRow.bio).toBe(
      "Platform engineer who writes about resilient queues.",
    );
    expect(primaryRow.company).toBe("Brightloom");
    expect(primaryRow.title).toBe("Staff Engineer");
    const partnerRow = byPerson.get(partner.personId)!;
    expect(partnerRow.bio).toBeNull();
    expect(partnerRow.company).toBeNull();
    expect(partnerRow.title).toBeNull();
  });

  it("stores whitespace-only about fields as NULL (no empty-string residue)", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const cookie = await adminSession(ctx, "w2-seed-blank@example.com");
    const { event, versionId } = await seedPublished(
      ctx,
      cookie,
      "Blank Seed Event",
    );

    const res = await jsonReq(
      ctx,
      "POST",
      `/api/public/cfp/${event.slug}/submissions`,
      null,
      {
        formVersionId: versionId,
        title: "Blank about talk",
        answers: [{ fieldKey: "talk_title", value: "Blank about talk" }],
        speakers: [
          {
            name: "Blank Fields",
            email: "blank@example.com",
            bio: "   ",
            company: "",
            title: "\t",
          },
        ],
        turnstileToken: TURNSTILE_DEV_PASS_TOKEN,
      },
    );
    expect(res.status).toBe(201);
    const created = SubmissionCreateResponseSchema.parse(await res.json());
    expect(created.speakers[0]!.bio).toBeNull();
    expect(created.speakers[0]!.company).toBeNull();
    expect(created.speakers[0]!.title).toBeNull();
    const rows = await ctx.submissions.listSpeakers(created.submission.id);
    expect(rows[0]!.bio).toBeNull();
    expect(rows[0]!.company).toBeNull();
    expect(rows[0]!.title).toBeNull();
  });

  it("rejects oversize bio/company via the shared schema (400)", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const cookie = await adminSession(ctx, "w2-seed-max@example.com");
    const { event, versionId } = await seedPublished(
      ctx,
      cookie,
      "Oversize Seed Event",
    );

    const res = await jsonReq(
      ctx,
      "POST",
      `/api/public/cfp/${event.slug}/submissions`,
      null,
      {
        formVersionId: versionId,
        title: "Oversize about talk",
        answers: [{ fieldKey: "talk_title", value: "Oversize about talk" }],
        speakers: [
          {
            name: "Too Long",
            email: "long@example.com",
            bio: "x".repeat(8001),
            company: "y".repeat(201),
          },
        ],
        turnstileToken: TURNSTILE_DEV_PASS_TOKEN,
      },
    );
    expect(res.status).toBe(400);
  });
});
