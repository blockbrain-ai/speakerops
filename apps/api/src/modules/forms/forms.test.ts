/**
 * Section 3.1 — Form builder API (Vitest).
 *
 * Named assertions from spec:
 * - assert publish freezes form_versions row immutable
 * - assert draft update does not change published snapshot_json
 * - assert invalid condition field_key 400
 *
 * Plus: OpenAPI lists Form commands, authz 401/403, audit_events + correlationId.
 */
import { describe, it, expect } from "vitest";
import {
  ErrorEnvelopeSchema,
  FormCreateResponseSchema,
  FormUpdateDraftResponseSchema,
  FormPublishResponseSchema,
  FormListResponseSchema,
  FormAdminGetResponseSchema,
  PublicCfpResponseSchema,
  EventResponseSchema,
  VALIDATION_ERROR,
  UNAUTHORIZED,
  FORBIDDEN,
  NOT_FOUND,
  SESSION_COOKIE_NAME,
} from "@speakerops/shared";
import { createAppWithAuth } from "../../index.js";
import { buildOpenApiDocument, OPENAPI_COMMANDS } from "../../openapi.js";

const env = { APP_VERSION: "0.1.0" };

async function magicLinkSession(
  purpose: "admin" | "speaker" | "evaluator",
  email: string,
  eventId?: string,
): Promise<{
  app: ReturnType<typeof createAppWithAuth>["app"];
  store: ReturnType<typeof createAppWithAuth>["store"];
  events: ReturnType<typeof createAppWithAuth>["events"];
  forms: ReturnType<typeof createAppWithAuth>["forms"];
  cookie: string;
}> {
  const { app, store, events, forms, outbox } = createAppWithAuth({
    cookieSecure: true,
  });
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
  return {
    app,
    store,
    events,
    forms,
    cookie: `${SESSION_COOKIE_NAME}=${sessionValue}`,
  };
}

async function createEvent(
  app: ReturnType<typeof createAppWithAuth>["app"],
  cookie: string,
  name = "Forms Event",
  slug?: string,
): Promise<{ id: string; slug: string }> {
  const res = await app.request(
    "http://localhost/api/events",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-correlation-id": "corr-create-for-forms",
      },
      body: JSON.stringify({
        name,
        timezone: "UTC",
        ...(slug ? { slug } : {}),
      }),
    },
    env,
  );
  expect(res.status).toBe(201);
  const parsed = EventResponseSchema.parse(await res.json());
  return { id: parsed.event.id, slug: parsed.event.slug };
}

const sampleFields = [
  {
    fieldKey: "talk_title",
    type: "text" as const,
    label: "Talk title",
    required: true,
    sortOrder: 0,
  },
  {
    fieldKey: "category",
    type: "select" as const,
    label: "Category",
    required: true,
    sortOrder: 1,
    options: [
      { value: "ai", label: "AI" },
      { value: "infra", label: "Infrastructure" },
    ],
  },
  {
    fieldKey: "gpu_notes",
    type: "textarea" as const,
    label: "GPU notes",
    required: false,
    sortOrder: 2,
    conditions: {
      showWhen: { fieldKey: "category", op: "eq" as const, value: "ai" },
    },
  },
];

const sampleRules = [
  {
    when: { fieldKey: "category", op: "eq" as const, value: "ai" },
    routeToCategory: "artificial-intelligence",
  },
  {
    when: { fieldKey: "category", op: "eq" as const, value: "infra" },
    routeToCategory: "infrastructure",
  },
];

describe("3.1 form builder API", () => {
  it("assert publish freezes form_versions row immutable", async () => {
    const { app, store, forms, cookie } = await magicLinkSession(
      "admin",
      "admin-forms-publish@example.com",
    );
    const { id: eventId } = await createEvent(app, cookie, "Publish Freeze");

    const createRes = await app.request(
      `http://localhost/api/events/${eventId}/forms`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-form-create-publish",
        },
        body: JSON.stringify({ name: "CFP 2026" }),
      },
      env,
    );
    expect(createRes.status).toBe(201);
    const created = FormCreateResponseSchema.parse(await createRes.json());
    expect(created.form.status).toBe("draft");
    expect(created.draft.versionNum).toBe(0);
    expect(created.draft.immutable).toBe(false);

    const draftRes = await app.request(
      `http://localhost/api/forms/${created.form.id}/draft`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-form-draft-1",
        },
        body: JSON.stringify({
          fields: sampleFields,
          rules: sampleRules,
          welcomeMd: "Welcome",
        }),
      },
      env,
    );
    expect(draftRes.status).toBe(200);
    FormUpdateDraftResponseSchema.parse(await draftRes.json());

    const publishRes = await app.request(
      `http://localhost/api/forms/${created.form.id}/publish`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-form-publish",
        },
        body: JSON.stringify({}),
      },
      env,
    );
    expect(publishRes.status).toBe(200);
    const published = FormPublishResponseSchema.parse(await publishRes.json());
    expect(published.formVersion.versionNum).toBe(1);
    expect(published.formVersion.immutable).toBe(true);
    expect(published.formVersion.publishedAt).toBeTruthy();
    expect(published.formVersion.snapshotJson).not.toBeNull();
    expect(published.formVersion.snapshotJson!.fields.map((f) => f.fieldKey)).toEqual(
      expect.arrayContaining(["talk_title", "category", "gpu_notes"]),
    );
    expect(published.formVersion.rules).toHaveLength(2);
    expect(published.form.status).toBe("published");

    const frozenSnapshot = published.formVersion.snapshotJson;
    const frozenJson = JSON.stringify(frozenSnapshot);

    // Store-level immutability: tryMutatePublishedSnapshot refuses
    const mutated = await forms.tryMutatePublishedSnapshot(
      published.formVersion.id,
      JSON.stringify({ ...frozenSnapshot, welcomeMd: "HACKED" }),
    );
    expect(mutated).toBe(false);

    const row = await forms.findVersionById(published.formVersion.id);
    expect(row).not.toBeNull();
    expect(row!.snapshotJson).toBe(frozenJson);
    expect(row!.publishedAt).toBe(published.formVersion.publishedAt);

    // Replace fields on published version must throw / no-op path
    await expect(
      forms.replaceFields(published.formVersion.id, [
        {
          id: "x",
          formVersionId: published.formVersion.id,
          fieldKey: "hacked",
          type: "text",
          label: "Hacked",
          required: false,
          options: null,
          sortOrder: 0,
          conditions: null,
        },
      ]),
    ).rejects.toThrow(/published/i);

    // Audit + correlationId on publish
    const audits = await store.listAudits();
    const pubAudit = audits.find((a) => a.action === "Form.Publish");
    expect(pubAudit).toBeDefined();
    expect(pubAudit!.correlationId).toBe("corr-form-publish");
    expect(pubAudit!.entityType).toBe("form_version");
    expect(pubAudit!.entityId).toBe(published.formVersion.id);

    // OpenAPI lists Form commands (also covered by dedicated test; AC map)
    const openapi = buildOpenApiDocument();
    expect(openapi.paths).toHaveProperty("/api/forms/{formId}/publish");
    expect(OPENAPI_COMMANDS).toContain("Form.Publish");
  });

  it("assert draft update does not change published snapshot_json", async () => {
    const { app, forms, cookie } = await magicLinkSession(
      "admin",
      "admin-forms-draft@example.com",
    );
    const { id: eventId, slug } = await createEvent(
      app,
      cookie,
      "Draft Isolation",
      "draft-isolation-cfp",
    );

    const createRes = await app.request(
      `http://localhost/api/events/${eventId}/forms`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-form-create-draft",
        },
        body: JSON.stringify({ name: "Draft Isolation CFP" }),
      },
      env,
    );
    const created = FormCreateResponseSchema.parse(await createRes.json());

    await app.request(
      `http://localhost/api/forms/${created.form.id}/draft`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-form-draft-v1",
        },
        body: JSON.stringify({
          fields: sampleFields,
          rules: sampleRules,
          welcomeMd: "Published welcome",
        }),
      },
      env,
    );

    const publishRes = await app.request(
      `http://localhost/api/forms/${created.form.id}/publish`,
      {
        method: "POST",
        headers: {
          cookie,
          "x-correlation-id": "corr-form-publish-v1",
        },
      },
      env,
    );
    const published = FormPublishResponseSchema.parse(await publishRes.json());
    const publishedSnapshot = published.formVersion.snapshotJson;
    expect(publishedSnapshot).not.toBeNull();
    const snapshotBefore = JSON.stringify(publishedSnapshot);

    // Draft update after publish
    const draftUpdate = await app.request(
      `http://localhost/api/forms/${created.form.id}/draft`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-form-draft-after-publish",
        },
        body: JSON.stringify({
          fields: [
            {
              fieldKey: "talk_title",
              type: "text",
              label: "Talk title (edited draft)",
              required: true,
            },
            {
              fieldKey: "new_field",
              type: "text",
              label: "Only in draft",
              required: false,
            },
          ],
          rules: [],
          welcomeMd: "Draft-only welcome — must not leak to published",
        }),
      },
      env,
    );
    expect(draftUpdate.status).toBe(200);
    const draftBody = FormUpdateDraftResponseSchema.parse(
      await draftUpdate.json(),
    );
    expect(draftBody.formVersion.versionNum).toBe(0);
    expect(draftBody.formVersion.immutable).toBe(false);
    expect(draftBody.formVersion.fields.map((f) => f.fieldKey)).toContain(
      "new_field",
    );
    expect(draftBody.formVersion.welcomeMd).toContain("Draft-only");

    // Published row snapshot unchanged
    const pubRow = await forms.findVersionById(published.formVersion.id);
    expect(pubRow!.snapshotJson).toBe(snapshotBefore);
    expect(JSON.parse(pubRow!.snapshotJson!).welcomeMd).toBe(
      "Published welcome",
    );
    expect(
      JSON.parse(pubRow!.snapshotJson!).fields.map(
        (f: { fieldKey: string }) => f.fieldKey,
      ),
    ).not.toContain("new_field");

    // Public CFP returns published snapshot only (never draft)
    const publicRes = await app.request(
      `http://localhost/api/public/cfp/${slug}`,
      { method: "GET" },
      env,
    );
    expect(publicRes.status).toBe(200);
    const publicBody = PublicCfpResponseSchema.parse(await publicRes.json());
    expect(publicBody.formVersion).not.toBeNull();
    expect(publicBody.formVersion!.versionNum).toBe(1);
    expect(publicBody.formVersion!.immutable).toBe(true);
    expect(publicBody.formVersion!.welcomeMd).toBe("Published welcome");
    expect(
      publicBody.formVersion!.fields.map((f) => f.fieldKey),
    ).not.toContain("new_field");
  });

  it("assert invalid condition field_key 400", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "admin-forms-cond@example.com",
    );
    const { id: eventId } = await createEvent(app, cookie, "Condition Event");

    const createRes = await app.request(
      `http://localhost/api/events/${eventId}/forms`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({ name: "Cond CFP" }),
      },
      env,
    );
    const created = FormCreateResponseSchema.parse(await createRes.json());

    // Field condition references unknown field_key
    const badFieldCond = await app.request(
      `http://localhost/api/forms/${created.form.id}/draft`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-bad-cond-field",
        },
        body: JSON.stringify({
          fields: [
            {
              fieldKey: "title",
              type: "text",
              label: "Title",
              required: true,
              conditions: {
                showWhen: {
                  fieldKey: "does_not_exist",
                  op: "eq",
                  value: "x",
                },
              },
            },
          ],
          rules: [],
        }),
      },
      env,
    );
    expect(badFieldCond.status).toBe(400);
    const err1 = ErrorEnvelopeSchema.parse(await badFieldCond.json());
    expect(err1.code).toBe(VALIDATION_ERROR);
    expect(err1.error.toLowerCase()).toMatch(/field_key|condition/);

    // Category routing rule references unknown field_key
    const badRule = await app.request(
      `http://localhost/api/forms/${created.form.id}/draft`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-bad-cond-rule",
        },
        body: JSON.stringify({
          fields: [
            {
              fieldKey: "title",
              type: "text",
              label: "Title",
              required: true,
            },
          ],
          rules: [
            {
              when: {
                fieldKey: "missing_select",
                op: "eq",
                value: "ai",
              },
              routeToCategory: "ai",
            },
          ],
        }),
      },
      env,
    );
    expect(badRule.status).toBe(400);
    const err2 = ErrorEnvelopeSchema.parse(await badRule.json());
    expect(err2.code).toBe(VALIDATION_ERROR);
    expect(err2.error.toLowerCase()).toMatch(/field_key|condition/);

    // Valid category routing rule stored
    const good = await app.request(
      `http://localhost/api/forms/${created.form.id}/draft`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          fields: sampleFields,
          rules: sampleRules,
        }),
      },
      env,
    );
    expect(good.status).toBe(200);
    const goodBody = FormUpdateDraftResponseSchema.parse(await good.json());
    expect(goodBody.formVersion.rules).toHaveLength(2);
    expect(goodBody.formVersion.rules[0]!.routeToCategory).toBe(
      "artificial-intelligence",
    );
  });

  it("OpenAPI lists Form commands", async () => {
    const { app } = createAppWithAuth({ cookieSecure: true });
    const res = await app.request("http://localhost/openapi.json", {}, env);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      paths: Record<string, unknown>;
      "x-speakerops-commands": string[];
    };
    expect(doc.paths["/api/events/{eventId}/forms"]).toBeDefined();
    expect(doc.paths["/api/forms/{formId}/draft"]).toBeDefined();
    expect(doc.paths["/api/forms/{formId}/publish"]).toBeDefined();
    expect(doc.paths["/api/public/cfp/{slug}"]).toBeDefined();
    for (const cmd of [
      "Form.Create",
      "Form.UpdateDraftFields",
      "Form.Publish",
      "Form.GetPublic",
    ]) {
      expect(doc["x-speakerops-commands"]).toContain(cmd);
    }
  });

  it("unauthenticated Form.Create returns 401", async () => {
    const { app } = createAppWithAuth({ cookieSecure: true });
    const res = await app.request(
      "http://localhost/api/events/evt_x/forms",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Nope" }),
      },
      env,
    );
    expect(res.status).toBe(401);
    const body = ErrorEnvelopeSchema.parse(await res.json());
    expect(body.code).toBe(UNAUTHORIZED);
  });

  it("speaker role cannot Form.Create (403)", async () => {
    const { app, store, outbox } = createAppWithAuth({ cookieSecure: true });

    // Admin bootstrap + create event
    await app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "admin-role-form@example.com",
          purpose: "admin",
        }),
      },
      env,
    );
    const adminToken = outbox.lastForEmail("admin-role-form@example.com")!.token;
    const adminEx = await app.request(
      "http://localhost/api/auth/exchange",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: adminToken }),
      },
      env,
    );
    const adminCookie = `${SESSION_COOKIE_NAME}=${adminEx.headers
      .get("set-cookie")!
      .split(";")[0]!
      .split("=")
      .slice(1)
      .join("=")}`;

    const eventRes = await app.request(
      "http://localhost/api/events",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
        },
        body: JSON.stringify({ name: "Role Gate Form", timezone: "UTC" }),
      },
      env,
    );
    const event = EventResponseSchema.parse(await eventRes.json());

    // Speaker on same event
    await app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "speaker-role-form@example.com",
          purpose: "speaker",
          eventId: event.event.id,
        }),
      },
      env,
    );
    const spToken = outbox.lastForEmail("speaker-role-form@example.com")!.token;
    const spEx = await app.request(
      "http://localhost/api/auth/exchange",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: spToken }),
      },
      env,
    );
    const spCookie = `${SESSION_COOKIE_NAME}=${spEx.headers
      .get("set-cookie")!
      .split(";")[0]!
      .split("=")
      .slice(1)
      .join("=")}`;

    const res = await app.request(
      `http://localhost/api/events/${event.event.id}/forms`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: spCookie,
        },
        body: JSON.stringify({ name: "Speaker cannot create" }),
      },
      env,
    );
    expect(res.status).toBe(403);
    const body = ErrorEnvelopeSchema.parse(await res.json());
    expect(body.code).toBe(FORBIDDEN);
    void store;
  });

  it("invalid field_key format returns 400", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "admin-field-key@example.com",
    );
    const { id: eventId } = await createEvent(app, cookie);
    const createRes = await app.request(
      `http://localhost/api/events/${eventId}/forms`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({ name: "Key format" }),
      },
      env,
    );
    const created = FormCreateResponseSchema.parse(await createRes.json());

    const res = await app.request(
      `http://localhost/api/forms/${created.form.id}/draft`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          fields: [
            {
              fieldKey: "Invalid-Key!",
              type: "text",
              label: "Bad",
              required: false,
            },
          ],
          rules: [],
        }),
      },
      env,
    );
    expect(res.status).toBe(400);
    const body = ErrorEnvelopeSchema.parse(await res.json());
    expect(body.code).toBe(VALIDATION_ERROR);
  });

  it("publish increments version_num and keeps prior published immutable", async () => {
    const { app, forms, cookie } = await magicLinkSession(
      "admin",
      "admin-version-pin@example.com",
    );
    const { id: eventId } = await createEvent(app, cookie, "Version Pin");

    const createRes = await app.request(
      `http://localhost/api/events/${eventId}/forms`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({ name: "Version pin form" }),
      },
      env,
    );
    const created = FormCreateResponseSchema.parse(await createRes.json());

    await app.request(
      `http://localhost/api/forms/${created.form.id}/draft`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          fields: [
            {
              fieldKey: "talk_title",
              type: "text",
              label: "Title v1",
              required: true,
            },
          ],
          rules: [],
        }),
      },
      env,
    );

    const p1 = FormPublishResponseSchema.parse(
      await (
        await app.request(
          `http://localhost/api/forms/${created.form.id}/publish`,
          { method: "POST", headers: { cookie } },
          env,
        )
      ).json(),
    );
    expect(p1.formVersion.versionNum).toBe(1);
    const snap1 = p1.formVersion.snapshotJson;

    await app.request(
      `http://localhost/api/forms/${created.form.id}/draft`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          fields: [
            {
              fieldKey: "talk_title",
              type: "text",
              label: "Title v2",
              required: true,
            },
          ],
          rules: [],
        }),
      },
      env,
    );

    const p2 = FormPublishResponseSchema.parse(
      await (
        await app.request(
          `http://localhost/api/forms/${created.form.id}/publish`,
          { method: "POST", headers: { cookie } },
          env,
        )
      ).json(),
    );
    expect(p2.formVersion.versionNum).toBe(2);
    expect(p2.formVersion.snapshotJson!.fields[0]!.label).toBe("Title v2");

    // v1 snapshot still pinned (I16 field_key stable + version pin)
    const v1 = await forms.findVersionById(p1.formVersion.id);
    expect(JSON.parse(v1!.snapshotJson!).fields[0].label).toBe("Title v1");
    expect(JSON.parse(v1!.snapshotJson!).fields[0].fieldKey).toBe("talk_title");
    expect(JSON.stringify(JSON.parse(v1!.snapshotJson!))).toBe(
      JSON.stringify(snap1),
    );
  });

  it("unknown form id returns 404", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "admin-missing-form@example.com",
    );
    await createEvent(app, cookie);
    const res = await app.request(
      "http://localhost/api/forms/does-not-exist/draft",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({ fields: [], rules: [] }),
      },
      env,
    );
    expect(res.status).toBe(404);
    const body = ErrorEnvelopeSchema.parse(await res.json());
    expect(body.code).toBe(NOT_FOUND);
  });

  it("Form.List and Form.GetAdmin reload draft fields/rules", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "admin-forms-list-get@example.com",
    );
    const { id: eventId } = await createEvent(app, cookie, "List Get Forms");

    const emptyList = await app.request(
      `http://localhost/api/events/${eventId}/forms`,
      { method: "GET", headers: { cookie } },
      env,
    );
    expect(emptyList.status).toBe(200);
    expect(FormListResponseSchema.parse(await emptyList.json()).forms).toEqual(
      [],
    );

    const createRes = await app.request(
      `http://localhost/api/events/${eventId}/forms`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({ name: "Reloadable CFP" }),
      },
      env,
    );
    const created = FormCreateResponseSchema.parse(await createRes.json());

    await app.request(
      `http://localhost/api/forms/${created.form.id}/draft`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          fields: sampleFields,
          rules: sampleRules,
          welcomeMd: "Welcome reload",
          thankYouMd: "Thanks reload",
        }),
      },
      env,
    );

    const listRes = await app.request(
      `http://localhost/api/events/${eventId}/forms`,
      { method: "GET", headers: { cookie } },
      env,
    );
    expect(listRes.status).toBe(200);
    const listed = FormListResponseSchema.parse(await listRes.json());
    expect(listed.forms).toHaveLength(1);
    expect(listed.forms[0]!.id).toBe(created.form.id);
    expect(listed.forms[0]!.name).toBe("Reloadable CFP");

    const getRes = await app.request(
      `http://localhost/api/forms/${created.form.id}`,
      { method: "GET", headers: { cookie } },
      env,
    );
    expect(getRes.status).toBe(200);
    const detail = FormAdminGetResponseSchema.parse(await getRes.json());
    expect(detail.form.id).toBe(created.form.id);
    expect(detail.draft.fields.map((f) => f.fieldKey)).toEqual(
      expect.arrayContaining(["talk_title", "category", "gpu_notes"]),
    );
    expect(detail.draft.rules).toHaveLength(2);
    expect(detail.draft.welcomeMd).toBe("Welcome reload");
    expect(detail.published ?? null).toBeNull();

    // Publish then GetAdmin includes published meta
    await app.request(
      `http://localhost/api/forms/${created.form.id}/publish`,
      {
        method: "POST",
        headers: { cookie },
      },
      env,
    );
    const getPublished = await app.request(
      `http://localhost/api/forms/${created.form.id}`,
      { method: "GET", headers: { cookie } },
      env,
    );
    const afterPub = FormAdminGetResponseSchema.parse(
      await getPublished.json(),
    );
    expect(afterPub.form.status).toBe("published");
    expect(afterPub.published).not.toBeNull();
    expect(afterPub.published!.immutable).toBe(true);
    expect(afterPub.draft.fields.length).toBeGreaterThan(0);

    // Authz: unauthenticated list 401
    const unauth = await app.request(
      `http://localhost/api/events/${eventId}/forms`,
      { method: "GET" },
      env,
    );
    expect(unauth.status).toBe(401);
  });

  it("wires section descriptionRich end-to-end: draft → snapshot → public payload (F2)", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "admin-forms-descrich@example.com",
    );
    const { id: eventId, slug } = await createEvent(app, cookie, "Desc Rich");

    const createRes = await app.request(
      `http://localhost/api/events/${eventId}/forms`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "CFP desc" }),
      },
      env,
    );
    const created = FormCreateResponseSchema.parse(await createRes.json());

    const descriptionRich = {
      schema: "v1" as const,
      doc: {
        type: "doc" as const,
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Fill in " },
              { type: "text", text: "everything", marks: [{ type: "bold" }] },
            ],
          },
          {
            type: "bulletList",
            content: [
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] },
            ],
          },
        ],
      },
    };

    const draftRes = await app.request(
      `http://localhost/api/forms/${created.form.id}/draft`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          fields: [
            {
              fieldKey: "about_section",
              type: "text",
              label: "About your talk",
              nodeKind: "layout",
              layoutType: "section",
              sortOrder: 0,
              descriptionRich,
            },
            { fieldKey: "talk_title", type: "text", label: "Talk title", required: true, sortOrder: 1 },
          ],
          rules: [],
        }),
      },
      env,
    );
    expect(draftRes.status).toBe(200);
    const draftBody = FormUpdateDraftResponseSchema.parse(await draftRes.json());
    const draftSection = draftBody.formVersion.fields.find(
      (f) => f.fieldKey === "about_section",
    );
    // Dual-read returns the rich doc on the draft.
    expect(draftSection?.descriptionRich).toBeTruthy();
    expect(JSON.stringify(draftSection?.descriptionRich)).toContain("everything");

    const publishRes = await app.request(
      `http://localhost/api/forms/${created.form.id}/publish`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({}),
      },
      env,
    );
    expect(publishRes.status).toBe(200);
    const published = FormPublishResponseSchema.parse(await publishRes.json());
    // The immutable snapshot carries the section description rich doc.
    const snapSection = published.formVersion.snapshotJson!.fields.find(
      (f) => f.fieldKey === "about_section",
    );
    expect(snapSection?.descriptionRich).toBeTruthy();
    expect(JSON.stringify(snapSection?.descriptionRich)).toContain("everything");

    // Public CFP payload exposes the section description for <RichText> render.
    const publicRes = await app.request(
      `http://localhost/api/public/cfp/${slug}`,
      { method: "GET" },
      env,
    );
    expect(publicRes.status).toBe(200);
    const publicBody = PublicCfpResponseSchema.parse(await publicRes.json());
    const pubSection = publicBody.formVersion!.fields.find(
      (f) => f.fieldKey === "about_section",
    );
    expect(pubSection?.descriptionRich).toBeTruthy();
    expect(JSON.stringify(pubSection?.descriptionRich)).toContain("everything");
  });
});
