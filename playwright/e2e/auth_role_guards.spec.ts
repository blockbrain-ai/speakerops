/**
 * Section 2.2 — Auth role guards inventory journeys (B04–B06).
 *
 * - @inv:B04 e2e/auth/admin-guard
 * - @inv:B05 e2e/auth/role-guard-admin
 * - @inv:B06 e2e/auth/role-guard-eval
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e) so API + Vite are up.
 */
import { test, expect } from "@playwright/test";

/** Matches packages/shared DEFAULT_BOOTSTRAP_EVENT_ID (avoid workspace resolve in Playwright). */
const DEFAULT_BOOTSTRAP_EVENT_ID = "evt_dogfood";

const SPEAKER_EMAIL = "e2e-role-speaker@example.com";
const EVALUATOR_EMAIL = "e2e-role-evaluator@example.com";
const ADMIN_EMAIL = "e2e-role-admin@example.com";

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
  const match = setCookie.match(/speakerops_session=([^;]+)/);
  expect(match).toBeTruthy();
  return match![1]!;
}

test("@inv:B04 e2e/auth/admin-guard unauthed /admin redirects to login", async ({
  page,
  baseURL,
  request,
}) => {
  // API proof: unauthenticated admin list → 401
  const api = await request.get("/api/events");
  expect(api.status()).toBe(401);
  const err = await api.json();
  expect(err).toMatchObject({ code: "UNAUTHORIZED" });

  // UI: unauthenticated visit to /admin → redirect login (RequireRole)
  await page.goto(`${baseURL ?? ""}/admin`);
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  await expect(page.getByTestId("login-page")).toBeVisible();
  // Must not show admin shell
  await expect(page.getByTestId("admin-shell")).toHaveCount(0);
});

test("@inv:B05 e2e/auth/role-guard-admin speaker cannot open admin", async ({
  page,
  request,
  baseURL,
  context,
}) => {
  await requestMagicLink(request, SPEAKER_EMAIL, "speaker");
  const token = await fetchDevToken(request, SPEAKER_EMAIL);
  const sessionValue = await exchangeForCookie(request, token);

  // Seed browser cookie for same origin
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

  // API proof: speaker session GET /api/events → 403
  const api = await request.get("/api/events", {
    headers: { cookie: `speakerops_session=${sessionValue}` },
  });
  expect(api.status()).toBe(403);
  const err = await api.json();
  expect(err).toMatchObject({ code: "FORBIDDEN" });

  // UI: speaker hits /admin → access denied (not admin shell)
  await page.goto(`${baseURL ?? ""}/admin`);
  await expect(page.getByTestId("access-denied")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("access-denied-title")).toContainText(
    /access denied/i,
  );
  await expect(page.getByTestId("admin-shell")).toHaveCount(0);
});

test("@inv:B06 e2e/auth/role-guard-eval evaluator cannot mutate schedule", async ({
  request,
}) => {
  const eventId = DEFAULT_BOOTSTRAP_EVENT_ID;
  await requestMagicLink(request, EVALUATOR_EMAIL, "evaluator", eventId);
  const token = await fetchDevToken(request, EVALUATOR_EMAIL);
  const sessionValue = await exchangeForCookie(request, token);

  // API: evaluator POST schedule place → 403 (B06 negative)
  const place = await request.post(
    `/api/events/${eventId}/schedule/place`,
    {
      headers: {
        cookie: `speakerops_session=${sessionValue}`,
        "content-type": "application/json",
      },
      data: {
        sessionId: "sess_e2e",
        roomId: "room_e2e",
        startsAt: "2026-09-01T10:00:00.000Z",
        endsAt: "2026-09-01T11:00:00.000Z",
      },
    },
  );
  expect(place.status()).toBe(403);
  const err = await place.json();
  expect(err).toMatchObject({ code: "FORBIDDEN" });

  // Control: admin can place (authz pass) — proves gate is role-specific
  await requestMagicLink(request, ADMIN_EMAIL, "admin", eventId);
  const adminToken = await fetchDevToken(request, ADMIN_EMAIL);
  const adminSession = await exchangeForCookie(request, adminToken);
  const adminPlace = await request.post(
    `/api/events/${eventId}/schedule/place`,
    {
      headers: {
        cookie: `speakerops_session=${adminSession}`,
        "content-type": "application/json",
      },
      data: {
        sessionId: "sess_admin_e2e",
        roomId: "room_e2e",
        startsAt: "2026-09-01T12:00:00.000Z",
        endsAt: "2026-09-01T13:00:00.000Z",
      },
    },
  );
  // Admin passes role gate; Schedule.Place persistence is deferred to 6.1 (501).
  expect(adminPlace.status()).toBe(501);
  const body = await adminPlace.json();
  expect(body).toMatchObject({ code: "NOT_IMPLEMENTED" });
});
