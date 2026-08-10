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
  neutralizeCsvFormula,
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

  it("neutralizeCsvFormula prefixes formula-leading cells", () => {
    expect(neutralizeCsvFormula("safe title")).toBe("safe title");
    expect(neutralizeCsvFormula("=1+1")).toBe("'=1+1");
    expect(neutralizeCsvFormula("+cmd|' /C calc'!A0")).toBe(
      "'+cmd|' /C calc'!A0",
    );
    expect(neutralizeCsvFormula("-2+3")).toBe("'-2+3");
    expect(neutralizeCsvFormula("@SUM(A1:A10)")).toBe("'@SUM(A1:A10)");
    expect(neutralizeCsvFormula("\t=HYPERLINK")).toBe("'\t=HYPERLINK");
  });

  it("evalRollupToCsv emits header + sorted score rows with status", () => {
    const csv = evalRollupToCsv(rows, { sort: "score_desc" });
    const lines = csv.trimEnd().split(/\r?\n/);
    expect(lines[0]).toBe(
      "submissionId,title,status,category,aggregateScore,assignmentCount,scoredCount,abstainedCount,evaluatorEmails,overallComments,abstainReasons",
    );
    // High score first
    expect(lines[1]).toContain("sub_high");
    expect(lines[1]).toContain("9");
    expect(lines[1]).toContain("keynote");
    // Null score still present with empty aggregateScore field (+ empty email/comment/reason cols)
    const noneLine = lines.find((l) => l.startsWith("sub_none,"));
    expect(noneLine).toBeTruthy();
    expect(noneLine).toMatch(/sub_none,Beta Pending,submitted,,,1,0,0,,,$/);
    // Scored count for mid: 1 of 2, none abstained
    const midLine = lines.find((l) => l.startsWith("sub_mid,"));
    expect(midLine).toMatch(/,5,2,1,0,,,$/);
  });

  it("evalRollupToCsv counts abstentions distinctly with reasons (post-11.9)", () => {
    const withAbstain: EvalCsvRow[] = [
      {
        submissionId: "sub_abst",
        title: "Has Abstain",
        status: "in_review",
        category: "talk",
        aggregateScore: 4,
        assignments: [
          { status: "scored", evaluatorEmail: "a@example.com" },
          {
            status: "abstained",
            evaluatorEmail: "b@example.com",
            abstainReason: "Conflict of interest",
          },
        ],
      },
    ];
    const csv = evalRollupToCsv(withAbstain, { sort: "score_desc" });
    const lines = csv.trimEnd().split(/\r?\n/);
    const line = lines.find((l) => l.startsWith("sub_abst,"));
    expect(line).toBeTruthy();
    // assignmentCount=2, scoredCount=1, abstainedCount=1
    expect(line).toContain(",4,2,1,1,");
    expect(line).toContain("Conflict of interest");
  });

  it("evalRollupToCsv neutralizes malicious title/category formula injection", () => {
    const malicious: EvalCsvRow[] = [
      {
        submissionId: "sub_evil",
        title: "=cmd|' /C calc'!A0",
        status: "submitted",
        category: "+2+5+cmd|' /C calc'!A0",
        aggregateScore: 1,
        assignments: [{ status: "scored" }],
      },
      {
        submissionId: "sub_at",
        title: "@SUM(1+1)",
        status: "in_review",
        category: '-HYPERLINK("http://evil","x")',
        aggregateScore: null,
        assignments: [{ status: "pending" }],
      },
    ];
    const csv = evalRollupToCsv(malicious, { sort: "title" });
    // Formula-leading user fields must be text-forced (leading single quote)
    expect(csvEscapeField("=cmd|' /C calc'!A0")).toMatch(/^'/);
    expect(csvEscapeField("+2+5+cmd|' /C calc'!A0")).toMatch(/^'/);
    expect(csvEscapeField("@SUM(1+1)")).toMatch(/^'/);
    expect(csvEscapeField('-HYPERLINK("http://evil","x")')).toMatch(/^["']/);
    expect(csv).toContain("'=cmd|' /C calc'!A0");
    expect(csv).toContain("'+2+5+cmd|' /C calc'!A0");
    expect(csv).toContain("'@SUM(1+1)");
    expect(csv).toContain("'-HYPERLINK");
    // Must not emit unneutralized formula starters as cell text
    expect(csv).not.toMatch(/(?:^|,|=)(?:=cmd|\+2\+5|@SUM)/m);
  });

  it("does not mutate input array on sort", () => {
    const snapshot = rows.map((r) => r.submissionId);
    sortEvalSubmissionsByScore(rows, "score_desc");
    expect(rows.map((r) => r.submissionId)).toEqual(snapshot);
  });
});
