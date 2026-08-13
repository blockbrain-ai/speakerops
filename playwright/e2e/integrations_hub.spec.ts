/**
 * Closeout Integrations hub — O07 / O08.
 */
import { test, expect } from "@playwright/test";
import { loginAs, ensureEvent, sessionHeaders } from "./helpers/cfp-eval-seed.js";

test("@inv:O07 e2e/settings/integrations-paused Accelevents card paused without key", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const email = `e2e-int-o07-${Date.now()}@example.com`;
  const { session } = await loginAs(request, context, baseURL, email, "admin");
  const event = await ensureEvent(
    request,
    session,
    `Integrations O07 ${Date.now()}`,
  );

  await page.goto(`${baseURL ?? ""}/admin/settings/integrations`);
  await expect(page.getByTestId("integrations-page")).toBeVisible({
    timeout: 15_000,
  });
  const switcher = page.getByTestId("event-context");
  if (await switcher.isVisible().catch(() => false)) {
    await switcher.selectOption(event.id).catch(() => undefined);
  }
  await expect(page.getByTestId("accelevents-honesty")).toBeVisible();
  await expect(page.getByTestId("ae-status")).toContainText(/paused|no key/i);
  await expect(page.getByTestId("airtable-status-page")).toBeVisible();

  const unauth = await request.get(
    `/api/events/${encodeURIComponent(event.id)}/integrations`,
  );
  expect(unauth.status()).toBe(401);
});

test("@inv:O08 e2e/settings/integrations-save save Accelevents event identity", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const email = `e2e-int-o08-${Date.now()}@example.com`;
  const { session } = await loginAs(request, context, baseURL, email, "admin");
  const event = await ensureEvent(
    request,
    session,
    `Integrations O08 ${Date.now()}`,
  );

  const bad = await request.put(
    `/api/events/${encodeURIComponent(event.id)}/integrations/accelevents`,
    {
      headers: sessionHeaders(session),
      data: {
        eventUrl: "https://evil.example",
        externalEventId: "1",
        enabled: false,
      },
    },
  );
  expect(bad.status()).toBe(400);

  await page.goto(`${baseURL ?? ""}/admin/settings/integrations`);
  await expect(page.getByTestId("integrations-page")).toBeVisible({
    timeout: 15_000,
  });
  const switcher = page.getByTestId("event-context");
  if (await switcher.isVisible().catch(() => false)) {
    await switcher.selectOption(event.id).catch(() => undefined);
  }
  await page.getByTestId("ae-event-url").fill("demo");
  await page.getByTestId("ae-event-id").fill("12345");
  await page.getByTestId("ae-save").click();
  await expect(page.getByTestId("ae-status")).toBeVisible();
});
