/**
 * Inventory lint gate: `pnpm test:e2e:inventory`
 *
 * Pre-scaffold (0.3+): validates canonical BROWSER_E2E_INVENTORY.md
 * REQUIRED semantics, unique IDs, anti-shrinkage baseline.
 * Post Playwright (1.5+): also checks @inv tags when playwright/e2e exists.
 *
 * Does not claim S-E2E-RUN (full browser run) — that is Phase 8.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const inventoryPath = join(
  root,
  "KMS-competition",
  "initiative",
  "BROWSER_E2E_INVENTORY.md",
);

/** Ratified baseline at section 0.3 — REQUIRED count must not shrink below this without owner DEFER. */
const REQUIRED_BASELINE = 108;

function fail(msg) {
  console.error(`[test:e2e:inventory] FAIL: ${msg}`);
  process.exit(1);
}

function collectFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) collectFiles(p, acc);
    else if (/\.(ts|js|mjs|tsx)$/.test(name)) acc.push(p);
  }
  return acc;
}

if (!existsSync(inventoryPath)) {
  fail(`canonical inventory missing: ${inventoryPath}`);
}

const body = readFileSync(inventoryPath, "utf8");

// Journey rows: | A01 | ... | REQUIRED | STATUS |
const rowRe =
  /^\| ([A-Z]\d{2}) \|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\| (REQUIRED|OPTIONAL) \|/gm;
const ids = [];
const requiredIds = [];
let m;
while ((m = rowRe.exec(body)) !== null) {
  ids.push(m[1]);
  if (m[2] === "REQUIRED") requiredIds.push(m[1]);
}

if (ids.length === 0) {
  fail("no inventory journey rows parsed (expected | ID | ... | REQUIRED |)");
}

const unique = new Set(ids);
if (unique.size !== ids.length) {
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  fail(`duplicate inventory IDs: ${[...new Set(dupes)].join(", ")}`);
}

if (requiredIds.length === 0) {
  fail("REQUIRED set is empty — forbidden (would green-wash dogfood gate)");
}

if (requiredIds.length < REQUIRED_BASELINE) {
  fail(
    `REQUIRED count ${requiredIds.length} < baseline ${REQUIRED_BASELINE} (anti-shrinkage; owner DEFER required to reduce)`,
  );
}

// Law markers in canonical file
if (!/REQUIRED\s*=\s*must PASS for dogfood/i.test(body) && !/must PASS for dogfood_ready/i.test(body)) {
  // Accept either inventory legend phrasing
  if (!/dogfood_ready/i.test(body) || !/REQUIRED/i.test(body)) {
    fail("inventory must define REQUIRED relative to dogfood / dogfood_ready");
  }
}

if (!/Discovery crawl REQUIRED at Phase 8/i.test(body)) {
  fail("inventory must state discovery crawl REQUIRED at Phase 8");
}

if (!/@inv:/i.test(body) && !/must tag `@inv:/i.test(body) && !/tag `@inv:/i.test(body)) {
  // Coverage rules mention @inv:A01
  if (!/@inv:A01/.test(body)) {
    fail("inventory must document @inv tagging convention");
  }
}

console.log(
  `[test:e2e:inventory] OK: ${requiredIds.length} REQUIRED IDs (baseline ≥ ${REQUIRED_BASELINE}), ${unique.size} unique`,
);

// Optional: when playwright e2e tree exists, require @inv tags for each REQUIRED id
const e2eRoots = [
  join(root, "playwright", "e2e"),
  join(root, "e2e"),
  join(root, "apps", "web", "e2e"),
];
const existingRoots = e2eRoots.filter((d) => existsSync(d));
if (existingRoots.length > 0) {
  const files = existingRoots.flatMap((d) => collectFiles(d));
  const blob = files.map((f) => readFileSync(f, "utf8")).join("\n");
  const missing = requiredIds.filter((id) => !blob.includes(`@inv:${id}`));
  if (missing.length > 0) {
    fail(
      `Playwright tree present but missing @inv tags for: ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? ` …(+${missing.length - 20})` : ""}`,
    );
  }
  console.log(
    `[test:e2e:inventory] OK: @inv tags cover all ${requiredIds.length} REQUIRED IDs under e2e roots`,
  );
} else {
  console.log(
    "[test:e2e:inventory] note: no playwright/e2e tree yet — tag coverage deferred until harness (Phase 1.5+)",
  );
}

process.exit(0);
