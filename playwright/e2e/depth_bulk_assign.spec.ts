/**
 * Wave 2 — bulk-assign wizard (S-EVAL depth).
 *
 * F14: admin previews a deterministic bulk assignment plan on the evaluations
 *      page (round-robin, 1 reviewer per submission), applies it, and the
 *      durable assignments match the previewed plan exactly. A second apply is
 *      blocked client-side until a fresh preview; re-preview with
 *      existing=preserve binds the NEW estate (fresh previewId — the earlier
 *      token can never replay a different plan) and yields 0 additions with
 *      "already assigned" skips; applying it is a REAL no-op commit, not a
 *      cached "already applied" replay of the 3-addition plan.
 *
 * Inventory: @inv:F14. Requires E2E_WEB_SERVER=1 (pnpm test:e2e).
 * New critical spec → retries 0.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  loginAs,
  ensureEvent,
  upsertRubric,
  selectAdminEvent,
  seedSessionCookie,
  sessionHeaders,
} from "./helpers/cfp-eval-seed";

test.describe.configure({ retries: 0 });

/** Publish a minimal CFP form; returns the published version id. */
async function publishCfp(
  request: APIRequestContext,
  session: string,
  eventId: string,
): Promise<string> {
  const create = await request.post(`/api/events/${eventId}/forms`, {
    headers: sessionHeaders(session),
    data: { name: "Bulk Assign CFP" },
  });
  expect(create.status()).toBe(201);
  const form = (await create.json()) as { form: { id: string } };
  const draft = await request.put(`/api/forms/${form.form.id}/draft`, {
    headers: sessionHeaders(session),
    data: {
      fields: [
        {
          fieldKey: "talk_title",
          type: "text",
          label: "Talk title",
          required: true,
          sortOrder: 0,
        },
      ],
    },
  });
  expect(draft.status()).toBe(200);
  const pub = await request.post(`/api/forms/${form.form.id}/publish`, {
    headers: sessionHeaders(session),
  });
  expect(pub.status()).toBe(200);
  const published = (await pub.json()) as { formVersion: { id: string } };
  return published.formVersion.id;
}

async function submitProposal(
  request: APIRequestContext,
  slug: string,
  versionId: string,
  title: string,
): Promise<string> {
  const res = await request.post(`/api/public/cfp/${slug}/submissions`, {
    data: {
      formVersionId: versionId,
      title,
      answers: [{ fieldKey: "talk_title", value: title }],
      speakers: [
        {
          name: `Speaker ${title}`,
          email: `speaker-${title.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}@example.com`,
        },
      ],
      turnstileToken: "XXXX.DUMMY.TOKEN",
    },
  });
  expect(res.status(), `Submission.Create ${res.status()}`).toBe(201);
  const body = (await res.json()) as { submission: { id: string } };
  return body.submission.id;
}

/** assignmentCount per evaluator from the admin members roster. */
async function memberCounts(
  request: APIRequestContext,
  session: string,
  eventId: string,
): Promise<Map<string, number>> {
  const res = await request.get(
    `/api/events/${eventId}/members?role=evaluator`,
    { headers: sessionHeaders(session) },
  );
  expect(res.status(), `members ${res.status()}`).toBe(200);
  const body = (await res.json()) as {
    members: Array<{ userId: string; assignmentCount: number }>;
  };
  return new Map(body.members.map((m) => [m.userId, m.assignmentCount]));
}

/** Submission ids in an evaluator's queue (their own assignments only). */
async function queueSubmissionIds(
  request: APIRequestContext,
  session: string,
  eventId: string,
): Promise<string[]> {
  const res = await request.get(`/api/me/eval-queue?eventId=${eventId}`, {
    headers: sessionHeaders(session),
  });
  expect(res.status(), `eval-queue ${res.status()}`).toBe(200);
  const body = (await res.json()) as {
    items: Array<{ submission: { id: string } }>;
  };
  return body.items.map((i) => i.submission.id).sort();
}

test.describe("Wave 2 — bulk-assign wizard", () => {
  test("@inv:F14 e2e/eval/bulk-assign wizard preview + commit; durable rows match the plan; stale re-commit blocked; preserve re-run adds nothing", async ({
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
      `e2e-f14-admin-${stamp}@example.com`,
      "admin",
    );
    const event = await ensureEvent(
      request,
      admin.session,
      `Bulk Assign Event ${stamp}`,
    );
    const versionId = await publishCfp(request, admin.session, event.id);
    const submissions = [
      await submitProposal(request, event.slug, versionId, `Bulk One ${stamp}`),
      await submitProposal(request, event.slug, versionId, `Bulk Two ${stamp}`),
      await submitProposal(
        request,
        event.slug,
        versionId,
        `Bulk Three ${stamp}`,
      ),
    ];
    await upsertRubric(request, admin.session, event.id);

    const evalA = await loginAs(
      request,
      context,
      baseURL,
      `e2e-f14-eval-a-${stamp}@example.com`,
      "evaluator",
      event.id,
    );
    const evalB = await loginAs(
      request,
      context,
      baseURL,
      `e2e-f14-eval-b-${stamp}@example.com`,
      "evaluator",
      event.id,
    );
    // Deterministic allocation orders evaluators by user id ascending.
    const [firstEval, secondEval] = [evalA, evalB].sort((a, b) =>
      a.userId.localeCompare(b.userId),
    ) as [typeof evalA, typeof evalB];
    const sortedSubs = [...submissions].sort();

    // Admin drives the real wizard.
    await seedSessionCookie(context, baseURL, admin.session);
    await selectAdminEvent(page, baseURL, event.id, "/admin/evaluations");
    const card = page.getByTestId("eval-bulk-card");
    await expect(card).toBeVisible({ timeout: 15_000 });

    // Both evaluators, round-robin, 1 reviewer per submission.
    await page.getByTestId(`eval-bulk-evaluator-${evalA.userId}`).check();
    await page.getByTestId(`eval-bulk-evaluator-${evalB.userId}`).check();
    await page.getByTestId("eval-bulk-mode-rr").check();
    await expect(
      page.getByTestId("eval-bulk-reviewers-per-submission"),
    ).toHaveValue("1");
    await expect(page.getByTestId("eval-bulk-existing-preserve")).toBeChecked();

    // Apply is disabled until a preview exists.
    await expect(page.getByTestId("eval-bulk-commit")).toBeDisabled();

    // Preview: 3 matched, 3 additions, distribution 2/1 by evaluator id order.
    const [preview1Res] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes(`/api/events/${event.id}/eval/bulk-assign`) &&
          r.request().method() === "POST",
      ),
      page.getByTestId("eval-bulk-preview").click(),
    ]);
    const preview1 = (await preview1Res.json()) as { previewId: string };
    const previewTable = page.getByTestId("eval-bulk-preview-table");
    await expect(previewTable).toBeVisible({ timeout: 10_000 });
    await expect(previewTable).toHaveAttribute("data-matched", "3");
    await expect(previewTable).toHaveAttribute("data-additions", "3");
    await expect(previewTable).toHaveAttribute("data-removals", "0");
    await expect(
      page.getByTestId(`eval-bulk-preview-evaluator-${firstEval.userId}`),
    ).toHaveAttribute("data-planned", "2");
    await expect(
      page.getByTestId(`eval-bulk-preview-evaluator-${secondEval.userId}`),
    ).toHaveAttribute("data-planned", "1");

    // Apply the plan.
    await page.getByTestId("eval-bulk-commit").click();
    await expect(page.getByTestId("eval-bulk-result")).toContainText(
      "3 assignments added",
      { timeout: 10_000 },
    );

    // Durable rows match the previewed plan exactly (fresh API, not the DOM):
    // submissions in id order s1→e1, s2→e2, s3→e1 (round-robin, ids asc).
    const counts = await memberCounts(request, admin.session, event.id);
    expect(counts.get(firstEval.userId)).toBe(2);
    expect(counts.get(secondEval.userId)).toBe(1);
    expect(
      await queueSubmissionIds(request, firstEval.session, event.id),
    ).toEqual([sortedSubs[0]!, sortedSubs[2]!].sort());
    expect(
      await queueSubmissionIds(request, secondEval.session, event.id),
    ).toEqual([sortedSubs[1]!]);

    // A second apply is blocked client-side until a fresh preview exists.
    await expect(page.getByTestId("eval-bulk-commit")).toBeDisabled();

    // Re-preview with existing=preserve: the committed assignments are part
    // of the estate now, so this is a FRESH token over a 0-addition plan —
    // nothing to add, honest skip reasons.
    const [repreviewRes] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes(`/api/events/${event.id}/eval/bulk-assign`) &&
          r.request().method() === "POST",
      ),
      page.getByTestId("eval-bulk-preview").click(),
    ]);
    const repreview = (await repreviewRes.json()) as { previewId: string };
    // The committed rows changed the estate — the token is NEW.
    expect(repreview.previewId).not.toBe(preview1.previewId);
    await expect(previewTable).toBeVisible({ timeout: 10_000 });
    await expect(previewTable).toHaveAttribute("data-additions", "0");
    await expect(previewTable).toHaveAttribute("data-skipped", "3");
    await expect(
      page.getByTestId("eval-bulk-preview-skips"),
    ).toContainText("already assigned");

    // Applying the fresh 0-addition plan commits THAT plan — never a cached
    // "already applied" replay of the earlier 3-addition response.
    const [commit2Res] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes(`/api/events/${event.id}/eval/bulk-assign`) &&
          r.request().method() === "POST",
      ),
      page.getByTestId("eval-bulk-commit").click(),
    ]);
    expect(commit2Res.status(), "fresh no-op commit HTTP").toBe(200);
    const commit2 = (await commit2Res.json()) as {
      previewId: string;
      idempotent?: boolean;
      counts: { additions: number };
    };
    // Full-estate previewId: the post-commit token differs from the plan that
    // was applied, and this commit is NOT an idempotent replay.
    expect(commit2.previewId).toBe(repreview.previewId);
    expect(commit2.idempotent).toBeUndefined();
    expect(commit2.counts.additions).toBe(0);
    await expect(page.getByTestId("eval-bulk-result")).toContainText(
      /0 assignments added/i,
      { timeout: 10_000 },
    );
    await expect(page.getByTestId("eval-bulk-result")).not.toContainText(
      /already applied/i,
    );
    const countsAfter = await memberCounts(request, admin.session, event.id);
    expect(countsAfter.get(firstEval.userId)).toBe(2);
    expect(countsAfter.get(secondEval.userId)).toBe(1);
  });
});
