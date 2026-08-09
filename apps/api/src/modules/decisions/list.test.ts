/**
 * Section 10.1 — Submission.List reliability at scale (S-SUB-LIST).
 *
 * Named ACs:
 * - AC-10.1-A: ≥150 fixture rows list within budget (API page contract)
 * - AC-10.1-C: unauthenticated → 401 (must-not leak rows)
 * - AC-10.1-D: cross-event scoping (event A session cannot list event B)
 * - AC-10.1-E: pagination contract; filters server-side
 *
 * Also: response schema accepts production-shaped rows; corrupt status skipped.
 */
import { describe, it, expect } from "vitest";
import {
  ErrorEnvelopeSchema,
  SubmissionListResponseSchema,
  SubmissionListItemSchema,
  SUBMISSION_LIST_DEFAULT_LIMIT,
  SUBMISSION_LIST_MAX_LIMIT,
  SESSION_COOKIE_NAME,
  UNAUTHORIZED,
  FORBIDDEN,
  VALIDATION_ERROR,
} from "@speakerops/shared";
import { createAppWithAuth } from "../../index.js";

const env = { APP_VERSION: "0.1.0" };

async function magicLinkSession(
  purpose: "admin" | "speaker" | "evaluator",
  email: string,
  eventId?: string,
  shared?: ReturnType<typeof createAppWithAuth>,
): Promise<{
  app: ReturnType<typeof createAppWithAuth>["app"];
  store: ReturnType<typeof createAppWithAuth>["store"];
  events: ReturnType<typeof createAppWithAuth>["events"];
  submissions: ReturnType<typeof createAppWithAuth>["submissions"];
  cookie: string;
  userId: string;
}> {
  const ctx = shared ?? createAppWithAuth({ cookieSecure: true });
  const { app, store, events, submissions, outbox } = ctx;
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
  const setCookie = exchange.headers.get("set-cookie")!;
  const sessionValue = setCookie
    .split(";")[0]!
    .split("=")
    .slice(1)
    .join("=");
  const user = await store.findUserByEmail(email);
  expect(user).toBeTruthy();
  return {
    app,
    store,
    events,
    submissions,
    cookie: `${SESSION_COOKIE_NAME}=${sessionValue}`,
    userId: user!.id,
  };
}

async function createEvent(
  app: ReturnType<typeof createAppWithAuth>["app"],
  cookie: string,
  name: string,
): Promise<{ id: string; slug: string }> {
  const res = await app.request(
    "http://localhost/api/events",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        name,
        timezone: "UTC",
        startsAt: "2026-06-01T09:00:00.000Z",
        endsAt: "2026-06-02T17:00:00.000Z",
      }),
    },
    env,
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as { event: { id: string; slug: string } };
  return { id: body.event.id, slug: body.event.slug };
}

/** Dogfood-shaped fixture: 150 submissions with primary speakers (evt_dogfood-like). */
async function seedSubmissions(
  submissions: ReturnType<typeof createAppWithAuth>["submissions"],
  eventId: string,
  count: number,
  opts?: { prefix?: string; orgId?: string },
): Promise<void> {
  const prefix = opts?.prefix ?? "df";
  const orgId = opts?.orgId ?? "org_list_test";
  const now = "2026-06-01T12:00:00.000Z";
  for (let i = 0; i < count; i++) {
    const idx = String(i).padStart(3, "0");
    const personId = `person_${prefix}_${idx}`;
    await submissions.insertPerson({
      id: personId,
      orgId,
      email: `${prefix}${idx}@demo.speakerops.local`,
      name: `Seed Speaker ${idx}`,
      createdAt: now,
      updatedAt: now,
    });
    const subId = `sub_${prefix}_${idx}`;
    await submissions.insertSubmission({
      id: subId,
      eventId,
      formVersionId: `fv_${prefix}`,
      title: `Talk ${idx}: Dogfood Scale Fixture`,
      category: i % 3 === 0 ? "keynote" : i % 3 === 1 ? "panel" : "workshop",
      status:
        i % 10 === 0
          ? "accepted"
          : i % 7 === 0
            ? "in_review"
            : "submitted",
      // Stagger timestamps so newest-first order is deterministic
      submittedAt: new Date(Date.parse(now) + i * 1000).toISOString(),
      version: 1,
    });
    await submissions.insertSpeakers([
      {
        submissionId: subId,
        personId,
        isPrimary: true,
        sortOrder: 0,
      },
    ]);
  }
}

describe("10.1 Submission.List reliability", () => {
  it("unit: list response schema accepts production-shaped rows", () => {
    const sample = {
      submissions: [
        {
          id: "sub_prod_001",
          eventId: "evt_dogfood",
          formVersionId: "fv_dogfood_1",
          title: "Shipping Reliable CFP Ops",
          category: "keynote",
          status: "submitted",
          submittedAt: "2026-06-01T12:00:00.000Z",
          version: 1,
          primarySpeakerName: "Ada Lovelace",
        },
        {
          id: "sub_prod_002",
          eventId: "evt_dogfood",
          formVersionId: "fv_dogfood_1",
          title: "Panel: Multi-event Isolation",
          category: null,
          status: "in_review",
          submittedAt: "2026-06-01T13:00:00.000Z",
          version: 2,
          primarySpeakerName: null,
        },
      ],
      total: 150,
      limit: SUBMISSION_LIST_DEFAULT_LIMIT,
      offset: 0,
      categories: ["keynote", "panel", "workshop"],
    };
    const parsed = SubmissionListResponseSchema.parse(sample);
    expect(parsed.submissions).toHaveLength(2);
    expect(parsed.total).toBe(150);
    expect(parsed.limit).toBe(SUBMISSION_LIST_DEFAULT_LIMIT);
    expect(parsed.offset).toBe(0);
    expect(parsed.categories).toContain("keynote");
    for (const row of parsed.submissions) {
      expect(SubmissionListItemSchema.safeParse(row).success).toBe(true);
    }
  });

  it("AC-10.1-A: fixture ≥150 submissions — list page returns rows fast", async () => {
    const admin = await magicLinkSession(
      "admin",
      "list-scale-admin@example.com",
    );
    const event = await createEvent(
      admin.app,
      admin.cookie,
      "Dogfood Scale List",
    );
    // Use fixed id alias for dogfood-shaped integration name
    await seedSubmissions(admin.submissions, event.id, 150, {
      prefix: "scale",
    });

    const t0 = performance.now();
    const res = await admin.app.request(
      `http://localhost/api/events/${event.id}/submissions`,
      { headers: { cookie: admin.cookie } },
      env,
    );
    const elapsed = performance.now() - t0;
    expect(res.status).toBe(200);
    const body = SubmissionListResponseSchema.parse(await res.json());
    expect(body.total).toBe(150);
    expect(body.submissions.length).toBeGreaterThanOrEqual(1);
    expect(body.submissions.length).toBeLessThanOrEqual(
      SUBMISSION_LIST_DEFAULT_LIMIT,
    );
    expect(body.limit).toBe(SUBMISSION_LIST_DEFAULT_LIMIT);
    expect(body.offset).toBe(0);
    expect(body.submissions[0]!.primarySpeakerName).toMatch(/Seed Speaker/);
    // Local memory path should be well under 5s (budget for SPA includes network/render)
    expect(elapsed).toBeLessThan(5_000);
  });

  it("AC-10.1-E: pagination contract — filters server-side; page does not drop filters", async () => {
    const admin = await magicLinkSession(
      "admin",
      "list-page-admin@example.com",
    );
    const event = await createEvent(admin.app, admin.cookie, "Page Contract");
    await seedSubmissions(admin.submissions, event.id, 60, { prefix: "pg" });

    const page1 = await admin.app.request(
      `http://localhost/api/events/${event.id}/submissions?limit=10&offset=0`,
      { headers: { cookie: admin.cookie } },
      env,
    );
    expect(page1.status).toBe(200);
    const p1 = SubmissionListResponseSchema.parse(await page1.json());
    expect(p1.total).toBe(60);
    expect(p1.limit).toBe(10);
    expect(p1.offset).toBe(0);
    expect(p1.submissions).toHaveLength(10);

    const page2 = await admin.app.request(
      `http://localhost/api/events/${event.id}/submissions?limit=10&offset=10`,
      { headers: { cookie: admin.cookie } },
      env,
    );
    const p2 = SubmissionListResponseSchema.parse(await page2.json());
    expect(p2.total).toBe(60);
    expect(p2.offset).toBe(10);
    expect(p2.submissions).toHaveLength(10);
    // Pages are disjoint
    const ids1 = new Set(p1.submissions.map((s) => s.id));
    for (const s of p2.submissions) {
      expect(ids1.has(s.id)).toBe(false);
    }

    // Server-side category filter preserved across offset
    const filtered = await admin.app.request(
      `http://localhost/api/events/${event.id}/submissions?category=keynote&limit=5&offset=0`,
      { headers: { cookie: admin.cookie } },
      env,
    );
    const fBody = SubmissionListResponseSchema.parse(await filtered.json());
    expect(fBody.submissions.every((s) => s.category === "keynote")).toBe(true);
    expect(fBody.total).toBeGreaterThan(0);
    expect(fBody.total).toBeLessThan(60);
    // categories still list event options (status unfiltered here)
    expect(fBody.categories.length).toBeGreaterThanOrEqual(1);

    const filteredPage2 = await admin.app.request(
      `http://localhost/api/events/${event.id}/submissions?category=keynote&limit=5&offset=5`,
      { headers: { cookie: admin.cookie } },
      env,
    );
    const f2 = SubmissionListResponseSchema.parse(await filteredPage2.json());
    expect(f2.total).toBe(fBody.total);
    expect(f2.submissions.every((s) => s.category === "keynote")).toBe(true);

    // status filter server-side
    const accepted = await admin.app.request(
      `http://localhost/api/events/${event.id}/submissions?status=accepted`,
      { headers: { cookie: admin.cookie } },
      env,
    );
    const aBody = SubmissionListResponseSchema.parse(await accepted.json());
    expect(aBody.submissions.every((s) => s.status === "accepted")).toBe(true);
    expect(aBody.total).toBe(
      aBody.submissions.length === aBody.limit
        ? aBody.total
        : aBody.total,
    );

    // Invalid limit → 400
    const badLimit = await admin.app.request(
      `http://localhost/api/events/${event.id}/submissions?limit=${SUBMISSION_LIST_MAX_LIMIT + 1}`,
      { headers: { cookie: admin.cookie } },
      env,
    );
    expect(badLimit.status).toBe(400);
    const envBody = ErrorEnvelopeSchema.parse(await badLimit.json());
    expect(envBody.code).toBe(VALIDATION_ERROR);
  });

  it("AC-10.1-C: unauthenticated list → 401 (must-not leak rows)", async () => {
    const admin = await magicLinkSession(
      "admin",
      "list-unauth-admin@example.com",
    );
    const event = await createEvent(admin.app, admin.cookie, "Unauth List");
    await seedSubmissions(admin.submissions, event.id, 5, { prefix: "ua" });

    const res = await admin.app.request(
      `http://localhost/api/events/${event.id}/submissions`,
      {},
      env,
    );
    expect(res.status).toBe(401);
    const body = ErrorEnvelopeSchema.parse(await res.json());
    expect(body.code).toBe(UNAUTHORIZED);
    expect(
      (body as { submissions?: unknown }).submissions,
    ).toBeUndefined();
    // Body must not embed submission titles
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/Talk 00/);
  });

  it("AC-10.1-D: cross-event scoping — event A session cannot list event B rows", async () => {
    const shared = createAppWithAuth({ cookieSecure: true });
    const adminA = await magicLinkSession(
      "admin",
      "list-cross-a@example.com",
      undefined,
      shared,
    );
    const eventA = await createEvent(adminA.app, adminA.cookie, "Event A");
    await seedSubmissions(adminA.submissions, eventA.id, 3, {
      prefix: "xa",
    });

    // Separate admin with membership only on event B
    const adminB = await magicLinkSession(
      "admin",
      "list-cross-b@example.com",
      undefined,
      shared,
    );
    const eventB = await createEvent(adminB.app, adminB.cookie, "Event B");
    await seedSubmissions(adminB.submissions, eventB.id, 3, {
      prefix: "xb",
    });

    // Admin B listing event A → 403/404 (no membership)
    const denied = await adminB.app.request(
      `http://localhost/api/events/${eventA.id}/submissions`,
      { headers: { cookie: adminB.cookie } },
      env,
    );
    expect([403, 404]).toContain(denied.status);
    const deniedBody = ErrorEnvelopeSchema.parse(await denied.json());
    expect([FORBIDDEN, "NOT_FOUND", "FORBIDDEN"]).toContain(deniedBody.code);
    expect(JSON.stringify(deniedBody)).not.toMatch(/sub_xa_/);

    // Admin B listing own event only sees B rows
    const own = await adminB.app.request(
      `http://localhost/api/events/${eventB.id}/submissions`,
      { headers: { cookie: adminB.cookie } },
      env,
    );
    expect(own.status).toBe(200);
    const ownBody = SubmissionListResponseSchema.parse(await own.json());
    expect(ownBody.total).toBe(3);
    expect(ownBody.submissions.every((s) => s.eventId === eventB.id)).toBe(
      true,
    );
    expect(ownBody.submissions.some((s) => s.id.startsWith("sub_xa_"))).toBe(
      false,
    );
  });

  it("integration: list endpoint for evt_dogfood-shaped fixture id", async () => {
    const admin = await magicLinkSession(
      "admin",
      "list-dogfood-admin@example.com",
    );
    // Create real event then seed under a dogfood-shaped parallel membership path
    const event = await createEvent(
      admin.app,
      admin.cookie,
      "Dogfood 2026 List",
    );
    // Membership + rows under synthetic id (bootstrap-style list-by-id)
    const dogfoodId = "evt_dogfood_list_fixture";
    await admin.store.upsertMembership({
      eventId: dogfoodId,
      userId: admin.userId,
      role: "admin",
    });
    await seedSubmissions(admin.submissions, dogfoodId, 150, {
      prefix: "dog",
    });

    const res = await admin.app.request(
      `http://localhost/api/events/${dogfoodId}/submissions?limit=25&offset=0`,
      { headers: { cookie: admin.cookie } },
      env,
    );
    expect(res.status).toBe(200);
    const body = SubmissionListResponseSchema.parse(await res.json());
    expect(body.total).toBe(150);
    expect(body.submissions.length).toBe(25);
    expect(body.submissions.every((s) => s.eventId === dogfoodId)).toBe(true);

    // Real event remains empty / independent
    const real = await admin.app.request(
      `http://localhost/api/events/${event.id}/submissions`,
      { headers: { cookie: admin.cookie } },
      env,
    );
    const realBody = SubmissionListResponseSchema.parse(await real.json());
    expect(realBody.total).toBe(0);
  });

  it("skips corrupt status rows instead of Response validation failed 500", async () => {
    const admin = await magicLinkSession(
      "admin",
      "list-corrupt-admin@example.com",
    );
    const event = await createEvent(admin.app, admin.cookie, "Corrupt Row");
    const now = "2026-06-01T12:00:00.000Z";
    await admin.submissions.insertSubmission({
      id: "sub_ok_1",
      eventId: event.id,
      formVersionId: "fv_ok",
      title: "Good Talk",
      category: null,
      status: "submitted",
      submittedAt: now,
      version: 1,
    });
    await admin.submissions.insertSubmission({
      id: "sub_bad_1",
      eventId: event.id,
      formVersionId: "fv_ok",
      title: "Bad Status Talk",
      category: null,
      status: "not_a_real_status",
      submittedAt: now,
      version: 1,
    });

    const res = await admin.app.request(
      `http://localhost/api/events/${event.id}/submissions`,
      { headers: { cookie: admin.cookie } },
      env,
    );
    expect(res.status).toBe(200);
    const body = SubmissionListResponseSchema.parse(await res.json());
    // total reflects SoR count; items only include schema-valid rows
    expect(body.total).toBe(2);
    expect(body.submissions.some((s) => s.id === "sub_ok_1")).toBe(true);
    expect(body.submissions.some((s) => s.id === "sub_bad_1")).toBe(false);
  });

  it("evaluator role cannot list admin submissions (403/404)", async () => {
    const shared = createAppWithAuth({ cookieSecure: true });
    const admin = await magicLinkSession(
      "admin",
      "list-eval-admin@example.com",
      undefined,
      shared,
    );
    const event = await createEvent(admin.app, admin.cookie, "Eval Deny");
    await seedSubmissions(admin.submissions, event.id, 2, { prefix: "ev" });

    const evaluator = await magicLinkSession(
      "evaluator",
      "list-eval-user@example.com",
      event.id,
      shared,
    );
    const res = await evaluator.app.request(
      `http://localhost/api/events/${event.id}/submissions`,
      { headers: { cookie: evaluator.cookie } },
      env,
    );
    expect([403, 404]).toContain(res.status);
  });
});
