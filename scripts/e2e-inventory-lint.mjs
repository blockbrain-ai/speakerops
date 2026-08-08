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
 * @inv must appear on a real Playwright `test(...)` / `test.only(...)`
 * title whose callee is bound to the Playwright `test` export (import from
 * `@playwright/test`, optionally rebound via `.extend()`). Local no-op
 * `const test = (...) => {}` without a Playwright binding does not count.
 * Structural matching (imports, rebinds, shadows, call sites) ignores
 * string/template interiors — decoy strings cannot spoof an import or a
 * `test(...)` declaration. Title text is read only from real call sites.
 * Strict 1:1 inventory map: exactly one `@inv:ID` per test title.
 * Comments, bare strings, multi-tag titles, skipped/fixme/fail-only
 * coverage (test.fail is expected-failure, not dogfood proof), duplicate
 * active owners, and missing `test_id` path anchors do not satisfy the gate.
 *
 * Does not claim S-E2E-RUN (full browser run) — that is Phase 8 Playwright.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
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
      const keep = shouldKeepSpecifier();
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
 *   (standard fixture pattern).
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

  // ESM: import { test } from '@playwright/test'
  //      import { test as base, expect } from "@playwright/test"
  const importRe =
    /import\s*(?:type\s*)?\{([^}]+)\}\s*from\s*['"]@playwright\/test['"]/g;
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

  // Fixture / rebind: const test = base.extend({...}) or const test = base
  for (let pass = 0; pass < 4; pass++) {
    let grew = false;
    const names = [...bindings].map(escapeRegExp).join("|");
    if (!names) break;
    const rebindRe = new RegExp(
      `\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(${names})\\s*(?:\\.\\s*extend\\s*\\(|[;\\n,)])`,
      "g",
    );
    let rm;
    while ((rm = rebindRe.exec(scan)) !== null) {
      if (!bindings.has(rm[1])) {
        bindings.add(rm[1]);
        grew = true;
      }
    }
    if (!grew) break;
  }

  // Shadowing / non-Playwright reassignment removes the name.
  for (const name of [...bindings]) {
    const assignRe = new RegExp(
      `\\b(?:const|let|var)\\s+${escapeRegExp(name)}\\s*=\\s*([^;\\n]+)`,
      "g",
    );
    let am;
    while ((am = assignRe.exec(scan)) !== null) {
      const rhs = am[1].trim().replace(/[;,].*$/, "").trim();
      const names = [...bindings].map(escapeRegExp).join("|");
      const validRebind = new RegExp(
        `^(?:${names})\\s*(?:\\.\\s*extend\\s*\\(|$)`,
      );
      if (validRebind.test(rhs)) {
        continue;
      }
      bindings.delete(name);
      break;
    }
    const shadowDecl = new RegExp(
      `\\bfunction\\s+${escapeRegExp(name)}\\s*\\(`,
    );
    if (shadowDecl.test(scan)) {
      bindings.delete(name);
    }
    // Bare reassignment without const/let/var (e.g. `test = (...args) => {}`)
    // also invalidates a prior Playwright binding.
    const bareAssign = new RegExp(
      `(?<![.=])\\b${escapeRegExp(name)}\\s*=\\s*(?!=)([^;\\n]+)`,
      "g",
    );
    let ba;
    while ((ba = bareAssign.exec(scan)) !== null) {
      const rhs = ba[1].trim().replace(/[;,].*$/, "").trim();
      const names = [...bindings].map(escapeRegExp).join("|");
      const validRebind = new RegExp(
        `^(?:${names})\\s*(?:\\.\\s*extend\\s*\\(|$)`,
      );
      if (validRebind.test(rhs)) continue;
      bindings.delete(name);
      break;
    }
  }

  return bindings;
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

  const nameAlt = [...bindings].map(escapeRegExp).join("|");
  // test("…") / test.only / test.skip / test.fixme / test.fail — first arg title
  // Also accepts aliased fixtures: base("…"), myTest.only("…")
  const re = new RegExp(
    `\\b(?<callee>${nameAlt})(?:\\.(?<mod>only|skip|fixme|fail))?\\s*\\(\\s*(?<q>['"\`])(?<title>(?:\\\\.|(?!\\k<q>)[\\s\\S])*?)\\k<q>`,
    "g",
  );
  let m;
  while ((m = re.exec(code)) !== null) {
    if (inString[m.index]) {
      continue;
    }
    const title = m.groups.title.replace(/\\([\\'"`nrt])/g, (_, ch) => {
      if (ch === "n") return "\n";
      if (ch === "r") return "\r";
      if (ch === "t") return "\t";
      return ch;
    });
    const mod = m.groups.mod || "";
    // skip/fixme never run; fail is expected-failure (not dogfood proof)
    const skipped = mod === "skip" || mod === "fixme" || mod === "fail";
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
 * Run inventory lint.
 *
 * @param {object} [options]
 * @param {string} [options.root]
 * @param {string} [options.inventoryPath]
 * @param {string} [options.baselinePath]
 * @param {string[]} [options.e2eRoots]
 * @param {boolean} [options.fullGate]
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
    const deferIds = new Set(
      journeys.filter((j) => j.status === "DEFER").map((j) => j.id),
    );

    if (requiredIds.length === 0) {
      fail("REQUIRED set is empty — forbidden (would green-wash dogfood gate)");
    }

    // --- Anti-shrinkage: exact ratified baseline ID set ---
    const missingFromInventory = baselineIds.filter((id) => !byId.has(id));
    if (missingFromInventory.length > 0) {
      fail(
        `baseline IDs deleted or renamed (anti-shrinkage; owner DEFER row required, not deletion): ${idList(missingFromInventory)}`,
      );
    }

    const unauthorizedDrops = [];
    for (const id of baselineIds) {
      const row = byId.get(id);
      if (!row) continue;
      if (row.required) continue;
      if (row.status === "DEFER") continue;
      unauthorizedDrops.push(id);
    }
    if (unauthorizedDrops.length > 0) {
      fail(
        `baseline IDs no longer REQUIRED without owner DEFER status: ${idList(unauthorizedDrops)}`,
      );
    }

    const baselineStillRequired = baselineIds.filter((id) => {
      const row = byId.get(id);
      return row && row.required && row.status !== "DEFER";
    });
    const baselineDeferred = baselineIds.filter((id) => {
      const row = byId.get(id);
      return row && row.status === "DEFER";
    });
    const minRequired = baselineIds.length - baselineDeferred.length;
    if (baselineStillRequired.length < minRequired) {
      fail(
        `REQUIRED baseline coverage ${baselineStillRequired.length} < ${minRequired} (baseline ${baselineIds.length} − ${baselineDeferred.length} DEFER)`,
      );
    }

    // --- Anti-reuse: baseline ID must keep stable test_id + journey fingerprint ---
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

    // --- Phase 8: every non-DEFER REQUIRED row must claim status PASS ---
    // Ratified law (0.3 §2): CI fails if REQUIRED and not PASS at the Phase 8
    // gate. Intermediate modes do not enforce PASS (OPEN→IMPLEMENTED lifecycle).
    if (fullGate) {
      const notPass = journeys
        .filter(
          (j) => j.required && j.status !== "DEFER" && j.status !== "PASS",
        )
        .map((j) => `${j.id}=${j.status || "<blank>"}`);
      if (notPass.length > 0) {
        fail(
          `Phase 8 full gate: every non-DEFER REQUIRED row must have status PASS` +
            ` (dogfood_ready / inventory law); not PASS: ${idList(notPass)}`,
        );
      }
      log(
        `[test:e2e:inventory] OK: Phase 8 status claim — ${baselineStillRequired.length} non-DEFER REQUIRED rows are PASS`,
      );
    }

    // --- @inv tag coverage on real Playwright tests (decision table) ---
    const e2eRoots =
      options.e2eRoots ??
      [
        join(root, "playwright", "e2e"),
        join(root, "e2e"),
        join(root, "apps", "web", "e2e"),
      ];
    const existingRoots = e2eRoots.filter((d) => existsSync(d));
    const files = existingRoots.flatMap((d) => collectFiles(d));

    /** IDs that must have @inv tags under current gate mode. */
    let tagTargets;
    let modeLabel;
    if (fullGate) {
      tagTargets = journeys
        .filter((j) => j.required && j.status !== "DEFER")
        .map((j) => j.id);
      modeLabel = "phase8 full REQUIRED";
    } else {
      tagTargets = journeys
        .filter(
          (j) =>
            j.required &&
            j.status !== "DEFER" &&
            TAG_REQUIRED_STATUSES.has(j.status),
        )
        .map((j) => j.id);
      modeLabel = "implemented/status-owned";
    }

    // Phase 8: absence of root or test files is always a hard failure.
    if (fullGate) {
      if (existingRoots.length === 0) {
        fail(
          "Phase 8 full gate: no E2E root found (expected playwright/e2e, e2e/, or apps/web/e2e) — tag coverage cannot be deferred",
        );
      }
      if (files.length === 0) {
        fail(
          "Phase 8 full gate: E2E root(s) present but no test files (*.ts|js|mjs|tsx) — full REQUIRED @inv coverage required",
        );
      }
    }

    // Any mode: if tag targets exist, test files must exist.
    if (tagTargets.length > 0 && files.length === 0) {
      const where =
        existingRoots.length === 0
          ? "no E2E root found (expected playwright/e2e, e2e/, or apps/web/e2e)"
          : "E2E root(s) present but no test files (*.ts|js|mjs|tsx)";
      fail(
        `${where}, while ${tagTargets.length} ${modeLabel} IDs require @inv tags: ${idList(tagTargets)}`,
      );
    }

    if (tagTargets.length > 0 && files.length > 0) {
      /** @type {{ id: string, skipped: boolean, focused: boolean, multiTag: boolean, title: string, file: string }[]} */
      const allFindings = [];
      for (const f of files) {
        const src = readFileSync(f, "utf8");
        allFindings.push(...extractInvTaggedTests(f, src));
      }

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
      const duplicates = [];
      const focusedIds = [];
      const wrongTestId = [];

      // Detect loose @inv:ID occurrences that are NOT on a test title (comments etc.)
      // for clearer diagnostics when a target is missing.
      const looseBlob = files.map((f) => readFileSync(f, "utf8")).join("\n");

      for (const id of tagTargets) {
        const list = findingsById.get(id) || [];
        // multiTag never counts as active ownership (already failed above if any)
        const active = list.filter((x) => !x.skipped && !x.multiTag);
        const skipped = list.filter((x) => x.skipped && !x.multiTag);

        if (active.length === 0 && skipped.length === 0) {
          if (looseBlob.includes(`@inv:${id}`)) {
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
        const anchored = active.some((x) =>
          isTestIdAnchored({
            file: x.file,
            title: x.title,
            testId,
            e2eRoots: existingRoots,
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
      if (commentOrLooseOnly.length > 0) {
        fail(
          `@inv tags for ${modeLabel} IDs appear only outside Playwright-bound test() titles (comments/strings/local no-op test() are not 1:1 coverage): ${idList(commentOrLooseOnly)}`,
        );
      }
      if (skippedOnly.length > 0) {
        fail(
          `@inv tags for ${modeLabel} IDs only appear on skipped/fixme/fail tests (not executable coverage; test.fail is expected-failure, not dogfood proof): ${idList(skippedOnly)}`,
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

      log(
        `[test:e2e:inventory] OK: @inv on Playwright-bound test() titles cover ${tagTargets.length} ${modeLabel} IDs (1:1, non-skip/non-fail, test_id-anchored)` +
          (fullGate
            ? ""
            : ` (${requiredIds.length - deferIds.size} total non-DEFER REQUIRED at Phase 8)`),
      );
    } else if (!fullGate) {
      // tagTargets empty: all journeys still OPEN/DEFER — pre-harness deferral is OK
      log(
        "[test:e2e:inventory] note: no status-owned IDs require @inv yet — tag coverage deferred until harness / IMPLEMENTED rows (Phase 1.5+)",
      );
    }

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
