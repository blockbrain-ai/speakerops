/**
 * Section 0.3 — Browser E2E inventory law named assertions.
 * Spec tests:
 * - assert inventory law forbids shrinkage
 * - assert REQUIRED definition present
 * - assert discovery crawl REQUIRED at phase 8
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lawPath = join(root, "docs", "governance", "0.3-e2e-inventory-law.md");
const contractsIndexPath = join(root, "docs", "CONTRACTS.md");
const inventoryPath = join(
  root,
  "KMS-competition",
  "initiative",
  "BROWSER_E2E_INVENTORY.md",
);
const packageJsonPath = join(root, "package.json");

describe("0.3 Browser E2E inventory law", () => {
  it("assert law doc exists", () => {
    assert.equal(
      existsSync(lawPath),
      true,
      "docs/governance/0.3-e2e-inventory-law.md must exist",
    );
  });

  it("assert inventory law forbids shrinkage", () => {
    const body = readFileSync(lawPath, "utf8");
    assert.match(
      body,
      /no shrinkage|anti-shrinkage|Shrinking.*forbidden|forbids shrinkage/i,
      "law must forbid inventory shrinkage",
    );
    assert.match(
      body,
      /forbidden/i,
      "law must use forbidden language for shrinkage",
    );
    assert.match(
      body,
      /owner DEFER|owner DEFER/i,
      "only owner DEFER may remove from required PASS set",
    );
    assert.match(
      body,
      /wildcard-only|No wildcard-only|wildcards.*forbidden/i,
      "law must forbid wildcard-only acceptance",
    );
    assert.match(
      body,
      /108|REQUIRED_BASELINE|baseline/i,
      "law must record anti-shrinkage baseline",
    );
  });

  it("assert REQUIRED definition present", () => {
    const body = readFileSync(lawPath, "utf8");
    assert.match(
      body,
      /REQUIRED/,
      "law must define REQUIRED column",
    );
    assert.match(
      body,
      /must PASS for dogfood|PASS for dogfood_ready|must \*\*PASS\*\* for/i,
      "REQUIRED must mean PASS for dogfood / dogfood_ready",
    );
    assert.match(
      body,
      /dogfood_ready/,
      "law must tie REQUIRED to dogfood_ready claim",
    );
    assert.match(
      body,
      /OPTIONAL/,
      "law must distinguish OPTIONAL hardening",
    );
  });

  it("assert discovery crawl REQUIRED at phase 8", () => {
    const body = readFileSync(lawPath, "utf8");
    assert.match(
      body,
      /[Dd]iscovery crawl/,
      "law must mention discovery crawl",
    );
    assert.match(
      body,
      /[Dd]iscovery crawl REQUIRED at Phase 8|REQUIRED at Phase 8\.x|REQUIRED at 8\.x/i,
      "discovery crawl must be REQUIRED at Phase 8.x",
    );
    assert.match(
      body,
      /Phase 8/,
      "law must reference Phase 8",
    );
  });

  it("maps phases to inventory letter ranges", () => {
    const body = readFileSync(lawPath, "utf8");
    assert.match(body, /letter range|Letter range|A01–A11|A01-A11/i);
    assert.match(body, /I01–I16|I01-I16/);
    assert.match(body, /Phase → inventory|phase.*letter/i);
    // sample ranges from ownership
    for (const range of ["A01", "B01", "D01", "G01", "J01", "K01", "N01", "O01"]) {
      assert.match(body, new RegExp(range), `phase map must mention ${range}`);
    }
  });

  it("documents @inv tagging convention", () => {
    const body = readFileSync(lawPath, "utf8");
    assert.match(body, /@inv:A01/);
    assert.match(body, /@inv:/);
    assert.match(body, /[Tt]agging convention|Playwright/);
  });

  it("documents pnpm test:e2e and test:e2e:inventory", () => {
    const body = readFileSync(lawPath, "utf8");
    assert.match(body, /test:e2e/);
    assert.match(body, /test:e2e:inventory/);

    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    assert.equal(
      typeof pkg.scripts["test:e2e"],
      "string",
      "package.json must define test:e2e",
    );
    assert.equal(
      typeof pkg.scripts["test:e2e:inventory"],
      "string",
      "package.json must define test:e2e:inventory",
    );
  });

  it("points at canonical inventory and constitution souls", () => {
    const body = readFileSync(lawPath, "utf8");
    assert.match(body, /BROWSER_E2E_INVENTORY\.md/);
    assert.match(body, /S-E2E-INV/);
    assert.match(body, /S-E2E-RUN/);
    assert.equal(existsSync(inventoryPath), true);
    const inv = readFileSync(inventoryPath, "utf8");
    assert.match(inv, /REQUIRED/);
    assert.match(inv, /Discovery crawl REQUIRED at Phase 8/);
  });

  it("linked from docs/CONTRACTS.md", () => {
    assert.equal(existsSync(contractsIndexPath), true);
    const contracts = readFileSync(contractsIndexPath, "utf8");
    assert.match(
      contracts,
      /0\.3-e2e-inventory-law\.md/,
      "docs/CONTRACTS.md must link 0.3-e2e-inventory-law.md",
    );
  });

  it("includes human review checklist and AC proof map", () => {
    const body = readFileSync(lawPath, "utf8");
    assert.match(body, /Human review checklist/i);
    assert.match(body, /- \[ \]/, "must include unchecked review checkbox items");
    assert.match(body, /AC → proof|Acceptance criterion/i);
  });

  it("inventory lint script passes (anti-shrinkage baseline)", () => {
    // Strip node:test runner context so the child is a plain script process.
    // Inheriting NODE_TEST_CONTEXT can suppress child stdout under some runners.
    const childEnv = { ...process.env };
    delete childEnv.NODE_TEST_CONTEXT;
    delete childEnv.NODE_TEST_NAME;
    const result = spawnSync(
      process.execPath,
      [join(root, "scripts", "e2e-inventory-lint.mjs")],
      { cwd: root, encoding: "utf8", env: childEnv },
    );
    assert.equal(
      result.status,
      0,
      `test:e2e:inventory must pass (exit 0):\nstdout=${result.stdout}\nstderr=${result.stderr}`,
    );
    // Prefer OK in stdout when present; exit status alone is sufficient if empty.
    if (result.stdout && result.stdout.length > 0) {
      assert.match(result.stdout, /OK/);
    }
  });

  /**
   * Spawn inventory lint against a temp inventory mutation.
   * Returns { status, stdout, stderr }.
   */
  function runLintAgainstMutatedInventory(mutate) {
    const inv = readFileSync(inventoryPath, "utf8");
    const mutated = mutate(inv);
    assert.notEqual(
      mutated,
      inv,
      "test fixture must change the inventory content",
    );

    const dir = mkdtempSync(join(tmpdir(), "e2e-inv-status-"));
    try {
      const badInvPath = join(dir, "BROWSER_E2E_INVENTORY.md");
      writeFileSync(badInvPath, mutated, "utf8");

      const childEnv = {
        ...process.env,
        E2E_INVENTORY_PATH: badInvPath,
      };
      delete childEnv.NODE_TEST_CONTEXT;
      delete childEnv.NODE_TEST_NAME;

      return spawnSync(
        process.execPath,
        [join(root, "scripts", "e2e-inventory-lint.mjs")],
        { cwd: root, encoding: "utf8", env: childEnv },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /** Replace A01 Status cell while keeping the rest of the row intact. */
  function withA01Status(inv, statusCell) {
    return inv.replace(
      /^\| A01 \|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\| REQUIRED \| OPEN \|/m,
      `| A01 |$1|$2|$3|$4|$5| REQUIRED | ${statusCell} |`,
    );
  }

  it("rejects unrecognized inventory status values (word-character typo)", () => {
    // Typo IMPLMENTED is still \w+ — must fail after parse, not be treated as a valid status.
    const result = runLintAgainstMutatedInventory((inv) =>
      withA01Status(inv, "IMPLMENTED"),
    );
    assert.notEqual(
      result.status,
      0,
      `unrecognized status must fail lint (got exit ${result.status}):\nstdout=${result.stdout}\nstderr=${result.stderr}`,
    );
    assert.match(
      result.stderr,
      /unrecognized inventory status/i,
      `stderr must name unrecognized status:\n${result.stderr}`,
    );
    assert.match(
      result.stderr,
      /IMPLMENTED|A01/i,
      `stderr must identify the bad row:\n${result.stderr}`,
    );
  });

  it("rejects blank inventory status (not skipped by parse)", () => {
    // Blank Status must be parsed as a journey row then rejected — not omitted by a \w+ status regex.
    const result = runLintAgainstMutatedInventory((inv) => withA01Status(inv, ""));
    assert.notEqual(
      result.status,
      0,
      `blank status must fail lint (got exit ${result.status}):\nstdout=${result.stdout}\nstderr=${result.stderr}`,
    );
    assert.match(
      result.stderr,
      /unrecognized inventory status/i,
      `stderr must name unrecognized status:\n${result.stderr}`,
    );
    assert.match(
      result.stderr,
      /A01|<blank>/i,
      `stderr must identify the blank-status row:\n${result.stderr}`,
    );
  });

  it("rejects non-word invalid inventory status (IMPLEMENTED!)", () => {
    // Non-word Status (punctuation) must not be silently skipped by a \w+ capture group.
    const result = runLintAgainstMutatedInventory((inv) =>
      withA01Status(inv, "IMPLEMENTED!"),
    );
    assert.notEqual(
      result.status,
      0,
      `non-word invalid status must fail lint (got exit ${result.status}):\nstdout=${result.stdout}\nstderr=${result.stderr}`,
    );
    assert.match(
      result.stderr,
      /unrecognized inventory status/i,
      `stderr must name unrecognized status:\n${result.stderr}`,
    );
    assert.match(
      result.stderr,
      /IMPLEMENTED!|A01/i,
      `stderr must identify the bad row:\n${result.stderr}`,
    );
  });
});
