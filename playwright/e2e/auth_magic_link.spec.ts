/**
 * Section 2.1 — Auth magic-link inventory journeys (B01–B03).
 *
 * - @inv:B01 e2e/auth/admin-login
 * - @inv:B02 e2e/auth/speaker-magic
 * - @inv:B03 e2e/auth/logout
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e) so API + Vite are up.
 * Dev outbox: GET /api/auth/dev/outbox?email=… (e2e-api-server only).
 */
import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "e2e-admin@example.com";
const SPEAKER_EMAIL = "e2e-speaker@example.com";
const LOGOUT_EMAIL = "e2e-logout@example.com";

async function requestMagicLink(
  request: import("@playwright/test").APIRequestContext,
  email: string,
  purpose: "admin" | "speaker",
) {
  const res = await request.post("/api/auth/magic-link", {
    data: { email, purpose },
  });
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

test("@inv:B01 e2e/auth/admin-login magic link sets HttpOnly session cookie", async ({
  page,
  request,
  baseURL,
}) => {
  // UI path: login form → request link
  await page.goto(`${baseURL ?? ""}/login`);
  await expect(page.getByTestId("login-page")).toBeVisible();
  await expect(page.getByTestId("login-form")).toBeVisible();

  await page.getByTestId("login-email").fill(ADMIN_EMAIL);
  await page.getByTestId("login-purpose-admin").check();
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-sent")).toBeVisible();

  // Capture token via dev outbox (email transport not wired)
  const token = await fetchDevToken(request, ADMIN_EMAIL);

  // Exchange — assert Set-Cookie HttpOnly (API path of journey)
  const exchange = await request.post("/api/auth/exchange", {
    data: { token },
  });
  expect(exchange.status()).toBe(200);
  const setCookie = exchange.headers()["set-cookie"] ?? "";
  expect(setCookie.toLowerCase()).toContain("httponly");
  expect(setCookie.toLowerCase()).toMatch(/samesite=lax/);
  expect(setCookie).toMatch(/speakerops_session=/);

  const body = await exchange.json();
  expect(body).toMatchObject({
    ok: true,
    purpose: "admin",
    email: ADMIN_EMAIL,
  });

  // Bad token negative (inventory: Bad token 401)
  const bad = await request.post("/api/auth/exchange", {
    data: { token: "this-is-not-a-real-magic-link-token" },
  });
  expect(bad.status()).toBe(401);
});

test("@inv:B02 e2e/auth/speaker-magic single-use link; replay rejected", async ({
  page,
  request,
  baseURL,
}) => {
  await requestMagicLink(request, SPEAKER_EMAIL, "speaker");
  const token = await fetchDevToken(request, SPEAKER_EMAIL);

  // First exchange via UI token query (same as email link)
  await page.goto(
    `${baseURL ?? ""}/login?token=${encodeURIComponent(token)}&purpose=speaker`,
  );
  await expect(page.getByTestId("portal-home")).toBeVisible({ timeout: 15_000 });

  // Second use fails (API + replay)
  const replay = await request.post("/api/auth/exchange", {
    data: { token },
  });
  expect(replay.status()).toBe(401);
  const err = await replay.json();
  expect(err).toMatchObject({ code: "UNAUTHORIZED" });
});

test("@inv:B03 e2e/auth/logout clears session cookie", async ({
  page,
  request,
  baseURL,
}) => {
  await requestMagicLink(request, LOGOUT_EMAIL, "admin");
  const token = await fetchDevToken(request, LOGOUT_EMAIL);

  const exchange = await request.post("/api/auth/exchange", {
    data: { token },
  });
  expect(exchange.status()).toBe(200);
  const setCookie = exchange.headers()["set-cookie"] ?? "";
  expect(setCookie.toLowerCase()).toContain("httponly");

  // Parse session value for Cookie header
  const match = setCookie.match(/speakerops_session=([^;]+)/);
  expect(match).toBeTruthy();
  const sessionValue = match![1];

  const logout = await request.post("/api/auth/logout", {
    headers: {
      cookie: `speakerops_session=${sessionValue}`,
    },
  });
  expect(logout.status()).toBe(204);
  const clear = logout.headers()["set-cookie"] ?? "";
  expect(clear.toLowerCase()).toContain("httponly");
  expect(clear).toMatch(/Max-Age=0/i);

  // UI logout control present on login page
  await page.goto(`${baseURL ?? ""}/login`);
  await expect(page.getByTestId("login-logout")).toBeVisible();
  await page.getByTestId("login-logout").click();
});
