/**
 * Section 9.6 — Onboarding proof keystone checker (S-ONB-HUMAN/AGENT/S-DOCS/S-CF).
 *
 * Validates the evidence bundle under:
 *   KMS-competition/initiative/evidence/onboarding-proof/
 *
 * Named checks (tests map 1:1):
 * - assert evidence bundle checklist file exists
 * - assert BC13-15 paths schema in checklist
 * - assert rejects claim without CF evidence or DEFER row
 *
 * Also: linkcheck 0 on README + docs tree markdown; reports portal set exists.
 *
 * CLI (non-interactive):
 *   pnpm check:onboarding-proof
 *   tsx scripts/check-onboarding-proof.ts
 *   tsx scripts/check-onboarding-proof.ts --claim
 *
 * Exit codes:
 *   0 — complete + claim-safe
 *   1 — incomplete / schema / linkcheck / reports
 *   2 — claim without CF evidence or DEFER
 *
 * Env **names** only (E10): none required.
 * Never logs secrets, API keys, or magic-link tokens.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Relative path of the onboarding-proof evidence directory. */
export const EVIDENCE_DIR_REL =
  "KMS-competition/initiative/evidence/onboarding-proof";

/** Checklist file name (AC: evidence bundle checklist file exists). */
export const CHECKLIST_FILE = "README.md";

/** Required sibling evidence files in the bundle. */
export const REQUIRED_BUNDLE_FILES = [
  CHECKLIST_FILE,
  "human-dry-run.txt",
  "agent-dry-run.txt",
  "linkcheck.txt",
  "docs-reports.txt",
  "cf-status.txt",
] as const;

/** BC13–15 row schema expected in checklist. */
export const BC_ROWS = [
  {
    id: "BC13",
    soul: "S-ONB-HUMAN",
    sourcePaths: ["docs/ONBOARDING.md", "reports/onboarding.html"],
    evidenceFile: "human-dry-run.txt",
  },
  {
    id: "BC14",
    soul: "S-ONB-AGENT",
    sourcePaths: ["docs/AGENT_SETUP.md"],
    evidenceFile: "agent-dry-run.txt",
  },
  {
    id: "BC15",
    soul: "S-DOCS",
    sourcePaths: ["reports/index.html"],
    evidenceFile: "docs-reports.txt",
  },
] as const;

/** Offline HTML report set (S-DOCS / BC15). */
export const REPORT_FILES = [
  "index.html",
  "onboarding.html",
  "agent-setup.html",
  "architecture.html",
  "cli-reference.html",
  "design-lumen.html",
  "e2e-coverage.html",
] as const;

/** CF evidence path relative to workspace root. */
export const CF_EVIDENCE_REL =
  "KMS-competition/initiative/evidence/cf-dogfood.txt";

/** Canonical BUILD_CHECKLIST path (programme end-check before CLAIM_PROVEN). */
export const BUILD_CHECKLIST_REL =
  "KMS-competition/initiative/BUILD_CHECKLIST.md";

/** All programme BUILD_CHECKLIST row ids (BC01–BC15). */
export const BUILD_CHECKLIST_BC_IDS = [
  "BC01",
  "BC02",
  "BC03",
  "BC04",
  "BC05",
  "BC06",
  "BC07",
  "BC08",
  "BC09",
  "BC10",
  "BC11",
  "BC12",
  "BC13",
  "BC14",
  "BC15",
] as const;

/** Statuses allowed by the BUILD_CHECKLIST end-check before CLAIM_PROVEN. */
export const BUILD_CHECKLIST_CLAIM_STATUSES = [
  "DONE_WITH_EVIDENCE",
  "OWNER_AMEND",
] as const;

export type CheckIssue = {
  code: string;
  message: string;
  /** When true, maps to exit code 2 (claim without CF). */
  claimGate?: boolean;
};

export type CheckResult = {
  ok: boolean;
  exitCode: 0 | 1 | 2;
  errors: CheckIssue[];
  warnings: string[];
  linkcheckBroken: number;
  evidenceDir: string;
  checklistPath: string;
};

export type CheckOptions = {
  root?: string;
  /** Override evidence dir (tests / fixtures). */
  evidenceDir?: string;
  /** When true, treat as programme-exit claim (stricter CF gate messaging). */
  claim?: boolean;
  /** When false, skip writing linkcheck.txt (default true when dir writable). */
  writeLinkcheck?: boolean;
  /** Inject checklist body for negative tests (skips reading file). */
  checklistBodyOverride?: string | null;
  /** Inject CF evidence body; null = missing file. */
  cfEvidenceBodyOverride?: string | null;
  /** Inject cf-status body; null = missing file. */
  cfStatusBodyOverride?: string | null;
  /** Inject BUILD_CHECKLIST body; null = missing file; undefined = read disk. */
  buildChecklistBodyOverride?: string | null;
  /** Skip filesystem existence for bundle siblings (fixture mode). */
  skipBundleFileExistence?: boolean;
  /** Skip reports / source path existence (unit schema tests). */
  skipArtifactExistence?: boolean;
  /** Skip live linkcheck walk (unit tests). */
  skipLinkcheck?: boolean;
  /** Skip BUILD_CHECKLIST end-check (unit schema / CF-only fixtures). */
  skipBuildChecklistEndCheck?: boolean;
};

function walkMarkdown(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkMarkdown(p, acc);
    else if (extname(name) === ".md") acc.push(p);
  }
  return acc;
}

export type BrokenLink = {
  file: string;
  target: string;
  resolved: string;
};

/** Find broken internal markdown links (same rules as section 9.1). */
export function findBrokenInternalLinks(
  root: string,
  files: string[],
): BrokenLink[] {
  const linkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
  const broken: BrokenLink[] = [];
  for (const file of files) {
    const body = readFileSync(file, "utf8");
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(body))) {
      let target = m[2].trim();
      target = target.replace(/\s+".*"$/, "").replace(/\s+'.*'$/, "");
      if (
        !target ||
        target.startsWith("http://") ||
        target.startsWith("https://") ||
        target.startsWith("mailto:") ||
        target.startsWith("tel:") ||
        target.startsWith("#")
      ) {
        continue;
      }
      const pathPart = target.split("#")[0];
      if (!pathPart || pathPart.startsWith("data:")) continue;
      const resolved = resolve(dirname(file), pathPart);
      if (!existsSync(resolved)) {
        broken.push({
          file: relative(root, file),
          target,
          resolved: relative(root, resolved),
        });
      }
    }
  }
  return broken;
}

/**
 * Strip fenced code blocks (``` / ~~~) so documentation examples cannot
 * masquerade as active DEFER / status rows.
 */
export function stripFencedCodeBlocks(text: string): string {
  return String(text).replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1\s*$/gm, "\n");
}

/**
 * True when checklist/status text includes an **active** S-CF / BC10 DEFER row.
 * Documentation that merely mentions the word DEFER (or "not DEFER") does not count.
 * Fenced example blocks (e.g. inactive DEFER schema in cf-status.txt) are ignored.
 */
export function hasCfDeferRow(text: string): boolean {
  // Ignore inactive documentation examples inside fenced code blocks
  const body = stripFencedCodeBlocks(text);

  // Active markdown table status cell: | BC10 | S-CF | DEFER |
  if (
    /\|\s*\*?\*?BC10\*?\*?\s*\|\s*[^\n|]*\|\s*\*?\*?(DEFER|OWNER_AMEND)\*?\*?\s*\|/i.test(
      body,
    )
  ) {
    return true;
  }
  // Explicit assignment lines (not inside fences — already stripped)
  if (
    /\bBC10\b[^\n]{0,100}\bstatus\s*[:=]\s*(DEFER|OWNER_AMEND)\b/i.test(body)
  ) {
    return true;
  }
  if (
    /\bS-CF\b[^\n]{0,100}\bstatus\s*[:=]\s*(DEFER|OWNER_AMEND)\b/i.test(body)
  ) {
    return true;
  }
  // Selected YES row for DEFER option (gate-choice table: DEFER | YES)
  if (
    /\bDEFER\b[^\n]{0,80}\bS-CF\b|\bS-CF\b[^\n]{0,80}\bDEFER\b/i.test(body) &&
    /\|\s*\*?\*?DEFER[^\n|]*\|\s*\*?\*?YES\*?\*?\s*\|/i.test(body)
  ) {
    return true;
  }
  return false;
}

/** True when CF evidence body is DONE_WITH_EVIDENCE (or health 200 + redaction). */
export function isCfEvidenceDone(text: string): boolean {
  const body = String(text);
  if (/\bDONE_WITH_EVIDENCE\b/.test(body)) return true;
  const healthOk =
    /\/health/.test(body) &&
    (/\b200\b/.test(body) || /HTTP status\s*\|\s*200/i.test(body));
  const redaction = /redact/i.test(body);
  return healthOk && redaction;
}

/**
 * Reject claim without CF evidence or DEFER row.
 * Pure function for unit tests + checker.
 */
export function evaluateCfClaimGate(input: {
  claim: boolean;
  cfEvidenceBody: string | null;
  checklistOrStatusBody: string;
}): { ok: boolean; reason?: string } {
  const defer = hasCfDeferRow(input.checklistOrStatusBody);
  const done =
    input.cfEvidenceBody != null && isCfEvidenceDone(input.cfEvidenceBody);

  if (done || defer) {
    return { ok: true };
  }

  // Even without an explicit --claim flag, a missing CF gate is an error
  // when the programme bundle is validated (onboarding proof always checks).
  return {
    ok: false,
    reason:
      "rejects claim without CF evidence or DEFER row: missing DONE_WITH_EVIDENCE in cf-dogfood.txt and no DEFER/OWNER_AMEND for S-CF/BC10",
  };
}

/** Parsed BUILD_CHECKLIST table row for a BC id. */
export type BuildChecklistBcRow = {
  id: string;
  /** Status token cell (DONE_WITH_EVIDENCE | OWNER_AMEND | OPEN | …). */
  status?: string;
  /** Raw evidence_path cell (may list multiple paths). */
  evidencePath?: string;
  /** Split non-empty evidence path tokens from evidence_path. */
  evidencePaths: string[];
  /** Notes cell (may document OWNER_AMEND rationale). */
  notes?: string;
};

/**
 * Split an evidence_path cell into individual path tokens.
 * Supports `,` / `;` / ` + ` / ` · ` / newline separators.
 */
export function splitEvidencePaths(raw: string | undefined): string[] {
  if (raw == null) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  return trimmed
    .split(/\s*[;,]\s*|\s+\+\s+|\s+·\s+|\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Resolve a BUILD_CHECKLIST evidence_path against the workspace root.
 * Paths are typically `initiative/…` (under KMS-competition/) or repo-relative.
 */
export function resolveBuildChecklistEvidencePath(
  root: string,
  evidencePath: string,
): string {
  const p = evidencePath.trim();
  if (!p) return join(root, p);
  // Already repo-root relative
  if (
    p.startsWith("KMS-competition/") ||
    p.startsWith("docs/") ||
    p.startsWith("reports/") ||
    p.startsWith("apps/") ||
    p.startsWith("packages/") ||
    p.startsWith("playwright/") ||
    p.startsWith("scripts/")
  ) {
    return join(root, p);
  }
  // Canonical BUILD_CHECKLIST form: initiative/…
  if (p.startsWith("initiative/")) {
    return join(root, "KMS-competition", p);
  }
  // Fallback: try KMS-competition then root
  const underKms = join(root, "KMS-competition", p);
  if (existsSync(underKms)) return underKms;
  return join(root, p);
}

/**
 * Parse a full BUILD_CHECKLIST table row for a BC id.
 * Table columns: id | soul_ref | done_when | evidence_expected | status | evidence_path | notes
 */
export function parseBuildChecklistBcRow(
  checklistBody: string,
  bcId: string,
): BuildChecklistBcRow | undefined {
  const lines = checklistBody.split(/\r?\n/);
  for (const line of lines) {
    if (!line.includes("|")) continue;
    const cells = line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim().replace(/^\*+|\*+$/g, ""));
    if (cells.length < 2) continue;
    if (cells[0] !== bcId) continue;

    // Prefer column layout when present (status=4, evidence_path=5, notes=6)
    let status: string | undefined;
    let evidencePath: string | undefined;
    let notes: string | undefined;

    if (cells.length >= 6) {
      const statusCell = cells[4] ?? "";
      const statusMatch = statusCell.match(
        /\b(DONE_WITH_EVIDENCE|OWNER_AMEND|OPEN|DEFER|IN_PROGRESS|NEED_[A-Z_]+)\b/,
      );
      status = statusMatch?.[1];
      evidencePath = (cells[5] ?? "").trim() || undefined;
      notes = cells.length >= 7 ? (cells[6] ?? "").trim() || undefined : undefined;
    } else {
      // Fallback: scan the row for a status token (legacy / short fixtures)
      const statusMatch = line.match(
        /\b(DONE_WITH_EVIDENCE|OWNER_AMEND|OPEN|DEFER|IN_PROGRESS|NEED_[A-Z_]+)\b/,
      );
      status = statusMatch?.[1];
      // When columns are short, treat last non-status cell after id as path if any
      if (cells.length >= 3) {
        const tail = cells.slice(1).filter((c) => c && c !== status);
        if (tail.length > 0) {
          const maybePath = tail[tail.length - 1];
          if (
            maybePath &&
            !/^(DONE_WITH_EVIDENCE|OWNER_AMEND|OPEN|DEFER|IN_PROGRESS|NEED_[A-Z_]+)$/.test(
              maybePath,
            )
          ) {
            evidencePath = maybePath;
          }
        }
      }
    }

    return {
      id: bcId,
      status,
      evidencePath,
      evidencePaths: splitEvidencePaths(evidencePath),
      notes,
    };
  }
  return undefined;
}

/**
 * Parse BUILD_CHECKLIST table status for a BC id.
 * Expects a markdown table row containing the BC id and a status token.
 */
export function parseBuildChecklistBcStatus(
  checklistBody: string,
  bcId: string,
): string | undefined {
  return parseBuildChecklistBcRow(checklistBody, bcId)?.status;
}

/**
 * Parse BUILD_CHECKLIST evidence_path cell for a BC id.
 */
export function parseBuildChecklistBcEvidencePath(
  checklistBody: string,
  bcId: string,
): string | undefined {
  return parseBuildChecklistBcRow(checklistBody, bcId)?.evidencePath;
}

/**
 * Canonical BUILD_CHECKLIST end-check before CLAIM_PROVEN:
 * all BC01–BC15 must be DONE_WITH_EVIDENCE or OWNER_AMEND (no OPEN/IN_PROGRESS/NEED_*).
 * Closed rows must carry a non-empty evidence_path; when `root` is provided and
 * `skipEvidencePathExistence` is not true, each referenced path must exist on disk.
 */
export function evaluateBuildChecklistEndCheck(input: {
  buildChecklistBody: string | null;
  /** Workspace root for evidence_path filesystem checks. */
  root?: string;
  /** When true, require non-empty paths but skip existsSync (unit fixtures). */
  skipEvidencePathExistence?: boolean;
}): {
  ok: boolean;
  errors: string[];
  statuses: Record<string, string | undefined>;
  evidencePaths: Record<string, string[]>;
} {
  const errors: string[] = [];
  const statuses: Record<string, string | undefined> = {};
  const evidencePaths: Record<string, string[]> = {};

  if (input.buildChecklistBody == null || input.buildChecklistBody === "") {
    return {
      ok: false,
      errors: [
        `BUILD_CHECKLIST end-check failed: missing ${BUILD_CHECKLIST_REL}`,
      ],
      statuses,
      evidencePaths,
    };
  }

  const body = input.buildChecklistBody;
  if (!/End-check before CLAIM_PROVEN/i.test(body)) {
    errors.push(
      "BUILD_CHECKLIST missing end-check before CLAIM_PROVEN requirement text",
    );
  }

  for (const id of BUILD_CHECKLIST_BC_IDS) {
    const row = parseBuildChecklistBcRow(body, id);
    const status = row?.status;
    statuses[id] = status;
    evidencePaths[id] = row?.evidencePaths ?? [];

    if (!status) {
      errors.push(`BUILD_CHECKLIST missing ${id} row or status`);
      continue;
    }
    if (
      !(BUILD_CHECKLIST_CLAIM_STATUSES as readonly string[]).includes(status)
    ) {
      errors.push(
        `${id} status must be DONE_WITH_EVIDENCE or OWNER_AMEND before CLAIM_PROVEN (found: ${status})`,
      );
      continue;
    }

    // Closed rows: evidence_path required (status-only edits are not claim-safe)
    const paths = row?.evidencePaths ?? [];
    if (paths.length === 0) {
      if (status === "DONE_WITH_EVIDENCE") {
        errors.push(
          `${id} DONE_WITH_EVIDENCE requires non-empty evidence_path (status-only close is not claim-safe)`,
        );
      } else if (status === "OWNER_AMEND") {
        // OWNER_AMEND may document rationale in notes when no artifact path applies
        const notes = (row?.notes ?? "").trim();
        if (!notes) {
          errors.push(
            `${id} OWNER_AMEND requires non-empty evidence_path or notes recording the amendment`,
          );
        }
      }
      continue;
    }

    if (input.root && !input.skipEvidencePathExistence) {
      for (const rel of paths) {
        const abs = resolveBuildChecklistEvidencePath(input.root, rel);
        if (!existsSync(abs)) {
          errors.push(
            `${id} evidence_path missing on disk: ${rel} (resolved ${relative(input.root, abs)})`,
          );
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, statuses, evidencePaths };
}

/**
 * Parse status for a BC id from a markdown table row only.
 * Prefers: | BC13 | S-ONB-HUMAN | DONE_WITH_EVIDENCE | ...
 * Ignores prose mentions (bundle inventory, CF reject rules, etc.).
 */
export function parseBcTableStatus(
  checklistBody: string,
  bcId: string,
): string | undefined {
  const lines = checklistBody.split(/\r?\n/);
  for (const line of lines) {
    if (!line.includes("|")) continue;
    if (!new RegExp(`\\b${bcId}\\b`).test(line)) continue;
    // Require soul-ish or status token on the same table row
    const statusMatch = line.match(
      /\b(DONE_WITH_EVIDENCE|OWNER_AMEND|OPEN|DEFER|IN_PROGRESS|NEED_[A-Z_]+)\b/,
    );
    if (statusMatch) return statusMatch[1];
  }
  return undefined;
}

/** Parse BC13–15 schema from checklist markdown. */
export function parseBcPathsSchema(checklistBody: string): {
  ok: boolean;
  errors: string[];
  found: Record<string, { soul?: string; status?: string }>;
} {
  const errors: string[] = [];
  const found: Record<string, { soul?: string; status?: string }> = {};

  // Header must mention BC13–15 paths schema surface
  if (!/BC13[\s–—-]*15|BC13.*BC14.*BC15/i.test(checklistBody)) {
    errors.push("checklist missing BC13–15 section reference");
  }
  if (!/\bDONE_WITH_EVIDENCE\b|\bOWNER_AMEND\b/.test(checklistBody)) {
    errors.push("checklist missing DONE_WITH_EVIDENCE or OWNER_AMEND status tokens");
  }
  // Require schema keywords
  for (const key of ["Soul", "Status", "Evidence path", "Source path"]) {
    if (!new RegExp(key, "i").test(checklistBody)) {
      errors.push(`checklist missing schema column/keyword: ${key}`);
    }
  }

  for (const row of BC_ROWS) {
    const idRe = new RegExp(`\\b${row.id}\\b`);
    if (!idRe.test(checklistBody)) {
      errors.push(`checklist missing ${row.id} row`);
      continue;
    }
    if (!new RegExp(`\\b${row.soul}\\b`).test(checklistBody)) {
      errors.push(`checklist missing soul ${row.soul} for ${row.id}`);
    }
    const status = parseBcTableStatus(checklistBody, row.id);
    found[row.id] = { soul: row.soul, status };
    if (!status || !/^(DONE_WITH_EVIDENCE|OWNER_AMEND)$/.test(status)) {
      errors.push(
        `${row.id} status must be DONE_WITH_EVIDENCE or OWNER_AMEND (found: ${status ?? "none"})`,
      );
    }
    // Evidence file name referenced
    if (!checklistBody.includes(row.evidenceFile)) {
      errors.push(`${row.id} missing evidence path reference ${row.evidenceFile}`);
    }
  }

  return { ok: errors.length === 0, errors, found };
}

export function checkOnboardingProof(options: CheckOptions = {}): CheckResult {
  const root = options.root ?? defaultRoot;
  const evidenceDir =
    options.evidenceDir ?? join(root, EVIDENCE_DIR_REL);
  const checklistPath = join(evidenceDir, CHECKLIST_FILE);
  const errors: CheckIssue[] = [];
  const warnings: string[] = [];
  let linkcheckBroken = 0;

  // --- assert evidence bundle checklist file exists ---
  const checklistExists =
    options.checklistBodyOverride !== undefined
      ? options.checklistBodyOverride != null
      : existsSync(checklistPath);

  if (!checklistExists) {
    errors.push({
      code: "CHECKLIST_MISSING",
      message: `assert evidence bundle checklist file exists: missing ${relative(root, checklistPath)}`,
    });
  }

  let checklistBody = "";
  if (options.checklistBodyOverride != null) {
    checklistBody = options.checklistBodyOverride;
  } else if (existsSync(checklistPath)) {
    checklistBody = readFileSync(checklistPath, "utf8");
  }

  // Bundle sibling files
  if (!options.skipBundleFileExistence) {
    for (const name of REQUIRED_BUNDLE_FILES) {
      const p = join(evidenceDir, name);
      if (!existsSync(p)) {
        errors.push({
          code: "BUNDLE_FILE_MISSING",
          message: `evidence bundle incomplete: missing ${relative(root, p)}`,
        });
      }
    }
  }

  // --- assert BC13-15 paths schema in checklist ---
  if (checklistBody) {
    const schema = parseBcPathsSchema(checklistBody);
    for (const msg of schema.errors) {
      errors.push({ code: "BC_SCHEMA", message: `assert BC13-15 paths schema in checklist: ${msg}` });
    }

    // No tribal steps marker in checklist
    if (!/no tribal steps/i.test(checklistBody)) {
      warnings.push("checklist should attest no tribal steps");
    }
  }

  // Source paths + reports
  if (!options.skipArtifactExistence) {
    for (const row of BC_ROWS) {
      for (const src of row.sourcePaths) {
        const p = join(root, src);
        if (!existsSync(p)) {
          errors.push({
            code: "SOURCE_MISSING",
            message: `${row.id} source path missing: ${src}`,
          });
        }
      }
      const ev = join(evidenceDir, row.evidenceFile);
      if (!options.skipBundleFileExistence && !existsSync(ev)) {
        errors.push({
          code: "BC_EVIDENCE_MISSING",
          message: `${row.id} evidence file missing: ${row.evidenceFile}`,
        });
      }
    }

    for (const file of REPORT_FILES) {
      const p = join(root, "reports", file);
      if (!existsSync(p)) {
        errors.push({
          code: "REPORT_MISSING",
          message: `reports exist check failed: missing reports/${file}`,
        });
      }
    }

    // Portal must link onboarding + e2e-coverage
    const indexPath = join(root, "reports", "index.html");
    if (existsSync(indexPath)) {
      const html = readFileSync(indexPath, "utf8");
      if (!/onboarding\.html/.test(html)) {
        errors.push({
          code: "PORTAL_LINK",
          message: "reports/index.html must link onboarding.html",
        });
      }
      if (!/e2e-coverage\.html/.test(html)) {
        errors.push({
          code: "PORTAL_LINK",
          message: "reports/index.html must link e2e-coverage.html",
        });
      }
    }
  }

  // --- CF gate: reject claim without CF evidence or DEFER ---
  let cfBody: string | null;
  if (options.cfEvidenceBodyOverride !== undefined) {
    cfBody = options.cfEvidenceBodyOverride;
  } else {
    const cfPath = join(root, CF_EVIDENCE_REL);
    cfBody = existsSync(cfPath) ? readFileSync(cfPath, "utf8") : null;
  }

  let cfStatusBody = "";
  if (options.cfStatusBodyOverride !== undefined) {
    cfStatusBody = options.cfStatusBodyOverride ?? "";
  } else {
    const st = join(evidenceDir, "cf-status.txt");
    if (existsSync(st)) cfStatusBody = readFileSync(st, "utf8");
  }

  const gateText = `${checklistBody}\n${cfStatusBody}`;
  const claim = options.claim === true;
  const cfGate = evaluateCfClaimGate({
    claim,
    cfEvidenceBody: cfBody,
    checklistOrStatusBody: gateText,
  });

  if (!cfGate.ok) {
    errors.push({
      code: "CF_CLAIM_GATE",
      message:
        cfGate.reason ??
        "assert rejects claim without CF evidence or DEFER row",
      claimGate: true,
    });
  }

  // --- BUILD_CHECKLIST end-check (BC01–BC15 claim-safe) ---
  // Always enforced: exit 0 means claim-safe (CLAIM_PROVEN end-check).
  if (!options.skipBuildChecklistEndCheck) {
    let buildChecklistBody: string | null;
    if (options.buildChecklistBodyOverride !== undefined) {
      buildChecklistBody = options.buildChecklistBodyOverride;
    } else {
      const bcPath = join(root, BUILD_CHECKLIST_REL);
      buildChecklistBody = existsSync(bcPath)
        ? readFileSync(bcPath, "utf8")
        : null;
    }
    const endCheck = evaluateBuildChecklistEndCheck({
      buildChecklistBody,
      root,
      // Fixture mode may skip fs existence but still requires non-empty paths
      skipEvidencePathExistence: options.skipArtifactExistence === true,
    });
    for (const msg of endCheck.errors) {
      errors.push({
        code: "BUILD_CHECKLIST_END_CHECK",
        message: `BUILD_CHECKLIST end-check: ${msg}`,
      });
    }
  }

  // --- linkcheck 0 ---
  if (!options.skipLinkcheck) {
    const files = walkMarkdown(join(root, "docs"));
    const readme = join(root, "README.md");
    if (existsSync(readme)) files.push(readme);
    const broken = findBrokenInternalLinks(root, files);
    linkcheckBroken = broken.length;
    if (broken.length > 0) {
      errors.push({
        code: "LINKCHECK",
        message: `linkcheck 0 failed: ${broken.length} broken internal link(s) — e.g. ${broken[0].file} → ${broken[0].target}`,
      });
    }

    if (options.writeLinkcheck !== false && existsSync(evidenceDir)) {
      try {
        const report = [
          "# Linkcheck report — onboarding proof (section 9.6)",
          "",
          `Workspace: speakerops-build`,
          `Date (UTC): ${new Date().toISOString()}`,
          `Status: ${broken.length === 0 ? "PASS" : "FAIL"}`,
          `Broken internal links: ${broken.length}`,
          "",
          "## Scope",
          "",
          "- README.md (workspace root)",
          "- docs/**/*.md (recursive)",
          "",
          "External http(s), mailto, tel, and pure fragment (#) links are ignored.",
          "",
          "## Result",
          "",
          broken.length === 0
            ? "linkcheck 0 — no broken internal markdown links in scope."
            : broken
                .map((b) => `- ${b.file} → ${b.target} (resolved ${b.resolved})`)
                .join("\n"),
          "",
          "Checker: scripts/check-onboarding-proof.ts",
          "Soul: S-DOCS",
          "AC: linkcheck 0",
          "",
        ].join("\n");
        writeFileSync(join(evidenceDir, "linkcheck.txt"), report, "utf8");
      } catch {
        warnings.push("could not write linkcheck.txt");
      }
    }
  }

  // Secret hygiene: refuse obvious secret values in evidence bundle
  if (!options.skipBundleFileExistence && existsSync(evidenceDir)) {
    const secretRes = [
      /sk-[A-Za-z0-9]{20,}/,
      /Bearer\s+[A-Za-z0-9\-._~+/]{20,}/,
      /spk_[A-Za-z0-9]{20,}/,
      /CLOUDFLARE_API_TOKEN\s*=\s*["'][^"']{8,}["']/,
    ];
    for (const name of REQUIRED_BUNDLE_FILES) {
      const p = join(evidenceDir, name);
      if (!existsSync(p)) continue;
      const body = readFileSync(p, "utf8");
      for (const re of secretRes) {
        if (re.test(body)) {
          errors.push({
            code: "SECRET_LEAK",
            message: `secret-like pattern in evidence ${name}`,
          });
        }
      }
    }
  }

  const hasClaimGateError = errors.some((e) => e.claimGate);
  const hasOtherErrors = errors.some((e) => !e.claimGate);
  let exitCode: 0 | 1 | 2 = 0;
  if (hasClaimGateError) exitCode = 2;
  else if (hasOtherErrors) exitCode = 1;

  return {
    ok: errors.length === 0,
    exitCode,
    errors,
    warnings,
    linkcheckBroken,
    evidenceDir,
    checklistPath,
  };
}

function printResult(result: CheckResult): void {
  const tag = "[check:onboarding-proof]";
  if (result.ok) {
    console.log(
      `${tag} OK: evidence bundle complete; BC13–15 schema; BUILD_CHECKLIST BC01–15 end-check; linkcheck ${result.linkcheckBroken}; CF gate pass`,
    );
    for (const w of result.warnings) {
      console.log(`${tag} warn: ${w}`);
    }
    return;
  }
  for (const e of result.errors) {
    console.error(`${tag} ERROR (${e.code}): ${e.message}`);
  }
  for (const w of result.warnings) {
    console.error(`${tag} warn: ${w}`);
  }
}

function parseArgs(argv: string[]): { claim: boolean; help: boolean } {
  let claim = false;
  let help = false;
  for (const a of argv) {
    if (a === "--claim") claim = true;
    if (a === "--help" || a === "-h") help = true;
  }
  // Allow env name (value "1") without embedding secrets
  if (process.env.ONBOARDING_PROOF_CLAIM === "1") claim = true;
  return { claim, help };
}

function main(): void {
  const { claim, help } = parseArgs(process.argv.slice(2));
  if (help) {
    console.log(`Usage: tsx scripts/check-onboarding-proof.ts [--claim]

Validates KMS-competition/initiative/evidence/onboarding-proof/ for section 9.6.

  --claim   Treat as programme-exit claim (same CF + BUILD_CHECKLIST gates; exit 2 if CF missing)

Exit: 0 claim-safe (BC13–15 + CF + BUILD_CHECKLIST BC01–15) · 1 incomplete/schema/linkcheck/end-check · 2 claim without CF evidence or DEFER
`);
    process.exit(0);
  }

  // Ensure evidence dir exists before write
  const evidenceDir = join(defaultRoot, EVIDENCE_DIR_REL);
  if (!existsSync(evidenceDir)) {
    mkdirSync(evidenceDir, { recursive: true });
  }

  const result = checkOnboardingProof({ root: defaultRoot, claim });
  printResult(result);
  process.exit(result.exitCode);
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main();
}
