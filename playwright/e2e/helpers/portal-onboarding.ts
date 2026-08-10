/**
 * Shared helpers for speaker onboarding wizard e2e.
 * Incomplete speakers land in exclusive wizard mode (no full form dump).
 */
import { expect, type Page } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const MINI_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//Z",
  "base64",
);

/** Walk exclusive wizard: bio → company → title → headshot (optional) → remaining. */
export async function completeProfileViaWizard(
  page: Page,
  opts: {
    bio: string;
    company: string;
    title: string;
    uploadHeadshot?: boolean;
    /** Max steps to walk (safety). */
    maxSteps?: number;
  },
): Promise<void> {
  const max = opts.maxSteps ?? 24;
  for (let i = 0; i < max; i++) {
    const wizard = page.getByTestId("portal-onboarding-wizard");
    if (!(await wizard.isVisible().catch(() => false))) return;

    const kind =
      (await wizard.getAttribute("data-step-kind"))?.toLowerCase() ?? "";

    if (kind === "bio") {
      await page.getByTestId("portal-bio-input").fill(opts.bio);
      await page.getByTestId("portal-wizard-continue").click();
      await page.waitForTimeout(200);
      continue;
    }
    if (kind === "company") {
      await page.getByTestId("portal-company-input").fill(opts.company);
      await page.getByTestId("portal-wizard-continue").click();
      await page.waitForTimeout(200);
      continue;
    }
    if (kind === "title") {
      await page.getByTestId("portal-title-input").fill(opts.title);
      await page.getByTestId("portal-wizard-continue").click();
      await page.waitForTimeout(200);
      continue;
    }
    if (kind === "headshot") {
      if (opts.uploadHeadshot !== false) {
        const dir = join(tmpdir(), `portal-wiz-${Date.now()}`);
        mkdirSync(dir, { recursive: true });
        const jpegPath = join(dir, "h.jpg");
        writeFileSync(jpegPath, MINI_JPEG);
        await page.getByTestId("portal-headshot-input").setInputFiles(jpegPath);
        await expect(page.getByTestId("portal-headshot-status")).toContainText(
          /Headshot|uploaded/i,
          { timeout: 20_000 },
        );
        // Wait until upload busy clears so Continue is enabled
        await expect(page.getByTestId("portal-wizard-continue")).toBeEnabled({
          timeout: 15_000,
        });
        await page.getByTestId("portal-wizard-continue").click();
      } else {
        await page.getByTestId("portal-wizard-skip").click();
      }
      await page.waitForTimeout(300);
      continue;
    }
    if (kind === "slides") {
      await page.getByTestId("portal-wizard-skip").click();
      await page.waitForTimeout(200);
      continue;
    }
    if (kind === "task_text") {
      await page
        .getByTestId("portal-wizard-freeform")
        .fill(`Draft answer ${Date.now()}`);
      await page.getByTestId("portal-wizard-continue").click();
      await page.waitForTimeout(200);
      continue;
    }
    if (kind === "task_confirm") {
      await page.getByTestId("portal-wizard-confirm-check").check();
      await page.getByTestId("portal-wizard-continue").click();
      await page.waitForTimeout(200);
      continue;
    }
    // Unknown: skip
    if (await page.getByTestId("portal-wizard-skip").isEnabled()) {
      await page.getByTestId("portal-wizard-skip").click();
    } else {
      break;
    }
  }
}

/**
 * Complete profile + open tasks via portal APIs so UI lands in review mode
 * (full section nav / task list). Used by nav-focused tests.
 */
export async function completeOnboardingViaApi(
  request: import("@playwright/test").APIRequestContext,
  sessionCookie: string,
  eventId: string,
  fields: {
    bio: string;
    company: string;
    title: string;
    /** When false, leave organiser tasks pending (for overdue / next-task tests). */
    completeTasks?: boolean;
  },
): Promise<void> {
  const headers = {
    cookie: `speakerops_session=${sessionCookie}`,
    "content-type": "application/json",
    accept: "application/json",
  };
  const homeRes = await request.get(
    `/api/portal/home?eventId=${encodeURIComponent(eventId)}`,
    { headers },
  );
  expect(homeRes.status()).toBe(200);
  const home = (await homeRes.json()) as {
    participations: Array<{
      id: string;
      version: number;
      headshotFileId: string | null;
    }>;
    tasks: Array<{ id: string; status: string; version: number; title: string }>;
  };
  const part = home.participations[0];
  expect(part).toBeTruthy();

  // Presign + upload headshot so profile can become complete
  const presign = await request.post("/api/files/presign", {
    headers,
    data: {
      eventId,
      purpose: "headshot",
      mime: "image/jpeg",
      size: MINI_JPEG.length,
      filename: "seed-headshot.jpg",
      ownerParticipationId: part!.id,
    },
  });
  expect(presign.status(), await presign.text()).toBe(200);
  const presignBody = (await presign.json()) as {
    fileId: string;
    url: string;
  };
  const put = await request.put(presignBody.url, {
    headers: {
      cookie: `speakerops_session=${sessionCookie}`,
      "content-type": "image/jpeg",
    },
    data: MINI_JPEG,
  });
  expect(put.ok()).toBeTruthy();
  const checksum = `sha256:len${MINI_JPEG.length}`;
  const complete = await request.post(
    `/api/files/${encodeURIComponent(presignBody.fileId)}/complete`,
    {
      headers,
      data: {
        eventId,
        checksum,
        filename: "seed-headshot.jpg",
      },
    },
  );
  expect(complete.ok(), await complete.text()).toBeTruthy();

  // Re-fetch version after file bind may change participation
  const home2 = (await (
    await request.get(
      `/api/portal/home?eventId=${encodeURIComponent(eventId)}`,
      { headers },
    )
  ).json()) as {
    participations: Array<{ id: string; version: number }>;
    tasks: Array<{ id: string; status: string; version: number }>;
  };
  const p2 = home2.participations[0]!;
  const patch = await request.patch(
    `/api/portal/participations/${encodeURIComponent(p2.id)}`,
    {
      headers,
      data: {
        bio: fields.bio,
        company: fields.company,
        title: fields.title,
        headshotFileId: presignBody.fileId,
        expectedVersion: p2.version,
      },
    },
  );
  expect(patch.ok(), await patch.text()).toBeTruthy();

  if (fields.completeTasks === false) return;

  // Complete remaining tasks
  const home3 = (await (
    await request.get(
      `/api/portal/home?eventId=${encodeURIComponent(eventId)}`,
      { headers },
    )
  ).json()) as {
    tasks: Array<{ id: string; status: string; version: number }>;
  };
  for (const t of home3.tasks) {
    const s = (t.status ?? "").toLowerCase();
    if (s === "pending" || s === "overdue") {
      const r = await request.post(
        `/api/portal/tasks/${encodeURIComponent(t.id)}/complete`,
        {
          headers,
          data: { expectedVersion: t.version },
        },
      );
      // Best-effort; version races are ok for nav seeds
      if (!r.ok()) {
        /* ignore */
      }
    }
  }
}

/** Save bio on whatever surface is shown (wizard or review form). */
export async function saveBioOnPortal(page: Page, bio: string): Promise<void> {
  await expect(page.getByTestId("portal-bio-input")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByTestId("portal-bio-input").fill(bio);
  if (await page.getByTestId("portal-wizard-save-draft").isVisible().catch(() => false)) {
    await page.getByTestId("portal-wizard-save-draft").click();
  } else if (
    await page.getByTestId("portal-wizard-continue").isVisible().catch(() => false)
  ) {
    await page.getByTestId("portal-wizard-continue").click();
  } else {
    await page.getByTestId("portal-bio-save").click();
  }
  await expect(page.getByTestId("portal-bio-status")).toContainText(
    /Saved|Draft saved/i,
    { timeout: 15_000 },
  );
}
