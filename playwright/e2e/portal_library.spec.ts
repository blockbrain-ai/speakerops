/**
 * N1–N3 speaker library: admin publishes form/resource, speaker sees them.
 */
import { test, expect } from "@playwright/test";
import {
  loginAs,
  ensureEvent,
  sessionHeaders,
} from "./helpers/cfp-eval-seed.js";

test.describe("Portal library N1–N3", () => {
  test("admin creates published form; speaker lists it", async ({
    request,
    context,
    baseURL,
  }) => {
    const adminEmail = `lib-admin-${Date.now()}@example.com`;
    const { session: adminSession } = await loginAs(
      request,
      context,
      baseURL,
      adminEmail,
      "admin",
    );
    const event = await ensureEvent(
      request,
      adminSession,
      `Library Event ${Date.now()}`,
      `lib-${Date.now()}`,
    );

    // Create + publish portal form
    const create = await request.post(
      `/api/events/${encodeURIComponent(event.id)}/portal-forms`,
      {
        headers: sessionHeaders(adminSession),
        data: {
          title: "Travel form",
          fields: [
            {
              key: "city",
              label: "Arrival city",
              type: "text",
              required: true,
            },
          ],
        },
      },
    );
    expect(create.status()).toBe(201);
    const form = (await create.json()) as {
      id: string;
      version: number;
    };
    const pub = await request.patch(
      `/api/events/${encodeURIComponent(event.id)}/portal-forms/${encodeURIComponent(form.id)}`,
      {
        headers: sessionHeaders(adminSession),
        data: { status: "published", expectedVersion: form.version },
      },
    );
    expect(pub.status()).toBe(200);

    // Resource published
    const resCreate = await request.post(
      `/api/events/${encodeURIComponent(event.id)}/resources`,
      {
        headers: sessionHeaders(adminSession),
        data: {
          title: "Code of conduct",
          bodyMd: "Be kind.",
        },
      },
    );
    expect(resCreate.status()).toBe(201);
    const resource = (await resCreate.json()) as {
      resource: { id: string; version: number };
    };
    const resPub = await request.patch(
      `/api/events/${encodeURIComponent(event.id)}/resources/${encodeURIComponent(resource.resource.id)}`,
      {
        headers: sessionHeaders(adminSession),
        data: {
          status: "published",
          expectedVersion: resource.resource.version,
        },
      },
    );
    expect(resPub.status()).toBe(200);

    // Speaker session for same event — invite via membership
    const speakerEmail = `lib-spk-${Date.now()}@example.com`;
    // Magic link speaker with eventId to attach membership
    await request.post("/api/auth/magic-link", {
      data: { email: speakerEmail, purpose: "speaker", eventId: event.id },
    });
    const outbox = await request.get(
      `/api/auth/dev/outbox?email=${encodeURIComponent(speakerEmail)}`,
    );
    const link = (await outbox.json()) as {
      link: { token: string };
    };
    const exchange = await request.post("/api/auth/exchange", {
      data: { token: link.link.token },
    });
    expect(exchange.status()).toBe(200);
    const setCookie = exchange.headers()["set-cookie"] ?? "";
    const match = setCookie.match(/speakerops_session=([^;]+)/);
    expect(match).toBeTruthy();
    const speakerSession = match![1]!;
    const spHeaders = sessionHeaders(speakerSession);

    // Speaker sees published forms
    const forms = await request.get(
      `/api/portal/forms?eventId=${encodeURIComponent(event.id)}`,
      { headers: spHeaders },
    );
    expect(forms.status(), await forms.text()).toBe(200);
    const formsBody = (await forms.json()) as { forms: { title: string }[] };
    expect(formsBody.forms.some((f) => f.title === "Travel form")).toBeTruthy();

    // Speaker sees published resources
    const resources = await request.get(
      `/api/portal/resources?eventId=${encodeURIComponent(event.id)}`,
      { headers: spHeaders },
    );
    expect(resources.status()).toBe(200);
    const resBody = (await resources.json()) as {
      resources: { title: string }[];
    };
    expect(
      resBody.resources.some((r) => r.title === "Code of conduct"),
    ).toBeTruthy();
  });
});
