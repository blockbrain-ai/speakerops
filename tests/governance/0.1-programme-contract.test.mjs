/**
 * Section 0.1 — Programme contract named assertions.
 * Spec tests:
 * - assert file docs/governance/0.1-programme-contract.md exists
 * - assert contains 'D1' and 'Airtable' and 'non-goals'
 * - assert links path to 00_CONSTITUTION.md
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const contractPath = join(root, "docs", "governance", "0.1-programme-contract.md");
const contractsIndexPath = join(root, "docs", "CONTRACTS.md");
const constitutionPath = join(
  root,
  "KMS-competition",
  "initiative",
  "00_CONSTITUTION.md",
);

describe("0.1 programme contract", () => {
  it("assert file docs/governance/0.1-programme-contract.md exists", () => {
    assert.equal(
      existsSync(contractPath),
      true,
      "docs/governance/0.1-programme-contract.md must exist",
    );
  });

  it("assert contains 'D1' and 'Airtable' and 'non-goals'", () => {
    const body = readFileSync(contractPath, "utf8");
    assert.match(body, /D1/, "stack lock must mention D1 SoR");
    assert.match(body, /Airtable/, "stack lock must mention Airtable projection");
    assert.match(body, /non-goals/i, "document must include non-goals section");
  });

  it("assert links path to 00_CONSTITUTION.md", () => {
    const body = readFileSync(contractPath, "utf8");
    assert.match(
      body,
      /00_CONSTITUTION\.md/,
      "document must link constitution path 00_CONSTITUTION.md",
    );
    assert.equal(
      existsSync(constitutionPath),
      true,
      "KMS-competition/initiative/00_CONSTITUTION.md must exist for the link target",
    );
  });

  it("includes human review checklist checkboxes", () => {
    const body = readFileSync(contractPath, "utf8");
    assert.match(body, /Human review checklist/i);
    assert.match(body, /- \[ \]/, "must include unchecked review checkbox items");
  });

  it("stack lock rejects dual-stack / Next / agent fleet inventions", () => {
    const body = readFileSync(contractPath, "utf8");
    assert.match(body, /React \+ Vite/);
    assert.match(body, /Hono/);
    assert.match(body, /dogfood_ready/);
    assert.match(body, /Next(?:\.js)?\s*\/\s*RSC|Next\/RSC/);
    assert.match(body, /agent fleet|multi-agent fleet/i);
    assert.match(body, /OR-Tools/);
    assert.match(body, /dual-write|dual-stack/i);
  });

  it("points to browser E2E inventory law and Phase 9 exit", () => {
    const body = readFileSync(contractPath, "utf8");
    assert.match(body, /BROWSER_E2E_INVENTORY\.md/);
    assert.match(body, /Phase 9|S-ONB-/);
    assert.match(body, /clean-room|Clean-room/i);
  });

  it("docs/CONTRACTS.md index exists and links constitution + D1", () => {
    assert.equal(existsSync(contractsIndexPath), true);
    const body = readFileSync(contractsIndexPath, "utf8");
    assert.match(body, /00_CONSTITUTION\.md/);
    assert.match(body, /D1/);
    assert.match(body, /SCHEMA\.md/);
    assert.match(body, /COMMANDS\.md/);
  });

  it("soul test pointer lists S-* ids without replacing constitution", () => {
    const body = readFileSync(contractPath, "utf8");
    for (const id of [
      "S-THEME",
      "S-CFP",
      "S-EVAL",
      "S-PORTAL",
      "S-COMMS",
      "S-SCHED",
      "S-READY",
      "S-CLI",
      "S-AIRTABLE",
      "S-CF",
      "S-E2E-INV",
      "S-E2E-RUN",
      "S-ONB-HUMAN",
      "S-ONB-AGENT",
      "S-DOCS",
    ]) {
      assert.match(body, new RegExp(id), `soul pointer must mention ${id}`);
    }
    assert.match(body, /pointer only|pointers only|does \*\*not\*\* restate/i);
  });
});
