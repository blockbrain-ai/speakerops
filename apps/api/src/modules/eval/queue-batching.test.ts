/**
 * Section 3.4 — evaluator queue batching (S-EVAL performance).
 *
 * getEvalQueue previously issued ~5 store calls PER assignment (submission,
 * round, criteria, aggregate scores, scores). On D1 every call is a network
 * hop, so /eval took ~10s to interactive at dogfood scale. The queue must
 * batch: store call count stays constant-per-unique-round, never per-item.
 */
import { describe, it, expect } from "vitest";
import { getEvalQueue } from "./commands.js";
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

async function seedQueue(opts: {
  evalStore: MemoryEvalStore;
  submissions: MemorySubmissionsStore;
  events: MemoryEventsStore;
  assignmentCount: number;
}): Promise<{ eventId: string; evaluatorUserId: string }> {
  const now = "2026-06-01T12:00:00.000Z";
  const evaluatorUserId = "user_eval_1";
  const event = await opts.events.insertEvent({
    id: "evt_queue",
    orgId: "org_queue",
    name: "Queue Event",
    slug: "queue-event",
    timezone: "UTC",
    startsAt: now,
    endsAt: now,
    settingsJson: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
  });
  await opts.evalStore.insertRound({
    id: "round_1",
    eventId: event.id,
    name: "Round 1",
    status: "open",
    closesAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await opts.evalStore.replaceCriteria("round_1", [
    {
      id: "crit_1",
      roundId: "round_1",
      name: "Relevance",
      maxScore: 5,
      weight: 1,
      sortOrder: 0,
    },
  ]);

  for (let i = 0; i < opts.assignmentCount; i++) {
    const idx = String(i).padStart(3, "0");
    const subId = `sub_q_${idx}`;
    await opts.submissions.insertSubmission({
      id: subId,
      eventId: event.id,
      formVersionId: "fv_q",
      title: `Queue Talk ${idx}`,
      category: null,
      status: "in_review",
      submittedAt: now,
      version: 1,
    });
    const assignmentId = `asg_q_${idx}`;
    await opts.evalStore.insertAssignment({
      id: assignmentId,
      roundId: "round_1",
      submissionId: subId,
      evaluatorUserId,
      status: i % 2 === 0 ? "scored" : "pending",
      overallComment: null,
      createdAt: now,
      updatedAt: now,
    });
    if (i % 2 === 0) {
      await opts.evalStore.replaceScores(assignmentId, [
        {
          id: `score_q_${idx}`,
          assignmentId,
          criterionId: "crit_1",
          value: 4,
          comment: null,
        },
      ]);
    }
  }
  return { eventId: event.id, evaluatorUserId };
}

describe("3.4 getEvalQueue batching", () => {
  it("returns full queue items (scores, aggregates, round, event)", async () => {
    const evalStore = new MemoryEvalStore();
    const submissions = new MemorySubmissionsStore();
    const events = new MemoryEventsStore();
    const { evaluatorUserId } = await seedQueue({
      evalStore,
      submissions,
      events,
      assignmentCount: 6,
    });

    const result = await getEvalQueue(
      {
        eval: evalStore,
        submissions,
        events,
        auth: new MemoryAuthStore(),
      },
      evaluatorUserId,
    );
    expect(result.ok).toBe(true);
    const items = result.value.items;
    expect(items).toHaveLength(6);
    for (const item of items) {
      expect(item.event.name).toBe("Queue Event");
      expect(item.round.id).toBe("round_1");
      expect(item.criteria).toHaveLength(1);
      expect(Array.isArray(item.assignment.scores)).toBe(true);
    }
    const scored = items.filter((i) => i.assignment.status === "scored");
    expect(scored.length).toBe(3);
    for (const item of scored) {
      expect(item.assignment.aggregateScore).toBe(4);
      expect(item.assignment.scores).toHaveLength(1);
    }
    const pending = items.filter((i) => i.assignment.status === "pending");
    for (const item of pending) {
      expect(item.assignment.aggregateScore).toBeNull();
    }
  });

  it("store call count is constant per unique round — never per assignment", async () => {
    const evalStore = new MemoryEvalStore();
    const submissions = new MemorySubmissionsStore();
    const events = new MemoryEventsStore();
    const { evaluatorUserId } = await seedQueue({
      evalStore,
      submissions,
      events,
      assignmentCount: 40,
    });

    const counts = new Map<string, number>();
    const deps = {
      eval: counting(evalStore, counts),
      submissions: counting(submissions, counts),
      events: counting(events, counts),
      auth: new MemoryAuthStore(),
    };

    const result = await getEvalQueue(deps, evaluatorUserId);
    expect(result.ok).toBe(true);
    expect(result.value.items).toHaveLength(40);

    // One assignments list + batched submissions/scores + per-unique-round
    // round/criteria + per-unique-event lookup. Nothing scales with N=40.
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    expect(counts.get("listAssignmentsForEvaluator")).toBe(1);
    expect(counts.get("listSubmissionsByIds")).toBe(1);
    expect(counts.get("listScoresForAssignments")).toBe(1);
    expect(counts.get("findRoundById")).toBe(1);
    expect(counts.get("listCriteria")).toBe(1);
    expect(counts.get("findEventById")).toBe(1);
    expect(counts.get("findSubmissionById") ?? 0).toBe(0);
    expect(counts.get("listScores") ?? 0).toBe(0);
    expect(total).toBeLessThanOrEqual(8);
  });

  it("eventId filter still scopes to one programme", async () => {
    const evalStore = new MemoryEvalStore();
    const submissions = new MemorySubmissionsStore();
    const events = new MemoryEventsStore();
    const { eventId, evaluatorUserId } = await seedQueue({
      evalStore,
      submissions,
      events,
      assignmentCount: 4,
    });

    const scoped = await getEvalQueue(
      { eval: evalStore, submissions, events, auth: new MemoryAuthStore() },
      evaluatorUserId,
      { eventId },
    );
    expect(scoped.value.items).toHaveLength(4);

    const other = await getEvalQueue(
      { eval: evalStore, submissions, events, auth: new MemoryAuthStore() },
      evaluatorUserId,
      { eventId: "evt_other" },
    );
    expect(other.value.items).toHaveLength(0);
  });
});
