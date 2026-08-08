/**
 * Section 0.2 — Lumen design system lock named assertions.
 * Spec tests:
 * - assert lumen lock doc lists --lumen-focus-ring
 * - assert SVG rejected language present
 * - assert retheme blast radius public+portal only
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lockPath = join(root, "docs", "governance", "0.2-lumen-lock.md");
const contractsIndexPath = join(root, "docs", "CONTRACTS.md");
const initiativeLumenPath = join(
  root,
  "KMS-competition",
  "initiative",
  "01_DESIGN_SYSTEM_LUMEN.md",
);

describe("0.2 Lumen design system lock", () => {
  it("assert lumen lock doc exists", () => {
    assert.equal(
      existsSync(lockPath),
      true,
      "docs/governance/0.2-lumen-lock.md must exist",
    );
  });

  it("assert lumen lock doc lists --lumen-focus-ring", () => {
    const body = readFileSync(lockPath, "utf8");
    assert.match(
      body,
      /--lumen-focus-ring/,
      "lock must list --lumen-focus-ring (MF focus fold)",
    );
    assert.match(body, /--lumen-focus\b/, "lock must list --lumen-focus");
    assert.match(body, /--lumen-brand/, "lock must list brand token");
    assert.match(body, /--lumen-bg/, "lock must list background token");
  });

  it("assert SVG rejected language present", () => {
    const body = readFileSync(lockPath, "utf8");
    assert.match(
      body,
      /SVG rejected|SVG\b.*reject/i,
      "lock must state SVG rejected for logos in dogfood",
    );
    assert.match(
      body,
      /PNG|WebP|JPEG/,
      "lock must allow raster logo formats",
    );
    assert.match(
      body,
      /freeform CSS|no freeform/i,
      "lock must forbid freeform CSS/HTML theming",
    );
  });

  it("assert retheme blast radius public+portal only", () => {
    const body = readFileSync(lockPath, "utf8");
    assert.match(
      body,
      /retheme blast radius/i,
      "lock must name retheme blast radius",
    );
    assert.match(
      body,
      /Public CFP/i,
      "public CFP must retheme",
    );
    assert.match(
      body,
      /speaker portal/i,
      "speaker portal must retheme",
    );
    assert.match(
      body,
      /Admin(?:\s+\+?\s*evaluator|\s+chrome|\s+\+\s*evaluator)|admin \+ evaluator|Admin chrome/i,
      "admin chrome must stay Lumen default",
    );
    assert.match(
      body,
      /always Lumen default|stay Lumen default/i,
      "admin/evaluator must remain Lumen default",
    );
    // Ensure blast radius is not "everything rethemes"
    assert.match(
      body,
      /Public CFP \+ speaker portal only|public\+portal only|public \+ portal only|Public CFP \+ speaker portal/i,
    );
  });

  it("contrast gate rule is explicit (AA / block publish)", () => {
    const body = readFileSync(lockPath, "utf8");
    assert.match(body, /contrast gate|Contrast gate/i);
    assert.match(body, /\bAA\b|WCAG AA/);
    assert.match(body, /[Bb]lock publish|publish.*block|block.*publish/i);
  });

  it("component list includes schedule tile and Design Kit", () => {
    const body = readFileSync(lockPath, "utf8");
    assert.match(
      body,
      /[Ss]chedule tile/,
      "component checklist must include schedule tile",
    );
    assert.match(
      body,
      /[Dd]esign [Kk]it/,
      "component checklist must include Design Kit",
    );
    assert.match(body, /conflict tile/i);
    assert.match(body, /[Ss]tatus badges?/);
  });

  it("linked from standards E6 via CONTRACTS index and lock doc", () => {
    const lock = readFileSync(lockPath, "utf8");
    assert.match(lock, /\bE6\b/, "lock must reference engineering standards E6");
    assert.match(lock, /S-THEME/, "lock must reference S-THEME soul");

    assert.equal(existsSync(contractsIndexPath), true);
    const contracts = readFileSync(contractsIndexPath, "utf8");
    assert.match(
      contracts,
      /0\.2-lumen-lock\.md/,
      "docs/CONTRACTS.md must link 0.2-lumen-lock.md",
    );
    assert.match(
      contracts,
      /E6/,
      "docs/CONTRACTS.md must map E6 to Lumen lock",
    );
  });

  it("points at initiative Lumen source and does not implement app CSS", () => {
    const body = readFileSync(lockPath, "utf8");
    assert.match(body, /01_DESIGN_SYSTEM_LUMEN\.md/);
    assert.equal(
      existsSync(initiativeLumenPath),
      true,
      "initiative Lumen doc must exist",
    );
    assert.match(
      body,
      /no product CSS|Out of scope[\s\S]*Implementing CSS|not implemented in 0\.2/i,
    );
    assert.match(body, /dark mode/i);
  });

  it("includes human review checklist and AC proof map", () => {
    const body = readFileSync(lockPath, "utf8");
    assert.match(body, /Human review checklist/i);
    assert.match(body, /- \[ \]/, "must include unchecked review checkbox items");
    assert.match(body, /AC → proof|Acceptance criterion/i);
  });
});
