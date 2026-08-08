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
});
