/**
 * Section 5.1 — Comms template editor inventory journey.
 *
 * - @inv:J01 e2e/comms/template — Create/edit template merge fields (subject I16)
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
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

async function fetchDevLink(
  request: import("@playwright/test").APIRequestContext,
  email: string,
): Promise<{ token: string; userId: string }> {
  const res = await request.get(
    `/api/auth/dev/outbox?email=${encodeURIComponent(email)}`,
  );
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as {
    link: { token: string; userId?: string } | null;
  };
  expect(body.link?.token).toBeTruthy();
  return { token: body.link!.token, userId: body.link!.userId ?? "" };
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

function sessionHeaders(session: string): Record<string, string> {
  return {
    cookie: `speakerops_session=${session}`,
    "content-type": "application/json",
  };
}

async function loginAsAdmin(
  request: import("@playwright/test").APIRequestContext,
  context: import("@playwright/test").BrowserContext,
  baseURL: string | undefined,
  email: string,
): Promise<string> {
  await requestMagicLink(request, email, "admin");
  const link = await fetchDevLink(request, email);
  const sessionValue = await exchangeForCookie(request, link.token);
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
      startsAt: "2026-09-01T09:00:00.000Z",
      endsAt: "2026-09-02T17:00:00.000Z",
    },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as {
    event: { id: string; slug: string };
  };
  return { id: body.event.id, slug: body.event.slug };
}

test.describe("5.1 Comms templates", () => {
  test("@inv:J01 e2e/comms/template create/edit template merge fields", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const email = `comms-j01-${Date.now()}@example.com`;
    const session = await loginAsAdmin(request, context, baseURL, email);
    const event = await ensureEvent(request, session, "J01 Comms Event");

    // Seed active event in localStorage for EventContext
    await page.addInitScript((eventId) => {
      localStorage.setItem("speakerops.activeEventId", eventId);
    }, event.id);

    await page.goto("/admin/comms");
    await expect(page.getByTestId("page-comms")).toBeVisible();
    await expect(page.getByTestId("comms-template-editor")).toBeVisible();

    await page.getByTestId("comms-template-key-input").fill("j01-reminder");
    await page
      .getByTestId("comms-template-subject-input")
      .fill("Welcome {{name}} to {{eventName}}");
    await page
      .getByTestId("comms-template-body-input")
      .fill("Hi {{name}}, see you at {{eventName}}.");

    await expect(page.getByTestId("comms-merge-fields")).toContainText(
      "{{name}}",
    );
    await expect(page.getByTestId("comms-merge-fields")).toContainText(
      "{{eventName}}",
    );

    await page.getByTestId("comms-template-save").click();
    await expect(page.getByTestId("comms-template-status")).toContainText(
      "saved",
      { ignoreCase: true },
    );
    await expect(page.getByTestId("comms-template-saved-subject")).toContainText(
      "Welcome {{name}} to {{eventName}}",
    );

    // API proof: subject stored
    const getRes = await request.put(
      `/api/events/${event.id}/templates/j01-reminder`,
      {
        headers: sessionHeaders(session),
        data: {
          subject: "Edited {{name}} subject",
          body: "Body for {{name}}",
          expectedVersion: 1,
        },
      },
    );
    expect(getRes.status()).toBe(200);
    const saved = (await getRes.json()) as {
      template: { subject: string; version: number };
    };
    expect(saved.template.subject).toBe("Edited {{name}} subject");
    expect(saved.template.version).toBe(2);
  });
});
