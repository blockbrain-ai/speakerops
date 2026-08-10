/**
 * Post-11.9 depth Wave 1A — public CFP knobs (Vitest).
 *
 * Item 1 — field helpText/placeholder/maxChars:
 * - over-cap text/textarea answer rejected on Submission.Create (400)
 * - at-cap answer accepted
 * - maxChars on non-text field rejected at draft save (400)
 *
 * Item 2 — file field:
 * - file field with options rejected at draft save (400)
 *
 * Item 3 — configurable speaker bounds (pinned version):
 * - Form.GetPublic reflects version bounds
 * - submit under min / over max rejected (400) server-side
 * - min > max rejected at draft save (400)
 */
import { describe, it, expect } from "vitest";
import {
  EventResponseSchema,
  FormCreateResponseSchema,
  FormPublishResponseSchema,
  PublicCfpResponseSchema,
  SubmissionCreateResponseSchema,
  ErrorEnvelopeSchema,
  SESSION_COOKIE_NAME,
  TURNSTILE_DEV_PASS_TOKEN,
} from "@speakerops/shared";
import { createAppWithAuth } from "../../index.js";

const env = { APP_VERSION: "0.1.0" };

type AppCtx = ReturnType<typeof createAppWithAuth>;

async function adminSession(
  ctx: AppCtx,
  email: string,
): Promise<string> {
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

async function createEvent(
  ctx: AppCtx,
  cookie: string,
  name: string,
): Promise<{ id: string; slug: string }> {
  const res = await ctx.app.request(
    "http://localhost/api/events",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-correlation-id": "corr-w1a-evt",
      },
      body: JSON.stringify({ name, timezone: "UTC" }),
    },
    env,
  );
  expect(res.status).toBe(201);
  return EventResponseSchema.parse(await res.json()).event;
}

async function createForm(
  ctx: AppCtx,
  cookie: string,
  eventId: string,
): Promise<string> {
  const res = await ctx.app.request(
    `http://localhost/api/events/${eventId}/forms`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "Depth CFP" }),
    },
    env,
  );
  expect(res.status).toBe(201);
  return FormCreateResponseSchema.parse(await res.json()).form.id;
}

async function putDraft(
  ctx: AppCtx,
  cookie: string,
  formId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return ctx.app.request(
    `http://localhost/api/forms/${formId}/draft`,
    {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    },
    env,
  );
}

async function publish(
  ctx: AppCtx,
  cookie: string,
  formId: string,
): Promise<string> {
  const res = await ctx.app.request(
    `http://localhost/api/forms/${formId}/publish`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    },
    env,
  );
  expect(res.status).toBe(200);
  return FormPublishResponseSchema.parse(await res.json()).formVersion.id;
}

function speakers(n: number, seed: string) {
  return Array.from({ length: n }, (_, i) => ({
    name: `Speaker ${seed} ${i + 1}`,
    email: `speaker-${seed}-${i + 1}@example.com`,
  }));
}

async function submit(
  ctx: AppCtx,
  slug: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return ctx.app.request(
    `http://localhost/api/public/cfp/${slug}/submissions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-correlation-id": "corr-w1a-submit",
      },
      body: JSON.stringify(body),
    },
    env,
  );
}

describe("Wave 1A item 1 — field character cap (maxChars)", () => {
  it("rejects over-cap answers on submit and accepts at-cap", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const cookie = await adminSession(ctx, "w1a-cap@example.com");
    const event = await createEvent(ctx, cookie, "Cap Event");
    const formId = await createForm(ctx, cookie, event.id);
    const draft = await putDraft(ctx, cookie, formId, {
      fields: [
        {
          fieldKey: "abstract",
          type: "textarea",
          label: "Abstract",
          required: true,
          sortOrder: 0,
          helpText: "Keep it under 20 characters.",
          placeholder: "Short pitch",
          maxChars: 20,
        },
      ],
    });
    expect(draft.status).toBe(200);
    const versionId = await publish(ctx, cookie, formId);

    // Public GET carries the knobs on the published field.
    const pub = await ctx.app.request(
      `http://localhost/api/public/cfp/${event.slug}`,
      { headers: { accept: "application/json" } },
      env,
    );
    const pubBody = PublicCfpResponseSchema.parse(await pub.json());
    const field = pubBody.formVersion!.fields.find(
      (f) => f.fieldKey === "abstract",
    )!;
    expect(field.helpText).toBe("Keep it under 20 characters.");
    expect(field.placeholder).toBe("Short pitch");
    expect(field.maxChars).toBe(20);

    // Over-cap → 400 with the offending fieldKey.
    const over = await submit(ctx, event.slug, {
      formVersionId: versionId,
      title: "Over cap",
      answers: [{ fieldKey: "abstract", value: "x".repeat(21) }],
      speakers: speakers(1, "cap-over"),
      turnstileToken: TURNSTILE_DEV_PASS_TOKEN,
    });
    expect(over.status).toBe(400);
    const overEnv = ErrorEnvelopeSchema.parse(await over.json());
    expect(JSON.stringify(overEnv.details)).toContain("abstract");

    // Exactly at cap → accepted and stored.
    const ok = await submit(ctx, event.slug, {
      formVersionId: versionId,
      title: "At cap",
      answers: [{ fieldKey: "abstract", value: "y".repeat(20) }],
      speakers: speakers(1, "cap-ok"),
      turnstileToken: TURNSTILE_DEV_PASS_TOKEN,
    });
    expect(ok.status).toBe(201);
    const created = SubmissionCreateResponseSchema.parse(await ok.json());
    expect(
      created.answers.find((a) => a.fieldKey === "abstract")?.value,
    ).toBe("y".repeat(20));
  });

  it("rejects maxChars on non-text fields at draft save", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const cookie = await adminSession(ctx, "w1a-cap-type@example.com");
    const event = await createEvent(ctx, cookie, "Cap Type Event");
    const formId = await createForm(ctx, cookie, event.id);
    const res = await putDraft(ctx, cookie, formId, {
      fields: [
        {
          fieldKey: "pick",
          type: "select",
          label: "Pick",
          required: false,
          sortOrder: 0,
          options: [{ value: "a", label: "A" }],
          maxChars: 10,
        },
      ],
    });
    expect(res.status).toBe(400);
  });
});

describe("Wave 1A item 2 — file field validation", () => {
  it("rejects a file field carrying options at draft save", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const cookie = await adminSession(ctx, "w1a-file@example.com");
    const event = await createEvent(ctx, cookie, "File Field Event");
    const formId = await createForm(ctx, cookie, event.id);
    const res = await putDraft(ctx, cookie, formId, {
      fields: [
        {
          fieldKey: "slides",
          type: "file",
          label: "Slides",
          required: true,
          sortOrder: 0,
          options: [{ value: "a", label: "A" }],
        },
      ],
    });
    expect(res.status).toBe(400);

    // Without options the file field publishes (required allowed).
    const ok = await putDraft(ctx, cookie, formId, {
      fields: [
        {
          fieldKey: "slides",
          type: "file",
          label: "Slides",
          required: true,
          sortOrder: 0,
        },
      ],
    });
    expect(ok.status).toBe(200);
    await publish(ctx, cookie, formId);
  });
});

describe("Wave 1A item 3 — configurable speaker bounds (pinned version)", () => {
  it("enforces min/max from the pinned published version", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const cookie = await adminSession(ctx, "w1a-bounds@example.com");
    const event = await createEvent(ctx, cookie, "Bounds Event");
    const formId = await createForm(ctx, cookie, event.id);
    const draft = await putDraft(ctx, cookie, formId, {
      fields: [
        {
          fieldKey: "talk_title",
          type: "text",
          label: "Talk title",
          required: true,
          sortOrder: 0,
        },
      ],
      minSpeakers: 2,
      maxSpeakers: 3,
    });
    expect(draft.status).toBe(200);
    const versionId = await publish(ctx, cookie, formId);

    // Public GET reflects the version bounds (not the 1/5 defaults).
    const pub = await ctx.app.request(
      `http://localhost/api/public/cfp/${event.slug}`,
      { headers: { accept: "application/json" } },
      env,
    );
    const pubBody = PublicCfpResponseSchema.parse(await pub.json());
    expect(pubBody.minSpeakers).toBe(2);
    expect(pubBody.maxSpeakers).toBe(3);

    const base = {
      formVersionId: versionId,
      title: "Bounds talk",
      answers: [{ fieldKey: "talk_title", value: "Bounds talk" }],
      turnstileToken: TURNSTILE_DEV_PASS_TOKEN,
    };

    // Under min (1 < 2) → 400.
    const under = await submit(ctx, event.slug, {
      ...base,
      speakers: speakers(1, "under"),
    });
    expect(under.status).toBe(400);

    // Over max (4 > 3) → 400.
    const overRes = await submit(ctx, event.slug, {
      ...base,
      speakers: speakers(4, "over"),
    });
    expect(overRes.status).toBe(400);

    // Within bounds → 201.
    const ok = await submit(ctx, event.slug, {
      ...base,
      speakers: speakers(2, "within"),
    });
    expect(ok.status).toBe(201);
  });

  it("rejects min > max and out-of-envelope values at draft save", async () => {
    const ctx = createAppWithAuth({ cookieSecure: true });
    const cookie = await adminSession(ctx, "w1a-bounds-bad@example.com");
    const event = await createEvent(ctx, cookie, "Bad Bounds Event");
    const formId = await createForm(ctx, cookie, event.id);
    const fields = [
      {
        fieldKey: "talk_title",
        type: "text",
        label: "Talk title",
        required: true,
        sortOrder: 0,
      },
    ];
    const inverted = await putDraft(ctx, cookie, formId, {
      fields,
      minSpeakers: 4,
      maxSpeakers: 2,
    });
    expect(inverted.status).toBe(400);
    const tooMany = await putDraft(ctx, cookie, formId, {
      fields,
      minSpeakers: 1,
      maxSpeakers: 16,
    });
    expect(tooMany.status).toBe(400);
  });
});
