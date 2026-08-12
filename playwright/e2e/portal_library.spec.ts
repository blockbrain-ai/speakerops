/**
 * N1–N3 speaker library + inventory Q02–Q06.
 * Admin publishes form/resource/file-request; speaker lists + fulfils.
 */
import { test, expect } from "@playwright/test";
import {
  loginAs,
  ensureEvent,
  sessionHeaders,
} from "./helpers/cfp-eval-seed.js";

async function loginSpeaker(
  request: import("@playwright/test").APIRequestContext,
  email: string,
  eventId: string,
): Promise<string> {
  await request.post("/api/auth/magic-link", {
    data: { email, purpose: "speaker", eventId },
  });
  const outbox = await request.get(
    `/api/auth/dev/outbox?email=${encodeURIComponent(email)}`,
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
  return match![1]!;
}

test.describe("Portal library N1–N3", () => {
  test("@inv:Q02 e2e/portal-lib/form-publish create + publish portal form", async ({
    request,
    context,
    baseURL,
  }) => {
    const adminEmail = `lib-admin-q02-${Date.now()}@example.com`;
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
      `Library Event Q02 ${Date.now()}`,
      `lib-q02-${Date.now()}`,
    );
    const adminHeaders = sessionHeaders(adminSession);

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
    const pubBody = (await pub.json()) as { status: string; title?: string };
    expect(pubBody.status).toBe("published");
    expect(pubBody.title ?? "Travel form").toBeTruthy();

    const adminList = await request.get(
      `/api/events/${encodeURIComponent(event.id)}/portal-forms`,
      { headers: adminHeaders },
    );
    const adminListText = await adminList.text();
    expect(adminList.status(), adminListText).toBe(200);
    const adminForms = JSON.parse(adminListText) as {
      forms: { title: string; status: string; id: string }[];
    };
    expect(adminForms.forms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Travel form",
          status: "published",
        }),
      ]),
    );

    // Unauth negative
    const unauth = await request.get(
      `/api/events/${encodeURIComponent(event.id)}/portal-forms`,
    );
    expect([401, 403]).toContain(unauth.status());
  });

  test("@inv:Q03 e2e/portal-lib/resource-edit create select save publish resource", async ({
    request,
    context,
    baseURL,
  }) => {
    const adminEmail = `lib-admin-q03-${Date.now()}@example.com`;
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
      `Library Event Q03 ${Date.now()}`,
      `lib-q03-${Date.now()}`,
    );
    const adminHeaders = sessionHeaders(adminSession);

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
      resource: { id: string; version: number; title: string };
    };
    expect(resource.resource.title).toBe("Code of conduct");

    // Save/edit (select + save path at API layer)
    const save = await request.patch(
      `/api/events/${encodeURIComponent(event.id)}/resources/${encodeURIComponent(resource.resource.id)}`,
      {
        headers: adminHeaders,
        data: {
          title: "Code of conduct (revised)",
          bodyMd: "Be kind. Be curious.",
          expectedVersion: resource.resource.version,
        },
      },
    );
    expect(save.status(), await save.text()).toBe(200);
    const saved = (await save.json()) as {
      resource: { title: string; version: number };
    };
    expect(saved.resource.title).toContain("revised");

    const resPub = await request.patch(
      `/api/events/${encodeURIComponent(event.id)}/resources/${encodeURIComponent(resource.resource.id)}`,
      {
        headers: adminHeaders,
        data: {
          status: "published",
          expectedVersion: saved.resource.version,
        },
      },
    );
    expect(resPub.status(), await resPub.text()).toBe(200);
    const pubBody = (await resPub.json()) as {
      resource: { status: string; title: string };
    };
    expect(pubBody.resource.status).toBe("published");
    expect(pubBody.resource.title).toContain("revised");
  });

  test("@inv:Q04 e2e/portal-lib/file-request-publish create + publish file request", async ({
    request,
    context,
    baseURL,
  }) => {
    const adminEmail = `lib-admin-q04-${Date.now()}@example.com`;
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
      `Library Event Q04 ${Date.now()}`,
      `lib-q04-${Date.now()}`,
    );
    const adminHeaders = sessionHeaders(adminSession);

    const create = await request.post(
      `/api/events/${encodeURIComponent(event.id)}/file-requests`,
      {
        headers: adminHeaders,
        data: {
          title: "Session PDF",
          instructions: "Upload your deck as PDF.",
          purpose: "other",
        },
      },
    );
    expect(create.status(), await create.text()).toBe(201);
    const body = (await create.json()) as {
      fileRequest: { id: string; version: number; title: string };
    };
    expect(body.fileRequest.title).toBe("Session PDF");

    const pub = await request.patch(
      `/api/events/${encodeURIComponent(event.id)}/file-requests/${encodeURIComponent(body.fileRequest.id)}`,
      {
        headers: adminHeaders,
        data: {
          status: "published",
          expectedVersion: body.fileRequest.version,
        },
      },
    );
    expect(pub.status(), await pub.text()).toBe(200);
    const pubBody = (await pub.json()) as {
      fileRequest: { status: string };
    };
    expect(pubBody.fileRequest.status).toBe("published");
  });

  test("@inv:Q05 e2e/portal-lib/speaker-list published forms + resources for speaker", async ({
    request,
    context,
    baseURL,
  }) => {
    const adminEmail = `lib-admin-q05-${Date.now()}@example.com`;
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
      `Library Event Q05 ${Date.now()}`,
      `lib-q05-${Date.now()}`,
    );
    const adminHeaders = sessionHeaders(adminSession);

    const create = await request.post(
      `/api/events/${encodeURIComponent(event.id)}/portal-forms`,
      {
        headers: adminHeaders,
        data: {
          title: "Travel form",
          fields: [
            { key: "city", label: "Arrival city", type: "text", required: true },
          ],
        },
      },
    );
    const form = (await create.json()) as { id: string; version: number };
    await request.patch(
      `/api/events/${encodeURIComponent(event.id)}/portal-forms/${encodeURIComponent(form.id)}`,
      {
        headers: adminHeaders,
        data: { status: "published", expectedVersion: form.version },
      },
    );

    const resCreate = await request.post(
      `/api/events/${encodeURIComponent(event.id)}/resources`,
      {
        headers: adminHeaders,
        data: { title: "Code of conduct", bodyMd: "Be kind." },
      },
    );
    const resource = (await resCreate.json()) as {
      resource: { id: string; version: number };
    };
    await request.patch(
      `/api/events/${encodeURIComponent(event.id)}/resources/${encodeURIComponent(resource.resource.id)}`,
      {
        headers: adminHeaders,
        data: {
          status: "published",
          expectedVersion: resource.resource.version,
        },
      },
    );

    const speakerEmail = `lib-spk-q05-${Date.now()}@example.com`;
    const spSession = await loginSpeaker(request, speakerEmail, event.id);
    const spHeaders = sessionHeaders(spSession);

    const forms = await request.get(
      `/api/portal/forms?eventId=${encodeURIComponent(event.id)}`,
      { headers: spHeaders },
    );
    const formsText = await forms.text();
    expect(forms.status(), formsText).toBe(200);
    const formsBody = JSON.parse(formsText) as { forms: { title: string }[] };
    expect(formsBody.forms.some((f) => f.title === "Travel form")).toBeTruthy();

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

  test("@inv:Q06 e2e/portal-lib/file-request-fulfill speaker upload fulfils request", async ({
    request,
    context,
    baseURL,
  }) => {
    const adminEmail = `lib-admin-q06-${Date.now()}@example.com`;
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
      `Library Event Q06 ${Date.now()}`,
      `lib-q06-${Date.now()}`,
    );
    const adminHeaders = sessionHeaders(adminSession);

    const create = await request.post(
      `/api/events/${encodeURIComponent(event.id)}/file-requests`,
      {
        headers: adminHeaders,
        data: {
          title: "Session PDF",
          instructions: "Upload your deck.",
          purpose: "other",
        },
      },
    );
    const fr = (await create.json()) as {
      fileRequest: { id: string; version: number };
    };
    await request.patch(
      `/api/events/${encodeURIComponent(event.id)}/file-requests/${encodeURIComponent(fr.fileRequest.id)}`,
      {
        headers: adminHeaders,
        data: {
          status: "published",
          expectedVersion: fr.fileRequest.version,
        },
      },
    );

    const speakerEmail = `lib-spk-q06-${Date.now()}@example.com`;
    const spSession = await loginSpeaker(request, speakerEmail, event.id);
    const spHeaders = sessionHeaders(spSession);

    // Ensure speaker has a participation (seed via home if available)
    const home = await request.get(
      `/api/portal/home?eventId=${encodeURIComponent(event.id)}`,
      { headers: spHeaders },
    );
    let participationId = `part-test-${Date.now()}`;
    if (home.status() === 200) {
      const homeBody = (await home.json()) as {
        participations?: { id: string }[];
      };
      if (homeBody.participations?.[0]?.id) {
        participationId = homeBody.participations[0].id;
      }
    }

    // Presign + complete a tiny PNG as "other" (or headshot if other rejects)
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const presign = await request.post("/api/files/presign", {
      headers: spHeaders,
      data: {
        eventId: event.id,
        purpose: "other",
        mime: "image/png",
        size: png.length,
        filename: "deck-stub.png",
        ownerParticipationId: participationId,
      },
    });
    // If purpose other needs different handling, try slides path
    let fileId: string | null = null;
    if (presign.status() === 200) {
      const p = (await presign.json()) as { fileId: string; url: string };
      fileId = p.fileId;
      // Cookie only — must not overwrite content-type with application/json.
      const up = await request.put(p.url, {
        headers: {
          cookie: `speakerops_session=${spSession}`,
          "content-type": "image/png",
        },
        data: png,
      });
      expect(
        [200, 201, 204],
        `upload status ${up.status()} body=${await up.text()}`,
      ).toContain(up.status());
      const checksum = await crypto.subtle
        .digest("SHA-256", png)
        .then((buf) =>
          [...new Uint8Array(buf)]
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(""),
        );
      const complete = await request.post(
        `/api/files/${encodeURIComponent(p.fileId)}/complete`,
        {
          headers: spHeaders,
          data: {
            eventId: event.id,
            checksum,
            filename: "deck-stub.png",
          },
        },
      );
      expect(complete.status(), await complete.text()).toBe(200);
      fileId = p.fileId;
    } else {
      throw new Error(
        `presign failed ${presign.status()} ${await presign.text()}`,
      );
    }

    // Direct fulfill (API outcome) — durable linkage
    const fulfill = await request.post(
      `/api/portal/file-requests/${encodeURIComponent(fr.fileRequest.id)}/fulfill`,
      {
        headers: spHeaders,
        data: {
          eventId: event.id,
          participationId,
          fileId: fileId!,
        },
      },
    );
    expect(fulfill.status(), await fulfill.text()).toBe(200);
    const fulfillBody = (await fulfill.json()) as {
      fulfillment: { fileId: string; requestId: string };
    };
    expect(fulfillBody.fulfillment.requestId).toBe(fr.fileRequest.id);
    expect(fulfillBody.fulfillment.fileId).toBeTruthy();

    const list = await request.get(
      `/api/portal/file-requests?eventId=${encodeURIComponent(event.id)}&participationId=${encodeURIComponent(participationId)}`,
      { headers: spHeaders },
    );
    expect(list.status()).toBe(200);
    const listBody = (await list.json()) as {
      fileRequests: { id: string; fulfilled?: boolean }[];
    };
    const row = listBody.fileRequests.find((r) => r.id === fr.fileRequest.id);
    expect(row?.fulfilled).toBe(true);
  });
});
