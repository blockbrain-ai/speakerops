/**
 * Section 10.4 — DEMO persona session reliability (S-AUTH-ROLES).
 *
 * AC-10.4-A admin reaches /admin with real session cookie
 * AC-10.4-B speaker portal tasks reachable
 * AC-10.4-C evaluator queue reachable
 * + session sticks across reload
 * + negatives: unauthenticated admin blocked; evaluator has no admin nav
 *
 * Uses real magic-link mint + exchange (local e2e dev outbox) — not mocked UI.
 * Inventory: B01–B06 remain owned by auth_magic_link / auth_role_guards;
 * this file is the soul-level three-role landing proof (livability matrix).
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
 */
import { test, expect } from "@playwright/test";
import {
  requestMagicLink,
  fetchDevLink,
  exchangeForCookie,
  seedSessionCookie,
  sessionHeaders,
  ensureEvent,
} from "./helpers/cfp-eval-seed.js";

/** Matches packages/shared DEFAULT_BOOTSTRAP_EVENT_ID. */
const DEFAULT_BOOTSTRAP_EVENT_ID = "evt_dogfood";

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ADMIN_EMAIL = `e2e-10-4-admin-${RUN}@example.com`;
const SPEAKER_EMAIL = `e2e-10-4-speaker-${RUN}@example.com`;
const EVALUATOR_EMAIL = `e2e-10-4-evaluator-${RUN}@example.com`;

async function mintSession(
  request: import("@playwright/test").APIRequestContext,
  email: string,
  purpose: "admin" | "speaker" | "evaluator",
  eventId?: string,
): Promise<{ session: string; userId: string }> {
  await requestMagicLink(request, email, purpose, eventId);
  const link = await fetchDevLink(request, email);
  const session = await exchangeForCookie(request, link.token);
  return { session, userId: link.userId };
}

test.describe("10.4 S-AUTH-ROLES demo persona session reliability", () => {
  test("AC-10.4-A organizer session reaches /admin and sticks after reload", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const { session } = await mintSession(request, ADMIN_EMAIL, "admin");

    // Cookie attributes on exchange (dogfood-safe contract)
    const probe = await request.post("/api/auth/magic-link", {
      data: {
        email: `e2e-10-4-cookie-probe-${RUN}@example.com`,
        purpose: "admin",
      },
    });
    expect(probe.ok()).toBeTruthy();
    const probeLink = await fetchDevLink(
      request,
      `e2e-10-4-cookie-probe-${RUN}@example.com`,
    );
    const exchange = await request.post("/api/auth/exchange", {
      data: { token: probeLink.token },
    });
    expect(exchange.status()).toBe(200);
    const setCookie = exchange.headers()["set-cookie"] ?? "";
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toMatch(/samesite=lax/);
    expect(setCookie).toMatch(/Path=\//i);
    expect(setCookie).toMatch(/Max-Age=\d+/i);
    expect(setCookie.toLowerCase()).not.toMatch(/;\s*domain=/);

    await seedSessionCookie(context, baseURL, session);

    // API: admin list works with cookie
    const api = await request.get("/api/events", {
      headers: sessionHeaders(session),
    });
    expect(api.status(), `admin Event.List ${api.status()}`).toBe(200);

    await page.goto(`${baseURL ?? ""}/admin`);
    await expect(page.getByTestId("admin-shell")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("nav-overview")).toBeVisible();

    // Session restore: reload keeps privileged shell
    await page.reload();
    await expect(page.getByTestId("admin-shell")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("AC-10.4-B speaker session reaches portal tasks surface", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    // Create a real event so Portal.GetHome is not 404 (event not found).
    const admin = await mintSession(
      request,
      `e2e-10-4-sp-admin-${RUN}@example.com`,
      "admin",
    );
    const { id: portalEventId } = await ensureEvent(
      request,
      admin.session,
      `Auth Roles Event ${RUN}`,
      `auth-roles-${RUN}`.slice(0, 48),
    );

    const { session } = await mintSession(
      request,
      SPEAKER_EMAIL,
      "speaker",
      portalEventId,
    );
    await context.clearCookies();
    await seedSessionCookie(context, baseURL, session);

    // Portal home API with cookie (not mock) — session accepted (not 401)
    const homeApi = await request.get(
      `/api/portal/home?eventId=${encodeURIComponent(portalEventId)}`,
      { headers: sessionHeaders(session) },
    );
    expect(homeApi.status(), `portal home ${homeApi.status()}`).toBe(200);

    await page.goto(
      `${baseURL ?? ""}/portal?eventId=${encodeURIComponent(portalEventId)}`,
    );
    await expect(page.getByTestId("portal-home")).toBeVisible({
      timeout: 15_000,
    });
    // Must not bounce to login (session stick)
    await expect(page.getByTestId("login-page")).toHaveCount(0);
    await expect(page.getByTestId("portal-unauthenticated")).toHaveCount(0);

    // Tasks region is part of the portal shell (empty list OK when no accept)
    await expect(page.getByTestId("portal-tasks")).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("portal-home")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("portal-unauthenticated")).toHaveCount(0);
    await expect(page.getByTestId("portal-tasks")).toBeVisible();
  });

  test("AC-10.4-C evaluator session reaches queue", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const { session } = await mintSession(
      request,
      EVALUATOR_EMAIL,
      "evaluator",
      DEFAULT_BOOTSTRAP_EVENT_ID,
    );
    await context.clearCookies();
    await seedSessionCookie(context, baseURL, session);

    const queueApi = await request.get("/api/me/eval-queue", {
      headers: sessionHeaders(session),
    });
    expect(queueApi.status(), `eval-queue ${queueApi.status()}`).toBe(200);
    const queueBody = (await queueApi.json()) as { items: unknown[] };
    expect(Array.isArray(queueBody.items)).toBeTruthy();

    await page.goto(`${baseURL ?? ""}/eval`);
    await expect(page.getByTestId("evaluator-queue")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("eval-queue-title")).toBeVisible();
    // No admin chrome for evaluator
    await expect(page.getByTestId("admin-shell")).toHaveCount(0);
    await expect(page.getByTestId("nav-overview")).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId("evaluator-queue")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("must-not: unauthenticated user cannot read admin shell", async ({
    page,
    request,
    baseURL,
  }) => {
    const api = await request.get("/api/events");
    expect(api.status()).toBe(401);

    await page.goto(`${baseURL ?? ""}/admin`);
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    await expect(page.getByTestId("login-page")).toBeVisible();
    await expect(page.getByTestId("admin-shell")).toHaveCount(0);
  });

  test("must-not: evaluator session cannot open admin navigation", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const { session } = await mintSession(
      request,
      `e2e-10-4-eval-neg-${RUN}@example.com`,
      "evaluator",
      DEFAULT_BOOTSTRAP_EVENT_ID,
    );
    await seedSessionCookie(context, baseURL, session);

    const api = await request.get("/api/events", {
      headers: sessionHeaders(session),
    });
    expect(api.status()).toBe(403);

    await page.goto(`${baseURL ?? ""}/admin`);
    await expect(page.getByTestId("access-denied")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("admin-shell")).toHaveCount(0);
  });

  test("login sent copy does not promise a public test outbox", async ({
    page,
    baseURL,
  }) => {
    await page.goto(`${baseURL ?? ""}/login`);
    await expect(page.getByTestId("login-page")).toBeVisible();
    await page.getByTestId("login-email").fill(`e2e-10-4-copy-${RUN}@example.com`);
    await page.getByTestId("login-purpose-admin").check();
    await page.getByTestId("login-submit").click();
    const sent = page.getByTestId("login-sent");
    await expect(sent).toBeVisible();
    const text = (await sent.textContent()) ?? "";
    expect(text.toLowerCase()).not.toMatch(/dev:\s*use test outbox/);
    expect(text.toLowerCase()).toMatch(/inbox/);
    // Honest: no product outbox on dogfood
    expect(text.toLowerCase()).toMatch(/no in-product mail inbox|no public outbox|check your inbox/);
  });
});
