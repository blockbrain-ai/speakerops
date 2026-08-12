/**
 * Wave-1 form builder guided wizard rail (owner-approved mock).
 * Additive chrome — three-region build layout remains (see cfp_lumen2).
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import { loginAs, sessionHeaders } from "./helpers/cfp-eval-seed.js";

const RUN = `${Date.now()}`;

async function ensureEvent(
  request: APIRequestContext,
  session: string,
  name: string,
  slug: string,
) {
  const res = await request.post("/api/events", {
    headers: sessionHeaders(session),
    data: {
      name,
      slug,
      timezone: "UTC",
      startsAt: "2026-09-01T09:00:00.000Z",
      endsAt: "2026-09-02T17:00:00.000Z",
    },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { event: { id: string } };
  return body.event;
}

test.describe("form builder guided wizard", () => {
  test("wizard rail + back/next navigates steps; three regions intact", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const admin = await loginAs(
      request,
      context,
      baseURL,
      `e2e-wizard-${RUN}@example.com`,
      "admin",
    );
    const event = await ensureEvent(
      request,
      admin.session,
      `Wizard Form ${RUN}`,
      `wizard-form-${RUN}`,
    );

    await page.addInitScript((id) => {
      localStorage.setItem("speakerops.activeEventId", id);
    }, event.id);
    await page.goto("/admin/cfp");
    await expect(page.getByTestId("page-cfp")).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("form-create-name").fill(`Wizard CFP ${RUN}`);
    await page.getByTestId("form-create-submit").click();
    await expect(page.getByTestId("form-builder-wizard")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("form-builder-wizard-rail")).toBeVisible();
    await expect(page.getByTestId("form-wizard-step-proposal")).toHaveAttribute(
      "aria-current",
      "step",
    );

    // Three regions still present (e2e contract)
    await expect(page.getByTestId("builder-outline")).toBeVisible();
    await expect(page.getByTestId("builder-canvas")).toBeVisible();
    await expect(page.getByTestId("builder-inspector")).toBeVisible();

    // Next → Participants
    await page.getByTestId("form-wizard-next").click();
    await expect(
      page.getByTestId("form-wizard-step-participants"),
    ).toHaveAttribute("aria-current", "step");
    await expect(page.getByTestId("form-settings-panel")).toBeVisible();

    // Jump to Welcome via rail
    await page.getByTestId("form-wizard-step-welcome").click();
    await expect(page.getByTestId("form-wizard-step-welcome")).toHaveAttribute(
      "aria-current",
      "step",
    );
    await expect(page.getByTestId("form-advanced-body")).toBeVisible();
    await expect(page.getByTestId("form-welcome-md")).toBeVisible();
  });
});
