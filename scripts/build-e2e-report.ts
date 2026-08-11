/**
 * Section 8.5 — E2E keystone HTML report (S-E2E-RUN evidence).
 *
 * Builds offline-readable `reports/e2e-coverage.html` from:
 *   - canonical inventory (`BROWSER_E2E_INVENTORY.md`)
 *   - optional Playwright JSON run report (`reports/playwright-run.json`)
 *
 * CLI (non-interactive):
 *   pnpm docs:e2e-report
 *   tsx scripts/build-e2e-report.ts
 *   tsx scripts/build-e2e-report.ts --out=path --suite=path --inventory=path
 *
 * Env **names** only (E10):
 *   E2E_PLAYWRIGHT_RUN_REPORT / E2E_PLAYWRIGHT_SUITE_REPORT — suite JSON path
 *   E2E_COVERAGE_HTML — output HTML path (default reports/e2e-coverage.html)
 *
 * Never logs secrets, API keys, or magic-link tokens.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  parseInventoryMarkdown,
  type InventoryJourneyRow,
} from "./inventory-lint.js";
import {
  isPassedNonSkippedResult,
  isSkippedExecutionResult,
  loadPlaywrightSuiteReport,
  normalizePlaywrightSuite,
  type PlaywrightSuiteEntry,
} from "./e2e-inventory-lint.mjs";

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export type CoverageRowStatus = "PASS" | "FAIL" | "DEFER" | "OPEN" | "IMPLEMENTED" | "UNKNOWN";

export type CoverageRow = {
  id: string;
  role: string;
  surface: string;
  journey: string;
  testId: string;
  required: boolean;
  /** Canonical inventory Status cell. */
  inventoryStatus: string;
  /**
   * Evidence status shown for S-E2E-RUN:
   * - PASS/FAIL from Playwright run when present
   * - SKIPPED/UNKNOWN run → FAIL for REQUIRED (not inventory PASS)
   * - missing run evidence → FAIL for REQUIRED non-DEFER claiming PASS
   *   (anti-greenwash; inventory Status alone is not execution proof)
   * - else inventory status for optional / DEFER / OPEN rows
   */
  status: CoverageRowStatus | string;
  /** Where `status` came from. */
  statusSource: "playwright" | "inventory";
  runTitle?: string;
  runFile?: string;
};

export type BuildE2eReportOptions = {
  root?: string;
  inventoryPath?: string;
  suiteReportPath?: string | null;
  /** Pre-parsed suite (tests / fixtures). When set, file path is ignored. */
  playwrightSuite?: unknown;
  outPath?: string;
  /** Override git SHA (tests). */
  gitSha?: string;
  /** Override generated-at ISO timestamp (tests). */
  generatedAt?: string;
  /** When true, do not write file — return HTML only. */
  dryRun?: boolean;
};

export type BuildE2eReportResult = {
  html: string;
  outPath: string;
  rows: CoverageRow[];
  requiredRows: CoverageRow[];
  summary: {
    required: number;
    pass: number;
    fail: number;
    defer: number;
    other: number;
    fromPlaywright: number;
    fromInventory: number;
  };
  gitSha: string;
  generatedAt: string;
  suiteSource: string | null;
};

const INV_RE = /@inv:([A-Z]\d{2}|L2-\d{2})\b/;

/** Escape text for HTML text/attr contexts. */
export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Resolve short git SHA for footer (no network). */
export function resolveGitSha(root: string, override?: string): string {
  if (override && override.trim()) return override.trim();
  try {
    const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      shell: false,
    });
    if (r.status === 0 && r.stdout?.trim()) return r.stdout.trim();
  } catch {
    /* ignore */
  }
  return "unknown";
}

/**
 * Map Playwright suite entries → inv id → best evidence row.
 * Prefer passed non-skipped; else any failed; else first match.
 */
export function mapInvFromSuite(
  entries: PlaywrightSuiteEntry[],
): Map<string, { status: "PASS" | "FAIL" | "SKIPPED" | "UNKNOWN"; title: string; file: string }> {
  const map = new Map<
    string,
    { status: "PASS" | "FAIL" | "SKIPPED" | "UNKNOWN"; title: string; file: string }
  >();

  for (const entry of entries) {
    const m = INV_RE.exec(entry.title ?? "");
    if (!m) continue;
    const id = m[1];
    let status: "PASS" | "FAIL" | "SKIPPED" | "UNKNOWN" = "UNKNOWN";
    if (isPassedNonSkippedResult(entry)) {
      status = "PASS";
    } else if (isSkippedExecutionResult(entry)) {
      status = "SKIPPED";
    } else if (
      entryHasFailToken(entry) ||
      entry.ok === false
    ) {
      status = "FAIL";
    }

    const prev = map.get(id);
    if (!prev) {
      map.set(id, { status, title: entry.title, file: entry.file });
      continue;
    }
    // Prefer PASS over FAIL over SKIPPED over UNKNOWN
    const rank = { PASS: 4, FAIL: 3, SKIPPED: 2, UNKNOWN: 1 } as const;
    if (rank[status] > rank[prev.status]) {
      map.set(id, { status, title: entry.title, file: entry.file });
    }
  }
  return map;
}

function entryHasFailToken(entry: PlaywrightSuiteEntry): boolean {
  const status = String(entry.status ?? "").trim().toLowerCase();
  const outcome = String(entry.outcome ?? "").trim().toLowerCase();
  const fail = new Set([
    "failed",
    "unexpected",
    "timedout",
    "timed_out",
    "interrupted",
  ]);
  return fail.has(status) || fail.has(outcome);
}

/** Normalize inventory status cell to a display token. */
export function normalizeInventoryStatus(raw: string): string {
  const t = (raw ?? "").trim().toUpperCase();
  if (!t || t === "—" || t === "-") return "UNKNOWN";
  // Status may include notes after space/paren
  const head = t.split(/[\s(/]/)[0] ?? t;
  if (["PASS", "FAIL", "OPEN", "IMPLEMENTED", "DEFER"].includes(head)) {
    return head;
  }
  return t;
}

/**
 * Build coverage rows: one per inventory journey; REQUIRED get PASS/FAIL evidence.
 *
 * S-E2E-RUN anti-greenwash: REQUIRED non-DEFER rows without a passed/failed
 * Playwright execution result must not inherit inventory Status=PASS.
 * Missing/invalid/empty run reports surface as FAIL (or UNKNOWN) so the
 * keystone HTML cannot claim PASS 108 with playwright 0 after a failed suite.
 */
export function buildCoverageRows(
  journeys: InventoryJourneyRow[],
  suiteByInv: Map<
    string,
    { status: "PASS" | "FAIL" | "SKIPPED" | "UNKNOWN"; title: string; file: string }
  >,
  options: {
    /**
     * When true (default), REQUIRED rows without Playwright PASS/FAIL evidence
     * cannot claim PASS from inventory alone.
     */
    requirePlaywrightForRequiredPass?: boolean;
  } = {},
): CoverageRow[] {
  const requirePw = options.requirePlaywrightForRequiredPass !== false;

  return journeys.map((j) => {
    const run = suiteByInv.get(j.id);
    const invStatus = normalizeInventoryStatus(j.status);
    if (run && (run.status === "PASS" || run.status === "FAIL")) {
      return {
        id: j.id,
        role: j.role,
        surface: j.surface,
        journey: j.journey,
        testId: j.testId,
        required: j.required,
        inventoryStatus: invStatus,
        status: run.status,
        statusSource: "playwright" as const,
        runTitle: run.title,
        runFile: run.file,
      };
    }
    // SKIPPED runtime is not evidence of PASS
    if (run && run.status === "SKIPPED") {
      return {
        id: j.id,
        role: j.role,
        surface: j.surface,
        journey: j.journey,
        testId: j.testId,
        required: j.required,
        inventoryStatus: invStatus,
        status: invStatus === "DEFER" ? "DEFER" : "FAIL",
        statusSource: "playwright" as const,
        runTitle: run.title,
        runFile: run.file,
      };
    }
    // UNKNOWN suite entry (had title match but no clear outcome)
    if (run && run.status === "UNKNOWN") {
      return {
        id: j.id,
        role: j.role,
        surface: j.surface,
        journey: j.journey,
        testId: j.testId,
        required: j.required,
        inventoryStatus: invStatus,
        status:
          invStatus === "DEFER"
            ? "DEFER"
            : j.required && requirePw
              ? "FAIL"
              : invStatus || "UNKNOWN",
        statusSource: "playwright" as const,
        runTitle: run.title,
        runFile: run.file,
      };
    }

    // No Playwright match: inventory-only fallback
    // REQUIRED non-DEFER cannot green-wash PASS without execution evidence.
    let status: string = invStatus;
    if (
      requirePw &&
      j.required &&
      invStatus !== "DEFER" &&
      (invStatus === "PASS" || invStatus === "IMPLEMENTED" || !invStatus)
    ) {
      // Fail closed for dogfood proof rows missing run evidence
      status = invStatus === "PASS" || invStatus === "IMPLEMENTED" ? "FAIL" : "UNKNOWN";
    }

    return {
      id: j.id,
      role: j.role,
      surface: j.surface,
      journey: j.journey,
      testId: j.testId,
      required: j.required,
      inventoryStatus: invStatus,
      status,
      statusSource: "inventory" as const,
    };
  });
}

export function summarizeRows(rows: CoverageRow[]): BuildE2eReportResult["summary"] {
  const required = rows.filter((r) => r.required);
  let pass = 0;
  let fail = 0;
  let defer = 0;
  let other = 0;
  let fromPlaywright = 0;
  let fromInventory = 0;
  for (const r of required) {
    if (r.statusSource === "playwright") fromPlaywright += 1;
    else fromInventory += 1;
    const s = String(r.status).toUpperCase();
    if (s === "PASS") pass += 1;
    else if (s === "FAIL") fail += 1;
    else if (s === "DEFER") defer += 1;
    else other += 1;
  }
  return {
    required: required.length,
    pass,
    fail,
    defer,
    other,
    fromPlaywright,
    fromInventory,
  };
}

/** Lumen tokens inlined for offline HTML (E6 — no freeform palette). */
const LUMEN_CSS = `
:root {
  --lumen-bg: #fcfbf9;
  --lumen-surface: #ffffff;
  --lumen-text: #1e2621;
  --lumen-text-secondary: #6a736c;
  --lumen-border: rgba(0, 0, 0, 0.08);
  --lumen-brand: #7ba88b;
  --lumen-brand-soft: #e7efdf;
  --lumen-accent: #ce922e;
  --lumen-success: #3e7d5a;
  --lumen-warn: #c2724e;
  --lumen-danger: #b4472f;
  --lumen-info: #3f6e8c;
  --lumen-radius-sm: 8px;
  --lumen-radius-md: 12px;
  --lumen-radius-lg: 16px;
  --lumen-font: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --lumen-shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.03);
  --lumen-space-2: 8px;
  --lumen-space-3: 12px;
  --lumen-space-4: 16px;
  --lumen-space-6: 24px;
  --lumen-success-soft: #d1fae5;
  --lumen-warn-soft: #fef3c7;
  --lumen-danger-soft: #fee2e2;
  --lumen-info-soft: #e0f2fe;
}
html { color-scheme: light; }
body {
  margin: 0;
  min-height: 100vh;
  font-family: var(--lumen-font);
  font-size: 15px;
  line-height: 1.5;
  color: var(--lumen-text);
  background: var(--lumen-bg);
  -webkit-font-smoothing: antialiased;
}
*, *::before, *::after { box-sizing: border-box; }
a { color: var(--lumen-brand); text-decoration: none; }
a:hover { text-decoration: underline; }
.wrap { max-width: 1100px; margin: 0 auto; padding: var(--lumen-space-6) var(--lumen-space-4); }
header.card, .card {
  background: var(--lumen-surface);
  border: 1px solid var(--lumen-border);
  border-radius: var(--lumen-radius-lg);
  box-shadow: var(--lumen-shadow-sm);
  padding: var(--lumen-space-6);
  margin-bottom: var(--lumen-space-6);
}
h1 {
  margin: 0 0 var(--lumen-space-2);
  font-size: 1.5rem;
  font-weight: 650;
  letter-spacing: -0.02em;
}
.sub {
  color: var(--lumen-text-secondary);
  margin: 0 0 var(--lumen-space-4);
}
.badges { display: flex; flex-wrap: wrap; gap: var(--lumen-space-2); margin-top: var(--lumen-space-3); }
.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  border: 1px solid var(--lumen-border);
  background: var(--lumen-brand-soft);
  color: var(--lumen-brand);
}
.badge.pass { background: var(--lumen-success-soft); color: var(--lumen-success); border-color: transparent; }
.badge.fail { background: var(--lumen-danger-soft); color: var(--lumen-danger); border-color: transparent; }
.badge.defer { background: var(--lumen-warn-soft); color: var(--lumen-warn); border-color: transparent; }
.badge.other { background: var(--lumen-info-soft); color: var(--lumen-info); border-color: transparent; }
.toc { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: var(--lumen-space-4); }
.toc a {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: var(--lumen-radius-sm);
  background: var(--lumen-surface);
  border: 1px solid var(--lumen-border);
}
.toc a.pass { border-color: var(--lumen-success); color: var(--lumen-success); }
.toc a.fail { border-color: var(--lumen-danger); color: var(--lumen-danger); }
.toc a.defer { border-color: var(--lumen-warn); color: var(--lumen-warn); }
table {
  width: 100%;
  border-collapse: collapse;
  background: var(--lumen-surface);
  border: 1px solid var(--lumen-border);
  border-radius: var(--lumen-radius-md);
  overflow: hidden;
}
th, td {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid var(--lumen-border);
  vertical-align: top;
}
th {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--lumen-text-secondary);
  background: var(--lumen-bg);
}
tr:last-child td { border-bottom: none; }
tr:target { outline: 2px solid var(--lumen-brand); outline-offset: -2px; }
.id {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-weight: 600;
}
.status-pill {
  display: inline-block;
  min-width: 3.5rem;
  text-align: center;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.03em;
}
.status-pill.PASS { background: var(--lumen-success-soft); color: var(--lumen-success); }
.status-pill.FAIL { background: var(--lumen-danger-soft); color: var(--lumen-danger); }
.status-pill.DEFER { background: var(--lumen-warn-soft); color: var(--lumen-warn); }
.status-pill.OPEN,
.status-pill.IMPLEMENTED,
.status-pill.UNKNOWN,
.status-pill.SKIPPED { background: var(--lumen-info-soft); color: var(--lumen-info); }
.muted { color: var(--lumen-text-secondary); font-size: 12px; }
.site-header {
  background: var(--lumen-surface);
  border-bottom: 1px solid var(--lumen-border);
  position: sticky;
  top: 0;
  z-index: 10;
}
.site-header-inner {
  max-width: 1100px;
  margin: 0 auto;
  padding: var(--lumen-space-3) var(--lumen-space-4);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--lumen-space-3);
}
.brand {
  font-weight: 650;
  letter-spacing: -0.02em;
  color: var(--lumen-text);
  text-decoration: none;
  margin-right: var(--lumen-space-2);
}
.brand:hover { color: var(--lumen-brand); text-decoration: none; }
.brand span { color: var(--lumen-brand); }
.nav {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 6px;
  align-items: center;
}
.nav a {
  font-size: 13px;
  padding: 6px 10px;
  border-radius: 9999px;
  color: var(--lumen-text-secondary);
  border: 1px solid transparent;
}
.nav a:hover {
  color: var(--lumen-brand);
  background: var(--lumen-brand-soft);
  text-decoration: none;
}
.nav a[aria-current="page"] {
  color: var(--lumen-brand);
  background: var(--lumen-brand-soft);
  border-color: transparent;
  font-weight: 600;
}
footer.report-footer {
  margin-top: var(--lumen-space-6);
  padding: var(--lumen-space-4) var(--lumen-space-6);
  background: var(--lumen-surface);
  border: 1px solid var(--lumen-border);
  border-radius: var(--lumen-radius-md);
  color: var(--lumen-text-secondary);
  font-size: 13px;
}
footer.report-footer code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: var(--lumen-text);
}
`.trim();

/** Sibling report set for portal nav (matches section 9.5 REPORT_PAGES). */
const REPORT_NAV: { file: string; title: string; current?: boolean }[] = [
  { file: "index.html", title: "Reports portal" },
  { file: "onboarding.html", title: "Human onboarding" },
  { file: "agent-setup.html", title: "Agent setup" },
  { file: "architecture.html", title: "Architecture" },
  { file: "cli-reference.html", title: "CLI reference" },
  { file: "design-lumen.html", title: "Lumen design kit" },
  { file: "e2e-coverage.html", title: "E2E coverage", current: true },
];

function reportNavHtml(): string {
  const links = REPORT_NAV.map((p) => {
    const currentAttr = p.current ? ' aria-current="page"' : "";
    return `<a href="${escapeHtml(p.file)}"${currentAttr}>${escapeHtml(p.title)}</a>`;
  }).join("\n      ");
  return `<header class="site-header">
  <div class="site-header-inner">
    <a class="brand" href="index.html">SpeakerOps <span>Reports</span></a>
    <nav class="nav" aria-label="Reports">
      ${links}
    </nav>
  </div>
</header>`;
}

function statusClass(status: string): string {
  const s = String(status).toUpperCase();
  if (s === "PASS") return "pass";
  if (s === "FAIL") return "fail";
  if (s === "DEFER") return "defer";
  return "other";
}

/**
 * Render Lumen-styled offline HTML coverage report.
 */
export function renderE2eCoverageHtml(input: {
  rows: CoverageRow[];
  summary: BuildE2eReportResult["summary"];
  gitSha: string;
  generatedAt: string;
  suiteSource: string | null;
  inventoryRel: string;
}): string {
  const { rows, summary, gitSha, generatedAt, suiteSource, inventoryRel } = input;
  const required = rows.filter((r) => r.required);
  const optional = rows.filter((r) => !r.required);

  const toc = required
    .map((r) => {
      const cls = statusClass(String(r.status));
      return `<a class="${cls}" href="#${escapeHtml(r.id)}" title="${escapeHtml(String(r.status))}">${escapeHtml(r.id)}</a>`;
    })
    .join("\n      ");

  const rowHtml = (r: CoverageRow) => {
    const st = String(r.status).toUpperCase();
    const pillClass = ["PASS", "FAIL", "DEFER", "OPEN", "IMPLEMENTED", "UNKNOWN", "SKIPPED"].includes(st)
      ? st
      : "UNKNOWN";
    return `<tr id="${escapeHtml(r.id)}">
  <td class="id"><a href="#${escapeHtml(r.id)}">${escapeHtml(r.id)}</a></td>
  <td>${escapeHtml(r.role || "—")}</td>
  <td>${escapeHtml(r.surface || "—")}</td>
  <td>${escapeHtml(r.journey || "—")}<div class="muted">${escapeHtml(r.testId || "")}</div></td>
  <td><span class="status-pill ${pillClass}">${escapeHtml(st)}</span>
    <div class="muted">inventory: ${escapeHtml(r.inventoryStatus)} · source: ${escapeHtml(r.statusSource)}</div>
  </td>
</tr>`;
  };

  const requiredTable = required.map(rowHtml).join("\n");
  const optionalTable =
    optional.length === 0
      ? ""
      : `
<section class="card">
  <h2 style="margin:0 0 12px;font-size:1.1rem">Optional inventory</h2>
  <table>
    <thead>
      <tr>
        <th>ID</th><th>Role</th><th>Surface</th><th>Journey</th><th>Status</th>
      </tr>
    </thead>
    <tbody>
${optional.map(rowHtml).join("\n")}
    </tbody>
  </table>
</section>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <title>SpeakerOps E2E coverage — S-E2E-RUN</title>
  <style>
${LUMEN_CSS}
  </style>
</head>
<body>
${reportNavHtml()}
  <div class="wrap">
    <header class="card">
      <h1>SpeakerOps E2E coverage</h1>
      <p class="sub">
        Inventory + Playwright results for constitution soul <strong>S-E2E-RUN</strong>.
        Offline keystone artifact (section 8.5). Source inventory:
        <code>${escapeHtml(inventoryRel)}</code>.
      </p>
      <div class="badges" role="status" aria-label="REQUIRED summary">
        <span class="badge">REQUIRED ${summary.required}</span>
        <span class="badge pass">PASS ${summary.pass}</span>
        <span class="badge fail">FAIL ${summary.fail}</span>
        <span class="badge defer">DEFER ${summary.defer}</span>
        <span class="badge other">other ${summary.other}</span>
        <span class="badge">playwright ${summary.fromPlaywright}</span>
        <span class="badge">inventory ${summary.fromInventory}</span>
      </div>
    </header>

    <nav class="toc" aria-label="REQUIRED inventory IDs">
      ${toc}
    </nav>

    <section class="card">
      <h2 style="margin:0 0 12px;font-size:1.1rem">REQUIRED inventory (PASS / FAIL)</h2>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Role</th>
            <th>Surface</th>
            <th>Journey</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
${requiredTable}
        </tbody>
      </table>
    </section>

    ${optionalTable}

    <footer class="report-footer" data-generated-at="${escapeHtml(generatedAt)}" data-git-sha="${escapeHtml(gitSha)}">
      <div><strong>Generated:</strong> <time datetime="${escapeHtml(generatedAt)}">${escapeHtml(generatedAt)}</time></div>
      <div><strong>Git SHA:</strong> <code>${escapeHtml(gitSha)}</code></div>
      <div><strong>Suite source:</strong> <code>${escapeHtml(suiteSource ?? "inventory-only")}</code></div>
      <div class="muted">Section 8.5 · pnpm docs:e2e-report · no secrets in report</div>
    </footer>
  </div>
</body>
</html>
`;
}

/**
 * Build and optionally write the E2E coverage HTML report.
 */
export function buildE2eReport(
  options: BuildE2eReportOptions = {},
): BuildE2eReportResult {
  const root = resolve(options.root ?? defaultRoot);
  const inventoryPath = resolve(
    options.inventoryPath ??
      join(root, "KMS-competition", "initiative", "BROWSER_E2E_INVENTORY.md"),
  );
  const outPath = resolve(
    options.outPath ??
      process.env.E2E_COVERAGE_HTML ??
      join(root, "reports", "e2e-coverage.html"),
  );

  if (!existsSync(inventoryPath)) {
    throw new Error(`inventory not found: ${inventoryPath}`);
  }

  const inventoryMd = readFileSync(inventoryPath, "utf8");
  const journeys = parseInventoryMarkdown(inventoryMd);
  if (journeys.length === 0) {
    throw new Error("no inventory journey rows parsed");
  }

  let suiteSource: string | null = null;
  let entries: PlaywrightSuiteEntry[] = [];

  if (options.playwrightSuite != null) {
    const suite = normalizePlaywrightSuite(options.playwrightSuite, root);
    if (suite) {
      entries = suite.entries;
      suiteSource = suite.source || "injected";
    }
  } else {
    const suitePath =
      options.suiteReportPath === null
        ? null
        : resolve(
            options.suiteReportPath ??
              process.env.E2E_PLAYWRIGHT_RUN_REPORT ??
              process.env.E2E_PLAYWRIGHT_SUITE_REPORT ??
              join(root, "reports", "playwright-run.json"),
          );
    if (suitePath && existsSync(suitePath)) {
      const suite = loadPlaywrightSuiteReport(suitePath, root);
      if (suite) {
        entries = suite.entries;
        suiteSource = suite.source || suitePath;
      }
    }
  }

  const suiteByInv = mapInvFromSuite(entries);
  const rows = buildCoverageRows(journeys, suiteByInv);
  const summary = summarizeRows(rows);
  const gitSha = resolveGitSha(root, options.gitSha);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const inventoryRel = inventoryPath.startsWith(root)
    ? inventoryPath.slice(root.length).replace(/^[/\\]/, "")
    : inventoryPath;

  const html = renderE2eCoverageHtml({
    rows,
    summary,
    gitSha,
    generatedAt,
    suiteSource,
    inventoryRel,
  });

  if (!options.dryRun) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, html, "utf8");
  }

  return {
    html,
    outPath,
    rows,
    requiredRows: rows.filter((r) => r.required),
    summary,
    gitSha,
    generatedAt,
    suiteSource,
  };
}

/** CLI argv parser (non-interactive). */
export function parseCliArgs(argv: string[]): {
  out?: string;
  suite?: string | null;
  inventory?: string;
  help?: boolean;
} {
  const out: { out?: string; suite?: string | null; inventory?: string; help?: boolean } =
    {};
  for (const a of argv) {
    if (a === "--help" || a === "-h") out.help = true;
    else if (a.startsWith("--out=")) out.out = a.slice("--out=".length);
    else if (a === "--no-suite") out.suite = null;
    else if (a.startsWith("--suite=")) out.suite = a.slice("--suite=".length);
    else if (a.startsWith("--inventory="))
      out.inventory = a.slice("--inventory=".length);
  }
  return out;
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMain()) {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: tsx scripts/build-e2e-report.ts [options]

Options:
  --out=path          Output HTML (default reports/e2e-coverage.html)
  --suite=path        Playwright JSON run report
  --no-suite          Inventory-only (ignore run report)
  --inventory=path    Inventory markdown path
  -h, --help          Show help

Env names: E2E_PLAYWRIGHT_RUN_REPORT, E2E_PLAYWRIGHT_SUITE_REPORT, E2E_COVERAGE_HTML
`);
    process.exit(0);
  }

  try {
    const result = buildE2eReport({
      outPath: args.out,
      suiteReportPath: args.suite,
      inventoryPath: args.inventory,
    });
    console.log(
      `[docs:e2e-report] wrote ${result.outPath}` +
        ` · REQUIRED ${result.summary.required}` +
        ` · PASS ${result.summary.pass}` +
        ` · FAIL ${result.summary.fail}` +
        ` · DEFER ${result.summary.defer}` +
        ` · sha ${result.gitSha}` +
        ` · at ${result.generatedAt}`,
    );
    process.exit(0);
  } catch (e) {
    console.error(
      "[docs:e2e-report] failed:",
      e instanceof Error ? e.message : e,
    );
    process.exit(1);
  }
}
