/**
 * Inventory lint gate: `pnpm test:e2e:inventory`
 *
 * Pre-scaffold (0.3+): validates canonical BROWSER_E2E_INVENTORY.md
 * REQUIRED semantics, unique IDs, unique non-empty test_ids, exact ratified
 * baseline ID set + stable test_id/journey fingerprints (anti-reuse).
 *
 * @inv tag decision table (single coherent design — no empty-root loophole):
 *
 * | Mode         | Tag targets                         | Missing root / empty files | Status claim          |
 * |--------------|-------------------------------------|----------------------------|-----------------------|
 * | Intermediate | IMPLEMENTED/PASS/FAIL non-DEFER     | FAIL if any tag target     | (no PASS enforcement) |
 * |              | REQUIRED (status-owned)             | exists; OK if none claimed |                       |
 * | Phase 8      | all non-DEFER REQUIRED              | always FAIL                | every non-DEFER       |
 * |              |                                     |                            | REQUIRED must be PASS |
 *
 * Claiming IMPLEMENTED (or PASS/FAIL) without a matching `@inv:ID` under an
 * e2e root is always a failure — empty `playwright/e2e/` is not "no tree yet".
 * Tag coverage is deferred only when every journey is still OPEN/DEFER and
 * the gate is not phase8 (pre-harness Phase 0–1.x with all-OPEN inventory).
 *
 * Phase 8 full enforcement (tags + PASS status):
 *   E2E_INVENTORY_GATE=phase8  pnpm test:e2e:inventory
 *   node scripts/e2e-inventory-lint.mjs --phase8
 *
 * DEFER exemption (anti-shrinkage / Phase 8 PASS set):
 *   Status DEFER removes a row from the required PASS set only when an
 *   authoritative owner amendment records that inventory ID in the
 *   constitution DEFER table (`00_CONSTITUTION.md` Article 0) with non-empty
 *   Reason, Date, and Owner. Bare inventory Status=DEFER without that
 *   record is rejected (cannot green-wash dogfood_ready by mass-DEFER).
 *
 * @inv must appear on a real Playwright `test(...)` / `test.only(...)`
 * title whose callee is bound to the Playwright `test` export (import from
 * `@playwright/test`, optionally rebound via `.extend()` / `.extend<T>()`).
 * Local no-op `const test = (...) => {}` without a Playwright binding does
 * not count. Structural matching (imports, rebinds, shadows, call sites)
 * ignores string/template interiors — decoy strings cannot spoof an import
 * or a `test(...)` declaration. Title text is read only from real call sites.
 * Strict 1:1 inventory map: exactly one `@inv:ID` per test title.
 * Comments, bare strings, multi-tag titles, skipped/fixme/fail-only
 * coverage (test.fail is expected-failure, not dogfood proof), duplicate
 * active owners, and missing `test_id` path anchors do not satisfy the gate.
 *
 * Playwright suite reconciliation (S-E2E-RUN alignment):
 *   Static files under hard-coded e2e roots are not enough when a Playwright
 *   config exists. Intermediate coverage is reconciled with the config-selected
 *   suite (list/report / injected): tests excluded by testIgnore/testMatch/
 *   projects, or titles not listed, do not satisfy @inv coverage.
 *   Pre-scaffold (no config) keeps static roots.
 *
 * Phase 8 execution proof (not collection-only):
 *   `playwright test --list` / list-shaped reports prove collection only —
 *   they discard or omit outcomes. Tests under `test.describe.skip(...)`,
 *   runtime `test.skip()`, or fixme still appear in the selected suite while
 *   never executing. Phase 8 therefore requires an **actual Playwright run
 *   report** (JSON with per-test status/outcome) and verifies every non-DEFER
 *   REQUIRED ID has a **passed, non-skipped** execution result. Collection
 *   alone cannot green-wash dogfood_ready.
 *   Default report path (no env required): `reports/playwright-run.json`
 *   (same artifact written by `pnpm test:e2e` / playwright.config.ts).
 *   Override with E2E_PLAYWRIGHT_RUN_REPORT / E2E_PLAYWRIGHT_SUITE_REPORT.
 *
 * Suite discovery vs execution report (must not conflate):
 *   Tag reconciliation uses the **config-selected suite** (`playwright test
 *   --list` or an *explicit* suite/list report). The default
 *   `reports/playwright-run.json` is **not** used for discovery — partial
 *   single-spec runs overwrite that file and would otherwise hide most
 *   inventory IDs. Phase 8 outcome proof loads the default/explicit run
 *   report separately after tags are reconciled against the full suite.
 *
 * Static skip detection (defense in depth, all modes):
 *   `test.skip` / `test.fixme` / `test.fail` modifiers, and any `test(...)`
 *   nested under `test.describe.skip` / `test.describe.fixme`, are treated as
 *   non-executable coverage (same as direct skip).
 *
 * Anti-shrinkage / growth:
 *   Every inventory REQUIRED row must be present in the persistent baseline
 *   with fingerprints — growth is allowed only by ratifying new IDs into
 *   `e2e-inventory-required-baseline.json` so later deletion/rename fails.
 *
 * Does not claim S-E2E-RUN (full browser run) without a Phase 8 run report.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Ratified inventory Status column values (docs/governance/0.3-e2e-inventory-law.md). */
const ALLOWED_STATUSES = new Set([
  "OPEN",
  "IMPLEMENTED",
  "PASS",
  "FAIL",
  "DEFER",
]);

/**
 * Statuses that claim ownership of a journey. Intermediate gate requires a
 * matching `@inv:ID` for each of these (empty e2e root is not a deferral).
 */
const TAG_REQUIRED_STATUSES = new Set(["IMPLEMENTED", "PASS", "FAIL"]);

/** Error thrown for expected lint failures (CLI maps to exit 1). */
export class InventoryLintError extends Error {
  constructor(message) {
    super(message);
    this.name = "InventoryLintError";
  }
}

/** Normalize empty / dash placeholders to empty string. */
export function normalizeCell(s) {
  const t = (s ?? "").trim();
  if (t === "" || t === "—" || t === "-" || t === "–") return "";
  return t;
}

export function collectFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) collectFiles(p, acc);
    else if (/\.(ts|js|mjs|tsx)$/.test(name)) acc.push(p);
  }
  return acc;
}

/** Default Playwright config locations (aligned with scripts/e2e-run.mjs). */
export function playwrightConfigCandidates(root) {
  return [
    join(root, "playwright.config.ts"),
    join(root, "playwright.config.mjs"),
    join(root, "playwright.config.js"),
    join(root, "apps", "web", "playwright.config.ts"),
  ];
}

/** First existing Playwright config under root, or null. */
export function findPlaywrightConfig(root) {
  return playwrightConfigCandidates(root).find((p) => existsSync(p)) ?? null;
}

/**
 * Normalize path for suite/file comparisons (absolute, forward slashes).
 * @param {string} p
 * @param {string} [root]
 */
export function normalizePathKey(p, root = "") {
  const raw = (p ?? "").trim();
  if (!raw) return "";
  const abs = isAbsolute(raw)
    ? resolve(raw)
    : resolve(root || process.cwd(), raw);
  return abs.replace(/\\/g, "/");
}

/**
 * Whether two file paths refer to the same file under root.
 * @param {string} a
 * @param {string} b
 * @param {string} [root]
 */
export function pathsReferToSameFile(a, b, root = "") {
  const na = normalizePathKey(a, root);
  const nb = normalizePathKey(b, root);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Relative fragment vs absolute (suite report may store repo-relative paths)
  if (na.endsWith(`/${nb}`) || nb.endsWith(`/${na}`)) return true;
  const baseA = na.split("/").pop();
  const baseB = nb.split("/").pop();
  if (baseA && baseA === baseB && (na.endsWith(nb) || nb.endsWith(na))) {
    return true;
  }
  return false;
}

/**
 * @typedef {{ file: string, title: string, status?: string, outcome?: string, ok?: boolean }} PlaywrightSuiteEntry
 */

/**
 * Pull execution status/outcome from a suite report row (Playwright JSON or
 * injected). List-only rows have neither field.
 *
 * @param {Record<string, unknown>} row
 * @returns {{ status?: string, outcome?: string, ok?: boolean }}
 */
export function extractEntryExecutionMeta(row) {
  if (!row || typeof row !== "object") return {};
  /** @type {{ status?: string, outcome?: string, ok?: boolean }} */
  const meta = {};
  if (typeof row.status === "string" && row.status.trim()) {
    meta.status = row.status.trim();
  }
  if (typeof row.outcome === "string" && row.outcome.trim()) {
    meta.outcome = row.outcome.trim();
  }
  if (typeof row.ok === "boolean") meta.ok = row.ok;

  // Playwright JSON reporter: tests[].results[] with final attempt last
  if (Array.isArray(row.results) && row.results.length > 0) {
    const last = row.results[row.results.length - 1];
    if (last && typeof last === "object") {
      const lr = /** @type {Record<string, unknown>} */ (last);
      if (typeof lr.status === "string" && lr.status.trim() && !meta.outcome) {
        meta.outcome = lr.status.trim();
      }
    }
  }
  return meta;
}

/**
 * Whether a suite entry carries runtime execution outcome data (not list-only).
 * @param {PlaywrightSuiteEntry | null | undefined} entry
 */
export function entryHasExecutionOutcome(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (typeof entry.status === "string" && entry.status.trim()) return true;
  if (typeof entry.outcome === "string" && entry.outcome.trim()) return true;
  if (typeof entry.ok === "boolean") return true;
  return false;
}

/**
 * Whether a suite includes any per-test execution outcomes (run report).
 * Collection via `playwright test --list` yields false.
 * @param {{ entries?: PlaywrightSuiteEntry[] } | null | undefined} suite
 */
export function suiteHasExecutionOutcomes(suite) {
  if (!suite || !Array.isArray(suite.entries) || suite.entries.length === 0) {
    return false;
  }
  return suite.entries.some(entryHasExecutionOutcome);
}

/**
 * Passed + non-skipped execution result (dogfood proof).
 * Accepts Playwright aggregate status `expected` / `passed` / `flaky` and
 * result outcome `passed`. Rejects skipped, failed, unexpected, timedOut.
 *
 * @param {PlaywrightSuiteEntry | null | undefined} entry
 */
export function isPassedNonSkippedResult(entry) {
  if (!entryHasExecutionOutcome(entry)) return false;
  const status = String(entry?.status ?? "")
    .trim()
    .toLowerCase();
  const outcome = String(entry?.outcome ?? "")
    .trim()
    .toLowerCase();

  const failTokens = new Set([
    "failed",
    "unexpected",
    "timedout",
    "timed_out",
    "interrupted",
    "skipped",
  ]);
  if (failTokens.has(status) || failTokens.has(outcome)) return false;

  if (status === "expected" || status === "passed") return true;
  if (outcome === "passed") return true;
  // Flaky = eventually passed after retry (still executed, not skipped)
  if (status === "flaky" && (outcome === "passed" || outcome === "")) {
    return true;
  }
  if (entry?.ok === true) return true;
  return false;
}

/**
 * Explicit skipped execution (describe.skip / test.skip runtime / list status).
 * @param {PlaywrightSuiteEntry | null | undefined} entry
 */
export function isSkippedExecutionResult(entry) {
  const status = String(entry?.status ?? "")
    .trim()
    .toLowerCase();
  const outcome = String(entry?.outcome ?? "")
    .trim()
    .toLowerCase();
  return status === "skipped" || outcome === "skipped";
}

/**
 * Normalize a Playwright suite listing / report into a common shape.
 *
 * Accepted forms:
 * - Injected / project report: `{ entries: [{ file, title, status?, outcome? }] }`
 *   or `{ tests: [...] }`
 * - Playwright JSON reporter tree: `{ suites: [...] }` with nested `specs` /
 *   `tests` / `results` (run report — preserves outcomes)
 * - Flat array of `{ file, title, status? }` / `{ file, titlePath }`
 * - List-only rows omit status/outcome (collection, not execution proof)
 *
 * @param {unknown} input
 * @param {string} [root]
 * @returns {{ files: string[], entries: PlaywrightSuiteEntry[], source: string, hasExecutionOutcomes: boolean } | null}
 */
export function normalizePlaywrightSuite(input, root = "") {
  if (input == null) return null;

  /** @type {PlaywrightSuiteEntry[]} */
  const entries = [];

  /**
   * Playwright JSON --list reports file paths relative to config.rootDir
   * (testDir), not the monorepo root. Prefer that when present so suite
   * files resolve on disk for @inv coverage (section 2.1+ IMPLEMENTED rows).
   */
  let pathRoot = root;
  if (typeof input === "object" && input && !Array.isArray(input)) {
    const cfg = /** @type {any} */ (input).config;
    if (cfg && typeof cfg.rootDir === "string" && cfg.rootDir.length > 0) {
      pathRoot = cfg.rootDir;
    }
  }

  /**
   * @param {unknown} file
   * @param {unknown} title
   * @param {{ status?: string, outcome?: string, ok?: boolean }} [meta]
   */
  const pushEntry = (file, title, meta = {}) => {
    const f = typeof file === "string" ? file.trim() : "";
    if (!f) return;
    const t =
      typeof title === "string"
        ? title
        : Array.isArray(title)
          ? title.join(" › ")
          : "";
    /** @type {PlaywrightSuiteEntry} */
    const entry = { file: f, title: t };
    if (meta.status) entry.status = meta.status;
    if (meta.outcome) entry.outcome = meta.outcome;
    if (typeof meta.ok === "boolean") entry.ok = meta.ok;
    entries.push(entry);
  };

  const walkSuites = (suites, inheritedFile = "") => {
    if (!Array.isArray(suites)) return;
    for (const suite of suites) {
      if (!suite || typeof suite !== "object") continue;
      const file =
        (typeof suite.file === "string" && suite.file) ||
        (typeof suite.location?.file === "string" && suite.location.file) ||
        inheritedFile;
      if (Array.isArray(suite.specs)) {
        for (const spec of suite.specs) {
          if (!spec || typeof spec !== "object") continue;
          const specFile =
            (typeof spec.file === "string" && spec.file) ||
            (typeof spec.location?.file === "string" && spec.location.file) ||
            file;
          const title =
            typeof spec.title === "string"
              ? spec.title
              : Array.isArray(spec.titlePath)
                ? spec.titlePath.join(" › ")
                : "";
          // Prefer individual tests when present (project / retry rows)
          if (Array.isArray(spec.tests) && spec.tests.length > 0) {
            for (const t of spec.tests) {
              if (!t || typeof t !== "object") continue;
              const tr = /** @type {Record<string, unknown>} */ (t);
              const tTitle =
                (typeof tr.title === "string" && tr.title) ||
                (Array.isArray(tr.titlePath) && tr.titlePath.join(" › ")) ||
                title;
              const tFile =
                (typeof tr.location === "object" &&
                  tr.location &&
                  typeof /** @type {any} */ (tr.location).file === "string" &&
                  /** @type {any} */ (tr.location).file) ||
                specFile;
              pushEntry(tFile, tTitle, extractEntryExecutionMeta(tr));
            }
          } else {
            const sr = /** @type {Record<string, unknown>} */ (spec);
            pushEntry(specFile, title, extractEntryExecutionMeta(sr));
          }
        }
      }
      if (Array.isArray(suite.suites)) walkSuites(suite.suites, file);
    }
  };

  if (Array.isArray(input)) {
    for (const row of input) {
      if (!row || typeof row !== "object") continue;
      const r = /** @type {Record<string, unknown>} */ (row);
      pushEntry(
        r.file ??
          (typeof r.location === "object" &&
          r.location &&
          typeof /** @type {any} */ (r.location).file === "string"
            ? /** @type {any} */ (r.location).file
            : "") ??
          "",
        r.title ??
          (Array.isArray(r.titlePath) ? r.titlePath.join(" › ") : "") ??
          "",
        extractEntryExecutionMeta(r),
      );
    }
  } else if (typeof input === "object") {
    const obj = /** @type {Record<string, unknown>} */ (input);
    if (Array.isArray(obj.entries)) {
      for (const row of obj.entries) {
        if (!row || typeof row !== "object") continue;
        const r = /** @type {Record<string, unknown>} */ (row);
        pushEntry(
          typeof r.file === "string" ? r.file : "",
          typeof r.title === "string"
            ? r.title
            : Array.isArray(r.titlePath)
              ? r.titlePath.join(" › ")
              : "",
          extractEntryExecutionMeta(r),
        );
      }
    } else if (Array.isArray(obj.tests)) {
      for (const row of obj.tests) {
        if (!row || typeof row !== "object") continue;
        const r = /** @type {Record<string, unknown>} */ (row);
        pushEntry(
          typeof r.file === "string"
            ? r.file
            : typeof r.location === "object" &&
                r.location &&
                typeof /** @type {any} */ (r.location).file === "string"
              ? /** @type {any} */ (r.location).file
              : "",
          typeof r.title === "string"
            ? r.title
            : Array.isArray(r.titlePath)
              ? r.titlePath.join(" › ")
              : "",
          extractEntryExecutionMeta(r),
        );
      }
    } else if (Array.isArray(obj.suites)) {
      walkSuites(obj.suites);
    }
  }

  if (entries.length === 0) return null;

  const normalizedEntries = entries.map((e) => {
    /** @type {PlaywrightSuiteEntry} */
    const out = {
      // Resolve relative suite paths against Playwright testDir (pathRoot),
      // falling back to workspace root for absolute / repo-relative paths.
      file: normalizePathKey(e.file, pathRoot) || e.file,
      title: e.title,
    };
    // If pathRoot resolution missed (file under monorepo but not under testDir),
    // try workspace root as a second pass for absolute-ish fragments.
    if (
      out.file &&
      pathRoot !== root &&
      root &&
      !existsSync(out.file) &&
      !isAbsolute(e.file)
    ) {
      const alt = normalizePathKey(e.file, root);
      if (alt && existsSync(alt)) out.file = alt;
      // Common layout: playwright/e2e/<file> under monorepo root
      const underE2e = normalizePathKey(join("playwright", "e2e", e.file), root);
      if ((!existsSync(out.file) || out.file === e.file) && underE2e && existsSync(underE2e)) {
        out.file = underE2e;
      }
    }
    if (e.status) out.status = e.status;
    if (e.outcome) out.outcome = e.outcome;
    if (typeof e.ok === "boolean") out.ok = e.ok;
    return out;
  });

  const files = [
    ...new Set(normalizedEntries.map((e) => e.file).filter(Boolean)),
  ];
  const hasExecutionOutcomes = normalizedEntries.some(entryHasExecutionOutcome);
  return {
    files,
    entries: normalizedEntries,
    hasExecutionOutcomes,
    source:
      typeof input === "object" &&
      input &&
      typeof /** @type {any} */ (input).source === "string"
        ? /** @type {any} */ (input).source
        : "normalized",
  };
}

/**
 * Default Playwright JSON run report path (aligned with playwright.config.ts
 * and scripts/e2e-run.mjs). Phase 8 gate uses this when no env override is set.
 * @param {string} [root]
 */
export function defaultPlaywrightRunReportPath(root = defaultRoot) {
  return join(root, "reports", "playwright-run.json");
}

/**
 * Resolve a suite/report path: absolute as-is; relative against root then cwd.
 * @param {string} reportPath
 * @param {string} [root]
 */
export function resolveSuiteReportPath(reportPath, root = "") {
  if (!reportPath || typeof reportPath !== "string") return "";
  const trimmed = reportPath.trim();
  if (!trimmed) return "";
  if (isAbsolute(trimmed)) return resolve(trimmed);
  const base = root || defaultRoot;
  const fromRoot = resolve(base, trimmed);
  if (existsSync(fromRoot)) return fromRoot;
  return resolve(process.cwd(), trimmed);
}

/**
 * Load a suite report JSON from disk (Playwright list/report or project form).
 * @param {string} reportPath
 * @param {string} [root]
 */
export function loadPlaywrightSuiteReport(reportPath, root = "") {
  if (!reportPath) return null;
  const resolved = resolveSuiteReportPath(reportPath, root);
  if (!resolved || !existsSync(resolved)) return null;
  const raw = readFileSync(resolved, "utf8");
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const suite = normalizePlaywrightSuite(data, root || dirname(resolved));
  if (suite) suite.source = suite.source === "normalized" ? resolved : suite.source;
  return suite;
}

/**
 * Parse default `playwright test --list` text output into a suite.
 * Lines look like: `  [chromium] › path/to.spec.ts:3:1 › describe › title`
 * @param {string} text
 * @param {string} [root]
 */
export function parsePlaywrightListText(text, root = "") {
  /** @type {{ file: string, title: string }[]} */
  const entries = [];
  const lineRe =
    /^\s*(?:\[[^\]]+\]\s*)?›\s*([^:]+?\.(?:spec|test)\.[a-z]+):\d+:\d+\s*›\s*(.+?)\s*$/i;
  // Alternate: `  path/to.spec.ts:3:1 › title` without project bracket
  const lineRe2 =
    /^\s*([^:]+?\.(?:spec|test)\.[a-z]+):\d+:\d+\s*›\s*(.+?)\s*$/i;
  for (const line of (text ?? "").split(/\r?\n/)) {
    let m = line.match(lineRe);
    if (!m) m = line.match(lineRe2);
    if (!m) continue;
    const file = m[1].trim();
    const titlePath = m[2].trim();
    // Leaf title is the last › segment (describes nest with ›)
    const leaf = titlePath.split(/\s*›\s*/).pop()?.trim() || titlePath;
    entries.push({ file, title: leaf });
    // Also keep full path title for matching describe › leaf forms
    if (leaf !== titlePath) {
      entries.push({ file, title: titlePath });
    }
  }
  return normalizePlaywrightSuite({ entries, source: "playwright-list-text" }, root);
}

/**
 * Discover the Playwright config-selected suite (files + titles [+ outcomes]).
 *
 * Resolution order (discovery / tag reconciliation only):
 * 1. Injected `playwrightSuite` object (tests / programmatic)
 * 2. **Explicit** run/suite/list report path only
 *    (options.suiteReportPath / E2E_PLAYWRIGHT_RUN_REPORT /
 *    E2E_PLAYWRIGHT_SUITE_REPORT / E2E_PLAYWRIGHT_LIST_REPORT)
 * 3. Live `playwright test --list` when a config exists and CLI is available
 *    (collection only — no execution outcomes; insufficient for Phase 8)
 *
 * The default `reports/playwright-run.json` is **not** used here: partial
 * single-spec E2E runs overwrite that artifact and must not replace full
 * config-selected suite discovery. Phase 8 outcome proof loads the default
 * (or explicit) run report via `resolvePlaywrightRunReport` separately.
 *
 * @param {object} [options]
 * @param {string} [options.root]
 * @param {string | null} [options.configPath]
 * @param {unknown} [options.playwrightSuite]
 * @param {string} [options.suiteReportPath]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {typeof spawnSync} [options.spawnSyncImpl]
 * @param {boolean} [options.allowCli=true]
 * @returns {{ files: string[], entries: PlaywrightSuiteEntry[], source: string, hasExecutionOutcomes: boolean } | null}
 */
export function resolvePlaywrightSelectedSuite(options = {}) {
  const root = options.root ?? defaultRoot;
  const env = options.env ?? process.env;

  if (options.playwrightSuite != null) {
    const suite = normalizePlaywrightSuite(options.playwrightSuite, root);
    if (suite) {
      suite.source =
        typeof options.playwrightSuite === "object" &&
        options.playwrightSuite &&
        typeof /** @type {any} */ (options.playwrightSuite).source === "string"
          ? /** @type {any} */ (options.playwrightSuite).source
          : "injected";
    }
    return suite;
  }

  // Explicit paths only — never auto-load default playwright-run.json for
  // discovery (partial suite overwrite would hide most @inv owners).
  const explicitReportPath =
    options.suiteReportPath ||
    env.E2E_PLAYWRIGHT_RUN_REPORT ||
    env.E2E_PLAYWRIGHT_SUITE_REPORT ||
    env.E2E_PLAYWRIGHT_LIST_REPORT ||
    "";
  if (explicitReportPath) {
    const fromReport = loadPlaywrightSuiteReport(explicitReportPath, root);
    if (fromReport) return fromReport;
  }

  if (options.allowCli === false) return null;

  const configPath = options.configPath ?? findPlaywrightConfig(root);
  if (!configPath) return null;

  const spawn = options.spawnSyncImpl ?? spawnSync;
  // Prefer JSON reporter; fall back to parsing default list text.
  const attempts = [
    {
      args: [
        "exec",
        "playwright",
        "test",
        "--list",
        "--config",
        configPath,
        "--reporter=json",
      ],
      parse: "json",
    },
    {
      args: [
        "exec",
        "playwright",
        "test",
        "--list",
        "--config",
        configPath,
      ],
      parse: "text",
    },
  ];

  for (const attempt of attempts) {
    let result;
    try {
      result = spawn("pnpm", attempt.args, {
        cwd: root,
        encoding: "utf8",
        env: { ...env, CI: env.CI || "1" },
        timeout: 120_000,
        maxBuffer: 32 * 1024 * 1024,
      });
    } catch {
      continue;
    }
    if (!result || result.error) continue;
    const out = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (attempt.parse === "json") {
      // JSON reporter may emit a single object or trailing noise — take last {...}
      const start = out.indexOf("{");
      const end = out.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          const data = JSON.parse(out.slice(start, end + 1));
          const suite = normalizePlaywrightSuite(data, root);
          if (suite) {
            suite.source = "playwright-list-json";
            return suite;
          }
        } catch {
          // try text parse below
        }
      }
    }
    const textSuite = parsePlaywrightListText(out, root);
    if (textSuite) {
      textSuite.source = "playwright-list-text";
      return textSuite;
    }
  }

  return null;
}

/**
 * Resolve a Playwright **execution** run report for Phase 8 outcome proof.
 *
 * Unlike `resolvePlaywrightSelectedSuite` (discovery / tags), this prefers
 * the default `reports/playwright-run.json` so `pnpm test:e2e` + phase8
 * inventory does not need an extra env var — without letting that file
 * replace full-suite discovery after a partial single-spec run.
 *
 * Resolution order:
 * 1. Injected suite when it already has execution outcomes
 * 2. Explicit report path (options / env)
 * 3. Default `reports/playwright-run.json` when present and has outcomes
 * 4. null (caller fails Phase 8 with a clear message)
 *
 * @param {object} [options]
 * @param {string} [options.root]
 * @param {unknown} [options.playwrightSuite]
 * @param {string} [options.suiteReportPath]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {{ files: string[], entries: PlaywrightSuiteEntry[], source: string, hasExecutionOutcomes: boolean } | null} [options.selectedSuite]
 * @returns {{ files: string[], entries: PlaywrightSuiteEntry[], source: string, hasExecutionOutcomes: boolean } | null}
 */
export function resolvePlaywrightRunReport(options = {}) {
  const root = options.root ?? defaultRoot;
  const env = options.env ?? process.env;

  if (
    options.selectedSuite &&
    suiteHasExecutionOutcomes(options.selectedSuite)
  ) {
    return options.selectedSuite;
  }

  if (options.playwrightSuite != null) {
    const suite = normalizePlaywrightSuite(options.playwrightSuite, root);
    if (suite && suiteHasExecutionOutcomes(suite)) {
      suite.source =
        typeof options.playwrightSuite === "object" &&
        options.playwrightSuite &&
        typeof /** @type {any} */ (options.playwrightSuite).source === "string"
          ? /** @type {any} */ (options.playwrightSuite).source
          : "injected";
      return suite;
    }
  }

  const explicitReportPath =
    options.suiteReportPath ||
    env.E2E_PLAYWRIGHT_RUN_REPORT ||
    env.E2E_PLAYWRIGHT_SUITE_REPORT ||
    "";
  if (explicitReportPath) {
    const fromReport = loadPlaywrightSuiteReport(explicitReportPath, root);
    if (fromReport && suiteHasExecutionOutcomes(fromReport)) {
      return fromReport;
    }
  }

  const defaultReport = defaultPlaywrightRunReportPath(root);
  const fromDefault = loadPlaywrightSuiteReport(defaultReport, root);
  if (fromDefault && suiteHasExecutionOutcomes(fromDefault)) {
    return fromDefault;
  }

  return null;
}

/**
 * Whether two Playwright titles refer to the same test (leaf / path forms).
 * Playwright prints `describe › leaf`; static titles are often the leaf only.
 *
 * @param {string} findingTitle
 * @param {string} suiteTitle
 */
export function titlesReferToSameTest(findingTitle, suiteTitle) {
  const ft = (findingTitle ?? "").trim();
  const st = (suiteTitle ?? "").trim();
  if (!ft || !st) return false;
  if (st === ft) return true;
  if (st.endsWith(ft)) return true;
  if (ft.endsWith(st)) return true;
  const sLeaf = st.split(/\s*›\s*/).pop()?.trim() || st;
  const fLeaf = ft.split(/\s*›\s*/).pop()?.trim() || ft;
  if (sLeaf === ft || sLeaf === fLeaf || fLeaf === st) return true;
  return false;
}

/**
 * Suite entries that match a static @inv finding (file + title).
 *
 * @param {{ file: string, title: string, id?: string }} finding
 * @param {{ entries: PlaywrightSuiteEntry[] } | null} suite
 * @param {string} [root]
 * @returns {PlaywrightSuiteEntry[]}
 */
export function matchingSuiteEntries(finding, suite, root = "") {
  if (!suite || !Array.isArray(suite.entries) || suite.entries.length === 0) {
    return [];
  }
  const fileMatches = suite.entries.filter((e) =>
    pathsReferToSameFile(finding.file, e.file, root),
  );
  if (fileMatches.length === 0) return [];

  // File-only selection: if every matching entry has empty title, file is enough
  const titled = fileMatches.filter((e) => (e.title ?? "").trim() !== "");
  if (titled.length === 0) return fileMatches;

  const ft = (finding.title ?? "").trim();
  if (!ft) return [];

  return titled.filter((e) => titlesReferToSameTest(ft, e.title));
}

/**
 * Whether a static @inv finding is part of the Playwright-selected suite.
 * When suite is null, all findings pass (static-root mode).
 *
 * Title matching: leaf title equality, full path suffix, or suite title ends
 * with the finding title (Playwright prints `describe › leaf`).
 *
 * @param {{ file: string, title: string, id?: string }} finding
 * @param {{ entries: PlaywrightSuiteEntry[] } | null} suite
 * @param {string} [root]
 */
export function isFindingInPlaywrightSuite(finding, suite, root = "") {
  if (!suite || !Array.isArray(suite.entries) || suite.entries.length === 0) {
    return true;
  }
  return matchingSuiteEntries(finding, suite, root).length > 0;
}

/**
 * Strip // and /* *\/ comments without destroying string / template contents.
 * Replaces comments with spaces so line/column-ish structure stays stable.
 */
export function stripComments(source) {
  let result = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const c2 = source[i + 1];

    // String or template literal — copy through, honouring escapes.
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      result += c;
      i++;
      while (i < n) {
        const ch = source[i];
        if (ch === "\\") {
          result += ch + (source[i + 1] ?? "");
          i += 2;
          continue;
        }
        result += ch;
        i++;
        if (ch === q) break;
      }
      continue;
    }

    // Line comment
    if (c === "/" && c2 === "/") {
      while (i < n && source[i] !== "\n") {
        result += " ";
        i++;
      }
      continue;
    }

    // Block comment
    if (c === "/" && c2 === "*") {
      result += "  ";
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        result += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < n) {
        result += "  ";
        i += 2;
      }
      continue;
    }

    result += c;
    i++;
  }
  return result;
}


/**
 * Replace string/template literal *contents* with spaces so regex import
 * detection cannot treat decoy strings as real import declarations.
 * Preserves surrounding quotes and approximate length (newlines kept).
 * Comments should already be stripped by stripComments.
 *
 * @param {string} code
 * @returns {string}
 */
export function maskStringLiterals(code) {
  /**
   * Replace string/template literal contents with spaces so decoy strings
   * cannot spoof import declarations. Module specifier strings after `from`
   * or `require(` are preserved so real imports still match.
   */
  let result = "";
  let i = 0;
  const n = code.length;

  const shouldKeepSpecifier = () => /(?:\bfrom|\brequire\s*\()\s*$/.test(result);

  while (i < n) {
    const c = code[i];

    // Template literal
    if (c === "`") {
      const keep = false; // templates never real import paths
      result += "`";
      i++;
      while (i < n) {
        const ch = code[i];
        if (ch === "\\") {
          if (keep) {
            result += ch + (code[i + 1] ?? "");
          } else {
            result += "  ";
          }
          i += 2;
          continue;
        }
        if (ch === "`") {
          result += "`";
          i++;
          break;
        }
        if (ch === "$" && code[i + 1] === "{") {
          result += "${";
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            const x = code[i];
            // Nested strings inside ${...} must be masked (anti string-spoof)
            if (x === "'" || x === '"' || x === "`") {
              const q = x;
              result += q;
              i++;
              while (i < n) {
                const y = code[i];
                if (y === "\\") {
                  result += "  ";
                  i += 2;
                  continue;
                }
                if (y === q) {
                  result += q;
                  i++;
                  break;
                }
                result += y === "\n" ? "\n" : " ";
                i++;
              }
              continue;
            }
            if (x === "{") depth++;
            else if (x === "}") depth--;
            result += x;
            i++;
          }
          continue;
        }
        if (keep) result += ch;
        else result += ch === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }

    // Single or double quoted string
    if (c === "'" || c === '"') {
      const q = c;
      const keep = shouldKeepSpecifier();
      result += q;
      i++;
      while (i < n) {
        const ch = code[i];
        if (ch === "\\") {
          if (keep) {
            result += ch + (code[i + 1] ?? "");
          } else {
            result += "  ";
          }
          i += 2;
          continue;
        }
        if (ch === q) {
          result += q;
          i++;
          break;
        }
        if (keep) result += ch;
        else result += ch === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }

    result += c;
    i++;
  }
  return result;
}

/**
 * Bitmap of indexes inside any string or template literal (incl. delimiters
 * and module-specifier strings). Template `${ … }` expression bodies are
 * left unmarked (they are real code); nested strings inside them are marked.
 *
 * Used by call-site extraction so a string containing `test("@inv:…")` cannot
 * green-wash inventory coverage when a real Playwright import is also present.
 *
 * @param {string} code comment-stripped source
 * @returns {Uint8Array} 1 = inside string/template, 0 = code
 */
export function stringLiteralBitmap(code) {
  const bits = new Uint8Array(code.length);
  let i = 0;
  const n = code.length;

  /** Mark a simple '…' / "…" string starting at i (i points at opener). */
  const markQuoted = () => {
    const q = code[i];
    bits[i] = 1;
    i++;
    while (i < n) {
      const ch = code[i];
      if (ch === "\\") {
        bits[i] = 1;
        if (i + 1 < n) bits[i + 1] = 1;
        i += 2;
        continue;
      }
      bits[i] = 1;
      i++;
      if (ch === q) break;
    }
  };

  while (i < n) {
    const c = code[i];

    if (c === "'" || c === '"') {
      markQuoted();
      continue;
    }

    if (c === "`") {
      bits[i] = 1;
      i++;
      while (i < n) {
        const ch = code[i];
        if (ch === "\\") {
          bits[i] = 1;
          if (i + 1 < n) bits[i + 1] = 1;
          i += 2;
          continue;
        }
        if (ch === "`") {
          bits[i] = 1;
          i++;
          break;
        }
        if (ch === "$" && code[i + 1] === "{") {
          bits[i] = 1;
          bits[i + 1] = 1;
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            const x = code[i];
            if (x === "'" || x === '"') {
              markQuoted();
              continue;
            }
            if (x === "`") {
              // Nested template: mark whole nested template body simply
              // (depth of nested ${} handled by recursive-ish scan).
              bits[i] = 1;
              i++;
              while (i < n) {
                const nh = code[i];
                if (nh === "\\") {
                  bits[i] = 1;
                  if (i + 1 < n) bits[i + 1] = 1;
                  i += 2;
                  continue;
                }
                if (nh === "`") {
                  bits[i] = 1;
                  i++;
                  break;
                }
                if (nh === "$" && code[i + 1] === "{") {
                  bits[i] = 1;
                  bits[i + 1] = 1;
                  i += 2;
                  let d2 = 1;
                  while (i < n && d2 > 0) {
                    if (code[i] === "{") d2++;
                    else if (code[i] === "}") d2--;
                    i++;
                  }
                  continue;
                }
                bits[i] = 1;
                i++;
              }
              continue;
            }
            if (x === "{") {
              depth++;
              i++;
              continue;
            }
            if (x === "}") {
              depth--;
              if (depth === 0) {
                bits[i] = 1;
                i++;
                break;
              }
              i++;
              continue;
            }
            i++;
          }
          continue;
        }
        bits[i] = 1;
        i++;
      }
      continue;
    }

    i++;
  }
  return bits;
}

/**
 * Resolve identifiers bound to Playwright's `test` export in a source file.
 *
 * Counts as a Playwright test binding when:
 * - imported as `test` (or `test as alias`) from `@playwright/test`, or
 * - rebound via `const x = <binding>` / `const x = <binding>.extend(...)`
 *   / `const x = <binding>.extend<MyFixtures>(...)` (standard fixture pattern;
 *   TypeScript generic type arguments on `.extend` are supported).
 *
 * Import detection runs on string-masked source so decoy string literals cannot
 * spoof `import { test } from '@playwright/test'`. Module specifiers after
 * `from` / `require(` are preserved by maskStringLiterals.
 *
 * A local no-op `const test = (...) => {}` with no real `@playwright/test`
 * import yields an empty set. Non-Playwright reassignment of an imported name
 * removes that binding (shadowing).
 *
 * @param {string} code comment-stripped source
 * @returns {Set<string>}
 */
export function extractPlaywrightTestBindings(code) {
  /** @type {Set<string>} */
  const bindings = new Set();
  const scan = maskStringLiterals(code);

  // ESM value import only — `import type { test }` is type-erased at runtime
  // and must not count as a Playwright binding (cannot compile/collect tests).
  //      import { test } from '@playwright/test'
  //      import { test as base, expect } from "@playwright/test"
  // Inline type-only named imports (`import { type test }`) are skipped below.
  // Do not permit the optional `type` keyword after `import` (that is a
  // type-only import statement, not a runtime binding).
  const importRe =
    /import\s*\{([^}]+)\}\s*from\s*['"]@playwright\/test['"]/g;
  let im;
  while ((im = importRe.exec(scan)) !== null) {
    for (const part of im[1].split(",")) {
      const spec = part.trim();
      if (!spec || spec.startsWith("type ")) continue;
      const asMatch = spec.match(/^test\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (asMatch) {
        bindings.add(asMatch[1]);
        continue;
      }
      if (spec === "test") {
        bindings.add("test");
      }
    }
  }

  // CJS: const { test } = require('@playwright/test')
  const cjsRe =
    /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\s*\(\s*['"]@playwright\/test['"]\s*\)/g;
  while ((im = cjsRe.exec(scan)) !== null) {
    for (const part of im[1].split(",")) {
      const spec = part.trim();
      const asMatch = spec.match(/^test\s*:\s*([A-Za-z_$][\w$]*)$/);
      if (asMatch) {
        bindings.add(asMatch[1]);
        continue;
      }
      if (spec === "test") bindings.add("test");
    }
  }

  if (bindings.size === 0) return bindings;

  /**
   * Collect const/let/var declarators and extract RHS with multi-line support
   * for `base.extend<T>({ ... })` fixture objects.
   *
   * @returns {{ name: string, rhs: string, index: number }[]}
   */
  const collectDeclarators = () => {
    /** @type {{ name: string, rhs: string, index: number }[]} */
    const decls = [];
    const declRe =
      /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g;
    let dm;
    while ((dm = declRe.exec(scan)) !== null) {
      const name = dm[1];
      const rhsStart = dm.index + dm[0].length;
      // Walk RHS until top-level ; or newline that is not inside ()/{}/[]/<>
      // or string — enough for fixture rebinds.
      let i = rhsStart;
      let depthParen = 0;
      let depthBrace = 0;
      let depthBracket = 0;
      let depthAngle = 0;
      while (i < scan.length) {
        const c = scan[i];
        if (c === "'" || c === '"' || c === "`") {
          const q = c;
          i++;
          while (i < scan.length) {
            if (scan[i] === "\\") {
              i += 2;
              continue;
            }
            if (scan[i] === q) {
              i++;
              break;
            }
            if (q === "`" && scan[i] === "$" && scan[i + 1] === "{") {
              i += 2;
              let d = 1;
              while (i < scan.length && d > 0) {
                if (scan[i] === "{") d++;
                else if (scan[i] === "}") d--;
                i++;
              }
              continue;
            }
            i++;
          }
          continue;
        }
        if (c === "(") {
          depthParen++;
          i++;
          continue;
        }
        if (c === ")") {
          depthParen = Math.max(0, depthParen - 1);
          i++;
          continue;
        }
        if (c === "{") {
          depthBrace++;
          i++;
          continue;
        }
        if (c === "}") {
          depthBrace = Math.max(0, depthBrace - 1);
          i++;
          continue;
        }
        if (c === "[") {
          depthBracket++;
          i++;
          continue;
        }
        if (c === "]") {
          depthBracket = Math.max(0, depthBracket - 1);
          i++;
          continue;
        }
        // Angle depth only after `.extend` context is hard; count `<`/`>` when
        // already inside an extend type-arg region (depthAngle>0) or when
        // preceded by `extend` / identifier (type arg start).
        if (c === "<") {
          // Treat as type-arg opener when after identifier/extend or already nested
          const prev = scan.slice(Math.max(0, i - 12), i);
          if (depthAngle > 0 || /extend\s*$/.test(prev) || /[\w$>]\s*$/.test(prev)) {
            depthAngle++;
          }
          i++;
          continue;
        }
        if (c === ">" && depthAngle > 0) {
          depthAngle--;
          i++;
          continue;
        }
        if (
          depthParen === 0 &&
          depthBrace === 0 &&
          depthBracket === 0 &&
          depthAngle === 0
        ) {
          if (c === ";" || c === "," || c === "\n") break;
        }
        i++;
      }
      const rhs = scan.slice(rhsStart, i).trim();
      decls.push({ name, rhs, index: dm.index });
    }
    return decls;
  };

  // Fixture / rebind: const test = base.extend({...}) or const test = base
  // or const test = base.extend<MyFixtures>({...})
  for (let pass = 0; pass < 4; pass++) {
    let grew = false;
    for (const decl of collectDeclarators()) {
      if (bindings.has(decl.name)) continue;
      if (isPlaywrightRebindRhs(decl.rhs, bindings)) {
        bindings.add(decl.name);
        grew = true;
      }
    }
    if (!grew) break;
  }

  // Shadowing / non-Playwright reassignment removes the name.
  for (const name of [...bindings]) {
    for (const decl of collectDeclarators()) {
      if (decl.name !== name) continue;
      if (isPlaywrightRebindRhs(decl.rhs, bindings)) continue;
      bindings.delete(name);
      break;
    }
    if (!bindings.has(name)) continue;

    const shadowDecl = new RegExp(
      `\\bfunction\\s+${escapeRegExp(name)}\\s*\\(`,
    );
    if (shadowDecl.test(scan)) {
      bindings.delete(name);
      continue;
    }
    // Bare reassignment without const/let/var (e.g. `test = (...args) => {}`)
    // also invalidates a prior Playwright binding.
    const bareAssign = new RegExp(
      `(?<![.=])\\b${escapeRegExp(name)}\\s*=\\s*(?!=)`,
      "g",
    );
    let ba;
    while ((ba = bareAssign.exec(scan)) !== null) {
      // Skip if this is part of a const/let/var declarator (already handled)
      const before = scan.slice(Math.max(0, ba.index - 12), ba.index);
      if (/\b(?:const|let|var)\s+$/.test(before)) continue;
      const rhsStart = ba.index + ba[0].length;
      // Single-line RHS for bare assign is enough for no-op spoofs
      let end = scan.indexOf("\n", rhsStart);
      if (end < 0) end = scan.length;
      const semi = scan.indexOf(";", rhsStart);
      if (semi >= 0 && semi < end) end = semi;
      const rhs = scan.slice(rhsStart, end).trim();
      if (isPlaywrightRebindRhs(rhs, bindings)) continue;
      bindings.delete(name);
      break;
    }
  }

  return bindings;
}

/**
 * Source ranges of `test.describe.skip(...)` / `test.describe.fixme(...)`
 * call expressions (inclusive of callback bodies). Any `test(...)` whose
 * call index falls inside one of these ranges is non-executable coverage.
 *
 * Direct `test.skip("title", ...)` is handled separately via modifiers.
 * Nested describes inside a skipped suite are covered by the outer call span.
 *
 * @param {string} code comment-stripped source
 * @param {Set<string>} bindings Playwright test binding names
 * @param {Uint8Array} [inString] string-literal bitmap (optional)
 * @returns {{ start: number, end: number }[]}
 */
export function findDescribeSkipRanges(code, bindings, inString) {
  /** @type {{ start: number, end: number }[]} */
  const ranges = [];
  if (!bindings || bindings.size === 0) return ranges;
  const nameAlt = [...bindings].map(escapeRegExp).join("|");
  // test.describe.skip( / test.describe.fixme( (aliased fixtures too)
  const re = new RegExp(
    `\\b(?:${nameAlt})\\.describe\\.(?:skip|fixme)\\s*\\(`,
    "g",
  );
  let m;
  while ((m = re.exec(code)) !== null) {
    if (inString && inString[m.index]) continue;
    // `m[0]` ends with `(` — open paren index is last char
    const openParen = m.index + m[0].length - 1;
    const callEnd = skipBalanced(code, openParen, "(", ")");
    if (callEnd < 0) continue;
    ranges.push({ start: m.index, end: callEnd });
  }
  return ranges;
}

/**
 * Whether index falls inside any [start, end) range.
 * @param {number} index
 * @param {{ start: number, end: number }[]} ranges
 */
export function indexInRanges(index, ranges) {
  for (const r of ranges) {
    if (index >= r.start && index < r.end) return true;
  }
  return false;
}

/**
 * Extract `@inv:ID` tags from Playwright-bound `test(...)` declarations only.
 * Comments and bare strings elsewhere are ignored (anti-greenwash).
 *
 * A call counts only when:
 * 1. Its callee is a binding of Playwright's `test` export
 *    (see extractPlaywrightTestBindings), and
 * 2. The call site itself is outside string/template literals
 *    (see stringLiteralBitmap) — a string containing `test("@inv:…")` is not
 *    a declaration (same string-interior rule as import spoofing).
 *
 * Local no-op `const test = …` without a Playwright import does not count.
 *
 * Strict 1:1: a single `test(...)` title may carry at most one `@inv:ID`.
 * Titles with multiple tags are recorded with `multiTag: true` and never
 * count as active ownership (the gate rejects them).
 *
 * Non-executable modifiers (`skip`, `fixme`, `fail`) set `skipped: true`.
 * `test.fail()` is expected-failure and cannot prove REQUIRED journeys pass.
 * Tests nested under `test.describe.skip` / `test.describe.fixme` are also
 * marked `skipped: true` (static extractor previously only saw direct
 * `test.skip("title", ...)`).
 *
 * @param {string} filePath
 * @param {string} source
 * @returns {{ id: string, skipped: boolean, focused: boolean, multiTag: boolean, title: string, file: string }[]}
 */
export function extractInvTaggedTests(filePath, source) {
  const code = stripComments(source);
  const findings = [];
  const bindings = extractPlaywrightTestBindings(code);
  if (bindings.size === 0) {
    // No Playwright test import/binding — unexecuted local test() fakes
    // cannot satisfy inventory coverage.
    return findings;
  }

  // Call sites must start in real code, not inside any string/template.
  const inString = stringLiteralBitmap(code);
  const describeSkipRanges = findDescribeSkipRanges(code, bindings, inString);

  const nameAlt = [...bindings].map(escapeRegExp).join("|");
  // test("…") / test.only / test.skip / test.fixme / test.fail — first arg title
  // Also accepts aliased fixtures: base("…"), myTest.only("…")
  // Do NOT match test.describe.* here — those are suite hooks, not journey tests.
  const re = new RegExp(
    `\\b(?<callee>${nameAlt})(?:\\.(?<mod>only|skip|fixme|fail))?\\s*\\(\\s*(?<q>['"\`])(?<title>(?:\\\\.|(?!\\k<q>)[\\s\\S])*?)\\k<q>`,
    "g",
  );
  let m;
  while ((m = re.exec(code)) !== null) {
    if (inString[m.index]) {
      continue;
    }
    // Skip `test.describe(...)` / `test.describe.skip(...)` call sites —
    // the regex can match `test` before `.describe` if we are not careful.
    // Require that the match is not immediately followed by `.describe` after
    // the callee (mod group already consumed only/skip/fixme/fail).
    // Actually: `test.describe.skip("title"` would match as callee=test,
    // mod=undefined, title=... only if there's `test(` not `test.describe`.
    // Our pattern is `test(?:\.(only|skip|fixme|fail))?\s*\(` — so
    // `test.describe.skip(` does NOT match (describe is not a mod). Good.
    const title = m.groups.title.replace(/\\([\\'"`nrt])/g, (_, ch) => {
      if (ch === "n") return "\n";
      if (ch === "r") return "\r";
      if (ch === "t") return "\t";
      return ch;
    });
    const mod = m.groups.mod || "";
    // skip/fixme never run; fail is expected-failure (not dogfood proof)
    // Nested under describe.skip / describe.fixme also never runs.
    const underDescribeSkip = indexInRanges(m.index, describeSkipRanges);
    const skipped =
      mod === "skip" ||
      mod === "fixme" ||
      mod === "fail" ||
      underDescribeSkip;
    const focused = mod === "only";
    const invIds = [];
    const invRe = /@inv:([A-Z]\d{2})\b/g;
    let idm;
    while ((idm = invRe.exec(title)) !== null) {
      invIds.push(idm[1]);
    }
    if (invIds.length === 0) continue;
    const multiTag = invIds.length > 1;
    // Emit one finding per ID so diagnostics can name them, but multiTag
    // findings never satisfy active coverage (see runInventoryLint).
    for (const id of invIds) {
      findings.push({
        id,
        skipped,
        focused,
        multiTag,
        title,
        file: filePath,
      });
    }
  }
  return findings;
}

/**
 * Whether a tagged test is anchored to the inventory `test_id` path.
 * Accepts: file path (relative to an e2e root) or title containing the full
 * test_id or its final path segment (e.g. `cfp-load` for `e2e/public/cfp-load`).
 */
export function isTestIdAnchored({ file, title, testId, e2eRoots }) {
  if (!testId) return false;
  const norm = (s) => s.replace(/\\/g, "/");
  const id = norm(testId);
  const base = id.split("/").filter(Boolean).pop() || id;
  let rel = norm(file);
  for (const rootDir of e2eRoots) {
    const r = norm(rootDir);
    if (rel === r || rel.startsWith(r.endsWith("/") ? r : `${r}/`)) {
      rel = relative(rootDir, file).replace(/\\/g, "/");
      break;
    }
  }
  // Strip extension for path compares: public/cfp-load.spec.ts → public/cfp-load
  const relNoExt = rel.replace(/\.(spec|test)\.(ts|js|mjs|tsx)$/i, "").replace(/\.(ts|js|mjs|tsx)$/i, "");
  const hayPath = relNoExt;
  const hayTitle = norm(title);
  if (hayPath === id || hayPath.endsWith(`/${id}`) || hayPath.includes(`/${id}/`)) {
    return true;
  }
  // e2e root often omits the leading `e2e/` segment from inventory test_id
  const idWithoutE2ePrefix = id.replace(/^e2e\//, "");
  if (
    hayPath === idWithoutE2ePrefix ||
    hayPath.endsWith(`/${idWithoutE2ePrefix}`) ||
    hayPath === idWithoutE2ePrefix.replace(/^[^/]+\//, "") // public/cfp-load vs cfp-load.spec under public/
  ) {
    return true;
  }
  if (hayPath === base || hayPath.endsWith(`/${base}`)) return true;
  if (hayTitle.includes(id) || hayTitle.includes(idWithoutE2ePrefix)) return true;
  // Title mentions the leaf segment as a whole token (avoid tiny false positives)
  if (base.length >= 3 && new RegExp(`(?:^|[^A-Za-z0-9_])${escapeRegExp(base)}(?:[^A-Za-z0-9_]|$)`).test(hayTitle)) {
    return true;
  }
  return false;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function idList(ids) {
  return `${ids.slice(0, 20).join(", ")}${ids.length > 20 ? ` …(+${ids.length - 20})` : ""}`;
}

/**
 * Skip a balanced bracket/paren region starting at `openIdx` (points at opener).
 * Returns index just past the matching closer, or -1 if unbalanced.
 * Strings/templates inside are treated naively (sufficient for type args / call sites).
 *
 * @param {string} s
 * @param {number} openIdx
 * @param {string} openCh
 * @param {string} closeCh
 * @returns {number}
 */
export function skipBalanced(s, openIdx, openCh, closeCh) {
  if (s[openIdx] !== openCh) return -1;
  let depth = 0;
  let i = openIdx;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    // Skip string/template interiors so quotes and braces inside them do not
    // affect balance (fixture object literals may contain strings).
    if (c === "'" || c === '"' || c === "`") {
      const q = c;
      i++;
      while (i < n) {
        if (s[i] === "\\") {
          i += 2;
          continue;
        }
        if (s[i] === q) {
          i++;
          break;
        }
        // Nested ${} in templates: recurse only for depth of template expr
        if (q === "`" && s[i] === "$" && s[i + 1] === "{") {
          i += 2;
          let d = 1;
          while (i < n && d > 0) {
            if (s[i] === "{") d++;
            else if (s[i] === "}") d--;
            i++;
          }
          continue;
        }
        i++;
      }
      continue;
    }
    if (c === openCh) {
      depth++;
      i++;
      continue;
    }
    if (c === closeCh) {
      depth--;
      i++;
      if (depth === 0) return i;
      continue;
    }
    i++;
  }
  return -1;
}

/**
 * Whether `rhs` is a valid Playwright test rebind expression relative to
 * current binding names: `base`, `base.extend(...)`, `base.extend<T>(...)`,
 * `base.extend<A, B>(...)` (multi type-args), single-line fixture callbacks
 * with commas/semicolons inside the call, or chained `.extend` calls.
 *
 * Delimiters inside type args / call expressions are preserved — do **not**
 * pre-truncate at `,` or `;` (that rejects valid multi-generic and fixture
 * object forms). Only a trailing statement terminator after a complete
 * expression is ignored.
 *
 * @param {string} rhs assignment right-hand side (trimmed)
 * @param {Set<string>} bindingNames
 * @returns {boolean}
 */
export function isPlaywrightRebindRhs(rhs, bindingNames) {
  // Strip only a trailing statement terminator (optional). Commas and
  // interior semicolons belong to generics / fixture object literals and
  // must remain for balanced-skip parsing.
  const s = (rhs ?? "").trim().replace(/;\s*$/, "").trim();
  if (!s) return false;

  let i = 0;
  const idMatch = s.slice(i).match(/^([A-Za-z_$][\w$]*)/);
  if (!idMatch || !bindingNames.has(idMatch[1])) return false;
  i += idMatch[1].length;

  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) return true;

    if (s[i] !== ".") return false;
    i++;
    while (i < s.length && /\s/.test(s[i])) i++;
    if (!s.startsWith("extend", i)) return false;
    i += "extend".length;
    while (i < s.length && /\s/.test(s[i])) i++;

    // Optional TypeScript type arguments: .extend<MyFixtures>(...)
    // Multi-arg (Foo, Bar) and nested (Foo<Bar<Baz>>) via balanced skip.
    if (s[i] === "<") {
      const after = skipBalanced(s, i, "<", ">");
      if (after < 0) return false;
      i = after;
      while (i < s.length && /\s/.test(s[i])) i++;
    }

    if (s[i] !== "(") return false;
    const afterCall = skipBalanced(s, i, "(", ")");
    if (afterCall < 0) return false;
    i = afterCall;
  }
  return true;
}

/**
 * Expand inventory ID tokens and inclusive letter-ranges from an owner-amendment
 * item cell (e.g. `A01`, `A01 A02`, `A01–A03`, `inv:B01-B02`).
 *
 * @param {string} itemCell
 * @returns {string[]}
 */
export function expandInventoryIdsFromItem(itemCell) {
  const text = normalizeCell(itemCell);
  if (!text) return [];
  /** @type {string[]} */
  const ids = [];
  // Inclusive ranges: A01–A03 or A01-A03 (en-dash or hyphen)
  const rangeRe = /\b([A-Z])(\d{2})\s*[–-]\s*\1(\d{2})\b/g;
  let m;
  const consumed = new Set();
  while ((m = rangeRe.exec(text)) !== null) {
    const letter = m[1];
    const start = Number(m[2]);
    const end = Number(m[3]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    // Cap range expansion to avoid pathological owner rows
    if (end - start > 200) continue;
    for (let n = start; n <= end; n++) {
      const id = `${letter}${String(n).padStart(2, "0")}`;
      ids.push(id);
      consumed.add(id);
    }
  }
  // Bare IDs not already covered by a range match span
  const bareRe = /\b([A-Z]\d{2})\b/g;
  while ((m = bareRe.exec(text)) !== null) {
    if (!consumed.has(m[1])) ids.push(m[1]);
  }
  return ids;
}

/**
 * Parse the constitution Article 0 **DEFER rows** table and return inventory
 * IDs that have a non-empty owner amendment (Reason + Date + Owner).
 *
 * Placeholder rows (`*(none yet)*`, empty cells) do not authorize DEFER.
 * Soul-only deferrals without an inventory ID do not authorize inventory rows.
 *
 * @param {string} constitutionBody
 * @returns {Set<string>}
 */
export function extractOwnerDeferInventoryIds(constitutionBody) {
  /** @type {Set<string>} */
  const authorized = new Set();
  const body = constitutionBody ?? "";

  // Anchor on the DEFER rows section (constitution Article 0) only —
  // do not scan unrelated tables elsewhere in the document.
  const sectionRe =
    /\*\*DEFER rows\*\*[^\n]*\n([\s\S]*?)(?=\n\*\*[^*]|\n##\s|$)/i;
  const sectionMatch = body.match(sectionRe);
  if (!sectionMatch) return authorized;
  const section = sectionMatch[1];

  // Table rows: | item | reason | date | owner |
  const rowRe = /^\|\s*([^|]+)\|\s*([^|]*)\|\s*([^|]*)\|\s*([^|]*)\|/gm;
  let m;
  while ((m = rowRe.exec(section)) !== null) {
    const item = normalizeCell(m[1]);
    const reason = normalizeCell(m[2]);
    const date = normalizeCell(m[3]);
    const owner = normalizeCell(m[4]);

    // Skip markdown header / separator / empty placeholder
    if (!item) continue;
    if (/^soul\s*\/\s*item$/i.test(item)) continue;
    if (/^[-:]+$/.test(item.replace(/\s/g, ""))) continue;
    if (/\*\(\s*none yet\s*\)\*/i.test(item) || /^none yet$/i.test(item)) {
      continue;
    }
    // Header row when all three label cells match (do not treat a real Owner
    // name of "owner" as a header just because that column is named Owner).
    if (
      /^reason$/i.test(reason) &&
      /^date$/i.test(date) &&
      /^owner$/i.test(owner)
    ) {
      continue;
    }
    // Amendment requires evidence fields — blank reason/date/owner is not authoritative
    if (!reason || !date || !owner) continue;

    for (const id of expandInventoryIdsFromItem(item)) {
      authorized.add(id);
    }
  }
  return authorized;
}

/**
 * Run inventory lint.
 *
 * @param {object} [options]
 * @param {string} [options.root]
 * @param {string} [options.inventoryPath]
 * @param {string} [options.baselinePath]
 * @param {string[]} [options.e2eRoots]
 * @param {boolean} [options.fullGate]
 * @param {string} [options.constitutionPath] owner DEFER table (Article 0)
 * @param {unknown} [options.playwrightSuite] injected config-selected suite
 *   (Phase 8: entries must include status/outcome for execution proof)
 * @param {string} [options.suiteReportPath] Playwright run/list report JSON path
 *   (env: E2E_PLAYWRIGHT_RUN_REPORT | E2E_PLAYWRIGHT_SUITE_REPORT)
 * @param {boolean} [options.allowPlaywrightCli] default true; false skips live --list
 * @param {typeof spawnSync} [options.spawnSyncImpl] test override for CLI list
 * @param {string[]} [options.argv] defaults to process.argv
 * @param {NodeJS.ProcessEnv} [options.env] defaults to process.env
 * @param {boolean} [options.silent] suppress console I/O (tests)
 * @returns {{ ok: boolean, exitCode: number, stdout: string, stderr: string }}
 */
export function runInventoryLint(options = {}) {
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv;
  const root = options.root ?? defaultRoot;
  const silent = options.silent === true;
  const outLines = [];
  const errLines = [];
  const log = (msg) => {
    outLines.push(msg);
    if (!silent) console.log(msg);
  };
  const logErr = (msg) => {
    errLines.push(msg);
    if (!silent) console.error(msg);
  };
  const fail = (msg) => {
    throw new InventoryLintError(msg);
  };

  try {
    const inventoryPath =
      options.inventoryPath ||
      env.E2E_INVENTORY_PATH ||
      join(root, "KMS-competition", "initiative", "BROWSER_E2E_INVENTORY.md");
    const baselinePath =
      options.baselinePath ||
      env.E2E_INVENTORY_BASELINE_PATH ||
      join(root, "scripts", "e2e-inventory-required-baseline.json");
    const constitutionPath =
      options.constitutionPath ||
      env.E2E_CONSTITUTION_PATH ||
      join(root, "KMS-competition", "initiative", "00_CONSTITUTION.md");

    const fullGate =
      options.fullGate === true ||
      argv.includes("--phase8") ||
      argv.includes("--full") ||
      env.E2E_INVENTORY_GATE === "phase8" ||
      env.E2E_INVENTORY_GATE === "full";

    if (!existsSync(inventoryPath)) {
      fail(`canonical inventory missing: ${inventoryPath}`);
    }

    if (!existsSync(baselinePath)) {
      fail(
        `ratified baseline missing: ${baselinePath} (exact REQUIRED ID set from section 0.3)`,
      );
    }

    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    const baselineIds = Array.isArray(baseline.required_ids)
      ? baseline.required_ids
      : null;
    if (!baselineIds || baselineIds.length === 0) {
      fail("baseline required_ids empty or invalid");
    }
    const baselineSet = new Set(baselineIds);
    if (baselineSet.size !== baselineIds.length) {
      fail("baseline required_ids contains duplicates");
    }

    /** @type {Record<string, { test_id: string, journey: string }> | null} */
    const baselineFingerprints =
      baseline.fingerprints && typeof baseline.fingerprints === "object"
        ? baseline.fingerprints
        : null;
    if (!baselineFingerprints) {
      fail(
        "baseline fingerprints missing — anti-reuse requires stable test_id/journey per baseline ID",
      );
    }
    for (const id of baselineIds) {
      const fp = baselineFingerprints[id];
      if (!fp || typeof fp !== "object") {
        fail(`baseline fingerprint missing for ID ${id}`);
      }
      if (!normalizeCell(fp.test_id)) {
        fail(`baseline fingerprint for ${id} has empty test_id`);
      }
      if (!normalizeCell(fp.journey)) {
        fail(`baseline fingerprint for ${id} has empty journey`);
      }
    }

    const body = readFileSync(inventoryPath, "utf8");

    // Journey rows: | ID | Role | Surface | Journey | test_id | Negative | Required | Status |
    // Parse ALL table-shaped journey rows first. Status validity is enforced after parse.
    const rowRe =
      /^\| ([A-Z]\d{2}) \|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\| (REQUIRED|OPTIONAL) \|([^|]*)\|/gm;
    /** @type {{ id: string, journey: string, testId: string, required: boolean, status: string, statusRaw: string }[]} */
    const journeys = [];
    let m;
    while ((m = rowRe.exec(body)) !== null) {
      const statusRaw = m[8].trim();
      journeys.push({
        id: m[1].trim(),
        journey: normalizeCell(m[4]),
        testId: normalizeCell(m[5]),
        required: m[7] === "REQUIRED",
        status: statusRaw === "" ? "" : statusRaw.toUpperCase(),
        statusRaw,
      });
    }

    if (journeys.length === 0) {
      fail("no inventory journey rows parsed (expected | ID | ... | REQUIRED | STATUS |)");
    }

    const invalidStatuses = journeys.filter((j) => !ALLOWED_STATUSES.has(j.status));
    if (invalidStatuses.length > 0) {
      const detail = invalidStatuses
        .slice(0, 20)
        .map((j) => {
          const shown = j.statusRaw === "" ? "<blank>" : j.statusRaw;
          return `${j.id}=${shown}`;
        })
        .join(", ");
      fail(
        `unrecognized inventory status (allowed: OPEN|IMPLEMENTED|PASS|FAIL|DEFER): ${detail}` +
          (invalidStatuses.length > 20
            ? ` …(+${invalidStatuses.length - 20})`
            : ""),
      );
    }

    const ids = journeys.map((j) => j.id);
    const unique = new Set(ids);
    if (unique.size !== ids.length) {
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      fail(`duplicate inventory IDs: ${[...new Set(dupes)].join(", ")}`);
    }

    // --- 1:1 test_id map: every REQUIRED row needs a non-empty unique test_id ---
    const requiredJourneys = journeys.filter((j) => j.required);
    const missingTestIds = requiredJourneys
      .filter((j) => !j.testId)
      .map((j) => j.id);
    if (missingTestIds.length > 0) {
      fail(
        `REQUIRED rows missing non-empty test_id: ${idList(missingTestIds)}`,
      );
    }

    const requiredTestIds = requiredJourneys.map((j) => j.testId);
    const testIdSet = new Set(requiredTestIds);
    if (testIdSet.size !== requiredTestIds.length) {
      const seen = new Map();
      const dupes = [];
      for (const j of requiredJourneys) {
        if (seen.has(j.testId)) {
          dupes.push(`${j.testId} (${seen.get(j.testId)} and ${j.id})`);
        } else {
          seen.set(j.testId, j.id);
        }
      }
      fail(
        `duplicate test_id values break 1:1 inventory-to-test mapping: ${[...new Set(dupes)].slice(0, 20).join(", ")}`,
      );
    }

    const allTestIds = journeys.map((j) => j.testId).filter(Boolean);
    const allTestIdSet = new Set(allTestIds);
    if (allTestIdSet.size !== allTestIds.length) {
      fail("duplicate test_id values across inventory rows (including OPTIONAL)");
    }

    const byId = new Map(journeys.map((j) => [j.id, j]));
    const requiredIds = requiredJourneys.map((j) => j.id);
    const inventoryDeferIds = journeys
      .filter((j) => j.status === "DEFER")
      .map((j) => j.id);

    // --- Owner DEFER amendments (constitution Article 0) ---
    // Status DEFER is not self-authorizing: each inventory DEFER must appear
    // in the constitution DEFER table with Reason + Date + Owner. Without that
    // record, DEFER cannot leave the required PASS set (anti mass-DEFER greenwash).
    /** @type {Set<string>} */
    let ownerAuthorizedDeferIds = new Set();
    if (inventoryDeferIds.length > 0) {
      if (!existsSync(constitutionPath)) {
        fail(
          `inventory DEFER rows require owner amendment records but constitution missing: ${constitutionPath}` +
            ` (unauthorized DEFER: ${idList(inventoryDeferIds)})`,
        );
      }
      const constitutionBody = readFileSync(constitutionPath, "utf8");
      ownerAuthorizedDeferIds = extractOwnerDeferInventoryIds(constitutionBody);
      const unauthorizedDefer = inventoryDeferIds.filter(
        (id) => !ownerAuthorizedDeferIds.has(id),
      );
      if (unauthorizedDefer.length > 0) {
        fail(
          `inventory DEFER without owner amendment (constitution DEFER table must list ID with Reason, Date, Owner): ${idList(unauthorizedDefer)}`,
        );
      }
      log(
        `[test:e2e:inventory] OK: ${inventoryDeferIds.length} inventory DEFER row(s) authorized by owner amendment`,
      );
    }

    /** Authorized DEFER only — used for PASS-set exemption and anti-shrinkage. */
    const deferIds = new Set(
      inventoryDeferIds.filter((id) => ownerAuthorizedDeferIds.has(id)),
    );

    if (requiredIds.length === 0) {
      fail("REQUIRED set is empty — forbidden (would green-wash dogfood gate)");
    }

    // --- Anti-shrinkage: exact ratified baseline ID set (including growth) ---
    // Every baseline ID must remain in inventory; every inventory REQUIRED ID
    // must be ratified into the persistent baseline with fingerprints so new
    // journeys cannot later shrink without a gate failure.
    const missingFromInventory = baselineIds.filter((id) => !byId.has(id));
    if (missingFromInventory.length > 0) {
      fail(
        `baseline IDs deleted or renamed (anti-shrinkage; owner DEFER row required, not deletion): ${idList(missingFromInventory)}`,
      );
    }

    const missingFromBaseline = requiredIds.filter((id) => !baselineSet.has(id));
    if (missingFromBaseline.length > 0) {
      fail(
        `new REQUIRED IDs missing from persistent baseline (ratify into e2e-inventory-required-baseline.json with fingerprints so growth is protected from later shrinkage): ${idList(missingFromBaseline)}`,
      );
    }

    const unauthorizedDrops = [];
    for (const id of baselineIds) {
      const row = byId.get(id);
      if (!row) continue;
      if (row.required) continue;
      // OPTIONAL only allowed when authorized owner DEFER also present
      if (row.status === "DEFER" && deferIds.has(id)) continue;
      unauthorizedDrops.push(id);
    }
    if (unauthorizedDrops.length > 0) {
      fail(
        `baseline IDs no longer REQUIRED without owner DEFER status: ${idList(unauthorizedDrops)}`,
      );
    }

    const baselineStillRequired = baselineIds.filter((id) => {
      const row = byId.get(id);
      return row && row.required && !deferIds.has(id);
    });
    const baselineDeferred = baselineIds.filter((id) => deferIds.has(id));
    const minRequired = baselineIds.length - baselineDeferred.length;
    if (baselineStillRequired.length < minRequired) {
      fail(
        `REQUIRED baseline coverage ${baselineStillRequired.length} < ${minRequired} (baseline ${baselineIds.length} − ${baselineDeferred.length} DEFER)`,
      );
    }

    // --- Anti-reuse: baseline ID must keep stable test_id + journey fingerprint ---
    // Fingerprints cover the full baseline set; because every REQUIRED inventory
    // ID must be in the baseline, growth is fingerprint-locked too.
    const fingerprintMismatches = [];
    for (const id of baselineIds) {
      const row = byId.get(id);
      if (!row) continue;
      const fp = baselineFingerprints[id];
      const expectedTestId = normalizeCell(fp.test_id);
      const expectedJourney = normalizeCell(fp.journey);
      if (row.testId !== expectedTestId || row.journey !== expectedJourney) {
        fingerprintMismatches.push(id);
      }
    }
    if (fingerprintMismatches.length > 0) {
      fail(
        `baseline ID reuse / semantic drift (test_id or journey changed; IDs must not be reused for different behavior): ${idList(fingerprintMismatches)}`,
      );
    }

    // Law markers in canonical file
    if (
      !/REQUIRED\s*=\s*must PASS for dogfood/i.test(body) &&
      !/must PASS for dogfood_ready/i.test(body)
    ) {
      if (!/dogfood_ready/i.test(body) || !/REQUIRED/i.test(body)) {
        fail("inventory must define REQUIRED relative to dogfood / dogfood_ready");
      }
    }

    if (!/Discovery crawl REQUIRED at Phase 8/i.test(body)) {
      fail("inventory must state discovery crawl REQUIRED at Phase 8");
    }

    if (
      !/@inv:/i.test(body) &&
      !/must tag `@inv:/i.test(body) &&
      !/tag `@inv:/i.test(body)
    ) {
      if (!/@inv:A01/.test(body)) {
        fail("inventory must document @inv tagging convention");
      }
    }

    log(
      `[test:e2e:inventory] OK: baseline ${baselineIds.length} IDs intact` +
        ` (${baselineStillRequired.length} REQUIRED non-DEFER, ${baselineDeferred.length} DEFER);` +
        ` inventory ${requiredIds.length} REQUIRED, ${unique.size} unique IDs, ${testIdSet.size} unique test_ids; fingerprints match`,
    );

    // --- Phase 8: every non-owner-DEFER REQUIRED row must claim status PASS ---
    // Ratified law (0.3 §2): CI fails if REQUIRED and not PASS at the Phase 8
    // gate. Intermediate modes do not enforce PASS (OPEN→IMPLEMENTED lifecycle).
    // Only constitution-authorized DEFER rows are exempt (see deferIds).
    if (fullGate) {
      const notPass = journeys
        .filter(
          (j) =>
            j.required &&
            !deferIds.has(j.id) &&
            j.status !== "PASS",
        )
        .map((j) => `${j.id}=${j.status || "<blank>"}`);
      if (notPass.length > 0) {
        fail(
          `Phase 8 full gate: every non-DEFER REQUIRED row must have status PASS` +
            ` (dogfood_ready / inventory law); not PASS: ${idList(notPass)}`,
        );
      }
      log(
        `[test:e2e:inventory] OK: Phase 8 status claim — ${baselineStillRequired.length} non-DEFER REQUIRED rows are PASS` +
          (deferIds.size
            ? ` (${deferIds.size} owner-authorized DEFER exempt)`
            : ""),
      );
    }

    // --- @inv tag coverage on real Playwright tests (decision table) ---
    // Prefer Playwright config-selected suite (S-E2E-RUN alignment) over a raw
    // walk of hard-coded e2e roots so testIgnore/testMatch/projects and
    // non-listed titles cannot green-wash coverage.
    const defaultE2eRoots = [
      join(root, "playwright", "e2e"),
      join(root, "e2e"),
      join(root, "apps", "web", "e2e"),
    ];
    const e2eRoots = options.e2eRoots ?? defaultE2eRoots;
    const existingRoots = e2eRoots.filter((d) => existsSync(d));

    const playwrightConfigPath =
      options.playwrightConfigPath !== undefined
        ? options.playwrightConfigPath
        : findPlaywrightConfig(root);

    /** @type {{ files: string[], entries: PlaywrightSuiteEntry[], source: string, hasExecutionOutcomes: boolean } | null} */
    let selectedSuite = null;
    // Resolve suite when injected/report provided, or when a real Playwright
    // config exists and caller did not force static e2eRoots-only mode.
    // Explicit e2eRoots (unit probes) still accept injected playwrightSuite.
    if (
      options.playwrightSuite != null ||
      options.suiteReportPath ||
      env.E2E_PLAYWRIGHT_RUN_REPORT ||
      env.E2E_PLAYWRIGHT_SUITE_REPORT ||
      env.E2E_PLAYWRIGHT_LIST_REPORT ||
      (playwrightConfigPath && options.e2eRoots === undefined)
    ) {
      selectedSuite = resolvePlaywrightSelectedSuite({
        root,
        configPath: playwrightConfigPath,
        playwrightSuite: options.playwrightSuite,
        suiteReportPath: options.suiteReportPath,
        env,
        spawnSyncImpl: options.spawnSyncImpl,
        allowCli: options.allowPlaywrightCli !== false,
      });
    }

    // Phase 8 + real Playwright config: suite reconciliation is mandatory.
    // Injected suite / report satisfies this; CLI list is collection-only
    // (execution proof is enforced separately via run-report outcomes).
    // Probe tests pass e2eRoots explicitly without a config — static mode OK
    // until tag targets exist (then Phase 8 requires a run report).
    if (
      fullGate &&
      playwrightConfigPath &&
      options.e2eRoots === undefined &&
      !selectedSuite
    ) {
      fail(
        "Phase 8 full gate: Playwright config found but config-selected suite could not be resolved " +
          `(config: ${playwrightConfigPath}). Provide an actual Playwright run report ` +
          "(E2E_PLAYWRIGHT_RUN_REPORT / E2E_PLAYWRIGHT_SUITE_REPORT JSON with per-test " +
          "status/outcome) so inventory IDs are validated against passed, non-skipped " +
          "execution results — not static e2e roots or `playwright test --list` alone.",
      );
    }

    /** @type {string[]} */
    let files;
    /** @type {string} */
    let coverageSource;
    if (selectedSuite) {
      // Restrict to suite files that exist on disk; titles filter findings later.
      files = selectedSuite.files.filter((f) => existsSync(f));
      // Suite may list relative paths that normalize differently — also try raw entries
      if (files.length === 0) {
        const fromEntries = [
          ...new Set(
            selectedSuite.entries
              .map((e) => {
                const abs = normalizePathKey(e.file, root);
                if (abs && existsSync(abs)) return abs;
                if (e.file && existsSync(e.file)) return resolve(e.file);
                return "";
              })
              .filter(Boolean),
          ),
        ];
        files = fromEntries;
      }
      coverageSource = `playwright-suite:${selectedSuite.source}`;
    } else {
      files = existingRoots.flatMap((d) => collectFiles(d));
      coverageSource = "static-e2e-roots";
    }

    /** IDs that must have @inv tags under current gate mode. */
    let tagTargets;
    let modeLabel;
    if (fullGate) {
      tagTargets = journeys
        .filter((j) => j.required && !deferIds.has(j.id))
        .map((j) => j.id);
      modeLabel = "phase8 full REQUIRED";
    } else {
      tagTargets = journeys
        .filter(
          (j) =>
            j.required &&
            !deferIds.has(j.id) &&
            TAG_REQUIRED_STATUSES.has(j.status),
        )
        .map((j) => j.id);
      modeLabel = "implemented/status-owned";
    }

    // Phase 8: absence of root or test files is always a hard failure.
    if (fullGate) {
      if (!selectedSuite && existingRoots.length === 0) {
        fail(
          "Phase 8 full gate: no E2E root found (expected playwright/e2e, e2e/, or apps/web/e2e) — tag coverage cannot be deferred",
        );
      }
      if (files.length === 0) {
        fail(
          selectedSuite
            ? "Phase 8 full gate: Playwright config-selected suite is empty or files missing on disk — full REQUIRED @inv coverage required"
            : "Phase 8 full gate: E2E root(s) present but no test files (*.ts|js|mjs|tsx) — full REQUIRED @inv coverage required",
        );
      }
    }

    // Any mode: if tag targets exist, test files must exist.
    if (tagTargets.length > 0 && files.length === 0) {
      const where = selectedSuite
        ? "Playwright config-selected suite empty or files missing on disk"
        : existingRoots.length === 0
          ? "no E2E root found (expected playwright/e2e, e2e/, or apps/web/e2e)"
          : "E2E root(s) present but no test files (*.ts|js|mjs|tsx)";
      fail(
        `${where}, while ${tagTargets.length} ${modeLabel} IDs require @inv tags: ${idList(tagTargets)}`,
      );
    }

    if (tagTargets.length > 0 && files.length > 0) {
      /** @type {{ id: string, skipped: boolean, focused: boolean, multiTag: boolean, title: string, file: string }[]} */
      const rawFindings = [];
      for (const f of files) {
        const src = readFileSync(f, "utf8");
        rawFindings.push(...extractInvTaggedTests(f, src));
      }

      // Reconcile with Playwright-selected suite: excluded files / unlisted
      // titles (dead code, testIgnore, wrong project) do not count.
      const allFindings = selectedSuite
        ? rawFindings.filter((finding) =>
            isFindingInPlaywrightSuite(finding, selectedSuite, root),
          )
        : rawFindings;

      // Strict 1:1: one test title must not own multiple inventory IDs.
      // Reject multi-tag declarations before counting coverage (anti-greenwash).
      const multiTagFindings = allFindings.filter((x) => x.multiTag);
      if (multiTagFindings.length > 0) {
        const multiTagIds = [...new Set(multiTagFindings.map((x) => x.id))];
        const sampleTitles = [
          ...new Set(multiTagFindings.map((x) => x.title.trim())),
        ].slice(0, 3);
        fail(
          `test() titles with multiple @inv tags break 1:1 inventory-to-test mapping` +
            ` (one journey cannot own multiple IDs): ${idList(multiTagIds)}` +
            (sampleTitles.length
              ? `; sample title(s): ${sampleTitles.map((t) => JSON.stringify(t.slice(0, 80))).join(", ")}`
              : ""),
        );
      }

      /** @type {Map<string, typeof allFindings>} */
      const findingsById = new Map();
      for (const finding of allFindings) {
        if (!findingsById.has(finding.id)) findingsById.set(finding.id, []);
        findingsById.get(finding.id).push(finding);
      }

      const missing = [];
      const commentOrLooseOnly = [];
      const skippedOnly = [];
      const suiteExcludedOnly = [];
      const duplicates = [];
      const focusedIds = [];
      const wrongTestId = [];

      // Detect loose @inv:ID occurrences that are NOT on a test title (comments etc.)
      // for clearer diagnostics when a target is missing.
      const looseBlob = files.map((f) => readFileSync(f, "utf8")).join("\n");
      // Static findings before suite filter — diagnose "tagged but not selected"
      const rawById = new Map();
      for (const finding of rawFindings) {
        if (!rawById.has(finding.id)) rawById.set(finding.id, []);
        rawById.get(finding.id).push(finding);
      }

      for (const id of tagTargets) {
        const list = findingsById.get(id) || [];
        // multiTag never counts as active ownership (already failed above if any)
        const active = list.filter((x) => !x.skipped && !x.multiTag);
        const skipped = list.filter((x) => x.skipped && !x.multiTag);

        if (active.length === 0 && skipped.length === 0) {
          const rawList = rawById.get(id) || [];
          const rawActive = rawList.filter((x) => !x.skipped && !x.multiTag);
          if (selectedSuite && rawActive.length > 0) {
            // Declaration exists in scanned files but is not in the selected suite
            suiteExcludedOnly.push(id);
          } else if (looseBlob.includes(`@inv:${id}`)) {
            commentOrLooseOnly.push(id);
          } else {
            missing.push(id);
          }
          continue;
        }
        if (active.length === 0) {
          skippedOnly.push(id);
          continue;
        }
        if (active.length > 1) {
          duplicates.push(id);
        }
        if (fullGate && active.some((x) => x.focused)) {
          focusedIds.push(id);
        }

        const row = byId.get(id);
        const testId = row?.testId || "";
        const anchorRoots =
          existingRoots.length > 0
            ? existingRoots
            : files.map((f) => dirname(f));
        const anchored = active.some((x) =>
          isTestIdAnchored({
            file: x.file,
            title: x.title,
            testId,
            e2eRoots: anchorRoots,
          }),
        );
        if (!anchored) {
          wrongTestId.push(id);
        }
      }

      if (missing.length > 0) {
        fail(
          `Playwright tree present but missing @inv on real Playwright-bound test() titles for ${modeLabel} IDs: ${idList(missing)}` +
            ` (calls must use a test binding imported from @playwright/test; local no-op test() does not count)` +
            (fullGate
              ? ""
              : " (OPEN rows deferred until owned; use E2E_INVENTORY_GATE=phase8 for full REQUIRED set)"),
        );
      }
      if (suiteExcludedOnly.length > 0) {
        fail(
          `@inv tags for ${modeLabel} IDs exist in source but are not in the Playwright config-selected suite` +
            ` (testIgnore/testMatch/projects exclusion, unlisted title, or dead conditional code — not executed by pnpm test:e2e): ${idList(suiteExcludedOnly)}`,
        );
      }
      if (commentOrLooseOnly.length > 0) {
        fail(
          `@inv tags for ${modeLabel} IDs appear only outside Playwright-bound test() titles (comments/strings/local no-op test() are not 1:1 coverage): ${idList(commentOrLooseOnly)}`,
        );
      }
      if (skippedOnly.length > 0) {
        fail(
          `@inv tags for ${modeLabel} IDs only appear on skipped/fixme/fail tests ` +
            `(not executable coverage; test.fail is expected-failure, not dogfood proof; ` +
            `tests nested under test.describe.skip / test.describe.fixme also count as skipped): ${idList(skippedOnly)}`,
        );
      }
      if (duplicates.length > 0) {
        fail(
          `duplicate active @inv owners break 1:1 inventory-to-test mapping: ${idList(duplicates)}`,
        );
      }
      if (focusedIds.length > 0) {
        fail(
          `focused test.only on REQUIRED journeys forbidden at Phase 8: ${idList(focusedIds)}`,
        );
      }
      if (wrongTestId.length > 0) {
        fail(
          `@inv tags not anchored to inventory test_id (file path or title must reference test_id): ${idList(wrongTestId)}`,
        );
      }

      // --- Phase 8 execution proof (S-E2E-RUN): run report, not --list ---
      // Collection via `playwright test --list` or list-shaped reports omits
      // outcomes; describe.skip / runtime skip still appear as selected.
      // Require a real run report and passed, non-skipped results per ID.
      // Discovery (selectedSuite) stays config-selected / --list; outcomes
      // load from default/explicit playwright-run.json separately so a
      // partial single-spec report cannot shrink tag reconciliation.
      if (fullGate) {
        const runReport = resolvePlaywrightRunReport({
          root,
          playwrightSuite: options.playwrightSuite,
          suiteReportPath: options.suiteReportPath,
          env,
          selectedSuite,
        });
        if (!runReport) {
          const defaultReport = defaultPlaywrightRunReportPath(root);
          fail(
            "Phase 8 full gate: require an actual Playwright run report with per-test " +
              "execution outcomes (status/outcome), not `playwright test --list` collection " +
              "alone. Run `pnpm test:e2e` first (writes reports/playwright-run.json by default), " +
              "or set E2E_PLAYWRIGHT_RUN_REPORT / E2E_PLAYWRIGHT_SUITE_REPORT to a JSON run " +
              "report with status/outcome (or inject playwrightSuite entries) so every " +
              "non-DEFER REQUIRED ID can be verified as passed and non-skipped. " +
              `Default report path: ${defaultReport}. ` +
              (selectedSuite
                ? `Discovery suite source "${selectedSuite.source}" has no execution outcomes ` +
                  "and no default/explicit run report with outcomes was found."
                : "No suite/run report was resolved."),
          );
        }

        const missingExec = [];
        const skippedExec = [];
        const notPassedExec = [];
        for (const id of tagTargets) {
          const list = findingsById.get(id) || [];
          const active = list.filter((x) => !x.skipped && !x.multiTag);
          /** @type {PlaywrightSuiteEntry[]} */
          const matched = [];
          for (const finding of active) {
            matched.push(
              ...matchingSuiteEntries(finding, runReport, root),
            );
          }
          // De-dupe by file|title|status|outcome
          const seen = new Set();
          const uniqueMatched = matched.filter((e) => {
            const k = `${e.file}\0${e.title}\0${e.status ?? ""}\0${e.outcome ?? ""}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          });

          if (uniqueMatched.length === 0) {
            missingExec.push(id);
            continue;
          }
          if (uniqueMatched.some(isPassedNonSkippedResult)) {
            continue;
          }
          if (uniqueMatched.every(isSkippedExecutionResult)) {
            skippedExec.push(id);
          } else {
            notPassedExec.push(id);
          }
        }

        if (missingExec.length > 0) {
          fail(
            `Phase 8 full gate: non-DEFER REQUIRED IDs have @inv tags but no matching ` +
              `Playwright run-report entry (file/title): ${idList(missingExec)}`,
          );
        }
        if (skippedExec.length > 0) {
          fail(
            `Phase 8 full gate: non-DEFER REQUIRED IDs only have skipped execution results ` +
              `(describe.skip / test.skip / runtime skip — not dogfood proof): ${idList(skippedExec)}`,
          );
        }
        if (notPassedExec.length > 0) {
          fail(
            `Phase 8 full gate: non-DEFER REQUIRED IDs lack a passed, non-skipped execution ` +
              `result in the Playwright run report: ${idList(notPassedExec)}`,
          );
        }

        log(
          `[test:e2e:inventory] OK: Phase 8 run report — ${tagTargets.length} non-DEFER REQUIRED ` +
            `IDs have passed, non-skipped execution results (source: ${runReport.source})`,
        );
      }

      log(
        `[test:e2e:inventory] OK: @inv on Playwright-bound test() titles cover ${tagTargets.length} ${modeLabel} IDs (1:1, non-skip/non-fail, test_id-anchored, ${coverageSource})` +
          (fullGate
            ? ""
            : ` (${requiredIds.length - deferIds.size} total non-DEFER REQUIRED at Phase 8)`),
      );
    } else if (fullGate && tagTargets.length > 0) {
      // tagTargets exist but no files were scanned — already failed above when
      // files.length === 0; this branch is defensive for empty tag+file edge cases.
      fail(
        "Phase 8 full gate: non-DEFER REQUIRED IDs require Playwright-bound @inv coverage " +
          "and a run report with passed, non-skipped results",
      );
    } else if (!fullGate) {
      // tagTargets empty: all journeys still OPEN/DEFER — pre-harness deferral is OK
      log(
        "[test:e2e:inventory] note: no status-owned IDs require @inv yet — tag coverage deferred until harness / IMPLEMENTED rows (Phase 1.5+)",
      );
    }

    // Phase 8 with tag targets but we never entered the files>0 block should
    // already have failed. When fullGate and tagTargets is empty (all DEFER),
    // no run report is required.

    return {
      ok: true,
      exitCode: 0,
      stdout: outLines.join("\n") + (outLines.length ? "\n" : ""),
      stderr: errLines.join("\n") + (errLines.length ? "\n" : ""),
    };
  } catch (e) {
    if (e instanceof InventoryLintError) {
      const msg = `[test:e2e:inventory] FAIL: ${e.message}`;
      logErr(msg);
      return {
        ok: false,
        exitCode: 1,
        stdout: outLines.join("\n") + (outLines.length ? "\n" : ""),
        stderr: errLines.join("\n") + (errLines.length ? "\n" : ""),
      };
    }
    throw e;
  }
}

function isExecutedAsMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return false;
  }
}

if (isExecutedAsMain()) {
  const result = runInventoryLint();
  process.exit(result.exitCode);
}
