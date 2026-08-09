/**
 * Section 10.6 — Eval export/sort pure helpers (S-EVAL-EXPORT / ABS-13-class).
 *
 * Named ACs:
 * - Sort by aggregate score (desc/asc; nulls last)
 * - CSV export columns include scores/status
 */
import { describe, it, expect } from "vitest";
import {
  sortEvalSubmissionsByScore,
  evalRollupToCsv,
  csvEscapeField,
  type EvalCsvRow,
} from "../../packages/shared/src/eval.js";

const rows: EvalCsvRow[] = [
  {
    submissionId: "sub_low",
    title: "Alpha Low",
    status: "in_review",
    category: "talk",
    aggregateScore: 2.5,
    assignments: [{ status: "scored" }],
  },
  {
    submissionId: "sub_high",
    title: "Zeta High",
    status: "in_review",
    category: "keynote",
    aggregateScore: 9.0,
    assignments: [{ status: "scored" }, { status: "scored" }],
  },
  {
    submissionId: "sub_none",
    title: "Beta Pending",
    status: "submitted",
    category: null,
    aggregateScore: null,
    assignments: [{ status: "pending" }],
  },
  {
    submissionId: "sub_mid",
    title: "Mid Score",
    status: "in_review",
    category: "talk",
    aggregateScore: 5,
    assignments: [{ status: "scored" }, { status: "pending" }],
  },
];

describe("10.6 eval export/sort", () => {
  it("sorts by aggregate score descending with nulls last", () => {
    const ordered = sortEvalSubmissionsByScore(rows, "score_desc");
    expect(ordered.map((r) => r.submissionId)).toEqual([
      "sub_high",
      "sub_mid",
      "sub_low",
      "sub_none",
    ]);
  });

  it("sorts by aggregate score ascending with nulls last", () => {
    const ordered = sortEvalSubmissionsByScore(rows, "score_asc");
    expect(ordered.map((r) => r.submissionId)).toEqual([
      "sub_low",
      "sub_mid",
      "sub_high",
      "sub_none",
    ]);
  });

  it("sorts by title case-insensitively", () => {
    const ordered = sortEvalSubmissionsByScore(rows, "title");
    expect(ordered.map((r) => r.title)).toEqual([
      "Alpha Low",
      "Beta Pending",
      "Mid Score",
      "Zeta High",
    ]);
  });

  it("csvEscapeField quotes commas and doubles quotes", () => {
    expect(csvEscapeField("plain")).toBe("plain");
    expect(csvEscapeField('say "hi", now')).toBe('"say ""hi"", now"');
  });

  it("evalRollupToCsv emits header + sorted score rows with status", () => {
    const csv = evalRollupToCsv(rows, { sort: "score_desc" });
    const lines = csv.trimEnd().split(/\r?\n/);
    expect(lines[0]).toBe(
      "submissionId,title,status,category,aggregateScore,assignmentCount,scoredCount",
    );
    // High score first
    expect(lines[1]).toContain("sub_high");
    expect(lines[1]).toContain("9");
    expect(lines[1]).toContain("keynote");
    // Null score still present with empty aggregateScore field
    const noneLine = lines.find((l) => l.startsWith("sub_none,"));
    expect(noneLine).toBeTruthy();
    expect(noneLine).toMatch(/sub_none,Beta Pending,submitted,,,1,0$/);
    // Scored count for mid: 1 of 2
    const midLine = lines.find((l) => l.startsWith("sub_mid,"));
    expect(midLine).toMatch(/,5,2,1$/);
  });

  it("does not mutate input array on sort", () => {
    const snapshot = rows.map((r) => r.submissionId);
    sortEvalSubmissionsByScore(rows, "score_desc");
    expect(rows.map((r) => r.submissionId)).toEqual(snapshot);
  });
});
