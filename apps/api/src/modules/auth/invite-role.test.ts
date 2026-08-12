/**
 * WS-C1/C2 race-safe invite + last-admin + assignment orphan guards.
 */
import { describe, it, expect } from "vitest";
import { MemoryAuthStore, MagicLinkTestOutbox } from "./store.js";
import { createInvite, setMemberRole } from "./commands.js";

describe("WS-C Auth.CreateInvite + setMemberRole", () => {
  function deps(store = new MemoryAuthStore()) {
    return {
      store,
      outbox: new MagicLinkTestOutbox(),
      bootstrapPolicy: "open" as const,
    };
  }

  it("createInvite is create-only: different role → 409, no role mutation", async () => {
    const store = new MemoryAuthStore();
    const d = deps(store);
    const admin = await store.createUser({ email: "admin-c1@example.com" });
    await store.upsertMembership({
      eventId: "evt1",
      userId: admin.id,
      role: "admin",
    });

    const first = await createInvite(d, {
      eventId: "evt1",
      email: "member@example.com",
      role: "evaluator",
      actorUserId: admin.id,
      correlationId: "c1-1",
    });
    expect(first.ok).toBe(true);

    const second = await createInvite(d, {
      eventId: "evt1",
      email: "member@example.com",
      role: "speaker",
      actorUserId: admin.id,
      correlationId: "c1-2",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.status).toBe(409);

    const user = await store.findUserByEmail("member@example.com");
    expect(user).toBeTruthy();
    const m = await store.findMembership("evt1", user!.id);
    expect(m?.role).toBe("evaluator");
  });

  it("createInvite same role is idempotent", async () => {
    const store = new MemoryAuthStore();
    const d = deps(store);
    const admin = await store.createUser({ email: "admin-c1b@example.com" });
    await store.upsertMembership({
      eventId: "evt1",
      userId: admin.id,
      role: "admin",
    });
    const a = await createInvite(d, {
      eventId: "evt1",
      email: "same@example.com",
      role: "speaker",
      actorUserId: admin.id,
      correlationId: "c1-3",
    });
    const b = await createInvite(d, {
      eventId: "evt1",
      email: "same@example.com",
      role: "speaker",
      actorUserId: admin.id,
      correlationId: "c1-4",
    });
    expect(a.ok && b.ok).toBe(true);
  });

  it("setMemberRole blocks last admin demotion", async () => {
    const store = new MemoryAuthStore();
    const d = deps(store);
    const admin = await store.createUser({ email: "solo-admin@example.com" });
    await store.upsertMembership({
      eventId: "evt1",
      userId: admin.id,
      role: "admin",
    });
    const r = await setMemberRole(d, {
      eventId: "evt1",
      userId: admin.id,
      role: "speaker",
      actorUserId: admin.id,
      correlationId: "c2-1",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
    const m = await store.findMembership("evt1", admin.id);
    expect(m?.role).toBe("admin");
  });

  it("setMemberRole blocks demote to speaker with pending assignments", async () => {
    const store = new MemoryAuthStore();
    const evalStub = {
      listAssignmentsForEvaluator: async () => [
        { status: "pending", submissionId: "sub1" },
      ],
    };
    const d = { ...deps(store), eval: evalStub };
    const admin = await store.createUser({ email: "admin-c2@example.com" });
    const evalUser = await store.createUser({ email: "eval-c2@example.com" });
    await store.upsertMembership({
      eventId: "evt1",
      userId: admin.id,
      role: "admin",
    });
    await store.upsertMembership({
      eventId: "evt1",
      userId: evalUser.id,
      role: "evaluator",
    });
    const r = await setMemberRole(d, {
      eventId: "evt1",
      userId: evalUser.id,
      role: "speaker",
      actorUserId: admin.id,
      correlationId: "c2-2",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(409);
      expect(r.error).toMatch(/pending/i);
    }
  });
});
