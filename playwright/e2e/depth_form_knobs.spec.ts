/**
 * Post-11.9 depth Wave 1A — form builder knobs (S-CFP depth).
 *
 * D12: field help text + placeholder + character cap → public CFP renders
 *      help, live counter turns warning/over, over-cap blocked client AND
 *      server (fresh API 400).
 * D13: file field from the palette → publish → public uploads a real PDF →
 *      admin submission detail shows a working file link (bytes are %PDF).
 * D14: Form settings speaker min/max (1–15) → public add-speaker disabled at
 *      max with human copy; under-min and over-max rejected server-side (400).
 *
 * Inventory: @inv:D12 @inv:D13 @inv:D14 (one per test).
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

/** Create a form through the real builder UI (not API). */
async function createFormViaUi(page: Page, name: string): Promise<void> {
  await page.getByTestId("form-create-name").fill(name);
  await page.getByTestId("form-create-submit").click();
  await expect(page.getByTestId("form-create-status")).toContainText(
    /created form/i,
    { timeout: 10_000 },
  );
}

async function saveAndPublishViaUi(page: Page): Promise<void> {
  await page.getByTestId("form-save-draft").click();
  await expect(page.getByTestId("form-save-status")).toContainText(
    /draft saved/i,
    { timeout: 10_000 },
  );
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
  const body = (await res.json()) as {
    formVersion: { id: string } | null;
  };
  expect(body.formVersion?.id).toBeTruthy();
  return body.formVersion!.id;
}

test.describe("Wave 1A — form field help / placeholder / character cap", () => {
  test("@inv:D12 e2e/admin/form-field-help builder knobs render on public CFP; over-cap blocked client + server", async ({
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
      `e2e-d12-${stamp}@example.com`,
      "admin",
    );
    const event = await ensureEvent(
      request,
      admin.session,
      `Depth Help CFP ${stamp}`,
    );

    // Build through the real inspector.
    await selectAdminEvent(page, baseURL, event.id, "/admin/cfp");
    await createFormViaUi(page, "Field knobs form");
    await page.getByTestId("palette-textarea").click();
    await expect(page.getByTestId("field-editor")).toBeVisible();
    await page
      .getByTestId("field-edit-help")
      .fill("Two sentences describing your talk.");
    await page
      .getByTestId("field-edit-placeholder")
      .fill("e.g. A story about shipping");
    await page.getByTestId("field-edit-maxchars").fill("20");
    await saveAndPublishViaUi(page);

    // Public CFP renders help, placeholder, and a live counter.
    await page.goto(`/cfp/${event.slug}`);
    await expect(page.getByTestId("public-cfp-form")).toBeVisible();
    await expect(page.getByTestId("cfp-help-body")).toHaveText(
      "Two sentences describing your talk.",
    );
    await expect(page.getByTestId("cfp-field-body")).toHaveAttribute(
      "placeholder",
      "e.g. A story about shipping",
    );
    const counter = page.getByTestId("cfp-char-count-body");
    await expect(counter).toContainText("0 / 20 characters");
    await expect(counter).toHaveAttribute("data-tone", "ok");

    // Warning near the cap, over past it.
    await page.getByTestId("cfp-field-body").fill("x".repeat(17));
    await expect(counter).toHaveAttribute("data-tone", "warn");
    await page.getByTestId("cfp-field-body").fill("x".repeat(25));
    await expect(counter).toContainText("25 / 20 characters");
    await expect(counter).toHaveAttribute("data-tone", "over");

    // Client-side block: submit with over-cap answer shows the field error.
    await page.getByTestId("cfp-title").fill("Over-cap proposal");
    await page.getByTestId("cfp-speaker-name-0").fill("Cap Speaker");
    await page
      .getByTestId("cfp-speaker-email-0")
      .fill(`cap-speaker-${stamp}@example.com`);
    await page.getByTestId("cfp-turnstile-check").check();
    await page.getByTestId("public-cfp-primary").click();
    await expect(page.getByTestId("cfp-error-body")).toContainText(
      /limited to 20 characters/i,
    );
    await expect(page.getByTestId("public-cfp-confirmation")).toHaveCount(0);

    // Server-side block: fresh API request bypassing the UI → 400.
    const versionId = await fetchPublishedVersionId(request, event.slug);
    const overCap = await request.post(
      `/api/public/cfp/${event.slug}/submissions`,
      {
        data: {
          formVersionId: versionId,
          title: "Bypass over-cap",
          answers: [{ fieldKey: "body", value: "z".repeat(21) }],
          speakers: [
            { name: "Bypass", email: `bypass-${stamp}@example.com` },
          ],
          turnstileToken: "XXXX.DUMMY.TOKEN",
        },
      },
    );
    expect(overCap.status(), "over-cap submit must 400 server-side").toBe(400);

    // Trim to the cap → the same form submits fine.
    await page.getByTestId("cfp-field-body").fill("y".repeat(20));
    await expect(counter).toHaveAttribute("data-tone", "warn");
    await page.getByTestId("public-cfp-primary").click();
    await expect(page.getByTestId("public-cfp-confirmation")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("@inv:D13 e2e/admin/form-file-field palette file field → public PDF upload → admin detail file link serves bytes", async ({
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
      `e2e-d13-${stamp}@example.com`,
      "admin",
    );
    const event = await ensureEvent(
      request,
      admin.session,
      `Depth File CFP ${stamp}`,
    );

    // Builder: add the file field from the palette and mark it required.
    await selectAdminEvent(page, baseURL, event.id, "/admin/cfp");
    await createFormViaUi(page, "File field form");
    await page.getByTestId("palette-file").click();
    await expect(page.getByTestId("field-editor")).toBeVisible();
    await page.getByTestId("field-edit-required").check();
    await saveAndPublishViaUi(page);

    // Public: upload a real PDF and submit.
    await page.goto(`/cfp/${event.slug}`);
    await expect(page.getByTestId("public-cfp-form")).toBeVisible();
    const pdfBytes = Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
    );
    const [uploadRes] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes(`/api/public/cfp/${event.slug}/files`) &&
          r.request().method() === "POST",
      ),
      page.getByTestId("cfp-field-file").setInputFiles({
        name: "supporting-deck.pdf",
        mimeType: "application/pdf",
        buffer: pdfBytes,
      }),
    ]);
    expect(uploadRes.status(), "public file upload HTTP").toBe(201);
    // The SPA pins its upload to the published form version + file field —
    // the server rejects unpinned uploads outright.
    const uploadPayload = uploadRes.request().postDataJSON() as {
      formVersionId?: string;
      fieldKey?: string;
    };
    const pinnedVersionId = await fetchPublishedVersionId(request, event.slug);
    expect(uploadPayload.formVersionId, "upload pins formVersionId").toBe(
      pinnedVersionId,
    );
    expect(uploadPayload.fieldKey, "upload names the file field").toBe("file");
    const unpinned = await request.post(
      `/api/public/cfp/${event.slug}/files`,
      {
        data: {
          filename: "unpinned.pdf",
          mime: "application/pdf",
          size: pdfBytes.length,
          contentBase64: pdfBytes.toString("base64"),
        },
      },
    );
    expect(unpinned.status(), "unpinned upload rejected").toBe(400);
    await expect(page.getByTestId("cfp-file-id-file")).toContainText(
      /uploaded/i,
    );

    await page.getByTestId("cfp-title").fill("Talk with deck");
    await page.getByTestId("cfp-speaker-name-0").fill("Deck Speaker");
    await page
      .getByTestId("cfp-speaker-email-0")
      .fill(`deck-speaker-${stamp}@example.com`);
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
    };
    await expect(page.getByTestId("public-cfp-confirmation")).toBeVisible();

    // Admin detail: "Uploaded file" link (not the raw file:<id> token).
    await selectAdminEvent(
      page,
      baseURL,
      event.id,
      `/admin/submissions?submissionId=${submitBody.submission.id}`,
    );
    const fileLink = page.locator(
      '[data-testid^="submission-file-link-"]',
    );
    await expect(fileLink).toBeVisible({ timeout: 15_000 });
    await expect(fileLink).toHaveText("Uploaded file");
    const fileId = await fileLink.getAttribute("data-file-id");
    expect(fileId, "file link must carry the file id").toBeTruthy();
    // Raw token never rendered to the admin.
    await expect(
      page.getByTestId("submission-detail-answers"),
    ).not.toContainText("file:");

    // Download proof: the link target serves the actual PDF bytes.
    const download = await request.get(
      `/api/files/${encodeURIComponent(fileId!)}`,
      { headers: sessionHeaders(admin.session) },
    );
    expect(download.status(), "admin file download HTTP").toBe(200);
    const bytes = await download.body();
    expect(bytes.subarray(0, 5).toString("utf8")).toBe("%PDF-");
  });

  test("@inv:D14 e2e/admin/form-speaker-bounds configurable min/max enforced client and server", async ({
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
      `e2e-d14-${stamp}@example.com`,
      "admin",
    );
    const event = await ensureEvent(
      request,
      admin.session,
      `Depth Bounds CFP ${stamp}`,
    );

    // Builder: Form settings panel sets min=2 / max=2.
    await selectAdminEvent(page, baseURL, event.id, "/admin/cfp");
    await createFormViaUi(page, "Speaker bounds form");
    await page.getByTestId("palette-text").click();
    await expect(page.getByTestId("form-settings-panel")).toBeVisible();
    await page.getByTestId("form-min-speakers").fill("2");
    await page.getByTestId("form-max-speakers").fill("2");
    await saveAndPublishViaUi(page);

    // Public GET reflects pinned bounds.
    const pubRes = await request.get(`/api/public/cfp/${event.slug}`);
    expect(pubRes.ok()).toBeTruthy();
    const pub = (await pubRes.json()) as {
      formVersion: { id: string } | null;
      minSpeakers: number;
      maxSpeakers: number;
    };
    expect(pub.minSpeakers).toBe(2);
    expect(pub.maxSpeakers).toBe(2);
    const versionId = pub.formVersion!.id;

    // Public UI: third speaker blocked (button disabled at max, human copy).
    await page.goto(`/cfp/${event.slug}`);
    await expect(page.getByTestId("public-cfp-form")).toBeVisible();
    await expect(page.getByTestId("cfp-speaker-bounds")).toContainText(
      "2–2 speakers",
    );
    const addBtn = page.getByTestId("cfp-speaker-add");
    await expect(addBtn).toBeEnabled();
    await addBtn.click();
    await expect(page.getByTestId("cfp-speaker-block-1")).toBeVisible();
    await expect(addBtn).toBeDisabled();
    await expect(page.getByTestId("cfp-speaker-max-note")).toContainText(
      /maximum/i,
    );

    // Server: fresh requests bypassing the UI — 3 speakers and 1 speaker → 400.
    const mkSpeakers = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        name: `Bounds Speaker ${i + 1}`,
        email: `bounds-${stamp}-${i + 1}@example.com`,
      }));
    const basePayload = {
      formVersionId: versionId,
      title: "Bounds bypass",
      answers: [],
      turnstileToken: "XXXX.DUMMY.TOKEN",
    };
    const over = await request.post(
      `/api/public/cfp/${event.slug}/submissions`,
      { data: { ...basePayload, speakers: mkSpeakers(3) } },
    );
    expect(over.status(), "third speaker must 400 server-side").toBe(400);
    const under = await request.post(
      `/api/public/cfp/${event.slug}/submissions`,
      { data: { ...basePayload, speakers: mkSpeakers(1) } },
    );
    expect(under.status(), "single speaker must 400 when min=2").toBe(400);

    // Within bounds still submits through the real form.
    await page.getByTestId("cfp-title").fill("Two-speaker talk");
    await page.getByTestId("cfp-speaker-name-0").fill("Speaker One");
    await page
      .getByTestId("cfp-speaker-email-0")
      .fill(`bounds-ui-${stamp}-1@example.com`);
    await page.getByTestId("cfp-speaker-name-1").fill("Speaker Two");
    await page
      .getByTestId("cfp-speaker-email-1")
      .fill(`bounds-ui-${stamp}-2@example.com`);
    await page.getByTestId("cfp-turnstile-check").check();
    await page.getByTestId("public-cfp-primary").click();
    await expect(page.getByTestId("public-cfp-confirmation")).toBeVisible({
      timeout: 10_000,
    });
  });
});
