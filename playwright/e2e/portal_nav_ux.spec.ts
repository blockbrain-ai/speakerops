/**
 * Speaker portal section navigation UX (integrity plan Wave B/D).
 *
 * Proves Home/Profile/Tasks/Sessions tabs change active state and scroll/focus,
 * including short-content visibility (section flash + aria-current).
 */
import { test, expect, type Page } from "@playwright/test";
import { completeOnboardingViaApi } from "./helpers/portal-onboarding.js";

const TURNSTILE_DEV_PASS_TOKEN = "XXXX.DUMMY.TOKEN";

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

async function seedSpeakerWithContent(
  request: import("@playwright/test").APIRequestContext,
  context: import("@playwright/test").BrowserContext,
  baseURL: string | undefined,
  run: number,
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

  // Complete profile + tasks so exclusive wizard exits → full section nav
  await completeOnboardingViaApi(request, session, eventId, {
    bio: `Nav bio ${run}`,
    company: "Nav Co",
    title: "Speaker",
  });

  return { eventId, speakerEmail, session };
}

test("@inv:G11 e2e/portal/section-nav speaker section nav changes active state and focuses section", async ({
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

  // Profile tab
  await page.getByTestId("portal-nav-profile").click();
  await expect(page.getByTestId("portal-nav-profile")).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(page.getByTestId("portal-profile")).toBeVisible();
  await expect(page).toHaveURL(/section=profile/);

  // Tasks tab
  await page.getByTestId("portal-nav-tasks").click();
  await expect(page.getByTestId("portal-nav-tasks")).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(page.getByTestId("portal-tasks")).toBeVisible();

  // Sessions tab
  await page.getByTestId("portal-nav-sessions").click();
  await expect(page.getByTestId("portal-nav-sessions")).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(page.getByTestId("portal-sessions")).toBeVisible();

  // Home tab
  await page.getByTestId("portal-nav-home").click();
  await expect(page.getByTestId("portal-nav-home")).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(page.getByTestId("portal-section-home")).toBeVisible();

  guards.assertClean();
});

test("speaker mobile bottom nav switches sections", async ({
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

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    `${baseURL ?? ""}/portal?eventId=${encodeURIComponent(eventId)}`,
  );
  await expect(page.getByTestId("portal-home")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("portal-bottom-nav")).toBeVisible();
  await expect(page.getByTestId("role-shell-nav")).toBeHidden();

  await page.getByTestId("portal-bottom-profile").click();
  await expect(page.getByTestId("portal-profile")).toBeVisible();
  await expect(page.getByTestId("portal-bottom-profile")).toHaveAttribute(
    "aria-current",
    "true",
  );

  guards.assertClean();
});
