/**
 * One-shot capture for Learn Phase 3 hero images (not inventory-gated).
 * Writes PNG under docs/tmp/learn-shots/ then convert offline.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loginAs,
  sessionHeaders,
  ensureEvent,
} from "./helpers/cfp-eval-seed.js";

test.describe.configure({ retries: 0 });

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "docs", "tmp", "learn-shots");

async function upsertRubric(
  request: APIRequestContext,
  session: string,
  eventId: string,
) {
  await request.put(`/api/events/${eventId}/eval/rubric`, {
    headers: sessionHeaders(session),
    data: {
      criteria: [
        {
          id: "crit_novelty",
          name: "Novelty",
          maxScore: 5,
          weight: 1,
          sortOrder: 0,
        },
        {
          id: "crit_fit",
          name: "Program fit",
          maxScore: 5,
          weight: 1,
          sortOrder: 1,
        },
      ],
    },
  });
}

test("capture learn heroes: eval embeds team files history", async ({
  page,
  request,
  context,
  baseURL,
}) => {
  test.setTimeout(180_000);
  mkdirSync(OUT, { recursive: true });
  const run = `${Date.now()}`;
  const admin = await loginAs(
    request,
    context,
    baseURL,
    `learn-hero-${run}@example.com`,
    "admin",
  );
  const event = await ensureEvent(
    request,
    admin.session,
    `Learn Hero ${run}`,
    `learn-hero-${run}`,
  );
  await upsertRubric(request, admin.session, event.id);

  // Publish a form + accept a submission so eval queue has work
  const formRes = await request.post(`/api/events/${event.id}/forms`, {
    headers: sessionHeaders(admin.session),
    data: { name: `Hero CFP ${run}` },
  });
  expect(formRes.status()).toBe(201);
  const form = (await formRes.json()) as { form: { id: string } };
  await request.put(`/api/forms/${form.form.id}/draft`, {
    headers: sessionHeaders(admin.session),
    data: {
      fields: [
        {
          fieldKey: "talk_title",
          type: "text",
          label: "Title",
          required: true,
          sortOrder: 0,
        },
      ],
    },
  });
  const pub = await request.post(`/api/forms/${form.form.id}/publish`, {
    headers: sessionHeaders(admin.session),
    data: {},
  });
  expect(pub.status()).toBe(200);
  const published = (await pub.json()) as { formVersion: { id: string } };
  const sub = await request.post(`/api/public/cfp/${event.slug}/submissions`, {
    data: {
      formVersionId: published.formVersion.id,
      title: `Hero Talk ${run}`,
      answers: [{ fieldKey: "talk_title", value: `Hero Talk ${run}` }],
      speakers: [
        {
          name: "Hero Spk",
          email: `hero-spk-${run}@example.com`,
          isPrimary: true,
        },
      ],
      turnstileToken: "XXXX.DUMMY.TOKEN",
    },
  });
  expect(sub.status()).toBe(201);
  const subBody = (await sub.json()) as { submission: { id: string } };

  // Seed file request + resource
  await request.post(`/api/events/${event.id}/file-requests`, {
    headers: sessionHeaders(admin.session),
    data: {
      title: "Upload slides",
      description: "PDF or PPTX for the stage",
      required: true,
    },
  }).catch(() => null);
  await request
    .post(`/api/events/${event.id}/resources`, {
      headers: sessionHeaders(admin.session),
      data: {
        title: "Speaker handbook",
        bodyMd: "# Welcome\nPlease read before the event.",
        visibility: "speakers",
      },
    })
    .catch(() => null);

  await page.addInitScript((id) => {
    localStorage.setItem("speakerops.activeEventId", id);
  }, event.id);

  async function shot(name: string, path: string) {
    await page.goto(path);
    await expect(page.getByTestId("admin-shell")).toBeVisible({
      timeout: 15_000,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: join(OUT, `${name}.png`),
      animations: "disabled",
    });
  }

  await shot("hero-team", "/admin/team");
  await shot("hero-embeds", "/admin/embeds");
  await shot("hero-file-requests", "/admin/file-requests");
  await shot("hero-resources", "/admin/resources");
  await shot("hero-comms-history", "/admin/comms?surface=history");

  // Eval: assign self and open scoring if possible
  await page.goto("/admin/evaluations");
  await expect(page.getByTestId("admin-shell")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);
  await page.screenshot({
    path: join(OUT, "hero-evaluation.png"),
    animations: "disabled",
  });

  // Try evaluator surface after accepting as assign
  await request.post(`/api/submissions/${subBody.submission.id}/assign`, {
    headers: sessionHeaders(admin.session),
    data: { evaluatorUserIds: [admin.userId] },
  }).catch(async () => {
    // alternate assign shapes
    await request
      .post(`/api/events/${event.id}/eval/assign`, {
        headers: sessionHeaders(admin.session),
        data: {
          submissionId: subBody.submission.id,
          evaluatorUserId: admin.userId,
        },
      })
      .catch(() => null);
  });

  await page.goto("/eval");
  await page.waitForTimeout(600);
  await page.screenshot({
    path: join(OUT, "hero-eval-scoring.png"),
    animations: "disabled",
  });
});
