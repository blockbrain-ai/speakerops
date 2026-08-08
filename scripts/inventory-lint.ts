/**
 * Section 1.5 — Playwright inventory harness linter
 *
 * Reads BROWSER_E2E_INVENTORY.md Required column and fails when REQUIRED
 * inventory IDs lack `@inv:ID` on real Playwright-bound `test()` titles.
 *
 * CLI (non-interactive):
 *   pnpm test:e2e:inventory
 *   tsx scripts/inventory-lint.ts
 *   tsx scripts/inventory-lint.ts --phase8
 *   tsx scripts/inventory-lint.ts --allow-missing-until=8.2
 *
 * Default intermediate mode allows OPEN (not-yet-implemented) rows to lack
 * tags — equivalent to `--allow-missing-until=8.2`. Phase 8 full gate
 * (`E2E_INVENTORY_GATE=phase8` / `--phase8`) turns allow-missing OFF and
 * requires tags + status PASS + run-report proof for every non-DEFER REQUIRED ID.
 *
 * Full anti-shrinkage / DEFER / suite reconciliation lives in
 * `scripts/e2e-inventory-lint.mjs` (section 0.3). This module is the TypeScript
 * harness entry + fixture unit surface for section 1.5.
 *
 * Convention: `@inv:A01` on Playwright `test()` titles (see docs/E2E.md).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  extractInvTaggedTests,
  runInventoryLint,
  type InventoryLintResult,
} from "./e2e-inventory-lint.mjs";
// Types: scripts/e2e-inventory-lint.d.ts

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Allowed inventory Status values (0.3 law). */
export const ALLOWED_STATUSES = new Set([
  "OPEN",
  "IMPLEMENTED",
  "PASS",
  "FAIL",
  "DEFER",
]);

/** Statuses that claim ownership and require @inv in intermediate mode. */
export const TAG_REQUIRED_STATUSES = new Set(["IMPLEMENTED", "PASS", "FAIL"]);

export type InventoryJourneyRow = {
  id: string;
  role: string;
  surface: string;
  journey: string;
  testId: string;
  negative: string;
  required: boolean;
  status: string;
  statusRaw: string;
};

export type InvFinding = {
  id: string;
  skipped: boolean;
  focused: boolean;
  multiTag: boolean;
  title: string;
  file: string;
};

export type FixtureLintOptions = {
  /** Markdown body of a BROWSER_E2E_INVENTORY-shaped table (or full file). */
  inventoryMarkdown: string;
  /**
   * Relative path → source for Playwright test files under a virtual e2e root.
   * Sources must import `test` from `@playwright/test` for tags to count.
   */
  testSources?: Record<string, string>;
  /**
   * Restrict the REQUIRED set under test (e.g. `["A01"]`).
   * When omitted, every REQUIRED row in the markdown is considered.
   */
  requiredSubset?: string[];
  /**
   * When true, every REQUIRED id in the subset must have an active @inv tag
   * regardless of Status (fixture unit mode for deliberate missing-tag tests).
   */
  requireAllRequiredTags?: boolean;
  /**
   * Statuses that require tags when `requireAllRequiredTags` is false.
   * Defaults to IMPLEMENTED | PASS | FAIL (intermediate gate).
   */
  tagRequiredStatuses?: Set<string> | string[];
  /**
   * Allow missing tags for not-yet-implemented (OPEN) rows until the named
   * phase (e.g. `"8.2"`). Ignored when `requireAllRequiredTags` is true.
   * Phase 8 full gate leaves this OFF.
   */
  allowMissingUntil?: string | null;
  /** Optional label for diagnostics. */
  label?: string;
};

export type FixtureLintResult = {
  ok: boolean;
  exitCode: 0 | 1;
  missing: string[];
  tagged: string[];
  requiredIds: string[];
  tagTargets: string[];
  stdout: string;
  stderr: string;
};

/** Normalize empty / dash placeholders. */
export function normalizeCell(s: string | undefined | null): string {
  const t = (s ?? "").trim();
  if (t === "" || t === "—" || t === "-" || t === "–") return "";
  return t;
}

/**
 * Parse journey rows from inventory markdown.
 * Columns: ID | Role | Surface | Journey | test_id | Negative | Required | Status
 */
export function parseInventoryMarkdown(md: string): InventoryJourneyRow[] {
  const rowRe =
    /^\| ([A-Z]\d{2}) \|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\| (REQUIRED|OPTIONAL) \|([^|]*)\|/gm;
  const journeys: InventoryJourneyRow[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(md)) !== null) {
    const statusRaw = m[8].trim();
    journeys.push({
      id: m[1].trim(),
      role: normalizeCell(m[2]),
      surface: normalizeCell(m[3]),
      journey: normalizeCell(m[4]),
      testId: normalizeCell(m[5]),
      negative: normalizeCell(m[6]),
      required: m[7] === "REQUIRED",
      status: statusRaw === "" ? "" : statusRaw.toUpperCase(),
      statusRaw,
    });
  }
  return journeys;
}

/** REQUIRED journey IDs from inventory markdown (Required column). */
export function parseRequiredIds(md: string): string[] {
  return parseInventoryMarkdown(md)
    .filter((j) => j.required)
    .map((j) => j.id);
}

/** Collect @inv findings from a single source file (Playwright-bound only). */
export function collectInvFindings(filePath: string, source: string): InvFinding[] {
  return extractInvTaggedTests(filePath, source) as InvFinding[];
}

/**
 * Fixture-oriented inventory lint for unit tests.
 *
 * - Parses the Required column from markdown.
 * - Scans provided test sources for `@inv:ID` on Playwright-bound tests.
 * - Exit 1 when any tag target lacks an active (non-skip, non-multi) tag.
 *
 * Use `requireAllRequiredTags: true` to assert every REQUIRED id in a subset
 * must be tagged (deliberate missing A01 fixture). Intermediate product mode
 * uses status-owned targets only (OPEN may miss tags when allow-missing is on).
 */
export function lintInventoryFixtures(options: FixtureLintOptions): FixtureLintResult {
  const outLines: string[] = [];
  const errLines: string[] = [];
  const log = (msg: string) => outLines.push(msg);
  const logErr = (msg: string) => errLines.push(msg);

  const journeys = parseInventoryMarkdown(options.inventoryMarkdown);
  if (journeys.length === 0) {
    const msg =
      "inventory-lint: no journey rows parsed (expected | ID | … | REQUIRED | STATUS |)";
    logErr(msg);
    return {
      ok: false,
      exitCode: 1,
      missing: [],
      tagged: [],
      requiredIds: [],
      tagTargets: [],
      stdout: outLines.join("\n") + (outLines.length ? "\n" : ""),
      stderr: errLines.join("\n") + (errLines.length ? "\n" : ""),
    };
  }

  const invalid = journeys.filter((j) => !ALLOWED_STATUSES.has(j.status));
  if (invalid.length > 0) {
    const detail = invalid
      .slice(0, 10)
      .map((j) => `${j.id}=${j.statusRaw === "" ? "<blank>" : j.statusRaw}`)
      .join(", ");
    logErr(`inventory-lint: unrecognized inventory status: ${detail}`);
    return {
      ok: false,
      exitCode: 1,
      missing: [],
      tagged: [],
      requiredIds: [],
      tagTargets: [],
      stdout: outLines.join("\n") + (outLines.length ? "\n" : ""),
      stderr: errLines.join("\n") + (errLines.length ? "\n" : ""),
    };
  }

  let required = journeys.filter((j) => j.required);
  if (options.requiredSubset && options.requiredSubset.length > 0) {
    const want = new Set(options.requiredSubset);
    required = required.filter((j) => want.has(j.id));
  }
  const requiredIds = required.map((j) => j.id);

  const statusSet =
    options.tagRequiredStatuses instanceof Set
      ? options.tagRequiredStatuses
      : new Set(options.tagRequiredStatuses ?? [...TAG_REQUIRED_STATUSES]);

  /**
   * allow-missing-until set (e.g. "8.2") → intermediate: only status-owned need tags.
   * allow-missing-until null/"" and not requireAllRequiredTags → strict all non-DEFER REQUIRED.
   * requireAllRequiredTags → every REQUIRED id in subset (fixture unit mode).
   */
  const allowMissingOpen =
    options.allowMissingUntil != null && String(options.allowMissingUntil).length > 0;

  let tagTargets: string[];
  if (options.requireAllRequiredTags) {
    tagTargets = [...requiredIds];
  } else if (allowMissingOpen) {
    // Intermediate: only status-owned non-DEFER rows need tags (OPEN may miss)
    tagTargets = required
      .filter((j) => j.status !== "DEFER" && statusSet.has(j.status))
      .map((j) => j.id);
  } else {
    // Strict (Phase 8 style for fixtures): all non-DEFER REQUIRED
    tagTargets = required.filter((j) => j.status !== "DEFER").map((j) => j.id);
  }

  const findings: InvFinding[] = [];
  for (const [rel, source] of Object.entries(options.testSources ?? {})) {
    const filePath = rel.startsWith("/") ? rel : join("playwright/e2e", rel);
    findings.push(...collectInvFindings(filePath, source));
  }

  /** Active ownership: non-skip, non-multi-tag, Playwright-bound. */
  const activeById = new Map<string, InvFinding[]>();
  for (const f of findings) {
    if (f.skipped || f.multiTag) continue;
    const list = activeById.get(f.id) ?? [];
    list.push(f);
    activeById.set(f.id, list);
  }

  const tagged = [...activeById.keys()].sort();
  const missing = tagTargets.filter((id) => !activeById.has(id));

  if (missing.length > 0) {
    const msg =
      `inventory-lint: FAIL: missing @inv on Playwright-bound test() titles for ` +
      `REQUIRED IDs: ${missing.join(", ")}` +
      (options.label ? ` (${options.label})` : "") +
      ` — convention: test("@inv:A01 e2e/public/cfp-load …", …)`;
    logErr(msg);
    return {
      ok: false,
      exitCode: 1,
      missing,
      tagged,
      requiredIds,
      tagTargets,
      stdout: outLines.join("\n") + (outLines.length ? "\n" : ""),
      stderr: errLines.join("\n") + (errLines.length ? "\n" : ""),
    };
  }

  log(
    `inventory-lint: OK: ${tagTargets.length} tag target(s) covered` +
      (options.label ? ` (${options.label})` : "") +
      (options.allowMissingUntil
        ? ` [allow-missing-until=${options.allowMissingUntil}]`
        : ""),
  );
  return {
    ok: true,
    exitCode: 0,
    missing: [],
    tagged,
    requiredIds,
    tagTargets,
    stdout: outLines.join("\n") + (outLines.length ? "\n" : ""),
    stderr: errLines.join("\n") + (errLines.length ? "\n" : ""),
  };
}

/**
 * Build a minimal inventory markdown table for fixture tests.
 * @param rows id + status (+ optional test_id)
 */
export function buildFixtureInventory(
  rows: { id: string; status?: string; required?: boolean; testId?: string; journey?: string }[],
): string {
  const header =
    `| ID | Role | Surface | Journey | test_id | Negative | Required | Status |\n` +
    `|----|------|---------|---------|---------|----------|--------|\n`;
  const body = rows
    .map((r) => {
      const req = r.required === false ? "OPTIONAL" : "REQUIRED";
      const status = r.status ?? "OPEN";
      const testId = r.testId ?? `e2e/fixture/${r.id.toLowerCase()}`;
      const journey = r.journey ?? `Journey for ${r.id}`;
      return `| ${r.id} | public | /fixture | ${journey} | ${testId} | — | ${req} | ${status} |`;
    })
    .join("\n");
  return header + body + "\n";
}

/** Playwright-bound test source helper for fixtures. */
export function pwTaggedSource(id: string, testId: string, titleExtra = ""): string {
  const title = `@inv:${id} ${testId}${titleExtra ? ` ${titleExtra}` : ""}`.trim();
  return (
    `import { test, expect } from '@playwright/test';\n` +
    `test(${JSON.stringify(title)}, async () => { expect(true).toBeTruthy(); });\n`
  );
}

export type CliLintOptions = {
  root?: string;
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  silent?: boolean;
};

/**
 * Parse CLI flags for allow-missing-until / phase8.
 * Phase 8 full gate forces allow-missing OFF.
 */
export function parseAllowMissingUntil(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): { fullGate: boolean; allowMissingUntil: string | null } {
  const fullGate =
    argv.includes("--phase8") ||
    argv.includes("--full") ||
    env.E2E_INVENTORY_GATE === "phase8" ||
    env.E2E_INVENTORY_GATE === "full";

  let allowMissingUntil: string | null = null;
  for (const arg of argv) {
    if (arg.startsWith("--allow-missing-until=")) {
      allowMissingUntil = arg.slice("--allow-missing-until=".length) || null;
    }
  }
  // Intermediate default: allow missing for OPEN until 8.2 (documented convention)
  if (!fullGate && allowMissingUntil == null) {
    allowMissingUntil = "8.2";
  }
  // Phase 8: flag OFF by default
  if (fullGate) {
    allowMissingUntil = null;
  }
  return { fullGate, allowMissingUntil };
}

/**
 * Workspace inventory lint entry (delegates to 0.3 full gate engine).
 * Preserves anti-shrinkage, DEFER ownership, suite reconciliation, Phase 8 run proof.
 */
export function runWorkspaceInventoryLint(
  options: CliLintOptions = {},
): InventoryLintResult {
  const root = options.root ?? defaultRoot;
  const argv = options.argv ?? process.argv;
  const env = options.env ?? process.env;
  const { fullGate } = parseAllowMissingUntil(argv, env);

  return runInventoryLint({
    root,
    argv,
    env,
    fullGate,
    silent: options.silent === true,
  }) as InventoryLintResult;
}

/**
 * Write fixture sources into a temp-like directory for integration with
 * runInventoryLint when tests need the full engine (optional helper).
 */
export function writeFixtureTree(
  dir: string,
  files: Record<string, string>,
): string {
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    const dest = join(dir, name);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, body, "utf8");
  }
  return dir;
}

/** Collect .ts/.js/.mjs/.tsx files under dir. */
export function collectFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) collectFiles(p, acc);
    else if (/\.(ts|js|mjs|tsx)$/.test(name)) acc.push(p);
  }
  return acc;
}

function isExecutedAsMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return false;
  }
}

if (isExecutedAsMain()) {
  const result = runWorkspaceInventoryLint();
  process.exit(result.exitCode);
}
