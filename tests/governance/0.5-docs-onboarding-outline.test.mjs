/**
 * Section 0.5 — Docs and onboarding outline named assertions.
 * Spec tests:
 * - assert ONBOARDING.md and AGENT_SETUP.md and reports/index.html in outline
 * - assert S-ONB souls named
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outlinePath = join(
  root,
  "docs",
  "governance",
  "0.5-docs-onboarding-outline.md",
);
const contractsIndexPath = join(root, "docs", "CONTRACTS.md");
const constitutionPath = join(
  root,
  "KMS-competition",
  "initiative",
  "00_CONSTITUTION.md",
);
const buildChecklistPath = join(
  root,
  "KMS-competition",
  "initiative",
  "BUILD_CHECKLIST.md",
);

/** Phase 9 index required docs/ leaves (ACTIVE-RUNS-09 document tree). */
const PHASE9_DOCS_LEAVES = [
  "ONBOARDING.md",
  "AGENT_SETUP.md",
  "ARCHITECTURE.md",
  "SECURITY.md",
  "CLI.md",
  "OPERATIONS.md",
  "AIRTABLE.md",
  "E2E.md",
  "COMPETITION.md",
  "TROUBLESHOOTING.md",
  "FIELD_FLOW.md",
];

/** Phase 9 index required reports/ leaves. */
const PHASE9_REPORTS_LEAVES = [
  "index.html",
  "onboarding.html",
  "agent-setup.html",
  "architecture.html",
  "e2e-coverage.html",
  "cli-reference.html",
  "design-lumen.html",
];

describe("0.5 Docs and onboarding outline", () => {
  it("assert outline doc exists", () => {
    assert.equal(
      existsSync(outlinePath),
      true,
      "docs/governance/0.5-docs-onboarding-outline.md must exist",
    );
  });

  it("assert ONBOARDING.md and AGENT_SETUP.md and reports/index.html in outline", () => {
    const body = readFileSync(outlinePath, "utf8");
    assert.match(
      body,
      /ONBOARDING\.md/,
      "outline must list docs/ONBOARDING.md (S-ONB-HUMAN)",
    );
    assert.match(
      body,
      /AGENT_SETUP\.md/,
      "outline must list docs/AGENT_SETUP.md (S-ONB-AGENT)",
    );
    assert.match(
      body,
      /reports\/index\.html/,
      "outline must list reports/index.html (S-DOCS portal)",
    );
    // Human vs agent paths must be distinguished, not collapsed
    assert.match(
      body,
      /Human path|human path|S-ONB-HUMAN/i,
      "must distinguish human path",
    );
    assert.match(
      body,
      /Agent path|agent path|S-ONB-AGENT/i,
      "must distinguish agent path",
    );
  });

  it("assert S-ONB souls named", () => {
    const body = readFileSync(outlinePath, "utf8");
    for (const id of ["S-ONB-HUMAN", "S-ONB-AGENT", "S-DOCS"]) {
      assert.match(body, new RegExp(id), `outline must name soul ${id}`);
    }
    // Mapped to artifacts, not inventing new soul definitions
    assert.match(
      body,
      /Soul mapping|mapped|S-ONB-HUMAN[\s\S]{0,200}ONBOARDING/i,
      "souls must be mapped to onboarding artifacts",
    );
    assert.equal(
      existsSync(constitutionPath),
      true,
      "constitution must exist as soul authority",
    );
    const constitution = readFileSync(constitutionPath, "utf8");
    assert.match(constitution, /S-ONB-HUMAN/);
    assert.match(constitution, /S-ONB-AGENT/);
    assert.match(constitution, /S-DOCS/);
  });

  it("tree matches Phase 9 index docs/ and reports/ leaves", () => {
    const body = readFileSync(outlinePath, "utf8");
    for (const leaf of PHASE9_DOCS_LEAVES) {
      assert.match(
        body,
        new RegExp(leaf.replace(".", "\\.")),
        `Phase 9 tree must include docs/${leaf}`,
      );
    }
    for (const leaf of PHASE9_REPORTS_LEAVES) {
      assert.match(
        body,
        new RegExp(`reports/${leaf.replace(".", "\\.")}|${leaf.replace(".", "\\.")}`),
        `Phase 9 tree must include reports/${leaf}`,
      );
    }
    assert.match(body, /README\.md/, "tree must include root README.md map");
  });

  it("lists evidence requirements for 9.6 and BC13–BC15", () => {
    const body = readFileSync(outlinePath, "utf8");
    assert.match(body, /9\.6/, "must reference proof keystone 9.6");
    assert.match(body, /Evidence|evidence/, "must state evidence requirements");
    assert.match(body, /BC13/);
    assert.match(body, /BC14/);
    assert.match(body, /BC15/);
    assert.equal(
      existsSync(buildChecklistPath),
      true,
      "BUILD_CHECKLIST.md must exist",
    );
    const checklist = readFileSync(buildChecklistPath, "utf8");
    assert.match(checklist, /BC13/);
    assert.match(checklist, /S-ONB-HUMAN/);
    assert.match(checklist, /S-ONB-AGENT/);
    assert.match(checklist, /S-DOCS/);
  });

  it("linked from docs/CONTRACTS.md and README", () => {
    assert.equal(existsSync(contractsIndexPath), true);
    const contracts = readFileSync(contractsIndexPath, "utf8");
    assert.match(
      contracts,
      /0\.5-docs-onboarding-outline\.md/,
      "docs/CONTRACTS.md must link 0.5-docs-onboarding-outline.md",
    );
    assert.match(
      contracts,
      /S-ONB-HUMAN|S-ONB-AGENT|S-DOCS/,
      "CONTRACTS.md must mention onboarding souls for 0.5",
    );

    const readme = readFileSync(join(root, "README.md"), "utf8");
    assert.match(
      readme,
      /0\.5-docs-onboarding-outline\.md/,
      "README.md must link 0.5-docs-onboarding-outline.md",
    );
  });

  it("includes human review checklist and AC proof map", () => {
    const body = readFileSync(outlinePath, "utf8");
    assert.match(body, /Human review checklist/i);
    assert.match(body, /- \[ \]/, "must include unchecked review checkbox items");
    assert.match(body, /AC → proof|Acceptance criterion/i);
  });

  it("declares no product handlers / final prose in scope", () => {
    const body = readFileSync(outlinePath, "utf8");
    assert.match(body, /Out of scope|out of scope/i);
    assert.match(
      body,
      /final prose|Writing final prose|no final prose/i,
      "must state final prose is Phase 9 not 0.5",
    );
    assert.match(
      body,
      /N\/A|none added/i,
      "must declare N/A for HTTP handlers / audit when no product surface",
    );
  });

  it("no secrets or magic-link tokens in outline", () => {
    const body = readFileSync(outlinePath, "utf8");
    assert.doesNotMatch(
      body,
      /sk_live_|sk_test_|api[_-]?key\s*[:=]\s*['\"][^'\"]{8,}/i,
      "must not contain API key secret values",
    );
    assert.doesNotMatch(
      body,
      /Bearer\s+[A-Za-z0-9\-._~+/]+=*/,
      "must not contain Bearer tokens",
    );
    assert.doesNotMatch(
      body,
      /magic[_-]?link[^\n]{0,40}[:=]\s*['\"][A-Za-z0-9]{16,}/i,
      "must not contain magic-link token values",
    );
    // Env names only is fine; assert the rule is stated
    assert.match(
      body,
      /env (?:\*\*)?names(?:\*\*)? only|variable names only|names only/i,
      "must require env names only (no secret values)",
    );
  });

  it("phase 9 build order 9.1–9.6 present", () => {
    const body = readFileSync(outlinePath, "utf8");
    for (const section of ["9.1", "9.2", "9.3", "9.4", "9.5", "9.6"]) {
      assert.match(
        body,
        new RegExp(section.replace(".", "\\.")),
        `outline must reference Phase 9 section ${section}`,
      );
    }
  });
});
