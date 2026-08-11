/**
 * S-EVAL performance — admin eval rollup batching (fix wave A2).
 *
 * getAdminEvalRollup previously awaited assignmentAggregate + listScores +
 * findUserById PER assignment (serially), and fetched scores TWICE per scored
 * assignment — hundreds of sequential D1 round-trips (~4s live, blowing the
 * 12s client abort for far viewers). The rollup must batch: one chunked
 * scores query, one chunked users query, aggregates computed in memory.
 *
 * Anti-false-green: the store-call-count test proves listScores and
 * findUserById are NEVER called (pattern from queue-batching.test.ts), and
 * the semantic tests pin scored / pending / abstained / missing-user / draft
 * behaviour so batching cannot silently change the DTO.
 */
import { describe, it, expect } from "vitest";
import { getAdminEvalRollup } from "./commands.js";
import { MemoryEvalStore } from "./store.js";
import { MemorySubmissionsStore } from "../publicCfp/store.js";
import { MemoryEventsStore } from "../events/store.js";
import { MemoryAuthStore } from "../auth/store.js";

/** Wrap a store so every async method invocation is counted. */
function counting<T extends object>(target: T, counts: Map<string, number>): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver);
      if (typeof value !== "function" || typeof prop !== "string") {
        return value;
      }
      return (...args: unknown[]) => {
        counts.set(prop, (counts.get(prop) ?? 0) + 1);
        return (value as (...a: unknown[]) => unknown).apply(obj, args);
      };
    },
  });
}

const NOW = "2026-06-01T12:00:00.000Z";

type Seeded = {
  eventId: string;
  evalStore: MemoryEvalStore;
  submissions: MemorySubmissionsStore;
  events: MemoryEventsStore;
  auth: MemoryAuthStore;
  evaluatorAId: string;
  evaluatorBId: string;
};

/**
 * Seed one event with:
 * - sub_scored: two SCORED assignments (weighted aggregates 2.5 and 4.5)
 * - sub_pending: one PENDING assignment (no scores)
 * - sub_abstained: one ABSTAINED assignment with a reason
 * - sub_ghost: one scored assignment whose evaluator has no user row
 * - sub_draft: a draft submission WITH an assignment (must be excluded)
 */
async function seedRollup(): Promise<Seeded> {
  const evalStore = new MemoryEvalStore();
  const submissions = new MemorySubmissionsStore();
  const events = new MemoryEventsStore();
  const auth = new MemoryAuthStore();

  const event = await events.insertEvent({
    id: "evt_rollup",
    orgId: "org_rollup",
    name: "Rollup Event",
    slug: "rollup-event",
    timezone: "UTC",
    startsAt: NOW,
    endsAt: NOW,
    settingsJson: null,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
  });

  await evalStore.insertRound({
    id: "round_r",
    eventId: event.id,
    name: "Round R",
    status: "open",
    closesAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  });
  // Two criteria with unequal weights so aggregates are genuinely weighted.
  await evalStore.replaceCriteria("round_r", [
    {
      id: "crit_a",
      roundId: "round_r",
      name: "Relevance",
      maxScore: 5,
      weight: 1,
      sortOrder: 0,
    },
    {
      id: "crit_b",
      roundId: "round_r",
      name: "Depth",
      maxScore: 5,
      weight: 3,
      sortOrder: 1,
    },
  ]);

  const evaluatorA = await auth.createUser({ email: "eval-a@example.com" });
  const evaluatorB = await auth.createUser({ email: "eval-b@example.com" });

  const insertSub = (id: string, status: string) =>
    submissions.insertSubmission({
      id,
      eventId: event.id,
      formVersionId: "fv_r",
      title: `Talk ${id}`,
      category: null,
      status,
      submittedAt: NOW,
      version: 1,
    });

  await insertSub("sub_scored", "in_review");
  await insertSub("sub_pending", "in_review");
  await insertSub("sub_abstained", "submitted");
  await insertSub("sub_ghost", "in_review");
  await insertSub("sub_draft", "draft");

  const insertAssignment = (
    id: string,
    submissionId: string,
    evaluatorUserId: string,
    status: "pending" | "scored" | "abstained",
  ) =>
    evalStore.insertAssignment({
      id,
      roundId: "round_r",
      submissionId,
      evaluatorUserId,
      status,
      overallComment: null,
      createdAt: NOW,
      updatedAt: NOW,
    });

  // sub_scored: evaluator A → (4*1 + 2*3)/4 = 2.5 · evaluator B → (3*1 + 5*3)/4 = 4.5
  await insertAssignment("asg_scored_a", "sub_scored", evaluatorA.id, "scored");
  await evalStore.replaceScores("asg_scored_a", [
    { id: "s_a1", assignmentId: "asg_scored_a", criterionId: "crit_a", value: 4, comment: null },
    { id: "s_a2", assignmentId: "asg_scored_a", criterionId: "crit_b", value: 2, comment: null },
  ]);
  await insertAssignment("asg_scored_b", "sub_scored", evaluatorB.id, "scored");
  await evalStore.replaceScores("asg_scored_b", [
    { id: "s_b1", assignmentId: "asg_scored_b", criterionId: "crit_a", value: 3, comment: null },
    { id: "s_b2", assignmentId: "asg_scored_b", criterionId: "crit_b", value: 5, comment: null },
  ]);

  await insertAssignment("asg_pending", "sub_pending", evaluatorA.id, "pending");

  await insertAssignment(
    "asg_abstained",
    "sub_abstained",
    evaluatorB.id,
    "abstained",
  );
  await evalStore.updateAssignment("asg_abstained", {
    abstainReason: "Conflict of interest",
    updatedAt: NOW,
  });

  // Evaluator with NO user row — email must be null, never a throw.
  await insertAssignment("asg_ghost", "sub_ghost", "user_ghost", "scored");
  await evalStore.replaceScores("asg_ghost", [
    { id: "s_g1", assignmentId: "asg_ghost", criterionId: "crit_a", value: 5, comment: null },
  ]);

  // Draft submissions are never evaluation candidates (10.5) — excluded even
  // when an assignment row exists.
  await insertAssignment("asg_draft", "sub_draft", evaluatorA.id, "pending");

  return {
    eventId: event.id,
    evalStore,
    submissions,
    events,
    auth,
    evaluatorAId: evaluatorA.id,
    evaluatorBId: evaluatorB.id,
  };
}

describe("S-EVAL getAdminEvalRollup batching", () => {
  it("semantic parity — scored / pending / abstained / missing-user / draft", async () => {
    const seeded = await seedRollup();
    const result = await getAdminEvalRollup(
      {
        eval: seeded.evalStore,
        submissions: seeded.submissions,
        events: seeded.events,
        auth: seeded.auth,
      },
      seeded.eventId,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const byId = new Map(
      result.value.submissions.map((s) => [s.submissionId, s]),
    );

    // Draft excluded entirely.
    expect(byId.has("sub_draft")).toBe(false);
    expect(result.value.submissions).toHaveLength(4);

    // Scored: weighted per-assignment aggregates, mean, spread, emails.
    const scored = byId.get("sub_scored")!;
    expect(scored.assignments).toHaveLength(2);
    const aggA = scored.assignments.find((a) => a.id === "asg_scored_a")!;
    const aggB = scored.assignments.find((a) => a.id === "asg_scored_b")!;
    expect(aggA.aggregateScore).toBe(2.5);
    expect(aggA.evaluatorEmail).toBe("eval-a@example.com");
    expect(aggA.status).toBe("scored");
    expect(aggA.scores).toEqual([
      { criterionId: "crit_a", value: 4 },
      { criterionId: "crit_b", value: 2 },
    ]);
    expect(aggB.aggregateScore).toBe(4.5);
    expect(aggB.evaluatorEmail).toBe("eval-b@example.com");
    expect(scored.aggregateScore).toBe(3.5); // mean of 2.5 and 4.5
    expect(scored.scoreSpread).toBe(2); // 4.5 − 2.5
    expect(scored.abstainedCount).toBe(0);

    // Pending: no aggregate, no scores.
    const pending = byId.get("sub_pending")!;
    expect(pending.assignments).toHaveLength(1);
    expect(pending.assignments[0]!.status).toBe("pending");
    expect(pending.assignments[0]!.aggregateScore).toBeNull();
    expect(pending.assignments[0]!.scores).toEqual([]);
    expect(pending.aggregateScore).toBeNull();
    expect(pending.scoreSpread).toBeNull();

    // Abstained: counted, reason surfaced, never aggregates.
    const abstained = byId.get("sub_abstained")!;
    expect(abstained.abstainedCount).toBe(1);
    expect(abstained.assignments[0]!.status).toBe("abstained");
    expect(abstained.assignments[0]!.abstainReason).toBe(
      "Conflict of interest",
    );
    expect(abstained.assignments[0]!.aggregateScore).toBeNull();
    expect(abstained.aggregateScore).toBeNull();

    // Missing user: email null, aggregate still computed from scores.
    const ghost = byId.get("sub_ghost")!;
    expect(ghost.assignments).toHaveLength(1);
    expect(ghost.assignments[0]!.evaluatorEmail).toBeNull();
    expect(ghost.assignments[0]!.evaluatorUserId).toBe("user_ghost");
    expect(ghost.assignments[0]!.aggregateScore).toBe(5);
  });

  it("store call count is constant — listScores and findUserById are NEVER called", async () => {
    const seeded = await seedRollup();

    const evalCounts = new Map<string, number>();
    const authCounts = new Map<string, number>();
    const subCounts = new Map<string, number>();
    const eventCounts = new Map<string, number>();

    const result = await getAdminEvalRollup(
      {
        eval: counting(seeded.evalStore, evalCounts),
        submissions: counting(seeded.submissions, subCounts),
        events: counting(seeded.events, eventCounts),
        auth: counting(seeded.auth, authCounts),
      },
      seeded.eventId,
    );
    expect(result.ok).toBe(true);

    // The N+1 shape is gone: nothing is fetched per assignment.
    expect(evalCounts.get("listScores") ?? 0).toBe(0);
    expect(authCounts.get("findUserById") ?? 0).toBe(0);

    // Batched shape: exactly one call per bulk lookup.
    expect(evalCounts.get("findActiveRoundForEvent")).toBe(1);
    expect(evalCounts.get("listCriteria")).toBe(1);
    expect(evalCounts.get("listAssignmentsForRound")).toBe(1);
    expect(evalCounts.get("listScoresForAssignments")).toBe(1);
    expect(subCounts.get("listSubmissionsForEvent")).toBe(1);
    expect(authCounts.get("findUsersByIds")).toBe(1);
    expect(eventCounts.get("findEventById")).toBe(1);

    const total =
      [...evalCounts.values()].reduce((a, b) => a + b, 0) +
      [...authCounts.values()].reduce((a, b) => a + b, 0) +
      [...subCounts.values()].reduce((a, b) => a + b, 0) +
      [...eventCounts.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(8);
  });

  it("call count stays flat as assignments scale (never per-item)", async () => {
    const seeded = await seedRollup();
    // Pile on 60 more scored assignments across 30 more submissions.
    for (let i = 0; i < 30; i++) {
      const idx = String(i).padStart(3, "0");
      const subId = `sub_bulk_${idx}`;
      await seeded.submissions.insertSubmission({
        id: subId,
        eventId: seeded.eventId,
        formVersionId: "fv_r",
        title: `Bulk Talk ${idx}`,
        category: null,
        status: "in_review",
        submittedAt: NOW,
        version: 1,
      });
      for (const [suffix, evaluator] of [
        ["a", seeded.evaluatorAId],
        ["b", seeded.evaluatorBId],
      ] as const) {
        const asgId = `asg_bulk_${idx}_${suffix}`;
        await seeded.evalStore.insertAssignment({
          id: asgId,
          roundId: "round_r",
          submissionId: subId,
          evaluatorUserId: evaluator,
          status: "scored",
          overallComment: null,
          createdAt: NOW,
          updatedAt: NOW,
        });
        await seeded.evalStore.replaceScores(asgId, [
          {
            id: `s_bulk_${idx}_${suffix}`,
            assignmentId: asgId,
            criterionId: "crit_a",
            value: 3,
            comment: null,
          },
        ]);
      }
    }

    const evalCounts = new Map<string, number>();
    const authCounts = new Map<string, number>();
    const result = await getAdminEvalRollup(
      {
        eval: counting(seeded.evalStore, evalCounts),
        submissions: seeded.submissions,
        events: seeded.events,
        auth: counting(seeded.auth, authCounts),
      },
      seeded.eventId,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.submissions).toHaveLength(34);

    expect(evalCounts.get("listScores") ?? 0).toBe(0);
    expect(authCounts.get("findUserById") ?? 0).toBe(0);
    expect(evalCounts.get("listScoresForAssignments")).toBe(1);
    expect(authCounts.get("findUsersByIds")).toBe(1);
  });
});
