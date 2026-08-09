/**
 * Section 10.2 — Eval progress response schema (S-EVAL-UI).
 *
 * Unit: EvalAdminRollupResponseSchema accepts production / D1-shaped payloads
 * so SPA + Worker never disagree on the admin evaluations progress contract.
 */
import { describe, it, expect } from "vitest";
import {
  EvalAdminRollupResponseSchema,
  EvalAdminSubmissionRollupSchema,
  EvalCriterionSchema,
  coerceFiniteNumber,
  computeWeightedAggregate,
} from "./eval.js";

describe("10.2 eval progress response schema", () => {
  it("unit: empty progress payload (no rubric) is valid", () => {
    const parsed = EvalAdminRollupResponseSchema.parse({
      round: null,
      criteria: [],
      submissions: [],
    });
    expect(parsed.round).toBeNull();
    expect(parsed.submissions).toEqual([]);
    expect(parsed.criteria).toEqual([]);
  });

  it("unit: production-shaped rollup with scores parses", () => {
    const sample = {
      round: {
        id: "rnd_dogfood_1",
        eventId: "evt_dogfood",
        name: "Default rubric",
        status: "open",
        closesAt: null,
        createdAt: "2026-06-01T10:00:00.000Z",
        updatedAt: "2026-06-01T10:00:00.000Z",
      },
      criteria: [
        {
          id: "crit_1",
          roundId: "rnd_dogfood_1",
          name: "Relevance",
          maxScore: 5,
          weight: 2,
          sortOrder: 0,
        },
        {
          id: "crit_2",
          roundId: "rnd_dogfood_1",
          name: "Delivery",
          maxScore: 5,
          weight: 1,
          sortOrder: 1,
        },
      ],
      submissions: [
        {
          submissionId: "sub_001",
          title: "Shipping Reliable CFP Ops",
          category: "keynote",
          status: "in_review",
          aggregateScore: 4.25,
          assignments: [
            {
              id: "asn_1",
              evaluatorUserId: "user_eval_1",
              status: "scored",
              aggregateScore: 4.25,
            },
            {
              id: "asn_2",
              evaluatorUserId: "user_eval_2",
              status: "pending",
              aggregateScore: null,
            },
          ],
        },
        {
          submissionId: "sub_002",
          title: "Untitled-ish",
          category: null,
          status: "submitted",
          aggregateScore: null,
          assignments: [],
        },
      ],
    };
    const parsed = EvalAdminRollupResponseSchema.parse(sample);
    expect(parsed.submissions).toHaveLength(2);
    expect(parsed.submissions[0]!.aggregateScore).toBe(4.25);
    expect(parsed.criteria).toHaveLength(2);
    for (const row of parsed.submissions) {
      expect(EvalAdminSubmissionRollupSchema.safeParse(row).success).toBe(
        true,
      );
    }
  });

  it("unit: D1-shaped string numerics on criteria/scores coerce", () => {
    const criterion = EvalCriterionSchema.parse({
      id: "c1",
      roundId: "r1",
      name: "Impact",
      maxScore: "10",
      weight: "1.5",
      sortOrder: "2",
    });
    expect(criterion.maxScore).toBe(10);
    expect(criterion.weight).toBe(1.5);
    expect(criterion.sortOrder).toBe(2);

    const rollup = EvalAdminRollupResponseSchema.parse({
      round: {
        id: "r1",
        eventId: "e1",
        name: "R",
        status: "open",
        closesAt: undefined,
        createdAt: "t",
        updatedAt: "t",
      },
      criteria: [criterion],
      submissions: [
        {
          submissionId: "s1",
          title: "Talk",
          category: undefined,
          status: "submitted",
          aggregateScore: "7.5",
          assignments: [
            {
              id: "a1",
              evaluatorUserId: "u1",
              status: "scored",
              aggregateScore: "7.5",
            },
          ],
        },
      ],
    });
    expect(rollup.round?.closesAt).toBeNull();
    expect(rollup.submissions[0]!.category).toBeNull();
    expect(rollup.submissions[0]!.aggregateScore).toBe(7.5);
    expect(rollup.submissions[0]!.assignments[0]!.aggregateScore).toBe(7.5);
  });

  it("unit: non-finite aggregateScore becomes null", () => {
    const parsed = EvalAdminSubmissionRollupSchema.parse({
      submissionId: "s1",
      title: "T",
      category: null,
      status: "submitted",
      aggregateScore: Number.NaN,
      assignments: [],
    });
    expect(parsed.aggregateScore).toBeNull();
  });

  it("unit: coerceFiniteNumber + weighted aggregate", () => {
    expect(coerceFiniteNumber("3.5")).toBe(3.5);
    expect(coerceFiniteNumber(Number.NaN)).toBeUndefined();
    expect(
      computeWeightedAggregate([
        { value: 8, weight: 1 },
        { value: 6, weight: 1 },
      ]),
    ).toBe(7);
    expect(computeWeightedAggregate([])).toBeNull();
  });
});
