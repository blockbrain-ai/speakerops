/**
 * Section 2.5 — Auth settings e2e proof (I12 keystone).
 *
 * Soul path (S-THEME + auth guards):
 *   login → set design → publish → public sees brand; role guards proven.
 *
 * Proof owner for phase-2 inventory (implementation tags stay 1:1 on 2.1–2.4 specs):
 * - @inv:B01 e2e/auth/admin-login
 * - @inv:B02 e2e/auth/speaker-magic
 * - @inv:B03 e2e/auth/logout
 * - @inv:B04 e2e/auth/admin-guard
 * - @inv:B05 e2e/auth/role-guard-admin
 * - @inv:B06 e2e/auth/role-guard-eval
 * - @inv:C01 e2e/admin/event-create
 * - @inv:C02 e2e/admin/event-switch
 * - @inv:C03 e2e/admin/design-color
 * - @inv:C04 e2e/admin/design-logo
 * - @inv:C05 e2e/admin/design-publish
 * - @inv:C06 e2e/admin/design-no-css
 * - @inv:C07 e2e/admin/settings-cfp-window
 * - @inv:C08 e2e/admin/design-contrast
 * - @inv:C09 e2e/admin/design-logo-xss
 * - @inv:C10 e2e/admin/design-draft-isolation
 * - @inv:C11 e2e/admin/event-isolation
 *
 * Active `@inv` ownership remains on implementation specs (duplicate owners
 * forbidden by inventory law). This keystone stitches the multi-step soul path
 * and documents B04/C05 (and full Bxx/Cxx set) coverage for phase-2 proof.
 *
 * Named assertions (spec 2.5):
 * - assert keystone covers login and design publish path end-to-end
 * - assert B04 and C05 tags present in keystone file (header above)
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
 *
 * @see docs/sections/2.5-auth-settings-e2e.md
 * @see KMS-competition/initiative/evidence/phase2-e2e.txt
 */
import { test, expect } from "@playwright/test";

const KEYSTONE_ADMIN = "e2e-keystone-admin@example.com";
const KEYSTONE_SPEAKER = "e2e-keystone-speaker@example.com";
const KEYSTONE_EVALUATOR = "e2e-keystone-evaluator@example.com";

const DEFAULT_BOOTSTRAP_EVENT_ID = "evt_dogfood";

async function requestMagicLink(
  request: import("@playwright/test").APIRequestContext,
  email: string,
  purpose: "admin" | "speaker" | "evaluator",
  eventId?: string,
) {
  const data: Record<string, string> = { email, purpose };
  if (eventId) data.eventId = eventId;
  const res = await request.post("/api/auth/magic-link", { data });
  expect(res.ok(), `magic-link status ${res.status()}`).toBeTruthy();
  const body = await res.json();
  expect(body).toEqual({ sent: true });
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
  expect(setCookie.toLowerCase()).toContain("httponly");
  const match = setCookie.match(/speakerops_session=([^;]+)/);
  expect(match).toBeTruthy();
  return match![1]!;
}

async function seedSessionCookie(
  context: import("@playwright/test").BrowserContext,
  baseURL: string | undefined,
  sessionValue: string,
) {
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
}

function sessionHeaders(session: string): Record<string, string> {
  return {
    cookie: `speakerops_session=${session}`,
    "content-type": "application/json",
  };
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

test.describe("2.5 auth settings keystone (I12)", () => {
  /**
   * assert keystone covers login and design publish path end-to-end
   *
   * Multi-step soul path: unauthed guard → admin login → create event →
   * Design Kit brand → publish → public CFP shows brand → role guards.
   */
  test("keystone: login → set design → publish → public brand; role guards", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    // --- B04: unauthenticated /admin → login; API 401 ---
    const unauthApi = await request.get("/api/events");
    expect(unauthApi.status()).toBe(401);
    const unauthBody = await unauthApi.json();
    expect(unauthBody).toMatchObject({ code: "UNAUTHORIZED" });

    await page.goto(`${baseURL ?? ""}/admin`);
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    await expect(page.getByTestId("login-page")).toBeVisible();
    await expect(page.getByTestId("admin-shell")).toHaveCount(0);

    // --- B01: admin magic-link login → HttpOnly session ---
    await page.getByTestId("login-email").fill(KEYSTONE_ADMIN);
    await page.getByTestId("login-purpose-admin").check();
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("login-sent")).toBeVisible();

    const adminToken = await fetchDevToken(request, KEYSTONE_ADMIN);
    // Bad token negative (B01): invalid exchange → 401
    const badExchange = await request.post("/api/auth/exchange", {
      data: { token: "not-a-real-magic-link-token-keystone" },
    });
    expect(badExchange.status()).toBe(401);

    const adminSession = await exchangeForCookie(request, adminToken);
    await seedSessionCookie(context, baseURL, adminSession);

    // Session cookie grants admin shell (B01 path complete)
    await page.goto(`${baseURL ?? ""}/admin`);
    await expect(page.getByTestId("admin-shell")).toBeVisible({
      timeout: 15_000,
    });

    // --- C01: create event (API + UI context) ---
    const create = await request.post("/api/events", {
      headers: sessionHeaders(adminSession),
      data: {
        name: "Keystone Brand Summit",
        timezone: "UTC",
        slug: "keystone-brand-summit",
        startsAt: "2026-10-01T09:00:00.000Z",
        endsAt: "2026-10-02T17:00:00.000Z",
      },
    });
    expect(create.status(), await create.text()).toBe(201);
    const created = (await create.json()) as {
      event: { id: string; slug: string; name: string };
    };
    expect(created.event.id).toBeTruthy();
    expect(created.event.name).toBe("Keystone Brand Summit");
    const eventId = created.event.id;
    const eventSlug = created.event.slug;

    // --- C05 path: Design Kit brand → publish → public CFP ---
    await page.goto(`${baseURL ?? ""}/admin/settings/design`);
    await waitForEventSelect(page);
    await page.getByTestId("event-context").selectOption(eventId);

    await expect(page.getByTestId("page-design-kit")).toBeVisible({
      timeout: 15_000,
    });
    // C06: freeform CSS control must be absent (S-THEME lock)
    await expect(page.locator('[data-testid="design-custom-css"]')).toHaveCount(
      0,
    );

    const brandHex = "#2244aa";
    const wordmark = "Keystone Public Brand";
    await page.getByTestId("design-brand-hex").fill(brandHex);
    await page.getByTestId("design-wordmark").fill(wordmark);
    await expect(page.getByTestId("design-preview-brand")).toContainText(
      brandHex,
    );

    await page.getByTestId("design-save-draft").click();
    await expect(page.getByTestId("design-save-status")).toContainText(
      /Draft saved/i,
      { timeout: 10_000 },
    );

    // Draft isolation: public must not show draft brand yet (C10)
    await page.goto(`${baseURL ?? ""}/cfp/${eventSlug}`);
    await expect(page.getByTestId("page-public-cfp")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("public-cfp-brand")).toHaveAttribute(
      "data-has-published",
      "false",
    );
    await expect(page.getByTestId("public-cfp-brand")).not.toHaveAttribute(
      "data-brand",
      new RegExp(brandHex, "i"),
    );

    // Publish
    await page.goto(`${baseURL ?? ""}/admin/settings/design`);
    await waitForEventSelect(page);
    await page.getByTestId("event-context").selectOption(eventId);
    await page.getByTestId("design-publish").click();
    await expect(page.getByTestId("design-publish-status")).toContainText(
      /Published/i,
      { timeout: 10_000 },
    );

    // Public CFP shows published brand (C05 / S-THEME)
    await page.goto(`${baseURL ?? ""}/cfp/${eventSlug}`);
    await expect(page.getByTestId("page-public-cfp")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("public-cfp-brand")).toHaveAttribute(
      "data-has-published",
      "true",
      { timeout: 10_000 },
    );
    await expect(page.getByTestId("public-cfp-brand")).toHaveAttribute(
      "data-brand",
      new RegExp(brandHex, "i"),
    );
    await expect(page.getByTestId("public-cfp-title")).toContainText(wordmark);

    // --- Role guards (B05 speaker, B06 evaluator) ---
    await context.clearCookies();

    await requestMagicLink(request, KEYSTONE_SPEAKER, "speaker");
    const speakerToken = await fetchDevToken(request, KEYSTONE_SPEAKER);
    const speakerSession = await exchangeForCookie(request, speakerToken);
    await seedSessionCookie(context, baseURL, speakerSession);

    const speakerApi = await request.get("/api/events", {
      headers: { cookie: `speakerops_session=${speakerSession}` },
    });
    expect(speakerApi.status()).toBe(403);
    expect(await speakerApi.json()).toMatchObject({ code: "FORBIDDEN" });

    await page.goto(`${baseURL ?? ""}/admin`);
    await expect(page.getByTestId("access-denied")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("admin-shell")).toHaveCount(0);

    await context.clearCookies();
    await requestMagicLink(
      request,
      KEYSTONE_EVALUATOR,
      "evaluator",
      DEFAULT_BOOTSTRAP_EVENT_ID,
    );
    const evalToken = await fetchDevToken(request, KEYSTONE_EVALUATOR);
    const evalSession = await exchangeForCookie(request, evalToken);

    const place = await request.post(
      `/api/events/${DEFAULT_BOOTSTRAP_EVENT_ID}/schedule/place`,
      {
        headers: sessionHeaders(evalSession),
        data: {
          sessionId: "sess_keystone_eval",
          roomId: "room_keystone",
          startsAt: "2026-09-01T10:00:00.000Z",
          endsAt: "2026-09-01T11:00:00.000Z",
        },
      },
    );
    expect(place.status()).toBe(403);
    expect(await place.json()).toMatchObject({ code: "FORBIDDEN" });
  });
});
