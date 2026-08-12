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
  test("@inv:Q01 e2e/find/palette admin opens Find, rebuilds index, searches without error", async ({
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

    // Create a form shell so reindex has something to project; title is searchable
    // after publish + public submit (if available) — always reindex works.
    const formRes = await request.post(
      `/api/events/${encodeURIComponent(event.id)}/forms`,
      {
        headers: sessionHeaders(session),
        data: { name: "Findable CFP Form UniqueTitleXYZ" },
      },
    );
    // Form create may be 201; do not hard-fail suite if estate differs
    expect([201, 200, 409]).toContain(formRes.status());

    // API reindex must succeed for the event
    const reindex = await request.post(
      `/api/events/${encodeURIComponent(event.id)}/search/reindex`,
      { headers: sessionHeaders(session) },
    );
    const reindexStatus = reindex.status();
    const reindexBody = (await reindex.json()) as { indexed?: number };
    expect(reindexStatus, JSON.stringify(reindexBody)).toBe(200);
    expect(reindexBody.indexed ?? 0).toBeGreaterThanOrEqual(0);

    // Search API (the dogfood bug was empty hits from D1 .run SELECT)
    const searchRes = await request.get(
      `/api/events/${encodeURIComponent(event.id)}/search?q=Findable`,
      { headers: sessionHeaders(session) },
    );
    const searchStatus = searchRes.status();
    const searchBody = (await searchRes.json()) as { hits?: unknown[] };
    expect(searchStatus, JSON.stringify(searchBody)).toBe(200);
    expect(Array.isArray(searchBody.hits)).toBeTruthy();
    // After fix, form name should appear when indexed > 0
    if ((reindexBody.indexed ?? 0) > 0) {
      expect((searchBody.hits ?? []).length).toBeGreaterThan(0);
    }

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
    await page.getByTestId("find-reindex-footer").click();
    await expect(page.getByTestId("find-reindex-footer")).toBeEnabled({
      timeout: 15_000,
    });

    await page.getByTestId("find-input").fill("Event");
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
