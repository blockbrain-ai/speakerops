/**
 * Post-11.9 depth Wave 2 — Submission.ExportCsv (S-SUB-LIST depth).
 *
 * GET /api/events/:eventId/submissions/export honors the same filters as
 * Submission.List, flattens speakers, emits stable headers (base columns +
 * answer field_keys sorted), excludes layout-node keys (Wave 1B), and
 * neutralizes CSV formulas. Admin session or bearer submissions:read.
 */
import { describe, it, expect } from "vitest";
import { EventResponseSchema, SESSION_COOKIE_NAME } from "@speakerops/shared";
import { createAppWithAuth } from "../../index.js";

const env = { APP_VERSION: "0.1.0" };

async function session(purpose: "admin" | "evaluator", email: string, eventId?: string, shared?: ReturnType<typeof createAppWithAuth>) {
  const ctx = shared ?? createAppWithAuth({ cookieSecure: true });
  const { app, submissions, outbox } = ctx;
  const body: Record<string, string> = { email, purpose };
  if (eventId) body.eventId = eventId;
  await app.request(
    "http://localhost/api/auth/magic-link",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    env,
  );
  const token = outbox.lastForEmail(email)!.token;
  const exchange = await app.request(
    "http://localhost/api/auth/exchange",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    },
    env,
  );
  expect(exchange.status).toBe(200);
  const cookieValue = exchange.headers
    .get("set-cookie")!
    .split(";")[0]!
    .split("=")
    .slice(1)
    .join("=");
  return {
    ctx,
    app,
    submissions,
    cookie: `${SESSION_COOKIE_NAME}=${cookieValue}`,
  };
}

async function createEvent(
  app: ReturnType<typeof createAppWithAuth>["app"],
  cookie: string,
) {
  const res = await app.request(
    "http://localhost/api/events",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-correlation-id": "corr-w2-export-event",
      },
      body: JSON.stringify({ name: "W2 Export Event", timezone: "UTC" }),
    },
    env,
  );
  expect(res.status).toBe(201);
  return EventResponseSchema.parse(await res.json()).event;
}

type Ctx = Awaited<ReturnType<typeof session>>;

async function seedSubmission(
  ctx: Ctx,
  eventId: string,
  suffix: string,
  status: string,
  formVersionId: string,
  answers: Array<{ fieldKey: string; value: unknown }>,
) {
  const now = new Date().toISOString();
  const person = await ctx.submissions.insertPerson({
    id: `person_w2x_${suffix}`,
    orgId: "org_dogfood",
    email: `speaker-w2x-${suffix}@example.com`,
    name: `Exporter ${suffix}`,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.submissions.insertSubmission({
    id: `sub_w2x_${suffix}`,
    eventId,
    formVersionId,
    title: `Export talk ${suffix}`,
    category: "workshops",
    status,
    submittedAt: now,
    version: 1,
  });
  await ctx.submissions.insertSpeakers([
    {
      submissionId: `sub_w2x_${suffix}`,
      personId: person.id,
      isPrimary: true,
      sortOrder: 0,
    },
  ]);
  await ctx.submissions.insertAnswers(
    answers.map((a, i) => ({
      id: `ans_w2x_${suffix}_${i}`,
      submissionId: `sub_w2x_${suffix}`,
      fieldKey: a.fieldKey,
      valueJson: JSON.stringify(a.value),
    })),
  );
  return `sub_w2x_${suffix}`;
}

describe("Wave 2 — Submission.ExportCsv", () => {
  it("filters by status, flattens speakers, stable headers, formula-neutralized cells", async () => {
    const admin = await session("admin", "w2-export-admin@example.com");
    const event = await createEvent(admin.app, admin.cookie);

    await seedSubmission(admin, event.id, "acc", "accepted", "fv_w2x", [
      { fieldKey: "abstract", value: "A deep talk" },
      { fieldKey: "track_pref", value: "=HYPERLINK(evil)" },
    ]);
    await seedSubmission(admin, event.id, "sub", "submitted", "fv_w2x", [
      { fieldKey: "abstract", value: "Not exported when filtering accepted" },
    ]);

    const res = await admin.app.request(
      `http://localhost/api/events/${event.id}/submissions/export?status=accepted`,
      { headers: { cookie: admin.cookie, accept: "text/csv" } },
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/csv/);
    expect(res.headers.get("content-disposition")).toContain("submissions-");

    const csv = await res.text();
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(2); // header + 1 accepted row
    expect(lines[0]).toBe(
      "submissionId,title,status,category,submittedAt,primarySpeakerName,primarySpeakerEmail,speakers,abstract,track_pref",
    );
    const row = lines[1]!;
    expect(row).toContain("Export talk acc");
    expect(row).toContain("accepted");
    expect(row).toContain("speaker-w2x-acc@example.com");
    expect(row).toContain("Exporter acc <speaker-w2x-acc@example.com>");
    expect(row).toContain("A deep talk");
    // Formula injection neutralized with a leading apostrophe.
    expect(row).toContain("'=HYPERLINK(evil)");
    expect(row).not.toContain(",=HYPERLINK");
    // The submitted-only row is excluded by the filter.
    expect(csv).not.toContain("Export talk sub");
  });

  it("excludes layout-node field keys from answer columns (Wave 1B law)", async () => {
    const admin = await session("admin", "w2-export-layout@example.com");
    const event = await createEvent(admin.app, admin.cookie);

    // Real published form with a layout section + one input field.
    const formRes = await admin.app.request(
      `http://localhost/api/events/${event.id}/forms`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
          "x-correlation-id": "corr-w2-export-form",
        },
        body: JSON.stringify({ name: "Export CFP" }),
      },
      env,
    );
    expect(formRes.status).toBe(201);
    const formId = ((await formRes.json()) as { form: { id: string } }).form.id;
    const draftRes = await admin.app.request(
      `http://localhost/api/forms/${formId}/draft`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
          "x-correlation-id": "corr-w2-export-draft",
        },
        body: JSON.stringify({
          fields: [
            {
              fieldKey: "layout_about",
              type: "text",
              label: "About you",
              required: false,
              sortOrder: 0,
              nodeKind: "layout",
              layoutType: "section",
            },
            {
              fieldKey: "abstract",
              type: "textarea",
              label: "Abstract",
              required: true,
              sortOrder: 1,
            },
          ],
        }),
      },
      env,
    );
    expect(draftRes.status).toBe(200);
    const pubRes = await admin.app.request(
      `http://localhost/api/forms/${formId}/publish`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: admin.cookie,
          "x-correlation-id": "corr-w2-export-publish",
        },
        body: JSON.stringify({}),
      },
      env,
    );
    expect(pubRes.status).toBe(200);
    const versionId = ((await pubRes.json()) as {
      formVersion: { id: string };
    }).formVersion.id;

    // Legacy/corrupt data: an answer stored under the layout key must still
    // never reach the export.
    await seedSubmission(admin, event.id, "lay", "accepted", versionId, [
      { fieldKey: "abstract", value: "Real answer" },
      { fieldKey: "layout_about", value: "Should never export" },
    ]);

    const res = await admin.app.request(
      `http://localhost/api/events/${event.id}/submissions/export`,
      { headers: { cookie: admin.cookie, accept: "text/csv" } },
      env,
    );
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain("abstract");
    expect(csv).toContain("Real answer");
    expect(csv).not.toContain("layout_about");
    expect(csv).not.toContain("Should never export");
  });

  it("evaluator role cannot export (403)", async () => {
    const admin = await session("admin", "w2-export-admin2@example.com");
    const event = await createEvent(admin.app, admin.cookie);
    const evaluator = await session(
      "evaluator",
      "w2-export-eval@example.com",
      event.id,
      admin.ctx,
    );
    const res = await evaluator.app.request(
      `http://localhost/api/events/${event.id}/submissions/export`,
      { headers: { cookie: evaluator.cookie, accept: "text/csv" } },
      env,
    );
    expect(res.status).toBe(403);
  });
});
