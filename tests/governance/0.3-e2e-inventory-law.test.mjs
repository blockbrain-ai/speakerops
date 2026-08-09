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
import {
  runInventoryLint,
  isPlaywrightRebindRhs,
  extractPlaywrightTestBindings,
  extractInvTaggedTests,
  normalizePlaywrightSuite,
  suiteHasExecutionOutcomes,
  suiteIsExecutionRunReport,
  isPlaywrightListDiscoverySource,
  isPassedNonSkippedResult,
  isSkippedExecutionResult,
  resolvePlaywrightRunReport,
} from "../../scripts/e2e-inventory-lint.mjs";

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
    // Start from all-OPEN so live IMPLEMENTED rows (B01+) do not skew fixtures.
    const inv = resetAllJourneyStatusesToOpen(readFileSync(inventoryPath, "utf8"));
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
   * Probe inventories must not inherit live IMPLEMENTED/PASS rows from the
   * workspace inventory (e.g. B01–B03 after section 2.1). Fixtures assert
   * specific status transitions from a clean all-OPEN baseline.
   */
  function resetAllJourneyStatusesToOpen(inv) {
    return inv.replace(
      /(\|\s*REQUIRED\s*\|\s*)(OPEN|IMPLEMENTED|PASS|FAIL|DEFER)(\s*\|)/gi,
      "$1OPEN$3",
    );
  }

  /**
   * Isolated probe workspace via in-process runInventoryLint (no nested spawn).
   * Avoids pipeline/subprocess fragility while pinning regression fixtures.
   */
  function runLintInProbe({
    inventoryMutate,
    ensureEmptyE2eRoot = false,
    e2eFiles = null,
    fullGate = false,
    constitutionBody = null,
    playwrightSuite = null,
    baselinePathOverride = null,
    suiteReportBody = null,
  }) {
    const probe = mkdtempSync(join(tmpdir(), "spo-e2e-probe-"));
    try {
      let inv = resetAllJourneyStatusesToOpen(readFileSync(inventoryPath, "utf8"));
      if (inventoryMutate) inv = inventoryMutate(inv);
      const invPath = join(probe, "BROWSER_E2E_INVENTORY.md");
      writeFileSync(invPath, inv, "utf8");

      /** @type {string | undefined} */
      let constitutionPath;
      if (constitutionBody != null) {
        constitutionPath = join(probe, "00_CONSTITUTION.md");
        writeFileSync(constitutionPath, constitutionBody, "utf8");
      }

      const e2eDir = join(probe, "playwright", "e2e");
      /** @type {string[]} */
      let e2eRoots;
      /** @type {Record<string, string>} */
      const writtenAbs = {};
      if (e2eFiles) {
        mkdirSync(e2eDir, { recursive: true });
        for (const [name, body] of Object.entries(e2eFiles)) {
          const dest = join(e2eDir, name);
          mkdirSync(dirname(dest), { recursive: true });
          writeFileSync(dest, body, "utf8");
          writtenAbs[name] = dest;
        }
        e2eRoots = [e2eDir];
      } else if (ensureEmptyE2eRoot) {
        mkdirSync(e2eDir, { recursive: true });
        e2eRoots = [e2eDir];
      } else {
        // Missing root: point at a non-existent path under the probe.
        e2eRoots = [join(probe, "playwright", "e2e")];
      }

      /** @type {unknown} */
      let suite = playwrightSuite;
      if (typeof playwrightSuite === "function") {
        suite = playwrightSuite({ e2eDir, writtenAbs, probe });
      }

      /** @type {string | undefined} */
      let suiteReportPath;
      if (suiteReportBody != null) {
        suiteReportPath = join(probe, "playwright-suite-report.json");
        const body =
          typeof suiteReportBody === "function"
            ? suiteReportBody({ e2eDir, writtenAbs, probe })
            : suiteReportBody;
        writeFileSync(
          suiteReportPath,
          typeof body === "string" ? body : JSON.stringify(body),
          "utf8",
        );
      }

      const result = runInventoryLint({
        // Isolate default report path (reports/playwright-run.json) to the probe
        // so monorepo run artifacts cannot green-wash or shadow list-only fixtures.
        root: probe,
        inventoryPath: invPath,
        baselinePath: baselinePathOverride || baselinePath,
        e2eRoots,
        fullGate,
        silent: true,
        allowPlaywrightCli: false,
        ...(constitutionPath ? { constitutionPath } : {}),
        ...(suite != null ? { playwrightSuite: suite } : {}),
        ...(suiteReportPath ? { suiteReportPath } : {}),
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

  /** Minimal constitution Article 0 DEFER table authorizing the given inventory IDs. */
  function constitutionWithOwnerDefers(ids) {
    const rows = ids
      .map(
        (id) =>
          `| ${id} | owner-approved defer for inventory gate test | 2026-08-08 | owner |`,
      )
      .join("\n");
    return (
      `# Constitution\n\n` +
      `**DEFER rows** (owner only; not PASS):\n\n` +
      `| Soul / item | Reason | Date | Owner |\n` +
      `|-------------|--------|------|-------|\n` +
      `${rows || "| *(none yet)* | | | |"}\n`
    );
  }

  function markA01Implemented(inv) {
    return inv.replace(/^(\| A01 \|.*\| REQUIRED \|) OPEN \|/m, "$1 IMPLEMENTED |");
  }

  /** Mark every inventory Status cell PASS (Phase 8 claim fixtures). */
  function markAllStatusesPass(inv) {
    return inv.replace(
      /^(\| (?:[A-Z]\d{2}|L2-\d{2}) \|(?:[^|]*\|){6} )(?:OPEN|IMPLEMENTED|PASS|FAIL|DEFER) \|/gm,
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

  it("accepts typed fixture rebind (base.extend<MyFixtures>) as Playwright-bound", () => {
    // Auditor regression: TypeScript generic args on .extend must not break
    // Playwright binding detection (const test = base.extend<MyFixtures>({...})).
    const r = runLintInProbe({
      inventoryMutate: markA01Implemented,
      e2eFiles: {
        "public/cfp-load.spec.ts":
          "import { test as base } from '@playwright/test';\n" +
          "type MyFixtures = { foo: string };\n" +
          "const test = base.extend<MyFixtures>({\n" +
          "  foo: async ({}, use) => { await use('x'); },\n" +
          "});\n" +
          'test("@inv:A01 e2e/public/cfp-load typed extend", async () => {});\n',
      },
    });
    assert.equal(
      r.status,
      0,
      `expected pass with base.extend<MyFixtures> rebind:\n${fmtResult(r)}`,
    );
  });

  it("accepts nested generic fixture rebind (base.extend<Foo<Bar>>)", () => {
    const r = runLintInProbe({
      inventoryMutate: markA01Implemented,
      e2eFiles: {
        "public/cfp-load.spec.ts":
          "import { test as base } from '@playwright/test';\n" +
          "const test = base.extend<Foo<Bar>>({});\n" +
          'test("@inv:A01 e2e/public/cfp-load nested generic extend", async () => {});\n',
      },
    });
    assert.equal(
      r.status,
      0,
      `expected pass with nested generic extend:\n${fmtResult(r)}`,
    );
  });

  it("accepts multi-arg generic fixture rebind (base.extend<Foo, Bar>)", () => {
    // Auditor regression: commas inside type arguments must not truncate the
    // rebind RHS (prior replace(/[;,].*$/, "") rejected multi-generic forms).
    const r = runLintInProbe({
      inventoryMutate: markA01Implemented,
      e2eFiles: {
        "public/cfp-load.spec.ts":
          "import { test as base } from '@playwright/test';\n" +
          "const test = base.extend<Foo, Bar>({});\n" +
          'test("@inv:A01 e2e/public/cfp-load multi-arg generic extend", async () => {});\n',
      },
    });
    assert.equal(
      r.status,
      0,
      `expected pass with base.extend<Foo, Bar> rebind:\n${fmtResult(r)}`,
    );
  });

  it("accepts single-line fixture callback with commas as Playwright-bound", () => {
    // Auditor regression: commas/semicolons inside fixture object literals and
    // callbacks (e.g. async ({}, use) => …) must remain Playwright bindings.
    const r = runLintInProbe({
      inventoryMutate: markA01Implemented,
      e2eFiles: {
        "public/cfp-load.spec.ts":
          "import { test as base } from '@playwright/test';\n" +
          "const test = base.extend({ foo: async ({}, use) => { await use('x'); }, bar: 1 });\n" +
          'test("@inv:A01 e2e/public/cfp-load single-line fixture commas", async () => {});\n',
      },
    });
    assert.equal(
      r.status,
      0,
      `expected pass with single-line fixture commas:\n${fmtResult(r)}`,
    );
  });

  it("isPlaywrightRebindRhs keeps multi-generic and fixture commas intact", () => {
    const bindings = new Set(["base"]);
    assert.equal(isPlaywrightRebindRhs("base.extend({})", bindings), true);
    assert.equal(isPlaywrightRebindRhs("base.extend({});", bindings), true);
    assert.equal(
      isPlaywrightRebindRhs("base.extend<MyFixtures>({})", bindings),
      true,
    );
    assert.equal(
      isPlaywrightRebindRhs("base.extend<Foo, Bar>({})", bindings),
      true,
      "two type arguments must not be truncated at comma",
    );
    assert.equal(
      isPlaywrightRebindRhs("base.extend<Foo<Bar>>({})", bindings),
      true,
    );
    assert.equal(
      isPlaywrightRebindRhs(
        "base.extend({ foo: async ({}, use) => { await use('x'); }, bar: 1 })",
        bindings,
      ),
      true,
      "fixture object commas/semicolons must not reject rebind",
    );
    assert.equal(
      isPlaywrightRebindRhs("base.extend({ a: 1, b: 2 })", bindings),
      true,
    );
    assert.equal(isPlaywrightRebindRhs("base", bindings), true);
    assert.equal(isPlaywrightRebindRhs("(...args) => {}", bindings), false);
    assert.equal(isPlaywrightRebindRhs("other.extend({})", bindings), false);

    const multiGenericSrc =
      "import { test as base } from '@playwright/test';\n" +
      "const test = base.extend<Foo, Bar>({ foo: async ({}, use) => { await use('x'); } });\n";
    const found = extractPlaywrightTestBindings(multiGenericSrc);
    assert.equal(
      found.has("test"),
      true,
      `expected test binding from multi-generic single-line fixture, got: ${[...found].join(",")}`,
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

  it("extractPlaywrightTestBindings rejects import type { test } (type-only)", () => {
    // Auditor regression: top-level `import type` is erased at runtime and must
    // not be treated as a Playwright binding (prior regex allowed optional type).
    const typeOnly = "import type { test } from '@playwright/test';\n";
    const typeOnlyAs =
      "import type { test as base } from '@playwright/test';\n" +
      "const test = base.extend({});\n";
    const typeOnlyDouble =
      'import type { test } from "@playwright/test";\n';
    const inlineTypeOnly =
      "import { type test } from '@playwright/test';\n";
    const valueImport = "import { test } from '@playwright/test';\n";
    const mixedValueAndType =
      "import { type expect, test } from '@playwright/test';\n";

    assert.equal(
      extractPlaywrightTestBindings(typeOnly).size,
      0,
      "import type { test } must yield no bindings",
    );
    assert.equal(
      extractPlaywrightTestBindings(typeOnlyAs).has("test"),
      false,
      "import type { test as base } + rebind must not create test binding",
    );
    assert.equal(
      extractPlaywrightTestBindings(typeOnlyAs).has("base"),
      false,
      "import type { test as base } must not bind base",
    );
    assert.equal(
      extractPlaywrightTestBindings(typeOnlyDouble).size,
      0,
      'import type { test } with double quotes must yield no bindings',
    );
    assert.equal(
      extractPlaywrightTestBindings(inlineTypeOnly).size,
      0,
      "import { type test } must yield no bindings",
    );
    assert.equal(
      extractPlaywrightTestBindings(valueImport).has("test"),
      true,
      "value import { test } must still bind test",
    );
    assert.equal(
      extractPlaywrightTestBindings(mixedValueAndType).has("test"),
      true,
      "mixed import { type expect, test } must still bind value test",
    );
  });

  it("rejects import type { test } as Playwright-bound coverage for IMPLEMENTED row", () => {
    // Tagged spec with type-only import must fail intermediate gate — `test` is
    // erased at runtime and the file cannot compile or collect.
    const r = runLintInProbe({
      inventoryMutate: markA01Implemented,
      e2eFiles: {
        "public/cfp-load.spec.ts":
          "import type { test } from '@playwright/test';\n" +
          'test("@inv:A01 e2e/public/cfp-load type-only import", async () => {});\n',
      },
    });
    assert.notEqual(
      r.status,
      0,
      `import type { test } must not satisfy @inv coverage:\n${fmtResult(r)}`,
    );
    assert.match(
      `${r.stderr}\n${r.stdout}`,
      /Playwright-bound|@playwright\/test|no-op|missing @inv|A01/i,
      `must explain type-only import rejection:\n${fmtResult(r)}`,
    );
  });

  it("rejects import { type test } inline type-only as Playwright-bound coverage", () => {
    const r = runLintInProbe({
      inventoryMutate: markA01Implemented,
      e2eFiles: {
        "public/cfp-load.spec.ts":
          "import { type test } from '@playwright/test';\n" +
          'test("@inv:A01 e2e/public/cfp-load inline type-only", async () => {});\n',
      },
    });
    assert.notEqual(
      r.status,
      0,
      `import { type test } must not satisfy @inv coverage:\n${fmtResult(r)}`,
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
    // Auditor regression: full baseline tagged real-looking tests must not green-wash
    // inventory rows that are still OPEN at the Phase 8 gate.
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    const ids = baseline.required_ids;
    assert.ok(ids.length >= 110, `baseline must not shrink below 110 (got ${ids.length})`);
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

  it("Phase 8 gate rejects mass DEFER without owner amendments (anti greenwash)", () => {
    // Auditor critical: marking all baseline rows DEFER + one empty placeholder
    // test file must NOT yield "0 non-DEFER REQUIRED rows are PASS".
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    const ids = baseline.required_ids;
    assert.ok(ids.length >= 110, `baseline must not shrink below 110 (got ${ids.length})`);
    const r = runLintInProbe({
      inventoryMutate: (inv) =>
        inv.replace(
          /^(\| (?:[A-Z]\d{2}|L2-\d{2}) \|(?:[^|]*\|){6} )(?:OPEN|IMPLEMENTED|PASS|FAIL|DEFER) \|/gm,
          "$1DEFER |",
        ),
      e2eFiles: {
        "placeholder.spec.ts":
          "import { test } from '@playwright/test';\n" +
          'test("empty placeholder", async () => {});\n',
      },
      fullGate: true,
      // Explicit empty owner table — no authorized DEFER
      constitutionBody: constitutionWithOwnerDefers([]),
    });
    assert.notEqual(
      r.status,
      0,
      `phase8 must fail mass DEFER without owner amendment:\n${fmtResult(r)}`,
    );
    assert.match(
      `${r.stderr}\n${r.stdout}`,
      /owner amendment|unauthorized DEFER|DEFER without owner/i,
      `phase8 must diagnose unauthorized DEFER:\n${fmtResult(r)}`,
    );
  });

  it("rejects single inventory DEFER without constitution owner amendment", () => {
    const r = runLintInProbe({
      inventoryMutate: (inv) =>
        inv.replace(/^(\| A01 \|.*\| REQUIRED \|) OPEN \|/m, "$1 DEFER |"),
      constitutionBody: constitutionWithOwnerDefers([]),
    });
    assert.notEqual(
      r.status,
      0,
      `unauthorized A01 DEFER must fail:\n${fmtResult(r)}`,
    );
    assert.match(
      `${r.stderr}\n${r.stdout}`,
      /owner amendment|A01/i,
      `must name unauthorized DEFER ID:\n${fmtResult(r)}`,
    );
  });

  it("Phase 8 gate exempts owner-authorized DEFER from PASS set", () => {
    // A01 DEFER with constitution record; all other rows PASS + @inv map + run report.
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    const ids = baseline.required_ids.filter((id) => id !== "A01");
    const body =
      ids
        .map((id) => {
          const testId = baseline.fingerprints[id]?.test_id || id;
          return `test(${JSON.stringify(`@inv:${id} ${testId}`)}, async () => {});`;
        })
        .join("\n") + "\n";
    const r = runLintInProbe({
      inventoryMutate: (inv) => {
        let out = markAllStatusesPass(inv);
        out = out.replace(
          /^(\| A01 \|.*\| REQUIRED \|) PASS \|/m,
          "$1 DEFER |",
        );
        return out;
      },
      e2eFiles: { "full-map-minus-a01.spec.ts": pwSource(body) },
      fullGate: true,
      constitutionBody: constitutionWithOwnerDefers(["A01"]),
      // Phase 8 requires actual run-report outcomes (not collection-only).
      playwrightSuite: ({ writtenAbs }) => ({
        source: "test-run-report",
        entries: ids.map((id) => {
          const testId = baseline.fingerprints[id]?.test_id || id;
          return {
            file: writtenAbs["full-map-minus-a01.spec.ts"],
            title: `@inv:${id} ${testId}`,
            status: "passed",
            outcome: "passed",
          };
        }),
      }),
    });
    assert.equal(
      r.status,
      0,
      `phase8 must pass with owner-authorized A01 DEFER + rest PASS:\n${fmtResult(r)}`,
    );
    assert.match(
      `${r.stdout}`,
      /owner-authorized DEFER|authorized by owner amendment/i,
      `stdout should note owner DEFER exemption:\n${fmtResult(r)}`,
    );
  });

  it("rejects DEFER with empty reason/date/owner placeholder amendment", () => {
    const r = runLintInProbe({
      inventoryMutate: (inv) =>
        inv.replace(/^(\| A01 \|.*\| REQUIRED \|) OPEN \|/m, "$1 DEFER |"),
      constitutionBody:
        `# Constitution\n\n` +
        `**DEFER rows** (owner only; not PASS):\n\n` +
        `| Soul / item | Reason | Date | Owner |\n` +
        `|-------------|--------|------|-------|\n` +
        `| A01 | | | |\n`,
    });
    assert.notEqual(
      r.status,
      0,
      `empty amendment fields must not authorize DEFER:\n${fmtResult(r)}`,
    );
    assert.match(
      `${r.stderr}\n${r.stdout}`,
      /owner amendment|A01/i,
      `must reject empty-field DEFER amendment:\n${fmtResult(r)}`,
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

  
  it("Phase 8 rejects stringified test() decoy calls when real import present", () => {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    const ids = baseline.required_ids;
    const decoys =
      "import { test } from '@playwright/test';\n" +
      ids
        .map((id) => {
          const testId = baseline.fingerprints[id]?.test_id || id;
          const call = `test(${JSON.stringify(`@inv:${id} ${testId}`)}, async () => {});`;
          return `const s_${id} = ${JSON.stringify(call)};`;
        })
        .join("\n") +
      "\n";
    const r = runLintInProbe({
      inventoryMutate: markAllStatusesPass,
      e2eFiles: { "stringified-decoy.spec.ts": decoys },
      fullGate: true,
    });
    assert.notEqual(
      r.status,
      0,
      `stringified test() decoys must not satisfy phase8:\n${fmtResult(r)}`,
    );
  });

  it("Phase 8 gate rejects string-literal import spoof + local test rebinding", () => {
    // Auditor regression: decoy string containing import text must not count
    // as a Playwright binding. Uses identifier RHS (`noop`) so shadow-via-paren
    // alone cannot be the only defence — import masking must reject the decoy.
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    const ids = baseline.required_ids;
    assert.ok(ids.length >= 110, `baseline must not shrink below 110 (got ${ids.length})`);
    const spoofBody =
      'const decoy = "import { test } from \'@playwright/test\'";\n' +
      "const test = noop;\n" +
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

  it("Phase 8 gate rejects bare decoy-import string with tagged test() calls", () => {
    // Stronger spoof: import text only inside a string; no local binding.
    // Static regex must not treat the decoy as a Playwright import.
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    const ids = baseline.required_ids;
    const spoofBody =
      'const decoy = "import { test } from \'@playwright/test\'";\n' +
      ids
        .map((id) => {
          const testId = baseline.fingerprints[id]?.test_id || id;
          return `test(${JSON.stringify(`@inv:${id} ${testId}`)}, async () => {});`;
        })
        .join("\n") +
      "\n";
    const r = runLintInProbe({
      inventoryMutate: markAllStatusesPass,
      e2eFiles: { "decoy-import-only.spec.ts": spoofBody },
      fullGate: true,
    });
    assert.notEqual(
      r.status,
      0,
      `phase8 must not accept decoy-import string alone as Playwright binding:\n${fmtResult(r)}`,
    );
  });

  it("rejects @inv that appears only inside a string despite real Playwright import", () => {
    // Call site must be outside strings — string-embedded test("@inv:…") is not coverage.
    const r = runLintInProbe({
      inventoryMutate: markA01Implemented,
      e2eFiles: {
        "public/cfp-load.spec.ts":
          "import { test } from '@playwright/test';\n" +
          'const decoy = \'test("@inv:A01 e2e/public/cfp-load", async () => {})\';\n',
      },
    });
    assert.notEqual(
      r.status,
      0,
      `string-embedded test("@inv") must not satisfy coverage:\n${fmtResult(r)}`,
    );
    assert.match(
      `${r.stderr}\n${r.stdout}`,
      /outside|comments|missing @inv|no-op|Playwright-bound|A01/i,
      `must diagnose string-only @inv:\n${fmtResult(r)}`,
    );
  });

  it("accepts real test() when a string contains shadow/import decoy text", () => {
    // Anti-oscillation: string interiors must not unbind a real import or hide a real call.
    const r = runLintInProbe({
      inventoryMutate: markA01Implemented,
      e2eFiles: {
        "public/cfp-load.spec.ts":
          "import { test } from '@playwright/test';\n" +
          'const shadowDecoy = "const test = (";\n' +
          'const importDecoy = "import { test } from \'@playwright/test\'";\n' +
          'test("@inv:A01 e2e/public/cfp-load real despite decoys", async () => {});\n',
      },
    });
    assert.equal(
      r.status,
      0,
      `real Playwright test must pass despite decoy strings:\n${fmtResult(r)}`,
    );
  });

  it("rejects real import shadowed by local const test = noop", () => {
    const r = runLintInProbe({
      inventoryMutate: markA01Implemented,
      e2eFiles: {
        "public/cfp-load.spec.ts":
          "import { test } from '@playwright/test';\n" +
          "const test = noop;\n" +
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
    assert.ok(ids.length >= 110, `baseline must not shrink below 110 (got ${ids.length})`);
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
    assert.ok(ids.length >= 110, `baseline must not shrink below 110 (got ${ids.length})`);
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
      `phase8 must not accept baseline-sized comment-only tags:\n${fmtResult(r)}`,
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
    assert.ok(ids.length >= 110, `baseline must not shrink below 110 (got ${ids.length})`);
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
      `phase8 must not accept one test owning all baseline @inv tags:\n${fmtResult(r)}`,
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
    assert.ok(ids.length >= 110, `baseline must not shrink below 110 (got ${ids.length})`);
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
      `phase8 must not accept baseline-sized test.fail() declarations as coverage:\n${fmtResult(r)}`,
    );
    assert.match(
      `${r.stderr}\n${r.stdout}`,
      /skipped|fixme|fail|expected-failure|not executable/i,
      `phase8 test.fail diagnostics:\n${fmtResult(r)}`,
    );
  });

  it("Phase 8 gate accepts full PASS inventory + 1:1 Playwright-bound @inv map + run report", () => {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    const ids = baseline.required_ids;
    assert.ok(ids.length >= 110, `baseline must not shrink below 110 (got ${ids.length})`);
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
      // S-E2E-RUN: collection alone is insufficient — need passed outcomes.
      playwrightSuite: ({ writtenAbs }) => ({
        source: "test-run-report",
        entries: ids.map((id) => {
          const testId = baseline.fingerprints[id]?.test_id || id;
          return {
            file: writtenAbs["full-map.spec.ts"],
            title: `@inv:${id} ${testId}`,
            status: "passed",
            outcome: "passed",
          };
        }),
      }),
    });
    assert.equal(
      r.status,
      0,
      `phase8 must pass with PASS statuses + Playwright-bound 1:1 map + run report:\n${fmtResult(r)}`,
    );
    assert.match(
      r.stdout,
      /run report|passed, non-skipped/i,
      `stdout should note Phase 8 run-report proof:\n${fmtResult(r)}`,
    );
  });

  it("rejects @inv nested under test.describe.skip (static extractor)", () => {
    // Auditor critical: only direct test.skip("title") was recognized; nests under
    // describe.skip previously counted as active coverage.
    const r = runLintInProbe({
      inventoryMutate: markA01Implemented,
      e2eFiles: {
        "public/cfp-load.spec.ts": pwSource(
          'test.describe.skip("deferred suite", () => {\n' +
            '  test("@inv:A01 e2e/public/cfp-load nested under describe.skip", async () => {});\n' +
            "});\n",
        ),
      },
    });
    assert.notEqual(
      r.status,
      0,
      `describe.skip nested @inv must not satisfy coverage:\n${fmtResult(r)}`,
    );
    assert.match(
      `${r.stderr}\n${r.stdout}`,
      /skipped|describe\.skip|fixme|fail|A01/i,
      `must diagnose describe.skip nested coverage:\n${fmtResult(r)}`,
    );
  });

  it("Phase 8 gate rejects all baseline @inv nested under test.describe.skip", () => {
    // Auditor full-gate probe: all PASS + every tagged test under describe.skip
    // previously returned exit 0.
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    const ids = baseline.required_ids;
    assert.ok(ids.length >= 110, `baseline must not shrink below 110 (got ${ids.length})`);
    const inner = ids
      .map((id) => {
        const testId = baseline.fingerprints[id]?.test_id || id;
        return `  test(${JSON.stringify(`@inv:${id} ${testId}`)}, async () => {});`;
      })
      .join("\n");
    const body =
      'test.describe.skip("entire dogfood suite skipped", () => {\n' +
      inner +
      "\n});\n";
    const r = runLintInProbe({
      inventoryMutate: markAllStatusesPass,
      e2eFiles: { "all-describe-skip.spec.ts": pwSource(body) },
      fullGate: true,
    });
    assert.notEqual(
      r.status,
      0,
      `phase8 must fail when all baseline @inv are under describe.skip:\n${fmtResult(r)}`,
    );
    assert.match(
      `${r.stderr}\n${r.stdout}`,
      /skipped|describe\.skip|fixme|fail|not executable/i,
      `phase8 describe.skip diagnostics:\n${fmtResult(r)}`,
    );
  });

  it("Phase 8 gate rejects list-only suite without execution outcomes", () => {
    // Collection via --list / list-shaped reports must not green-wash Phase 8.
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    const ids = baseline.required_ids;
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
      playwrightSuite: ({ writtenAbs }) => ({
        source: "playwright-list-json",
        entries: ids.map((id) => {
          const testId = baseline.fingerprints[id]?.test_id || id;
          return {
            file: writtenAbs["full-map.spec.ts"],
            title: `@inv:${id} ${testId}`,
            // deliberately no status/outcome — list collection only
          };
        }),
      }),
    });
    assert.notEqual(
      r.status,
      0,
      `phase8 must reject list-only suite without outcomes:\n${fmtResult(r)}`,
    );
    assert.match(
      `${r.stderr}\n${r.stdout}`,
      /run report|execution outcomes|not `playwright test --list`|collection alone/i,
      `phase8 must demand run report outcomes:\n${fmtResult(r)}`,
    );
  });

  it("Phase 8 gate rejects run report where every result is skipped", () => {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    const ids = baseline.required_ids;
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
      playwrightSuite: ({ writtenAbs }) => ({
        source: "test-run-report-all-skipped",
        entries: ids.map((id) => {
          const testId = baseline.fingerprints[id]?.test_id || id;
          return {
            file: writtenAbs["full-map.spec.ts"],
            title: `@inv:${id} ${testId}`,
            status: "skipped",
            outcome: "skipped",
          };
        }),
      }),
    });
    assert.notEqual(
      r.status,
      0,
      `phase8 must reject all-skipped run report:\n${fmtResult(r)}`,
    );
    assert.match(
      `${r.stderr}\n${r.stdout}`,
      /skipped execution|non-skipped|describe\.skip|test\.skip/i,
      `phase8 must diagnose skipped execution results:\n${fmtResult(r)}`,
    );
  });

  it("Phase 8 gate rejects run report with failed outcomes", () => {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    const ids = baseline.required_ids;
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
      playwrightSuite: ({ writtenAbs }) => ({
        source: "test-run-report-failed",
        entries: ids.map((id) => {
          const testId = baseline.fingerprints[id]?.test_id || id;
          return {
            file: writtenAbs["full-map.spec.ts"],
            title: `@inv:${id} ${testId}`,
            status: "unexpected",
            outcome: "failed",
          };
        }),
      }),
    });
    assert.notEqual(
      r.status,
      0,
      `phase8 must reject failed run-report outcomes:\n${fmtResult(r)}`,
    );
    assert.match(
      `${r.stderr}\n${r.stdout}`,
      /passed, non-skipped|lack a passed|execution result/i,
      `phase8 must diagnose non-passed outcomes:\n${fmtResult(r)}`,
    );
  });

  it("rejects new REQUIRED inventory IDs not ratified into persistent baseline", () => {
    // Growth must enter e2e-inventory-required-baseline.json with fingerprints;
    // otherwise a later delete of the new journey would not fail the gate.
    const r = runLintInProbe({
      inventoryMutate: (inv) =>
        inv.replace(
          /(\| A11 \|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\| REQUIRED \| OPEN \|\n)/,
          "$1| Z99 | public | surface | brand-new journey | e2e/public/z99 | none | REQUIRED | OPEN |\n",
        ),
    });
    assert.notEqual(
      r.status,
      0,
      `new REQUIRED Z99 without baseline entry must fail:\n${fmtResult(r)}`,
    );
    assert.match(
      `${r.stderr}\n${r.stdout}`,
      /missing from persistent baseline|Z99|fingerprints/i,
      `must diagnose unratified REQUIRED growth:\n${fmtResult(r)}`,
    );
  });

  it("rejects when baseline omits an inventory REQUIRED ID (growth unprotected)", () => {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    const slimIds = baseline.required_ids.filter((id) => id !== "A01");
    const slimFp = { ...baseline.fingerprints };
    delete slimFp.A01;
    const slimBaseline = {
      ...baseline,
      required_ids: slimIds,
      fingerprints: slimFp,
    };
    const dir = mkdtempSync(join(tmpdir(), "spo-baseline-slim-"));
    try {
      const slimPath = join(dir, "baseline.json");
      writeFileSync(slimPath, JSON.stringify(slimBaseline), "utf8");
      const r = runLintInProbe({
        baselinePathOverride: slimPath,
      });
      assert.notEqual(
        r.status,
        0,
        `inventory REQUIRED A01 missing from slim baseline must fail:\n${fmtResult(r)}`,
      );
      assert.match(
        `${r.stderr}\n${r.stdout}`,
        /missing from persistent baseline|A01/i,
        `must name A01 as unratified:\n${fmtResult(r)}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects @inv only in files excluded from Playwright config-selected suite", () => {
    // Tagged journey lives under public/ but suite only selects ignored.spec.ts
    // (models testIgnore / testMatch / projects exclusion).
    const r = runLintInProbe({
      inventoryMutate: markA01Implemented,
      e2eFiles: {
        "public/cfp-load.spec.ts": a01RealTest,
        "ignored.spec.ts": pwSource('test("not selected", async () => {});\n'),
      },
      playwrightSuite: ({ writtenAbs }) => ({
        source: "test-injected",
        entries: [
          {
            file: writtenAbs["ignored.spec.ts"],
            title: "not selected",
          },
        ],
      }),
    });
    assert.notEqual(
      r.status,
      0,
      `suite-excluded @inv:A01 must not satisfy coverage:\n${fmtResult(r)}`,
    );
    assert.match(
      `${r.stderr}\n${r.stdout}`,
      /config-selected suite|not in the Playwright|testIgnore|A01/i,
      `must diagnose suite exclusion:\n${fmtResult(r)}`,
    );
  });

  it("rejects @inv only on titles not listed in Playwright selected suite (dead code)", () => {
    // Static declaration exists, but Playwright --list would not emit the
    // dead-branch title — only the live untagged test is selected.
    const r = runLintInProbe({
      inventoryMutate: markA01Implemented,
      e2eFiles: {
        "public/cfp-load.spec.ts": pwSource(
          "if (false) {\n" +
            '  test("@inv:A01 e2e/public/cfp-load dead branch", async () => {});\n' +
            "}\n" +
            'test("live untagged", async () => {});\n',
        ),
      },
      playwrightSuite: ({ writtenAbs }) => ({
        source: "test-injected",
        entries: [
          {
            file: writtenAbs["public/cfp-load.spec.ts"],
            title: "live untagged",
          },
        ],
      }),
    });
    assert.notEqual(
      r.status,
      0,
      `dead-conditional @inv must not count when suite lists only live title:\n${fmtResult(r)}`,
    );
    assert.match(
      `${r.stderr}\n${r.stdout}`,
      /config-selected suite|dead conditional|not in the Playwright|A01/i,
      `must diagnose unlisted title:\n${fmtResult(r)}`,
    );
  });

  it("accepts @inv when Playwright suite selects the tagged title", () => {
    const r = runLintInProbe({
      inventoryMutate: markA01Implemented,
      e2eFiles: {
        "public/cfp-load.spec.ts": a01RealTest,
        "other.spec.ts": pwSource(
          'test("@inv:A01 e2e/public/cfp-load duplicate ignored", async () => {});\n',
        ),
      },
      playwrightSuite: ({ writtenAbs }) => ({
        source: "test-injected",
        entries: [
          {
            file: writtenAbs["public/cfp-load.spec.ts"],
            title: "@inv:A01 e2e/public/cfp-load public CFP loads",
          },
        ],
      }),
    });
    assert.equal(
      r.status,
      0,
      `suite-selected tagged title must pass:\n${fmtResult(r)}`,
    );
    assert.match(
      r.stdout,
      /playwright-suite|OK: @inv/i,
      `stdout should note suite reconciliation:\n${fmtResult(r)}`,
    );
  });

  it("accepts suite report file for config-selected reconciliation", () => {
    const r = runLintInProbe({
      inventoryMutate: markA01Implemented,
      e2eFiles: {
        "public/cfp-load.spec.ts": a01RealTest,
      },
      suiteReportBody: ({ writtenAbs }) => ({
        source: "suite-report-file",
        entries: [
          {
            file: writtenAbs["public/cfp-load.spec.ts"],
            title: "@inv:A01 e2e/public/cfp-load public CFP loads",
          },
        ],
      }),
    });
    assert.equal(
      r.status,
      0,
      `suite report path must drive selection:\n${fmtResult(r)}`,
    );
  });

  it("package.json test scripts use Node recursive discovery (not shell **)", () => {
    // Shell ** without globstar only expands one directory level and silently
    // omits tests/integration/api/*.test.mjs and tests/*.test.mjs.
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    for (const name of ["test", "test:ci"]) {
      const script = pkg.scripts[name];
      assert.equal(typeof script, "string", `package.json scripts.${name}`);
      assert.match(
        script,
        /node\s+--test\b/,
        `${name} must invoke node --test`,
      );
      // Must not rely on unquoted shell globstar tests/**/*.test.mjs
      assert.doesNotMatch(
        script,
        /tests\/\*\*\/\*\.test\.mjs/,
        `${name} must not use shell-expanded tests/**/*.test.mjs`,
      );
      // Prefer directory form (Node recurses) or an explicit runner script
      assert.match(
        script,
        /tests\/|scripts\/.*test/i,
        `${name} must discover tests under tests/ via Node, not shell **`,
      );
    }
  });

  it("extractInvTaggedTests marks describe.skip nests as skipped", () => {
    const src =
      "import { test } from '@playwright/test';\n" +
      'test.describe.skip("suite", () => {\n' +
      '  test("@inv:A01 nested", async () => {});\n' +
      "});\n" +
      'test("@inv:B01 active", async () => {});\n';
    const findings = extractInvTaggedTests("/tmp/x.spec.ts", src);
    const a01 = findings.find((f) => f.id === "A01");
    const b01 = findings.find((f) => f.id === "B01");
    assert.ok(a01, "A01 finding present");
    assert.equal(a01.skipped, true, "A01 under describe.skip must be skipped");
    assert.ok(b01, "B01 finding present");
    assert.equal(b01.skipped, false, "B01 outside describe.skip is active");
  });

  it("normalizePlaywrightSuite preserves execution outcomes from JSON reporter", () => {
    const suite = normalizePlaywrightSuite({
      suites: [
        {
          file: "e2e/a.spec.ts",
          specs: [
            {
              title: "@inv:A01 journey",
              file: "e2e/a.spec.ts",
              tests: [
                {
                  title: "@inv:A01 journey",
                  status: "expected",
                  results: [{ status: "passed" }],
                },
              ],
            },
            {
              title: "@inv:B01 skipped",
              file: "e2e/a.spec.ts",
              tests: [
                {
                  title: "@inv:B01 skipped",
                  status: "skipped",
                  results: [{ status: "skipped" }],
                },
              ],
            },
          ],
        },
      ],
    });
    assert.ok(suite, "suite normalized");
    assert.equal(suiteHasExecutionOutcomes(suite), true);
    const passed = suite.entries.find((e) => e.title.includes("A01"));
    const skipped = suite.entries.find((e) => e.title.includes("B01"));
    assert.ok(passed && isPassedNonSkippedResult(passed), "A01 passed");
    assert.ok(skipped && isSkippedExecutionResult(skipped), "B01 skipped");
    assert.equal(isPassedNonSkippedResult(skipped), false);
  });

  it("normalizePlaywrightSuite list-only entries have no execution outcomes", () => {
    const suite = normalizePlaywrightSuite({
      source: "playwright-list-json",
      entries: [{ file: "e2e/a.spec.ts", title: "@inv:A01" }],
    });
    assert.ok(suite);
    assert.equal(suiteHasExecutionOutcomes(suite), false);
    assert.equal(isPassedNonSkippedResult(suite.entries[0]), false);
  });

  it("resolvePlaywrightRunReport rejects playwright-list-* and prefers real run report", () => {
    // Playwright --list --reporter=json marks every test status:skipped.
    // That must not shadow reports/playwright-run.json with real outcomes.
    assert.equal(isPlaywrightListDiscoverySource("playwright-list-json"), true);
    assert.equal(isPlaywrightListDiscoverySource("playwright-list-text"), true);
    assert.equal(isPlaywrightListDiscoverySource("reports/playwright-run.json"), false);

    const listSuite = {
      source: "playwright-list-json",
      files: ["e2e/a.spec.ts"],
      entries: [
        {
          file: "e2e/a.spec.ts",
          title: "@inv:A01 journey",
          status: "skipped",
        },
      ],
      hasExecutionOutcomes: true,
    };
    assert.equal(suiteHasExecutionOutcomes(listSuite), true);
    assert.equal(suiteIsExecutionRunReport(listSuite), false);

    const probe = mkdtempSync(join(tmpdir(), "speakerops-list-vs-run-"));
    try {
      const reportsDir = join(probe, "reports");
      mkdirSync(reportsDir, { recursive: true });
      const runPath = join(reportsDir, "playwright-run.json");
      writeFileSync(
        runPath,
        JSON.stringify({
          source: "test-real-run",
          entries: [
            {
              file: "e2e/a.spec.ts",
              title: "@inv:A01 journey",
              status: "expected",
              outcome: "passed",
            },
          ],
        }),
        "utf8",
      );

      const resolved = resolvePlaywrightRunReport({
        root: probe,
        env: {},
        selectedSuite: listSuite,
      });
      assert.ok(resolved, "must resolve default run report");
      assert.equal(isPlaywrightListDiscoverySource(resolved.source), false);
      assert.ok(
        resolved.entries.some((e) => isPassedNonSkippedResult(e)),
        "run report must retain passed outcomes",
      );
      assert.equal(
        resolved.entries.every((e) => e.status === "skipped"),
        false,
        "must not return list-all-skipped suite",
      );
    } finally {
      rmSync(probe, { recursive: true, force: true });
    }
  });

  it("law doc requires Phase 8 run report execution proof", () => {
    const body = readFileSync(lawPath, "utf8");
    assert.match(
      body,
      /run report|execution proof|passed, non-skipped/i,
      "law must require Phase 8 run-report execution proof",
    );
    assert.match(
      body,
      /describe\.skip|test\.describe\.skip/i,
      "law must call out describe.skip as non-coverage",
    );
  });
});
