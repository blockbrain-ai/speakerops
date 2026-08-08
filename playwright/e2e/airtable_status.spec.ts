/**
 * Section 7.3 — Airtable projection status inventory (O06).
 *
 * - @inv:O06 e2e/settings/airtable-status
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
 *
 * Note: Playwright `request` fixture does not share browser context cookies —
 * pass `cookie: speakerops_session=…` on API proofs explicitly.
 */
import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "e2e-airtable-admin@example.com";

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

test("@inv:O06 e2e/settings/airtable-status Airtable projection status read", async ({
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

  // Ensure an event exists so status can return lag fields
  const createRes = await request.post("/api/events", {
    headers: {
      cookie: cookieHeader(sessionValue),
      "content-type": "application/json",
    },
    data: {
      name: "E2E Airtable Event",
      timezone: "UTC",
    },
  });
  expect(createRes.status()).toBe(201);
  const created = (await createRes.json()) as { event: { id: string } };
  const eventId = created.event.id;

  // API proof: lag fields present (pause survival — key unset in e2e)
  const statusRes = await request.get(
    `/api/events/${encodeURIComponent(eventId)}/airtable/status`,
    {
      headers: {
        cookie: cookieHeader(sessionValue),
        accept: "application/json",
      },
    },
  );
  expect(statusRes.status()).toBe(200);
  const statusBody = (await statusRes.json()) as {
    eventId: string;
    configured: boolean;
    paused: boolean;
    lag: {
      pendingCount: number;
      oldestPendingAt: string | null;
      maxAttempts: number;
    };
    projectedCount: number;
    generatedAt: string;
  };
  expect(statusBody.eventId).toBe(eventId);
  expect(typeof statusBody.lag.pendingCount).toBe("number");
  expect(statusBody.lag.pendingCount).toBeGreaterThanOrEqual(1);
  expect(statusBody.paused).toBe(true);
  expect(statusBody.configured).toBe(false);

  // UI: settings → Airtable status page
  await page.goto(`${baseURL ?? ""}/admin/settings`);
  await expect(page.getByTestId("page-settings")).toBeVisible({
    timeout: 15_000,
  });

  // Select the created event if switcher present
  const switcher = page.getByTestId("event-context");
  if (await switcher.isVisible().catch(() => false)) {
    await switcher.selectOption(eventId);
  }

  await page.getByTestId("settings-airtable-link").click();
  await expect(page.getByTestId("airtable-status-page")).toBeVisible({
    timeout: 15_000,
  });

  await expect(page.getByTestId("airtable-status-section")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("airtable-status-pending-count")).toBeVisible();
  const pendingText = await page
    .getByTestId("airtable-status-pending-count")
    .innerText();
  expect(Number.parseInt(pendingText, 10)).toBeGreaterThanOrEqual(1);

  await expect(page.getByTestId("airtable-status-paused")).toContainText(
    /Yes|paused/i,
  );
  await expect(page.getByTestId("airtable-status-configured")).toContainText(
    /No|Yes/,
  );
  await expect(page.getByTestId("airtable-status-oldest-pending")).toBeVisible();
  await expect(page.getByTestId("airtable-status-refresh")).toBeVisible();
});
