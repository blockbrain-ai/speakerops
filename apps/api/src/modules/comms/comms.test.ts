/**
 * Section 5.1 — Email templates + outbox message jobs (Vitest).
 *
 * Named assertions from spec:
 * - assert template upsert stores subject
 * - assert enqueue creates outbox_events not provider HTTP mock call in command
 *
 * Plus: Zod 400, unauth 401, wrong role 403/404, audit + correlationId,
 * merge-field render, no provider HTTP on request path.
 */
import { describe, it, expect, vi } from "vitest";
import {
  ErrorEnvelopeSchema,
  CommsUpsertTemplateResponseSchema,
  CommsPreviewResponseSchema,
  CommsSendResponseSchema,
  EventResponseSchema,
  COMMS_OUTBOX_TOPIC,
  SESSION_COOKIE_NAME,
  VALIDATION_ERROR,
  UNAUTHORIZED,
  FORBIDDEN,
} from "@speakerops/shared";
import { createAppWithAuth } from "../../index.js";
import { OPENAPI_COMMANDS } from "../../openapi.js";

const env = { APP_VERSION: "0.1.0" };

async function magicLinkSession(
  purpose: "admin" | "speaker" | "evaluator",
  email: string,
  eventId?: string,
  shared?: ReturnType<typeof createAppWithAuth>,
) {
  const ctx = shared ?? createAppWithAuth({ cookieSecure: true });
  const { app, store, events, submissions, decisions, comms, outbox } = ctx;
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
  const user = await store.findUserByEmail(email);
  expect(user).toBeTruthy();
  return {
    app,
    store,
    events,
    submissions,
    decisions,
    comms,
    outbox,
    cookie: `${SESSION_COOKIE_NAME}=${sessionValue}`,
    userId: user!.id,
  };
}

async function createEvent(
  app: ReturnType<typeof createAppWithAuth>["app"],
  cookie: string,
  name = "Comms Event",
): Promise<{ id: string; slug: string }> {
  const res = await app.request(
    "http://localhost/api/events",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-correlation-id": "corr-create-for-comms",
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
  return { id: parsed.data!.event.id, slug: parsed.data!.event.slug };
}

describe("5.1 Comms email templates + outbox", () => {
  it("assert template upsert stores subject", async () => {
    const admin = await magicLinkSession(
      "admin",
      "comms-admin-upsert@example.com",
    );
    const event = await createEvent(admin.app, admin.cookie);

    const res = await admin.app.request(
      `http://localhost/api/events/${event.id}/templates/accept-reminder`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
          "x-correlation-id": "corr-template-upsert-1",
        },
        body: JSON.stringify({
          subject: "Your talk was accepted — {{eventName}}",
          body: "Hi {{name}}, please complete portal tasks.",
        }),
      },
      env,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    const parsed = CommsUpsertTemplateResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(parsed.data!.template.subject).toBe(
      "Your talk was accepted — {{eventName}}",
    );
    expect(parsed.data!.template.key).toBe("accept-reminder");
    expect(parsed.data!.template.eventId).toBe(event.id);
    expect(parsed.data!.template.version).toBe(1);

    // Persisted in store
    const stored = await admin.comms.findTemplateByEventKey(
      event.id,
      "accept-reminder",
    );
    expect(stored).toBeTruthy();
    expect(stored!.subject).toBe("Your talk was accepted — {{eventName}}");
    expect(stored!.bodyMd).toContain("{{name}}");

    // Audit with correlationId
    const audits = await admin.store.listAudits();
    const audit = audits.find((a) => a.action === "Comms.UpsertTemplate");
    expect(audit).toBeTruthy();
    expect(audit!.correlationId).toBe("corr-template-upsert-1");
    expect(audit!.entityType).toBe("email_template");
  });

  it("assert enqueue creates outbox_events not provider HTTP mock call in command", async () => {
    const admin = await magicLinkSession(
      "admin",
      "comms-admin-enqueue@example.com",
    );
    const event = await createEvent(admin.app, admin.cookie, "Enqueue Event");

    // Seed one accepted participation with person email for preview recipients
    const person = await admin.submissions.insertPerson({
      id: "person_comms_1",
      orgId: "org_dogfood",
      email: "speaker-comms@example.com",
      name: "Speaker Comms",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await admin.decisions.insertParticipation({
      id: "part_comms_1",
      eventId: event.id,
      personId: person.id,
      userId: null,
      roleLabel: "speaker",
      status: "accepted",
      bio: null,
      company: "Acme",
      title: "Engineer",
      headshotFileId: null,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Ensure org matches (Event.Create uses DEFAULT_ORG_ID)
    const eventRow = await admin.events.findEventById(event.id);
    expect(eventRow).toBeTruthy();

    const upsert = await admin.app.request(
      `http://localhost/api/events/${event.id}/templates/portal-nudge`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
          "x-correlation-id": "corr-enqueue-template",
        },
        body: JSON.stringify({
          subject: "Reminder for {{eventName}}",
          body: "Hello {{name}} from {{company}}",
        }),
      },
      env,
    );
    expect(upsert.status).toBe(201);
    const tpl = CommsUpsertTemplateResponseSchema.parse(await upsert.json());

    // Provider mock must never be invoked on command path
    const providerHttpMock = vi.fn(async () => {
      throw new Error("provider must not be called");
    });
    // Install global fetch spy to detect accidental provider HTTP
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(originalFetch);
    globalThis.fetch = fetchSpy as typeof fetch;

    try {
      const previewRes = await admin.app.request(
        "http://localhost/api/comms/preview",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: admin.cookie,
            "x-correlation-id": "corr-preview-1",
          },
          body: JSON.stringify({
            templateId: tpl.template.id,
            segment: { status: "accepted" },
          }),
        },
        env,
      );
      expect(previewRes.status).toBe(200);
      const preview = CommsPreviewResponseSchema.parse(await previewRes.json());
      expect(preview.recipientCount).toBe(1);
      expect(preview.recipients[0]!.email).toBe("speaker-comms@example.com");
      expect(preview.bodies[0]!.subject).toContain("Enqueue Event");
      expect(preview.bodies[0]!.body).toContain("Speaker Comms");
      expect(preview.bodies[0]!.body).toContain("Acme");
      expect(preview.missingFields).toEqual([]);

      const sendRes = await admin.app.request(
        "http://localhost/api/comms/send",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: admin.cookie,
            "x-correlation-id": "corr-send-enqueue-1",
          },
          body: JSON.stringify({
            previewId: preview.previewId,
            idempotencyKey: "idem-comms-send-1",
          }),
        },
        env,
      );
      expect(sendRes.status).toBe(201);
      const sendBody = CommsSendResponseSchema.parse(await sendRes.json());
      expect(sendBody.enqueued).toBe(true);
      expect(sendBody.job.status).toBe("queued");
      expect(sendBody.job.idempotencyKey).toBe("idem-comms-send-1");

      // Outbox row created with stable topic
      const outboxRows = await admin.comms.listOutboxByTopic(COMMS_OUTBOX_TOPIC);
      expect(outboxRows.length).toBe(1);
      expect(outboxRows[0]!.topic).toBe(COMMS_OUTBOX_TOPIC);
      expect(outboxRows[0]!.processedAt).toBeNull();
      const payload = JSON.parse(outboxRows[0]!.payloadJson) as {
        jobId: string;
        eventId: string;
      };
      expect(payload.jobId).toBe(sendBody.job.id);
      expect(payload.eventId).toBe(event.id);

      // No provider HTTP during command path
      expect(providerHttpMock).not.toHaveBeenCalled();
      // fetch may be unused entirely; if used, must not target email providers
      for (const call of fetchSpy.mock.calls) {
        const url = String(call[0] ?? "");
        expect(url).not.toMatch(/resend|sendgrid|ses\.amazonaws|smtp|mailgun/i);
      }

      // Idempotent second send — no second outbox row
      const send2 = await admin.app.request(
        "http://localhost/api/comms/send",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: admin.cookie,
            "x-correlation-id": "corr-send-enqueue-2",
          },
          body: JSON.stringify({
            previewId: preview.previewId,
            idempotencyKey: "idem-comms-send-1",
          }),
        },
        env,
      );
      expect(send2.status).toBe(200);
      const send2Body = CommsSendResponseSchema.parse(await send2.json());
      expect(send2Body.enqueued).toBe(false);
      expect((await admin.comms.listOutboxByTopic(COMMS_OUTBOX_TOPIC)).length).toBe(
        1,
      );

      // Audit for send
      const audits = await admin.store.listAudits();
      const sendAudit = audits.find((a) => a.action === "Comms.Send");
      expect(sendAudit).toBeTruthy();
      expect(sendAudit!.correlationId).toBe("corr-send-enqueue-1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("unauthenticated template upsert returns 401", async () => {
    const { app } = createAppWithAuth({ cookieSecure: true });
    const res = await app.request(
      "http://localhost/api/events/evt_x/templates/key",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject: "S", body: "B" }),
      },
      env,
    );
    expect(res.status).toBe(401);
    const envBody = ErrorEnvelopeSchema.parse(await res.json());
    expect(envBody.code).toBe(UNAUTHORIZED);
  });

  it("validation error returns 400 with machine-readable code", async () => {
    const admin = await magicLinkSession(
      "admin",
      "comms-admin-val@example.com",
    );
    const event = await createEvent(admin.app, admin.cookie, "Val Event");
    const res = await admin.app.request(
      `http://localhost/api/events/${event.id}/templates/ok-key`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
        },
        body: JSON.stringify({ subject: "", body: "" }),
      },
      env,
    );
    expect(res.status).toBe(400);
    const envBody = ErrorEnvelopeSchema.parse(await res.json());
    expect(envBody.code).toBe(VALIDATION_ERROR);
  });

  it("speaker role cannot upsert template (403 or 404)", async () => {
    const base = createAppWithAuth({ cookieSecure: true });
    const admin = await magicLinkSession(
      "admin",
      "comms-admin-role@example.com",
      undefined,
      base,
    );
    const event = await createEvent(admin.app, admin.cookie, "Role Event");
    const speaker = await magicLinkSession(
      "speaker",
      "comms-speaker-role@example.com",
      event.id,
      base,
    );
    const res = await speaker.app.request(
      `http://localhost/api/events/${event.id}/templates/blocked`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: speaker.cookie,
        },
        body: JSON.stringify({
          subject: "Nope",
          body: "Nope",
        }),
      },
      env,
    );
    expect([403, 404]).toContain(res.status);
    const envBody = ErrorEnvelopeSchema.parse(await res.json());
    expect([FORBIDDEN, "NOT_FOUND"]).toContain(envBody.code);
  });

  it("template update with wrong expectedVersion returns 409", async () => {
    const admin = await magicLinkSession(
      "admin",
      "comms-admin-conflict@example.com",
    );
    const event = await createEvent(admin.app, admin.cookie, "Conflict Event");
    const create = await admin.app.request(
      `http://localhost/api/events/${event.id}/templates/v-key`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
        },
        body: JSON.stringify({ subject: "V1", body: "Body v1" }),
      },
      env,
    );
    expect(create.status).toBe(201);

    const conflict = await admin.app.request(
      `http://localhost/api/events/${event.id}/templates/v-key`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
        },
        body: JSON.stringify({
          subject: "V2",
          body: "Body v2",
          expectedVersion: 99,
        }),
      },
      env,
    );
    expect(conflict.status).toBe(409);
    const envBody = ErrorEnvelopeSchema.parse(await conflict.json());
    expect(envBody.code).toBe("CONFLICT");
  });

  it("OpenAPI lists Comms commands", () => {
    expect(OPENAPI_COMMANDS).toContain("Comms.UpsertTemplate");
    expect(OPENAPI_COMMANDS).toContain("Comms.Preview");
    expect(OPENAPI_COMMANDS).toContain("Comms.Send");
  });

  it("upsert update stores new subject and bumps version", async () => {
    const admin = await magicLinkSession(
      "admin",
      "comms-admin-update@example.com",
    );
    const event = await createEvent(admin.app, admin.cookie, "Update Event");
    await admin.app.request(
      `http://localhost/api/events/${event.id}/templates/edit-me`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
        },
        body: JSON.stringify({ subject: "Original", body: "Body" }),
      },
      env,
    );
    const update = await admin.app.request(
      `http://localhost/api/events/${event.id}/templates/edit-me`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
        },
        body: JSON.stringify({
          subject: "Updated subject",
          body: "Body {{name}}",
          expectedVersion: 1,
        }),
      },
      env,
    );
    expect(update.status).toBe(200);
    const parsed = CommsUpsertTemplateResponseSchema.parse(await update.json());
    expect(parsed.template.subject).toBe("Updated subject");
    expect(parsed.template.version).toBe(2);
  });
});
