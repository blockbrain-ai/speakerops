/**
 * F2 — rich-text platform primitive (foundation wave).
 *
 * - @inv:D17 e2e/admin/form-rich-text — author rich welcome (H2/bold/list) +
 *   a rich_text field in the builder → publish → public CFP renders the
 *   authored NODES faithfully (DOM assertions) → submitter fills a rich
 *   answer → admin submission-detail renders it → CSV export shows plain
 *   text (never doc JSON). Negative: builder link dialog rejects a
 *   javascript: URL inline.
 * - @inv:G13 e2e/portal/bio-rich — speaker edits a rich bio (bold) in the
 *   portal profile tab → renders formatted in the admin speaker view.
 * - @inv:J14 e2e/comms/template-rich — comms template body edited in the
 *   rich editor → preview shows the RENDERED body; a markup-shaped merge
 *   value (recipient name) stays escaped text in the rendered preview.
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e). retries:0 (suite law).
 */
import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureEvent,
  sessionHeaders,
  requestMagicLink,
  fetchDevLink,
  exchangeForCookie,
  seedSessionCookie,
} from "./helpers/cfp-eval-seed.js";

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TURNSTILE_DEV_PASS_TOKEN = "XXXX.DUMMY.TOKEN";

/** Minimal valid JPEG (1×1) for the wizard headshot step. */
const MINI_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//Z",
  "base64",
);

async function loginAsAdmin(
  request: import("@playwright/test").APIRequestContext,
  context: import("@playwright/test").BrowserContext,
  baseURL: string | undefined,
  email: string,
): Promise<string> {
  await requestMagicLink(request, email, "admin");
  const link = await fetchDevLink(request, email);
  const session = await exchangeForCookie(request, link.token);
  await seedSessionCookie(context, baseURL, session);
  return session;
}

async function loginAsSpeaker(
  request: import("@playwright/test").APIRequestContext,
  context: import("@playwright/test").BrowserContext,
  baseURL: string | undefined,
  email: string,
  eventId: string,
): Promise<string> {
  await requestMagicLink(request, email, "speaker", eventId);
  const link = await fetchDevLink(request, email);
  const session = await exchangeForCookie(request, link.token);
  await context.clearCookies();
  await seedSessionCookie(context, baseURL, session);
  return session;
}

/** Seed an accepted speaker via public CFP submit + admin accept (API). */
async function seedAcceptedSpeaker(
  request: import("@playwright/test").APIRequestContext,
  session: string,
  eventId: string,
  slug: string,
  speakerEmail: string,
  speakerName: string,
  title: string,
): Promise<{ participationId: string }> {
  const create = await request.post(`/api/events/${eventId}/forms`, {
    headers: sessionHeaders(session),
    data: { name: `Seed CFP ${title}` },
  });
  expect(create.status()).toBe(201);
  const form = (await create.json()) as { form: { id: string } };

  const draft = await request.put(`/api/forms/${form.form.id}/draft`, {
    headers: sessionHeaders(session),
    data: {
      fields: [
        {
          fieldKey: "abstract",
          type: "textarea",
          label: "Abstract",
          required: true,
          sortOrder: 0,
        },
      ],
      rules: [],
    },
  });
  expect(draft.status()).toBe(200);
  const publish = await request.post(`/api/forms/${form.form.id}/publish`, {
    headers: sessionHeaders(session),
    data: {},
  });
  expect(publish.status()).toBe(200);
  const pub = (await publish.json()) as { formVersion: { id: string } };

  const submit = await request.post(`/api/public/cfp/${slug}/submissions`, {
    data: {
      formVersionId: pub.formVersion.id,
      title,
      speakers: [{ name: speakerName, email: speakerEmail, isPrimary: true }],
      answers: [{ fieldKey: "abstract", value: "F2 seed abstract" }],
      turnstileToken: TURNSTILE_DEV_PASS_TOKEN,
    },
  });
  expect(submit.status(), await submit.text()).toBe(201);
  const sub = (await submit.json()) as { submission: { id: string } };
  const decision = await request.post(
    `/api/submissions/${sub.submission.id}/decision`,
    {
      headers: sessionHeaders(session),
      data: { decision: "accept" },
    },
  );
  expect(decision.status(), await decision.text()).toBe(200);
  const body = (await decision.json()) as {
    participations: Array<{ id: string }>;
  };
  return { participationId: body.participations[0]!.id };
}

/** Open an admin page with the given event active in EventContext. */
async function openAdminPage(
  page: import("@playwright/test").Page,
  baseURL: string | undefined,
  eventId: string,
  path: string,
  pageTestId: string,
) {
  await page.addInitScript((id) => {
    localStorage.setItem("speakerops.activeEventId", id);
  }, eventId);
  await page.goto(`${baseURL ?? ""}${path}`);
  await expect(page.getByTestId(pageTestId)).toBeVisible({ timeout: 15_000 });
}

test.describe("F2 rich-text primitive", () => {
  test("@inv:D17 e2e/admin/form-rich-text author rich welcome + rich answer round-trip to admin + CSV", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const run = `${RUN}-d17`;
    const session = await loginAsAdmin(
      request,
      context,
      baseURL,
      `f2-d17-admin-${run}@example.com`,
    );
    const event = await ensureEvent(
      request,
      session,
      `F2 Rich Event ${run}`,
      `f2-rich-${run}`,
    );

    await openAdminPage(page, baseURL, event.id, "/admin/cfp", "page-cfp");

    // Create form.
    await page.getByTestId("form-create-name").fill(`F2 Rich CFP ${run}`);
    await page.getByTestId("form-create-submit").click();
    await expect(page.getByTestId("form-create-status")).toContainText(
      /Created/i,
      { timeout: 10_000 },
    );

    // Add a required text field + the new rich_text field from the palette.
    await page.getByTestId("palette-text").click();
    await page.getByTestId("palette-rich-text").click();

    // ---- Author the rich welcome with REAL typing + toolbar clicks ----
    // Natural typing order, no mid-flow select-all (a live selection would be
    // replaced by the next keystroke).
    const welcome = page.getByTestId("form-welcome-md");
    await welcome.click();
    await page.getByTestId("form-welcome-md-btn-h2").click();
    await page.keyboard.type(`Big F2 Welcome ${run}`);
    // Structural proof INSIDE the editor: the line is a real <h2>.
    await expect(
      welcome.locator("h2", { hasText: `Big F2 Welcome ${run}` }),
    ).toBeVisible();
    await page.keyboard.press("Enter");
    // Heading may persist across the split — ensure the new line is a paragraph.
    if (
      (await page
        .getByTestId("form-welcome-md-btn-h2")
        .getAttribute("aria-pressed")) === "true"
    ) {
      await page.getByTestId("form-welcome-md-btn-h2").click();
    }
    // New paragraph: plain + bold run.
    await page.keyboard.type("plain ");
    await page.getByTestId("form-welcome-md-btn-bold").click();
    await page.keyboard.type("boldpart");
    await page.getByTestId("form-welcome-md-btn-bold").click();
    // Bullet list line.
    await page.keyboard.press("Enter");
    await page.getByTestId("form-welcome-md-btn-bulletList").click();
    await page.keyboard.type("first item");
    // Editor now holds h2 + paragraph(bold run) + bullet list.
    await expect(
      welcome.locator("strong", { hasText: "boldpart" }),
    ).toBeVisible();
    await expect(
      welcome.locator("ul li", { hasText: "first item" }),
    ).toBeVisible();

    // Negative: the link dialog rejects a javascript: URL inline (caret only —
    // validation happens before any selection is needed).
    await page.getByTestId("form-welcome-md-btn-link").click();
    await page
      .getByTestId("form-welcome-md-link-input")
      .fill("javascript:alert(1)");
    await page.getByTestId("form-welcome-md-link-apply").click();
    await expect(page.getByTestId("form-welcome-md-link-error")).toContainText(
      /valid https/i,
    );
    await page.getByTestId("form-welcome-md-link-cancel").click();

    // Save + publish.
    await page.getByTestId("form-save-draft").click();
    await expect(page.getByTestId("form-save-status")).toContainText(
      /Draft saved/i,
      { timeout: 10_000 },
    );
    await expect(page.getByTestId("form-publish")).toBeEnabled();
    await page.getByTestId("form-publish").click();
    await expect(page.getByTestId("form-publish-status")).toContainText(
      /published/i,
      { timeout: 10_000 },
    );

    // ---- Public CFP renders the authored NODES faithfully ----
    await page.goto(`${baseURL ?? ""}/cfp/${event.slug}`);
    const welcomeBlock = page.getByTestId("public-cfp-welcome");
    await expect(welcomeBlock).toBeVisible({ timeout: 15_000 });
    await expect(
      welcomeBlock.locator("h2", { hasText: `Big F2 Welcome ${run}` }),
    ).toBeVisible();
    await expect(
      welcomeBlock.locator("strong", { hasText: "boldpart" }),
    ).toBeVisible();
    await expect(
      welcomeBlock.locator("ul li", { hasText: "first item" }),
    ).toBeVisible();
    // The raw doc JSON never leaks into the page.
    await expect(welcomeBlock).not.toContainText('"schema"');

    // ---- Submitter fills the rich answer (compact editor, real typing) ----
    await page.getByTestId("cfp-title").fill(`F2 Rich Talk ${run}`);
    await page.getByTestId("cfp-field-text").fill("Required text answer");
    const richField = page.getByTestId("cfp-field-rich");
    await richField.click();
    await page.keyboard.type("My answer with ");
    await page.getByTestId("cfp-field-rich-btn-bold").click();
    await page.keyboard.type("emphasis");
    await page.getByTestId("cfp-speaker-name-0").fill(`F2 Speaker ${run}`);
    await page
      .getByTestId("cfp-speaker-email-0")
      .fill(`f2-d17-speaker-${run}@example.com`);
    await page.getByTestId("cfp-turnstile-check").check();
    await page.getByTestId("public-cfp-primary").click();
    await expect(page.getByTestId("public-cfp-confirmation")).toBeVisible({
      timeout: 15_000,
    });

    // ---- Admin submission detail renders the rich answer ----
    await openAdminPage(
      page,
      baseURL,
      event.id,
      "/admin/submissions",
      "page-submissions",
    );
    const row = page
      .locator(`[data-testid^="submission-open-"]`)
      .filter({ hasText: `F2 Rich Talk ${run}` })
      .first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();
    const answerBlock = page.getByTestId("answer-rich");
    await expect(answerBlock).toBeVisible({ timeout: 10_000 });
    await expect(
      answerBlock.locator("strong", { hasText: "emphasis" }),
    ).toBeVisible();
    await expect(answerBlock).not.toContainText('"schema"');

    // ---- CSV export shows deterministic plain text, never doc JSON ----
    const csvRes = await request.get(
      `/api/events/${event.id}/submissions/export`,
      { headers: { cookie: `speakerops_session=${session}` } },
    );
    expect(csvRes.status()).toBe(200);
    const csv = await csvRes.text();
    expect(csv).toContain("My answer with emphasis");
    expect(csv).not.toContain('""schema"":""v1""');
    expect(csv).not.toContain('"schema":"v1"');
  });

  test("@inv:G13 e2e/portal/bio-rich speaker edits rich bio; admin view renders formatting", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const run = `${RUN}-g13`;
    const adminEmail = `f2-g13-admin-${run}@example.com`;
    const speakerEmail = `f2-g13-speaker-${run}@example.com`;
    const adminSession = await loginAsAdmin(
      request,
      context,
      baseURL,
      adminEmail,
    );
    const event = await ensureEvent(
      request,
      adminSession,
      `F2 Bio Event ${run}`,
      `f2-bio-${run}`,
    );
    const seeded = await seedAcceptedSpeaker(
      request,
      adminSession,
      event.id,
      event.slug,
      speakerEmail,
      `F2 Bio Speaker ${run}`,
      `F2 Bio Talk ${run}`,
    );

    // Speaker: land in the onboarding wizard first (fresh accept), walk it to
    // completion via the real UI (nav_ux pattern), then open the Profile tab.
    await loginAsSpeaker(request, context, baseURL, speakerEmail, event.id);
    await page.goto(
      `${baseURL ?? ""}/portal?eventId=${encodeURIComponent(event.id)}`,
    );
    const fixtureDir = join(tmpdir(), `speakerops-f2-${RUN}`);
    mkdirSync(fixtureDir, { recursive: true });
    const jpegPath = join(fixtureDir, "headshot.jpg");
    writeFileSync(jpegPath, MINI_JPEG);
    // Freshly accepted speaker ⇒ the exclusive onboarding wizard must appear;
    // wait for it BEFORE the walk (the loop must not race initial load).
    await expect(page.getByTestId("portal-onboarding-wizard")).toBeVisible({
      timeout: 15_000,
    });
    for (let i = 0; i < 10; i++) {
      const wizard = page.getByTestId("portal-onboarding-wizard");
      if (!(await wizard.isVisible().catch(() => false))) break;
      const kind =
        (await wizard.getAttribute("data-step-kind"))?.toLowerCase() ?? "";
      if (kind === "bio") {
        await page
          .getByTestId("portal-bio-input")
          .fill(`Wizard legacy bio ${run}`);
      } else if (kind === "company") {
        await page.getByTestId("portal-company-input").fill("F2 Test Co");
      } else if (kind === "title") {
        await page.getByTestId("portal-title-input").fill("Rich Engineer");
      } else if (kind === "headshot") {
        await page.getByTestId("portal-headshot-input").setInputFiles(jpegPath);
        await expect(page.getByTestId("portal-headshot-preview")).toBeVisible({
          timeout: 15_000,
        });
      } else if (kind === "task_text") {
        await page
          .getByTestId("portal-wizard-freeform")
          .fill(`F2 wizard note ${run}`);
      }
      await expect(page.getByTestId("portal-wizard-continue")).toBeEnabled();
      await page.getByTestId("portal-wizard-continue").click();
      // Wait until the step actually advances (or the wizard exits) — the
      // continue handler saves + soft-reloads, so a fixed sleep races.
      await expect
        .poll(
          async () => {
            const vis = await wizard.isVisible().catch(() => false);
            if (!vis) return "__exited__";
            return (await wizard.getAttribute("data-step-kind")) ?? "";
          },
          { timeout: 15_000 },
        )
        .not.toBe(kind);
    }
    // Wizard done → it unmounts and the tabbed review layout takes over.
    await expect(page.getByTestId("portal-onboarding-wizard")).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(page.getByTestId("portal-nav-profile")).toBeVisible({
      timeout: 15_000,
    });
    // Let trailing soft refreshes settle before editing (nav_ux pattern).
    await page.waitForTimeout(800);
    await page.getByTestId("portal-nav-profile").click();
    const bioInput = page.getByTestId("portal-bio-input");
    await expect(bioInput).toBeVisible({ timeout: 15_000 });
    await bioInput.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(`Rich bio plain ${run} `);
    await page.getByTestId("portal-bio-input-btn-bold").click();
    await page.keyboard.type("boldbio");
    await page.getByTestId("portal-bio-save").click();
    await expect(page.getByTestId("portal-bio-status")).toContainText("Saved", {
      timeout: 10_000,
    });
    // Editor keeps the formatted content after the post-save refresh.
    await expect(bioInput.locator("strong", { hasText: "boldbio" })).toBeVisible();

    // Admin: speaker detail renders the formatted bio via the safe renderer.
    await context.clearCookies();
    await seedSessionCookie(context, baseURL, adminSession);
    await openAdminPage(
      page,
      baseURL,
      event.id,
      `/admin/speakers?participationId=${encodeURIComponent(seeded.participationId)}`,
      "page-speakers",
    );
    const adminBio = page.getByTestId("speakers-detail-bio");
    await expect(adminBio).toBeVisible({ timeout: 15_000 });
    await expect(adminBio).toContainText(`Rich bio plain ${run}`);
    await expect(
      adminBio.locator("strong", { hasText: "boldbio" }),
    ).toBeVisible();
    await expect(adminBio).not.toContainText('"schema"');
  });

  test("@inv:J14 e2e/comms/template-rich rich template body renders in preview; markup-shaped merge value stays text", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const run = `${RUN}-j14`;
    const adminSession = await loginAsAdmin(
      request,
      context,
      baseURL,
      `f2-j14-admin-${run}@example.com`,
    );
    const event = await ensureEvent(
      request,
      adminSession,
      `F2 Comms Event ${run}`,
      `f2-comms-${run}`,
    );
    // Recipient whose NAME is markup-shaped — must stay TEXT in the rendered
    // preview (merge values are escaped before HTML serialization).
    await seedAcceptedSpeaker(
      request,
      adminSession,
      event.id,
      event.slug,
      `f2-j14-speaker-${run}@example.com`,
      `<b>Evil ${run}</b>`,
      `F2 Comms Talk ${run}`,
    );

    await openAdminPage(page, baseURL, event.id, "/admin/comms", "page-comms");
    // Wait for audience (seeded speaker) so Message step is reachable
    await expect(page.getByTestId("comms-summary-count")).toHaveAttribute(
      "data-count",
      /[1-9]/,
      { timeout: 15_000 },
    );
    await page.getByTestId("comms-step-nav-message").click();
    await expect(page.getByTestId("comms-template-editor")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("comms-template-key-input").fill(`f2-rich-${RUN}`);
    await page
      .getByTestId("comms-template-subject-input")
      .fill(`F2 subject ${run}`);
    // Rich body: typed text + bold run + merge token as a plain text node.
    const bodyEditor = page.getByTestId("comms-template-body-input");
    await bodyEditor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Hello {{name}}, this is ");
    await page.getByTestId("comms-template-body-input-btn-bold").click();
    await page.keyboard.type("important");
    await expect(page.getByTestId("comms-merge-fields")).toContainText(
      "{{name}}",
    );
    await page.getByTestId("comms-template-save").click();
    await expect(page.getByTestId("comms-template-status")).toContainText(
      /saved/i,
      { timeout: 10_000 },
    );

    // Preview: rendered rich body (not raw text/pre), merge value escaped.
    await page.getByTestId("comms-step-nav-review").click();
    await page.getByTestId("comms-preview-run").click();
    const results = page.getByTestId("comms-preview-results");
    await expect(results).toBeVisible({ timeout: 15_000 });
    const rendered = page.locator('[data-testid^="comms-preview-rendered-"]');
    await expect(rendered.first()).toBeVisible();
    await expect(
      rendered.first().locator("strong", { hasText: "important" }),
    ).toBeVisible();
    // The markup-shaped recipient name is TEXT: visible literally, and no <b>
    // element exists inside the rendered body.
    await expect(rendered.first()).toContainText(`<b>Evil ${run}</b>`);
    expect(await rendered.first().locator("b").count()).toBe(0);
    // Raw doc JSON never leaks.
    await expect(rendered.first()).not.toContainText('"schema"');
  });
});
