/**
 * F3 saved views + server sort allowlist.
 */
import { describe, it, expect } from "vitest";
import {
  SESSION_COOKIE_NAME,
  SavedViewListResponseSchema,
  SavedViewResponseSchema,
  sanitizeGridDefinition,
  SUBMISSIONS_GRID_FIELDS,
  SAVED_VIEWS_MAX_PER_SCOPE,
  ErrorEnvelopeSchema,
  SubmissionListResponseSchema,
} from "@speakerops/shared";
import { createAppWithAuth } from "../../index.js";
import {
  MemorySavedViewsStore,
  type SavedViewRow,
} from "./store.js";
import {
  createSavedView,
  listSavedViews,
  updateSavedView,
  deleteSavedView,
} from "./commands.js";

const env = { APP_VERSION: "0.1.0" };

async function adminWithEvent(email: string) {
  const ctx = createAppWithAuth({ cookieSecure: true });
  const { app, store, outbox } = ctx;
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
  expect(user).toBeTruthy();

  const createRes = await app.request(
    "http://localhost/api/events",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        name: "F3 Grid Event",
        timezone: "UTC",
        startsAt: "2026-06-01T09:00:00.000Z",
        endsAt: "2026-06-02T17:00:00.000Z",
      }),
    },
    env,
  );
  expect(createRes.status).toBe(201);
  const body = (await createRes.json()) as { event: { id: string } };
  return {
    app,
    store,
    cookie,
    userId: user!.id,
    eventId: body.event.id,
  };
}

describe("sanitizeGridDefinition", () => {
  it("drops unknown columns gracefully", () => {
    const { definition, dropped } = sanitizeGridDefinition({
      columns: ["title", "evil_sql", "status"],
      columnOrder: ["evil_sql", "title", "status"],
      density: "compact",
      sort: { field: "title", dir: "asc" },
    });
    expect(dropped).toContain("evil_sql");
    expect(definition.columns).toEqual(["title", "status"]);
    expect(definition.columnOrder[0]).toBe("title");
    expect(definition.density).toBe("compact");
  });

  it("falls back to defaults when empty", () => {
    const { definition } = sanitizeGridDefinition({ columns: [] });
    expect(definition.columns.length).toBeGreaterThan(0);
    expect(definition.columns).toContain("title");
  });

  it("dedupes columns and clips oversized filters", () => {
    const { definition, dropped } = sanitizeGridDefinition({
      columns: ["title", "title", "status"],
      columnOrder: ["title", "status", "title"],
      status: "x".repeat(100),
      category: "  cat  ",
      qPrefix: "q".repeat(300),
    });
    expect(definition.columns).toEqual(["title", "status"]);
    expect(dropped.some((d) => d.includes("dup:"))).toBe(true);
    expect(definition.status?.length).toBe(64);
    expect(definition.category).toBe("cat");
    expect(definition.qPrefix?.length).toBe(200);
  });
});

describe("MemorySavedViewsStore invariants", () => {
  it("enforces name uniqueness (case-insensitive), cap, version CAS, ownership", async () => {
    const store = new MemorySavedViewsStore();
    const base: Omit<SavedViewRow, "id" | "name"> = {
      userId: "u1",
      eventId: "e1",
      surface: "submissions",
      definitionJson: JSON.stringify({
        columns: ["title"],
        columnOrder: ["title"],
        density: "comfortable",
      }),
      isDefault: 0,
      version: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(await store.insert({ ...base, id: "a", name: "Mine" })).toBe("ok");
    expect(await store.insert({ ...base, id: "b", name: "mine" })).toBe(
      "name_conflict",
    );

    for (let i = 0; i < SAVED_VIEWS_MAX_PER_SCOPE - 1; i++) {
      const r = await store.insert({
        ...base,
        id: `c${i}`,
        name: `View ${i}`,
      });
      expect(r).toBe("ok");
    }
    expect(
      await store.insert({ ...base, id: "over", name: "Over" }),
    ).toBe("cap");

    const scope = { userId: "u1", eventId: "e1", surface: "submissions" };
    expect(
      await store.update("a", scope, {
        name: "Renamed",
        expectedVersion: 99,
        updatedAt: "2026-01-02T00:00:00.000Z",
      }),
    ).toBe("version");
    expect(
      await store.update("a", scope, {
        name: "Renamed",
        expectedVersion: 1,
        updatedAt: "2026-01-02T00:00:00.000Z",
      }),
    ).toBe("ok");
    const after = await store.findById("a");
    expect(after?.version).toBe(2);
    expect(after?.name).toBe("Renamed");

    // Cross-scope delete must fail.
    expect(
      await store.delete("a", {
        userId: "other",
        eventId: "e1",
        surface: "submissions",
      }),
    ).toBe(false);
    expect(
      await store.delete("a", {
        userId: "u1",
        eventId: "other-event",
        surface: "submissions",
      }),
    ).toBe(false);
    expect(await store.delete("a", scope)).toBe(true);
  });

  it("exactly one default per scope", async () => {
    const store = new MemorySavedViewsStore();
    const now = "2026-01-01T00:00:00.000Z";
    const def = JSON.stringify({
      columns: ["title"],
      columnOrder: ["title"],
      density: "comfortable",
    });
    await store.insert({
      id: "d1",
      userId: "u1",
      eventId: "e1",
      surface: "submissions",
      name: "A",
      definitionJson: def,
      isDefault: 1,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    await store.insert({
      id: "d2",
      userId: "u1",
      eventId: "e1",
      surface: "submissions",
      name: "B",
      definitionJson: def,
      isDefault: 1,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    const list = await store.listForScope({
      userId: "u1",
      eventId: "e1",
      surface: "submissions",
    });
    expect(list.filter((r) => r.isDefault === 1)).toHaveLength(1);
    expect(list.find((r) => r.isDefault === 1)?.id).toBe("d2");
  });
});

describe("saved views commands", () => {
  it("create / list / update / delete round-trip", async () => {
    const store = new MemorySavedViewsStore();
    const created = await createSavedView(store, {
      userId: "u1",
      eventId: "e1",
      surface: "submissions",
      name: "Review queue",
      definition: {
        columns: [...SUBMISSIONS_GRID_FIELDS],
        columnOrder: [...SUBMISSIONS_GRID_FIELDS],
        density: "compact",
        sort: { field: "submittedAt", dir: "desc" },
        status: "in_review",
      },
      isDefault: true,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.view.isDefault).toBe(true);

    const listed = await listSavedViews(store, {
      userId: "u1",
      eventId: "e1",
      surface: "submissions",
    });
    expect(listed.ok && listed.value.views).toHaveLength(1);

    const updated = await updateSavedView(store, {
      id: created.value.view.id,
      userId: "u1",
      eventId: "e1",
      surface: "submissions",
      name: "In review",
      expectedVersion: created.value.view.version,
    });
    expect(updated.ok).toBe(true);

    const denied = await updateSavedView(store, {
      id: created.value.view.id,
      userId: "other",
      eventId: "e1",
      surface: "submissions",
      name: "Hack",
      expectedVersion: 2,
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.status).toBe(404);

    const crossEvent = await updateSavedView(store, {
      id: created.value.view.id,
      userId: "u1",
      eventId: "e2",
      surface: "submissions",
      name: "Hack",
      expectedVersion: 2,
    });
    expect(crossEvent.ok).toBe(false);

    const blank = await updateSavedView(store, {
      id: created.value.view.id,
      userId: "u1",
      eventId: "e1",
      surface: "submissions",
      name: "   ",
      expectedVersion: 2,
    });
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.status).toBe(400);

    const del = await deleteSavedView(store, {
      id: created.value.view.id,
      userId: "u1",
      eventId: "e1",
      surface: "submissions",
    });
    expect(del.ok).toBe(true);
  });
});

describe("saved views HTTP + submission sort", () => {
  it("CRUD via routes", async () => {
    const { app, cookie, eventId } = await adminWithEvent(
      "f3-views@example.com",
    );
    const list0 = await app.request(
      `http://localhost/api/events/${eventId}/saved-views?surface=submissions`,
      { headers: { cookie, accept: "application/json" } },
      env,
    );
    expect(list0.status).toBe(200);
    const empty = SavedViewListResponseSchema.parse(await list0.json());
    expect(empty.views).toEqual([]);

    const createRes = await app.request(
      `http://localhost/api/events/${eventId}/saved-views?surface=submissions`,
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          name: "HTTP view",
          definition: {
            columns: ["title", "status", "submittedAt"],
            columnOrder: ["title", "status", "submittedAt"],
            density: "comfortable",
            sort: { field: "title", dir: "asc" },
          },
          isDefault: true,
        }),
      },
      env,
    );
    expect(createRes.status).toBe(201);
    const created = SavedViewResponseSchema.parse(await createRes.json());
    expect(created.view.name).toBe("HTTP view");
    expect(created.view.isDefault).toBe(true);

    const badSurface = await app.request(
      `http://localhost/api/events/${eventId}/saved-views?surface=not_a_surface`,
      { headers: { cookie, accept: "application/json" } },
      env,
    );
    expect(badSurface.status).toBe(400);

    const patch = await app.request(
      `http://localhost/api/events/${eventId}/saved-views/${created.view.id}`,
      {
        method: "PATCH",
        headers: {
          cookie,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          name: "HTTP view 2",
          expectedVersion: created.view.version,
        }),
      },
      env,
    );
    expect(patch.status).toBe(200);

    const del = await app.request(
      `http://localhost/api/events/${eventId}/saved-views/${created.view.id}`,
      {
        method: "DELETE",
        headers: { cookie, accept: "application/json" },
      },
      env,
    );
    expect(del.status).toBe(200);
  });

  it("submission list rejects unknown sort field", async () => {
    const { app, cookie, eventId } = await adminWithEvent(
      "f3-sort@example.com",
    );
    const res = await app.request(
      `http://localhost/api/events/${eventId}/submissions?sort=not_a_field`,
      { headers: { cookie, accept: "application/json" } },
      env,
    );
    expect(res.status).toBe(400);
    const envp = ErrorEnvelopeSchema.parse(await res.json());
    expect(envp.code).toBeTruthy();
  });

  it("submission list accepts allowlisted sort", async () => {
    const { app, cookie, eventId } = await adminWithEvent(
      "f3-sort-ok@example.com",
    );
    const res = await app.request(
      `http://localhost/api/events/${eventId}/submissions?sort=title&sortDir=asc`,
      { headers: { cookie, accept: "application/json" } },
      env,
    );
    expect(res.status).toBe(200);
    const body = SubmissionListResponseSchema.parse(await res.json());
    expect(body.submissions).toEqual([]);
    expect(body.total).toBe(0);
  });
});
