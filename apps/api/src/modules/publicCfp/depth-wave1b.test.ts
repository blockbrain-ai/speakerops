/**
 * Post-11.9 depth Wave 1B — public CFP knobs (Vitest).
 *
 * Item 3 — per-submitter cap (ADDITIVE beside submissionLimit):
 * - same normalized primary email over cap → 400 with human message
 * - different email passes; case/whitespace variants count as the same person
 * - global submissionLimit still enforced independently
 *
 * Item 4 — layout nodes (section/divider):
 * - draft/publish/public round-trip carries nodeKind/layoutType in order
 * - answers targeting layout keys are never stored (submitted DTO clean)
 * - conditions/rules referencing a layout key rejected (400)
 * - layout-only forms cannot publish; layout with input knobs rejected
 * - conditional rule adjacent to a layout node still evaluates
 *
 * Item 1 — submission confirmation lifecycle (integration):
 * - submit → durable job/recipient/outbox/idempotency records (Memory comms)
 * - disabled via event settings → no job, submission still 201
 * - notify list adds organizer recipients on the same job
 * - comms store failure never fails the submission
 */
import { describe, it, expect } from "vitest";
import {
  EventResponseSchema,
  FormCreateResponseSchema,
  FormAdminGetResponseSchema,
  FormPublishResponseSchema,
  PublicCfpResponseSchema,
  SubmissionCreateResponseSchema,
  ErrorEnvelopeSchema,
  SESSION_COOKIE_NAME,
  TURNSTILE_DEV_PASS_TOKEN,
  COMMS_OUTBOX_TOPIC,
  SUBMISSION_CONFIRMATION_TEMPLATE_KEY,
  submissionConfirmationIdempotencyKey,
} from "@speakerops/shared";
import { createAppWithAuth } from "../../index.js";
import { MemoryCommsStore } from "../comms/store.js";

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
        "x-correlation-id": "corr-w1b-cfp",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
    env,
  );
}

async function createEvent(
  ctx: AppCtx,
  cookie: string,
  name: string,
): Promise<{ id: string; slug: string; version: number }> {
  const res = await jsonReq(ctx, "POST", "/api/events", cookie, {
    name,
    timezone: "UTC",
  });
  expect(res.status).toBe(201);
  return EventResponseSchema.parse(await res.json()).event;
}

async function createForm(
  ctx: AppCtx,
  cookie: string,
  eventId: string,
): Promise<string> {
  const res = await jsonReq(ctx, "POST", `/api/events/${eventId}/forms`, cookie, {
    name: "Wave 1B CFP",
  });
  expect(res.status).toBe(201);
  return FormCreateResponseSchema.parse(await res.json()).form.id;
}

async function putDraft(
  ctx: AppCtx,
  cookie: string,
  formId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return jsonReq(ctx, "PUT", `/api/forms/${formId}/draft`, cookie, body);
}

async function publish(
  ctx: AppCtx,
  cookie: string,
  formId: string,
): Promise<string> {
  const res = await jsonReq(ctx, "POST", `/api/forms/${formId}/publish`, cookie, {});
  expect(res.status).toBe(200);
  return FormPublishResponseSchema.parse(await res.json()).formVersion.id;
}

const TITLE_FIELD = {
  fieldKey: "talk_title",
  type: "text",
  label: "Talk title",
  required: true,
  sortOrder: 0,
};

async function submit(
  ctx: AppCtx,
  slug: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return jsonReq(ctx, "POST", `/api/public/cfp/${slug}/submissions`, null, body);
}

function submitBody(
  versionId: string,
  title: string,
  email: string,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    formVersionId: versionId,
    title,
    answers: [{ fieldKey: "talk_title", value: title }],
    speakers: [{ name: "Prime Speaker", email }],
    turnstileToken: TURNSTILE_DEV_PASS_TOKEN,
    ...(extra ?? {}),
  };
}

describe("Wave 1B item 3 — per-submitter submission cap", () => {
  it("blocks the same normalized primary email over the cap with a human message", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const cookie = await adminSession(ctx, "w1b-cap@example.com");
    const event = await createEvent(ctx, cookie, "Per Submitter Cap");
    const formId = await createForm(ctx, cookie, event.id);
    const draft = await putDraft(ctx, cookie, formId, {
      fields: [TITLE_FIELD],
      perSubmitterLimit: 1,
    });
    expect(draft.status).toBe(200);
    const versionId = await publish(ctx, cookie, formId);

    const first = await submit(
      ctx,
      event.slug,
      submitBody(versionId, "First talk", "casey@example.com"),
    );
    expect(first.status).toBe(201);

    // Same person, different casing — normalized match → 400.
    const second = await submit(
      ctx,
      event.slug,
      submitBody(versionId, "Second talk", "Casey@Example.COM"),
    );
    expect(second.status).toBe(400);
    const envlp = ErrorEnvelopeSchema.parse(await second.json());
    // Human copy — no snake_case, mentions the one-per-person rule.
    expect(envlp.error).toMatch(/already submitted/i);
    expect(envlp.error).not.toMatch(/_/);
    expect(JSON.stringify(envlp.details)).toContain("perSubmitterLimit");

    // A different person still passes.
    const other = await submit(
      ctx,
      event.slug,
      submitBody(versionId, "Other talk", "jordan@example.com"),
    );
    expect(other.status).toBe(201);
  });

  it("keeps the global submissionLimit independent of the per-person cap", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const cookie = await adminSession(ctx, "w1b-cap-global@example.com");
    const event = await createEvent(ctx, cookie, "Global And Per Cap");
    const formId = await createForm(ctx, cookie, event.id);
    const draft = await putDraft(ctx, cookie, formId, {
      fields: [TITLE_FIELD],
      submissionLimit: 2,
      perSubmitterLimit: 2,
    });
    expect(draft.status).toBe(200);
    const versionId = await publish(ctx, cookie, formId);

    const a = await submit(
      ctx,
      event.slug,
      submitBody(versionId, "Talk A", "amina@example.com"),
    );
    expect(a.status).toBe(201);
    const b = await submit(
      ctx,
      event.slug,
      submitBody(versionId, "Talk B", "boris@example.com"),
    );
    expect(b.status).toBe(201);

    // Third submitter is under their personal cap but over the total cap.
    const c = await submit(
      ctx,
      event.slug,
      submitBody(versionId, "Talk C", "cleo@example.com"),
    );
    expect(c.status).toBe(400);
    const envlp = ErrorEnvelopeSchema.parse(await c.json());
    expect(envlp.error).toBe("Submission limit reached");
  });

  it("caps above 1 count correctly and drafts never count", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const cookie = await adminSession(ctx, "w1b-cap2@example.com");
    const event = await createEvent(ctx, cookie, "Cap Of Two");
    const formId = await createForm(ctx, cookie, event.id);
    await putDraft(ctx, cookie, formId, {
      fields: [TITLE_FIELD],
      perSubmitterLimit: 2,
    });
    const versionId = await publish(ctx, cookie, formId);

    // A saved draft by the same person must not consume the cap.
    const draftSave = await jsonReq(
      ctx,
      "POST",
      `/api/public/cfp/${event.slug}/drafts`,
      null,
      {
        formVersionId: versionId,
        title: "Draft only",
        speakers: [{ name: "Dana", email: "dana@example.com" }],
      },
    );
    expect(draftSave.status).toBe(201);

    const one = await submit(
      ctx,
      event.slug,
      submitBody(versionId, "Dana one", "dana@example.com"),
    );
    expect(one.status).toBe(201);
    const two = await submit(
      ctx,
      event.slug,
      submitBody(versionId, "Dana two", "dana@example.com"),
    );
    expect(two.status).toBe(201);
    const three = await submit(
      ctx,
      event.slug,
      submitBody(versionId, "Dana three", "dana@example.com"),
    );
    expect(three.status).toBe(400);
    const envlp = ErrorEnvelopeSchema.parse(await three.json());
    expect(envlp.error).toMatch(/limit of 2 proposals per person/i);
  });
});

describe("Wave 1B item 4 — layout nodes (section/divider)", () => {
  const LAYOUT_FORM_FIELDS = [
    {
      fieldKey: "layout_about",
      type: "text",
      label: "About your talk",
      nodeKind: "layout",
      layoutType: "section",
      sortOrder: 0,
    },
    { ...TITLE_FIELD, sortOrder: 1 },
    {
      fieldKey: "layout_break",
      type: "text",
      label: "Divider",
      nodeKind: "layout",
      layoutType: "divider",
      sortOrder: 2,
    },
    {
      fieldKey: "track",
      type: "select",
      label: "Track",
      required: false,
      sortOrder: 3,
      options: [
        { value: "ai", label: "AI" },
        { value: "web", label: "Web" },
      ],
    },
    {
      fieldKey: "ai_details",
      type: "textarea",
      label: "AI details",
      required: false,
      sortOrder: 4,
      conditions: { showWhen: { fieldKey: "track", op: "eq", value: "ai" } },
    },
  ];

  it("round-trips draft → publish → public with order and kinds intact", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const cookie = await adminSession(ctx, "w1b-layout@example.com");
    const event = await createEvent(ctx, cookie, "Layout Event");
    const formId = await createForm(ctx, cookie, event.id);
    const draft = await putDraft(ctx, cookie, formId, {
      fields: LAYOUT_FORM_FIELDS,
      rules: [
        {
          when: { fieldKey: "track", op: "eq", value: "ai" },
          routeToCategory: "AI",
        },
      ],
    });
    expect(draft.status).toBe(200);

    // Admin reload preserves the layout nodes.
    const adminGet = await jsonReq(ctx, "GET", `/api/forms/${formId}`, cookie);
    expect(adminGet.status).toBe(200);
    const adminBody = FormAdminGetResponseSchema.parse(await adminGet.json());
    const draftKinds = adminBody.draft.fields.map((f) => [
      f.fieldKey,
      f.nodeKind ?? "input",
      f.layoutType ?? null,
    ]);
    expect(draftKinds).toEqual([
      ["layout_about", "layout", "section"],
      ["talk_title", "input", null],
      ["layout_break", "layout", "divider"],
      ["track", "input", null],
      ["ai_details", "input", null],
    ]);

    const versionId = await publish(ctx, cookie, formId);

    // Published snapshot + public GET carry the layout nodes.
    const pub = await ctx.app.request(
      `http://localhost/api/public/cfp/${event.slug}`,
      { headers: { accept: "application/json" } },
      env,
    );
    const pubBody = PublicCfpResponseSchema.parse(await pub.json());
    const section = pubBody.formVersion!.fields.find(
      (f) => f.fieldKey === "layout_about",
    )!;
    expect(section.nodeKind).toBe("layout");
    expect(section.layoutType).toBe("section");
    expect(section.label).toBe("About your talk");
    const snapshotSection = pubBody.formVersion!.snapshotJson!.fields.find(
      (f) => f.fieldKey === "layout_break",
    )!;
    expect(snapshotSection.layoutType).toBe("divider");

    // Submit with a smuggled layout answer + the conditional satisfied.
    const res = await submit(ctx, event.slug, {
      formVersionId: versionId,
      title: "Layout talk",
      answers: [
        { fieldKey: "talk_title", value: "Layout talk" },
        { fieldKey: "layout_about", value: "should never store" },
        { fieldKey: "track", value: "ai" },
        { fieldKey: "ai_details", value: "Transformers" },
      ],
      speakers: [{ name: "Layla", email: "layla@example.com" }],
      turnstileToken: TURNSTILE_DEV_PASS_TOKEN,
    });
    expect(res.status).toBe(201);
    const created = SubmissionCreateResponseSchema.parse(await res.json());
    const keys = created.answers.map((a) => a.fieldKey);
    // Layout keys never appear in the stored/returned answers.
    expect(keys).not.toContain("layout_about");
    expect(keys).not.toContain("layout_break");
    // Conditional field adjacent to layout nodes still evaluated + stored.
    expect(keys).toContain("ai_details");
    // Routing rule adjacent to layout nodes still derived the category.
    expect(created.submission.category).toBe("AI");
  });

  it("rejects conditions and rules that reference a layout key", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const cookie = await adminSession(ctx, "w1b-layout-ref@example.com");
    const event = await createEvent(ctx, cookie, "Layout Ref Event");
    const formId = await createForm(ctx, cookie, event.id);

    const badCondition = await putDraft(ctx, cookie, formId, {
      fields: [
        {
          fieldKey: "layout_top",
          type: "text",
          label: "Top",
          nodeKind: "layout",
          layoutType: "section",
          sortOrder: 0,
        },
        {
          ...TITLE_FIELD,
          sortOrder: 1,
          conditions: {
            showWhen: { fieldKey: "layout_top", op: "eq", value: "x" },
          },
        },
      ],
    });
    expect(badCondition.status).toBe(400);

    const badRule = await putDraft(ctx, cookie, formId, {
      fields: [
        {
          fieldKey: "layout_top",
          type: "text",
          label: "Top",
          nodeKind: "layout",
          layoutType: "section",
          sortOrder: 0,
        },
        { ...TITLE_FIELD, sortOrder: 1 },
      ],
      rules: [
        {
          when: { fieldKey: "layout_top", op: "eq", value: "x" },
          routeToCategory: "Nope",
        },
      ],
    });
    expect(badRule.status).toBe(400);
  });

  it("rejects layout nodes with input knobs and blocks layout-only publish", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const cookie = await adminSession(ctx, "w1b-layout-knobs@example.com");
    const event = await createEvent(ctx, cookie, "Layout Knob Event");
    const formId = await createForm(ctx, cookie, event.id);

    // required on a layout node → 400 (Zod).
    const requiredLayout = await putDraft(ctx, cookie, formId, {
      fields: [
        {
          fieldKey: "layout_bad",
          type: "text",
          label: "Bad",
          nodeKind: "layout",
          layoutType: "section",
          required: true,
          sortOrder: 0,
        },
      ],
    });
    expect(requiredLayout.status).toBe(400);

    // layoutType missing on a layout node → 400.
    const missingType = await putDraft(ctx, cookie, formId, {
      fields: [
        {
          fieldKey: "layout_bad2",
          type: "text",
          label: "Bad 2",
          nodeKind: "layout",
          sortOrder: 0,
        },
      ],
    });
    expect(missingType.status).toBe(400);

    // Layout-only form saves but cannot publish (structure has no answers).
    const layoutOnly = await putDraft(ctx, cookie, formId, {
      fields: [
        {
          fieldKey: "layout_solo",
          type: "text",
          label: "Solo section",
          nodeKind: "layout",
          layoutType: "section",
          sortOrder: 0,
        },
      ],
    });
    expect(layoutOnly.status).toBe(200);
    const pub = await jsonReq(
      ctx,
      "POST",
      `/api/forms/${formId}/publish`,
      cookie,
      {},
    );
    expect(pub.status).toBe(400);
    const envlp = ErrorEnvelopeSchema.parse(await pub.json());
    expect(envlp.error).toMatch(/sections and dividers/i);
  });
});

describe("Wave 1B item 1 — submission confirmation lifecycle (integration)", () => {
  async function seedPublished(
    ctx: AppCtx,
    cookie: string,
    name: string,
  ): Promise<{ event: { id: string; slug: string; version: number }; versionId: string }> {
    const event = await createEvent(ctx, cookie, name);
    const formId = await createForm(ctx, cookie, event.id);
    await putDraft(ctx, cookie, formId, { fields: [TITLE_FIELD] });
    const versionId = await publish(ctx, cookie, formId);
    return { event, versionId };
  }

  it("enqueues a durable confirmation job to the submitter's primary email", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const cookie = await adminSession(ctx, "w1b-mail@example.com");
    const { event, versionId } = await seedPublished(ctx, cookie, "Mail Event");

    const res = await submit(
      ctx,
      event.slug,
      submitBody(versionId, "Confirmed talk", "Submitter@Example.com"),
    );
    expect(res.status).toBe(201);
    const created = SubmissionCreateResponseSchema.parse(await res.json());
    const submissionId = created.submission.id;

    // Template lazily seeded and editable per event.
    const template = await ctx.comms.findTemplateByEventKey(
      event.id,
      SUBMISSION_CONFIRMATION_TEMPLATE_KEY,
    );
    expect(template).not.toBeNull();

    // Durable job with the contract idempotency key.
    const job = await ctx.comms.findJobByIdempotencyKey(
      submissionConfirmationIdempotencyKey(submissionId),
    );
    expect(job).not.toBeNull();
    expect(job!.status).toBe("queued");
    expect(job!.eventId).toBe(event.id);

    // Direct-email recipient: normalized address, participation_id NULL,
    // rendered merge fields in the snapshot.
    const recipients = await ctx.comms.listRecipientsForJob(job!.id);
    expect(recipients).toHaveLength(1);
    expect(recipients[0]!.toEmail).toBe("submitter@example.com");
    expect(recipients[0]!.participationId).toBeNull();
    expect(recipients[0]!.subject).toContain("Mail Event");
    expect(recipients[0]!.body).toContain("Confirmed talk");

    // Outbox row targets the comms.send topic for the 5.2 consumer.
    const outboxRows = await ctx.comms.listOutboxByTopic(COMMS_OUTBOX_TOPIC);
    const mine = outboxRows.filter((o) => o.payloadJson.includes(job!.id));
    expect(mine).toHaveLength(1);

    // Idempotency key row present.
    const idem = await ctx.comms.findIdempotencyKey(
      `comms.send:${submissionConfirmationIdempotencyKey(submissionId)}`,
    );
    expect(idem).not.toBeNull();
  });

  it("skips (log + skip) when disabled in event settings — submission still succeeds", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const cookie = await adminSession(ctx, "w1b-mail-off@example.com");
    const { event, versionId } = await seedPublished(
      ctx,
      cookie,
      "Mail Off Event",
    );

    const patch = await jsonReq(ctx, "PATCH", `/api/events/${event.id}`, cookie, {
      settingsJson: JSON.stringify({ submissionConfirmationEnabled: false }),
      expectedVersion: event.version,
    });
    expect(patch.status).toBe(200);

    const res = await submit(
      ctx,
      event.slug,
      submitBody(versionId, "Quiet talk", "quiet@example.com"),
    );
    expect(res.status).toBe(201);
    const created = SubmissionCreateResponseSchema.parse(await res.json());
    const job = await ctx.comms.findJobByIdempotencyKey(
      submissionConfirmationIdempotencyKey(created.submission.id),
    );
    expect(job).toBeNull();
    const jobs = await ctx.comms.listJobsForEvent(event.id);
    expect(jobs).toHaveLength(0);
  });

  it("adds organizer alert recipients from notifySubmissionEmails on the same job", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const cookie = await adminSession(ctx, "w1b-mail-notify@example.com");
    const { event, versionId } = await seedPublished(
      ctx,
      cookie,
      "Mail Notify Event",
    );

    const patch = await jsonReq(ctx, "PATCH", `/api/events/${event.id}`, cookie, {
      settingsJson: JSON.stringify({
        notifySubmissionEmails: ["Program@Example.com", "chairs@example.com"],
      }),
      expectedVersion: event.version,
    });
    expect(patch.status).toBe(200);

    const res = await submit(
      ctx,
      event.slug,
      submitBody(versionId, "Alerted talk", "speaker-alert@example.com"),
    );
    expect(res.status).toBe(201);
    const created = SubmissionCreateResponseSchema.parse(await res.json());
    const job = await ctx.comms.findJobByIdempotencyKey(
      submissionConfirmationIdempotencyKey(created.submission.id),
    );
    expect(job).not.toBeNull();
    const recipients = await ctx.comms.listRecipientsForJob(job!.id);
    expect(recipients.map((r) => r.toEmail).sort()).toEqual([
      "chairs@example.com",
      "program@example.com",
      "speaker-alert@example.com",
    ]);
    const organizer = recipients.find(
      (r) => r.toEmail === "program@example.com",
    )!;
    expect(organizer.subject).toContain("Alerted talk");
  });

  it("never fails the submission when the comms store throws", async () => {
    const broken = new MemoryCommsStore();
    const boom = () => {
      throw new Error("comms down");
    };
    broken.insertJob = boom as never;
    broken.findTemplateByEventKey = boom as never;
    const ctx = createAppWithAuth({
      cookieSecure: true,
      commsStore: broken,
    });
    const cookie = await adminSession(ctx, "w1b-mail-broken@example.com");
    const { event, versionId } = await seedPublished(
      ctx,
      cookie,
      "Mail Broken Event",
    );

    const res = await submit(
      ctx,
      event.slug,
      submitBody(versionId, "Resilient talk", "resilient@example.com"),
    );
    expect(res.status).toBe(201);
  });
});
