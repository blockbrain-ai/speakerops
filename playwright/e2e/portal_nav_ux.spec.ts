/**
 * Speaker portal tab navigation UX (portal tab conversion).
 *
 * Home/Profile/Tasks/Sessions are true tab views: `?section=` is the tab
 * state, ONLY the active view renders, header + mobile bottom nav switch
 * tabs without a document reload, browser Back walks tab history, and deep
 * links open the right tab. Profile edit and task completion keep working
 * in the tab model.
 */
import { test, expect, type Page } from "@playwright/test";
import { completeOnboardingViaApi } from "./helpers/portal-onboarding.js";

// Tab conversion is a critical nav surface — never mask flake with retries.
test.describe.configure({ retries: 0 });

const TURNSTILE_DEV_PASS_TOKEN = "XXXX.DUMMY.TOKEN";
const GUIDE_LINK_URL = "https://example.com/speaker-guide";

function attachConsoleGuards(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  return {
    assertClean: () => {
      expect(pageErrors, `pageerror: ${pageErrors.join(" | ")}`).toEqual([]);
      const noise = consoleErrors.filter(
        (t) =>
          !/favicon|React DevTools|Failed to load resource: the server responded with a status of (401|403|404)/i.test(
            t,
          ),
      );
      expect(noise, `console.error: ${noise.join(" | ")}`).toEqual([]);
    },
  };
}

async function requestMagicLink(
  request: import("@playwright/test").APIRequestContext,
  email: string,
  purpose: "admin" | "speaker" = "admin",
  eventId?: string,
) {
  const data: Record<string, string> = { email, purpose };
  if (eventId) data.eventId = eventId;
  const res = await request.post("/api/auth/magic-link", { data });
  expect(res.ok()).toBeTruthy();
}

async function fetchToken(
  request: import("@playwright/test").APIRequestContext,
  email: string,
): Promise<string> {
  const res = await request.get(
    `/api/auth/dev/outbox?email=${encodeURIComponent(email)}`,
  );
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { link: { token: string } | null };
  return body.link!.token;
}

async function exchangeCookie(
  request: import("@playwright/test").APIRequestContext,
  token: string,
): Promise<string> {
  const res = await request.post("/api/auth/exchange", { data: { token } });
  expect(res.status()).toBe(200);
  const setCookie = res.headers()["set-cookie"] ?? "";
  const m = setCookie.match(/speakerops_session=([^;]+)/);
  expect(m).toBeTruthy();
  return m![1]!;
}

/** Set / read the reload marker: survives SPA nav, dies on document reload. */
async function setReloadMarker(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __marker?: number }).__marker = 1;
  });
}

async function readReloadMarker(page: Page): Promise<number | undefined> {
  return page.evaluate(
    () => (window as unknown as { __marker?: number }).__marker,
  );
}

async function seedSpeakerWithContent(
  request: import("@playwright/test").APIRequestContext,
  context: import("@playwright/test").BrowserContext,
  baseURL: string | undefined,
  run: number,
  opts?: { completeTasks?: boolean },
): Promise<{ eventId: string; speakerEmail: string; session: string }> {
  const adminEmail = `e2e-nav-admin-${run}@example.com`;
  const speakerEmail = `e2e-nav-speaker-${run}@example.com`;

  await requestMagicLink(request, adminEmail, "admin");
  const adminTok = await fetchToken(request, adminEmail);
  const adminSession = await exchangeCookie(request, adminTok);

  const ev = await request.post("/api/events", {
    headers: {
      cookie: `speakerops_session=${adminSession}`,
      "content-type": "application/json",
    },
    data: {
      name: `Nav UX Event ${run}`,
      timezone: "UTC",
      startsAt: "2026-10-01T09:00:00.000Z",
      endsAt: "2026-10-02T17:00:00.000Z",
    },
  });
  expect(ev.status()).toBe(201);
  const event = (await ev.json()) as { event: { id: string; slug: string } };
  const eventId = event.event.id;

  await request.post(`/api/events/${eventId}/task-templates`, {
    headers: {
      cookie: `speakerops_session=${adminSession}`,
      "content-type": "application/json",
    },
    data: {
      title: "Upload headshot",
      description: "Portrait",
      trigger: "on_accept",
      dueOffsetDays: 7,
    },
  });
  // Second organiser task with a resource link — proves link_url buttons
  // render inside the Tasks tab after the conversion.
  await request.post(`/api/events/${eventId}/task-templates`, {
    headers: {
      cookie: `speakerops_session=${adminSession}`,
      "content-type": "application/json",
    },
    data: {
      title: "Review the speaker guide",
      description: "Read the guide before the event",
      trigger: "on_accept",
      dueOffsetDays: 7,
      linkUrl: GUIDE_LINK_URL,
    },
  });

  const form = await request.post(`/api/events/${eventId}/forms`, {
    headers: {
      cookie: `speakerops_session=${adminSession}`,
      "content-type": "application/json",
    },
    data: { name: `CFP nav ${run}` },
  });
  const formBody = (await form.json()) as { form: { id: string } };
  await request.put(`/api/forms/${formBody.form.id}/draft`, {
    headers: {
      cookie: `speakerops_session=${adminSession}`,
      "content-type": "application/json",
    },
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
  const pub = await request.post(`/api/forms/${formBody.form.id}/publish`, {
    headers: {
      cookie: `speakerops_session=${adminSession}`,
      "content-type": "application/json",
    },
    data: {},
  });
  const pubBody = (await pub.json()) as { formVersion: { id: string } };

  const sub = await request.post(
    `/api/public/cfp/${event.event.slug}/submissions`,
    {
      data: {
        formVersionId: pubBody.formVersion.id,
        title: `Nav Talk ${run}`,
        answers: [{ fieldKey: "abstract", value: "Abstract for nav UX" }],
        speakers: [{ name: "Nav Speaker", email: speakerEmail }],
        turnstileToken: TURNSTILE_DEV_PASS_TOKEN,
      },
    },
  );
  expect(sub.status()).toBe(201);
  const subBody = (await sub.json()) as { submission: { id: string } };

  const dec = await request.post(
    `/api/submissions/${subBody.submission.id}/decision`,
    {
      headers: {
        cookie: `speakerops_session=${adminSession}`,
        "content-type": "application/json",
      },
      data: { decision: "accept" },
    },
  );
  expect(dec.status()).toBe(200);

  await requestMagicLink(request, speakerEmail, "speaker", eventId);
  const tok = await fetchToken(request, speakerEmail);
  const session = await exchangeCookie(request, tok);
  await context.addCookies([
    {
      name: "speakerops_session",
      value: session,
      url: baseURL ?? "http://127.0.0.1:5173",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);

  // Complete profile (+ tasks unless told otherwise) so the exclusive
  // wizard exits and the full tab nav renders.
  await completeOnboardingViaApi(request, session, eventId, {
    bio: `Nav bio ${run}`,
    company: "Nav Co",
    title: "Speaker",
    completeTasks: opts?.completeTasks,
  });

  return { eventId, speakerEmail, session };
}

test("@inv:G11 e2e/portal/section-nav speaker tabs switch views in place — no reload, back returns", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const guards = attachConsoleGuards(page);
  const run = Date.now();
  const { eventId } = await seedSpeakerWithContent(
    request,
    context,
    baseURL,
    run,
  );

  await page.goto(
    `${baseURL ?? ""}/portal?eventId=${encodeURIComponent(eventId)}`,
  );
  await expect(page.getByTestId("portal-home")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("role-shell-speaker")).toBeVisible();
  await expect(page.getByTestId("role-shell-product")).toContainText(
    "SpeakerOps",
  );
  await expect(page.getByTestId("role-shell-nav")).toBeVisible();

  // Default tab is Home — only the Home view is in the DOM.
  await expect(page.getByTestId("portal-section-home")).toBeVisible();
  await expect(page.getByTestId("portal-nav-home")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByTestId("portal-profile")).toHaveCount(0);
  await expect(page.getByTestId("portal-tasks")).toHaveCount(0);
  await expect(page.getByTestId("portal-sessions")).toHaveCount(0);
  // Home overview: summary cards for the other tabs.
  await expect(page.getByTestId("portal-summary-cards")).toBeVisible();
  await expect(page.getByTestId("portal-summary-tasks")).toContainText(
    /tasks done|No tasks yet|All tasks done/,
  );

  // Marker survives SPA tab switches; a document reload would erase it.
  await setReloadMarker(page);

  // Tasks tab: shows Tasks content, hides Home content, updates URL.
  await page.getByTestId("portal-nav-tasks").click();
  await expect(page.getByTestId("portal-tasks")).toBeVisible();
  await expect(page.getByTestId("portal-section-home")).toHaveCount(0);
  await expect(page).toHaveURL(/[?&]section=tasks/);
  await expect(page.getByTestId("portal-nav-tasks")).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(
    await page.getByTestId("portal-nav-home").getAttribute("aria-current"),
  ).toBeNull();
  expect(await readReloadMarker(page)).toBe(1);
  // Real task rows render inside the tab (statuses + resource link intact).
  await expect(page.getByTestId("portal-task-list")).toBeVisible();
  await expect(
    page.locator("li.portal-task[data-task-status='completed']").first(),
  ).toBeVisible();
  await expect(
    page.locator("[data-testid^='portal-task-link-']").first(),
  ).toHaveAttribute("href", GUIDE_LINK_URL);

  // Profile tab (plain switch): focus lands on the VIEW HEADING, never the
  // bio textarea — focusing an editable field on a plain tab switch pops
  // the mobile keyboard uninvited (B2). The explicit "Update profile" CTA
  // path (asserted below) is the only route into the bio field.
  await page.getByTestId("portal-nav-profile").click();
  await expect(page.getByTestId("portal-profile")).toBeVisible();
  await expect(page.getByTestId("portal-tasks")).toHaveCount(0);
  await expect(page).toHaveURL(/[?&]section=profile/);
  await expect(page.getByTestId("portal-nav-profile")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.locator("#portal-profile h2").first()).toBeFocused();
  await expect(page.getByTestId("portal-bio-input")).not.toBeFocused();

  // Sessions tab: focus moves to the view heading.
  await page.getByTestId("portal-nav-sessions").click();
  await expect(page.getByTestId("portal-sessions")).toBeVisible();
  await expect(page.getByTestId("portal-profile")).toHaveCount(0);
  await expect(page).toHaveURL(/[?&]section=sessions/);
  await expect(page.getByTestId("portal-nav-sessions")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.locator("#portal-sessions h2").first()).toBeFocused();
  await expect(page.getByTestId("portal-session-list")).toContainText(
    `Nav Talk ${run}`,
  );

  // Home tab again. Canonical home URL carries NO section param (B4) —
  // desktop Home link and mobile Home button must agree.
  await page.getByTestId("portal-nav-home").click();
  await expect(page.getByTestId("portal-section-home")).toBeVisible();
  await expect(page.getByTestId("portal-sessions")).toHaveCount(0);
  await expect(page.getByTestId("portal-nav-home")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page).not.toHaveURL(/[?&]section=/);
  await expect(page.getByTestId("portal-welcome-name")).toBeFocused();

  // Summary cards are real navigation too.
  await page.getByTestId("portal-summary-tasks").click();
  await expect(page.getByTestId("portal-tasks")).toBeVisible();
  await expect(page).toHaveURL(/[?&]section=tasks/);

  // Browser Back walks tab history (tabs are navigation, not replace).
  await page.goBack();
  await expect(page.getByTestId("portal-section-home")).toBeVisible();
  await expect(page.getByTestId("portal-nav-home")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.goBack();
  await expect(page.getByTestId("portal-sessions")).toBeVisible();
  await expect(page.getByTestId("portal-nav-sessions")).toHaveAttribute(
    "aria-current",
    "page",
  );
  // Still no document reload across the whole journey.
  expect(await readReloadMarker(page)).toBe(1);

  // Explicit "Update profile" CTA path (B2): the Home profile summary card
  // is an edit intent, so focus DOES land in the editable bio field.
  await page.getByTestId("portal-nav-home").click();
  await expect(page.getByTestId("portal-section-home")).toBeVisible();
  await page.getByTestId("portal-summary-profile").click();
  await expect(page.getByTestId("portal-profile")).toBeVisible();
  await expect(page).toHaveURL(/[?&]section=profile/);
  await expect(page.getByTestId("portal-bio-input")).toBeFocused();
  expect(await readReloadMarker(page)).toBe(1);

  guards.assertClean();
});

test("speaker deep link ?section=sessions opens the Sessions tab; eventId survives switches", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const guards = attachConsoleGuards(page);
  const run = Date.now() + 1;
  const { eventId } = await seedSpeakerWithContent(
    request,
    context,
    baseURL,
    run,
  );

  await page.goto(
    `${baseURL ?? ""}/portal?eventId=${encodeURIComponent(eventId)}&section=sessions`,
  );
  await expect(page.getByTestId("portal-sessions")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("portal-section-home")).toHaveCount(0);
  await expect(page.getByTestId("portal-nav-sessions")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByTestId("portal-session-list")).toContainText(
    `Nav Talk ${run}`,
  );

  // Switching tabs keeps the event context in the URL.
  await page.getByTestId("portal-nav-profile").click();
  await expect(page.getByTestId("portal-profile")).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(`eventId=${encodeURIComponent(eventId)}`),
  );
  await expect(page).toHaveURL(/[?&]section=profile/);

  guards.assertClean();
});

test("speaker mobile bottom nav switches tabs", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const guards = attachConsoleGuards(page);
  const run = Date.now() + 2;
  const { eventId } = await seedSpeakerWithContent(
    request,
    context,
    baseURL,
    run,
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    `${baseURL ?? ""}/portal?eventId=${encodeURIComponent(eventId)}`,
  );
  await expect(page.getByTestId("portal-home")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("portal-bottom-nav")).toBeVisible();
  await expect(page.getByTestId("role-shell-nav")).toBeHidden();

  await setReloadMarker(page);

  await page.getByTestId("portal-bottom-tasks").click();
  await expect(page.getByTestId("portal-tasks")).toBeVisible();
  await expect(page.getByTestId("portal-section-home")).toHaveCount(0);
  await expect(page.getByTestId("portal-bottom-tasks")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page).toHaveURL(/[?&]section=tasks/);

  await page.getByTestId("portal-bottom-profile").click();
  await expect(page.getByTestId("portal-profile")).toBeVisible();
  await expect(page.getByTestId("portal-tasks")).toHaveCount(0);
  await expect(page.getByTestId("portal-bottom-profile")).toHaveAttribute(
    "aria-current",
    "page",
  );
  // Plain mobile tab switch also lands on the heading, not the bio field
  // (B2 — the mobile keyboard must never pop uninvited).
  await expect(page.locator("#portal-profile h2").first()).toBeFocused();
  await expect(page.getByTestId("portal-bio-input")).not.toBeFocused();

  // Mobile Home button produces the canonical URL — NO section param (B4),
  // agreeing with the desktop Home link.
  await page.getByTestId("portal-bottom-home").click();
  await expect(page.getByTestId("portal-section-home")).toBeVisible();
  await expect(page.getByTestId("portal-bottom-home")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page).not.toHaveURL(/[?&]section=/);

  // No document reload across mobile tab switches.
  expect(await readReloadMarker(page)).toBe(1);

  guards.assertClean();
});

test("speaker profile edit and task completion still work in the tab model", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const guards = attachConsoleGuards(page);
  const run = Date.now() + 3;
  // Leave organiser tasks pending: product law keeps incomplete speakers in
  // the exclusive wizard (the ONLY surface where pending tasks are shown),
  // so task completion is exercised there, then verified in the Tasks tab.
  const { eventId } = await seedSpeakerWithContent(request, context, baseURL, run, {
    completeTasks: false,
  });

  await page.goto(
    `${baseURL ?? ""}/portal?eventId=${encodeURIComponent(eventId)}`,
  );
  await expect(page.getByTestId("portal-home")).toBeVisible({ timeout: 15_000 });
  // Wizard exclusivity preserved: tab nav suppressed while tasks pending.
  await expect(page.getByTestId("portal-onboarding-wizard")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("role-shell-nav")).toHaveCount(0);

  // Complete both pending organiser tasks through the real wizard UI.
  for (let i = 0; i < 8; i++) {
    const wizard = page.getByTestId("portal-onboarding-wizard");
    if (!(await wizard.isVisible().catch(() => false))) break;
    const kind =
      (await wizard.getAttribute("data-step-kind"))?.toLowerCase() ?? "";
    if (kind === "task_text") {
      await page
        .getByTestId("portal-wizard-freeform")
        .fill(`Guide read ${run}`);
    }
    await expect(page.getByTestId("portal-wizard-continue")).toBeEnabled();
    await page.getByTestId("portal-wizard-continue").click();
    await page.waitForTimeout(250);
  }

  // Wizard exits → tab nav appears; Tasks tab shows both tasks completed.
  await expect(page.getByTestId("role-shell-nav")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByTestId("portal-nav-tasks").click();
  await expect(page.getByTestId("portal-tasks")).toBeVisible();
  await expect(
    page.locator("li.portal-task[data-task-status='completed']"),
  ).toHaveCount(2, { timeout: 10_000 });

  // Let the wizard's trailing soft refreshes settle before editing the bio —
  // an in-flight /api/portal/home response re-syncs form state on arrival.
  // (Bounded settle: all refreshes fire within ~300ms of the last Continue.)
  await page.waitForTimeout(800);

  // Profile edit + save inside the Profile tab.
  await page.getByTestId("portal-nav-profile").click();
  await expect(page.getByTestId("portal-bio-input")).toBeVisible();
  await page.getByTestId("portal-bio-input").fill(`Tab bio edited ${run}`);
  await page.getByTestId("portal-bio-save").click();
  await expect(page.getByTestId("portal-bio-status")).toContainText("Saved", {
    timeout: 10_000,
  });
  // Saved value survives the post-save refresh (server echoed the new bio).
  await expect(page.getByTestId("portal-bio-input")).toHaveValue(
    `Tab bio edited ${run}`,
  );

  // Form state survives switching away and back (views swap, page persists).
  await page.getByTestId("portal-nav-tasks").click();
  await expect(page.getByTestId("portal-tasks")).toBeVisible();
  await page.getByTestId("portal-nav-profile").click();
  await expect(page.getByTestId("portal-bio-input")).toHaveValue(
    `Tab bio edited ${run}`,
  );

  // Durable: deep-linked reload of the Profile tab shows the saved bio.
  await page.goto(
    `${baseURL ?? ""}/portal?eventId=${encodeURIComponent(eventId)}&section=profile`,
  );
  await expect(page.getByTestId("portal-bio-input")).toHaveValue(
    `Tab bio edited ${run}`,
    { timeout: 15_000 },
  );

  guards.assertClean();
});
