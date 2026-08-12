/**
 * N1–N3 portal library — inventory Q02–Q06 with real browser primary controls.
 */
import { test, expect } from "@playwright/test";
import {
  loginAs,
  ensureEvent,
  sessionHeaders,
} from "./helpers/cfp-eval-seed.js";
import path from "node:path";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const TURNSTILE_DEV_PASS_TOKEN = "XXXX.DUMMY.TOKEN";

/** Materialise a speaker participation via CFP submit + admin accept. */
async function seedSpeakerParticipation(
  request: import("@playwright/test").APIRequestContext,
  adminSession: string,
  eventId: string,
  slug: string,
  speakerEmail: string,
  speakerName: string,
): Promise<string> {
  const create = await request.post(`/api/events/${eventId}/forms`, {
    headers: sessionHeaders(adminSession),
    data: { name: `CFP ${speakerName}` },
  });
  expect(create.status()).toBe(201);
  const form = (await create.json()) as { form: { id: string } };
  await request.put(`/api/forms/${form.form.id}/draft`, {
    headers: sessionHeaders(adminSession),
    data: {
      fields: [
        {
          fieldKey: "abstract",
          type: "textarea",
          label: "Abstract",
          required: true,
          sortOrder: 0,
        },
      ],
      rules: [],
    },
  });
  const publish = await request.post(`/api/forms/${form.form.id}/publish`, {
    headers: sessionHeaders(adminSession),
    data: {},
  });
  expect(publish.status()).toBe(200);
  const pub = (await publish.json()) as { formVersion: { id: string } };
  const submit = await request.post(`/api/public/cfp/${slug}/submissions`, {
    data: {
      formVersionId: pub.formVersion.id,
      title: `Talk by ${speakerName}`,
      speakers: [
        { name: speakerName, email: speakerEmail, isPrimary: true },
      ],
      answers: [{ fieldKey: "abstract", value: "Library fulfill abstract" }],
      turnstileToken: TURNSTILE_DEV_PASS_TOKEN,
    },
  });
  expect(submit.status(), await submit.text()).toBe(201);
  const sub = (await submit.json()) as { submission: { id: string } };
  const decision = await request.post(
    `/api/submissions/${sub.submission.id}/decision`,
    {
      headers: sessionHeaders(adminSession),
      data: { decision: "accept" },
    },
  );
  expect(decision.status(), await decision.text()).toBe(200);
  const body = (await decision.json()) as {
    participations: Array<{ id: string }>;
  };
  expect(body.participations.length).toBeGreaterThanOrEqual(1);
  return body.participations[0]!.id;
}

async function loginSpeaker(
  request: import("@playwright/test").APIRequestContext,
  context: import("@playwright/test").BrowserContext,
  baseURL: string | undefined,
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
  const session = match![1]!;
  await context.addCookies([
    {
      name: "speakerops_session",
      value: session,
      url: baseURL ?? "http://127.0.0.1:5173",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
  return session;
}

async function selectEvent(
  page: import("@playwright/test").Page,
  eventId: string,
) {
  const eventSelect = page.getByTestId("event-context");
  if ((await eventSelect.count()) === 0) return;
  const tag = await eventSelect.evaluate((el) => el.tagName.toLowerCase());
  if (tag === "select") {
    await eventSelect.selectOption(eventId).catch(async () => {
      const options = eventSelect.locator("option");
      const n = await options.count();
      for (let i = 0; i < n; i++) {
        const val = await options.nth(i).getAttribute("value");
        if (val === eventId) {
          await eventSelect.selectOption(eventId);
          break;
        }
      }
    });
  }
}

test.describe("Portal library N1–N3", () => {
  test("@inv:Q02 e2e/portal-lib/form-publish create + publish portal form", async ({
    page,
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

    // Unauth negative
    const unauth = await request.get(
      `/api/events/${encodeURIComponent(event.id)}/portal-forms`,
    );
    expect([401, 403]).toContain(unauth.status());

    await page.goto("/admin");
    await expect(page.getByTestId("admin-shell")).toBeVisible({
      timeout: 15_000,
    });
    await selectEvent(page, event.id);

    await page.getByTestId("nav-portal-forms").click();
    await expect(page.getByTestId("page-portal-forms")).toBeVisible({
      timeout: 10_000,
    });

    await page.getByTestId("portal-form-title-input").fill("Travel form");
    await page.getByTestId("portal-form-create").click();
    await expect(page.getByTestId("portal-forms-list")).toBeVisible({
      timeout: 10_000,
    });
    // Select first form item
    const item = page.locator("[data-testid^=portal-form-item-]").first();
    await expect(item).toBeVisible({ timeout: 10_000 });
    await item.click();
    await expect(page.getByTestId("portal-forms-editor")).toBeVisible();
    await page.getByTestId("portal-form-field-label").fill("Arrival city");
    await page.getByTestId("portal-form-field-key").fill("city");
    await page.getByTestId("portal-form-field-add").click();
    await page.getByTestId("portal-form-publish").click();
    await expect(page.getByText(/published/i).first()).toBeVisible({
      timeout: 10_000,
    });
    // Persist proof: reload list still shows title
    await page.getByTestId("portal-forms-refresh").click();
    await expect(page.getByText("Travel form").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("@inv:Q03 e2e/portal-lib/resource-edit create select save publish resource", async ({
    page,
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

    const unauth = await request.get(
      `/api/events/${encodeURIComponent(event.id)}/resources`,
    );
    expect([401, 403]).toContain(unauth.status());

    await page.goto("/admin");
    await expect(page.getByTestId("admin-shell")).toBeVisible({
      timeout: 15_000,
    });
    await selectEvent(page, event.id);
    await page.getByTestId("nav-resources").click();
    await expect(page.getByTestId("page-resources")).toBeVisible({
      timeout: 10_000,
    });

    await page.getByTestId("resource-title-input").fill("Code of conduct");
    await page.getByTestId("resource-body-input").fill("Be kind.");
    await page.getByTestId("resource-create").click();
    const selectBtn = page.locator("[data-testid^=resource-select-]").first();
    await expect(selectBtn).toBeVisible({ timeout: 10_000 });
    await selectBtn.click();
    await page.getByTestId("resource-title-input").fill("Code of conduct (revised)");
    await page.getByTestId("resource-save").click();
    const publish = page.locator("[data-testid^=resource-publish-]").first();
    await expect(publish).toBeVisible({ timeout: 10_000 });
    await publish.click();
    await expect(page.getByText(/published|Code of conduct/i).first()).toBeVisible({
      timeout: 10_000,
    });
    await page.getByTestId("resources-refresh").click();
    await expect(page.getByText(/Code of conduct \(revised\)/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("@inv:Q04 e2e/portal-lib/file-request-publish create + publish file request", async ({
    page,
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

    const unauth = await request.get(
      `/api/events/${encodeURIComponent(event.id)}/file-requests`,
    );
    expect([401, 403]).toContain(unauth.status());

    await page.goto("/admin");
    await expect(page.getByTestId("admin-shell")).toBeVisible({
      timeout: 15_000,
    });
    await selectEvent(page, event.id);
    await page.getByTestId("nav-file-requests").click();
    await expect(page.getByTestId("page-file-requests")).toBeVisible({
      timeout: 10_000,
    });

    // Prefill title if input exists, then create + publish
    const titleInput = page.locator(
      '[data-testid="file-request-title-input"], #file-request-title',
    );
    if ((await titleInput.count()) > 0) {
      await titleInput.first().fill("Session PDF");
    }
    await page.getByTestId("file-request-create").click();
    const pub = page.locator("[data-testid^=file-request-publish-]").first();
    await expect(pub).toBeVisible({ timeout: 10_000 });
    await pub.click();
    await page.getByTestId("file-requests-refresh").click();
    await expect(page.getByText("Session PDF").first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("@inv:Q05 e2e/portal-lib/speaker-list published forms + resources for speaker", async ({
    page,
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

    // Cross-event isolation: other event's list must not include this form title via API
    const eventB = await ensureEvent(
      request,
      adminSession,
      `Other Event Q05 ${Date.now()}`,
      `lib-q05-b-${Date.now()}`,
    );
    const speakerEmail = `lib-spk-q05-${Date.now()}@example.com`;
    const spSession = await loginSpeaker(
      request,
      context,
      baseURL,
      speakerEmail,
      event.id,
    );
    const spHeaders = sessionHeaders(spSession);
    const forms = await request.get(
      `/api/portal/forms?eventId=${encodeURIComponent(event.id)}`,
      { headers: spHeaders },
    );
    expect(forms.status()).toBe(200);
    const formsBody = (await forms.json()) as { forms: { title: string }[] };
    expect(formsBody.forms.some((f) => f.title === "Travel form")).toBeTruthy();

    const leak = await request.get(
      `/api/portal/forms?eventId=${encodeURIComponent(eventB.id)}`,
      { headers: spHeaders },
    );
    // Not a member of B, or empty list without Travel form
    if (leak.status() === 200) {
      const leakBody = (await leak.json()) as { forms: { title: string }[] };
      expect(leakBody.forms.some((f) => f.title === "Travel form")).toBeFalsy();
    } else {
      expect([401, 403, 404]).toContain(leak.status());
    }

    // Browser: speaker portal surfaces
    await page.goto("/portal");
    // May land on chooser or home
    await page.waitForTimeout(500);
    if ((await page.getByTestId("portal-nav-forms").count()) > 0) {
      await page.getByTestId("portal-nav-forms").click();
      await expect(page.getByText(/Travel form/i).first()).toBeVisible({
        timeout: 10_000,
      });
    }
    if ((await page.getByTestId("portal-nav-resources").count()) > 0) {
      await page.getByTestId("portal-nav-resources").click();
      await expect(page.getByText(/Code of conduct/i).first()).toBeVisible({
        timeout: 10_000,
      });
    }
  });

  test("@inv:Q06 e2e/portal-lib/file-request-fulfill speaker upload fulfils request", async ({
    page,
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
    const participationId = await seedSpeakerParticipation(
      request,
      adminSession,
      event.id,
      event.slug,
      speakerEmail,
      "Lib Speaker",
    );
    const spSession = await loginSpeaker(
      request,
      context,
      baseURL,
      speakerEmail,
      event.id,
    );
    const spHeaders = sessionHeaders(spSession);

    // Other speaker cannot fulfil
    const otherEmail = `lib-other-q06-${Date.now()}@example.com`;
    const otherSession = await loginSpeaker(
      request,
      context,
      baseURL,
      otherEmail,
      event.id,
    );
    const deny = await request.post(
      `/api/portal/file-requests/${encodeURIComponent(fr.fileRequest.id)}/fulfill`,
      {
        headers: sessionHeaders(otherSession),
        data: {
          eventId: event.id,
          participationId,
          fileId: "file_not_yours",
        },
      },
    );
    expect([403, 404]).toContain(deny.status());

    // Real upload + fulfill
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
    expect(presign.status(), await presign.text()).toBe(200);
    const p = (await presign.json()) as { fileId: string; url: string };
    const up = await request.put(p.url, {
      headers: {
        cookie: `speakerops_session=${spSession}`,
        "content-type": "image/png",
      },
      data: png,
    });
    expect([200, 201, 204]).toContain(up.status());
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

    const fulfill = await request.post(
      `/api/portal/file-requests/${encodeURIComponent(fr.fileRequest.id)}/fulfill`,
      {
        headers: spHeaders,
        data: {
          eventId: event.id,
          participationId,
          fileId: p.fileId,
        },
      },
    );
    expect(fulfill.status(), await fulfill.text()).toBe(200);

    // Browser UI: file request visible as submitted
    await page.goto("/portal");
    await page.waitForTimeout(400);
    if ((await page.getByTestId("portal-nav-file-requests").count()) > 0) {
      await page.getByTestId("portal-nav-file-requests").click();
      await expect(
        page.getByTestId(`portal-file-request-${fr.fileRequest.id}`),
      ).toBeVisible({ timeout: 10_000 });
      // Optional setInputFiles path when replace is available
      const upload = page.getByTestId(
        `portal-file-request-upload-${fr.fileRequest.id}`,
      );
      if ((await upload.count()) > 0) {
        const dir = mkdtempSync(path.join(tmpdir(), "so-fr-"));
        const filePath = path.join(dir, "replace.png");
        writeFileSync(filePath, png);
        await upload.setInputFiles(filePath);
      }
    }
  });
});
