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
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runInventoryLint } from "../../scripts/e2e-inventory-lint.mjs";

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
const baselinePath = join(root, "scripts", "e2e-inventory-required-baseline.json");
const lintScriptPath = join(root, "scripts", "e2e-inventory-lint.mjs");

/** Format lint/spawn result for assertion messages. */
function fmtResult(r) {
  const status = r.status ?? r.exitCode;
  const err =
    r.error && typeof r.error === "object" && "message" in r.error
      ? r.error.message
      : r.error
        ? String(r.error)
        : "";
  return `status=${status} signal=${r.signal ?? ""}\nerror=${err}\nstdout=${r.stdout ?? ""}\nstderr=${r.stderr ?? ""}`;
}

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
    // CLI smoke: real process entry (no nested node:test context required).
    const childEnv = { ...process.env };
    delete childEnv.NODE_TEST_CONTEXT;
    delete childEnv.NODE_TEST_NAME;
    const result = spawnSync(process.execPath, [lintScriptPath], {
      cwd: root,
      encoding: "utf8",
      env: childEnv,
      timeout: 30_000,
    });
    assert.equal(
      result.status,
      0,
      `test:e2e:inventory must pass (exit 0):\n${fmtResult(result)}`,
    );
    if (result.stdout && result.stdout.length > 0) {
      assert.match(result.stdout, /OK/);
    }

    // In-process API must agree (pipeline-safe, no subprocess).
    const inProcess = runInventoryLint({ root, silent: true });
    assert.equal(
      inProcess.exitCode,
      0,
      `runInventoryLint must pass:\n${fmtResult(inProcess)}`,
    );
  });

  /**
   * In-process lint against a temp inventory mutation (no spawn).
   * Returns { status, stdout, stderr, exitCode }.
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

      const result = runInventoryLint({
        inventoryPath: badInvPath,
        baselinePath,
        e2eRoots: [], // status checks run before e2e; empty roots OK for OPEN-only
        silent: true,
      });
      return {
        status: result.exitCode,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      };
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
    const result = runLintAgainstMutatedInventory((inv) =>
      withA01Status(inv, "IMPLMENTED"),
    );
    assert.notEqual(
      result.status,
      0,
      `unrecognized status must fail lint:\n${fmtResult(result)}`,
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
    const result = runLintAgainstMutatedInventory((inv) => withA01Status(inv, ""));
    assert.notEqual(
      result.status,
      0,
      `blank status must fail lint:\n${fmtResult(result)}`,
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
    const result = runLintAgainstMutatedInventory((inv) =>
      withA01Status(inv, "IMPLEMENTED!"),
    );
    assert.notEqual(
      result.status,
      0,
      `non-word invalid status must fail lint:\n${fmtResult(result)}`,
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

  /**
   * Isolated probe workspace via in-process runInventoryLint (no nested spawn).
   * Avoids pipeline/subprocess fragility while pinning regression fixtures.
   */
  function runLintInProbe({
    inventoryMutate,
    ensureEmptyE2eRoot = false,
    e2eFiles = null,
    fullGate = false,
  }) {
    const probe = mkdtempSync(join(tmpdir(), "spo-e2e-probe-"));
    try {
      let inv = readFileSync(inventoryPath, "utf8");
      if (inventoryMutate) inv = inventoryMutate(inv);
      const invPath = join(probe, "BROWSER_E2E_INVENTORY.md");
      writeFileSync(invPath, inv, "utf8");

      const e2eDir = join(probe, "playwright", "e2e");
      /** @type {string[]} */
      let e2eRoots;
      if (e2eFiles) {
        mkdirSync(e2eDir, { recursive: true });
        for (const [name, body] of Object.entries(e2eFiles)) {
          const dest = join(e2eDir, name);
          mkdirSync(dirname(dest), { recursive: true });
          writeFileSync(dest, body, "utf8");
        }
        e2eRoots = [e2eDir];
      } else if (ensureEmptyE2eRoot) {
        mkdirSync(e2eDir, { recursive: true });
        e2eRoots = [e2eDir];
      } else {
        // Missing root: point at a non-existent path under the probe.
        e2eRoots = [join(probe, "playwright", "e2e")];
      }

      const result = runInventoryLint({
        inventoryPath: invPath,
        baselinePath,
        e2eRoots,
        fullGate,
        silent: true,
      });
      return {
        status: result.exitCode,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } finally {
      rmSync(probe, { recursive: true, force: true });
    }
  }

  function markA01Implemented(inv) {
    return inv.replace(/^(\| A01 \|.*\| REQUIRED \|) OPEN \|/m, "$1 IMPLEMENTED |");
  }

  /** Mark every inventory Status cell PASS (Phase 8 claim fixtures). */
  function markAllStatusesPass(inv) {
    return inv.replace(
      /^(\| [A-Z]\d{2} \|(?:[^|]*\|){6} )(?:OPEN|IMPLEMENTED|PASS|FAIL|DEFER) \|/gm,
      "$1PASS |",
    );
  }

  /**
   * Playwright-bound test source (import required — local no-op test() does not count).
   * @param {string} body statements after the import
   */
  function pwSource(body) {
    return `import { test } from '@playwright/test';\n${body}`;
  }

  /** Valid A01 fixture: Playwright-bound test() title with @inv + test_id anchor. */
  const a01RealTest = pwSource(
    'test("@inv:A01 e2e/public/cfp-load public CFP loads", async () => {});\n',
  );

  it("rejects empty intermediate E2E tree when IMPLEMENTED requires @inv", () => {
    const r = runLintInProbe({
      inventoryMutate: markA01Implemented,
      ensureEmptyE2eRoot: true,
    });
    assert.notEqual(
      r.status,
      0,
      `expected fail on empty e2e tree with IMPLEMENTED A01:\n${fmtResult(r)}`,
    );
    assert.match(
      `${r.stderr}\n${r.stdout}`,
      /no test files|@inv/i,
      `stderr/stdout must mention empty files or @inv:\n${fmtResult(r)}`,
    );
    assert.match(
      `${r.stderr}\n${r.stdout}`,
      /A01/,
      `must name the status-owned ID:\n${fmtResult(r)}`,
    );
  });

  it("rejects missing E2E root when IMPLEMENTED requires @inv", () => {
    const r = runLintInProbe({
      inventoryMutate: markA01Implemented,
      ensureEmptyE2eRoot: false,
    });
    assert.notEqual(
      r.status,
      0,
      `expected fail with no e2e root + IMPLEMENTED A01:\n${fmtResult(r)}`,
    );
    assert.match(
      `${r.stderr}\n${r.stdout}`,
      /no E2E root|@inv|no test files/i,
      `stderr/stdout must mention missing root or @inv:\n${fmtResult(r)}`,
    );
  });

  it("allows empty E2E root when all journeys remain OPEN", () => {
    const r = runLintInProbe({ ensureEmptyE2eRoot: true });
    assert.equal(
      r.status,
      0,
      `empty e2e + all OPEN must pass:\n${fmtResult(r)}`,
    );
  });

  it("rejects e2e files missing @inv for IMPLEMENTED row", () => {
    const r = runLintInProbe({
      inventoryMutate: markA01Implemented,
      e2eFiles: { "a.spec.ts": pwSource('test("untagged", async () => {});\n') },
    });
    assert.notEqual(
      r.status,
      0,
      `expected fail when files lack @inv:A01:\n${fmtResult(r)}`,
    );
    assert.match(`${r.stderr}\n${r.stdout}`, /missing @inv|A01/i);
  });

  it("accepts e2e files with @inv on Playwright-bound test() for IMPLEMENTED row", () => {
    const r = runLintInProbe({
      inventoryMutate: markA01Implemented,
      e2eFiles: {
        "public/cfp-load.spec.ts": a01RealTest,
      },
    });
    assert.equal(
      r.status,
      0,
      `expected pass with @inv:A01 on Playwright-bound test():\n${fmtResult(r)}`,
    );
  });

  it("accepts fixture rebind (test as base + base.extend) as Playwright-bound", () => {
    const r = runLintInProbe({
      inventoryMutate: markA01Implemented,
      e2eFiles: {
        "public/cfp-load.spec.ts":
          "import { test as base } from '@playwright/test';\n" +
          "const test = base.extend({});\n" +
          'test("@inv:A01 e2e/public/cfp-load via extend", async () => {});\n',
      },
    });
    assert.equal(
      r.status,
      0,
      `expected pass with base.extend rebind:\n${fmtResult(r)}`,
    );
  });

  it("rejects local no-op test() without Playwright import for IMPLEMENTED row", () => {
    const r = runLintInProbe({
      inventoryMutate: markA01Implemented,
      e2eFiles: {
        "public/cfp-load.spec.ts":
          "const test = (..._args) => {};\n" +
          'test("@inv:A01 e2e/public/cfp-load fake local", async () => {});\n',
      },
    });
    assert.notEqual(
      r.status,
      0,
      `local no-op test() must not satisfy @inv coverage:\n${fmtResult(r)}`,
    );
    assert.match(
      `${r.stderr}\n${r.stdout}`,
      /Playwright-bound|@playwright\/test|no-op|missing @inv|A01/i,
      `must explain non-Playwright test() rejection:\n${fmtResult(r)}`,
    );
  });

  it("rejects comment-only @inv tags for IMPLEMENTED row (not 1:1)", () => {
    const r = runLintInProbe({
      inventoryMutate: markA01Implemented,
      e2eFiles: {
        "tags-only.spec.ts":
          pwSource("// @inv:A01 comment is not a Playwright test\n"),
      },
    });
    assert.notEqual(
      r.status,
      0,
      `comment-only @inv must fail:\n${fmtResult(r)}`,
    );
    assert.match(
      `${r.stderr}\n${r.stdout}`,
      /outside|comments|missing @inv|A01|no-op/i,
      `must explain comment-only failure:\n${fmtResult(r)}`,
    );
  });

  it("rejects skipped-only @inv coverage for IMPLEMENTED row", () => {
    const r = runLintInProbe({
      inventoryMutate: markA01Implemented,
      e2eFiles: {
        "public/cfp-load.spec.ts": pwSource(
          'test.skip("@inv:A01 e2e/public/cfp-load skipped", async () => {});\n',
        ),
      },
    });
    assert.notEqual(
      r.status,
      0,
      `test.skip-only @inv must fail:\n${fmtResult(r)}`,
    );
    assert.match(
      `${r.stderr}\n${r.stdout}`,
      /skipped|fixme|fail|A01/i,
      `must explain skip-only failure:\n${fmtResult(r)}`,
    );
  });

  it("rejects test.fail()-only @inv coverage for IMPLEMENTED row (not dogfood proof)", () => {
    const r = runLintInProbe({
      inventoryMutate: markA01Implemented,
      e2eFiles: {
        "public/cfp-load.spec.ts": pwSource(
          'test.fail("@inv:A01 e2e/public/cfp-load expected failure", async () => {});\n',
        ),
      },
    });
    assert.notEqual(
      r.status,
      0,
      `test.fail-only @inv must fail:\n${fmtResult(r)}`,
    );
    assert.match(
      `${r.stderr}\n${r.stdout}`,
      /skipped|fixme|fail|expected-failure|A01/i,
      `must explain test.fail-only failure:\n${fmtResult(r)}`,
    );
  });

  it("rejects multi-@inv tag on a single test() title (breaks 1:1 map)", () => {
    const r = runLintInProbe({
      inventoryMutate: (inv) =>
        inv
          .replace(/^(\| A01 \|.*\| REQUIRED \|) OPEN \|/m, "$1 IMPLEMENTED |")
          .replace(/^(\| A02 \|.*\| REQUIRED \|) OPEN \|/m, "$1 IMPLEMENTED |"),
      e2eFiles: {
        "public/cfp-load.spec.ts": pwSource(
          'test("@inv:A01 @inv:A02 e2e/public/cfp-load multi", async () => {});\n',
        ),
      },
    });
    assert.notEqual(
      r.status,
      0,
      `multi-@inv on one test() must fail 1:1 map:\n${fmtResult(r)}`,
    );
    assert.match(
      `${r.stderr}\n${r.stdout}`,
      /multiple @inv|1:1|multi/i,
      `must explain multi-tag rejection:\n${fmtResult(r)}`,
    );
  });

  it("rejects @inv not anchored to inventory test_id", () => {
    const r = runLintInProbe({
      inventoryMutate: markA01Implemented,
      e2eFiles: {
        "wrong-name.spec.ts": pwSource(
          'test("@inv:A01 unrelated title without path anchor", async () => {});\n',
        ),
      },
    });
    assert.notEqual(
      r.status,
      0,
      `wrong test_id anchor must fail:\n${fmtResult(r)}`,
    );
    assert.match(
      `${r.stderr}\n${r.stdout}`,
      /test_id|anchored|A01/i,
      `must explain test_id mismatch:\n${fmtResult(r)}`,
    );
  });

  it("Phase 8 gate rejects OPEN statuses even with full Playwright-bound @inv map", () => {
    // Auditor regression: 108 tagged real-looking tests must not green-wash
    // inventory rows that are still OPEN at the Phase 8 gate.
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    const ids = baseline.required_ids;
    assert.equal(ids.length, 108, "baseline must list 108 REQUIRED IDs");
    const body =
      ids
        .map((id) => {
          const testId = baseline.fingerprints[id]?.test_id || id;
          return `test(${JSON.stringify(`@inv:${id} ${testId}`)}, async () => {});`;
        })
        .join("\n") + "\n";
    const r = runLintInProbe({
      // inventory left all-OPEN (canonical Phase 0 state)
      e2eFiles: { "all-open-but-tagged.spec.ts": pwSource(body) },
      fullGate: true,
    });
    assert.notEqual(
      r.status,
      0,
      `phase8 must fail when REQUIRED rows are not PASS:\n${fmtResult(r)}`,
    );
    assert.match(
      `${r.stderr}\n${r.stdout}`,
      /must have status PASS|not PASS|Phase 8 full gate/i,
      `phase8 must diagnose non-PASS status:\n${fmtResult(r)}`,
    );
  });

  
  
  it("rejects nested template-expression string import spoof", () => {
    const r = runLintInProbe({
      inventoryMutate: markA01Implemented,
      e2eFiles: {
        "public/cfp-load.spec.ts":
          "const decoy = `${\"import { test as fake } from '@playwright/test'\"}`;\n" +
          'fake("@inv:A01 e2e/public/cfp-load nested spoof", async () => {});\n',
      },
    });
    assert.notEqual(
      r.status,
      0,
      `nested template string spoof must fail:\n${fmtResult(r)}`,
    );
  });

  it("rejects bare reassignment of Playwright test binding", () => {
    const r = runLintInProbe({
      inventoryMutate: markA01Implemented,
      e2eFiles: {
        "public/cfp-load.spec.ts":
          "import { test } from '@playwright/test';\n" +
          "test = (..._args) => {};\n" +
          'test("@inv:A01 e2e/public/cfp-load bare reassigned", async () => {});\n',
      },
    });
    assert.notEqual(
      r.status,
      0,
      `bare reassignment of test must fail:\n${fmtResult(r)}`,
    );
  });

  it("Phase 8 gate rejects string-literal import spoof + local test rebinding", () => {
    // Auditor regression: decoy string containing import text must not count
    // as a Playwright binding when the real `test` is a local no-op.
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    const ids = baseline.required_ids;
    assert.equal(ids.length, 108, "baseline must list 108 REQUIRED IDs");
    const spoofBody =
      'const decoy = "import { test } from \'@playwright/test\'";\n' +
      "const test = (..._args) => {};\n" +
      ids
        .map((id) => {
          const testId = baseline.fingerprints[id]?.test_id || id;
          return `test(${JSON.stringify(`@inv:${id} ${testId}`)}, async () => {});`;
        })
        .join("\n") +
      "\n";
    const r = runLintInProbe({
      inventoryMutate: markAllStatusesPass,
      e2eFiles: { "string-spoof-import.spec.ts": spoofBody },
      fullGate: true,
    });
    assert.notEqual(
      r.status,
      0,
      `phase8 must not accept string-spoofed import + local test():\n${fmtResult(r)}`,
    );
    assert.match(
      `${r.stderr}\n${r.stdout}`,
      /Playwright-bound|@playwright\/test|no-op|missing @inv/i,
      `phase8 must diagnose string-spoofed import:\n${fmtResult(r)}`,
    );
  });

  it("rejects real import shadowed by local const test = noop", () => {
    const r = runLintInProbe({
      inventoryMutate: markA01Implemented,
      e2eFiles: {
        "public/cfp-load.spec.ts":
          "import { test as base } from '@playwright/test';\n" +
          "const test = (..._args) => {};\n" +
          'test("@inv:A01 e2e/public/cfp-load shadowed", async () => {});\n',
      },
    });
    assert.notEqual(
      r.status,
      0,
      `shadowed Playwright binding must not satisfy @inv:\n${fmtResult(r)}`,
    );
  });

  it("Phase 8 gate rejects local no-op test() map even when all statuses are PASS", () => {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    const ids = baseline.required_ids;
    assert.equal(ids.length, 108, "baseline must list 108 REQUIRED IDs");
    const fakeBody =
      "const test = (..._args) => {};\n" +
      ids
        .map((id) => {
          const testId = baseline.fingerprints[id]?.test_id || id;
          return `test(${JSON.stringify(`@inv:${id} ${testId}`)}, async () => {});`;
        })
        .join("\n") +
      "\n";
    const r = runLintInProbe({
      inventoryMutate: markAllStatusesPass,
      e2eFiles: { "fake-local-test.spec.ts": fakeBody },
      fullGate: true,
    });
    assert.notEqual(
      r.status,
      0,
      `phase8 must not accept local no-op test() as Playwright coverage:\n${fmtResult(r)}`,
    );
    assert.match(
      `${r.stderr}\n${r.stdout}`,
      /Playwright-bound|@playwright\/test|no-op|missing @inv/i,
      `phase8 must diagnose non-Playwright test():\n${fmtResult(r)}`,
    );
  });

  it("Phase 8 gate rejects comment-only tags for all REQUIRED IDs", () => {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    const ids = baseline.required_ids;
    assert.equal(ids.length, 108, "baseline must list 108 REQUIRED IDs");
    const comments =
      pwSource(ids.map((id) => `// @inv:${id}`).join("\n") + "\n");
    const r = runLintInProbe({
      inventoryMutate: markAllStatusesPass,
      e2eFiles: { "comments-only.spec.ts": comments },
      fullGate: true,
    });
    assert.notEqual(
      r.status,
      0,
      `phase8 must not accept 108 comment-only tags:\n${fmtResult(r)}`,
    );
    assert.match(
      `${r.stderr}\n${r.stdout}`,
      /outside|comments|missing @inv|no-op|Playwright-bound/i,
      `phase8 diagnostics for comment-only:\n${fmtResult(r)}`,
    );
  });

  it("Phase 8 gate fails when E2E root is empty (coverage not deferred)", () => {
    // Status PASS alone is insufficient — empty tree still fails tag coverage.
    const r = runLintInProbe({
      inventoryMutate: markAllStatusesPass,
      ensureEmptyE2eRoot: true,
      fullGate: true,
    });
    assert.notEqual(
      r.status,
      0,
      `phase8 empty tree must fail:\n${fmtResult(r)}`,
    );
  });

  it("rejects duplicate active @inv owners for the same ID", () => {
    const r = runLintInProbe({
      inventoryMutate: markA01Implemented,
      e2eFiles: {
        "public/cfp-load.spec.ts": pwSource(
          'test("@inv:A01 e2e/public/cfp-load first", async () => {});\n' +
            'test("@inv:A01 e2e/public/cfp-load second", async () => {});\n',
        ),
      },
    });
    assert.notEqual(
      r.status,
      0,
      `duplicate @inv:A01 must fail 1:1 map:\n${fmtResult(r)}`,
    );
    assert.match(
      `${r.stderr}\n${r.stdout}`,
      /duplicate|1:1|A01/i,
      `must explain duplicate owners:\n${fmtResult(r)}`,
    );
  });

  it("Phase 8 gate rejects single test() owning all REQUIRED @inv tags", () => {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    const ids = baseline.required_ids;
    assert.equal(ids.length, 108, "baseline must list 108 REQUIRED IDs");
    // Mega-title: every @inv + every test_id string (auditor greenwash probe).
    const tags = ids.map((id) => `@inv:${id}`).join(" ");
    const testIds = ids
      .map((id) => baseline.fingerprints[id]?.test_id)
      .filter(Boolean)
      .join(" ");
    const megaTitle = `${tags} ${testIds} all journeys`;
    const r = runLintInProbe({
      inventoryMutate: markAllStatusesPass,
      e2eFiles: {
        "mega-all.spec.ts": pwSource(
          `test(${JSON.stringify(megaTitle)}, async () => {});\n`,
        ),
      },
      fullGate: true,
    });
    assert.notEqual(
      r.status,
      0,
      `phase8 must not accept one test owning 108 @inv tags:\n${fmtResult(r)}`,
    );
    assert.match(
      `${r.stderr}\n${r.stdout}`,
      /multiple @inv|1:1|multi/i,
      `phase8 multi-tag diagnostics:\n${fmtResult(r)}`,
    );
  });

  it("Phase 8 gate rejects test.fail() as active coverage for all REQUIRED IDs", () => {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    const ids = baseline.required_ids;
    assert.equal(ids.length, 108, "baseline must list 108 REQUIRED IDs");
    const body =
      ids
        .map((id) => {
          const testId = baseline.fingerprints[id]?.test_id || id;
          return `test.fail(${JSON.stringify(`@inv:${id} ${testId}`)}, async () => {});`;
        })
        .join("\n") + "\n";
    const r = runLintInProbe({
      inventoryMutate: markAllStatusesPass,
      e2eFiles: { "all-fail.spec.ts": pwSource(body) },
      fullGate: true,
    });
    assert.notEqual(
      r.status,
      0,
      `phase8 must not accept 108 test.fail() declarations as coverage:\n${fmtResult(r)}`,
    );
    assert.match(
      `${r.stderr}\n${r.stdout}`,
      /skipped|fixme|fail|expected-failure|not executable/i,
      `phase8 test.fail diagnostics:\n${fmtResult(r)}`,
    );
  });

  it("Phase 8 gate accepts full PASS inventory + 1:1 Playwright-bound @inv map", () => {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    const ids = baseline.required_ids;
    assert.equal(ids.length, 108, "baseline must list 108 REQUIRED IDs");
    const body =
      ids
        .map((id) => {
          const testId = baseline.fingerprints[id]?.test_id || id;
          return `test(${JSON.stringify(`@inv:${id} ${testId}`)}, async () => {});`;
        })
        .join("\n") + "\n";
    const r = runLintInProbe({
      inventoryMutate: markAllStatusesPass,
      e2eFiles: { "full-map.spec.ts": pwSource(body) },
      fullGate: true,
    });
    assert.equal(
      r.status,
      0,
      `phase8 must pass with PASS statuses + Playwright-bound 1:1 map:\n${fmtResult(r)}`,
    );
  });
});
