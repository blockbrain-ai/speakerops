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
  test("admin creates published form and resource; speaker lists them", async ({
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
    const adminHeaders = sessionHeaders(adminSession);

    // Create + publish portal form
    const create = await request.post(
      `/api/events/${encodeURIComponent(event.id)}/portal-forms`,
      {
        headers: adminHeaders,
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
    expect(create.status(), await create.text()).toBe(201);
    const form = (await create.json()) as { id: string; version: number };
    expect(form.id).toBeTruthy();

    const pub = await request.patch(
      `/api/events/${encodeURIComponent(event.id)}/portal-forms/${encodeURIComponent(form.id)}`,
      {
        headers: adminHeaders,
        data: { status: "published", expectedVersion: form.version },
      },
    );
    expect(pub.status(), await pub.text()).toBe(200);
    const pubBody = (await pub.json()) as { status: string };
    expect(pubBody.status).toBe("published");

    // Admin list confirms published form is visible
    const adminList = await request.get(
      `/api/events/${encodeURIComponent(event.id)}/portal-forms`,
      { headers: adminHeaders },
    );
    const adminListText = await adminList.text();
    expect(adminList.status(), adminListText).toBe(200);
    const adminForms = JSON.parse(adminListText) as {
      forms: { title: string; status: string; id: string }[];
    };
    expect(
      adminForms.forms,
      `admin list after publish: ${adminListText}`,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Travel form",
          status: "published",
        }),
      ]),
    );

    // Resource published
    const resCreate = await request.post(
      `/api/events/${encodeURIComponent(event.id)}/resources`,
      {
        headers: adminHeaders,
        data: {
          title: "Code of conduct",
          bodyMd: "Be kind.",
        },
      },
    );
    expect(resCreate.status(), await resCreate.text()).toBe(201);
    const resource = (await resCreate.json()) as {
      resource: { id: string; version: number };
    };
    const resPub = await request.patch(
      `/api/events/${encodeURIComponent(event.id)}/resources/${encodeURIComponent(resource.resource.id)}`,
      {
        headers: adminHeaders,
        data: {
          status: "published",
          expectedVersion: resource.resource.version,
        },
      },
    );
    expect(resPub.status(), await resPub.text()).toBe(200);

    // Speaker session for same event
    const speakerEmail = `lib-spk-${Date.now()}@example.com`;
    await request.post("/api/auth/magic-link", {
      data: { email: speakerEmail, purpose: "speaker", eventId: event.id },
    });
    const outbox = await request.get(
      `/api/auth/dev/outbox?email=${encodeURIComponent(speakerEmail)}`,
    );
    expect(outbox.status()).toBe(200);
    const link = (await outbox.json()) as {
      link: { token: string } | null;
    };
    expect(link.link?.token).toBeTruthy();
    const exchange = await request.post("/api/auth/exchange", {
      data: { token: link.link!.token },
    });
    expect(exchange.status()).toBe(200);
    const setCookie = exchange.headers()["set-cookie"] ?? "";
    const match = setCookie.match(/speakerops_session=([^;]+)/);
    expect(match).toBeTruthy();
    const spHeaders = sessionHeaders(match![1]!);

    // Speaker sees published forms
    const forms = await request.get(
      `/api/portal/forms?eventId=${encodeURIComponent(event.id)}`,
      { headers: spHeaders },
    );
    const formsText = await forms.text();
    expect(forms.status(), formsText).toBe(200);
    const formsBody = JSON.parse(formsText) as { forms: { title: string }[] };
    expect(formsBody.forms.some((f) => f.title === "Travel form")).toBeTruthy();

    // Speaker sees published resources
    const resources = await request.get(
      `/api/portal/resources?eventId=${encodeURIComponent(event.id)}`,
      { headers: spHeaders },
    );
    const resText = await resources.text();
    expect(resources.status(), resText).toBe(200);
    const resBody = JSON.parse(resText) as {
      resources: { title: string }[];
    };
    expect(
      resBody.resources.some((r) => r.title === "Code of conduct"),
    ).toBeTruthy();
  });
});
