/**
 * Section 0.3 — Browser E2E inventory law named assertions.
 * Spec tests:
 * - assert inventory law forbids shrinkage
 * - assert REQUIRED definition present
 * - assert discovery crawl REQUIRED at phase 8
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
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
    const result = spawnSync(
      process.execPath,
      [join(root, "scripts", "e2e-inventory-lint.mjs")],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(
      result.status,
      0,
      `test:e2e:inventory must pass:\n${result.stdout}\n${result.stderr}`,
    );
    assert.match(result.stdout, /OK/);
  });
});
