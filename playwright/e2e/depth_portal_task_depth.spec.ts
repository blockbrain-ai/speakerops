/**
 * Post-11.9 depth Wave 2 — portal task depth (S-PORTAL depth).
 *
 * G12: task templates gain an https resource link + required flag. The admin
 *      creates both templates through the real /admin/settings/task-templates
 *      UI; after a CFP accept the speaker portal renders the required task
 *      FIRST (server-side order, asserted in the /api/portal/home DTO too),
 *      with a Required badge and a working "Open resource" link whose href
 *      equals the configured https URL. http:// links are rejected inline.
 *
 * N05: admin completes a required task on the speaker's behalf from the
 *      /admin/speakers detail pane (real clicks). The button POSTs the new
 *      Speakers.CompleteTask endpoint, the pane updates, the speaker portal
 *      reflects completion on reload and readiness flips to complete.
 *      Negative: replaying the completion is an idempotent 200 no-op.
 *
 * Inventory: @inv:G12 · @inv:N05.
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e). New critical spec → retries 0.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  loginAs,
  ensureEvent,
  selectAdminEvent,
  seedSessionCookie,
  sessionHeaders,
  requestMagicLink,
  fetchDevLink,
  exchangeForCookie,
} from "./helpers/cfp-eval-seed";
import { completeOnboardingViaApi } from "./helpers/portal-onboarding.js";

test.describe.configure({ retries: 0 });

/** Speaker session via magic link (request-level only; cookie seeded by caller). */
async function speakerSession(
  request: APIRequestContext,
  email: string,
  eventId: string,
): Promise<string> {
  await requestMagicLink(request, email, "speaker", eventId);
  const link = await fetchDevLink(request, email);
  return exchangeForCookie(request, link.token);
}

/** Seed a published one-field CFP and one public submission; returns ids. */
async function seedAcceptedSpeaker(
  request: APIRequestContext,
  adminSession: string,
  event: { id: string; slug: string },
  speakerName: string,
  speakerEmail: string,
  title: string,
): Promise<{
  submissionId: string;
  participationId: string;
  tasks: Array<{ id: string; templateId: string; version: number; status: string }>;
}> {
  const formRes = await request.post(`/api/events/${event.id}/forms`, {
    headers: sessionHeaders(adminSession),
    data: { name: "Task depth CFP" },
  });
  expect(formRes.status()).toBe(201);
  const formId = ((await formRes.json()) as { form: { id: string } }).form.id;
  const draftRes = await request.put(`/api/forms/${formId}/draft`, {
    headers: sessionHeaders(adminSession),
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
    headers: sessionHeaders(adminSession),
    data: {},
  });
  expect(pubRes.status()).toBe(200);
  const versionId = ((await pubRes.json()) as {
    formVersion: { id: string };
  }).formVersion.id;

  const subRes = await request.post(
    `/api/public/cfp/${event.slug}/submissions`,
    {
      data: {
        formVersionId: versionId,
        title,
        answers: [
          { fieldKey: "abstract", value: "A talk about finishing tasks." },
        ],
        speakers: [{ name: speakerName, email: speakerEmail }],
        turnstileToken: "XXXX.DUMMY.TOKEN",
      },
    },
  );
  expect(subRes.status()).toBe(201);
  const submissionId = ((await subRes.json()) as {
    submission: { id: string };
  }).submission.id;

  const decisionRes = await request.post(
    `/api/submissions/${submissionId}/decision`,
    {
      headers: sessionHeaders(adminSession),
      data: { decision: "accept" },
    },
  );
  expect(decisionRes.status()).toBe(200);
  const decision = (await decisionRes.json()) as {
    participations: Array<{ id: string }>;
    tasks: Array<{
      id: string;
      templateId: string;
      version: number;
      status: string;
    }>;
  };
  expect(decision.participations.length).toBe(1);
  return {
    submissionId,
    participationId: decision.participations[0]!.id,
    tasks: decision.tasks,
  };
}

test.describe("Wave 2 — portal task depth", () => {
  test("@inv:G12 e2e/portal/task-depth required task link + ordering — admin creates linked required template in real UI; portal renders required-first with badge + https link; DTO ordered server-side", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const stamp = Date.now();
    const LINK_URL = `https://speakerops-resources.example.com/agreement-${stamp}`;

    const admin = await loginAs(
      request,
      context,
      baseURL,
      `e2e-g12-admin-${stamp}@example.com`,
      "admin",
    );
    const event = await ensureEvent(
      request,
      admin.session,
      `Depth Task Links ${stamp}`,
    );

    // Admin creates the REQUIRED template with an https link — real UI.
    await selectAdminEvent(
      page,
      baseURL,
      event.id,
      "/admin/settings/task-templates",
    );
    await expect(page.getByTestId("task-templates-create-section")).toBeVisible({
      timeout: 15_000,
    });
    await page
      .getByTestId("task-template-title-input")
      .fill("Sign the speaker agreement");
    await page.getByTestId("task-template-due-input").fill("30");

    // Negative first: http:// is rejected with an inline human error.
    await page
      .getByTestId("task-template-link-input")
      .fill("http://insecure.example.com/agreement");
    await page.getByTestId("task-template-required-input").check();
    await page.getByTestId("task-template-create").click();
    await expect(page.getByTestId("task-template-link-error")).toBeVisible();
    await expect(page.getByTestId("task-template-link-error")).toContainText(
      /https/i,
    );

    // Fix to https and create for real.
    await page.getByTestId("task-template-link-input").fill(LINK_URL);
    await page.getByTestId("task-template-create").click();
    await expect(page.getByTestId("task-templates-status")).toContainText(
      /created/i,
      { timeout: 10_000 },
    );

    // Second, OPTIONAL template — due sooner than the required one so the
    // required-first ordering is proven against the dueAt tiebreak.
    // Templates default to REQUIRED (0032 repair) — the organizer explicitly
    // opts INTO optional by unchecking the box.
    await expect(
      page.getByTestId("task-template-required-input"),
    ).toBeChecked();
    await page.getByTestId("task-template-required-input").uncheck();
    await page
      .getByTestId("task-template-title-input")
      .fill("Share travel preferences");
    await page.getByTestId("task-template-due-input").fill("3");
    await page.getByTestId("task-templates-status").waitFor({ state: "visible" });
    await page.getByTestId("task-template-create").click();
    await expect(page.getByTestId("task-templates-status")).toContainText(
      /Share travel preferences/i,
      { timeout: 10_000 },
    );

    // Resolve template ids + assert admin list renders badge and link.
    const tplRes = await request.get(
      `/api/events/${event.id}/task-templates`,
      { headers: sessionHeaders(admin.session) },
    );
    expect(tplRes.status()).toBe(200);
    const templates = ((await tplRes.json()) as {
      templates: Array<{
        id: string;
        title: string;
        linkUrl: string | null;
        required: boolean;
      }>;
    }).templates;
    const requiredTpl = templates.find(
      (t) => t.title === "Sign the speaker agreement",
    )!;
    const optionalTpl = templates.find(
      (t) => t.title === "Share travel preferences",
    )!;
    expect(requiredTpl.required).toBe(true);
    expect(requiredTpl.linkUrl).toBe(LINK_URL);
    expect(optionalTpl.required).toBe(false);
    expect(optionalTpl.linkUrl).toBeNull();
    await expect(
      page.getByTestId(`task-template-required-${requiredTpl.id}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`task-template-link-${requiredTpl.id}`),
    ).toHaveAttribute("href", LINK_URL);

    // Seed CFP submission + accept via API (prerequisites, not the journey).
    const speakerEmail = `e2e-g12-speaker-${stamp}@example.com`;
    const seeded = await seedAcceptedSpeaker(
      request,
      admin.session,
      event,
      "Task Depth Speaker",
      speakerEmail,
      "Portal task depth talk",
    );
    const requiredTask = seeded.tasks.find(
      (t) => t.templateId === requiredTpl.id,
    )!;
    const optionalTask = seeded.tasks.find(
      (t) => t.templateId === optionalTpl.id,
    )!;
    expect(requiredTask).toBeTruthy();
    expect(optionalTask).toBeTruthy();

    // Speaker signs in (portal identity) and the DTO proves server ordering.
    const speaker = await speakerSession(request, speakerEmail, event.id);
    const homeRes = await request.get(
      `/api/portal/home?eventId=${encodeURIComponent(event.id)}`,
      { headers: sessionHeaders(speaker) },
    );
    expect(homeRes.status()).toBe(200);
    const home = (await homeRes.json()) as {
      tasks: Array<{
        id: string;
        required?: boolean;
        linkUrl?: string | null;
        dueAt: string | null;
      }>;
      nextTask: { id: string } | null;
    };
    expect(home.tasks.length).toBe(2);
    // Required first server-side even though the optional task is due sooner.
    expect(home.tasks[0]!.id).toBe(requiredTask.id);
    expect(home.tasks[0]!.required).toBe(true);
    expect(home.tasks[0]!.linkUrl).toBe(LINK_URL);
    expect(home.tasks[1]!.id).toBe(optionalTask.id);
    expect(home.tasks[1]!.required).toBe(false);
    expect(home.tasks[1]!.linkUrl).toBeNull();
    expect(home.nextTask?.id).toBe(requiredTask.id);

    // Complete the profile via API (tasks left pending) — the exclusive
    // onboarding wizard then opens directly on the first ORGANISER task step,
    // which must be the required one (server order drives the wizard too).
    await completeOnboardingViaApi(request, speaker, event.id, {
      bio: `Depth bio ${stamp}`,
      company: "Task Depth Co",
      title: "Speaker",
      completeTasks: false,
    });
    await seedSessionCookie(context, baseURL, speaker);
    await page.goto(
      `${baseURL ?? ""}/portal?eventId=${encodeURIComponent(event.id)}`,
    );
    await expect(page.getByTestId("portal-onboarding-wizard")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("portal-wizard-step-label")).toContainText(
      "Sign the speaker agreement",
    );

    // Finish both organiser tasks via the speaker's own portal API so the
    // full review layout (all-tasks list) renders on reload.
    const homeMid = (await (
      await request.get(
        `/api/portal/home?eventId=${encodeURIComponent(event.id)}`,
        { headers: sessionHeaders(speaker) },
      )
    ).json()) as { tasks: Array<{ id: string; status: string; version: number }> };
    for (const t of homeMid.tasks) {
      if (t.status === "pending" || t.status === "overdue") {
        const done = await request.post(
          `/api/portal/tasks/${encodeURIComponent(t.id)}/complete`,
          {
            headers: sessionHeaders(speaker),
            data: { expectedVersion: t.version },
          },
        );
        expect(done.status()).toBe(200);
      }
    }

    // Tab model: deep link straight to the Tasks tab (task rows render there).
    await page.goto(
      `${baseURL ?? ""}/portal?eventId=${encodeURIComponent(event.id)}&section=tasks`,
    );
    const taskList = page.getByTestId("portal-task-list");
    await expect(taskList).toBeVisible({ timeout: 15_000 });
    const taskIds = await taskList
      .locator("[data-task-id]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-task-id")));
    // Required task first in the rendered DOM (server keeps the sort).
    expect(taskIds[0]).toBe(requiredTask.id);
    expect(taskIds).toContain(optionalTask.id);
    await expect(
      page.getByTestId(`portal-task-required-${requiredTask.id}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`portal-task-required-${requiredTask.id}`),
    ).toContainText(/required/i);
    const link = page.getByTestId(`portal-task-link-${requiredTask.id}`);
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", LINK_URL);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toContainText(/open resource/i);
    // The optional task renders no required badge and no link.
    await expect(
      page.getByTestId(`portal-task-required-${optionalTask.id}`),
    ).toHaveCount(0);
    await expect(
      page.getByTestId(`portal-task-link-${optionalTask.id}`),
    ).toHaveCount(0);
  });

  test("@inv:N05 e2e/speakers/complete-on-behalf — admin marks required task complete from speaker detail; audit-backed POST; portal + readiness reflect it; replay is idempotent", async ({
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
      `e2e-n05-admin-${stamp}@example.com`,
      "admin",
    );
    const event = await ensureEvent(
      request,
      admin.session,
      `Depth Complete OBO ${stamp}`,
    );

    // One REQUIRED on_accept template (pre-seeded → no default templates).
    const tplRes = await request.post(
      `/api/events/${event.id}/task-templates`,
      {
        headers: sessionHeaders(admin.session),
        data: {
          title: "Return signed agreement",
          trigger: "on_accept",
          dueOffsetDays: 14,
          linkUrl: `https://speakerops-resources.example.com/obo-${stamp}`,
          required: true,
        },
      },
    );
    expect(tplRes.status()).toBe(201);

    const speakerEmail = `e2e-n05-speaker-${stamp}@example.com`;
    const seeded = await seedAcceptedSpeaker(
      request,
      admin.session,
      event,
      "OBO Speaker",
      speakerEmail,
      "Complete on behalf talk",
    );
    expect(seeded.tasks.length).toBe(1);
    const task = seeded.tasks[0]!;

    // Speaker completes their profile via API so readiness hinges only on the
    // required task: needs_action now, complete after the admin acts.
    const speaker = await speakerSession(request, speakerEmail, event.id);
    await completeOnboardingViaApi(request, speaker, event.id, {
      bio: `OBO bio ${stamp}`,
      company: "OBO Co",
      title: "Speaker",
      completeTasks: false,
    });
    const beforeRes = await request.get(
      `/api/portal/home?eventId=${encodeURIComponent(event.id)}`,
      { headers: sessionHeaders(speaker) },
    );
    expect(beforeRes.status()).toBe(200);
    const before = (await beforeRes.json()) as {
      readiness?: { state: string; headline: string };
    };
    expect(before.readiness?.state).toBe("needs_action");
    expect(before.readiness?.headline).toBe("Required tasks remaining");

    // Admin opens /admin/speakers detail with real clicks.
    await seedSessionCookie(context, baseURL, admin.session);
    await selectAdminEvent(page, baseURL, event.id, "/admin/speakers");
    const openBtn = page.getByTestId(`speaker-open-${seeded.participationId}`);
    await expect(openBtn).toBeVisible({ timeout: 15_000 });
    await openBtn.click();
    await expect(
      page.getByTestId("speakers-detail-section-tasks"),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByTestId(`speakers-task-required-${task.id}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`speakers-task-status-${task.id}`),
    ).toContainText(/pending/i);

    // Click "Mark complete" and assert the real POST to the new endpoint.
    const completeBtn = page.getByTestId(`speakers-task-complete-${task.id}`);
    await expect(completeBtn).toBeVisible();
    const [completeRes] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r
            .url()
            .includes(
              `/api/events/${event.id}/speakers/${seeded.participationId}/tasks/${task.id}/complete`,
            ) && r.request().method() === "POST",
      ),
      completeBtn.click(),
    ]);
    expect(completeRes.status()).toBe(200);
    const completedBody = (await completeRes.json()) as {
      task: { id: string; status: string; version: number };
    };
    expect(completedBody.task.status).toBe("completed");
    const completedVersion = completedBody.task.version;

    // UI updates in place: success copy, Completed badge, button gone.
    await expect(
      page.getByTestId("speakers-task-action-status"),
    ).toContainText(/marked complete/i, { timeout: 10_000 });
    await expect(
      page.getByTestId(`speakers-task-status-${task.id}`),
    ).toContainText(/completed/i);
    await expect(
      page.getByTestId(`speakers-task-complete-${task.id}`),
    ).toHaveCount(0);

    // Negative: replaying the completion is an idempotent 200 no-op.
    const replay = await request.post(
      `/api/events/${event.id}/speakers/${seeded.participationId}/tasks/${task.id}/complete`,
      {
        headers: sessionHeaders(admin.session),
        data: { expectedVersion: completedVersion },
      },
    );
    expect(replay.status()).toBe(200);
    const replayBody = (await replay.json()) as {
      task: { status: string; version: number };
    };
    expect(replayBody.task.status).toBe("completed");
    expect(replayBody.task.version).toBe(completedVersion);

    // Speaker portal reflects it instantly on reload + readiness flips.
    const afterRes = await request.get(
      `/api/portal/home?eventId=${encodeURIComponent(event.id)}`,
      { headers: sessionHeaders(speaker) },
    );
    expect(afterRes.status()).toBe(200);
    const after = (await afterRes.json()) as {
      tasks: Array<{ id: string; status: string }>;
      readiness?: { state: string; percent: number };
    };
    expect(after.tasks.find((t) => t.id === task.id)?.status).toBe(
      "completed",
    );
    expect(after.readiness?.state).toBe("complete");
    expect(after.readiness?.percent).toBe(100);

    await seedSessionCookie(context, baseURL, speaker);
    await page.goto(
      `${baseURL ?? ""}/portal?eventId=${encodeURIComponent(event.id)}`,
    );
    await expect(page.getByTestId("portal-next-task")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("portal-next-task")).toHaveAttribute(
      "data-readiness",
      "complete",
    );
    // Tab model: task rows render on the Tasks tab.
    await page.getByTestId("portal-nav-tasks").click();
    await expect(
      page.getByTestId(`portal-task-status-${task.id}`),
    ).toContainText(/completed/i);
  });
});
