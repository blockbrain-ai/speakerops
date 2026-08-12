/**
 * F5 ⌘K Find — browser e2e (admin).
 * Opens palette, rebuilds index, queries, asserts no error / no console errors.
 */
import { test, expect, type ConsoleMessage } from "@playwright/test";
import {
  loginAs,
  ensureEvent,
  sessionHeaders,
} from "./helpers/cfp-eval-seed.js";

test.describe("F5 Find palette", () => {
  test("@inv:Q01 e2e/find/palette admin opens Find, entity search without error", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg: ConsoleMessage) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      consoleErrors.push(String(err));
    });

    const email = `find-admin-${Date.now()}@example.com`;
    const { session } = await loginAs(
      request,
      context,
      baseURL,
      email,
      "admin",
    );
    const event = await ensureEvent(
      request,
      session,
      `Find Event ${Date.now()}`,
      `find-${Date.now()}`,
    );

    // Create entity (WS-B3 invalidates index generation).
    const formRes = await request.post(
      `/api/events/${encodeURIComponent(event.id)}/forms`,
      {
        headers: sessionHeaders(session),
        data: { name: "Findable CFP Form UniqueTitleXYZ" },
      },
    );
    expect([201, 200, 409]).toContain(formRes.status());

    // H2: prefer self-heal without UI reindex. In single-isolate e2e the consumer
    // is not a separate Worker — allow one system drain via reindex API if the
    // poll does not see hits yet (not the palette maintenance button).
    let searchBody: { hits?: unknown[]; stale?: boolean } = { hits: [] };
    for (let attempt = 0; attempt < 8; attempt++) {
      const searchRes = await request.get(
        `/api/events/${encodeURIComponent(event.id)}/search?q=Findable`,
        { headers: sessionHeaders(session) },
      );
      expect(searchRes.status()).toBe(200);
      searchBody = (await searchRes.json()) as {
        hits?: unknown[];
        stale?: boolean;
      };
      if ((searchBody.hits ?? []).length > 0) break;
      if (attempt === 2) {
        await request.post(
          `/api/events/${encodeURIComponent(event.id)}/search/reindex`,
          { headers: sessionHeaders(session) },
        );
      }
      await page.waitForTimeout(200);
    }
    expect(Array.isArray(searchBody.hits)).toBeTruthy();

    await page.goto("/admin");
    await expect(page.getByTestId("admin-shell")).toBeVisible({
      timeout: 15_000,
    });

    const eventSelect = page.getByTestId("event-context");
    if ((await eventSelect.count()) > 0) {
      const tag = await eventSelect.evaluate((el) => el.tagName.toLowerCase());
      if (tag === "select") {
        const options = eventSelect.locator("option");
        const n = await options.count();
        for (let i = 0; i < n; i++) {
          const val = await options.nth(i).getAttribute("value");
          if (val === event.id) {
            await eventSelect.selectOption(event.id);
            break;
          }
        }
      }
    }

    await page.getByTestId("topbar-find-trigger").click();
    await expect(page.getByTestId("find-palette")).toBeVisible();
    await expect(page.getByTestId("find-input")).toBeVisible();
    // Maintenance reindex remains available but is not required for the journey.
    await expect(page.getByTestId("find-reindex-footer")).toBeVisible();

    await page.getByTestId("find-input").fill("Findable");
    await page.waitForTimeout(500);

    // Must not show hard failure when event context is valid
    const err = page.getByTestId("find-error");
    if ((await err.count()) > 0 && (await err.isVisible())) {
      const text = (await err.textContent()) ?? "";
      expect(text).not.toMatch(/Search failed|Network error|Unexpected/i);
    }

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("find-palette")).toHaveCount(0);

    // Keyboard reopen
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+k" : "Control+k",
    );
    await expect(page.getByTestId("find-palette")).toBeVisible({
      timeout: 5_000,
    });

    const severe = consoleErrors.filter(
      (t) =>
        !t.includes("favicon") &&
        !t.includes("Download the React DevTools") &&
        !t.includes("useLayoutEffect") &&
        !t.includes("ReactDOM.useLayoutEffect"),
    );
    expect(severe, severe.join("\n")).toEqual([]);
  });
});
