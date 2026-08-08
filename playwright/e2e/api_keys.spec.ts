/**
 * Section 7.1 — API keys inventory journeys (K01–K04).
 *
 * - @inv:K01 e2e/keys/create
 * - @inv:K02 e2e/keys/revoke
 * - @inv:K03 e2e/keys/secret-once
 * - @inv:K04 e2e/keys/authz
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
 *
 * Note: Playwright `request` fixture does not share browser context cookies —
 * pass `cookie: speakerops_session=…` on API proofs explicitly.
 */
import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "e2e-keys-admin@example.com";
const SPEAKER_EMAIL = "e2e-keys-speaker@example.com";

async function requestMagicLink(
  request: import("@playwright/test").APIRequestContext,
  email: string,
  purpose: "admin" | "speaker" | "evaluator" = "admin",
) {
  const res = await request.post("/api/auth/magic-link", {
    data: { email, purpose },
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

async function loginAs(
  request: import("@playwright/test").APIRequestContext,
  context: import("@playwright/test").BrowserContext,
  baseURL: string | undefined,
  email: string,
  purpose: "admin" | "speaker" | "evaluator",
): Promise<string> {
  await requestMagicLink(request, email, purpose);
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

function cookieHeader(sessionValue: string): string {
  return `speakerops_session=${sessionValue}`;
}

test("@inv:K01 e2e/keys/create create key with subset of scopes; secret shown once", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const sessionValue = await loginAs(
    request,
    context,
    baseURL,
    ADMIN_EMAIL,
    "admin",
  );

  await page.goto(`${baseURL ?? ""}/admin/settings/api-keys`);
  await expect(page.getByTestId("api-keys-page")).toBeVisible({
    timeout: 15_000,
  });

  await page.getByTestId("api-key-name-input").fill("E2E agent key");
  // Subset of safe scopes (not default-deny)
  await page.getByTestId("api-key-scope-events:read").check();
  await page.getByTestId("api-key-scope-reports:read").check();
  // Ensure default-deny remain unchecked
  await expect(page.getByTestId("api-key-scope-keys:admin")).not.toBeChecked();
  await expect(page.getByTestId("api-key-scope-comms:send")).not.toBeChecked();
  await expect(
    page.getByTestId("api-key-scope-decisions:write"),
  ).not.toBeChecked();

  await page.getByTestId("api-key-create-submit").click();

  // Secret shown once
  const secretBanner = page.getByTestId("api-key-secret-once");
  await expect(secretBanner).toBeVisible({ timeout: 10_000 });
  const secretInput = page.getByTestId("api-key-secret-value");
  await expect(secretInput).toBeVisible();
  const secret = await secretInput.inputValue();
  expect(secret.length).toBeGreaterThan(20);
  expect(secret.startsWith("spk_")).toBeTruthy();

  const prefix = await page.getByTestId("api-key-prefix-value").innerText();
  expect(secret.startsWith(prefix)).toBeTruthy();

  // Key appears in list with prefix (not full secret)
  await expect(page.getByTestId("api-keys-list")).toBeVisible();
  await expect(page.getByTestId("api-key-row-prefix").first()).toContainText(
    prefix,
  );
  const listText = await page.getByTestId("api-keys-list").innerText();
  expect(listText).not.toContain(secret);

  // API proof: list body has no secret (request fixture needs cookie)
  const listRes = await request.get("/api/keys", {
    headers: { cookie: cookieHeader(sessionValue) },
  });
  expect(listRes.status()).toBe(200);
  const listBody = await listRes.text();
  expect(listBody).not.toContain(secret);
});

test("@inv:K02 e2e/keys/revoke revoke key", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const sessionValue = await loginAs(
    request,
    context,
    baseURL,
    "e2e-keys-revoke@example.com",
    "admin",
  );

  // Seed via API for stable key id
  const createRes = await request.post("/api/keys", {
    headers: { cookie: cookieHeader(sessionValue) },
    data: {
      name: "revoke-me",
      scopes: ["events:read"],
    },
  });
  expect(createRes.status()).toBe(201);
  const created = (await createRes.json()) as { id: string; secret: string };

  await page.goto(`${baseURL ?? ""}/admin/settings/api-keys`);
  await expect(page.getByTestId("api-keys-page")).toBeVisible({
    timeout: 15_000,
  });

  const revokeBtn = page.getByTestId(`api-key-revoke-${created.id}`);
  await expect(revokeBtn).toBeVisible({ timeout: 10_000 });
  await revokeBtn.click();

  await expect(page.getByTestId("api-key-revoke-status")).toContainText(
    /revoked/i,
    { timeout: 10_000 },
  );
  await expect(page.getByTestId(`api-key-revoked-${created.id}`)).toBeVisible();

  // API proof: revoked key cannot authenticate
  const denied = await request.get("/api/keys", {
    headers: { authorization: `Bearer ${created.secret}` },
  });
  expect(denied.status()).toBe(401);
});

test("@inv:K03 e2e/keys/secret-once copy prefix only after dismiss", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  await loginAs(
    request,
    context,
    baseURL,
    "e2e-keys-secret-once@example.com",
    "admin",
  );

  await page.goto(`${baseURL ?? ""}/admin/settings/api-keys`);
  await expect(page.getByTestId("api-keys-page")).toBeVisible({
    timeout: 15_000,
  });

  await page.getByTestId("api-key-name-input").fill("once-only");
  await page.getByTestId("api-key-scope-design:read").check();
  await page.getByTestId("api-key-create-submit").click();

  await expect(page.getByTestId("api-key-secret-once")).toBeVisible({
    timeout: 10_000,
  });
  const secret = await page.getByTestId("api-key-secret-value").inputValue();
  const prefix = await page.getByTestId("api-key-prefix-value").innerText();

  // Dismiss secret
  await page.getByTestId("api-key-secret-dismiss").click();
  await expect(page.getByTestId("api-key-secret-once")).toHaveCount(0);
  await expect(page.getByTestId("api-key-secret-dismissed")).toBeVisible();

  // Full secret no longer on page; prefix remains
  const pageText = await page.getByTestId("api-keys-page").innerText();
  expect(pageText).not.toContain(secret);
  await expect(page.getByTestId("api-key-row-prefix").first()).toContainText(
    prefix,
  );

  // Copy prefix control present after dismiss
  const row = page.locator(`[data-testid^="api-key-row-"]`).first();
  await expect(row.getByTestId("api-key-row-prefix")).toContainText(prefix);
  await expect(
    page.locator(`[data-testid^="api-key-copy-prefix-"]`).first(),
  ).toBeVisible();
});

test("@inv:K04 e2e/keys/authz non-admin cannot open keys", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const sessionValue = await loginAs(
    request,
    context,
    baseURL,
    SPEAKER_EMAIL,
    "speaker",
  );

  // API proof (cookie required on request fixture)
  const api = await request.get("/api/keys", {
    headers: { cookie: cookieHeader(sessionValue) },
  });
  expect(api.status()).toBe(403);
  const err = await api.json();
  expect(err).toMatchObject({ code: "FORBIDDEN" });

  // UI: speaker hits /admin/settings/api-keys → access denied (AdminGuard)
  await page.goto(`${baseURL ?? ""}/admin/settings/api-keys`);
  await expect(page.getByTestId("access-denied")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("api-keys-page")).toHaveCount(0);
  await expect(page.getByTestId("admin-shell")).toHaveCount(0);
});
