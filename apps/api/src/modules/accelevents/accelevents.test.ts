/**
 * Accelevents projector + Integrations routes.
 * E7: request path never calls AE HTTP. Sandbox never sets verified.
 */
import { describe, it, expect } from "vitest";
import { createAppWithAuth } from "../../index.js";
import {
  SandboxAcceleventsClient,
  PausedAcceleventsClient,
  createAcceleventsClient,
} from "./client.js";
import { MemoryIntegrationsStore } from "./store.js";
import { saveAcceleventsConnection, queueAcceleventsVerify } from "./commands.js";
import { processAcceleventsOutbox } from "../../workers/acceleventsConsumer.js";
import {
  formatAcceleventsDateTime,
  normalizeEmail,
  projectPublishedSnapshot,
  splitName,
} from "./project.js";

describe("accelevents client modes", () => {
  it("boots paused without a key — never throws", () => {
    const client = createAcceleventsClient({});
    expect(client.mode).toBe("paused");
    expect(client.credentialPresent).toBe(false);
  });

  it("sandbox records Key-header-shaped calls and never hits the network", async () => {
    const client = new SandboxAcceleventsClient();
    await client.createSpeaker("demo", {
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
    });
    expect(client.recorded[0]?.method).toBe("POST");
    expect(client.recorded[0]?.path).toBe("/rest/host/event/demo/speaker");
    expect(client.recorded[0]?.headers?.Key).toBe("(sandbox)");
  });
});

describe("mapping", () => {
  it("formats yyyy/MM/dd HH:mm in the event timezone", () => {
    const iso = "2026-08-13T18:30:00.000Z";
    expect(formatAcceleventsDateTime(iso, "UTC")).toBe("2026/08/13 18:30");
    expect(formatAcceleventsDateTime(iso, "America/New_York")).toMatch(
      /^2026\/08\/13 1[34]:30$/,
    );
  });

  it("normalizes email and splits names", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
    expect(splitName("Ada Lovelace")).toEqual({
      firstName: "Ada",
      lastName: "Lovelace",
    });
  });
});

describe("projection sandbox", () => {
  it("creates speakers then scheduled sessions; skips unscheduled", async () => {
    const store = new MemoryIntegrationsStore();
    const client = new SandboxAcceleventsClient();
    const now = new Date().toISOString();
    await store.upsertConnection({
      id: "c1",
      eventId: "evt_1",
      provider: "accelevents",
      enabled: true,
      eventUrl: "demo",
      externalEventId: "99",
      connectionGeneration: 1,
      verificationState: "never",
      lastAttemptAt: null,
      lastVerifiedAt: null,
      lastError: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    const result = await projectPublishedSnapshot(store, client, (await store.getConnection("evt_1", "accelevents"))!, {
      event: { timezone: "UTC" },
      speakers: [
        {
          id: "part_1",
          name: "Ada Lovelace",
          title: "Poet",
          company: "Analytical",
          bio: "Notes",
          headshotUrl: null,
          roleLabel: "Speaker",
          email: "ada@example.com",
        },
      ],
      sessions: [
        {
          id: "sess_skip",
          title: "Unscheduled",
          description: null,
          trackId: null,
          trackName: null,
          trackColor: null,
          status: "confirmed",
          speakers: [],
          startsAt: null,
          endsAt: null,
          roomId: null,
          roomName: null,
        },
        {
          id: "sess_1",
          title: "Opening",
          description: "Hello",
          trackId: null,
          trackName: null,
          trackColor: null,
          status: "confirmed",
          speakers: [{ participationId: "part_1", name: "Ada Lovelace", isPrimary: true }],
          startsAt: "2026-08-13T18:00:00.000Z",
          endsAt: "2026-08-13T19:00:00.000Z",
          roomId: "r1",
          roomName: "Main",
        },
      ],
    });
    expect(result.speakers).toBe(1);
    expect(result.sessions).toBe(1);
    expect(client.recorded.some((c) => c.method === "POST" && c.path.endsWith("/session"))).toBe(
      true,
    );
    const sessionBody = client.recorded.find(
      (c) => c.method === "POST" && String(c.path).endsWith("/session"),
    )?.body as { sessionTypeFormat?: string; startTime?: string };
    expect(sessionBody.sessionTypeFormat).toBe("IN_PERSON");
    expect(sessionBody.startTime).toBe("2026/08/13 18:00");
  });

  it("treats 4068906 as match-by-email", async () => {
    const store = new MemoryIntegrationsStore();
    const client = new SandboxAcceleventsClient();
    client.dupEmail = true;
    client.speakers = [{ id: "ext-9", email: "ada@example.com" }];
    const now = new Date().toISOString();
    const conn = {
      id: "c1",
      eventId: "evt_1",
      provider: "accelevents" as const,
      enabled: true,
      eventUrl: "demo",
      externalEventId: "99",
      connectionGeneration: 1,
      verificationState: "never" as const,
      lastAttemptAt: null,
      lastVerifiedAt: null,
      lastError: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await store.upsertConnection(conn);
    const result = await projectPublishedSnapshot(store, client, conn, {
      event: { timezone: "UTC" },
      speakers: [
        {
          id: "part_1",
          name: "Ada",
          title: null,
          company: null,
          bio: null,
          headshotUrl: null,
          roleLabel: null,
          email: "ADA@example.com",
        },
      ],
      sessions: [],
    });
    expect(result.speakers).toBe(1);
    const ident = await store.getIdentity("evt_1", 1, "speaker", "part_1");
    expect(ident?.externalId).toBe("ext-9");
  });
});

describe("verify drain honesty", () => {
  it("paused and sandbox never persist verified", async () => {
    const store = new MemoryIntegrationsStore();
    const now = new Date().toISOString();
    await store.upsertConnection({
      id: "c1",
      eventId: "evt_1",
      provider: "accelevents",
      enabled: true,
      eventUrl: "demo",
      externalEventId: "99",
      connectionGeneration: 1,
      verificationState: "pending",
      lastAttemptAt: now,
      lastVerifiedAt: null,
      lastError: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    await queueAcceleventsVerify(store, {}, "evt_1");
    await processAcceleventsOutbox({
      integrations: store,
      client: new PausedAcceleventsClient(),
    });
    const paused = await store.getConnection("evt_1", "accelevents");
    expect(paused?.verificationState).toBe("paused");

    await queueAcceleventsVerify(store, {}, "evt_1");
    await processAcceleventsOutbox({
      integrations: store,
      client: new SandboxAcceleventsClient(),
    });
    const sand = await store.getConnection("evt_1", "accelevents");
    expect(sand?.verificationState).not.toBe("verified");
  });
});

describe("integrations HTTP", () => {
  it("admin save + status + verify enqueue without third-party fetch", async () => {
    let fetches = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetches += 1;
      return orig(...args);
    }) as typeof fetch;
    try {
      const { app, store } = createAppWithAuth();
      const email = "ae-admin@example.com";
      await app.request("http://localhost/api/auth/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, purpose: "admin" }),
      });
      const outbox = await app.request(
        `http://localhost/api/auth/dev/outbox?email=${encodeURIComponent(email)}`,
      );
      const token = ((await outbox.json()) as { link: { token: string } }).link.token;
      const ex = await app.request("http://localhost/api/auth/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const cookie = ex.headers.get("set-cookie") ?? "";
      const created = await app.request("http://localhost/api/events", {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "AE Event", timezone: "UTC" }),
      });
      expect(created.status).toBe(201);
      const eventId = ((await created.json()) as { event: { id: string } }).event
        .id;

      const before = fetches;
      const get = await app.request(
        `http://localhost/api/events/${eventId}/integrations`,
        { headers: { cookie, accept: "application/json" } },
      );
      expect(get.status).toBe(200);
      const listed = (await get.json()) as {
        connections: Array<{ verificationState: string; credentialPresent: boolean }>;
      };
      expect(listed.connections[0]?.credentialPresent).toBe(false);
      expect(listed.connections[0]?.verificationState).toBe("paused");

      const put = await app.request(
        `http://localhost/api/events/${eventId}/integrations/accelevents`,
        {
          method: "PUT",
          headers: {
            cookie,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            eventUrl: "demo",
            externalEventId: "12345",
            enabled: true,
          }),
        },
      );
      expect(put.status).toBe(200);
      const saved = (await put.json()) as {
        connection: { verificationState: string; enabled: boolean };
      };
      expect(saved.connection.enabled).toBe(true);
      expect(saved.connection.verificationState).toBe("paused");

      const verify = await app.request(
        `http://localhost/api/events/${eventId}/integrations/accelevents/verify`,
        {
          method: "POST",
          headers: {
            cookie,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({}),
        },
      );
      expect(verify.status).toBe(200);
      const vbody = (await verify.json()) as { queued: boolean };
      expect(vbody.queued).toBe(true);
      expect(fetches).toBe(before);

      const evalEmail = "ae-eval@example.com";
      await app.request("http://localhost/api/auth/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: evalEmail, purpose: "evaluator" }),
      });
      const eOut = await app.request(
        `http://localhost/api/auth/dev/outbox?email=${encodeURIComponent(evalEmail)}`,
      );
      const eTok = ((await eOut.json()) as { link: { token: string } }).link.token;
      const eEx = await app.request("http://localhost/api/auth/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: eTok }),
      });
      const eCookie = eEx.headers.get("set-cookie") ?? "";
      const forbidden = await app.request(
        `http://localhost/api/events/${eventId}/integrations`,
        { headers: { cookie: eCookie, accept: "application/json" } },
      );
      expect([401, 403, 404]).toContain(forbidden.status);

      const unauth = await app.request(
        `http://localhost/api/events/${eventId}/integrations`,
      );
      expect(unauth.status).toBe(401);
      void store;
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("rejects malformed event URL", async () => {
    const store = new MemoryIntegrationsStore();
    const result = await saveAcceleventsConnection(store, {}, "evt_1", {
      eventUrl: "https://evil.example/x",
      externalEventId: "1",
      enabled: false,
    });
    expect(result.ok).toBe(false);
  });
});
