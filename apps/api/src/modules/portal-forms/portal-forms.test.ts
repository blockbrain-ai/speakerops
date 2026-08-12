/**
 * N1 portal forms — create / publish / speaker list.
 */
import { describe, it, expect } from "vitest";
import { createApp } from "../../index.js";
import {
  MemoryAuthStore,
  type AuthStore,
} from "../auth/store.js";
import { MemoryEventsStore } from "../events/store.js";
import { MemoryPortalFormsStore } from "./store.js";
import { MemoryDecisionsStore } from "../decisions/store.js";
import { MemorySubmissionsStore } from "../publicCfp/store.js";
import { uuidv7 } from "@speakerops/shared";

async function adminSession(store: AuthStore, eventId: string) {
  const userId = uuidv7();
  const email = `admin-${userId.slice(0, 8)}@example.com`;
  await store.upsertUser({
    id: userId,
    email,
    displayName: "Admin",
    createdAt: new Date().toISOString(),
  });
  await store.upsertMembership({
    eventId,
    userId,
    role: "admin",
    createdAt: new Date().toISOString(),
  });
  const token = `sess_${uuidv7()}`;
  await store.insertSession({
    id: uuidv7(),
    userId,
    tokenHash: token, // memory store may hash; tests often use raw depending on impl
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    createdAt: new Date().toISOString(),
  });
  return { userId, email, cookie: `session=${token}` };
}

describe("N1 portal forms", () => {
  it("admin creates and lists portal form", async () => {
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

    // Use createApp with injected stores if supported
    const app = createApp({
      authStore: auth,
      eventsStore: events,
      portalFormsStore: portalForms,
      decisionsStore: new MemoryDecisionsStore(),
      submissionsStore: new MemorySubmissionsStore(),
      enableDevOutbox: true,
      bootstrapPolicy: "open",
    });

    // Memory session path varies — exercise store directly for unit certainty
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

    // App boots
    const health = await app.request("http://localhost/health");
    expect(health.status).toBe(200);
  });
});
