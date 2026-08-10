import { describe, it, expect } from "vitest";
import {
  buildEvalRoundStrip,
  formatRoundDeadline,
  resolveStripSourceItem,
} from "./eval-queue-utils.js";
import type { EvalQueueItem } from "@speakerops/shared";

function item(opts: {
  assignmentId: string;
  roundId: string;
  roundName: string;
  eventName?: string;
  scored?: boolean;
  closesAt?: string | null;
}): EvalQueueItem {
  return {
    assignment: {
      id: opts.assignmentId,
      roundId: opts.roundId,
      submissionId: `sub_${opts.assignmentId}`,
      evaluatorUserId: "u1",
      status: opts.scored ? "scored" : "pending",
      overallComment: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      aggregateScore: opts.scored ? 8 : null,
      scores: opts.scored
        ? [
            {
              id: "s1",
              assignmentId: opts.assignmentId,
              criterionId: "c1",
              value: 8,
              comment: null,
            },
          ]
        : [],
    },
    submission: {
      id: `sub_${opts.assignmentId}`,
      title: `Title ${opts.assignmentId}`,
      eventId: "evt1",
      category: null,
      status: "submitted",
    },
    criteria: [
      {
        id: "c1",
        roundId: opts.roundId,
        name: "Impact",
        maxScore: 10,
        weight: 1,
        sortOrder: 0,
      },
    ],
    event: { id: "evt1", name: opts.eventName ?? "Demo Conf" },
    round: {
      id: opts.roundId,
      name: opts.roundName,
      status: "open",
      closesAt: opts.closesAt ?? null,
    },
  };
}

describe("eval-queue-utils round strip", () => {
  it("returns null for empty queue", () => {
    expect(buildEvalRoundStrip([], null)).toBeNull();
    expect(resolveStripSourceItem([], "x")).toBeNull();
  });

  it("follows active assignment round and scopes progress", () => {
    const a = item({
      assignmentId: "a1",
      roundId: "r1",
      roundName: "Round One",
      scored: true,
    });
    const b = item({
      assignmentId: "a2",
      roundId: "r1",
      roundName: "Round One",
      scored: false,
    });
    const c = item({
      assignmentId: "a3",
      roundId: "r2",
      roundName: "Round Two",
      scored: false,
      closesAt: "2026-12-01T12:00:00.000Z",
    });
    const items = [a, b, c];

    const stripR1 = buildEvalRoundStrip(items, "a1");
    expect(stripR1).toMatchObject({
      roundId: "r1",
      roundName: "Round One",
      done: 1,
      total: 2,
      pct: 50,
    });

    const stripR2 = buildEvalRoundStrip(items, "a3");
    expect(stripR2).toMatchObject({
      roundId: "r2",
      roundName: "Round Two",
      done: 0,
      total: 1,
      pct: 0,
      closesAt: "2026-12-01T12:00:00.000Z",
    });
  });

  it("falls back to first incomplete when active missing", () => {
    const a = item({
      assignmentId: "a1",
      roundId: "r1",
      roundName: "R1",
      scored: true,
    });
    const b = item({
      assignmentId: "a2",
      roundId: "r2",
      roundName: "R2",
      scored: false,
    });
    const source = resolveStripSourceItem([a, b], null);
    expect(source?.assignment.id).toBe("a2");
  });

  it("formatRoundDeadline handles null", () => {
    expect(formatRoundDeadline(null)).toBe("No close date");
  });
});
