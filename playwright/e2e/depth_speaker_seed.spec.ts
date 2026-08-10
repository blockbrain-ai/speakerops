/**
 * Post-11.9 depth Wave 2 — speaker-info seeding (public CFP → portal profile).
 *
 * A20: the public CFP speaker block gains a collapsible "About this speaker"
 * region (job title / company / short bio). Submitting seeds the accepted
 * speaker's event_participation profile — only where the profile field is
 * still empty. The proof walks the whole loop in a real browser:
 *   public CFP expand + fill → submit → API accept → speaker portal shows the
 *   prefilled profile (DTO + DOM) → admin speakers detail shows the same →
 *   a hand-edited bio survives an idempotent accept replay (never-overwrite).
 *
 * Inventory: @inv:A20 (one test).
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e). New critical spec → retries 0.
 */
import { test, expect } from "@playwright/test";
import {
  loginAs,
  requestMagicLink,
  fetchDevLink,
  exchangeForCookie,
  seedSessionCookie,
  sessionHeaders,
  ensureEvent,
} from "./helpers/cfp-eval-seed";

test.describe.configure({ retries: 0 });

test.describe("Wave 2 — speaker-info seeding", () => {
  test("@inv:A20 e2e/public-cfp/speaker-about seeded profile from CFP about fields; accept fills only empty profile fields", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const stamp = Date.now();
    const BIO_TOKEN = `Beacon-keeper bio ${stamp} — ships resilient queues.`;
    const COMPANY_TOKEN = `SeedWorks-${stamp}`;
    const TITLE_TOKEN = `Chief Reliability Officer ${stamp}`;
    const SPEAKER_NAME = "Seeded Speaker";
    const SPEAKER_EMAIL = `seeded-speaker-${stamp}@example.com`;

    const admin = await loginAs(
      request,
      context,
      baseURL,
      `e2e-a20-admin-${stamp}@example.com`,
      "admin",
    );
    const event = await ensureEvent(
      request,
      admin.session,
      `Depth Speaker Seed ${stamp}`,
    );

    // Seed a published CFP via API (prerequisite only).
    const formRes = await request.post(`/api/events/${event.id}/forms`, {
      headers: sessionHeaders(admin.session),
      data: { name: "Speaker seed CFP" },
    });
    expect(formRes.status()).toBe(201);
    const formId = ((await formRes.json()) as { form: { id: string } }).form.id;
    const draftRes = await request.put(`/api/forms/${formId}/draft`, {
      headers: sessionHeaders(admin.session),
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
      },
    });
    expect(draftRes.status()).toBe(200);
    const pubRes = await request.post(`/api/forms/${formId}/publish`, {
      headers: sessionHeaders(admin.session),
      data: {},
    });
    expect(pubRes.status()).toBe(200);

    // --- Real browser: public CFP with the collapsible about region ---
    await page.goto(`${baseURL ?? ""}/cfp/${event.slug}`);
    await expect(page.getByTestId("public-cfp-form")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("cfp-title").fill(`Seeded talk ${stamp}`);
    await page
      .getByTestId("cfp-field-abstract")
      .fill("How seeded profiles save accepted speakers a form.");
    await page.getByTestId("cfp-speaker-name-0").fill(SPEAKER_NAME);
    await page.getByTestId("cfp-speaker-email-0").fill(SPEAKER_EMAIL);

    // Collapsed by default — the about fields are not in the DOM yet.
    const aboutToggle = page.getByTestId("cfp-speaker-about-toggle-0");
    await expect(aboutToggle).toBeVisible();
    await expect(aboutToggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("cfp-speaker-bio-0")).toHaveCount(0);
    await expect(page.getByTestId("cfp-speaker-company-0")).toHaveCount(0);

    // Real click expands the styled region; fill the seed fields.
    await aboutToggle.click();
    await expect(aboutToggle).toHaveAttribute("aria-expanded", "true");
    await page.getByTestId("cfp-speaker-title-0").fill(TITLE_TOKEN);
    await page.getByTestId("cfp-speaker-company-0").fill(COMPANY_TOKEN);
    await page.getByTestId("cfp-speaker-bio-0").fill(BIO_TOKEN);

    // Collapse again — values survive and the summary reports them.
    await aboutToggle.click();
    await expect(aboutToggle).toHaveAttribute("aria-expanded", "false");
    await expect(
      page.getByTestId("cfp-speaker-about-summary-0"),
    ).toContainText(/job title, company, bio added/i);

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
      speakers: Array<{ bio: string | null; company: string | null }>;
    };
    const submissionId = submitBody.submission.id;
    expect(submitBody.speakers[0]!.bio).toBe(BIO_TOKEN);
    expect(submitBody.speakers[0]!.company).toBe(COMPANY_TOKEN);
    await expect(page.getByTestId("public-cfp-confirmation")).toBeVisible({
      timeout: 15_000,
    });

    // --- Accept via API (prerequisite) → participation seeded ---
    const decisionRes = await request.post(
      `/api/submissions/${submissionId}/decision`,
      {
        headers: sessionHeaders(admin.session),
        data: { decision: "accept" },
      },
    );
    expect(decisionRes.status(), await decisionRes.text()).toBe(200);
    const decisionBody = (await decisionRes.json()) as {
      participations: Array<{ id: string }>;
    };
    const participationId = decisionBody.participations[0]!.id;

    // --- Speaker portal: DTO carries the seeded profile ---
    await requestMagicLink(request, SPEAKER_EMAIL, "speaker", event.id);
    const speakerLink = await fetchDevLink(request, SPEAKER_EMAIL);
    const speakerSession = await exchangeForCookie(request, speakerLink.token);
    const homeRes = await request.get(
      `/api/portal/home?eventId=${encodeURIComponent(event.id)}`,
      { headers: sessionHeaders(speakerSession) },
    );
    expect(homeRes.status()).toBe(200);
    const home = (await homeRes.json()) as {
      participations: Array<{
        id: string;
        bio: string | null;
        company: string | null;
        title: string | null;
        version: number;
      }>;
    };
    const participation = home.participations.find(
      (p) => p.id === participationId,
    )!;
    expect(participation.bio).toBe(BIO_TOKEN);
    expect(participation.company).toBe(COMPANY_TOKEN);
    expect(participation.title).toBe(TITLE_TOKEN);

    // --- Speaker portal DOM: bio + company inputs come prefilled ---
    await context.clearCookies();
    await seedSessionCookie(context, baseURL, speakerSession);
    await page.goto(
      `${baseURL ?? ""}/portal?eventId=${encodeURIComponent(event.id)}`,
    );
    await expect(page.getByTestId("portal-home")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("portal-onboarding-wizard")).toBeVisible({
      timeout: 15_000,
    });
    // Step dots follow profile order: 0 = bio, 1 = company.
    await page.getByTestId("portal-wizard-dot-0").click();
    await expect(page.getByTestId("portal-bio-input")).toHaveValue(BIO_TOKEN);
    await page.getByTestId("portal-wizard-dot-1").click();
    await expect(page.getByTestId("portal-company-input")).toHaveValue(
      COMPANY_TOKEN,
    );

    // --- Admin speakers detail shows the seeded contact card ---
    await context.clearCookies();
    await seedSessionCookie(context, baseURL, admin.session);
    await page.addInitScript((id) => {
      localStorage.setItem("speakerops.activeEventId", id);
    }, event.id);
    await page.goto(
      `${baseURL ?? ""}/admin/speakers?participationId=${encodeURIComponent(participationId)}`,
    );
    await expect(page.getByTestId("page-speakers")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("speakers-detail")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("speakers-detail-title")).toContainText(
      TITLE_TOKEN,
    );
    await expect(page.getByTestId("speakers-detail-company")).toContainText(
      COMPANY_TOKEN,
    );
    await expect(page.getByTestId("speakers-detail-bio")).toContainText(
      BIO_TOKEN,
    );

    // --- Never-overwrite: hand-edited bio survives an accept replay ---
    const CUSTOM_BIO = `My own words ${stamp} — hands off, seeder.`;
    const patchRes = await request.patch(
      `/api/portal/participations/${participationId}`,
      {
        headers: sessionHeaders(speakerSession),
        data: { bio: CUSTOM_BIO, expectedVersion: participation.version },
      },
    );
    expect(patchRes.status(), await patchRes.text()).toBe(200);

    // Accept replay is idempotent — must not re-seed over the custom bio.
    const replayRes = await request.post(
      `/api/submissions/${submissionId}/decision`,
      {
        headers: sessionHeaders(admin.session),
        data: { decision: "accept" },
      },
    );
    expect(replayRes.status()).toBe(200);

    const afterRes = await request.get(
      `/api/portal/home?eventId=${encodeURIComponent(event.id)}`,
      { headers: sessionHeaders(speakerSession) },
    );
    expect(afterRes.status()).toBe(200);
    const after = (await afterRes.json()) as {
      participations: Array<{
        id: string;
        bio: string | null;
        company: string | null;
      }>;
    };
    const afterPart = after.participations.find(
      (p) => p.id === participationId,
    )!;
    expect(afterPart.bio).toBe(CUSTOM_BIO);
    expect(afterPart.bio).not.toBe(BIO_TOKEN);
    // Untouched fields keep their seeded values.
    expect(afterPart.company).toBe(COMPANY_TOKEN);
  });
});
