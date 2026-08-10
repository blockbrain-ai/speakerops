/**
 * Section 4.3 — Speaker portal UI inventory journeys G01–G08.
 *
 * - @inv:G01 e2e/portal/home
 * - @inv:G02 e2e/portal/bio
 * - @inv:G03 e2e/portal/headshot
 * - @inv:G04 e2e/portal/slides
 * - @inv:G05 e2e/portal/task-complete
 * - @inv:G06 e2e/portal/task-overdue
 * - @inv:G07 e2e/portal/session
 * - @inv:G08 e2e/portal/mobile
 * - @inv:G09 e2e/portal/session-ics
 *
 * Named assertions:
 * - assert bio XSS text content not script
 * - assert mobile viewport task complete
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
 */
import { test, expect } from "@playwright/test";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  completeProfileViaWizard,
  completeOnboardingViaApi,
  saveBioOnPortal,
} from "./helpers/portal-onboarding.js";

const TURNSTILE_DEV_PASS_TOKEN = "XXXX.DUMMY.TOKEN";

/** Minimal valid JPEG (1×1). */
const MINI_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//Z",
  "base64",
);

/** Minimal PDF bytes. */
const MINI_PDF = Buffer.from(
  "%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
  "utf8",
);

async function requestMagicLink(
  request: import("@playwright/test").APIRequestContext,
  email: string,
  purpose: "admin" | "speaker" | "evaluator" = "admin",
  eventId?: string,
) {
  const data: Record<string, string> = { email, purpose };
  if (eventId) data.eventId = eventId;
  const res = await request.post("/api/auth/magic-link", { data });
  expect(res.ok(), `magic-link status ${res.status()}`).toBeTruthy();
}

async function fetchDevLink(
  request: import("@playwright/test").APIRequestContext,
  email: string,
): Promise<{ token: string; userId: string }> {
  const res = await request.get(
    `/api/auth/dev/outbox?email=${encodeURIComponent(email)}`,
  );
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as {
    link: { token: string; userId?: string } | null;
  };
  expect(body.link?.token).toBeTruthy();
  return { token: body.link!.token, userId: body.link!.userId ?? "" };
}

async function exchangeForCookie(
  request: import("@playwright/test").APIRequestContext,
  token: string,
): Promise<string> {
  const exchange = await request.post("/api/auth/exchange", {
    data: { token },
  });
  expect(exchange.status()).toBe(200);
  const setCookie = exchange.headers()["set-cookie"] ?? "";
  const match = setCookie.match(/speakerops_session=([^;]+)/);
  expect(match).toBeTruthy();
  return match![1]!;
}

function sessionHeaders(session: string): Record<string, string> {
  return {
    cookie: `speakerops_session=${session}`,
    "content-type": "application/json",
  };
}

async function loginAsAdmin(
  request: import("@playwright/test").APIRequestContext,
  context: import("@playwright/test").BrowserContext,
  baseURL: string | undefined,
  email: string,
): Promise<string> {
  await requestMagicLink(request, email, "admin");
  const link = await fetchDevLink(request, email);
  const sessionValue = await exchangeForCookie(request, link.token);
  await context.addCookies([
    {
      name: "speakerops_session",
      value: sessionValue,
      url: baseURL ?? "http://127.0.0.1:5173",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
  return sessionValue;
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
  const sessionValue = await exchangeForCookie(request, link.token);
  await context.clearCookies();
  await context.addCookies([
    {
      name: "speakerops_session",
      value: sessionValue,
      url: baseURL ?? "http://127.0.0.1:5173",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
  return sessionValue;
}

async function ensureEvent(
  request: import("@playwright/test").APIRequestContext,
  session: string,
  name: string,
): Promise<{ id: string; slug: string }> {
  const res = await request.post("/api/events", {
    headers: sessionHeaders(session),
    data: {
      name,
      timezone: "UTC",
      startsAt: "2026-09-01T09:00:00.000Z",
      endsAt: "2026-09-02T17:00:00.000Z",
    },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as {
    event: { id: string; slug: string };
  };
  return { id: body.event.id, slug: body.event.slug };
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
  expect(res.status()).toBe(201);
}

async function acceptSpeaker(
  request: import("@playwright/test").APIRequestContext,
  session: string,
  eventId: string,
  slug: string,
  speakerEmail: string,
  speakerName: string,
  title: string,
): Promise<{ participationId: string; taskIds: string[]; sessionId: string }> {
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
      answers: [{ fieldKey: "abstract", value: "E2E portal abstract" }],
      turnstileToken: TURNSTILE_DEV_PASS_TOKEN,
    },
  });
  expect(submit.status()).toBe(201);
  const sub = (await submit.json()) as { submission: { id: string } };

  const decision = await request.post(
    `/api/submissions/${sub.submission.id}/decision`,
    {
      headers: sessionHeaders(session),
      data: { decision: "accept" },
    },
  );
  expect(decision.status()).toBe(200);
  const body = (await decision.json()) as {
    session: { id: string };
    participations: Array<{ id: string }>;
    tasks: Array<{ id: string }>;
  };
  expect(body.participations.length).toBeGreaterThanOrEqual(1);
  return {
    participationId: body.participations[0]!.id,
    taskIds: body.tasks.map((t) => t.id),
    sessionId: body.session.id,
  };
}

/** Seed event + accepted speaker with at least one task. */
async function seedPortalSpeaker(
  request: import("@playwright/test").APIRequestContext,
  context: import("@playwright/test").BrowserContext,
  baseURL: string | undefined,
  run: number,
  opts?: { dueOffsetDays?: number; talkTitle?: string },
): Promise<{
  eventId: string;
  slug: string;
  speakerEmail: string;
  speakerName: string;
  adminSession: string;
  taskIds: string[];
  sessionId: string;
}> {
  const adminEmail = `e2e-portal-admin-${run}@example.com`;
  const speakerEmail = `e2e-portal-spk-${run}@example.com`;
  const speakerName = `Portal Speaker ${run}`;
  const adminSession = await loginAsAdmin(
    request,
    context,
    baseURL,
    adminEmail,
  );
  const event = await ensureEvent(
    request,
    adminSession,
    `Portal UI Event ${run}`,
  );
  // Ensure deterministic templates (avoid multi-seed noise from ensureOnAccept)
  await seedTemplate(
    request,
    adminSession,
    event.id,
    opts?.talkTitle ? `Task for ${opts.talkTitle}` : `Upload headshot ${run}`,
    opts?.dueOffsetDays ?? 14,
  );
  const accepted = await acceptSpeaker(
    request,
    adminSession,
    event.id,
    event.slug,
    speakerEmail,
    speakerName,
    opts?.talkTitle ?? `Portal Talk ${run}`,
  );
  return {
    eventId: event.id,
    slug: event.slug,
    speakerEmail,
    speakerName,
    adminSession,
    taskIds: accepted.taskIds,
    sessionId: accepted.sessionId,
  };
}

test("@inv:G01 e2e/portal/home Land on next incomplete task", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now();
  const seed = await seedPortalSpeaker(request, context, baseURL, run);
  await loginAsSpeaker(
    request,
    context,
    baseURL,
    seed.speakerEmail,
    seed.eventId,
  );

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto(
    `${baseURL ?? ""}/portal?eventId=${encodeURIComponent(seed.eventId)}`,
  );
  await expect(page.getByTestId("portal-home")).toBeVisible({ timeout: 15_000 });

  // Incomplete speakers get exclusive onboarding wizard (not full form dump)
  await expect(page.getByTestId("portal-onboarding-wizard")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("portal-home")).toHaveAttribute(
    "data-layout",
    "onboarding-wizard",
  );
  await expect(page.getByTestId("portal-profile")).toHaveCount(0);
  await expect(page.getByTestId("portal-task-list")).toHaveCount(0);

  // Walk profile steps so readiness can progress
  await completeProfileViaWizard(page, {
    bio: `G01 bio ${run}`,
    company: "G01 Co",
    title: "Speaker",
    uploadHeadshot: true,
  });

  // After wizard, either more task steps or review with next-task card
  if (await page.getByTestId("portal-next-task-card").isVisible().catch(() => false)) {
    await expect(page.getByTestId("portal-next-task-title")).not.toBeEmpty();
    const status = page.getByTestId("portal-next-task-status");
    await expect(status).toBeVisible();
    const statusText = (await status.textContent())?.trim() ?? "";
    expect(["pending", "overdue"]).toContain(statusText);
  } else if (
    await page.getByTestId("portal-onboarding-wizard").isVisible().catch(() => false)
  ) {
    // Still in wizard on a task step — one field at a time is the product
    await expect(page.getByTestId("portal-wizard-step")).toBeVisible();
  } else {
    await expect(page.getByTestId("portal-next-task")).toBeVisible();
  }
  expect(pageErrors).toEqual([]);
});

test("@inv:G02 e2e/portal/bio Edit bio; save — XSS text-only", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now() + 1;
  const seed = await seedPortalSpeaker(request, context, baseURL, run);
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
  await expect(page.getByTestId("portal-onboarding-wizard")).toBeVisible({
    timeout: 15_000,
  });

  const xssBio = `<script>alert("xss")</script>Speaker bio G02`;
  await saveBioOnPortal(page, xssBio);

  // assert bio XSS text content not script — preview is text nodes only
  const preview = page.getByTestId("portal-bio-preview");
  await expect(preview).toBeVisible();
  const previewText = (await preview.textContent()) ?? "";
  expect(previewText).not.toMatch(/<script/i);
  expect(previewText).toContain("Speaker bio G02");

  // No executable script elements under wizard surface
  const scriptCount = await page
    .getByTestId("portal-onboarding-wizard")
    .locator("script")
    .count();
  expect(scriptCount).toBe(0);

  // API confirms bio persisted (text field — never executed as HTML)
  const homeViaPage = await page.request.get(
    `/api/portal/home?eventId=${encodeURIComponent(seed.eventId)}`,
  );
  expect(homeViaPage.status()).toBe(200);
  const body = (await homeViaPage.json()) as {
    participations: Array<{ bio: string | null }>;
  };
  const stored = body.participations[0]?.bio ?? "";
  expect(stored).toContain("Speaker bio G02");
});

test("@inv:G03 e2e/portal/headshot Upload headshot; preview — bad type rejected", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now() + 2;
  const seed = await seedPortalSpeaker(request, context, baseURL, run);
  await loginAsSpeaker(
    request,
    context,
    baseURL,
    seed.speakerEmail,
    seed.eventId,
  );

  const dir = join(tmpdir(), `speakerops-g03-${run}`);
  mkdirSync(dir, { recursive: true });
  const jpegPath = join(dir, "headshot.jpg");
  writeFileSync(jpegPath, MINI_JPEG);
  const exePath = join(dir, "bad.exe");
  writeFileSync(exePath, Buffer.from("MZ fake exe"));

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto(
    `${baseURL ?? ""}/portal?eventId=${encodeURIComponent(seed.eventId)}`,
  );
  // Wizard: advance/skip to headshot step (exclusive — one field at a time)
  await expect(page.getByTestId("portal-onboarding-wizard")).toBeVisible({
    timeout: 15_000,
  });
  for (let i = 0; i < 8; i++) {
    const kind = await page
      .getByTestId("portal-onboarding-wizard")
      .getAttribute("data-step-kind");
    if (kind === "headshot") break;
    if (kind === "bio") {
      await page.getByTestId("portal-bio-input").fill(`G03 bio ${run}`);
      await page.getByTestId("portal-wizard-continue").click();
    } else if (kind === "company") {
      await page.getByTestId("portal-company-input").fill("G03 Co");
      await page.getByTestId("portal-wizard-continue").click();
    } else if (kind === "title") {
      await page.getByTestId("portal-title-input").fill("Speaker");
      await page.getByTestId("portal-wizard-continue").click();
    } else {
      await page.getByTestId("portal-wizard-skip").click();
    }
    await page.waitForTimeout(250);
  }
  await expect(page.getByTestId("portal-headshot")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("portal-headshot-choose")).toBeVisible();
  await expect(page.getByTestId("portal-headshot-privacy")).toBeVisible();

  // Bad type via filechooser from visible Choose control (proves label wiring)
  const chooserBad = page.waitForEvent("filechooser");
  await page.getByTestId("portal-headshot-choose").click();
  const badChooser = await chooserBad;
  await badChooser.setFiles({
    name: "bad.exe",
    mimeType: "application/x-msdownload",
    buffer: Buffer.from("MZ"),
  });
  await expect(page.getByTestId("portal-headshot-status")).toContainText(
    /JPEG or PNG|rejected|not allowed|must be/i,
    { timeout: 5_000 },
  );

  // Valid JPEG via filechooser
  const chooserOk = page.waitForEvent("filechooser");
  await page.getByTestId("portal-headshot-choose").click();
  const okChooser = await chooserOk;
  await okChooser.setFiles(jpegPath);
  await expect(page.getByTestId("portal-headshot-preview")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("portal-headshot-status")).toContainText(
    /uploaded|Headshot/i,
    { timeout: 10_000 },
  );

  expect(pageErrors, `pageerror: ${pageErrors.join(" | ")}`).toEqual([]);
  expect(
    consoleErrors.filter((t) => !/favicon|React DevTools/i.test(t)),
    `console.error: ${consoleErrors.join(" | ")}`,
  ).toEqual([]);
});

test("@inv:G04 e2e/portal/slides Upload slides", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now() + 3;
  const seed = await seedPortalSpeaker(request, context, baseURL, run);
  const speakerSession = await loginAsSpeaker(
    request,
    context,
    baseURL,
    seed.speakerEmail,
    seed.eventId,
  );
  // Finish onboarding via API so review profile (with slides) is available
  await completeOnboardingViaApi(request, speakerSession, seed.eventId, {
    bio: `G04 bio ${run}`,
    company: "G04 Co",
    title: "Speaker",
  });

  const dir = join(tmpdir(), `speakerops-g04-${run}`);
  mkdirSync(dir, { recursive: true });
  const pdfPath = join(dir, "slides.pdf");
  writeFileSync(pdfPath, MINI_PDF);

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.goto(
    `${baseURL ?? ""}/portal?eventId=${encodeURIComponent(seed.eventId)}`,
  );
  await expect(page.getByTestId("portal-home")).toBeVisible({ timeout: 15_000 });
  // Review layout — open profile for slides field
  if (await page.getByTestId("portal-nav-profile").isVisible().catch(() => false)) {
    await page.getByTestId("portal-nav-profile").click();
  }
  await expect(page.getByTestId("portal-slides")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("portal-slides-choose")).toBeVisible();
  await expect(page.getByTestId("portal-slides-privacy")).toBeVisible();

  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("portal-slides-choose").click();
  const fc = await chooser;
  await fc.setFiles(pdfPath);
  await expect(page.getByTestId("portal-slides-status")).toContainText(
    /uploaded|Slides/i,
    { timeout: 15_000 },
  );
  expect(pageErrors).toEqual([]);
});

test("@inv:G05 e2e/portal/task-complete Complete task; status flips", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now() + 4;
  const seed = await seedPortalSpeaker(request, context, baseURL, run);
  const speakerSession = await loginAsSpeaker(
    request,
    context,
    baseURL,
    seed.speakerEmail,
    seed.eventId,
  );

  await page.goto(
    `${baseURL ?? ""}/portal?eventId=${encodeURIComponent(seed.eventId)}`,
  );
  // Wait for the wizard before walking it — the helper returns immediately
  // when the wizard has not rendered yet (page-load race).
  await expect(page.getByTestId("portal-home")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("portal-onboarding-wizard")).toBeVisible({
    timeout: 15_000,
  });
  // Wizard: complete headshot-linked task via continue after filling profile
  await completeProfileViaWizard(page, {
    bio: `G05 bio ${run}`,
    company: "G05 Co",
    title: "Speaker",
    uploadHeadshot: true,
  });

  // After wizard steps, completed tasks appear in review or toast path
  if (await page.getByTestId("portal-task-list").isVisible().catch(() => false)) {
    await expect(
      page.locator("li.portal-task[data-task-status='completed']").first(),
    ).toBeVisible({ timeout: 10_000 });
  } else {
    // Still on wizard or celebrate — toast proves complete path ran
    await expect(page.getByTestId("portal-toast").or(page.getByTestId("portal-home"))).toBeVisible();
  }

  // Status flips: re-read authoritative portal state — the seeded organiser
  // task must actually be completed, not merely a visible portal shell.
  expect(seed.taskIds.length).toBeGreaterThan(0);
  const homeRes = await request.get(
    `/api/portal/home?eventId=${encodeURIComponent(seed.eventId)}`,
    { headers: sessionHeaders(speakerSession) },
  );
  expect(homeRes.status()).toBe(200);
  const home = (await homeRes.json()) as {
    tasks: Array<{ id: string; status: string }>;
  };
  for (const taskId of seed.taskIds) {
    const task = home.tasks.find((t) => t.id === taskId);
    expect(task, `seeded task ${taskId} present in portal home`).toBeTruthy();
    expect(
      task!.status,
      `seeded task ${taskId} completed after wizard`,
    ).toBe("completed");
  }
});

test("@inv:G06 e2e/portal/task-overdue Overdue visual state", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now() + 5;
  // dueOffsetDays: 0 → dueAt ≈ now → client treats as overdue once past
  const seed = await seedPortalSpeaker(request, context, baseURL, run, {
    dueOffsetDays: 0,
    talkTitle: `Overdue Talk ${run}`,
  });
  await loginAsSpeaker(
    request,
    context,
    baseURL,
    seed.speakerEmail,
    seed.eventId,
  );

  // Small delay so dueAt (set at accept) is strictly ≤ now
  await page.waitForTimeout(50);

  await page.goto(
    `${baseURL ?? ""}/portal?eventId=${encodeURIComponent(seed.eventId)}`,
  );
  // Exclusive wizard: walk to the overdue organiser task step
  await expect(page.getByTestId("portal-onboarding-wizard")).toBeVisible({
    timeout: 15_000,
  });
  for (let i = 0; i < 12; i++) {
    const statusEl = page.getByTestId("portal-wizard-task-status");
    if (await statusEl.isVisible().catch(() => false)) {
      const st = ((await statusEl.getAttribute("data-status")) ?? "").trim();
      if (st === "overdue") {
        await expect(statusEl).toHaveAttribute("data-status", "overdue");
        return;
      }
    }
    const kind = await page
      .getByTestId("portal-onboarding-wizard")
      .getAttribute("data-step-kind");
    if (kind === "bio") {
      await page.getByTestId("portal-bio-input").fill(`G06 bio ${run}`);
      await page.getByTestId("portal-wizard-continue").click();
    } else if (kind === "company") {
      await page.getByTestId("portal-company-input").fill("G06 Co");
      await page.getByTestId("portal-wizard-continue").click();
    } else if (kind === "title") {
      await page.getByTestId("portal-title-input").fill("Speaker");
      await page.getByTestId("portal-wizard-continue").click();
    } else if (kind === "headshot") {
      // Skip photo so we reach the overdue freeform task step
      await page.getByTestId("portal-wizard-skip").click();
    } else if (kind === "task_text" || kind === "task_confirm") {
      await expect(page.getByTestId("portal-wizard-task-status")).toHaveAttribute(
        "data-status",
        "overdue",
        { timeout: 5_000 },
      );
      return;
    } else {
      break;
    }
    await page.waitForTimeout(250);
  }
  await expect(page.getByTestId("portal-wizard-task-status")).toHaveAttribute(
    "data-status",
    "overdue",
  );
});

test("@inv:G07 e2e/portal/session View own session status — no other speakers' private data", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now() + 6;
  const seed = await seedPortalSpeaker(request, context, baseURL, run, {
    talkTitle: `Own Session Talk ${run}`,
  });

  // Second speaker on same event
  const otherEmail = `e2e-portal-other-${run}@example.com`;
  await acceptSpeaker(
    request,
    seed.adminSession,
    seed.eventId,
    seed.slug,
    otherEmail,
    `Other Speaker ${run}`,
    `Other Talk ${run}`,
  );

  const speakerSession = await loginAsSpeaker(
    request,
    context,
    baseURL,
    seed.speakerEmail,
    seed.eventId,
  );
  await completeOnboardingViaApi(request, speakerSession, seed.eventId, {
    bio: `G07 bio ${run}`,
    company: "G07 Co",
    title: "Speaker",
  });

  await page.goto(
    `${baseURL ?? ""}/portal?eventId=${encodeURIComponent(seed.eventId)}`,
  );
  await expect(page.getByTestId("portal-home")).toBeVisible({ timeout: 15_000 });
  if (await page.getByTestId("portal-nav-sessions").isVisible().catch(() => false)) {
    await page.getByTestId("portal-nav-sessions").click();
  }
  await expect(page.getByTestId("portal-sessions")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("portal-session-list")).toBeVisible();
  await expect(page.getByTestId("portal-sessions-privacy")).toBeVisible();

  // Own session title present
  await expect(page.getByTestId("portal-session-list")).toContainText(
    `Own Session Talk ${run}`,
  );
  // Other speaker's session title must not appear (own sessions only)
  await expect(page.getByTestId("portal-session-list")).not.toContainText(
    `Other Talk ${run}`,
  );

  // Status badge on own session row (li with data-session-id only)
  const sessionRow = page.locator("li.portal-session[data-session-id]").first();
  await expect(sessionRow).toBeVisible();
  const sessionId = await sessionRow.getAttribute("data-session-id");
  expect(sessionId).toBeTruthy();
  await expect(
    sessionRow.locator("[data-testid^='portal-session-status-']"),
  ).toBeVisible();
  await expect(
    sessionRow.locator("[data-testid^='portal-session-status-']"),
  ).not.toHaveText("");
});

test("@inv:G08 e2e/portal/mobile Mobile complete bio+task", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now() + 7;
  const seed = await seedPortalSpeaker(request, context, baseURL, run);
  const speakerSession = await loginAsSpeaker(
    request,
    context,
    baseURL,
    seed.speakerEmail,
    seed.eventId,
  );

  // assert mobile viewport task complete
  await page.setViewportSize({ width: 375, height: 667 });

  await page.goto(
    `${baseURL ?? ""}/portal?eventId=${encodeURIComponent(seed.eventId)}`,
  );
  await expect(page.getByTestId("portal-home")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("portal-onboarding-wizard")).toBeVisible();

  await completeProfileViaWizard(page, {
    bio: `Mobile bio G08 ${run}`,
    company: "Mobile Co",
    title: "Speaker",
    uploadHeadshot: true,
  });

  // Wizard completion or review — toast / completed state
  await expect(page.getByTestId("portal-home")).toBeVisible();

  // Mobile complete is real: re-read portal state and assert the seeded
  // organiser task flipped to completed via the mobile wizard flow.
  expect(seed.taskIds.length).toBeGreaterThan(0);
  const homeRes = await request.get(
    `/api/portal/home?eventId=${encodeURIComponent(seed.eventId)}`,
    { headers: sessionHeaders(speakerSession) },
  );
  expect(homeRes.status()).toBe(200);
  const home = (await homeRes.json()) as {
    tasks: Array<{ id: string; status: string }>;
  };
  for (const taskId of seed.taskIds) {
    const task = home.tasks.find((t) => t.id === taskId);
    expect(task, `seeded task ${taskId} present in portal home`).toBeTruthy();
    expect(
      task!.status,
      `seeded task ${taskId} completed after mobile wizard`,
    ).toBe("completed");
  }
});

test("@inv:G09 e2e/portal/session-ics download own invite; other speaker 404", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const run = Date.now() + 9;
  const seed = await seedPortalSpeaker(request, context, baseURL, run, {
    talkTitle: `ICS Talk ${run}`,
  });

  // Admin: room + place the speaker's session.
  const room = await request.put(
    `/api/events/${encodeURIComponent(seed.eventId)}/rooms/room-ics-${run}`,
    {
      headers: sessionHeaders(seed.adminSession),
      data: { name: "ICS Room", capacity: 50 },
    },
  );
  expect(room.status(), await room.text()).toBe(200);
  const place = await request.post(
    `/api/events/${encodeURIComponent(seed.eventId)}/schedule/place`,
    {
      headers: sessionHeaders(seed.adminSession),
      data: {
        sessionId: seed.sessionId,
        roomId: `room-ics-${run}`,
        startsAt: "2026-09-02T10:00:00.000Z",
        endsAt: "2026-09-02T10:30:00.000Z",
      },
    },
  );
  expect(place.status(), await place.text()).toBe(201);

  const speakerSession = await loginAsSpeaker(
    request,
    context,
    baseURL,
    seed.speakerEmail,
    seed.eventId,
  );

  // API: owner download is a real text/calendar attachment with UID/SEQUENCE.
  const ics = await request.get(
    `/api/portal/sessions/${encodeURIComponent(seed.sessionId)}/invite.ics?eventId=${encodeURIComponent(seed.eventId)}`,
    { headers: sessionHeaders(speakerSession) },
  );
  expect(ics.status(), await ics.text()).toBe(200);
  expect(ics.headers()["content-type"] ?? "").toContain("text/calendar");
  const body = await ics.text();
  expect(body).toContain("BEGIN:VCALENDAR");
  expect(body).toContain("UID:");
  expect(body).toContain(`SUMMARY:ICS Talk ${run}`);

  // UI: complete onboarding (wizard-first portal), then the sessions view
  // renders the download control for the placed session.
  await completeOnboardingViaApi(request, speakerSession, seed.eventId, {
    bio: `G09 bio ${run}`,
    company: "G09 Co",
    title: "Speaker",
  });
  await page.goto(
    `${baseURL ?? ""}/portal?eventId=${encodeURIComponent(seed.eventId)}`,
  );
  await expect(page.getByTestId("portal-home")).toBeVisible({ timeout: 15_000 });
  if (await page.getByTestId("portal-nav-sessions").isVisible().catch(() => false)) {
    await page.getByTestId("portal-nav-sessions").click();
  }
  await expect(
    page.getByTestId(`portal-session-ics-${seed.sessionId}`),
  ).toBeVisible({ timeout: 15_000 });

  // Real download proof: clicking the control streams a text/calendar
  // attachment named invite.ics whose body is an actual VCALENDAR.
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId(`portal-session-ics-${seed.sessionId}`).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("invite.ics");
  const downloadPath = await download.path();
  const downloaded = readFileSync(downloadPath, "utf8");
  expect(downloaded).toContain("BEGIN:VCALENDAR");
  expect(downloaded).toContain(`SUMMARY:ICS Talk ${run}`);

  // Negative: another speaker on the same event cannot fetch this invite.
  const otherEmail = `e2e-portal-ics-other-${run}@example.com`;
  await acceptSpeaker(
    request,
    seed.adminSession,
    seed.eventId,
    seed.slug,
    otherEmail,
    `Other ICS Speaker ${run}`,
    `Other ICS Talk ${run}`,
  );
  const otherSession = await loginAsSpeaker(
    request,
    context,
    baseURL,
    otherEmail,
    seed.eventId,
  );
  const cross = await request.get(
    `/api/portal/sessions/${encodeURIComponent(seed.sessionId)}/invite.ics?eventId=${encodeURIComponent(seed.eventId)}`,
    { headers: sessionHeaders(otherSession) },
  );
  expect(cross.status()).toBe(404);
});
