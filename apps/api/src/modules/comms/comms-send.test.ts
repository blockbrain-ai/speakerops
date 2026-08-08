/**
 * Section 5.2 — Send idempotent ICS (Vitest).
 *
 * Named assertions from spec:
 * - assert send without previewId 400
 * - assert same idempotencyKey returns same job id
 * - assert ICS uid stable across sequence++ helper
 *
 * Plus: sandbox default, recipient materialization, outbox drain,
 * audit + correlationId, E4 envelopes.
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
} from "@speakerops/shared";
import { createAppWithAuth } from "../../index.js";
import { OPENAPI_COMMANDS } from "../../openapi.js";
import {
  stableIcsUid,
  bumpSequence,
  icsForPlacement,
  nextInviteState,
} from "./ics.js";
import {
  createEmailProvider,
  resolveEmailProviderMode,
  SandboxEmailProvider,
  hashSendRequest,
  commsSendIdempotencyStorageKey,
} from "./send.js";
import { processCommsOutbox } from "../../workers/emailConsumer.js";
import { icsForPlacementCommand } from "./commands.js";

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
  name = "Send ICS Event",
): Promise<{ id: string; slug: string }> {
  const res = await app.request(
    "http://localhost/api/events",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-correlation-id": "corr-create-for-send",
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

async function seedAcceptedSpeaker(
  admin: Awaited<ReturnType<typeof magicLinkSession>>,
  eventId: string,
  suffix: string,
) {
  const person = await admin.submissions.insertPerson({
    id: `person_send_${suffix}`,
    orgId: "org_dogfood",
    email: `speaker-send-${suffix}@example.com`,
    name: `Speaker ${suffix}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await admin.decisions.insertParticipation({
    id: `part_send_${suffix}`,
    eventId,
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
  return person;
}

async function upsertAndPreview(
  admin: Awaited<ReturnType<typeof magicLinkSession>>,
  eventId: string,
  key: string,
) {
  const upsert = await admin.app.request(
    `http://localhost/api/events/${eventId}/templates/${key}`,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: admin.cookie,
        "x-correlation-id": "corr-send-template",
      },
      body: JSON.stringify({
        subject: "Hello {{name}} — {{eventName}}",
        body: "Portal reminder for {{email}}",
      }),
    },
    env,
  );
  expect(upsert.status).toBe(201);
  const tpl = CommsUpsertTemplateResponseSchema.parse(await upsert.json());

  const previewRes = await admin.app.request(
    "http://localhost/api/comms/preview",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: admin.cookie,
        "x-correlation-id": "corr-send-preview",
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
  return { tpl, preview };
}

describe("5.2 Comms send idempotent + ICS", () => {
  it("assert send without previewId 400", async () => {
    const admin = await magicLinkSession(
      "admin",
      "comms-send-nopreview@example.com",
    );

    const res = await admin.app.request("http://localhost/api/comms/send", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: admin.cookie,
        "x-correlation-id": "corr-send-no-preview",
      },
      body: JSON.stringify({
        // previewId intentionally omitted — J08 preview required
        idempotencyKey: "idem-missing-preview",
      }),
    }, env);

    expect(res.status).toBe(400);
    const envBody = ErrorEnvelopeSchema.parse(await res.json());
    expect(envBody.code).toBe(VALIDATION_ERROR);

    // Empty previewId also 400
    const resEmpty = await admin.app.request(
      "http://localhost/api/comms/send",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
        },
        body: JSON.stringify({
          previewId: "",
          idempotencyKey: "idem-empty-preview",
        }),
      },
      env,
    );
    expect(resEmpty.status).toBe(400);
    expect(ErrorEnvelopeSchema.parse(await resEmpty.json()).code).toBe(
      VALIDATION_ERROR,
    );
  });

  it("assert same idempotencyKey returns same job id", async () => {
    const admin = await magicLinkSession(
      "admin",
      "comms-send-idem@example.com",
    );
    const event = await createEvent(admin.app, admin.cookie, "Idem Event");
    await seedAcceptedSpeaker(admin, event.id, "idem");
    const { preview } = await upsertAndPreview(admin, event.id, "idem-nudge");

    const key = "idem-stable-job-key-1";
    const send1 = await admin.app.request(
      "http://localhost/api/comms/send",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
          "x-correlation-id": "corr-send-idem-1",
        },
        body: JSON.stringify({
          previewId: preview.previewId,
          idempotencyKey: key,
        }),
      },
      env,
    );
    expect(send1.status).toBe(201);
    const body1 = CommsSendResponseSchema.parse(await send1.json());
    expect(body1.enqueued).toBe(true);
    expect(body1.job.idempotencyKey).toBe(key);
    expect(body1.job.status).toBe("queued");

    const send2 = await admin.app.request(
      "http://localhost/api/comms/send",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
          "x-correlation-id": "corr-send-idem-2",
        },
        body: JSON.stringify({
          previewId: preview.previewId,
          idempotencyKey: key,
        }),
      },
      env,
    );
    expect(send2.status).toBe(200);
    const body2 = CommsSendResponseSchema.parse(await send2.json());
    expect(body2.enqueued).toBe(false);
    // J04: same job id
    expect(body2.job.id).toBe(body1.job.id);

    // Single outbox row
    const outboxRows = await admin.comms.listOutboxByTopic(COMMS_OUTBOX_TOPIC);
    expect(outboxRows.length).toBe(1);

    // idempotency_keys row stored
    const storageKey = commsSendIdempotencyStorageKey(key);
    const idem = await admin.comms.findIdempotencyKey(storageKey);
    expect(idem).toBeTruthy();
    const expectedHash = await hashSendRequest({
      previewId: preview.previewId,
      idempotencyKey: key,
    });
    expect(idem!.requestHash).toBe(expectedHash);

    // message_recipients materialized with to_email (I16)
    const recipients = await admin.comms.listRecipientsForJob(body1.job.id);
    expect(recipients.length).toBe(1);
    expect(recipients[0]!.toEmail).toBe("speaker-send-idem@example.com");

    // Audit with correlationId
    const audits = await admin.store.listAudits();
    const sendAudit = audits.find((a) => a.action === "Comms.Send");
    expect(sendAudit).toBeTruthy();
    expect(sendAudit!.correlationId).toBe("corr-send-idem-1");
  });

  it("assert ICS uid stable across sequence++ helper", () => {
    const eventId = "evt_ics_1";
    const placementId = "plc_ics_1";
    const uid1 = stableIcsUid(eventId, placementId);
    const uid2 = stableIcsUid(eventId, placementId);
    expect(uid1).toBe(uid2);
    expect(uid1).toContain(eventId);
    expect(uid1).toContain(placementId);

    // SEQUENCE bump helper
    expect(bumpSequence(0)).toBe(1);
    expect(bumpSequence(1)).toBe(2);
    expect(bumpSequence(41)).toBe(42);
    expect(() => bumpSequence(-1)).toThrow();

    const placement = {
      eventId,
      placementId,
      summary: "Opening keynote",
      startsAt: "2026-06-01T10:00:00.000Z",
      endsAt: "2026-06-01T11:00:00.000Z",
      location: "Main Hall",
    };

    const first = icsForPlacement(null, placement);
    expect(first.uid).toBe(uid1);
    expect(first.sequence).toBe(0);
    expect(first.method).toBe("REQUEST");
    expect(first.icsBody).toContain(`UID:${uid1}`);
    expect(first.icsBody).toContain("SEQUENCE:0");
    expect(first.icsBody).toContain("METHOD:REQUEST");

    // Reschedule: same UID, sequence++
    const updated = nextInviteState(
      { uid: first.uid, sequence: first.sequence },
      {
        ...placement,
        startsAt: "2026-06-01T11:00:00.000Z",
        endsAt: "2026-06-01T12:00:00.000Z",
      },
    );
    expect(updated.uid).toBe(first.uid);
    expect(updated.sequence).toBe(1);
    expect(updated.method).toBe("REQUEST");
    expect(updated.icsBody).toContain(`UID:${first.uid}`);
    expect(updated.icsBody).toContain("SEQUENCE:1");

    const again = nextInviteState(
      { uid: updated.uid, sequence: updated.sequence },
      placement,
      { cancel: true },
    );
    expect(again.uid).toBe(first.uid);
    expect(again.sequence).toBe(2);
    expect(again.method).toBe("CANCEL");
    expect(again.icsBody).toContain("METHOD:CANCEL");
  });

  it("assert sandbox provider default (no Resend HTTP on drain)", async () => {
    expect(resolveEmailProviderMode({})).toBe("sandbox");
    expect(resolveEmailProviderMode({ EMAIL_PROVIDER: "sandbox" })).toBe(
      "sandbox",
    );
    // resend without key still sandbox
    expect(
      resolveEmailProviderMode({ EMAIL_PROVIDER: "resend" }),
    ).toBe("sandbox");
    expect(
      resolveEmailProviderMode({
        EMAIL_PROVIDER: "resend",
        RESEND_API_KEY: "re_test_key",
      }),
    ).toBe("resend");

    const provider = createEmailProvider({});
    expect(provider.name).toBe("sandbox");

    const admin = await magicLinkSession(
      "admin",
      "comms-send-sandbox@example.com",
    );
    const event = await createEvent(admin.app, admin.cookie, "Sandbox Event");
    await seedAcceptedSpeaker(admin, event.id, "sandbox");
    const { preview } = await upsertAndPreview(
      admin,
      event.id,
      "sandbox-nudge",
    );

    const sendRes = await admin.app.request(
      "http://localhost/api/comms/send",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
          "x-correlation-id": "corr-send-sandbox",
        },
        body: JSON.stringify({
          previewId: preview.previewId,
          idempotencyKey: "idem-sandbox-1",
        }),
      },
      env,
    );
    expect(sendRes.status).toBe(201);
    const sendBody = CommsSendResponseSchema.parse(await sendRes.json());

    const fetchSpy = vi.fn(async () => {
      throw new Error("provider HTTP must not be called in sandbox");
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as typeof fetch;

    try {
      const sandbox = new SandboxEmailProvider();
      const result = await processCommsOutbox({
        comms: admin.comms,
        auth: admin.store,
        provider: sandbox,
      });
      expect(result.processed).toBe(1);
      expect(result.jobIds).toContain(sendBody.job.id);
      expect(sandbox.sent.length).toBe(1);
      expect(sandbox.sent[0]!.to).toBe("speaker-send-sandbox@example.com");
      expect(fetchSpy).not.toHaveBeenCalled();

      const deliveries = await admin.comms.listDeliveryEventsForJob(
        sendBody.job.id,
      );
      expect(deliveries.length).toBe(1);
      expect(deliveries[0]!.provider).toBe("sandbox");
      expect(deliveries[0]!.status).toBe("sandbox");

      const job = await admin.comms.findJobById(sendBody.job.id);
      expect(job!.status).toBe("sent");

      const outbox = await admin.comms.listOutboxByTopic(COMMS_OUTBOX_TOPIC);
      expect(outbox[0]!.processedAt).not.toBeNull();

      // Re-drain is idempotent (skip already delivered)
      const again = await processCommsOutbox({
        comms: admin.comms,
        auth: admin.store,
        provider: sandbox,
      });
      expect(again.processed).toBe(0);
      expect(again.skipped + again.processed + again.failed).toBeGreaterThanOrEqual(
        0,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("Comms.IcsForPlacement persists stable uid and bumps sequence", async () => {
    const admin = await magicLinkSession(
      "admin",
      "comms-ics-cmd@example.com",
    );
    const event = await createEvent(admin.app, admin.cookie, "ICS Event");

    const placement = {
      eventId: event.id,
      placementId: "plc_fixture_1",
      summary: "Talk A",
      startsAt: "2026-06-01T14:00:00.000Z",
      endsAt: "2026-06-01T14:45:00.000Z",
      location: "Room 1",
    };

    const first = await icsForPlacementCommand(
      {
        comms: admin.comms,
        events: admin.events,
        auth: admin.store,
        submissions: admin.submissions,
        decisions: admin.decisions,
      },
      {
        placement,
        actorUserId: admin.userId,
        correlationId: "corr-ics-1",
      },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.invite.sequence).toBe(0);
    expect(first.value.invite.uid).toBe(
      stableIcsUid(event.id, "plc_fixture_1"),
    );

    const second = await icsForPlacementCommand(
      {
        comms: admin.comms,
        events: admin.events,
        auth: admin.store,
        submissions: admin.submissions,
        decisions: admin.decisions,
      },
      {
        placement: {
          ...placement,
          startsAt: "2026-06-01T15:00:00.000Z",
          endsAt: "2026-06-01T15:45:00.000Z",
        },
        actorUserId: admin.userId,
        correlationId: "corr-ics-2",
      },
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.invite.uid).toBe(first.value.invite.uid);
    expect(second.value.invite.sequence).toBe(1);

    const audits = await admin.store.listAudits();
    const icsAudits = audits.filter((a) => a.action === "Comms.IcsForPlacement");
    expect(icsAudits.length).toBe(2);
    expect(icsAudits[0]!.correlationId).toBe("corr-ics-1");
  });

  it("unauthenticated send returns 401", async () => {
    const { app } = createAppWithAuth({ cookieSecure: true });
    const res = await app.request("http://localhost/api/comms/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        previewId: "preview_x",
        idempotencyKey: "k",
      }),
    }, env);
    expect(res.status).toBe(401);
  });

  it("OpenAPI lists Comms.IcsForPlacement", () => {
    expect(OPENAPI_COMMANDS).toContain("Comms.IcsForPlacement");
    expect(OPENAPI_COMMANDS).toContain("Comms.Send");
  });

  it("assert multi-recipient crash recovery sends remaining recipients", async () => {
    const admin = await magicLinkSession(
      "admin",
      "comms-send-partial@example.com",
    );
    const event = await createEvent(admin.app, admin.cookie, "Partial Drain");
    await seedAcceptedSpeaker(admin, event.id, "partial-a");
    await seedAcceptedSpeaker(admin, event.id, "partial-b");
    const { preview } = await upsertAndPreview(
      admin,
      event.id,
      "partial-nudge",
    );
    expect(preview.recipientCount).toBe(2);

    const sendRes = await admin.app.request(
      "http://localhost/api/comms/send",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
          "x-correlation-id": "corr-send-partial",
        },
        body: JSON.stringify({
          previewId: preview.previewId,
          idempotencyKey: "idem-partial-1",
        }),
      },
      env,
    );
    expect(sendRes.status).toBe(201);
    const sendBody = CommsSendResponseSchema.parse(await sendRes.json());

    // Simulate crash after first recipient: insert one delivery, leave outbox open.
    const recipients = await admin.comms.listRecipientsForJob(sendBody.job.id);
    expect(recipients.length).toBe(2);
    const first = recipients[0]!;
    await admin.comms.insertDeliveryEvent({
      id: "dev_partial_1",
      jobId: sendBody.job.id,
      recipientId: first.id,
      eventId: event.id,
      provider: "sandbox",
      providerMessageId: "sandbox-partial-1",
      status: "sandbox",
      attempt: 1,
      error: null,
      payloadJson: null,
      createdAt: new Date().toISOString(),
    });
    await admin.comms.updateRecipientStatus(first.id, "sandbox");

    const sandbox = new SandboxEmailProvider();
    const result = await processCommsOutbox({
      comms: admin.comms,
      auth: admin.store,
      provider: sandbox,
    });
    // Resume must send only the remaining recipient, not skip the job.
    expect(sandbox.sent.length).toBe(1);
    expect(sandbox.sent[0]!.recipientId).toBe(recipients[1]!.id);
    expect(result.processed + result.failed + result.skipped).toBeGreaterThan(0);

    const deliveries = await admin.comms.listDeliveryEventsForJob(
      sendBody.job.id,
    );
    expect(deliveries.length).toBe(2);
    const job = await admin.comms.findJobById(sendBody.job.id);
    expect(job!.status).toBe("sent");
    const outbox = await admin.comms.listOutboxByTopic(COMMS_OUTBOX_TOPIC);
    expect(outbox[0]!.processedAt).not.toBeNull();
  });

  it("assert concurrent outbox drains do not double-send a recipient", async () => {
    const admin = await magicLinkSession(
      "admin",
      "comms-send-concurrent@example.com",
    );
    const event = await createEvent(admin.app, admin.cookie, "Concurrent Drain");
    await seedAcceptedSpeaker(admin, event.id, "concurrent");
    const { preview } = await upsertAndPreview(
      admin,
      event.id,
      "concurrent-nudge",
    );

    const sendRes = await admin.app.request(
      "http://localhost/api/comms/send",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
          "x-correlation-id": "corr-send-concurrent",
        },
        body: JSON.stringify({
          previewId: preview.previewId,
          idempotencyKey: "idem-concurrent-1",
        }),
      },
      env,
    );
    expect(sendRes.status).toBe(201);
    const sendBody = CommsSendResponseSchema.parse(await sendRes.json());

    // Shared provider so both drains record into the same send log.
    const sandbox = new SandboxEmailProvider();
    const [a, b] = await Promise.all([
      processCommsOutbox({
        comms: admin.comms,
        auth: admin.store,
        provider: sandbox,
      }),
      processCommsOutbox({
        comms: admin.comms,
        auth: admin.store,
        provider: sandbox,
      }),
    ]);

    // At-most-once: concurrent queue + cron style drains must not double-send.
    expect(a.processed + b.processed).toBeLessThanOrEqual(1);
    expect(sandbox.sent.length).toBe(1);
    expect(sandbox.sent[0]!.to).toBe(
      "speaker-send-concurrent@example.com",
    );

    const deliveries = await admin.comms.listDeliveryEventsForJob(
      sendBody.job.id,
    );
    expect(deliveries.length).toBe(1);
  });

  it("assert invalid ICS startsAt returns 400 VALIDATION_ERROR not 500", async () => {
    const admin = await magicLinkSession(
      "admin",
      "comms-ics-bad-date@example.com",
    );
    const event = await createEvent(admin.app, admin.cookie, "ICS Bad Date");

    const bad = await admin.app.request(
      `http://localhost/api/events/${event.id}/comms/ics`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
        },
        body: JSON.stringify({
          placementId: "plc_bad",
          summary: "Talk",
          startsAt: "not-a-date",
          endsAt: "2026-06-01T11:00:00.000Z",
        }),
      },
      env,
    );
    expect(bad.status).toBe(400);
    const envBody = ErrorEnvelopeSchema.parse(await bad.json());
    expect(envBody.code).toBe(VALIDATION_ERROR);

    const order = await admin.app.request(
      `http://localhost/api/events/${event.id}/comms/ics`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
        },
        body: JSON.stringify({
          placementId: "plc_order",
          summary: "Talk",
          startsAt: "2026-06-01T12:00:00.000Z",
          endsAt: "2026-06-01T11:00:00.000Z",
        }),
      },
      env,
    );
    expect(order.status).toBe(400);
    const orderBody = ErrorEnvelopeSchema.parse(await order.json());
    expect(orderBody.code).toBe(VALIDATION_ERROR);
  });

  it("production Worker export registers queue and scheduled drains", async () => {
    const worker = (await import("../../index.js")).default;
    expect(typeof worker.fetch).toBe("function");
    expect(typeof worker.queue).toBe("function");
    expect(typeof worker.scheduled).toBe("function");
  });

  it("concurrent different-key send: loser 409 without orphan side effects", async () => {
    // Two senders race the same preview with different idempotency keys.
    // Winner enqueues; loser must not leave orphan recipients / outbox / audit.
    const admin = await magicLinkSession(
      "admin",
      "comms-send-race@example.com",
    );
    const event = await createEvent(admin.app, admin.cookie, "Race Event");
    await seedAcceptedSpeaker(admin, event.id, "race");
    const { preview } = await upsertAndPreview(admin, event.id, "race-nudge");

    const [a, b] = await Promise.all([
      admin.app.request(
        "http://localhost/api/comms/send",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: admin.cookie,
            "x-correlation-id": "corr-send-race-a",
          },
          body: JSON.stringify({
            previewId: preview.previewId,
            idempotencyKey: "idem-race-a",
          }),
        },
        env,
      ),
      admin.app.request(
        "http://localhost/api/comms/send",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: admin.cookie,
            "x-correlation-id": "corr-send-race-b",
          },
          body: JSON.stringify({
            previewId: preview.previewId,
            idempotencyKey: "idem-race-b",
          }),
        },
        env,
      ),
    ]);

    const statuses = [a.status, b.status].sort((x, y) => x - y);
    // One winner (201). Loser is either version conflict (409) or already-queued
    // (400 VALIDATION) depending on whether it re-read after the winner.
    expect(statuses[0]).toBe(201);
    expect([400, 409]).toContain(statuses[1]);

    const winner = a.status === 201 ? a : b;
    const winnerBody = CommsSendResponseSchema.parse(await winner.json());

    const recipients = await admin.comms.listRecipientsForJob(winnerBody.job.id);
    expect(recipients.length).toBe(1);

    const outboxRows = await admin.comms.listOutboxByTopic(COMMS_OUTBOX_TOPIC);
    expect(outboxRows.length).toBe(1);

    const audits = (await admin.store.listAudits()).filter(
      (row) => row.action === "Comms.Send" && row.entityId === winnerBody.job.id,
    );
    expect(audits.length).toBe(1);

    // Only the winner's idempotency key is stored for this send.
    const keyA = await admin.comms.findIdempotencyKey(
      commsSendIdempotencyStorageKey("idem-race-a"),
    );
    const keyB = await admin.comms.findIdempotencyKey(
      commsSendIdempotencyStorageKey("idem-race-b"),
    );
    expect(Boolean(keyA) !== Boolean(keyB)).toBe(true);
  });

  it("D1 enqueueSendAtomic gates inserts on transition-unique job fields", async () => {
    // Source contract: jobWon must not be version-alone (shared N+1 after a
    // concurrent win). Keep single-batch atomicity + transition-unique gate.
    // Losers return null (not winner row); batch errors validate requestHash;
    // transition stamp is restored to canonical ISO updatedAt in-batch.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "store.ts"), "utf8");
    const d1Method = src.slice(src.indexOf("class D1CommsStore"));
    const enqueue = d1Method.slice(
      d1Method.indexOf("async enqueueSendAtomic"),
      d1Method.indexOf("function mapInvite"),
    );
    expect(enqueue).toContain("this.db.batch");
    expect(enqueue).toContain("idempotencyKey");
    expect(enqueue).toContain("transitionStamp");
    expect(enqueue).toContain("transitionToken");
    expect(enqueue).toMatch(/eq\(\s*messageJobs\.idempotencyKey/);
    expect(enqueue).toMatch(/eq\(\s*messageJobs\.updatedAt/);
    expect(enqueue).toMatch(/eq\(\s*messageJobs\.version/);
    expect(enqueue).toContain("restoreUpdatedAt");
    expect(enqueue).toContain("input.updatedAt");
    expect(enqueue).toContain("reconcileEnqueueBatchError");
    expect(enqueue).toContain("requestHash");
    expect(enqueue).toContain("IdempotencyKeyConflictError");
    // Lost CAS / same-key replay must return null (not the winner's row).
    expect(enqueue).toMatch(
      /d1Changes\(results\[0\]\)\s*===\s*0[\s\S]*?return null/,
    );
    // Must not reintroduce claim-then-separate-insert (E7 orphan risk).
    expect(enqueue).not.toMatch(/claimResult/);
  });

  it("assert send stores ISO updatedAt without transition-token marker", async () => {
    const admin = await magicLinkSession(
      "admin",
      "comms-send-updated-at@example.com",
    );
    const event = await createEvent(admin.app, admin.cookie, "UpdatedAt Event");
    await seedAcceptedSpeaker(admin, event.id, "upd");
    const { preview } = await upsertAndPreview(admin, event.id, "upd-nudge");

    const sendRes = await admin.app.request(
      "http://localhost/api/comms/send",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
          "x-correlation-id": "corr-send-updated-at",
        },
        body: JSON.stringify({
          previewId: preview.previewId,
          idempotencyKey: "idem-updated-at-1",
        }),
      },
      env,
    );
    expect(sendRes.status).toBe(201);
    const body = CommsSendResponseSchema.parse(await sendRes.json());
    // Public DTO must be canonical ISO-8601, not '<ISO>#<token>'.
    expect(body.job.updatedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    expect(body.job.updatedAt).not.toContain("#");

    const stored = await admin.comms.findJobById(body.job.id);
    expect(stored).toBeTruthy();
    expect(stored!.updatedAt).toBe(body.job.updatedAt);
    expect(stored!.updatedAt).not.toContain("#");
  });

  it("assert idempotency key reused with different previewId returns 409", async () => {
    const admin = await magicLinkSession(
      "admin",
      "comms-send-hash-conflict@example.com",
    );
    const event = await createEvent(admin.app, admin.cookie, "Hash Conflict");
    await seedAcceptedSpeaker(admin, event.id, "hash");
    const a = await upsertAndPreview(admin, event.id, "hash-a");
    const b = await upsertAndPreview(admin, event.id, "hash-b");

    const key = "idem-hash-conflict-1";
    const send1 = await admin.app.request(
      "http://localhost/api/comms/send",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
          "x-correlation-id": "corr-hash-1",
        },
        body: JSON.stringify({
          previewId: a.preview.previewId,
          idempotencyKey: key,
        }),
      },
      env,
    );
    expect(send1.status).toBe(201);

    const send2 = await admin.app.request(
      "http://localhost/api/comms/send",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
          "x-correlation-id": "corr-hash-2",
        },
        body: JSON.stringify({
          previewId: b.preview.previewId,
          idempotencyKey: key,
        }),
      },
      env,
    );
    expect(send2.status).toBe(409);
    const errBody = (await send2.json()) as { code?: string; error?: string };
    expect(errBody.code).toBe("CONFLICT");
    expect(errBody.error).toMatch(/idempotency key reused/i);
  });

  it("concurrent same-key different-preview: one 201 one 409, single outbox (memory parity)", async () => {
    // Memory + D1 must share the contract: two preview jobs racing the same
    // idempotency key cannot both enqueue (J04 + requestHash conflict).
    const admin = await magicLinkSession(
      "admin",
      "comms-send-concurrent-hash@example.com",
    );
    const event = await createEvent(
      admin.app,
      admin.cookie,
      "Concurrent Hash Conflict",
    );
    await seedAcceptedSpeaker(admin, event.id, "conhash");
    const a = await upsertAndPreview(admin, event.id, "conhash-a");
    const b = await upsertAndPreview(admin, event.id, "conhash-b");

    const key = "idem-concurrent-hash-1";
    const [resA, resB] = await Promise.all([
      admin.app.request(
        "http://localhost/api/comms/send",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: admin.cookie,
            "x-correlation-id": "corr-conhash-a",
          },
          body: JSON.stringify({
            previewId: a.preview.previewId,
            idempotencyKey: key,
          }),
        },
        env,
      ),
      admin.app.request(
        "http://localhost/api/comms/send",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: admin.cookie,
            "x-correlation-id": "corr-conhash-b",
          },
          body: JSON.stringify({
            previewId: b.preview.previewId,
            idempotencyKey: key,
          }),
        },
        env,
      ),
    ]);

    const statuses = [resA.status, resB.status].sort((x, y) => x - y);
    expect(statuses).toEqual([201, 409]);

    const winner = resA.status === 201 ? resA : resB;
    const loser = resA.status === 409 ? resA : resB;
    const winnerBody = CommsSendResponseSchema.parse(await winner.json());
    expect(winnerBody.enqueued).toBe(true);

    const loserBody = (await loser.json()) as { code?: string; error?: string };
    expect(loserBody.code).toBe("CONFLICT");
    expect(loserBody.error).toMatch(/idempotency key reused/i);

    // Exactly one outbox event and one idempotency_keys row for this key.
    const outboxRows = await admin.comms.listOutboxByTopic(COMMS_OUTBOX_TOPIC);
    expect(outboxRows.length).toBe(1);
    const payload = JSON.parse(outboxRows[0]!.payloadJson) as {
      jobId: string;
      idempotencyKey: string;
    };
    expect(payload.jobId).toBe(winnerBody.job.id);
    expect(payload.idempotencyKey).toBe(key);

    const idem = await admin.comms.findIdempotencyKey(
      commsSendIdempotencyStorageKey(key),
    );
    expect(idem).toBeTruthy();
    const expectedHash = await hashSendRequest({
      previewId: winnerBody.job.id,
      idempotencyKey: key,
    });
    expect(idem!.requestHash).toBe(expectedHash);

    // Loser preview must remain unqueued (no silent overwrite / dual enqueue).
    const loserPreviewId =
      winnerBody.job.id === a.preview.previewId
        ? b.preview.previewId
        : a.preview.previewId;
    const loserJob = await admin.comms.findJobById(loserPreviewId);
    expect(loserJob).toBeTruthy();
    expect(loserJob!.status).toBe("preview");
    expect(loserJob!.idempotencyKey).toBeNull();
  });

  it("concurrent same-key same-preview: one enqueued, one replay, single outbox", async () => {
    const admin = await magicLinkSession(
      "admin",
      "comms-send-concurrent-same@example.com",
    );
    const event = await createEvent(
      admin.app,
      admin.cookie,
      "Concurrent Same Key",
    );
    await seedAcceptedSpeaker(admin, event.id, "consame");
    const { preview } = await upsertAndPreview(
      admin,
      event.id,
      "consame-nudge",
    );

    const key = "idem-concurrent-same-1";
    const [resA, resB] = await Promise.all([
      admin.app.request(
        "http://localhost/api/comms/send",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: admin.cookie,
            "x-correlation-id": "corr-consame-a",
          },
          body: JSON.stringify({
            previewId: preview.previewId,
            idempotencyKey: key,
          }),
        },
        env,
      ),
      admin.app.request(
        "http://localhost/api/comms/send",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: admin.cookie,
            "x-correlation-id": "corr-consame-b",
          },
          body: JSON.stringify({
            previewId: preview.previewId,
            idempotencyKey: key,
          }),
        },
        env,
      ),
    ]);

    const statuses = [resA.status, resB.status].sort((x, y) => x - y);
    // Winner 201; loser 200 replay (enqueued:false) — not a second enqueue.
    expect(statuses).toEqual([200, 201]);

    const bodyA = CommsSendResponseSchema.parse(await resA.json());
    const bodyB = CommsSendResponseSchema.parse(await resB.json());
    expect(bodyA.job.id).toBe(bodyB.job.id);
    expect(bodyA.job.id).toBe(preview.previewId);
    expect([bodyA.enqueued, bodyB.enqueued].filter(Boolean).length).toBe(1);

    const outboxRows = await admin.comms.listOutboxByTopic(COMMS_OUTBOX_TOPIC);
    expect(outboxRows.length).toBe(1);
  });

  it("MemoryCommsStore.enqueueSendAtomic enforces key/requestHash atomic winner", async () => {
    // Direct store-level contract (local/E2E runtime path).
    const { MemoryCommsStore, IdempotencyKeyConflictError } = await import(
      "./store.js"
    );
    const store = new MemoryCommsStore();
    const now = new Date().toISOString();

    const jobA = await store.insertJob({
      id: "job_mem_a",
      eventId: "evt_mem",
      templateId: "tpl_mem",
      status: "preview",
      segmentJson: "{}",
      recipientsJson: "[]",
      bodiesJson: "[]",
      missingFieldsJson: null,
      idempotencyKey: null,
      createdBy: "user_mem",
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    const jobB = await store.insertJob({
      id: "job_mem_b",
      eventId: "evt_mem",
      templateId: "tpl_mem",
      status: "preview",
      segmentJson: "{}",
      recipientsJson: "[]",
      bodiesJson: "[]",
      missingFieldsJson: null,
      idempotencyKey: null,
      createdBy: "user_mem",
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    const storageKey = "comms.send:idem-mem-race";
    const base = {
      status: "queued",
      idempotencyKey: "idem-mem-race",
      version: 2,
      expectedVersion: 1,
      updatedAt: now,
      recipients: [] as never[],
      outbox: {
        id: "out_a",
        topic: COMMS_OUTBOX_TOPIC,
        payloadJson: "{}",
        createdAt: now,
        processedAt: null,
        attempts: 0,
        lastError: null,
      },
      audit: {
        id: "aud_a",
        eventId: "evt_mem",
        actorType: "user" as const,
        actorId: "user_mem",
        action: "Comms.Send",
        entityType: "message_job",
        entityId: jobA.id,
        beforeJson: null,
        afterJson: null,
        correlationId: "corr-mem-a",
        createdAt: now,
      },
    };

    const [r1, r2] = await Promise.all([
      store.enqueueSendAtomic({
        ...base,
        jobId: jobA.id,
        outbox: { ...base.outbox, id: "out_a" },
        idempotency: {
          id: "idem_row_a",
          key: storageKey,
          requestHash: "hash-preview-a",
          responseJson: "{}",
          createdAt: now,
        },
        audit: { ...base.audit, entityId: jobA.id, id: "aud_a" },
      }),
      store.enqueueSendAtomic({
        ...base,
        jobId: jobB.id,
        outbox: { ...base.outbox, id: "out_b" },
        idempotency: {
          id: "idem_row_b",
          key: storageKey,
          requestHash: "hash-preview-b",
          responseJson: "{}",
          createdAt: now,
        },
        audit: { ...base.audit, entityId: jobB.id, id: "aud_b" },
      }).catch((e: unknown) => e),
    ]);

    // One winner MessageJobRow; other throws IdempotencyKeyConflictError.
    const results = [r1, r2];
    const winner = results.find(
      (r) => r && typeof r === "object" && "id" in r && !("code" in r),
    ) as { id: string } | undefined;
    const conflict = results.find(
      (r) => r instanceof IdempotencyKeyConflictError,
    );
    expect(winner).toBeTruthy();
    expect(conflict).toBeInstanceOf(IdempotencyKeyConflictError);

    const outbox = await store.listOutboxByTopic(COMMS_OUTBOX_TOPIC);
    expect(outbox.length).toBe(1);

    const idem = await store.findIdempotencyKey(storageKey);
    expect(idem).toBeTruthy();
    // Stored hash belongs to the winner only (no silent overwrite).
    expect(["hash-preview-a", "hash-preview-b"]).toContain(idem!.requestHash);

    const otherId = winner!.id === jobA.id ? jobB.id : jobA.id;
    const other = await store.findJobById(otherId);
    expect(other!.status).toBe("preview");
    expect(other!.idempotencyKey).toBeNull();
  });
});
