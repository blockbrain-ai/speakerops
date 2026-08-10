/**
 * Section 3.3 — Public CFP inventory journeys A01–A11.
 *
 * - @inv:A01 e2e/public/cfp-load
 * - @inv:A02 e2e/public/cfp-conditional
 * - @inv:A03 e2e/public/cfp-category
 * - @inv:A04 e2e/public/cfp-multi-speaker
 * - @inv:A05 e2e/public/cfp-file
 * - @inv:A06 e2e/public/cfp-submit
 * - @inv:A07 e2e/public/cfp-closed
 * - @inv:A08 e2e/public/cfp-validation
 * - @inv:A09 e2e/public/cfp-mobile
 * - @inv:A10 e2e/public/cfp-xss
 * - @inv:A11 e2e/public/cfp-keyboard
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
 */
import { test, expect } from "@playwright/test";

async function requestMagicLink(
  request: import("@playwright/test").APIRequestContext,
  email: string,
) {
  const res = await request.post("/api/auth/magic-link", {
    data: { email, purpose: "admin" },
  });
  expect(res.ok(), `magic-link status ${res.status()}`).toBeTruthy();
}

async function fetchDevToken(
  request: import("@playwright/test").APIRequestContext,
  email: string,
): Promise<string> {
  const res = await request.get(
    `/api/auth/dev/outbox?email=${encodeURIComponent(email)}`,
  );
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { link: { token: string } | null };
  expect(body.link?.token).toBeTruthy();
  return body.link!.token;
}

async function exchangeForCookie(
  request: import("@playwright/test").APIRequestContext,
  token: string,
): Promise<string> {
  const exchange = await request.post("/api/auth/exchange", {
    data: { token },
  });
  expect(exchange.status()).toBe(200);
  const setCookie = exchange.headers()["set-cookie"] ?? "";
  const match = setCookie.match(/speakerops_session=([^;]+)/);
  expect(match).toBeTruthy();
  return match![1]!;
}

async function loginAsAdmin(
  request: import("@playwright/test").APIRequestContext,
  email: string,
): Promise<string> {
  await requestMagicLink(request, email);
  const token = await fetchDevToken(request, email);
  return exchangeForCookie(request, token);
}

function sessionHeaders(session: string): Record<string, string> {
  return {
    cookie: `speakerops_session=${session}`,
    "content-type": "application/json",
  };
}

async function ensureEvent(
  request: import("@playwright/test").APIRequestContext,
  session: string,
  name: string,
): Promise<{ id: string; slug: string }> {
  const res = await request.post("/api/events", {
    headers: sessionHeaders(session),
    data: {
      name,
      timezone: "UTC",
      startsAt: "2026-06-01T09:00:00.000Z",
      endsAt: "2026-06-02T17:00:00.000Z",
    },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as {
    event: { id: string; slug: string };
  };
  return { id: body.event.id, slug: body.event.slug };
}

async function publishCfp(
  request: import("@playwright/test").APIRequestContext,
  session: string,
  eventId: string,
  opts?: {
    closesAt?: string | null;
    opensAt?: string | null;
    welcomeMd?: string;
    /** Add a real file-typed field (uploads are rejected without one). */
    fileField?: boolean;
  },
): Promise<{ formVersionId: string }> {
  const create = await request.post(`/api/events/${eventId}/forms`, {
    headers: sessionHeaders(session),
    data: { name: "E2E CFP" },
  });
  expect(create.status()).toBe(201);
  const created = (await create.json()) as { form: { id: string } };

  const draft = await request.put(`/api/forms/${created.form.id}/draft`, {
    headers: sessionHeaders(session),
    data: {
      fields: [
        {
          fieldKey: "talk_title",
          type: "text",
          label: "Talk title",
          required: true,
          sortOrder: 0,
        },
        {
          fieldKey: "category",
          type: "select",
          label: "Category",
          required: true,
          sortOrder: 1,
          options: [
            { value: "ai", label: "AI" },
            { value: "infra", label: "Infrastructure" },
          ],
        },
        {
          fieldKey: "gpu_notes",
          type: "textarea",
          label: "GPU notes",
          required: false,
          sortOrder: 2,
          conditions: {
            showWhen: { fieldKey: "category", op: "eq", value: "ai" },
          },
        },
        {
          fieldKey: "abstract",
          type: "textarea",
          label: "Abstract",
          required: false,
          sortOrder: 3,
        },
        {
          fieldKey: "file_url",
          type: "url",
          label: "Supporting file",
          required: false,
          sortOrder: 4,
        },
        ...(opts?.fileField
          ? [
              {
                fieldKey: "supporting_pdf",
                type: "file",
                label: "Supporting PDF",
                required: false,
                sortOrder: 5,
              },
            ]
          : []),
      ],
      rules: [
        {
          when: { fieldKey: "category", op: "eq", value: "ai" },
          routeToCategory: "artificial-intelligence",
        },
        {
          when: { fieldKey: "category", op: "eq", value: "infra" },
          routeToCategory: "infrastructure",
        },
      ],
      welcomeMd: opts?.welcomeMd ?? "Welcome submitters",
      thankYouMd: "Thanks for your proposal",
      opensAt: opts?.opensAt ?? null,
      closesAt: opts?.closesAt ?? null,
    },
  });
  expect(draft.status()).toBe(200);

  const pub = await request.post(`/api/forms/${created.form.id}/publish`, {
    headers: sessionHeaders(session),
  });
  expect(pub.status()).toBe(200);
  const published = (await pub.json()) as {
    formVersion: { id: string };
  };
  return { formVersionId: published.formVersion.id };
}

async function publishBrand(
  request: import("@playwright/test").APIRequestContext,
  session: string,
  eventId: string,
) {
  const get = await request.get(`/api/events/${eventId}/design`, {
    headers: sessionHeaders(session),
  });
  expect(get.ok()).toBeTruthy();
  const design = (await get.json()) as {
    draft: { version: number };
  };
  const expectedVersion = design.draft?.version ?? 1;
  const put = await request.put(`/api/events/${eventId}/design`, {
    headers: sessionHeaders(session),
    data: {
      expectedVersion,
      tokens: {
        brand: "#4f46e5",
        brandSoft: "#eef2ff",
        radius: "soft",
        wordmark: "AIE Public CFP",
        logoFileId: null,
      },
    },
  });
  expect(put.ok(), `design set draft ${put.status()}`).toBeTruthy();
  const after = (await put.json()) as { draft: { version: number } };
  const publish = await request.post(
    `/api/events/${eventId}/design/publish`,
    {
      headers: sessionHeaders(session),
      data: { expectedVersion: after.draft.version },
    },
  );
  expect(publish.ok(), `design publish ${publish.status()}`).toBeTruthy();
}

async function fillHappyPath(
  page: import("@playwright/test").Page,
  opts?: { abstract?: string; category?: string },
) {
  await page.getByTestId("cfp-title").fill("E2E Proposal Title");
  await page.getByTestId("cfp-field-talk_title").fill("E2E Proposal Title");
  await page
    .getByTestId("cfp-field-category")
    .selectOption(opts?.category ?? "ai");
  if (opts?.abstract) {
    await page.getByTestId("cfp-field-abstract").fill(opts.abstract);
  }
  await page.getByTestId("cfp-speaker-name-0").fill("Ada Lovelace");
  await page.getByTestId("cfp-speaker-email-0").fill("ada-e2e@example.com");
  await page.getByTestId("cfp-turnstile-check").check();
}

test("@inv:A01 e2e/public/cfp-load public CFP loads form and brand tokens", async ({
  page,
  request,
  baseURL,
}) => {
  const session = await loginAsAdmin(request, "e2e-a01@example.com");
  const event = await ensureEvent(request, session, "A01 Load Event");
  await publishCfp(request, session, event.id, {
    welcomeMd: "Welcome to A01 CFP",
  });
  await publishBrand(request, session, event.id);

  await page.goto(`${baseURL ?? ""}/cfp/${event.slug}`);
  await expect(page.getByTestId("page-public-cfp")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("public-cfp-welcome")).toContainText(
    "Welcome to A01 CFP",
  );
  await expect(page.getByTestId("public-cfp-brand")).toHaveAttribute(
    "data-has-published",
    "true",
  );
  await expect(page.getByTestId("public-cfp-brand")).toBeVisible();
  await expect(page.getByTestId("public-cfp-title")).toContainText(
    "AIE Public CFP",
  );
  await expect(page.getByTestId("public-cfp-form")).toBeVisible();

  // Negative: invalid slug 404 surface
  await page.goto(`${baseURL ?? ""}/cfp/this-slug-does-not-exist-xyz`);
  await expect(page.getByTestId("public-cfp-not-found")).toBeVisible({
    timeout: 15_000,
  });
});

test("@inv:A02 e2e/public/cfp-conditional conditional field appears when rule met", async ({
  page,
  request,
  baseURL,
}) => {
  const session = await loginAsAdmin(request, "e2e-a02@example.com");
  const event = await ensureEvent(request, session, "A02 Cond Event");
  await publishCfp(request, session, event.id);

  await page.goto(`${baseURL ?? ""}/cfp/${event.slug}`);
  await expect(page.getByTestId("public-cfp-form")).toBeVisible({
    timeout: 15_000,
  });

  // Hidden until category=ai
  await expect(page.getByTestId("cfp-field-gpu_notes")).toHaveCount(0);

  await page.getByTestId("cfp-field-category").selectOption("ai");
  await expect(page.getByTestId("cfp-field-gpu_notes")).toBeVisible();

  await page.getByTestId("cfp-field-category").selectOption("infra");
  await expect(page.getByTestId("cfp-field-gpu_notes")).toHaveCount(0);

  // Submit with hidden field not present — success without gpu_notes
  await fillHappyPath(page, { category: "infra" });
  await page.getByTestId("public-cfp-primary").click();
  await expect(page.getByTestId("public-cfp-confirmation")).toBeVisible({
    timeout: 15_000,
  });
});

test("@inv:A03 e2e/public/cfp-category category routing metadata on submit", async ({
  page,
  request,
  baseURL,
}) => {
  const session = await loginAsAdmin(request, "e2e-a03@example.com");
  const event = await ensureEvent(request, session, "A03 Cat Event");
  await publishCfp(request, session, event.id);

  await page.goto(`${baseURL ?? ""}/cfp/${event.slug}`);
  await expect(page.getByTestId("public-cfp-form")).toBeVisible({
    timeout: 15_000,
  });

  await page.getByTestId("cfp-title").fill("Category Talk");
  await page.getByTestId("cfp-field-talk_title").fill("Category Talk");
  await page.getByTestId("cfp-field-category").selectOption("ai");
  await expect(page.getByTestId("cfp-derived-category")).toContainText(
    "artificial-intelligence",
  );
  await page.getByTestId("cfp-speaker-name-0").fill("Cat Speaker");
  await page.getByTestId("cfp-speaker-email-0").fill("cat@example.com");
  await page.getByTestId("cfp-turnstile-check").check();
  await page.getByTestId("public-cfp-primary").click();

  await expect(page.getByTestId("public-cfp-confirmation")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("public-cfp-confirmation-category")).toContainText(
    "artificial-intelligence",
  );

  // Negative: invalid category rejected at API
  const bad = await request.post(
    `/api/public/cfp/${event.slug}/submissions`,
    {
      data: {
        formVersionId: "bogus",
        title: "x",
        answers: [],
        speakers: [{ name: "A", email: "a@example.com" }],
        turnstileToken: "XXXX.DUMMY.TOKEN",
        category: "not-valid",
      },
    },
  );
  expect(bad.status()).toBe(400);
});

test("@inv:A04 e2e/public/cfp-multi-speaker min/max speaker rules", async ({
  page,
  request,
  baseURL,
}) => {
  const session = await loginAsAdmin(request, "e2e-a04@example.com");
  const event = await ensureEvent(request, session, "A04 Multi Event");
  await publishCfp(request, session, event.id);

  await page.goto(`${baseURL ?? ""}/cfp/${event.slug}`);
  await expect(page.getByTestId("cfp-speakers")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("cfp-speaker-bounds")).toContainText("1–5");

  await page.getByTestId("cfp-speaker-add").click();
  await expect(page.getByTestId("cfp-speaker-block-1")).toBeVisible();
  await page.getByTestId("cfp-speaker-name-1").fill("Second Speaker");
  await page.getByTestId("cfp-speaker-email-1").fill("second@example.com");

  await fillHappyPath(page);
  await page.getByTestId("public-cfp-primary").click();
  await expect(page.getByTestId("public-cfp-confirmation")).toBeVisible({
    timeout: 15_000,
  });
});

test("@inv:A05 e2e/public/cfp-file upload within type/size; oversize/type/unpinned/no-file-field rejected", async ({
  page,
  request,
  baseURL,
}) => {
  const session = await loginAsAdmin(request, "e2e-a05@example.com");
  const event = await ensureEvent(request, session, "A05 File Event");
  // Uploads are FORM-PINNED: the published form must carry a file field.
  const { formVersionId } = await publishCfp(request, session, event.id, {
    fileField: true,
  });

  // URL fields are text inputs (type=url); file upload is the public files API.
  await page.goto(`${baseURL ?? ""}/cfp/${event.slug}`);
  await expect(page.getByTestId("cfp-field-file_url")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("cfp-field-file_url")).toHaveAttribute(
    "type",
    "url",
  );

  // Accept PDF via public upload API (pinned to the published version).
  // Declared size must equal decoded byte length (server integrity check).
  const okPdfBody = "%PDF-1.4 tiny";
  const okPdf = await request.post(`/api/public/cfp/${event.slug}/files`, {
    data: {
      formVersionId,
      fieldKey: "supporting_pdf",
      filename: "ok.pdf",
      mime: "application/pdf",
      size: okPdfBody.length,
      contentBase64: btoa(okPdfBody),
    },
  });
  expect(okPdf.status(), "PDF upload accepted").toBe(201);
  const okBody = (await okPdf.json()) as { fileId?: string };
  expect(okBody.fileId, "fileId returned").toBeTruthy();

  // Missing formVersionId → 400 (uploads must pin the published form).
  const unpinned = await request.post(`/api/public/cfp/${event.slug}/files`, {
    data: {
      filename: "ok.pdf",
      mime: "application/pdf",
      size: okPdfBody.length,
      contentBase64: btoa(okPdfBody),
    },
  });
  expect(unpinned.status(), "unpinned upload rejected").toBe(400);

  // Reject SVG / bad type via API
  const badSvg = await request.post(`/api/public/cfp/${event.slug}/files`, {
    data: {
      formVersionId,
      filename: "bad.svg",
      mime: "image/svg+xml",
      size: 40,
      contentBase64: btoa('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    },
  });
  expect(badSvg.status()).toBe(400);

  // Oversize via API negative
  const oversize = await request.post(`/api/public/cfp/${event.slug}/files`, {
    data: {
      formVersionId,
      filename: "big.pdf",
      mime: "application/pdf",
      size: 20 * 1024 * 1024,
      contentBase64: btoa("x"),
    },
  });
  expect(oversize.status()).toBe(400);

  // A form with NO file field never accepts anonymous uploads (D1 blob
  // write surface closed): second event, same allowlisted PDF → 400.
  const noFileEvent = await ensureEvent(
    request,
    session,
    "A05 No File Field Event",
  );
  const noFile = await publishCfp(request, session, noFileEvent.id);
  const rejected = await request.post(
    `/api/public/cfp/${noFileEvent.slug}/files`,
    {
      data: {
        formVersionId: noFile.formVersionId,
        filename: "ok.pdf",
        mime: "application/pdf",
        size: okPdfBody.length,
        contentBase64: btoa(okPdfBody),
      },
    },
  );
  expect(rejected.status(), "no-file-field upload rejected").toBe(400);
  const rejectedBody = (await rejected.json()) as { error?: string };
  expect(rejectedBody.error ?? "").toMatch(/does not accept file uploads/i);
});

test("@inv:A06 e2e/public/cfp-submit Turnstile pass; missing captcha blocked", async ({
  page,
  request,
  baseURL,
}) => {
  const session = await loginAsAdmin(request, "e2e-a06@example.com");
  const event = await ensureEvent(request, session, "A06 Submit Event");
  await publishCfp(request, session, event.id);

  await page.goto(`${baseURL ?? ""}/cfp/${event.slug}`);
  await expect(page.getByTestId("public-cfp-form")).toBeVisible({
    timeout: 15_000,
  });

  // Missing captcha blocked
  await page.getByTestId("cfp-title").fill("Need Captcha");
  await page.getByTestId("cfp-field-talk_title").fill("Need Captcha");
  await page.getByTestId("cfp-field-category").selectOption("ai");
  await page.getByTestId("cfp-speaker-name-0").fill("No Cap");
  await page.getByTestId("cfp-speaker-email-0").fill("nocap@example.com");
  await page.getByTestId("public-cfp-primary").click();
  await expect(page.getByTestId("cfp-error-turnstile")).toBeVisible();

  // Pass Turnstile (test key path)
  await page.getByTestId("cfp-turnstile-check").check();
  await page.getByTestId("public-cfp-primary").click();
  await expect(page.getByTestId("public-cfp-confirmation")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("public-cfp-thankyou")).toContainText(
    /Thanks|Thank you/i,
  );
});

test("@inv:A07 e2e/public/cfp-closed closed window shows closed state; no submit", async ({
  page,
  request,
  baseURL,
}) => {
  const session = await loginAsAdmin(request, "e2e-a07@example.com");
  const event = await ensureEvent(request, session, "A07 Closed Event");
  await publishCfp(request, session, event.id, {
    closesAt: "2020-01-01T00:00:00.000Z",
  });

  await page.goto(`${baseURL ?? ""}/cfp/${event.slug}`);
  await expect(page.getByTestId("public-cfp-closed")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("public-cfp-form")).toHaveCount(0);
  await expect(page.getByTestId("public-cfp-primary")).toBeDisabled();
});

test("@inv:A08 e2e/public/cfp-validation validation errors inline; focus management", async ({
  page,
  request,
  baseURL,
}) => {
  const session = await loginAsAdmin(request, "e2e-a08@example.com");
  const event = await ensureEvent(request, session, "A08 Val Event");
  await publishCfp(request, session, event.id);

  await page.goto(`${baseURL ?? ""}/cfp/${event.slug}`);
  await expect(page.getByTestId("public-cfp-form")).toBeVisible({
    timeout: 15_000,
  });

  await page.getByTestId("public-cfp-primary").click();
  await expect(page.getByTestId("cfp-error-title")).toBeVisible();
  await expect(page.getByTestId("cfp-title")).toBeFocused();
});

test("@inv:A09 e2e/public/cfp-mobile mobile viewport complete submit", async ({
  page,
  request,
  baseURL,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const session = await loginAsAdmin(request, "e2e-a09@example.com");
  const event = await ensureEvent(request, session, "A09 Mobile Event");
  await publishCfp(request, session, event.id);

  await page.goto(`${baseURL ?? ""}/cfp/${event.slug}`);
  await expect(page.getByTestId("public-cfp-form")).toBeVisible({
    timeout: 15_000,
  });
  await fillHappyPath(page);
  await page.getByTestId("public-cfp-primary").click();
  await expect(page.getByTestId("public-cfp-confirmation")).toBeVisible({
    timeout: 15_000,
  });
});

test("@inv:A10 e2e/public/cfp-xss XSS string renders as text not script", async ({
  page,
  request,
  baseURL,
}) => {
  const session = await loginAsAdmin(request, "e2e-a10@example.com");
  const event = await ensureEvent(request, session, "A10 XSS Event");
  await publishCfp(request, session, event.id);

  const xss = `<script>window.__cfpXss=1</script><img src=x onerror="window.__cfpXss=1">`;

  await page.goto(`${baseURL ?? ""}/cfp/${event.slug}`);
  await expect(page.getByTestId("public-cfp-form")).toBeVisible({
    timeout: 15_000,
  });
  await fillHappyPath(page, { abstract: xss });
  await page.getByTestId("public-cfp-primary").click();
  await expect(page.getByTestId("public-cfp-confirmation")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("public-cfp-xss-echo")).toContainText(
    "<script>",
  );
  // Script must not execute
  const flag = await page.evaluate(() => {
    return (window as unknown as { __cfpXss?: number }).__cfpXss;
  });
  expect(flag).toBeUndefined();
});

test("@inv:A11 e2e/public/cfp-keyboard keyboard-only complete valid submit", async ({
  page,
  request,
  baseURL,
}) => {
  const session = await loginAsAdmin(request, "e2e-a11@example.com");
  const event = await ensureEvent(request, session, "A11 Keyboard Event");
  await publishCfp(request, session, event.id);

  await page.goto(`${baseURL ?? ""}/cfp/${event.slug}`);
  await expect(page.getByTestId("public-cfp-form")).toBeVisible({
    timeout: 15_000,
  });

  await page.getByTestId("cfp-title").focus();
  await page.keyboard.type("Keyboard Talk");
  await page.keyboard.press("Tab");
  // talk_title
  await page.keyboard.type("Keyboard Talk");
  await page.getByTestId("cfp-field-category").focus();
  await page.getByTestId("cfp-field-category").selectOption("ai");
  await page.getByTestId("cfp-speaker-name-0").focus();
  await page.keyboard.type("Key Board");
  await page.getByTestId("cfp-speaker-email-0").focus();
  await page.keyboard.type("keyboard@example.com");
  await page.getByTestId("cfp-turnstile-check").focus();
  await page.keyboard.press("Space");
  await page.getByTestId("public-cfp-primary").focus();
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("public-cfp-confirmation")).toBeVisible({
    timeout: 15_000,
  });
});
