/**
 * Section 2.4 — Design Kit inventory journeys.
 *
 * - @inv:C03 e2e/admin/design-color
 * - @inv:C04 e2e/admin/design-logo
 * - @inv:C05 e2e/admin/design-publish
 * - @inv:C06 e2e/admin/design-no-css
 * - @inv:C08 e2e/admin/design-contrast
 * - @inv:C09 e2e/admin/design-logo-xss
 * - @inv:C10 e2e/admin/design-draft-isolation
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
 */
import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "e2e-design-admin@example.com";

/** Minimal 1×1 PNG (valid image/png). */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function requestMagicLink(
  request: import("@playwright/test").APIRequestContext,
  email: string,
  purpose: "admin" | "speaker" | "evaluator" = "admin",
  eventId?: string,
) {
  const data: Record<string, string> = { email, purpose };
  if (eventId) data.eventId = eventId;
  const res = await request.post("/api/auth/magic-link", { data });
  expect(res.ok(), `magic-link status ${res.status()}`).toBeTruthy();
}

async function fetchDevToken(
  request: import("@playwright/test").APIRequestContext,
  email: string,
): Promise<string> {
  const res = await request.get(
    `/api/auth/dev/outbox?email=${encodeURIComponent(email)}`,
  );
  expect(res.ok(), `dev outbox status ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { link: { token: string } | null };
  expect(body.link?.token, "dev outbox must capture token").toBeTruthy();
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
  context: import("@playwright/test").BrowserContext,
  baseURL: string | undefined,
  email = ADMIN_EMAIL,
): Promise<string> {
  await requestMagicLink(request, email, "admin");
  const token = await fetchDevToken(request, email);
  const sessionValue = await exchangeForCookie(request, token);
  await context.addCookies([
    {
      name: "speakerops_session",
      value: sessionValue,
      url: baseURL ?? "http://127.0.0.1:5173",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
  return sessionValue;
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
      slug: name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40),
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as {
    event: { id: string; slug: string };
  };
  return { id: body.event.id, slug: body.event.slug };
}

async function waitForEventSelect(page: import("@playwright/test").Page) {
  const switcher = page.getByTestId("event-context");
  await expect(switcher).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(
      async () => {
        const tag = await switcher.evaluate((el) => el.tagName.toLowerCase());
        return tag;
      },
      { timeout: 15_000 },
    )
    .toBe("select");
  return switcher;
}

test("@inv:C03 e2e/admin/design-color set brand; live preview updates", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const session = await loginAsAdmin(
    request,
    context,
    baseURL,
    "e2e-c03@example.com",
  );
  const event = await ensureEvent(request, session, "C03 Brand Event");

  await page.goto("/admin/settings/design");
  await waitForEventSelect(page);
  await page.getByTestId("event-context").selectOption(event.id);

  await expect(page.getByTestId("page-design-kit")).toBeVisible();
  const hex = page.getByTestId("design-brand-hex");
  await hex.fill("#00aa88");
  await expect(page.getByTestId("design-preview-brand")).toContainText(
    "#00aa88",
  );
  const btn = page.getByTestId("design-preview-button");
  await expect(btn).toBeVisible();
});

test("@inv:C04 e2e/admin/design-logo upload PNG; preview", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const session = await loginAsAdmin(
    request,
    context,
    baseURL,
    "e2e-c04@example.com",
  );
  const event = await ensureEvent(request, session, "C04 Logo Event");

  await page.goto("/admin/settings/design");
  await waitForEventSelect(page);
  await page.getByTestId("event-context").selectOption(event.id);

  await page.getByTestId("design-logo-input").setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: TINY_PNG,
  });
  await expect(page.getByTestId("design-logo-status")).toContainText(
    /Logo ready|ready/i,
    { timeout: 10_000 },
  );
  await expect(page.getByTestId("design-preview-logo")).toBeVisible();
  await expect(page.getByTestId("design-logo-file-id")).toBeVisible();
});

test("@inv:C05 e2e/admin/design-publish publish; public CFP shows brand", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const session = await loginAsAdmin(
    request,
    context,
    baseURL,
    "e2e-c05@example.com",
  );
  const event = await ensureEvent(request, session, "C05 Publish Event");

  await page.goto("/admin/settings/design");
  await waitForEventSelect(page);
  await page.getByTestId("event-context").selectOption(event.id);

  await page.getByTestId("design-brand-hex").fill("#3366cc");
  await page.getByTestId("design-wordmark").fill("C05 Summit");
  await page.getByTestId("design-save-draft").click();
  await expect(page.getByTestId("design-save-status")).toContainText(
    /Draft saved/i,
    { timeout: 10_000 },
  );

  await page.getByTestId("design-publish").click();
  await expect(page.getByTestId("design-publish-status")).toContainText(
    /Published/i,
    { timeout: 10_000 },
  );

  await page.goto(`/cfp/${event.slug}`);
  await expect(page.getByTestId("page-public-cfp")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("public-cfp-brand-value")).toContainText(
    /#3366cc/i,
    { timeout: 10_000 },
  );
  await expect(page.getByTestId("public-cfp-title")).toContainText("C05 Summit");

  // BC01 / S-THEME binding evidence: successful-state public CFP screenshot.
  // Set E2E_CAPTURE_BC01_SCREENSHOT=1 to regenerate the committed artifact.
  // Path: KMS-competition/initiative/evidence/phase2-c05-public-cfp.png
  if (process.env.E2E_CAPTURE_BC01_SCREENSHOT === "1") {
    await page.screenshot({
      path: "KMS-competition/initiative/evidence/phase2-c05-public-cfp.png",
      fullPage: true,
    });
  }
});

test("@inv:C06 e2e/admin/design-no-css freeform CSS control absent", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const session = await loginAsAdmin(
    request,
    context,
    baseURL,
    "e2e-c06@example.com",
  );
  const event = await ensureEvent(request, session, "C06 No CSS Event");

  await page.goto("/admin/settings/design");
  await waitForEventSelect(page);
  await page.getByTestId("event-context").selectOption(event.id);

  await expect(page.getByTestId("page-design-kit")).toBeVisible();
  await expect(page.locator('[data-testid="design-custom-css"]')).toHaveCount(0);
  await expect(page.locator('textarea[name="css"]')).toHaveCount(0);
  await expect(page.locator('textarea[name="customCss"]')).toHaveCount(0);
  await expect(page.getByLabel(/custom css|freeform css/i)).toHaveCount(0);
});

test("@inv:C08 e2e/admin/design-contrast near-white brand safe fg or block", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const session = await loginAsAdmin(
    request,
    context,
    baseURL,
    "e2e-c08@example.com",
  );
  const event = await ensureEvent(request, session, "C08 Contrast Event");

  await page.goto("/admin/settings/design");
  await waitForEventSelect(page);
  await page.getByTestId("event-context").selectOption(event.id);

  await page.getByTestId("design-brand-hex").fill("#fffffe");
  await page.getByTestId("design-save-draft").click();
  await expect(page.getByTestId("design-save-status")).toContainText(
    /Draft saved/i,
    { timeout: 10_000 },
  );

  await page.getByTestId("design-publish").click();
  const status = page.getByTestId("design-publish-status");
  await expect(status).toBeVisible({ timeout: 10_000 });
  const text = (await status.textContent()) ?? "";
  const ok =
    /Published/i.test(text) ||
    /contrast/i.test(text) ||
    /fail/i.test(text);
  expect(ok).toBeTruthy();

  if (/Published/i.test(text)) {
    await page.goto(`/cfp/${event.slug}`);
    await expect(page.getByTestId("public-cfp-brand-value")).toContainText(
      /#fffffe/i,
      { timeout: 10_000 },
    );
    const brandText =
      (await page.getByTestId("public-cfp-brand-value").textContent()) ?? "";
    expect(brandText.toLowerCase()).toMatch(/fg\s+#1d1d1f|fg\s+#000/);
  }
});

test("@inv:C09 e2e/admin/design-logo-xss SVG rejected", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const session = await loginAsAdmin(
    request,
    context,
    baseURL,
    "e2e-c09@example.com",
  );
  const event = await ensureEvent(request, session, "C09 XSS Event");

  const svgRes = await request.post("/api/files/presign", {
    headers: sessionHeaders(session),
    data: {
      eventId: event.id,
      purpose: "logo",
      mime: "image/svg+xml",
      size: 128,
      filename: "x.svg",
    },
  });
  expect(svgRes.status()).toBe(400);
  const body = (await svgRes.json()) as { code: string; error: string };
  expect(body.code).toBe("VALIDATION_ERROR");

  await page.goto("/admin/settings/design");
  await waitForEventSelect(page);
  await page.getByTestId("event-context").selectOption(event.id);

  await page.getByTestId("design-logo-input").setInputFiles({
    name: "evil.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="window.__xss=1"><script>window.__xss=1</script></svg>',
    ),
  });
  await expect(page.getByTestId("design-logo-status")).toContainText(
    /SVG|not allowed|PNG/i,
    { timeout: 10_000 },
  );
  const xss = await page.evaluate(
    () => (window as unknown as { __xss?: number }).__xss,
  );
  expect(xss).toBeUndefined();
});

test("@inv:C10 e2e/admin/design-draft-isolation draft not on public until publish", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const session = await loginAsAdmin(
    request,
    context,
    baseURL,
    "e2e-c10@example.com",
  );
  const event = await ensureEvent(request, session, "C10 Isolation Event");

  await page.goto("/admin/settings/design");
  await waitForEventSelect(page);
  await page.getByTestId("event-context").selectOption(event.id);

  await page.getByTestId("design-brand-hex").fill("#abcdef");
  await page.getByTestId("design-wordmark").fill("DraftSecret");
  await page.getByTestId("design-save-draft").click();
  await expect(page.getByTestId("design-save-status")).toContainText(
    /Draft saved/i,
    { timeout: 10_000 },
  );

  await page.goto(`/cfp/${event.slug}`);
  await expect(page.getByTestId("page-public-cfp")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("public-cfp-brand-value")).toContainText(
    /no published brand/i,
    { timeout: 10_000 },
  );
  await expect(page.getByTestId("public-cfp-brand-value")).not.toContainText(
    "#abcdef",
  );

  await page.goto("/admin/settings/design");
  await waitForEventSelect(page);
  await page.getByTestId("event-context").selectOption(event.id);
  await page.getByTestId("design-publish").click();
  await expect(page.getByTestId("design-publish-status")).toContainText(
    /Published/i,
    { timeout: 10_000 },
  );

  await page.goto(`/cfp/${event.slug}`);
  await expect(page.getByTestId("public-cfp-brand-value")).toContainText(
    /#abcdef/i,
    { timeout: 10_000 },
  );
});
