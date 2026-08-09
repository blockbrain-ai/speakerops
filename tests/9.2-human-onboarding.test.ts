/**
 * Section 9.2 — Human onboarding path (Vitest).
 *
 * Named assertions from spec:
 * - assert ONBOARDING has numbered steps ≥10
 * - assert env names table has no values matching sk- or eyJ
 * - assert demo path mentions CFP and schedule
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const onboardingPath = join(root, "docs/ONBOARDING.md");
const sectionPath = join(root, "docs/sections/9.2-human-onboarding.md");

/** Count numbered checklist steps (### N. Title or leading "N. " list items). */
function countNumberedSteps(body: string): number {
  const headingSteps = new Set<number>();
  const headingRe = /^#{2,4}\s+(\d+)\.\s+\S/gm;
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(body))) {
    headingSteps.add(Number(m[1]));
  }
  if (headingSteps.size >= 10) return headingSteps.size;

  const listSteps = new Set<number>();
  const listRe = /^\s*(\d+)\.\s+\S/gm;
  while ((m = listRe.exec(body))) {
    listSteps.add(Number(m[1]));
  }
  return Math.max(headingSteps.size, listSteps.size);
}

/** Extract markdown table rows that look like env-name tables. */
function envTableCells(body: string): string[] {
  const cells: string[] = [];
  const lines = body.split("\n");
  let inEnvTable = false;
  for (const line of lines) {
    if (/^\|.*\bName\b.*\|/i.test(line) && /Required|Purpose|for/i.test(line)) {
      inEnvTable = true;
      continue;
    }
    if (inEnvTable) {
      if (!line.trim().startsWith("|")) {
        inEnvTable = false;
        continue;
      }
      if (/^\|[\s\-:|]+\|$/.test(line.trim())) continue;
      cells.push(line);
    }
  }
  // Also collect fenced `NAME` / backtick env identifiers near template section
  return cells;
}

describe("9.2 Human onboarding path", () => {
  it("deliverables exist", () => {
    expect(existsSync(onboardingPath), "docs/ONBOARDING.md").toBe(true);
    expect(existsSync(sectionPath), "docs/sections/9.2-human-onboarding.md").toBe(
      true,
    );
    expect(
      existsSync(join(root, "tests/governance/9.2-human-onboarding.test.mjs")),
    ).toBe(true);
  });

  it("assert ONBOARDING has numbered steps ≥10", () => {
    const body = readFileSync(onboardingPath, "utf8");
    const n = countNumberedSteps(body);
    expect(n, `expected ≥10 numbered steps, found ${n}`).toBeGreaterThanOrEqual(
      10,
    );
    // Timebox target stated (maps AC timebox)
    expect(body).toMatch(/<90\s*m|under\s+90|90\s*minutes|≤\s*90|&lt;90/i);
    expect(body).toMatch(/S-ONB-HUMAN/);
    expect(body).toMatch(/Timebox|timed checklist|Timed checklist/i);
  });

  it("assert env names table has no values matching sk- or eyJ", () => {
    const body = readFileSync(onboardingPath, "utf8");
    // Whole doc must not embed secret-shaped values
    expect(body).not.toMatch(/\bsk-[A-Za-z0-9]{10,}/);
    expect(body).not.toMatch(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/);

    const rows = envTableCells(body);
    expect(rows.length, "env names table rows").toBeGreaterThan(0);
    for (const row of rows) {
      expect(row, row).not.toMatch(/\bsk-[A-Za-z0-9]{10,}/);
      expect(row, row).not.toMatch(/\beyJ[A-Za-z0-9_-]{10,}/);
      // First column should look like a NAME (backticks or CAPS env)
      expect(row).toMatch(/`[A-Z][A-Z0-9_]+`|[A-Z][A-Z0-9_]{2,}/);
    }
    // Explicit names-only rule
    expect(body).toMatch(/names only|variable names only|Env \*\*names\*\*/i);
  });

  it("assert demo path mentions CFP and schedule", () => {
    const body = readFileSync(onboardingPath, "utf8");
    expect(body).toMatch(/Demo path|demo path/);
    expect(body).toMatch(/CFP|public CFP|\/cfp\//i);
    expect(body).toMatch(/schedule|Schedule/i);
    // Constitution soul chain (eval / portal / readiness expected in full walk)
    expect(body).toMatch(/eval|portal|readiness/i);
  });

  it("section 9.2 note declares N/A product surface and named tests", () => {
    const section = readFileSync(sectionPath, "utf8");
    expect(section).toMatch(/N\/A/i);
    expect(section).toMatch(/no new product HTTP handlers|No new routes/i);
    expect(section).toMatch(/assert ONBOARDING has numbered steps/);
    expect(section).toMatch(/assert env names table has no values matching sk-/);
    expect(section).toMatch(/assert demo path mentions CFP and schedule/);
    expect(section).toMatch(/S-ONB-HUMAN/);
  });

  it("referenced gate commands exist in package.json", () => {
    const pkg = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    const body = readFileSync(onboardingPath, "utf8");
    for (const cmd of [
      "db:migrate",
      "seed",
      "typecheck",
      "test:ci",
      "test:e2e",
      "test:e2e:inventory",
      "deploy:dogfood",
    ]) {
      expect(pkg.scripts[cmd], `package.json scripts.${cmd}`).toBeTruthy();
      expect(body).toMatch(new RegExp(cmd.replace(":", "\\:")));
    }
  });
});
