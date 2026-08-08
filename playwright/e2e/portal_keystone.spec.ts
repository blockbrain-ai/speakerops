/**
 * Section 4.4 — Portal e2e proof (I12 keystone).
 *
 * Soul path (S-PORTAL):
 *   seed accept → speaker portal green (next task, bio, files, complete, session, mobile).
 *
 * Proof owner for phase-4 inventory (implementation tags stay 1:1 on 4.1/4.3 specs):
 * - @inv:G01 e2e/portal/home
 * - @inv:G02 e2e/portal/bio
 * - @inv:G03 e2e/portal/headshot
 * - @inv:G04 e2e/portal/slides
 * - @inv:G05 e2e/portal/task-complete
 * - @inv:G06 e2e/portal/task-overdue
 * - @inv:G07 e2e/portal/session
 * - @inv:G08 e2e/portal/mobile
 * - @inv:O05 e2e/settings/task-templates
 *
 * Active `@inv` ownership remains on implementation specs (duplicate owners
 * forbidden by inventory law). This keystone stitches the multi-step soul path
 * and documents G01–G08 (+ O05) coverage for phase-4 proof.
 *
 * Named assertions (spec 4.4):
 * - assert portal keystone green after seed accept
 *
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
 *
 * @see docs/sections/4.4-portal-e2e.md
 * @see KMS-competition/initiative/evidence/phase4-e2e.txt
 */
import { test, expect } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ensureEvent,
  sessionHeaders,
  requestMagicLink,
  fetchDevLink,
  exchangeForCookie,
  seedSessionCookie,
} from "./helpers/cfp-eval-seed.js";

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

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const KEYSTONE_ADMIN = `e2e-keystone44-admin-${RUN}@example.com`;
const KEYSTONE_SPEAKER_EMAIL = `e2e-keystone44-speaker-${RUN}@example.com`;
const KEYSTONE_SPEAKER_NAME = "Keystone Portal Speaker";
const TALK_TITLE = `Keystone Portal Talk ${RUN}`;
const TEMPLATE_TITLE = `Keystone Headshot ${RUN}`;
const OVERDUE_TEMPLATE_TITLE = `Keystone Overdue Bio ${RUN}`;

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
): Promise<string> {
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
  const body = (await res.json()) as { template: { id: string } };
  return body.template.id;
}

/**
 * Form publish → public submit → admin accept (seed accept path).
 * Returns participation + materialised tasks.
 */
async function seedAcceptSpeaker(
  request: import("@playwright/test").APIRequestContext,
  session: string,
  eventId: string,
  slug: string,
  speakerEmail: string,
  speakerName: string,
  title: string,
): Promise<{
  participationId: string;
  submissionId: string;
  sessionId: string;
  tasks: Array<{ id: string; status: string; title?: string }>;
}> {
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
      answers: [{ fieldKey: "abstract", value: "Keystone portal abstract" }],
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
    session: { id: string } | null;
    tasks: Array<{ id: string; status: string; title?: string }>;
  };
  expect(body.participations.length).toBeGreaterThanOrEqual(1);
  expect(body.session).not.toBeNull();
  expect(
    body.tasks.length,
    "accept must materialise speaker_tasks from templates",
  ).toBeGreaterThanOrEqual(1);

  return {
    participationId: body.participations[0]!.id,
    submissionId: sub.submission.id,
    sessionId: body.session!.id,
    tasks: body.tasks,
  };
}

test.describe("4.4 portal keystone (I12)", () => {
  /**
   * assert portal keystone green after seed accept
   *
   * Multi-step soul path: task templates → accept → speaker portal G01–G08.
   */
  test("keystone: seed accept → portal green (G01–G08)", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    // --- Admin login ---
    const admin = await loginAsAdmin(
      request,
      context,
      baseURL,
      KEYSTONE_ADMIN,
    );

    // --- Event ---
    const event = await ensureEvent(
      request,
      admin.session,
      `Keystone Portal ${RUN}`,
      `keystone-portal-${RUN}`,
    );

    // --- O05: task templates (on_accept) — future + overdue ---
    // Future task (next incomplete home)
    await seedTemplate(
      request,
      admin.session,
      event.id,
      TEMPLATE_TITLE,
      14,
    );
    // Overdue visual (dueOffsetDays 0 → dueAt ≈ now)
    await seedTemplate(
      request,
      admin.session,
      event.id,
      OVERDUE_TEMPLATE_TITLE,
      0,
    );

    // Admin templates UI surface still reachable (O05 SPA path)
    await page.goto(
      `${baseURL ?? ""}/admin/settings/task-templates?eventId=${encodeURIComponent(event.id)}`,
    );
    // Event context may need select when query not auto-applied
    const eventSelect = page.getByTestId("event-context");
    if (await eventSelect.isVisible().catch(() => false)) {
      await eventSelect.selectOption({ value: event.id }).catch(() => {});
    }
    await expect(page.getByTestId("page-task-templates")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("task-templates-list")).toContainText(
      TEMPLATE_TITLE,
      { timeout: 10_000 },
    );

    // --- Seed accept path (S-EVAL → S-PORTAL handoff) ---
    const accepted = await seedAcceptSpeaker(
      request,
      admin.session,
      event.id,
      event.slug,
      KEYSTONE_SPEAKER_EMAIL,
      KEYSTONE_SPEAKER_NAME,
      TALK_TITLE,
    );
    expect(accepted.tasks.length).toBeGreaterThanOrEqual(2);

    // Authz negatives on portal API (unauthenticated)
    const unauthHome = await request.get(
      `/api/portal/home?eventId=${encodeURIComponent(event.id)}`,
      { headers: { "content-type": "application/json" } },
    );
    expect(unauthHome.status()).toBe(401);

    // Speaker cannot CRUD templates
    await requestMagicLink(
      request,
      KEYSTONE_SPEAKER_EMAIL,
      "speaker",
      event.id,
    );
    const preSpeakerLink = await fetchDevLink(request, KEYSTONE_SPEAKER_EMAIL);
    const preSpeakerSession = await exchangeForCookie(
      request,
      preSpeakerLink.token,
    );
    const speakerTpl = await request.post(
      `/api/events/${event.id}/task-templates`,
      {
        headers: sessionHeaders(preSpeakerSession),
        data: {
          title: "Forbidden template",
          trigger: "on_accept",
          dueOffsetDays: 7,
        },
      },
    );
    expect(speakerTpl.status()).toBe(403);
    expect(await speakerTpl.json()).toMatchObject({ code: "FORBIDDEN" });

    // --- Speaker session for portal SPA ---
    await loginAsSpeaker(
      request,
      context,
      baseURL,
      KEYSTONE_SPEAKER_EMAIL,
      event.id,
    );

    // Prepare upload fixtures
    const dir = join(tmpdir(), `speakerops-keystone44-${RUN}`);
    mkdirSync(dir, { recursive: true });
    const jpegPath = join(dir, "headshot.jpg");
    const pdfPath = join(dir, "slides.pdf");
    writeFileSync(jpegPath, MINI_JPEG);
    writeFileSync(pdfPath, MINI_PDF);

    // Small delay so dueAt for overdue template is strictly ≤ now
    await page.waitForTimeout(80);

    // ========== G01: land on next incomplete task ==========
    await page.goto(
      `${baseURL ?? ""}/portal?eventId=${encodeURIComponent(event.id)}`,
    );
    await expect(page.getByTestId("portal-home")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("portal-next-task")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("portal-next-task-card")).toBeVisible();
    await expect(page.getByTestId("portal-next-task-title")).not.toBeEmpty();
    const nextStatus = (
      (await page.getByTestId("portal-next-task-status").textContent()) ?? ""
    ).trim();
    expect(["pending", "overdue"]).toContain(nextStatus);

    // ========== G06: overdue visual state (before complete) ==========
    await expect(page.getByTestId("portal-task-list")).toBeVisible();
    const overdue = page.locator(".portal-task--overdue").first();
    await expect(overdue).toBeVisible({ timeout: 10_000 });
    await expect(overdue).toHaveAttribute("data-task-status", "overdue");
    await expect(
      overdue.locator("[data-testid^='portal-task-status-']"),
    ).toContainText("overdue");

    // ========== G07: own session status ==========
    await expect(page.getByTestId("portal-sessions")).toBeVisible();
    await expect(page.getByTestId("portal-session-list")).toContainText(
      TALK_TITLE,
    );
    await expect(page.getByTestId("portal-sessions-privacy")).toBeVisible();
    const sessionRow = page
      .locator("li.portal-session[data-session-id]")
      .first();
    await expect(sessionRow).toBeVisible();
    await expect(
      sessionRow.locator("[data-testid^='portal-session-status-']"),
    ).not.toHaveText("");

    // ========== G02: bio XSS text-only ==========
    await expect(page.getByTestId("portal-bio-form")).toBeVisible();
    const xssBio = `<script>alert("xss")</script>Keystone bio G02 ${RUN}`;
    await page.getByTestId("portal-bio-input").fill(xssBio);
    await page.getByTestId("portal-bio-save").click();
    await expect(page.getByTestId("portal-bio-status")).toContainText("Saved", {
      timeout: 10_000,
    });
    const previewText =
      (await page.getByTestId("portal-bio-preview").textContent()) ?? "";
    expect(previewText).not.toMatch(/<script/i);
    expect(previewText).toContain(`Keystone bio G02 ${RUN}`);
    const scriptCount = await page
      .getByTestId("portal-profile")
      .locator("script")
      .count();
    expect(scriptCount).toBe(0);

    // ========== G03: headshot (bad type rejected + valid JPEG) ==========
    await expect(page.getByTestId("portal-headshot")).toBeVisible();
    await page.getByTestId("portal-headshot-input").setInputFiles({
      name: "bad.exe",
      mimeType: "application/x-msdownload",
      buffer: Buffer.from("MZ"),
    });
    await expect(page.getByTestId("portal-headshot-status")).toContainText(
      /JPEG or PNG|rejected|not allowed|must be/i,
      { timeout: 5_000 },
    );
    await page.getByTestId("portal-headshot-input").setInputFiles(jpegPath);
    await expect(page.getByTestId("portal-headshot-preview")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("portal-headshot-status")).toContainText(
      /uploaded|Headshot/i,
      { timeout: 10_000 },
    );

    // ========== G04: slides PDF ==========
    await expect(page.getByTestId("portal-slides")).toBeVisible();
    await page.getByTestId("portal-slides-input").setInputFiles(pdfPath);
    await expect(page.getByTestId("portal-slides-status")).toContainText(
      /uploaded|Slides/i,
      { timeout: 15_000 },
    );

    // ========== G05: complete task; status flips ==========
    const nextComplete = page.getByTestId("portal-next-task-complete");
    if (await nextComplete.isVisible().catch(() => false)) {
      await nextComplete.click();
    } else {
      const completeBtn = page
        .locator("[data-testid^='portal-task-complete-']")
        .first();
      await expect(completeBtn).toBeVisible();
      await completeBtn.click();
    }
    await expect(
      page.locator("li.portal-task[data-task-status='completed']").first(),
    ).toBeVisible({ timeout: 10_000 });

    // ========== G08: mobile complete remaining bio+task ==========
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(
      `${baseURL ?? ""}/portal?eventId=${encodeURIComponent(event.id)}`,
    );
    await expect(page.getByTestId("portal-home")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("portal-bio-form")).toBeVisible();
    await page
      .getByTestId("portal-bio-input")
      .fill(`Mobile keystone bio G08 ${RUN}`);
    await page.getByTestId("portal-bio-save").click();
    await expect(page.getByTestId("portal-bio-status")).toContainText("Saved", {
      timeout: 10_000,
    });

    // Complete another incomplete task if present
    const mobileComplete = page.getByTestId("portal-next-task-complete");
    if (await mobileComplete.isVisible().catch(() => false)) {
      await mobileComplete.click();
      await expect(
        page.locator("[data-task-status='completed']").first(),
      ).toBeVisible({ timeout: 10_000 });
    } else {
      // All tasks may already be complete — assert completed state still visible
      await expect(
        page.locator("[data-task-status='completed']").first(),
      ).toBeVisible({ timeout: 10_000 });
    }

    // Final API proof: portal home still 200 for speaker; unauth still 401
    const homeOk = await page.request.get(
      `/api/portal/home?eventId=${encodeURIComponent(event.id)}`,
    );
    expect(homeOk.status()).toBe(200);
    const homeBody = (await homeOk.json()) as {
      tasks: Array<{ status: string }>;
      sessions: Array<{ id: string }>;
      participations: Array<{ bio: string | null }>;
    };
    expect(homeBody.sessions.length).toBeGreaterThanOrEqual(1);
    expect(
      homeBody.tasks.some((t) => t.status === "completed"),
    ).toBeTruthy();
    const storedBio = homeBody.participations[0]?.bio ?? "";
    expect(storedBio).toMatch(/G08|G02|Keystone bio|Mobile keystone/i);

    const unauthAgain = await request.get(
      `/api/portal/home?eventId=${encodeURIComponent(event.id)}`,
    );
    expect(unauthAgain.status()).toBe(401);

    // assert portal keystone green after seed accept
    expect(accepted.sessionId).toBeTruthy();
    expect(accepted.participationId).toBeTruthy();
  });
});
