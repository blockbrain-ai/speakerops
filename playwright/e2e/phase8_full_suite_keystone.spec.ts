/**
 * Section 8.2 — Full Playwright suite keystone (S-E2E-RUN).
 *
 * Stitches phase souls into a single multi-step proof and documents that
 * every REQUIRED inventory ID is owned by an active `@inv` Playwright test
 * (1:1 ownership remains on implementation specs — this keystone does not
 * re-register @inv tags to avoid counterfeit multi-owner coverage).
 *
 * Cross-cutting state journeys owned here via states_cross_cutting.spec.ts:
 * - L01 empty-sub · L02 error · L03 loading · L04 console-clean
 * (L05 remains readiness_dashboard.spec.ts)
 *
 * Named assertions (spec 8.2):
 * - assert every REQUIRED inventory id status PASS in report JSON
 * - assert no inventory rows deleted in git diff of inventory file
 *   (enforced in tests/ + governance; keystone is browser soul path)
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
 *
 * @see docs/sections/8.2-full-playwright-suite.md
 * @see KMS-competition/initiative/evidence/e2e-full.txt
 */
import { test, expect } from "@playwright/test";

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const KEYSTONE_ADMIN = `e2e-keystone82-admin-${RUN}@example.com`;

async function requestMagicLink(
  request: import("@playwright/test").APIRequestContext,
  email: string,
) {
  const res = await request.post("/api/auth/magic-link", {
    data: { email, purpose: "admin" },
  });
  expect(res.ok(), `magic-link ${res.status()}`).toBeTruthy();
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

/**
 * Single multi-step e2e covering phase souls: health → admin session →
 * shell chrome → submissions empty CTA (L01 surface) → console clean.
 * Full inventory coverage is the aggregate of all @inv specs + run report.
 */
test("keystone 8.2: health → admin shell → empty CTA → console-clean soul path", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  // Health (phase 1 soul)
  const health = await request.get("/health");
  expect(health.ok()).toBeTruthy();
  const healthBody = (await health.json()) as { ok: boolean; version: string };
  expect(healthBody.ok).toBe(true);
  expect(healthBody.version.length).toBeGreaterThan(0);

  // Admin session (phase 2 soul)
  await requestMagicLink(request, KEYSTONE_ADMIN);
  const token = await fetchDevToken(request, KEYSTONE_ADMIN);
  const session = await exchangeForCookie(request, token);
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

  // Create isolated event for empty-list CTA
  const evRes = await request.post("/api/events", {
    headers: {
      cookie: `speakerops_session=${session}`,
      "content-type": "application/json",
    },
    data: {
      name: `Keystone82 ${RUN}`,
      timezone: "UTC",
      startsAt: "2026-11-01T09:00:00.000Z",
      endsAt: "2026-11-02T17:00:00.000Z",
    },
  });
  expect(evRes.status()).toBe(201);
  const { event } = (await evRes.json()) as {
    event: { id: string; slug: string };
  };

  await page.goto("/admin");
  await expect(page.getByTestId("admin-shell")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(/CFP|Forms|Submissions/i).first()).toBeVisible();

  await page.evaluate((id) => {
    localStorage.setItem("speakerops.activeEventId", id);
  }, event.id);

  await page.goto("/admin/submissions");
  await expect(page.getByTestId("page-submissions")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("submissions-empty")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("submissions-empty-cta")).toBeVisible();

  expect(pageErrors, `pageerror: ${pageErrors.join(" | ")}`).toEqual([]);
  const noise = consoleErrors.filter(
    (t) => !/favicon\.ico|Download the React DevTools/i.test(t),
  );
  expect(noise, `console.error: ${noise.join(" | ")}`).toEqual([]);
});
