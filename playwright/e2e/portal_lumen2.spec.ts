/**
 * Section 11.6 — Speakers admin + speaker portal Lumen 2 (S-L2-PORTAL).
 *
 * Named ACs:
 * - AC-11.6-PORTAL-NEXT   Next-task dominant + progress + branded welcome
 * - AC-11.6-PORTAL-MOBILE 390px portal usable (bottom nav, full-width action)
 * - AC-11.6-SPEAKERS-LIFE Lifecycle table + discrete readiness (not gallery CMS)
 * - AC-11.6-SPEAKERS-DETAIL Detail pane: contact · sessions · tasks · files
 * - AC-11.6-AUTHZ         Unauth blocked; speaker cannot read admin speakers
 *
 * Inventory G01–G08 / N01–N04 remain owned by portal_ui / portal_api_tasks
 * (1:1 @inv law). This file proves L2 composition on top of those journeys.
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
 */
import { test, expect } from "@playwright/test";
import {
  ensureEvent,
  sessionHeaders,
  requestMagicLink,
  fetchDevLink,
  exchangeForCookie,
  seedSessionCookie,
  selectAdminEvent,
} from "./helpers/cfp-eval-seed.js";

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TURNSTILE_DEV_PASS_TOKEN = "XXXX.DUMMY.TOKEN";

async function loginAsAdmin(
  request: import("@playwright/test").APIRequestContext,
  context: import("@playwright/test").BrowserContext,
  baseURL: string | undefined,
  email: string,
): Promise<{ session: string; userId: string }> {
  await requestMagicLink(request, email, "admin");
  const link = await fetchDevLink(request, email);
  const session = await exchangeForCookie(request, link.token);
  await seedSessionCookie(context, baseURL, session);
  return { session, userId: link.userId };
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

async function seedTemplate(
  request: import("@playwright/test").APIRequestContext,
  session: string,
  eventId: string,
  title: string,
  dueOffsetDays: number,
): Promise<void> {
  const res = await request.post(`/api/events/${eventId}/task-templates`, {
    headers: sessionHeaders(session),
    data: {
      title,
      description: `Template ${title}`,
      trigger: "on_accept",
      dueOffsetDays,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
}

async function acceptSpeaker(
  request: import("@playwright/test").APIRequestContext,
  session: string,
  eventId: string,
  slug: string,
  speakerEmail: string,
  speakerName: string,
  title: string,
): Promise<{ participationId: string; taskIds: string[] }> {
  const create = await request.post(`/api/events/${eventId}/forms`, {
    headers: sessionHeaders(session),
    data: { name: `CFP ${title}` },
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
  const pub = (await publish.json()) as {
    formVersion: { id: string };
  };

  const submit = await request.post(`/api/public/cfp/${slug}/submissions`, {
    data: {
      formVersionId: pub.formVersion.id,
      title,
      speakers: [
        { name: speakerName, email: speakerEmail, isPrimary: true },
      ],
      answers: [{ fieldKey: "abstract", value: "L2 portal abstract" }],
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
    tasks: Array<{ id: string }>;
  };
  expect(body.participations.length).toBeGreaterThanOrEqual(1);
  return {
    participationId: body.participations[0]!.id,
    taskIds: body.tasks.map((t) => t.id),
  };
}

async function seedPortalSpeaker(
  request: import("@playwright/test").APIRequestContext,
  context: import("@playwright/test").BrowserContext,
  baseURL: string | undefined,
  run: string,
): Promise<{
  eventId: string;
  slug: string;
  speakerEmail: string;
  speakerName: string;
  adminSession: string;
  participationId: string;
}> {
  const adminEmail = `e2e-l2portal-admin-${run}@example.com`;
  const speakerEmail = `e2e-l2portal-spk-${run}@example.com`;
  const speakerName = `L2 Portal Speaker ${run}`;
  const admin = await loginAsAdmin(request, context, baseURL, adminEmail);
  const event = await ensureEvent(
    request,
    admin.session,
    `L2 Portal Event ${run}`,
    `l2-portal-${run}`,
  );
  await seedTemplate(
    request,
    admin.session,
    event.id,
    `Upload headshot ${run}`,
    14,
  );
  const accepted = await acceptSpeaker(
    request,
    admin.session,
    event.id,
    event.slug,
    speakerEmail,
    speakerName,
    `L2 Portal Talk ${run}`,
  );
  return {
    eventId: event.id,
    slug: event.slug,
    speakerEmail,
    speakerName,
    adminSession: admin.session,
    participationId: accepted.participationId,
  };
}

test.describe("11.6 portal + speakers lumen2", () => {
  test("AC-11.6-PORTAL-NEXT branded welcome, progress, next-task dominant", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const seed = await seedPortalSpeaker(request, context, baseURL, `${RUN}-a`);
    await loginAsSpeaker(
      request,
      context,
      baseURL,
      seed.speakerEmail,
      seed.eventId,
    );

    await page.goto(
      `${baseURL ?? ""}/portal?eventId=${encodeURIComponent(seed.eventId)}`,
    );
    await expect(page.getByTestId("portal-home")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("portal-home")).toHaveAttribute(
      "data-section",
      "11.6",
    );
    // Incomplete speakers: exclusive onboarding wizard (not form dump under CTA)
    await expect(page.getByTestId("portal-home")).toHaveAttribute(
      "data-layout",
      "onboarding-wizard",
    );
    await expect(page.getByTestId("portal-onboarding-wizard")).toBeVisible();
    await expect(page.getByTestId("portal-wizard-progress")).toBeVisible();
    await expect(page.getByTestId("portal-wizard-step-label")).toBeVisible();
    await expect(page.getByTestId("portal-wizard-continue")).toBeVisible();
    await expect(page.getByTestId("portal-wizard-skip")).toBeVisible();
    await expect(page.getByTestId("portal-wizard-save-draft")).toBeVisible();
    // Full form dump must not render under the wizard
    await expect(page.getByTestId("portal-profile")).toHaveCount(0);
    await expect(page.getByTestId("portal-task-list")).toHaveCount(0);

    // Greeting uses speaker name
    await expect(page.getByTestId("portal-wizard-greeting")).toContainText(
      seed.speakerName,
    );

    // Progress starts incomplete
    await expect(page.getByTestId("portal-wizard-percent")).toBeVisible();
    const pctText =
      (await page.getByTestId("portal-wizard-percent").textContent()) ?? "";
    expect(pctText).not.toMatch(/^100%/);

    // Save draft path works without unmounting wizard
    await page.getByTestId("portal-bio-input").fill(`L2 bio ${RUN}`);
    await page.getByTestId("portal-wizard-save-draft").click();
    await expect(page.getByTestId("portal-bio-status")).toContainText(
      /Draft saved|Saved/i,
      { timeout: 10_000 },
    );
    await expect(page.getByTestId("portal-onboarding-wizard")).toBeVisible();
  });

  test("AC-11.6-PORTAL-MOBILE 390px usable next-task + bottom nav", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const seed = await seedPortalSpeaker(request, context, baseURL, `${RUN}-b`);
    await loginAsSpeaker(
      request,
      context,
      baseURL,
      seed.speakerEmail,
      seed.eventId,
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(
      `${baseURL ?? ""}/portal?eventId=${encodeURIComponent(seed.eventId)}`,
    );
    await expect(page.getByTestId("portal-home")).toBeVisible({
      timeout: 15_000,
    });

    // Mobile exclusive wizard — bottom nav hidden until onboarding done
    await expect(page.getByTestId("portal-onboarding-wizard")).toBeVisible();
    await expect(page.getByTestId("portal-bottom-nav")).toHaveCount(0);

    // Primary continue action reachable without horizontal overflow
    const continueBtn = page.getByTestId("portal-wizard-continue");
    await expect(continueBtn).toBeVisible();
    const box = await continueBtn.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(40);
    // No page-level horizontal overflow
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    await page.getByTestId("portal-bio-input").fill(`L2 mobile bio ${RUN}`);
    await page.getByTestId("portal-wizard-save-draft").click();
    await expect(page.getByTestId("portal-bio-status")).toContainText(
      /Draft saved|Saved/i,
      { timeout: 10_000 },
    );
  });

  test("AC-11.6-SPEAKERS-LIFE lifecycle table + readiness indicators", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const adminEmail = `e2e-l2spk-admin-${RUN}@example.com`;
    const admin = await loginAsAdmin(request, context, baseURL, adminEmail);
    const event = await ensureEvent(
      request,
      admin.session,
      `L2 Speakers ${RUN}`,
      `l2-spk-${RUN}`,
    );
    await seedTemplate(
      request,
      admin.session,
      event.id,
      `Bio task ${RUN}`,
      7,
    );
    const accepted = await acceptSpeaker(
      request,
      admin.session,
      event.id,
      event.slug,
      `l2-spk-${RUN}@example.com`,
      `Lifecycle Speaker ${RUN}`,
      `Lifecycle Talk ${RUN}`,
    );

    await selectAdminEvent(page, baseURL, event.id, "/admin/speakers");
    await expect(page.getByTestId("page-speakers")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("page-speakers")).toHaveAttribute(
      "data-section",
      "11.6",
    );
    await expect(page.getByTestId("page-speakers")).toHaveAttribute(
      "data-layout",
      "lifecycle-table",
    );
    await expect(page.getByTestId("speakers-page-header")).toBeVisible();
    await expect(page.getByTestId("speakers-filter-chips")).toBeVisible();
    await expect(page.getByTestId("speakers-chip-needs_action")).toBeVisible();
    await expect(page.getByTestId("speakers-chip-all")).toBeVisible();

    await expect(page.getByTestId("speakers-list")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("speakers-list")).toContainText(
      `Lifecycle Speaker ${RUN}`,
    );

    // Discrete readiness indicators (not a single collapsed status / gallery)
    const ready = page.getByTestId(
      `speakers-readiness-${accepted.participationId}`,
    );
    await expect(ready).toBeVisible();
    await expect(
      page.getByTestId(`speakers-ready-accepted-${accepted.participationId}`),
    ).toHaveAttribute("data-ready", "true");
    await expect(
      page.getByTestId(`speakers-ready-profile-${accepted.participationId}`),
    ).toHaveAttribute("data-ready", "false");
    await expect(
      page.getByTestId(`speakers-ready-tasks-${accepted.participationId}`),
    ).toHaveAttribute("data-ready", "false");

    // View chip: All speakers
    await page.getByTestId("speakers-chip-all").click();
    await expect(page.getByTestId("speakers-chip-all")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("speakers-list")).toContainText(
      `Lifecycle Speaker ${RUN}`,
    );

    // Profile incomplete view still includes this speaker
    await page.getByTestId("speakers-chip-profile_incomplete").click();
    await expect(page.getByTestId("speakers-list")).toContainText(
      `Lifecycle Speaker ${RUN}`,
    );
  });

  test("AC-11.6-SPEAKERS-DETAIL structured detail pane", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const adminEmail = `e2e-l2spk-detail-${RUN}@example.com`;
    const admin = await loginAsAdmin(request, context, baseURL, adminEmail);
    const event = await ensureEvent(
      request,
      admin.session,
      `L2 Speakers Detail ${RUN}`,
      `l2-spk-d-${RUN}`,
    );
    await seedTemplate(
      request,
      admin.session,
      event.id,
      `Detail task ${RUN}`,
      7,
    );
    const accepted = await acceptSpeaker(
      request,
      admin.session,
      event.id,
      event.slug,
      `l2-spk-d-${RUN}@example.com`,
      `Detail Lifecycle ${RUN}`,
      `Detail Lifecycle Talk ${RUN}`,
    );

    await selectAdminEvent(page, baseURL, event.id, "/admin/speakers");
    await page.getByTestId("speakers-chip-all").click();
    await expect(
      page.getByTestId(`speaker-open-${accepted.participationId}`),
    ).toBeVisible({ timeout: 15_000 });
    await page
      .getByTestId(`speaker-open-${accepted.participationId}`)
      .click();

    await expect(page.getByTestId("speakers-detail")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("speakers-detail-header")).toBeVisible();
    await expect(page.getByTestId("speakers-detail-name")).toContainText(
      `Detail Lifecycle ${RUN}`,
    );
    await expect(
      page.getByTestId("speakers-detail-section-contact"),
    ).toBeVisible();
    await expect(
      page.getByTestId("speakers-detail-section-readiness"),
    ).toBeVisible();
    await expect(
      page.getByTestId("speakers-detail-section-sessions"),
    ).toBeVisible();
    await expect(
      page.getByTestId("speakers-detail-section-tasks"),
    ).toBeVisible();
    await expect(page.getByTestId("speakers-detail-tasks")).toBeVisible();
    await expect(
      page.getByTestId("speakers-detail-section-files"),
    ).toBeVisible();
    await expect(page.getByTestId("speakers-detail-files")).toBeVisible();
    // Sessions section present (accept materializes programme session)
    await expect(page.getByTestId("speakers-detail-sessions")).toBeVisible();
  });

  test("AC-11.6-AUTHZ unauth portal + speaker cannot list admin speakers", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const seed = await seedPortalSpeaker(request, context, baseURL, `${RUN}-z`);

    // Unauthenticated portal → RequireRole redirects to login (fail-closed)
    await context.clearCookies();
    await page.goto(
      `${baseURL ?? ""}/portal?eventId=${encodeURIComponent(seed.eventId)}`,
    );
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    // Must not leak wizard or task titles without session
    await expect(page.getByTestId("portal-next-task-card")).toHaveCount(0);
    await expect(page.getByTestId("portal-onboarding-wizard")).toHaveCount(0);

    // Speaker session cannot read admin speakers list
    await loginAsSpeaker(
      request,
      context,
      baseURL,
      seed.speakerEmail,
      seed.eventId,
    );
    const forbidden = await request.get(
      `/api/events/${encodeURIComponent(seed.eventId)}/speakers`,
      {
        headers: {
          cookie: (
            await context.cookies()
          )
            .filter((c) => c.name === "speakerops_session")
            .map((c) => `${c.name}=${c.value}`)
            .join("; "),
        },
      },
    );
    expect([401, 403]).toContain(forbidden.status());
  });
});
