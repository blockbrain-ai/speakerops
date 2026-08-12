/**
 * N1 portal forms — create / publish store + HTTP.
 */
import { describe, it, expect } from "vitest";
import { createApp } from "../../index.js";
import { MemoryAuthStore } from "../auth/store.js";
import { MemoryEventsStore } from "../events/store.js";
import { MemoryPortalFormsStore } from "./store.js";
import { MemoryDecisionsStore } from "../decisions/store.js";
import { MemorySubmissionsStore } from "../publicCfp/store.js";
import { uuidv7 } from "@speakerops/shared";

describe("N1 portal forms", () => {
  it("store create, list, and publish", async () => {
    const auth = new MemoryAuthStore();
    const events = new MemoryEventsStore();
    const portalForms = new MemoryPortalFormsStore();
    const eventId = uuidv7();
    const now = new Date().toISOString();
    await events.insertEvent({
      id: eventId,
      orgId: "org_default",
      name: "Portal Forms Event",
      slug: `pf-${eventId.slice(0, 8)}`,
      timezone: "UTC",
      startsAt: now,
      endsAt: now,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    const app = createApp({
      authStore: auth,
      eventsStore: events,
      portalFormsStore: portalForms,
      decisionsStore: new MemoryDecisionsStore(),
      submissionsStore: new MemorySubmissionsStore(),
      enableDevOutbox: true,
      bootstrapPolicy: "open",
    });

    const form = await portalForms.insertForm({
      id: uuidv7(),
      eventId,
      title: "Travel form",
      description: null,
      scope: "participation",
      status: "draft",
      fieldsJson: JSON.stringify([
        { key: "airline", label: "Airline", type: "text", required: true },
      ]),
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
    expect(form.title).toBe("Travel form");
    const listed = await portalForms.listForms(eventId);
    expect(listed).toHaveLength(1);
    const published = await portalForms.updateForm(eventId, form.id, 1, {
      status: "published",
      updatedAt: now,
    });
    expect(published?.status).toBe("published");
    expect(published?.version).toBe(2);

    const health = await app.request("http://localhost/health");
    expect(health.status).toBe(200);
  });
});

import { createAppWithAuth } from "../../index.js";

describe("N1 portal forms HTTP", () => {
  it("POST create then PATCH publish returns 200", async () => {
    const { app, store, events, outbox } = createAppWithAuth({
      cookieSecure: true,
    });
    void outbox;
    // Admin magic link bootstrap
    const email = `pf-http-${Date.now()}@example.com`;
    const ml = await app.request("http://localhost/api/auth/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, purpose: "admin" }),
    });
    expect(ml.status).toBe(200);
    const links = await store.listMagicLinks?.() ?? [];
    // use outbox
    const out = await app.request(
      `http://localhost/api/auth/dev/outbox?email=${encodeURIComponent(email)}`,
    );
    expect(out.status).toBe(200);
    const outBody = (await out.json()) as { link: { token: string } | null };
    expect(outBody.link?.token).toBeTruthy();
    const ex = await app.request("http://localhost/api/auth/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: outBody.link!.token }),
    });
    expect(ex.status).toBe(200);
    const setCookie = ex.headers.get("set-cookie") ?? "";
    const m = setCookie.match(/speakerops_session=([^;]+)/);
    expect(m).toBeTruthy();
    const cookie = `speakerops_session=${m![1]}`;

    const ev = await app.request("http://localhost/api/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        name: "HTTP Portal Form Event",
        timezone: "UTC",
        startsAt: "2026-06-01T09:00:00.000Z",
        endsAt: "2026-06-02T17:00:00.000Z",
      }),
    });
    expect(ev.status).toBe(201);
    const eventBody = (await ev.json()) as { event: { id: string } };
    const eventId = eventBody.event.id;

    const create = await app.request(
      `http://localhost/api/events/${eventId}/portal-forms`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          title: "Travel form",
          fields: [
            { key: "city", label: "Arrival city", type: "text", required: true },
          ],
        }),
      },
    );
    const createText = await create.text();
    expect(create.status, createText).toBe(201);
    const form = JSON.parse(createText) as { id: string; version: number };

    const pub = await app.request(
      `http://localhost/api/events/${eventId}/portal-forms/${form.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          status: "published",
          expectedVersion: form.version,
        }),
      },
    );
    const pubText = await pub.text();
    expect(pub.status, pubText).toBe(200);
    const published = JSON.parse(pubText) as { status: string; version: number };
    expect(published.status).toBe("published");
    expect(published.version).toBe(form.version + 1);
    void events;
    void links;
  });
});
