/**
 * Section 1.5 + 8.1 — Playwright inventory harness linter + admin discovery crawl
 *
 * Reads BROWSER_E2E_INVENTORY.md Required column and fails when REQUIRED
 * inventory IDs lack `@inv:ID` on real Playwright-bound `test()` titles.
 *
 * Section 8.1 hardens completeness audit (S-E2E-INV):
 * - Machine-check every REQUIRED id has @inv (strict/phase8 or fixture mode)
 * - Admin primary-action discovery crawl against `ui-crawl-allowlist.json`
 * - Report missing tags and unmapped primary controls
 *
 * CLI (non-interactive):
 *   pnpm test:e2e:inventory
 *   tsx scripts/inventory-lint.ts
 *   tsx scripts/inventory-lint.ts --phase8
 *   tsx scripts/inventory-lint.ts --allow-missing-until=8.2
 *   tsx scripts/inventory-lint.ts --skip-crawl
 *
 * Default intermediate mode allows OPEN (not-yet-implemented) rows to lack
 * tags — equivalent to `--allow-missing-until=8.2`. Phase 8 full gate
 * (`E2E_INVENTORY_GATE=phase8` / `--phase8`) turns allow-missing OFF and
 * requires tags + status PASS + run-report proof for every non-DEFER REQUIRED ID.
 *
 * Full anti-shrinkage / DEFER / suite reconciliation lives in
 * `scripts/e2e-inventory-lint.mjs` (section 0.3). This module is the TypeScript
 * harness entry + fixture unit surface for section 1.5 / 8.1.
 *
 * Convention: `@inv:A01` on Playwright `test()` titles (see docs/E2E.md).
 * Crawl allowlist: `scripts/ui-crawl-allowlist.json` (pure chrome + controlMap).
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  extractInvTaggedTests,
  runInventoryLint,
  type InventoryLintResult,
} from "./e2e-inventory-lint.mjs";
// Types: scripts/e2e-inventory-lint.d.mts (matches .mjs specifier)

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const defaultAllowlistPath = join(defaultRoot, "scripts", "ui-crawl-allowlist.json");

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
    /^\| ([A-Z]\d{2}|L2-\d{2}) \|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\| (REQUIRED|OPTIONAL) \|([^|]*)\|/gm;
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

// ---------------------------------------------------------------------------
// Section 8.1 — Admin primary-action discovery crawl
// ---------------------------------------------------------------------------

export type CrawlChromeEntry = {
  testid: string;
  reason: string;
};

export type CrawlControlMapEntry = {
  testid: string;
  inv: string;
  surface?: string;
  journey?: string;
};

export type CrawlAllowlist = {
  version: number;
  section?: string;
  description?: string;
  docs?: string[];
  chrome: CrawlChromeEntry[];
  controlMap: CrawlControlMapEntry[];
};

export type DiscoveredControl = {
  /** Normalized testid pattern (template literals → *). Empty if only data-inv. */
  testid: string;
  /** Explicit data-inv when present on the control. */
  dataInv: string;
  file: string;
  /** 1-based line when known. */
  line: number;
  kind: "button" | "submit" | "role-button" | "data-inv" | "palette-constant";
};

export type CrawlMappedControl = DiscoveredControl & {
  inv: string;
  via: "data-inv" | "controlMap" | "chrome";
};

export type CrawlResult = {
  ok: boolean;
  exitCode: 0 | 1;
  mapped: CrawlMappedControl[];
  chromeSkipped: CrawlMappedControl[];
  unmapped: DiscoveredControl[];
  invalidInv: Array<DiscoveredControl & { inv: string; reason: string }>;
  missingReport: string[];
  stdout: string;
  stderr: string;
};

export type CrawlOptions = {
  /** Allowlist document (parsed). */
  allowlist: CrawlAllowlist;
  /**
   * HTML fixture fragments and/or TSX sources to crawl.
   * Keys are labels (file paths or fixture names).
   */
  sources?: Record<string, string>;
  /** Valid inventory IDs (REQUIRED set) for controlMap / data-inv validation. */
  inventoryIds?: Set<string> | string[];
  /** Optional label for diagnostics. */
  label?: string;
};

const INV_ID_RE = /^(?:[A-Z]\d{2}|L2-\d{2})$/;

/** Normalize template-literal / dynamic segments to glob `*`. */
export function normalizeTestIdPattern(raw: string): string {
  let s = (raw ?? "").trim();
  if (!s) return "";
  // ${expr} → *
  s = s.replace(/\$\{[^}]*\}/g, "*");
  // collapse multiple * 
  s = s.replace(/\*+/g, "*");
  return s;
}

/** Glob match: `*` matches any string (including empty / multi-segment). */
export function matchTestIdPattern(pattern: string, value: string): boolean {
  const p = normalizeTestIdPattern(pattern);
  const v = normalizeTestIdPattern(value);
  if (!p) return false;
  if (p === v) return true;
  // Escape regex specials except *
  const reBody = p
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${reBody}$`).test(v);
}

export function loadCrawlAllowlist(
  path: string = defaultAllowlistPath,
): CrawlAllowlist {
  if (!existsSync(path)) {
    throw new Error(`ui-crawl-allowlist not found: ${path}`);
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as CrawlAllowlist;
  if (!raw || typeof raw !== "object") {
    throw new Error("ui-crawl-allowlist: invalid JSON object");
  }
  if (!Array.isArray(raw.chrome) || !Array.isArray(raw.controlMap)) {
    throw new Error(
      "ui-crawl-allowlist: require chrome[] and controlMap[] arrays",
    );
  }
  for (const c of raw.chrome) {
    if (!c?.testid || !c?.reason) {
      throw new Error(
        "ui-crawl-allowlist: each chrome entry needs testid + reason",
      );
    }
  }
  for (const m of raw.controlMap) {
    if (!m?.testid || !m?.inv || !INV_ID_RE.test(m.inv)) {
      throw new Error(
        `ui-crawl-allowlist: controlMap entry needs testid + inv (A01 form): ${JSON.stringify(m)}`,
      );
    }
  }
  return raw;
}

/**
 * Parse primary controls from an HTML fixture (or JSX-like fragment).
 * Primary = button | input[type=submit] | [role=button] with data-testid or data-inv.
 */
export function parsePrimaryControlsFromHtml(
  html: string,
  fileLabel = "fixture.html",
): DiscoveredControl[] {
  const found: DiscoveredControl[] = [];
  // Match opening tags for button / input / role=button containers (single-line and multi-line)
  const tagRe =
    /<(button|input)\b([^>]*?)\/?>|<(div|span|a|li)\b([^>]*\brole\s*=\s*["']button["'][^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const tag = (m[1] || m[3] || "").toLowerCase();
    const attrs = m[2] || m[4] || "";
    const line = html.slice(0, m.index).split(/\r?\n/).length;

    const typeMatch = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i);
    const type = (typeMatch?.[1] ?? "").toLowerCase();
    const roleMatch = attrs.match(/\brole\s*=\s*["']([^"']+)["']/i);
    const role = (roleMatch?.[1] ?? "").toLowerCase();

    const isButton = tag === "button";
    const isSubmit =
      tag === "input" && (type === "submit" || type === "button");
    const isRoleButton = role === "button";
    if (!isButton && !isSubmit && !isRoleButton) continue;

    const testidMatch =
      attrs.match(/\bdata-testid\s*=\s*["']([^"']+)["']/i) ||
      attrs.match(/\bdata-testid\s*=\s*\{\s*[`'"]([^`'"]+)[`'"]\s*\}/i);
    const invMatch = attrs.match(/\bdata-inv\s*=\s*["']([A-Z]\d{2}|L2-\d{2})["']/i);

    const testid = normalizeTestIdPattern(testidMatch?.[1] ?? "");
    const dataInv = (invMatch?.[1] ?? "").toUpperCase();
    if (!testid && !dataInv) {
      // Primary control without identity — still report so crawl can fail
      found.push({
        testid: "",
        dataInv: "",
        file: fileLabel,
        line,
        kind: isSubmit ? "submit" : isRoleButton ? "role-button" : "button",
      });
      continue;
    }

    found.push({
      testid,
      dataInv,
      file: fileLabel,
      line,
      kind: isSubmit ? "submit" : isRoleButton ? "role-button" : "button",
    });
  }
  return found;
}

/**
 * Extract a single JSX/HTML open tag starting at `start` (index of `<`).
 * Stops at the matching unquoted `>`; ignores `>` inside quotes/templates.
 * Returns null if not a well-formed open tag within maxLen.
 */
export function extractJsxOpenTag(
  source: string,
  start: number,
  maxLen = 4000,
): { tag: string; attrs: string; end: number } | null {
  if (source[start] !== "<") return null;
  const slice = source.slice(start, start + maxLen);
  const nameMatch = slice.match(/^<\/?([A-Za-z][\w.-]*)/);
  if (!nameMatch) return null;
  // Closing tags are not controls
  if (slice.startsWith("</")) return null;
  const tag = nameMatch[1];
  let i = nameMatch[0].length;
  let quote: "'" | '"' | "`" | null = null;
  let braceDepth = 0;
  while (i < slice.length) {
    const ch = slice[i];
    if (quote) {
      if (ch === "\\" && quote !== "`") {
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      i++;
      continue;
    }
    if (ch === "{") {
      braceDepth++;
      i++;
      continue;
    }
    if (ch === "}" && braceDepth > 0) {
      braceDepth--;
      i++;
      continue;
    }
    if (braceDepth === 0 && ch === ">") {
      const full = slice.slice(0, i + 1);
      const attrs = full.slice(nameMatch[0].length, full.endsWith("/>") ? -2 : -1);
      return { tag, attrs, end: start + i + 1 };
    }
    i++;
  }
  return null;
}

function attrString(
  attrs: string,
  name: string,
): string {
  // data-testid="x" | data-testid='x' | data-testid={"x"} | data-testid={`x`} | data-testid={`x-${y}`}
  const re = new RegExp(
    `\\b${name}\\s*=\\s*(?:["']([^"']*)["']|\\{\\s*["']([^"']*)["']\\s*\\}|\\{\\s*\`([^\`]*)\`\\s*\\})`,
    "i",
  );
  const m = attrs.match(re);
  if (!m) return "";
  return m[1] ?? m[2] ?? m[3] ?? "";
}

function isPrimaryOpenTag(tag: string, attrs: string): boolean {
  const t = tag.toLowerCase();
  if (t === "button") return true;
  if (t === "input") {
    const type = attrString(attrs, "type").toLowerCase();
    return type === "submit" || type === "button";
  }
  // Intrinsic elements with role="button" (div/span/a/li/td/…)
  const role = attrString(attrs, "role").toLowerCase();
  return role === "button";
}

/**
 * Parse primary controls from TSX/JSX source (admin UI).
 * Handles string + template-literal data-testid / data-inv on button-like tags.
 * Also harvests FIELD_PALETTE / palette testId constants.
 */
export function parsePrimaryControlsFromTsx(
  source: string,
  fileLabel: string,
): DiscoveredControl[] {
  const found: DiscoveredControl[] = [];

  // 1) Complete open-tag scan (avoids attribute bleed from neighboring elements)
  let searchFrom = 0;
  while (searchFrom < source.length) {
    const lt = source.indexOf("<", searchFrom);
    if (lt < 0) break;
    // Skip comments and closing tags quickly
    if (source.startsWith("<!--", lt) || source.startsWith("</", lt)) {
      searchFrom = lt + 2;
      continue;
    }
    const open = extractJsxOpenTag(source, lt);
    if (!open) {
      searchFrom = lt + 1;
      continue;
    }
    searchFrom = open.end;
    if (!isPrimaryOpenTag(open.tag, open.attrs)) continue;

    const line = source.slice(0, lt).split(/\r?\n/).length;
    const rawTestId = attrString(open.attrs, "data-testid");
    const testid = normalizeTestIdPattern(rawTestId);
    const dataInv = attrString(open.attrs, "data-inv").toUpperCase();

    // Dynamic data-testid={expr} without string/template literal — skip (palette constants cover known cases)
    if (!testid && !dataInv) {
      if (/\bdata-testid\s*=\s*\{/.test(open.attrs)) {
        continue;
      }
      // Primary without identity
      const type = attrString(open.attrs, "type").toLowerCase();
      const role = attrString(open.attrs, "role").toLowerCase();
      found.push({
        testid: "",
        dataInv: "",
        file: fileLabel,
        line,
        kind:
          type === "submit"
            ? "submit"
            : role === "button"
              ? "role-button"
              : "button",
      });
      continue;
    }

    const type = attrString(open.attrs, "type").toLowerCase();
    const role = attrString(open.attrs, "role").toLowerCase();
    found.push({
      testid,
      dataInv,
      file: fileLabel,
      line,
      kind:
        type === "submit"
          ? "submit"
          : role === "button"
            ? "role-button"
            : "button",
    });
  }

  // 2) Palette / declared primary testId constants (e.g. FIELD_PALETTE)
  const paletteRe = /\btestId\s*:\s*["'](palette-[a-z0-9-]+)["']/gi;
  let pm: RegExpExecArray | null;
  while ((pm = paletteRe.exec(source)) !== null) {
    const line = source.slice(0, pm.index).split(/\r?\n/).length;
    found.push({
      testid: pm[1],
      dataInv: "",
      file: fileLabel,
      line,
      kind: "palette-constant",
    });
  }

  // De-dupe by file|testid|dataInv|kind (prefer first line)
  const seen = new Set<string>();
  return found.filter((c) => {
    const k = `${c.file}\0${c.testid || "@" + c.line}\0${c.dataInv}\0${c.kind}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Match allowlist/controlMap pattern against a discovered testid.
 * Supports both directions so template-literal discoveries (`schedule-view-*`)
 * match concrete map entries (`schedule-view-list`) and vice versa.
 */
export function controlMatchesPattern(
  allowPattern: string,
  discovered: string,
): boolean {
  if (!allowPattern || !discovered) return false;
  if (matchTestIdPattern(allowPattern, discovered)) return true;
  if (discovered.includes("*") && matchTestIdPattern(discovered, allowPattern)) {
    return true;
  }
  // Identical normalized patterns (both templated)
  return (
    normalizeTestIdPattern(allowPattern) === normalizeTestIdPattern(discovered)
  );
}

function findAllowlistMatch<T extends { testid: string }>(
  testid: string,
  entries: T[],
): T | null {
  if (!testid) return null;
  // Prefer exact / more specific allowlist patterns first (longest non-wild prefix)
  const sorted = [...entries].sort(
    (a, b) => b.testid.length - a.testid.length,
  );
  for (const e of sorted) {
    if (controlMatchesPattern(e.testid, testid)) return e;
  }
  return null;
}

/**
 * Crawl primary controls against allowlist + inventory IDs.
 * Fails when any primary control is unmapped or maps to an unknown inventory ID.
 */
export function crawlPrimaryControls(options: CrawlOptions): CrawlResult {
  const outLines: string[] = [];
  const errLines: string[] = [];
  const log = (msg: string) => outLines.push(msg);
  const logErr = (msg: string) => errLines.push(msg);

  const invSet =
    options.inventoryIds instanceof Set
      ? options.inventoryIds
      : new Set(options.inventoryIds ?? []);

  const allow = options.allowlist;
  const discovered: DiscoveredControl[] = [];
  for (const [label, body] of Object.entries(options.sources ?? {})) {
    if (/\.(tsx|jsx|ts|js)$/i.test(label) || /tsx|jsx/i.test(label)) {
      discovered.push(...parsePrimaryControlsFromTsx(body, label));
    } else {
      discovered.push(...parsePrimaryControlsFromHtml(body, label));
    }
  }

  const mapped: CrawlMappedControl[] = [];
  const chromeSkipped: CrawlMappedControl[] = [];
  const unmapped: DiscoveredControl[] = [];
  const invalidInv: Array<DiscoveredControl & { inv: string; reason: string }> =
    [];

  for (const c of discovered) {
    if (c.dataInv) {
      if (invSet.size > 0 && !invSet.has(c.dataInv)) {
        invalidInv.push({
          ...c,
          inv: c.dataInv,
          reason: "data-inv not in inventory REQUIRED set",
        });
        continue;
      }
      mapped.push({ ...c, inv: c.dataInv, via: "data-inv" });
      continue;
    }

    if (c.testid) {
      const chrome = findAllowlistMatch(c.testid, allow.chrome);
      if (chrome) {
        chromeSkipped.push({ ...c, inv: "", via: "chrome" });
        continue;
      }
      const mapEntry = findAllowlistMatch(c.testid, allow.controlMap);
      if (mapEntry) {
        if (invSet.size > 0 && !invSet.has(mapEntry.inv)) {
          invalidInv.push({
            ...c,
            inv: mapEntry.inv,
            reason: `controlMap inv ${mapEntry.inv} not in inventory REQUIRED set`,
          });
          continue;
        }
        mapped.push({ ...c, inv: mapEntry.inv, via: "controlMap" });
        continue;
      }
    }

    unmapped.push(c);
  }

  const missingReport = unmapped.map((c) => {
    const id = c.testid || c.dataInv || "<no-testid>";
    return `${id} @ ${c.file}:${c.line}`;
  });

  if (invalidInv.length > 0) {
    const detail = invalidInv
      .slice(0, 20)
      .map((c) => `${c.testid || c.dataInv}→${c.inv} (${c.reason})`)
      .join("; ");
    logErr(
      `inventory-crawl: FAIL: invalid inventory mapping: ${detail}` +
        (options.label ? ` (${options.label})` : ""),
    );
  }

  if (unmapped.length > 0) {
    const detail = missingReport.slice(0, 30).join(", ");
    logErr(
      `inventory-crawl: FAIL: unmapped primary control(s): ${detail}` +
        (unmapped.length > 30 ? ` …+${unmapped.length - 30} more` : "") +
        (options.label ? ` (${options.label})` : "") +
        ` — add data-inv, controlMap entry, or chrome allowlist reason in scripts/ui-crawl-allowlist.json`,
    );
  }

  if (invalidInv.length > 0 || unmapped.length > 0) {
    return {
      ok: false,
      exitCode: 1,
      mapped,
      chromeSkipped,
      unmapped,
      invalidInv,
      missingReport,
      stdout: outLines.join("\n") + (outLines.length ? "\n" : ""),
      stderr: errLines.join("\n") + (errLines.length ? "\n" : ""),
    };
  }

  log(
    `inventory-crawl: OK: ${mapped.length} primary control(s) mapped` +
      (chromeSkipped.length
        ? `, ${chromeSkipped.length} chrome-skipped`
        : "") +
      (options.label ? ` (${options.label})` : ""),
  );

  return {
    ok: true,
    exitCode: 0,
    mapped,
    chromeSkipped,
    unmapped: [],
    invalidInv: [],
    missingReport: [],
    stdout: outLines.join("\n") + (outLines.length ? "\n" : ""),
    stderr: errLines.join("\n") + (errLines.length ? "\n" : ""),
  };
}

/** Fixture helper: assert crawl fails on unmapped primary button. */
export function crawlFailsOnUnmappedPrimary(
  htmlOrTsx: string,
  allowlist?: CrawlAllowlist,
  inventoryIds?: string[],
): CrawlResult {
  const allow =
    allowlist ??
    ({
      version: 1,
      chrome: [],
      controlMap: [],
    } satisfies CrawlAllowlist);
  return crawlPrimaryControls({
    allowlist: allow,
    sources: { "fixture.html": htmlOrTsx },
    inventoryIds: inventoryIds ?? ["A01", "C01", "D01"],
    label: "unmapped-primary-fixture",
  });
}

/** Default admin source roots for workspace crawl (relative to repo root). */
export const DEFAULT_ADMIN_CRAWL_GLOBS = [
  "apps/web/src/pages",
  "apps/web/src/layout",
  "apps/web/src/components",
] as const;

/** Paths under admin roots to skip (non-admin surfaces + design-system primitives). */
const ADMIN_CRAWL_SKIP_RE =
  /\/(portal|PublicCfp|Login|login)\b|pages\/portal\b|PublicCfp\.tsx|Login\.tsx|components\/ui\b|L2StateSheet\.tsx/;

/**
 * Collect TSX sources for admin crawl under workspace root.
 */
export function collectAdminCrawlSources(
  root: string,
  extraRoots: string[] = [],
): Record<string, string> {
  const roots = [
    ...DEFAULT_ADMIN_CRAWL_GLOBS.map((r) => join(root, r)),
    ...extraRoots,
  ];
  const sources: Record<string, string> = {};
  for (const dir of roots) {
    if (!existsSync(dir)) continue;
    const files = collectFiles(dir).filter(
      (f) =>
        /\.(tsx|jsx)$/.test(f) &&
        !ADMIN_CRAWL_SKIP_RE.test(f.replace(/\\/g, "/")),
    );
    for (const f of files) {
      const rel = relative(root, f).replace(/\\/g, "/");
      sources[rel] = readFileSync(f, "utf8");
    }
  }
  return sources;
}

/**
 * Workspace admin discovery crawl (section 8.1).
 * Reads allowlist + inventory REQUIRED ids; fails on unmapped primary controls.
 */
export function runWorkspaceAdminCrawl(
  options: {
    root?: string;
    allowlistPath?: string;
    inventoryMarkdown?: string;
    silent?: boolean;
  } = {},
): CrawlResult {
  const root = options.root ?? defaultRoot;
  const allowlistPath = options.allowlistPath ?? join(root, "scripts", "ui-crawl-allowlist.json");
  const allowlist = loadCrawlAllowlist(allowlistPath);

  let inventoryIds: string[] = [];
  if (options.inventoryMarkdown) {
    inventoryIds = parseRequiredIds(options.inventoryMarkdown);
  } else {
    const invPath = join(
      root,
      "KMS-competition",
      "initiative",
      "BROWSER_E2E_INVENTORY.md",
    );
    if (existsSync(invPath)) {
      inventoryIds = parseRequiredIds(readFileSync(invPath, "utf8"));
    }
  }

  const sources = collectAdminCrawlSources(root);
  const result = crawlPrimaryControls({
    allowlist,
    sources,
    inventoryIds,
    label: "workspace-admin",
  });

  if (!options.silent) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  return result;
}

/**
 * Workspace inventory lint entry (delegates to 0.3 full gate engine).
 * Preserves anti-shrinkage, DEFER ownership, suite reconciliation, Phase 8 run proof.
 * Section 8.1: after tag gate OK, runs admin primary discovery crawl (unless --skip-crawl).
 */
export function runWorkspaceInventoryLint(
  options: CliLintOptions = {},
): InventoryLintResult {
  const root = options.root ?? defaultRoot;
  const argv = options.argv ?? process.argv;
  const env = options.env ?? process.env;
  const { fullGate } = parseAllowMissingUntil(argv, env);
  const skipCrawl =
    argv.includes("--skip-crawl") || env.E2E_INVENTORY_SKIP_CRAWL === "1";

  const tagResult = runInventoryLint({
    root,
    argv,
    env,
    fullGate,
    silent: options.silent === true,
  }) as InventoryLintResult;

  if (!tagResult.ok) {
    return tagResult;
  }

  if (skipCrawl) {
    if (!options.silent) {
      process.stdout.write(
        "[test:e2e:inventory] note: admin discovery crawl skipped (--skip-crawl)\n",
      );
    }
    return tagResult;
  }

  const crawl = runWorkspaceAdminCrawl({
    root,
    silent: true,
  });

  const out =
    (tagResult.stdout || "") +
    (crawl.stdout || "") +
    (crawl.ok
      ? `[test:e2e:inventory] OK: admin discovery crawl — ${crawl.mapped.length} primary control(s) mapped` +
        (crawl.chromeSkipped.length
          ? `, ${crawl.chromeSkipped.length} chrome-skipped`
          : "") +
        "\n"
      : "");
  const err = (tagResult.stderr || "") + (crawl.stderr || "");

  if (!options.silent) {
    if (crawl.stdout) process.stdout.write(crawl.stdout);
    if (crawl.stderr) process.stderr.write(crawl.stderr);
    if (crawl.ok) {
      process.stdout.write(
        `[test:e2e:inventory] OK: admin discovery crawl — ${crawl.mapped.length} primary control(s) mapped` +
          (crawl.chromeSkipped.length
            ? `, ${crawl.chromeSkipped.length} chrome-skipped`
            : "") +
          "\n",
      );
    }
  }

  if (!crawl.ok) {
    return {
      ok: false,
      exitCode: 1,
      stdout: out,
      stderr: err,
    };
  }

  return {
    ok: true,
    exitCode: 0,
    stdout: out,
    stderr: err,
  };
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
