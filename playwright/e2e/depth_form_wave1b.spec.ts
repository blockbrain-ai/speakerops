/**
 * Post-11.9 depth Wave 1B — form structure + per-submitter cap (S-CFP depth).
 *
 * D15: Form settings "Max submissions per person" → public CFP enforces the
 *      cap by normalized submitter email (fresh API 400 with human copy);
 *      different email passes; the total cap stays independent.
 * D16: Section + divider layout nodes: compose in the builder (reorder works),
 *      publish, reload round-trips, public renders headings/dividers, and the
 *      submitted DTO carries NO layout answers; a conditional rule adjacent to
 *      layout nodes still evaluates.
 *
 * Inventory: @inv:D15 @inv:D16 (one per test).
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e). New critical spec → retries 0.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  loginAs,
  ensureEvent,
  selectAdminEvent,
  sessionHeaders,
} from "./helpers/cfp-eval-seed";

test.describe.configure({ retries: 0 });

async function createFormViaUi(page: Page, name: string): Promise<void> {
  await page.getByTestId("form-create-name").fill(name);
  await page.getByTestId("form-create-submit").click();
  await expect(page.getByTestId("form-create-status")).toContainText(
    /created form/i,
    { timeout: 10_000 },
  );
}

async function saveDraftViaUi(page: Page): Promise<void> {
  await page.getByTestId("form-save-draft").click();
  await expect(page.getByTestId("form-save-status")).toContainText(
    /draft saved/i,
    { timeout: 10_000 },
  );
}

async function publishViaUi(page: Page): Promise<void> {
  await page.getByTestId("form-publish").click();
  await expect(page.getByTestId("form-publish-status")).toContainText(
    /published version/i,
    { timeout: 10_000 },
  );
}

async function fetchPublishedVersionId(
  request: import("@playwright/test").APIRequestContext,
  slug: string,
): Promise<string> {
  const res = await request.get(`/api/public/cfp/${slug}`);
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { formVersion: { id: string } | null };
  expect(body.formVersion?.id).toBeTruthy();
  return body.formVersion!.id;
}

test.describe("Wave 1B — per-submitter cap + layout nodes", () => {
  test("@inv:D15 e2e/admin/form-per-submitter-limit per-person cap enforced by email; total cap independent", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const stamp = Date.now();
    const admin = await loginAs(
      request,
      context,
      baseURL,
      `e2e-d15-${stamp}@example.com`,
      "admin",
    );
    const event = await ensureEvent(
      request,
      admin.session,
      `Depth PerCap CFP ${stamp}`,
    );

    // Builder: one field + per-person cap 1 (Form settings card) + total cap 2
    // (advanced limits section, relabeled "Max total submissions").
    await selectAdminEvent(page, baseURL, event.id, "/admin/cfp");
    await createFormViaUi(page, "Per-submitter cap form");
    await page.getByTestId("palette-text").click();
    await expect(page.getByTestId("form-settings-panel")).toBeVisible();
    await page.getByTestId("form-per-submitter-limit").fill("1");
    await page.getByTestId("form-submission-limit").fill("2");
    await saveDraftViaUi(page);
    await publishViaUi(page);

    // Public UI: first submission from casey@ succeeds.
    await page.goto(`/cfp/${event.slug}`);
    await expect(page.getByTestId("public-cfp-form")).toBeVisible();
    await page.getByTestId("cfp-title").fill("Casey's talk");
    await page.getByTestId("cfp-speaker-name-0").fill("Casey Quinn");
    await page
      .getByTestId("cfp-speaker-email-0")
      .fill(`casey-${stamp}@example.com`);
    await page.getByTestId("cfp-turnstile-check").check();
    await page.getByTestId("public-cfp-primary").click();
    await expect(page.getByTestId("public-cfp-confirmation")).toBeVisible({
      timeout: 10_000,
    });

    // Fresh API assert: same email (different casing) → 400 with human copy.
    const versionId = await fetchPublishedVersionId(request, event.slug);
    const basePayload = {
      formVersionId: versionId,
      answers: [],
      turnstileToken: "XXXX.DUMMY.TOKEN",
    };
    const sameEmail = await request.post(
      `/api/public/cfp/${event.slug}/submissions`,
      {
        data: {
          ...basePayload,
          title: "Casey again",
          speakers: [
            { name: "Casey Quinn", email: `CASEY-${stamp}@Example.COM` },
          ],
        },
      },
    );
    expect(sameEmail.status(), "same submitter over cap must 400").toBe(400);
    const sameBody = (await sameEmail.json()) as { error: string };
    expect(sameBody.error).toMatch(/already submitted/i);
    expect(sameBody.error).not.toMatch(/_/);

    // Different email passes (second of two total).
    const other = await request.post(
      `/api/public/cfp/${event.slug}/submissions`,
      {
        data: {
          ...basePayload,
          title: "Jordan's talk",
          speakers: [
            { name: "Jordan Lee", email: `jordan-${stamp}@example.com` },
          ],
        },
      },
    );
    expect(other.status(), "different submitter must pass").toBe(201);

    // Total cap (2) still enforced independently for a third person.
    const third = await request.post(
      `/api/public/cfp/${event.slug}/submissions`,
      {
        data: {
          ...basePayload,
          title: "Riley's talk",
          speakers: [
            { name: "Riley Poe", email: `riley-${stamp}@example.com` },
          ],
        },
      },
    );
    expect(third.status(), "total cap must still apply").toBe(400);
    const thirdBody = (await third.json()) as { error: string };
    expect(thirdBody.error).toBe("Submission limit reached");
  });

  test("@inv:D16 e2e/admin/form-layout-nodes sections/dividers compose, round-trip, render publicly, never answer", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const stamp = Date.now();
    const admin = await loginAs(
      request,
      context,
      baseURL,
      `e2e-d16-${stamp}@example.com`,
      "admin",
    );
    const event = await ensureEvent(
      request,
      admin.session,
      `Depth Layout CFP ${stamp}`,
    );

    // Builder: section → text → divider → select → conditional textarea.
    await selectAdminEvent(page, baseURL, event.id, "/admin/cfp");
    await createFormViaUi(page, "Layout form");

    await page.getByTestId("palette-section").click();
    await expect(page.getByTestId("field-editor")).toBeVisible();
    await page.getByTestId("layout-edit-label").fill("About you");

    await page.getByTestId("palette-text").click();
    await page.getByTestId("palette-divider").click();
    await expect(page.getByTestId("layout-divider-note")).toBeVisible();

    await page.getByTestId("palette-select").click();
    await page
      .getByTestId("field-edit-options")
      .fill("ai|AI track\nweb|Web track");

    await page.getByTestId("palette-textarea").click();
    await page.getByTestId("field-condition-enabled").check();
    await page
      .getByTestId("field-condition-field")
      .selectOption("select");
    await page.getByTestId("field-condition-value").fill("ai");

    // Reorder works with layout nodes: move the divider up one slot and back.
    const canvasKeys = () =>
      page
        .locator('[data-testid^="field-item-"]')
        .evaluateAll((els) =>
          els.map((el) => el.getAttribute("data-field-key")),
        );
    expect(await canvasKeys()).toEqual([
      "layout_section",
      "text",
      "layout_divider",
      "select",
      "body",
    ]);
    await page.getByTestId("field-move-up-layout_divider").click();
    expect(await canvasKeys()).toEqual([
      "layout_section",
      "layout_divider",
      "text",
      "select",
      "body",
    ]);
    await page.getByTestId("field-move-down-layout_divider").click();
    expect(await canvasKeys()).toEqual([
      "layout_section",
      "text",
      "layout_divider",
      "select",
      "body",
    ]);

    // Builder preview renders the structure, not inputs.
    await expect(
      page.getByTestId("form-preview-section-layout_section"),
    ).toHaveText("About you");
    await expect(
      page.getByTestId("form-preview-divider-layout_divider"),
    ).toBeVisible();

    await saveDraftViaUi(page);

    // Reload → reopen preserves layout nodes and the section label.
    await page.reload();
    await expect(page.getByTestId("form-load-status")).toContainText(
      /loaded/i,
      { timeout: 15_000 },
    );
    expect(await canvasKeys()).toEqual([
      "layout_section",
      "text",
      "layout_divider",
      "select",
      "body",
    ]);
    await page.getByTestId("field-select-layout_section").click();
    await expect(page.getByTestId("layout-edit-label")).toHaveValue(
      "About you",
    );

    await publishViaUi(page);

    // Public CFP renders the heading + divider; conditional still evaluates.
    await page.goto(`/cfp/${event.slug}`);
    await expect(page.getByTestId("public-cfp-form")).toBeVisible();
    await expect(
      page.getByTestId("cfp-section-heading-layout_section"),
    ).toHaveText("About you");
    await expect(page.getByTestId("cfp-divider-layout_divider")).toBeVisible();
    // Conditional textarea hidden until the select matches.
    await expect(page.getByTestId("cfp-field-wrap-body")).toHaveCount(0);
    await page.getByTestId("cfp-field-select").selectOption("ai");
    await expect(page.getByTestId("cfp-field-wrap-body")).toBeVisible();
    await page.getByTestId("cfp-field-body").fill("Conditional details");

    await page.getByTestId("cfp-title").fill("Structured talk");
    await page.getByTestId("cfp-speaker-name-0").fill("Sky Structure");
    await page
      .getByTestId("cfp-speaker-email-0")
      .fill(`sky-${stamp}@example.com`);
    await page.getByTestId("cfp-turnstile-check").check();
    const [submitRes] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes(`/api/public/cfp/${event.slug}/submissions`) &&
          r.request().method() === "POST",
      ),
      page.getByTestId("public-cfp-primary").click(),
    ]);
    expect(submitRes.status()).toBe(201);
    const submitBody = (await submitRes.json()) as {
      submission: { id: string };
      answers: Array<{ fieldKey: string }>;
    };
    await expect(page.getByTestId("public-cfp-confirmation")).toBeVisible();

    // Submitted DTO contains NO layout answers; conditional answer stored.
    const answerKeys = submitBody.answers.map((a) => a.fieldKey);
    expect(answerKeys).not.toContain("layout_section");
    expect(answerKeys).not.toContain("layout_divider");
    expect(answerKeys).toContain("body");
    expect(answerKeys).toContain("select");

    // Admin detail DTO stays clean too (stored rows, not just the echo).
    const detail = await request.get(
      `/api/submissions/${submitBody.submission.id}`,
      { headers: sessionHeaders(admin.session) },
    );
    expect(detail.status()).toBe(200);
    const detailBody = (await detail.json()) as {
      answers: Array<{ fieldKey: string }>;
    };
    const storedKeys = detailBody.answers.map((a) => a.fieldKey);
    expect(storedKeys).not.toContain("layout_section");
    expect(storedKeys).not.toContain("layout_divider");
    expect(storedKeys).toContain("body");
  });
});
