/**
 * Section 7.1 — API keys mint/revoke + hashed secrets + scopes (Vitest).
 *
 * Named assertions from spec:
 * - assert secret returned once only on create
 * - assert list endpoints never include full secret
 * - assert revoked key 401 on API call
 * - Zod 400 / unauth 401 / wrong role 403 / OpenAPI commands
 * - Hash only stored; audit_events with correlationId
 * - Default-deny scopes not auto-granted
 */
import { describe, it, expect } from "vitest";
import {
  ErrorEnvelopeSchema,
  KeysCreateResponseSchema,
  KeysListResponseSchema,
  KeysRevokeResponseSchema,
  VALIDATION_ERROR,
  UNAUTHORIZED,
  FORBIDDEN,
  NOT_FOUND,
  SESSION_COOKIE_NAME,
  DEFAULT_DENY_SCOPES,
  DEFAULT_DENY_SCOPE_SET,
} from "@speakerops/shared";
import { createAppWithAuth } from "../../index.js";
import { OPENAPI_COMMANDS } from "../../openapi.js";
import { hashToken } from "../auth/crypto.js";

const env = { APP_VERSION: "0.1.0" };

async function magicLinkSession(
  purpose: "admin" | "speaker" | "evaluator",
  email: string,
) {
  const ctx = createAppWithAuth({ cookieSecure: true });
  const { app, store, keys, outbox } = ctx;
  const body: Record<string, string> = { email, purpose };

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
    keys,
    outbox,
    cookie: `${SESSION_COOKIE_NAME}=${sessionValue}`,
    userId: user!.id,
    ctx,
  };
}

describe("7.1 API keys", () => {
  it("assert secret returned once only on create", async () => {
    const { app, cookie, keys } = await magicLinkSession(
      "admin",
      "keys-create@example.com",
    );

    const create = await app.request(
      "http://localhost/api/keys",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": "corr-keys-create-1",
        },
        body: JSON.stringify({
          name: "CLI read",
          scopes: ["events:read", "reports:read"],
        }),
      },
      env,
    );
    expect(create.status).toBe(201);
    const body = KeysCreateResponseSchema.parse(await create.json());
    expect(body.secret).toMatch(/^spk_[0-9a-f]{8}_/);
    expect(body.prefix).toMatch(/^spk_[0-9a-f]{8}$/);
    expect(body.secret.startsWith(body.prefix)).toBe(true);
    expect(body.scopes).toEqual(["events:read", "reports:read"]);

    // Hash only stored — never plaintext secret
    const row = await keys.findById(body.id);
    expect(row).toBeTruthy();
    expect(row!.keyHash).toBe(await hashToken(body.secret));
    expect(row!.keyHash).not.toBe(body.secret);
    expect(JSON.stringify(row)).not.toContain(body.secret);

    // List never re-returns secret
    const list = await app.request(
      "http://localhost/api/keys",
      { headers: { cookie } },
      env,
    );
    expect(list.status).toBe(200);
    const listed = KeysListResponseSchema.parse(await list.json());
    const found = listed.keys.find((k) => k.id === body.id);
    expect(found).toBeTruthy();
    expect(found!.prefix).toBe(body.prefix);
    expect(JSON.stringify(listed)).not.toContain(body.secret);
    expect((found as { secret?: string }).secret).toBeUndefined();
    expect((found as { keyHash?: string }).keyHash).toBeUndefined();
  });

  it("assert list endpoints never include full secret", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "keys-list@example.com",
    );

    const create = await app.request(
      "http://localhost/api/keys",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          name: "list-check",
          scopes: ["design:read"],
        }),
      },
      env,
    );
    const created = KeysCreateResponseSchema.parse(await create.json());

    const list = await app.request(
      "http://localhost/api/keys",
      { headers: { cookie } },
      env,
    );
    const text = await list.text();
    expect(text).not.toContain(created.secret);
    expect(text).not.toMatch(/"keyHash"/i);
    expect(text).not.toMatch(/"key_hash"/i);
    expect(text).not.toMatch(/"secret"/);
    const listed = KeysListResponseSchema.parse(JSON.parse(text));
    expect(listed.keys.every((k) => k.prefix.length > 0)).toBe(true);
  });

  it("a row without created_at still lists (fallback ISO — never 500)", async () => {
    const { app, keys, cookie, userId } = await magicLinkSession(
      "admin",
      "keys-legacy-created@example.com",
    );
    const {
      DEFAULT_ORG_ID,
      DEFAULT_BOOTSTRAP_EVENT_ID,
      API_KEY_CREATED_AT_FALLBACK,
    } = await import("@speakerops/shared");
    // Pre-0022-backfill shape: created_at missing (empty out of the store)
    await keys.insertKey({
      id: "key_legacy_created",
      orgId: DEFAULT_ORG_ID,
      name: "legacy-no-created-at",
      keyPrefix: "spk_1e9a0000",
      keyHash: await hashToken("spk_1e9a0000_legacycreatedatsecret"),
      scopesJson: JSON.stringify(["events:read"]),
      eventId: DEFAULT_BOOTSTRAP_EVENT_ID,
      expiresAt: null,
      revokedAt: null,
      createdBy: userId,
      createdAt: "",
      lastUsedAt: null,
    });

    const list = await app.request(
      "http://localhost/api/keys",
      { headers: { cookie } },
      env,
    );
    expect(list.status).toBe(200);
    const listed = KeysListResponseSchema.parse(await list.json());
    const legacy = listed.keys.find((k) => k.id === "key_legacy_created");
    expect(legacy).toBeTruthy();
    expect(legacy!.createdAt).toBe(API_KEY_CREATED_AT_FALLBACK);
  });

  it("assert revoked key 401 on API call", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "keys-revoke@example.com",
    );

    // Explicitly grant keys:admin so the key can call Keys.List
    const create = await app.request(
      "http://localhost/api/keys",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          name: "agent-admin",
          scopes: ["keys:admin", "events:read"],
        }),
      },
      env,
    );
    expect(create.status).toBe(201);
    const created = KeysCreateResponseSchema.parse(await create.json());

    // Bearer works before revoke
    const okList = await app.request(
      "http://localhost/api/keys",
      {
        headers: { authorization: `Bearer ${created.secret}` },
      },
      env,
    );
    expect(okList.status).toBe(200);

    // Revoke via admin session
    const rev = await app.request(
      `http://localhost/api/keys/${created.id}`,
      {
        method: "DELETE",
        headers: { cookie },
      },
      env,
    );
    expect(rev.status).toBe(200);
    KeysRevokeResponseSchema.parse(await rev.json());

    // Same bearer now 401
    const denied = await app.request(
      "http://localhost/api/keys",
      {
        headers: { authorization: `Bearer ${created.secret}` },
      },
      env,
    );
    expect(denied.status).toBe(401);
    const err = ErrorEnvelopeSchema.parse(await denied.json());
    expect(err.code).toBe(UNAUTHORIZED);
  });

  it("assert expired key 401 on API call (bearer auth honors expiresAt)", async () => {
    const { app, keys, userId } = await magicLinkSession(
      "admin",
      "keys-expired@example.com",
    );
    const { DEFAULT_ORG_ID, DEFAULT_BOOTSTRAP_EVENT_ID } = await import(
      "@speakerops/shared"
    );

    const insertBearerKey = async (
      id: string,
      secret: string,
      expiresAt: string | null,
    ) => {
      await keys.insertKey({
        id,
        orgId: DEFAULT_ORG_ID,
        name: id,
        keyPrefix: secret.slice(0, 12),
        keyHash: await hashToken(secret),
        scopesJson: JSON.stringify(["keys:admin"]),
        eventId: DEFAULT_BOOTSTRAP_EVENT_ID,
        expiresAt,
        revokedAt: null,
        createdBy: userId,
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
      });
    };

    // Control: identical key without expiry authenticates (proves the 401
    // below is caused by expiry, not by the fixture shape).
    const liveSecret = "spk_11aa22bb_expirycontrolsecret000000";
    await insertBearerKey("key_expiry_control", liveSecret, null);
    const ok = await app.request(
      "http://localhost/api/keys",
      { headers: { authorization: `Bearer ${liveSecret}` } },
      env,
    );
    expect(ok.status).toBe(200);

    // Expired key (expiresAt in the past) must be rejected with 401.
    const expiredSecret = "spk_33cc44dd_expiredbearersecret00000";
    await insertBearerKey(
      "key_expiry_expired",
      expiredSecret,
      new Date(Date.now() - 60_000).toISOString(),
    );
    const denied = await app.request(
      "http://localhost/api/keys",
      { headers: { authorization: `Bearer ${expiredSecret}` } },
      env,
    );
    expect(denied.status).toBe(401);
    expect(ErrorEnvelopeSchema.parse(await denied.json()).code).toBe(
      UNAUTHORIZED,
    );
  });

  it("default-deny scopes not auto-granted on create", async () => {
    const { app, cookie, keys } = await magicLinkSession(
      "admin",
      "keys-deny@example.com",
    );

    const create = await app.request(
      "http://localhost/api/keys",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          name: "safe-only",
          scopes: ["events:read", "reports:read"],
        }),
      },
      env,
    );
    const body = KeysCreateResponseSchema.parse(await create.json());
    for (const d of DEFAULT_DENY_SCOPES) {
      expect(body.scopes).not.toContain(d);
    }
    const row = await keys.findById(body.id);
    const stored = JSON.parse(row!.scopesJson) as string[];
    for (const d of DEFAULT_DENY_SCOPES) {
      expect(stored).not.toContain(d);
      expect(DEFAULT_DENY_SCOPE_SET.has(d)).toBe(true);
    }

    // Bearer without keys:admin cannot list keys
    const list = await app.request(
      "http://localhost/api/keys",
      {
        headers: { authorization: `Bearer ${body.secret}` },
      },
      env,
    );
    expect(list.status).toBe(403);
    expect(ErrorEnvelopeSchema.parse(await list.json()).code).toBe(FORBIDDEN);
  });

  it("explicit keys:admin grant works when requested", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "keys-explicit-admin@example.com",
    );
    const create = await app.request(
      "http://localhost/api/keys",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          name: "with-admin",
          scopes: ["keys:admin"],
        }),
      },
      env,
    );
    const body = KeysCreateResponseSchema.parse(await create.json());
    expect(body.scopes).toContain("keys:admin");
  });

  it("unauthenticated access returns 401", async () => {
    const { app } = createAppWithAuth({ cookieSecure: true });
    const list = await app.request("http://localhost/api/keys", {}, env);
    expect(list.status).toBe(401);
    expect(ErrorEnvelopeSchema.parse(await list.json()).code).toBe(
      UNAUTHORIZED,
    );

    const create = await app.request(
      "http://localhost/api/keys",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "x", scopes: ["events:read"] }),
      },
      env,
    );
    expect(create.status).toBe(401);
  });

  it("wrong role returns 403", async () => {
    const { app, cookie } = await magicLinkSession(
      "speaker",
      "keys-speaker@example.com",
    );
    const list = await app.request(
      "http://localhost/api/keys",
      { headers: { cookie } },
      env,
    );
    expect(list.status).toBe(403);
    expect(ErrorEnvelopeSchema.parse(await list.json()).code).toBe(FORBIDDEN);
  });

  it("validation error returns 400 with machine-readable code", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "keys-valid@example.com",
    );
    const bad = await app.request(
      "http://localhost/api/keys",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "", scopes: [] }),
      },
      env,
    );
    expect(bad.status).toBe(400);
    const err = ErrorEnvelopeSchema.parse(await bad.json());
    expect(err.code).toBe(VALIDATION_ERROR);

    const badScope = await app.request(
      "http://localhost/api/keys",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          name: "bad",
          scopes: ["not:a:real:scope"],
        }),
      },
      env,
    );
    expect(badScope.status).toBe(400);
    expect(ErrorEnvelopeSchema.parse(await badScope.json()).code).toBe(
      VALIDATION_ERROR,
    );
  });

  it("consequential writes emit audit_events with correlationId", async () => {
    const { app, cookie, store } = await magicLinkSession(
      "admin",
      "keys-audit@example.com",
    );
    const corr = "corr-keys-audit-99";
    const create = await app.request(
      "http://localhost/api/keys",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-correlation-id": corr,
        },
        body: JSON.stringify({
          name: "audited",
          scopes: ["events:read"],
        }),
      },
      env,
    );
    const body = KeysCreateResponseSchema.parse(await create.json());
    const audits = await store.listAudits();
    const createAudit = audits.find(
      (a) => a.action === "Keys.Create" && a.entityId === body.id,
    );
    expect(createAudit).toBeTruthy();
    expect(createAudit!.correlationId).toBe(corr);
    // Must not store secret in audit payload
    expect(createAudit!.afterJson ?? "").not.toContain(body.secret);

    const rev = await app.request(
      `http://localhost/api/keys/${body.id}`,
      {
        method: "DELETE",
        headers: { cookie, "x-correlation-id": "corr-keys-revoke" },
      },
      env,
    );
    expect(rev.status).toBe(200);
    const audits2 = await store.listAudits();
    const revAudit = audits2.find(
      (a) => a.action === "Keys.Revoke" && a.entityId === body.id,
    );
    expect(revAudit).toBeTruthy();
    expect(revAudit!.correlationId).toBe("corr-keys-revoke");
  });

  it("revoke unknown key returns 404", async () => {
    const { app, cookie } = await magicLinkSession(
      "admin",
      "keys-404@example.com",
    );
    const rev = await app.request(
      "http://localhost/api/keys/nonexistent-key-id",
      { method: "DELETE", headers: { cookie } },
      env,
    );
    expect(rev.status).toBe(404);
    expect(ErrorEnvelopeSchema.parse(await rev.json()).code).toBe(NOT_FOUND);
  });

  it("OpenAPI registers Keys commands", () => {
    expect(OPENAPI_COMMANDS).toContain("Keys.Create");
    expect(OPENAPI_COMMANDS).toContain("Keys.Revoke");
    expect(OPENAPI_COMMANDS).toContain("Keys.List");
  });

  it("GET /openapi.json lists Keys paths", async () => {
    const { app } = createAppWithAuth({ cookieSecure: true });
    const res = await app.request("http://localhost/openapi.json", {}, env);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      paths: Record<string, unknown>;
      "x-speakerops-commands": string[];
    };
    expect(doc.paths["/api/keys"]).toBeTruthy();
    expect(doc.paths["/api/keys/{keyId}"]).toBeTruthy();
    expect(doc["x-speakerops-commands"]).toContain("Keys.Create");
  });

  it("event-scoped keys:admin cannot list or revoke outside its event", async () => {
    const { app, cookie, events } = await magicLinkSession(
      "admin",
      "keys-scope-admin@example.com",
    );
    // Create two events
    const e1 = await app.request(
      "http://localhost/api/events",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "Event Scope A", timezone: "UTC" }),
      },
      env,
    );
    const eventA = (await e1.json() as { event: { id: string } }).event;
    const e2 = await app.request(
      "http://localhost/api/events",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "Event Scope B", timezone: "UTC" }),
      },
      env,
    );
    const eventB = (await e2.json() as { event: { id: string } }).event;
    expect(eventA.id).not.toBe(eventB.id);

    // Mint key for A and key for B
    const createA = await app.request(
      "http://localhost/api/keys",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          name: "scoped-a",
          scopes: ["keys:admin", "events:read"],
          eventId: eventA.id,
        }),
      },
      env,
    );
    expect(createA.status).toBe(201);
    const keyA = KeysCreateResponseSchema.parse(await createA.json());

    const createB = await app.request(
      "http://localhost/api/keys",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          name: "scoped-b",
          scopes: ["events:read"],
          eventId: eventB.id,
        }),
      },
      env,
    );
    expect(createB.status).toBe(201);
    const keyB = KeysCreateResponseSchema.parse(await createB.json());

    // Event-A key lists only keys for A
    const list = await app.request(
      "http://localhost/api/keys",
      { headers: { authorization: `Bearer ${keyA.secret}` } },
      env,
    );
    expect(list.status).toBe(200);
    const listed = KeysListResponseSchema.parse(await list.json());
    expect(listed.keys.every((k) => k.eventId === eventA.id)).toBe(true);
    expect(listed.keys.some((k) => k.id === keyB.id)).toBe(false);

    // Cannot revoke B's key
    const rev = await app.request(
      `http://localhost/api/keys/${keyB.id}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${keyA.secret}` },
      },
      env,
    );
    expect(rev.status).toBe(404);

    // Cannot mint unscoped key (forced to event A)
    const mint = await app.request(
      "http://localhost/api/keys",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${keyA.secret}`,
        },
        body: JSON.stringify({
          name: "try-unscoped",
          scopes: ["events:read"],
        }),
      },
      env,
    );
    expect(mint.status).toBe(201);
    const minted = KeysCreateResponseSchema.parse(await mint.json());
    expect(minted.eventId).toBe(eventA.id);
    void events;
  });

  it("session admin cannot mint unscoped org-wide keys by omitting eventId", async () => {
    const { app, cookie, keys, userId } = await magicLinkSession(
      "admin",
      "keys-no-unscoped@example.com",
    );

    // Create a real event so admin has multiple memberships (bootstrap + new)
    const e1 = await app.request(
      "http://localhost/api/events",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "Scoped Only", timezone: "UTC" }),
      },
      env,
    );
    expect(e1.status).toBe(201);
    const event = (await e1.json() as { event: { id: string } }).event;

    // Omitting eventId with multiple admin events → 400 (must not mint unscoped)
    const multi = await app.request(
      "http://localhost/api/keys",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          name: "try-org-wide",
          scopes: ["events:read"],
        }),
      },
      env,
    );
    expect(multi.status).toBe(400);
    expect(ErrorEnvelopeSchema.parse(await multi.json()).code).toBe(
      VALIDATION_ERROR,
    );

    // Explicit eventId still works and binds
    const ok = await app.request(
      "http://localhost/api/keys",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          name: "event-bound",
          scopes: ["events:read"],
          eventId: event.id,
        }),
      },
      env,
    );
    expect(ok.status).toBe(201);
    const body = KeysCreateResponseSchema.parse(await ok.json());
    expect(body.eventId).toBe(event.id);
    const row = await keys.findById(body.id);
    expect(row!.eventId).toBe(event.id);
    expect(row!.createdBy).toBe(userId);
  });

  it("child key created by parent API key inherits human createdBy", async () => {
    const { app, cookie, keys, userId, store } = await magicLinkSession(
      "admin",
      "keys-child-createdby@example.com",
    );

    // Real event so creator membership list is non-empty for unscoped child
    const ev = await app.request(
      "http://localhost/api/events",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ name: "Child Key Event", timezone: "UTC" }),
      },
      env,
    );
    expect(ev.status).toBe(201);
    const event = (await ev.json() as { event: { id: string } }).event;

    // Seed org-scoped parent (eventId null) with keys:admin so child can be unscoped
    const { hashToken } = await import("../auth/crypto.js");
    const { uuidv7, DEFAULT_ORG_ID } = await import("@speakerops/shared");
    const parentSecret = "spk_feedface_parentkeysecretvalue01";
    const parentId = uuidv7();
    await keys.insertKey({
      id: parentId,
      orgId: DEFAULT_ORG_ID,
      name: "parent-org-admin",
      keyPrefix: "spk_feedface",
      keyHash: await hashToken(parentSecret),
      scopesJson: JSON.stringify(["keys:admin", "events:read"]),
      eventId: null,
      expiresAt: null,
      revokedAt: null,
      createdBy: userId,
      createdAt: "2026-08-01T00:00:00.000Z",
      lastUsedAt: null,
    });

    const childRes = await app.request(
      "http://localhost/api/keys",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${parentSecret}`,
        },
        body: JSON.stringify({
          name: "child-read",
          scopes: ["events:read"],
        }),
      },
      env,
    );
    expect(childRes.status).toBe(201);
    const child = KeysCreateResponseSchema.parse(await childRes.json());
    const childRow = await keys.findById(child.id);
    // Human identity retained — not parent key id (FK + membership context)
    expect(childRow!.createdBy).toBe(userId);
    expect(childRow!.createdBy).not.toBe(parentId);
    // Org-scoped parent may mint unscoped child
    expect(child.eventId).toBeNull();

    // Child events:read lists via creator membership context (not empty)
    const list = await app.request(
      "http://localhost/api/events",
      { headers: { authorization: `Bearer ${child.secret}` } },
      env,
    );
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { events: { id: string }[] };
    expect(listed.events.some((e) => e.id === event.id)).toBe(true);
    void store;
  });
});
