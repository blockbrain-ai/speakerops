/**
 * Closeout wiki allowlisted embed — Q09.
 */
import { test, expect } from "@playwright/test";
import {
  loginAs,
  ensureEvent,
  sessionHeaders,
} from "./helpers/cfp-eval-seed.js";

async function loginSpeaker(
  request: import("@playwright/test").APIRequestContext,
  context: import("@playwright/test").BrowserContext,
  baseURL: string | undefined,
  email: string,
  eventId: string,
): Promise<string> {
  await request.post("/api/auth/magic-link", {
    data: { email, purpose: "speaker", eventId },
  });
  const outbox = await request.get(
    `/api/auth/dev/outbox?email=${encodeURIComponent(email)}`,
  );
  expect(outbox.status()).toBe(200);
  const link = (await outbox.json()) as {
    link: { token: string } | null;
  };
  expect(link.link?.token).toBeTruthy();
  const exchange = await request.post("/api/auth/exchange", {
    data: { token: link.link!.token },
  });
  expect(exchange.status()).toBe(200);
  const setCookie = exchange.headers()["set-cookie"] ?? "";
  const match = setCookie.match(/speakerops_session=([^;]+)/);
  expect(match).toBeTruthy();
  const session = match![1]!;
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
  return session;
}

test("@inv:Q09 e2e/portal-lib/wiki-embed allowlisted youtube iframe", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const stamp = Date.now();
  const adminEmail = `wiki-admin-${stamp}@example.com`;
  const speakerEmail = `wiki-speaker-${stamp}@example.com`;
  const { session: adminSession } = await loginAs(
    request,
    context,
    baseURL,
    adminEmail,
    "admin",
  );
  const event = await ensureEvent(
    request,
    adminSession,
    `Wiki Embed ${stamp}`,
    `wiki-embed-${stamp}`,
  );

  const created = await request.post(`/api/events/${event.id}/resources`, {
    headers: sessionHeaders(adminSession),
    data: {
      title: "Venue map",
      bodyMd:
        "```embed https://www.youtube.com/watch?v=dQw4w9WgXcQ\n```\n[bad](javascript:alert(1))",
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const resource = (await created.json()) as {
    resource: { id: string; version: number };
  };
  const pubRes = await request.patch(
    `/api/events/${event.id}/resources/${resource.resource.id}`,
    {
      headers: sessionHeaders(adminSession),
      data: { status: "published", expectedVersion: resource.resource.version },
    },
  );
  expect(pubRes.status(), await pubRes.text()).toBe(200);

  await context.clearCookies();
  await loginSpeaker(request, context, baseURL, speakerEmail, event.id);

  await page.goto(
    `${baseURL ?? ""}/portal?eventId=${encodeURIComponent(event.id)}`,
  );
  await page.waitForTimeout(500);
  if ((await page.getByTestId("portal-nav-resources").count()) > 0) {
    await page.getByTestId("portal-nav-resources").click();
  }
  await expect(
    page.getByTestId(`portal-resource-${resource.resource.id}`),
  ).toBeVisible({
    timeout: 20_000,
  });
  await page.getByTestId(`portal-resource-open-${resource.resource.id}`).click();
  const iframe = page.getByTestId("wiki-embed-youtube");
  await expect(iframe).toBeVisible();
  await expect(iframe).toHaveAttribute(
    "src",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  );
  await expect(iframe).toHaveAttribute(
    "sandbox",
    "allow-scripts allow-same-origin allow-presentation",
  );
});
