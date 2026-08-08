/**
 * Section 7.3 — Airtable one-way projection (Vitest).
 *
 * Named assertions from spec:
 * - assert mutation 200 when AIRTABLE_API_KEY unset and outbox pending
 * - assert upsert uses internal_id
 * - assert status endpoint returns lag fields
 *
 * S-AIRTABLE: pause survival; no request-path Airtable; O06 status API.
 */
import { describe, it, expect } from "vitest";
import {
  ErrorEnvelopeSchema,
  ReportsAirtableStatusResponseSchema,
  SESSION_COOKIE_NAME,
  AIRTABLE_OUTBOX_TOPIC,
  AIRTABLE_PROJECTION_SYSTEM,
  EventResponseSchema,
  UNAUTHORIZED,
  FORBIDDEN,
  NOT_FOUND,
} from "@speakerops/shared";
import { createAppWithAuth } from "../../index.js";
import { OPENAPI_COMMANDS } from "../../openapi.js";
import { processAirtableOutbox } from "../../workers/airtableConsumer.js";
import {
  SandboxAirtableClient,
  PausedAirtableClient,
  RateLimitedError,
  resolveAirtableConfigured,
  createAirtableClient,
} from "./client.js";
import { MemoryAirtableStore } from "./store.js";
import { enqueueAirtableProjection } from "./enqueue.js";

const env = { APP_VERSION: "0.1.0" };

async function magicLinkSession(
  purpose: "admin" | "speaker" | "evaluator",
  email: string,
) {
  const ctx = createAppWithAuth({ cookieSecure: true });
  const { app, store, airtable, outbox, events } = ctx;
  const body: Record<string, string> = { email, purpose };

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
    airtable,
    events,
    outbox,
    cookie: `${SESSION_COOKIE_NAME}=${sessionValue}`,
    userId: user!.id,
    ctx,
  };
}

async function createEventViaApi(
  app: ReturnType<typeof createAppWithAuth>["app"],
  cookie: string,
  name = "Airtable Test Event",
) {
  const res = await app.request(
    "http://localhost/api/events",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-correlation-id": "corr-airtable-create",
      },
      body: JSON.stringify({
        name,
        timezone: "America/New_York",
      }),
    },
    env,
  );
  expect(res.status).toBe(201);
  return EventResponseSchema.parse(await res.json());
}

describe("7.3 Airtable one-way projection", () => {
  it("assert mutation 200 when AIRTABLE_API_KEY unset and outbox pending", async () => {
    // No AIRTABLE_API_KEY in env — request path must still succeed (S-AIRTABLE).
    expect(resolveAirtableConfigured({})).toBe(false);

    const { app, cookie, airtable, store } = await magicLinkSession(
      "admin",
      "airtable-pause@example.com",
    );

    const created = await createEventViaApi(app, cookie);
    const eventId = created.event.id;

    // Outbox pending for airtable.project
    const pending = await airtable.listUnprocessedAirtableForEvent(eventId);
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(pending[0]!.topic).toBe(AIRTABLE_OUTBOX_TOPIC);
    expect(pending[0]!.processedAt).toBeNull();

    const payload = JSON.parse(pending[0]!.payloadJson) as {
      internalId: string;
      entityType: string;
      eventId: string;
    };
    expect(payload.internalId).toBe(eventId);
    expect(payload.entityType).toBe("event");
    expect(payload.eventId).toBe(eventId);

    // Consumer pauses without crash; outbox stays pending
    const drain = await processAirtableOutbox({
      airtable,
      auth: store,
      clientEnv: {}, // unset key
    });
    expect(drain.paused).toBe(true);
    expect(drain.processed).toBe(0);

    const stillPending = await airtable.listUnprocessedAirtableForEvent(eventId);
    expect(stillPending.length).toBe(pending.length);

    // Further mutation still 200 with outbox growing
    const patch = await app.request(
      `http://localhost/api/events/${encodeURIComponent(eventId)}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-airtable-update",
        },
        body: JSON.stringify({
          name: "Updated While Paused",
          expectedVersion: created.event.version,
        }),
      },
      env,
    );
    expect(patch.status).toBe(200);

    const afterUpdate = await airtable.listUnprocessedAirtableForEvent(eventId);
    expect(afterUpdate.length).toBeGreaterThan(pending.length);

    // Consequential write audit with correlationId (Event.Create + Event.Update)
    const audits = await store.listAudits();
    const eventAudits = audits.filter(
      (a) =>
        a.eventId === eventId &&
        (a.action === "Event.Create" || a.action === "Event.Update"),
    );
    expect(eventAudits.length).toBeGreaterThanOrEqual(2);
    expect(
      eventAudits.every(
        (a) => typeof a.correlationId === "string" && a.correlationId.length > 0,
      ),
    ).toBe(true);
  });

  it("assert upsert uses internal_id", async () => {
    const store = new MemoryAirtableStore();
    const sandbox = new SandboxAirtableClient();
    const auth = (await magicLinkSession("admin", "airtable-upsert@example.com"))
      .store;

    const eventId = "evt_upsert_1";
    const internalId = "sub_internal_abc";

    await enqueueAirtableProjection(store, {
      eventId,
      entityType: "submission",
      internalId,
      sourceVersion: 2,
      fields: { title: "Talk Title" },
      correlationId: "corr-upsert-1",
    });

    const drain = await processAirtableOutbox({
      airtable: store,
      auth,
      client: sandbox,
    });
    expect(drain.paused).toBe(false);
    expect(drain.processed).toBe(1);

    // Sandbox recorded upsert with internal_id field
    expect(sandbox.upserts.length).toBe(1);
    expect(sandbox.upserts[0]!.internalId).toBe(internalId);
    expect(sandbox.upserts[0]!.fields.internal_id).toBe(internalId);
    expect(sandbox.upserts[0]!.fields.title).toBe("Talk Title");

    // projection_records keyed by internal_id
    const rec = await store.findProjection(
      AIRTABLE_PROJECTION_SYSTEM,
      "submission",
      internalId,
    );
    expect(rec).toBeTruthy();
    expect(rec!.internalId).toBe(internalId);
    expect(rec!.externalId).toBeTruthy();
    expect(rec!.sourceVersion).toBe(2);

    // Second upsert same internal_id updates (idempotent)
    await enqueueAirtableProjection(store, {
      eventId,
      entityType: "submission",
      internalId,
      sourceVersion: 3,
      fields: { title: "Talk Title v2" },
      correlationId: "corr-upsert-2",
    });
    const drain2 = await processAirtableOutbox({
      airtable: store,
      auth,
      client: sandbox,
    });
    expect(drain2.processed).toBe(1);
    expect(sandbox.upserts.length).toBe(1); // same internal_id
    expect(sandbox.upserts[0]!.fields.title).toBe("Talk Title v2");
    const rec2 = await store.findProjection(
      AIRTABLE_PROJECTION_SYSTEM,
      "submission",
      internalId,
    );
    expect(rec2!.sourceVersion).toBe(3);
    expect(rec2!.id).toBe(rec!.id);
  });

  it("assert status endpoint returns lag fields", async () => {
    const { app, cookie, airtable } = await magicLinkSession(
      "admin",
      "airtable-status@example.com",
    );
    const created = await createEventViaApi(app, cookie, "Status Lag Event");
    const eventId = created.event.id;

    // Ensure pending outbox (key unset → paused)
    const pending = await airtable.listUnprocessedAirtableForEvent(eventId);
    expect(pending.length).toBeGreaterThanOrEqual(1);

    const res = await app.request(
      `http://localhost/api/events/${encodeURIComponent(eventId)}/airtable/status`,
      {
        headers: {
          cookie,
          accept: "application/json",
          "x-correlation-id": "corr-status-1",
        },
      },
      // Unset Airtable env → configured false, paused true
      env,
    );
    expect(res.status).toBe(200);
    const body = ReportsAirtableStatusResponseSchema.parse(await res.json());
    expect(body.eventId).toBe(eventId);
    expect(body.configured).toBe(false);
    expect(body.paused).toBe(true);
    expect(body.lag.pendingCount).toBeGreaterThanOrEqual(1);
    expect(body.lag.oldestPendingAt).toBeTruthy();
    expect(typeof body.lag.maxAttempts).toBe("number");
    expect(body.generatedAt).toBeTruthy();
    expect(Array.isArray(body.recentErrors)).toBe(true);
  });

  it("status is Zod-validated E4 on missing event", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "airtable-404@example.com",
    );
    const res = await app.request(
      "http://localhost/api/events/does-not-exist/airtable/status",
      { headers: { cookie } },
      env,
    );
    expect(res.status).toBe(404);
    const envBody = ErrorEnvelopeSchema.parse(await res.json());
    expect(envBody.code).toBe(NOT_FOUND);
  });

  it("status unauthenticated 401", async () => {
    const { app } = await magicLinkSession("admin", "airtable-401@example.com");
    const res = await app.request(
      "http://localhost/api/events/any/airtable/status",
      {},
      env,
    );
    expect(res.status).toBe(401);
    const envBody = ErrorEnvelopeSchema.parse(await res.json());
    expect(envBody.code).toBe(UNAUTHORIZED);
  });

  it("status wrong role 403", async () => {
    const admin = await magicLinkSession("admin", "airtable-role-admin@example.com");
    const created = await createEventViaApi(admin.app, admin.cookie);
    const eventId = created.event.id;

    // Speaker membership on same event
    const speaker = await magicLinkSession(
      "speaker",
      "airtable-role-speaker@example.com",
    );
    await admin.store.upsertMembership({
      eventId,
      userId: speaker.userId,
      role: "speaker",
    });

    const res = await speaker.app.request(
      `http://localhost/api/events/${encodeURIComponent(eventId)}/airtable/status`,
      { headers: { cookie: speaker.cookie } },
      env,
    );
    // Cross-store: speaker session is different app instance — membership on admin store only
    // Use same app with speaker cookie after membership on shared store
    const shared = createAppWithAuth({ cookieSecure: true });
    // simpler: wrong role on admin-created event in same app
    const sEmail = "airtable-speaker-same@example.com";
    await admin.app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: sEmail, purpose: "speaker" }),
      },
      env,
    );
    const sToken = admin.outbox.lastForEmail(sEmail)!.token;
    // Seed membership before exchange if needed
    const sUser = await admin.store.findUserByEmail(sEmail);
    // purpose speaker creates user on exchange
    const sEx = await admin.app.request(
      "http://localhost/api/auth/exchange",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: sToken }),
      },
      env,
    );
    expect(sEx.status).toBe(200);
    const sCookie = sEx.headers.get("set-cookie")!;
    const sVal = sCookie.split(";")[0]!.split("=").slice(1).join("=");
    const speakerUser = await admin.store.findUserByEmail(sEmail);
    await admin.store.upsertMembership({
      eventId,
      userId: speakerUser!.id,
      role: "speaker",
    });

    const denied = await admin.app.request(
      `http://localhost/api/events/${encodeURIComponent(eventId)}/airtable/status`,
      {
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${sVal}`,
        },
      },
      env,
    );
    expect([403, 404]).toContain(denied.status);
    const envBody = ErrorEnvelopeSchema.parse(await denied.json());
    expect([FORBIDDEN, NOT_FOUND]).toContain(envBody.code);
    void sUser;
    void res;
    void shared;
  });

  it("OpenAPI lists Reports.AirtableStatus", () => {
    expect(OPENAPI_COMMANDS).toContain("Reports.AirtableStatus");
  });

  it("429 does not drop outbox row", async () => {
    const store = new MemoryAirtableStore();
    const auth = (await magicLinkSession("admin", "airtable-429@example.com"))
      .store;

    await enqueueAirtableProjection(store, {
      eventId: "evt_429",
      entityType: "session",
      internalId: "sess_429",
      fields: { title: "Session" },
      correlationId: "corr-429",
    });

    const rateLimitedClient = {
      name: "airtable" as const,
      configured: true,
      paused: false,
      async upsert() {
        throw new RateLimitedError();
      },
    };

    const drain = await processAirtableOutbox({
      airtable: store,
      auth,
      client: rateLimitedClient,
    });
    expect(drain.failed).toBe(1);
    expect(drain.processed).toBe(0);

    const pending = await store.listUnprocessedOutboxByTopic(
      AIRTABLE_OUTBOX_TOPIC,
    );
    // markOutboxError leaves processedAt null — still unprocessed
    // but claim may have been replaced with rate_limited_429
    const rows = await store.listOutboxByTopic(AIRTABLE_OUTBOX_TOPIC);
    expect(rows[0]!.processedAt).toBeNull();
    expect(rows[0]!.lastError).toBe("rate_limited_429");
    void pending;
  });

  it("claimOutboxForProcessing is exclusive (second concurrent claim loses)", async () => {
    const store = new MemoryAirtableStore();
    await enqueueAirtableProjection(store, {
      eventId: "evt_claim",
      entityType: "event",
      internalId: "evt_claim",
      fields: { name: "Claim Race" },
      correlationId: "corr-claim",
    });
    const rows = await store.listUnprocessedOutboxByTopic(AIRTABLE_OUTBOX_TOPIC);
    expect(rows).toHaveLength(1);
    const id = rows[0]!.id;
    const until = new Date(Date.now() + 60_000).toISOString();

    const first = await store.claimOutboxForProcessing(id, {
      claimToken: "token-a",
      claimedUntil: until,
      attempts: 1,
    });
    expect(first).toBeTruthy();
    expect(first!.lastError).toContain("token-a");

    // Active claim must block a second drain
    const second = await store.claimOutboxForProcessing(id, {
      claimToken: "token-b",
      claimedUntil: until,
      attempts: 1,
    });
    expect(second).toBeNull();
  });

  it("createAirtableClient pauses when key unset (no crash)", () => {
    const client = createAirtableClient({});
    expect(client.paused).toBe(true);
    expect(client).toBeInstanceOf(PausedAirtableClient);
  });

  it("resume after pause drains exactly once via sandbox", async () => {
    const { app, cookie, airtable, store } = await magicLinkSession(
      "admin",
      "airtable-resume@example.com",
    );
    const created = await createEventViaApi(app, cookie, "Resume Event");
    const eventId = created.event.id;

    // Pause drain
    const paused = await processAirtableOutbox({
      airtable,
      auth: store,
      clientEnv: {},
    });
    expect(paused.paused).toBe(true);
    const pendingBefore = await airtable.listUnprocessedAirtableForEvent(
      eventId,
    );
    expect(pendingBefore.length).toBeGreaterThanOrEqual(1);

    // Resume with sandbox
    const sandbox = new SandboxAirtableClient();
    const resumed = await processAirtableOutbox({
      airtable,
      auth: store,
      client: sandbox,
    });
    expect(resumed.paused).toBe(false);
    expect(resumed.processed).toBeGreaterThanOrEqual(1);

    const pendingAfter = await airtable.listUnprocessedAirtableForEvent(
      eventId,
    );
    expect(pendingAfter.length).toBe(0);
    expect(
      sandbox.upserts.every((u) => u.fields.internal_id === u.internalId),
    ).toBe(true);

    // Idempotent re-drain
    const again = await processAirtableOutbox({
      airtable,
      auth: store,
      client: sandbox,
    });
    expect(again.processed).toBe(0);
  });
});
