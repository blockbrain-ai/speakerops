/**
 * F7 / P11 programme publish + public read model.
 */
import { describe, it, expect } from "vitest";
import {
  SESSION_COOKIE_NAME,
  PublicProgrammeResponseSchema,
  ProgrammePublishResponseSchema,
  ProgrammeStatusResponseSchema,
} from "@speakerops/shared";
import { createAppWithAuth } from "../../index.js";

const env = { APP_VERSION: "0.1.0" };

async function adminWithEvent(email: string) {
  const ctx = createAppWithAuth({ cookieSecure: true });
  const { app, store, outbox, decisions, submissions } = ctx;
  await app.request(
    "http://localhost/api/auth/magic-link",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, purpose: "admin" }),
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
  const cookie = `${SESSION_COOKIE_NAME}=${sessionValue}`;
  const user = await store.findUserByEmail(email);
  const createRes = await app.request(
    "http://localhost/api/events",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "Public Programme Event",
        timezone: "UTC",
        startsAt: "2026-09-01T09:00:00.000Z",
        endsAt: "2026-09-02T17:00:00.000Z",
      }),
    },
    env,
  );
  expect(createRes.status).toBe(201);
  const body = (await createRes.json()) as {
    event: { id: string; slug: string };
  };
  return {
    app,
    cookie,
    userId: user!.id,
    eventId: body.event.id,
    slug: body.event.slug,
    decisions,
    submissions,
  };
}

describe("F7 programme publication", () => {
  it("unpublished programme is 404 on public route", async () => {
    const { app, slug } = await adminWithEvent("prog-unpub@example.com");
    const res = await app.request(
      `http://localhost/api/public/programme/${slug}`,
      { headers: { accept: "application/json" } },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("admin publish then public programme returns sessions/speakers", async () => {
    const { app, cookie, eventId, slug, decisions, submissions } =
      await adminWithEvent("prog-pub@example.com");

    await submissions.insertPerson({
      id: "person_pub_1",
      orgId: "org_dogfood",
      email: "speaker-pub@example.com",
      name: "Ada Public",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await decisions.insertParticipation({
      id: "part_pub_1",
      eventId,
      personId: "person_pub_1",
      userId: null,
      roleLabel: "Speaker",
      status: "accepted",
      bio: "Hello world bio",
      company: "Signal Co",
      title: "Engineer",
      headshotFileId: null,
      version: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await decisions.insertSession({
      id: "sess_pub_1",
      eventId,
      sourceSubmissionId: null,
      title: "Opening Keynote",
      description: "Welcome talk",
      trackId: null,
      status: "scheduled",
      version: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await decisions.insertSessionSpeaker({
      sessionId: "sess_pub_1",
      participationId: "part_pub_1",
      isPrimary: true,
    });

    const status0 = await app.request(
      `http://localhost/api/events/${eventId}/programme/status`,
      { headers: { cookie, accept: "application/json" } },
      env,
    );
    expect(status0.status).toBe(200);
    expect(ProgrammeStatusResponseSchema.parse(await status0.json()).published).toBe(
      false,
    );

    const pub = await app.request(
      `http://localhost/api/events/${eventId}/programme/publish`,
      { method: "POST", headers: { cookie, accept: "application/json" } },
      env,
    );
    expect(pub.status).toBe(200);
    const pubBody = ProgrammePublishResponseSchema.parse(await pub.json());
    expect(pubBody.sessionCount).toBeGreaterThanOrEqual(1);

    const publicRes = await app.request(
      `http://localhost/api/public/programme/${slug}`,
      { headers: { accept: "application/json" } },
      env,
    );
    expect(publicRes.status).toBe(200);
    const body = PublicProgrammeResponseSchema.parse(await publicRes.json());
    expect(body.event.slug).toBe(slug);
    expect(body.sessions.some((s) => s.title === "Opening Keynote")).toBe(true);
    expect(body.speakers.some((s) => s.name === "Ada Public")).toBe(true);
    // No private email in payload
    expect(JSON.stringify(body)).not.toMatch(/speaker-pub@example.com/);

    // Immutable snapshot: post-publish title change must NOT appear until re-publish.
    await decisions.insertSession({
      id: "sess_pub_2",
      eventId,
      sourceSubmissionId: null,
      title: "Secret Unpublishable Talk",
      description: null,
      trackId: null,
      status: "scheduled",
      version: 1,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    const still = await app.request(
      `http://localhost/api/public/programme/${slug}`,
      { headers: { accept: "application/json" } },
      env,
    );
    const stillBody = PublicProgrammeResponseSchema.parse(await still.json());
    expect(
      stillBody.sessions.some((s) => s.title === "Secret Unpublishable Talk"),
    ).toBe(false);
  });

  it("Bearer events:write can publish; events:read can status; reports-only cannot", async () => {
    const { app, cookie, eventId } = await adminWithEvent(
      "prog-bearer@example.com",
    );

    async function mint(name: string, scopes: string[]) {
      const res = await app.request("http://localhost/api/keys", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({ name, scopes, eventId }),
      }, env);
      expect(res.status).toBe(201);
      return (await res.json()) as { secret: string };
    }

    const writer = await mint("prog-write", ["events:read", "events:write"]);
    const reader = await mint("prog-read", ["events:read"]);
    const reports = await mint("prog-reports", ["reports:read"]);

    const denied = await app.request(
      `http://localhost/api/events/${eventId}/programme/status`,
      {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${reports.secret}`,
        },
      },
      env,
    );
    expect(denied.status).toBe(403);

    const status = await app.request(
      `http://localhost/api/events/${eventId}/programme/status`,
      {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${reader.secret}`,
        },
      },
      env,
    );
    expect(status.status).toBe(200);

    const pubDenied = await app.request(
      `http://localhost/api/events/${eventId}/programme/publish`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${reader.secret}`,
        },
      },
      env,
    );
    expect(pubDenied.status).toBe(403);

    const pub = await app.request(
      `http://localhost/api/events/${eventId}/programme/publish`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${writer.secret}`,
        },
      },
      env,
    );
    expect(pub.status).toBe(200);
    expect(ProgrammePublishResponseSchema.parse(await pub.json()).version).toBeGreaterThan(0);
  });
});
