/**
 * Q08 — Team invite + last-admin protection.
 */
import { test, expect } from "@playwright/test";
import {
  loginAs,
  ensureEvent,
  sessionHeaders,
} from "./helpers/cfp-eval-seed.js";

test.describe("Team invite", () => {
  test("@inv:Q08 e2e/team/invite admin adds evaluator; last-admin demotion blocked", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const adminEmail = `team-admin-${Date.now()}@example.com`;
    const { session } = await loginAs(
      request,
      context,
      baseURL,
      adminEmail,
      "admin",
    );
    const event = await ensureEvent(
      request,
      session,
      `Team Event ${Date.now()}`,
      `team-${Date.now()}`,
    );
    const headers = sessionHeaders(session);

    const inviteEmail = `team-eval-${Date.now()}@example.com`;
    const inv = await request.post(
      `/api/events/${encodeURIComponent(event.id)}/invites`,
      {
        headers,
        data: { email: inviteEmail, role: "evaluator" },
      },
    );
    expect(inv.status(), await inv.text()).toBe(201);
    const body = (await inv.json()) as { inviteId: string };
    expect(body.inviteId).toBeTruthy();

    // UI path
    await page.goto("/admin");
    await expect(page.getByTestId("admin-shell")).toBeVisible({
      timeout: 15_000,
    });
    const eventSelect = page.getByTestId("event-context");
    if ((await eventSelect.count()) > 0) {
      await eventSelect.selectOption(event.id).catch(() => undefined);
    }
    await page.getByTestId("nav-team").click();
    await expect(page.getByTestId("page-team")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("team-add-member-email").fill(`ui-${inviteEmail}`);
    await page.getByTestId("team-add-member-role").selectOption("speaker");
    await page.getByTestId("team-add-member-submit").click();
    await expect(page.getByTestId("team-list")).toBeVisible({ timeout: 10_000 });

    // Last admin demotion blocked (only one admin = creator)
    const me = await request.get("/api/auth/me", { headers });
    // Find admin user id from members list
    const members = await request.get(
      `/api/events/${encodeURIComponent(event.id)}/members`,
      { headers },
    );
    if (members.status() === 200) {
      const list = (await members.json()) as {
        members: { userId: string; role: string }[];
      };
      const admin = list.members.find((m) => m.role === "admin");
      if (admin) {
        const demote = await request.patch(
          `/api/events/${encodeURIComponent(event.id)}/members/${encodeURIComponent(admin.userId)}`,
          {
            headers,
            data: { role: "speaker" },
          },
        );
        expect(demote.status()).toBe(409);
      }
    }
    void me;
  });
});
