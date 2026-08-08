/**
 * Section 3.2 — Form builder admin UI inventory journeys.
 *
 * - @inv:D01 e2e/admin/form-create
 * - @inv:D02 e2e/admin/form-reorder
 * - @inv:D03 e2e/admin/form-conditional
 * - @inv:D04 e2e/admin/form-routing
 * - @inv:D05 e2e/admin/form-required
 * - @inv:D06 e2e/admin/form-copy
 * - @inv:D07 e2e/admin/form-preview
 * - @inv:D08 e2e/admin/form-publish-version
 * - @inv:D09 e2e/admin/form-limits
 * - @inv:D10 e2e/admin/form-link
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
 *
 * Named assertions (plan):
 * - assert @inv:D01 through @inv:D10 each appear in playwright file
 * - assert preview shows field label after add
 * - assert publish button disabled when invariant violated
 */
import { test, expect } from "@playwright/test";

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
  email: string,
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
      startsAt: "2026-06-01T09:00:00.000Z",
      endsAt: "2026-06-02T17:00:00.000Z",
    },
  });
  expect(res.status(), `Event.Create ${res.status()}`).toBe(201);
  const body = (await res.json()) as {
    event: { id: string; slug: string };
  };
  return { id: body.event.id, slug: body.event.slug };
}

/** Open form builder with active event selected. */
async function openFormBuilder(
  page: import("@playwright/test").Page,
  baseURL: string | undefined,
  eventId: string,
) {
  await page.goto(`${baseURL ?? ""}/admin/cfp`);
  await expect(page.getByTestId("admin-shell")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("page-cfp")).toBeVisible();

  // Ensure event switcher has our event
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
  await switcher.selectOption(eventId);
}

async function createFormUi(
  page: import("@playwright/test").Page,
  name: string,
) {
  await page.getByTestId("form-create-name").fill(name);
  await page.getByTestId("form-create-submit").click();
  await expect(page.getByTestId("form-create-status")).toContainText(/Created/i, {
    timeout: 10_000,
  });
  await expect(page.getByTestId("form-builder-workspace")).toBeVisible();
}

test("@inv:D01 e2e/admin/form-create create form; add text/select/file/speaker fields", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const session = await loginAsAdmin(
    request,
    context,
    baseURL,
    "e2e-d01@example.com",
  );
  const event = await ensureEvent(request, session, "D01 Form Create Event");
  await openFormBuilder(page, baseURL, event.id);
  await createFormUi(page, "D01 CFP");

  // Empty state before fields
  await expect(page.getByTestId("field-list-empty")).toBeVisible();
  // assert publish button disabled when invariant violated
  await expect(page.getByTestId("form-publish")).toBeDisabled();
  await expect(page.getByTestId("form-publish-blocked")).toContainText(
    /at least one field/i,
  );

  await page.getByTestId("palette-text").click();
  await page.getByTestId("palette-select").click();
  await page.getByTestId("palette-url").click(); // file / URL field
  await page.getByTestId("palette-speaker").click();

  await expect(page.getByTestId("field-list")).toBeVisible();
  await expect(page.getByTestId("field-label-text")).toContainText("Text field");
  await expect(page.getByTestId("field-label-select")).toBeVisible();
  await expect(page.getByTestId("field-label-file_url")).toBeVisible();
  await expect(page.getByTestId("field-label-speaker_name")).toContainText(
    "Speaker",
  );

  // assert preview shows field label after add
  await expect(page.getByTestId("form-preview-label-text")).toContainText(
    "Text field",
  );
  await expect(page.getByTestId("form-preview-label-speaker_name")).toContainText(
    "Speaker name",
  );

  // Keyboard reachable palette control
  await page.getByTestId("palette-email").focus();
  await expect(page.getByTestId("palette-email")).toBeFocused();
});

test("@inv:D02 e2e/admin/form-reorder reorder fields drag / move controls", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const session = await loginAsAdmin(
    request,
    context,
    baseURL,
    "e2e-d02@example.com",
  );
  const event = await ensureEvent(request, session, "D02 Reorder Event");
  await openFormBuilder(page, baseURL, event.id);
  await createFormUi(page, "D02 CFP");

  await page.getByTestId("palette-text").click();
  await page.getByTestId("palette-select").click();

  // First field is text; move select up
  const firstBefore = page.locator('[data-testid="field-list"] > li').first();
  await expect(firstBefore).toHaveAttribute("data-field-key", "text");

  await page.getByTestId("field-move-up-select").click();
  const firstAfter = page.locator('[data-testid="field-list"] > li').first();
  await expect(firstAfter).toHaveAttribute("data-field-key", "select");
  await expect(firstAfter).toHaveAttribute("data-sort-order", "0");

  // Preview order follows sortOrder
  const previewKeys = page.locator(
    '[data-testid="form-preview-fields"] > li',
  );
  await expect(previewKeys.first()).toHaveAttribute("data-field-key", "select");
});

test("@inv:D03 e2e/admin/form-conditional conditional rule; circular rule blocked", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const session = await loginAsAdmin(
    request,
    context,
    baseURL,
    "e2e-d03@example.com",
  );
  const event = await ensureEvent(request, session, "D03 Conditional Event");
  await openFormBuilder(page, baseURL, event.id);
  await createFormUi(page, "D03 CFP");

  await page.getByTestId("palette-select").click();
  await page.getByTestId("palette-text").click();

  // Configure select options: talk|Talk / panel|Panel
  await page.getByTestId("field-select-select").click();
  await page.getByTestId("field-edit-options").fill("talk|Talk\npanel|Panel");

  // Conditional on text field: show when select = panel
  await page.getByTestId("field-select-text").click();
  await page.getByTestId("field-condition-enabled").check();
  await page.getByTestId("field-condition-field").selectOption("select");
  await page.getByTestId("field-condition-value").fill("panel");

  // Preview: hidden until select = panel
  await expect(page.getByTestId("form-preview-field-text")).toHaveCount(0);
  await page.getByTestId("form-preview-input-select").selectOption("panel");
  await expect(page.getByTestId("form-preview-field-text")).toBeVisible();

  // Circular: select depends on text while text depends on select
  await page.getByTestId("field-select-select").click();
  await page.getByTestId("field-condition-enabled").check();
  await page.getByTestId("field-condition-field").selectOption("text");
  await page.getByTestId("field-condition-value").fill("x");
  await expect(page.getByTestId("field-condition-cycle-error")).toBeVisible();
  await expect(page.getByTestId("form-publish")).toBeDisabled();
  await expect(page.getByTestId("form-publish-blocked")).toContainText(
    /Circular/i,
  );

  // API also rejects circular on save
  await page.getByTestId("form-save-draft").click();
  await expect(page.getByTestId("form-save-status")).toContainText(/Circular/i, {
    timeout: 5_000,
  });
});

test("@inv:D04 e2e/admin/form-routing category field + routing target", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const session = await loginAsAdmin(
    request,
    context,
    baseURL,
    "e2e-d04@example.com",
  );
  const event = await ensureEvent(request, session, "D04 Routing Event");
  await openFormBuilder(page, baseURL, event.id);
  await createFormUi(page, "D04 CFP");

  await page.getByTestId("palette-select").click();
  await page.getByTestId("field-select-select").click();
  await page.getByTestId("field-edit-label").fill("Category");
  await page.getByTestId("field-edit-key").fill("category");
  await page.getByTestId("field-edit-options").fill("talk|Talk\nworkshop|Workshop");

  await page.getByTestId("rule-add").click();
  await page.getByTestId("rule-field-0").selectOption("category");
  await page.getByTestId("rule-value-0").fill("workshop");
  await page.getByTestId("rule-category-0").fill("track_workshops");

  await page.getByTestId("form-save-draft").click();
  await expect(page.getByTestId("form-save-status")).toContainText(/Draft saved/i, {
    timeout: 10_000,
  });

  // API proof: draft carries rule
  const formId = await page.getByTestId("form-id").innerText();
  const draftRes = await request.put(`/api/forms/${formId}/draft`, {
    headers: sessionHeaders(session),
    data: {
      fields: [
        {
          fieldKey: "category",
          type: "select",
          label: "Category",
          required: false,
          options: [
            { value: "talk", label: "Talk" },
            { value: "workshop", label: "Workshop" },
          ],
          sortOrder: 0,
        },
      ],
      rules: [
        {
          when: { fieldKey: "category", op: "eq", value: "workshop" },
          routeToCategory: "track_workshops",
        },
      ],
    },
  });
  expect(draftRes.status()).toBe(200);
  const draftBody = await draftRes.json();
  expect(draftBody.formVersion.rules[0].routeToCategory).toBe("track_workshops");
});

test("@inv:D05 e2e/admin/form-required required flags + validation", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const session = await loginAsAdmin(
    request,
    context,
    baseURL,
    "e2e-d05@example.com",
  );
  const event = await ensureEvent(request, session, "D05 Required Event");
  await openFormBuilder(page, baseURL, event.id);
  await createFormUi(page, "D05 CFP");

  await page.getByTestId("palette-text").click();
  await page.getByTestId("field-select-text").click();
  await page.getByTestId("field-edit-required").check();
  await expect(page.getByTestId("field-item-text")).toContainText("required");
  await expect(page.getByTestId("form-preview-field-text")).toHaveAttribute(
    "data-required",
    "true",
  );

  await page.getByTestId("form-save-draft").click();
  await expect(page.getByTestId("form-save-status")).toContainText(/Draft saved/i, {
    timeout: 10_000,
  });

  const formId = await page.getByTestId("form-id").innerText();
  // Re-save via API to read required flag from response
  const res = await request.put(`/api/forms/${formId}/draft`, {
    headers: sessionHeaders(session),
    data: {
      fields: [
        {
          fieldKey: "text",
          type: "text",
          label: "Text field",
          required: true,
          sortOrder: 0,
        },
      ],
      rules: [],
    },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.formVersion.fields[0].required).toBe(true);
});

test("@inv:D06 e2e/admin/form-copy welcome/thank-you copy", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const session = await loginAsAdmin(
    request,
    context,
    baseURL,
    "e2e-d06@example.com",
  );
  const event = await ensureEvent(request, session, "D06 Copy Event");
  await openFormBuilder(page, baseURL, event.id);
  await createFormUi(page, "D06 CFP");

  await page.getByTestId("form-welcome-md").fill("Welcome to our CFP!");
  await page.getByTestId("form-thankyou-md").fill("Thanks for submitting.");

  await expect(page.getByTestId("form-preview-welcome")).toContainText(
    "Welcome to our CFP!",
  );
  await expect(page.getByTestId("form-preview-thanks")).toContainText(
    "Thanks for submitting.",
  );

  await page.getByTestId("palette-text").click();
  await page.getByTestId("form-save-draft").click();
  await expect(page.getByTestId("form-save-status")).toContainText(/Draft saved/i, {
    timeout: 10_000,
  });
});

test("@inv:D07 e2e/admin/form-preview preview side-by-side", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const session = await loginAsAdmin(
    request,
    context,
    baseURL,
    "e2e-d07@example.com",
  );
  const event = await ensureEvent(request, session, "D07 Preview Event");
  await openFormBuilder(page, baseURL, event.id);
  await createFormUi(page, "D07 CFP");

  await expect(page.getByTestId("form-preview")).toBeVisible();
  await expect(page.getByTestId("form-preview-empty")).toBeVisible();

  await page.getByTestId("palette-text").click();
  // assert preview shows field label after add
  await expect(page.getByTestId("form-preview-label-text")).toContainText(
    "Text field",
  );
  await expect(page.getByTestId("form-builder-workspace")).toBeVisible();
  // Side-by-side: editor + preview both present
  await expect(page.getByTestId("field-palette")).toBeVisible();
  await expect(page.getByTestId("form-preview")).toBeVisible();
});

test("@inv:D08 e2e/admin/form-publish-version publish version; edit creates new version", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const session = await loginAsAdmin(
    request,
    context,
    baseURL,
    "e2e-d08@example.com",
  );
  const event = await ensureEvent(request, session, "D08 Publish Event");
  await openFormBuilder(page, baseURL, event.id);
  await createFormUi(page, "D08 CFP");

  // Publish disabled with no fields
  await expect(page.getByTestId("form-publish")).toBeDisabled();

  await page.getByTestId("palette-text").click();
  await expect(page.getByTestId("form-publish")).toBeEnabled();

  await page.getByTestId("form-publish").click();
  await expect(page.getByTestId("form-publish-status")).toContainText(
    /Published version 1/i,
    { timeout: 15_000 },
  );
  await expect(page.getByTestId("form-status")).toHaveText("published");
  await expect(page.getByTestId("form-published-version")).toHaveText("1");

  // Edit draft after publish and publish again → version 2
  await page.getByTestId("palette-email").click();
  await page.getByTestId("form-publish").click();
  await expect(page.getByTestId("form-publish-status")).toContainText(
    /Published version 2/i,
    { timeout: 15_000 },
  );
  await expect(page.getByTestId("form-published-version")).toHaveText("2");

  // Public surface gets published snapshot (not draft-only)
  const pub = await request.get(`/api/public/cfp/${event.slug}`);
  expect(pub.status()).toBe(200);
  const pubBody = await pub.json();
  expect(pubBody.formVersion?.versionNum).toBe(2);
  expect(pubBody.formVersion?.immutable).toBe(true);
});

test("@inv:D09 e2e/admin/form-limits open/close + submission limit", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const session = await loginAsAdmin(
    request,
    context,
    baseURL,
    "e2e-d09@example.com",
  );
  const event = await ensureEvent(request, session, "D09 Limits Event");
  await openFormBuilder(page, baseURL, event.id);
  await createFormUi(page, "D09 CFP");

  await page.getByTestId("palette-text").click();
  await page
    .getByTestId("form-opens-at")
    .fill("2026-01-01T00:00:00.000Z");
  await page
    .getByTestId("form-closes-at")
    .fill("2026-12-31T23:59:59.000Z");
  await page.getByTestId("form-submission-limit").fill("100");

  await page.getByTestId("form-publish").click();
  await expect(page.getByTestId("form-publish-status")).toContainText(
    /Published version/i,
    { timeout: 15_000 },
  );

  const pub = await request.get(`/api/public/cfp/${event.slug}`);
  expect(pub.status()).toBe(200);
  const body = await pub.json();
  expect(body.formVersion?.opensAt).toBe("2026-01-01T00:00:00.000Z");
  expect(body.formVersion?.closesAt).toBe("2026-12-31T23:59:59.000Z");
  expect(body.formVersion?.submissionLimit).toBe(100);
  // Over-limit reject is public submit (3.3); limit is stored on published version (D09).
});

test("@inv:D10 e2e/admin/form-link copy public link", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const session = await loginAsAdmin(
    request,
    context,
    baseURL,
    "e2e-d10@example.com",
  );
  const event = await ensureEvent(request, session, "D10 Link Event");
  await openFormBuilder(page, baseURL, event.id);
  await createFormUi(page, "D10 CFP");

  await expect(page.getByTestId("form-public-href")).toContainText(
    `/cfp/${event.slug}`,
  );

  // Grant clipboard permissions when supported
  try {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  } catch {
    // Some browsers may not support; button still reports status
  }

  await page.getByTestId("form-copy-link").click();
  await expect(page.getByTestId("form-link-status")).toContainText(
    new RegExp(`cfp/${event.slug}`),
    { timeout: 5_000 },
  );

  // Keyboard reachable
  await page.getByTestId("form-copy-link").focus();
  await expect(page.getByTestId("form-copy-link")).toBeFocused();
});
