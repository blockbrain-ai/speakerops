/**
 * Inventory lint gate: `pnpm test:e2e:inventory`
 *
 * Pre-scaffold (0.3+): validates canonical BROWSER_E2E_INVENTORY.md
 * REQUIRED semantics, unique IDs, unique non-empty test_ids, exact ratified
 * baseline ID set + stable test_id/journey fingerprints (anti-reuse).
 * Post Playwright (1.5+): checks @inv tags for implemented / status-owned
 * rows when an e2e tree exists; full REQUIRED set only under Phase 8 gate.
 *
 * Does not claim S-E2E-RUN (full browser run) — that is Phase 8.
 *
 * Phase 8 full tag enforcement:
 *   E2E_INVENTORY_GATE=phase8  pnpm test:e2e:inventory
 *   node scripts/e2e-inventory-lint.mjs --phase8
 *
 * In Phase 8 / full-gate mode, absence of an E2E root or test files is a
 * hard failure (coverage is not deferred).
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
const baselinePath = join(
  root,
  "scripts",
  "e2e-inventory-required-baseline.json",
);

/** Statuses that mean a journey is owned/implemented and must have an @inv tag once e2e exists. */
const TAG_REQUIRED_STATUSES = new Set(["IMPLEMENTED", "PASS", "FAIL"]);

const fullGate =
  process.argv.includes("--phase8") ||
  process.argv.includes("--full") ||
  process.env.E2E_INVENTORY_GATE === "phase8" ||
  process.env.E2E_INVENTORY_GATE === "full";

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

/** Normalize empty / dash placeholders to empty string. */
function normalizeCell(s) {
  const t = (s ?? "").trim();
  if (t === "" || t === "—" || t === "-" || t === "–") return "";
  return t;
}

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
// Columns: ID | Role | Surface | Journey | test_id | Negative | Required | Status
const rowRe =
  /^\| ([A-Z]\d{2}) \|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\| (REQUIRED|OPTIONAL) \| (\w+) \|/gm;
/** @type {{ id: string, journey: string, testId: string, required: boolean, status: string }[]} */
const journeys = [];
let m;
while ((m = rowRe.exec(body)) !== null) {
  journeys.push({
    id: m[1].trim(),
    journey: normalizeCell(m[4]),
    testId: normalizeCell(m[5]),
    required: m[7] === "REQUIRED",
    status: m[8].trim().toUpperCase(),
  });
}

if (journeys.length === 0) {
  fail("no inventory journey rows parsed (expected | ID | ... | REQUIRED | STATUS |)");
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
    `REQUIRED rows missing non-empty test_id: ${missingTestIds.slice(0, 20).join(", ")}${missingTestIds.length > 20 ? ` …(+${missingTestIds.length - 20})` : ""}`,
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

// All journey rows (including OPTIONAL) must not share test_ids either
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
// Every baseline ID must still exist. It must remain REQUIRED, or carry
// explicit owner DEFER status (omission from required PASS set only that way).
// Replacing a baseline ID with a different ID while keeping count ≥ N is forbidden.
const missingFromInventory = baselineIds.filter((id) => !byId.has(id));
if (missingFromInventory.length > 0) {
  fail(
    `baseline IDs deleted or renamed (anti-shrinkage; owner DEFER row required, not deletion): ${missingFromInventory.slice(0, 20).join(", ")}${missingFromInventory.length > 20 ? ` …(+${missingFromInventory.length - 20})` : ""}`,
  );
}

const unauthorizedDrops = [];
for (const id of baselineIds) {
  const row = byId.get(id);
  if (!row) continue; // already reported
  if (row.required) continue;
  if (row.status === "DEFER") continue;
  unauthorizedDrops.push(id);
}
if (unauthorizedDrops.length > 0) {
  fail(
    `baseline IDs no longer REQUIRED without owner DEFER status: ${unauthorizedDrops.slice(0, 20).join(", ")}${unauthorizedDrops.length > 20 ? ` …(+${unauthorizedDrops.length - 20})` : ""}`,
  );
}

// Count of non-DEFER REQUIRED among baseline (and overall) must not fall below
// baseline size minus explicit DEFERs on baseline IDs.
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
// Reusing A01 for unrelated behavior (new journey/test_id) is forbidden even if
// the ID string remains. Intentional wording updates re-ratify baseline fingerprints.
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
    `baseline ID reuse / semantic drift (test_id or journey changed; IDs must not be reused for different behavior): ${fingerprintMismatches.slice(0, 20).join(", ")}${fingerprintMismatches.length > 20 ? ` …(+${fingerprintMismatches.length - 20})` : ""}`,
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

console.log(
  `[test:e2e:inventory] OK: baseline ${baselineIds.length} IDs intact` +
    ` (${baselineStillRequired.length} REQUIRED non-DEFER, ${baselineDeferred.length} DEFER);` +
    ` inventory ${requiredIds.length} REQUIRED, ${unique.size} unique IDs, ${testIdSet.size} unique test_ids; fingerprints match`,
);

// --- @inv tag coverage when e2e tree exists (or Phase 8 full gate) ---
const e2eRoots = [
  join(root, "playwright", "e2e"),
  join(root, "e2e"),
  join(root, "apps", "web", "e2e"),
];
const existingRoots = e2eRoots.filter((d) => existsSync(d));
const files = existingRoots.flatMap((d) => collectFiles(d));

if (fullGate) {
  // Phase 8: absence of E2E root or test files is a hard failure.
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

if (existingRoots.length > 0 && files.length > 0) {
  const blob = files.map((f) => readFileSync(f, "utf8")).join("\n");

  /** IDs that must have @inv tags under current gate mode. */
  let tagTargets;
  let modeLabel;
  if (fullGate) {
    // Phase 8: every non-DEFER REQUIRED journey
    tagTargets = journeys
      .filter((j) => j.required && j.status !== "DEFER")
      .map((j) => j.id);
    modeLabel = "phase8 full REQUIRED";
  } else {
    // Intermediate (1.5–7): only implemented / status-owned rows
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

  const missing = tagTargets.filter((id) => !blob.includes(`@inv:${id}`));
  if (missing.length > 0) {
    fail(
      `Playwright tree present but missing @inv tags for ${modeLabel} IDs: ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? ` …(+${missing.length - 20})` : ""}` +
        (fullGate
          ? ""
          : " (OPEN rows deferred until owned; use E2E_INVENTORY_GATE=phase8 for full REQUIRED set)"),
    );
  }
  console.log(
    `[test:e2e:inventory] OK: @inv tags cover ${tagTargets.length} ${modeLabel} IDs under e2e roots` +
      (fullGate ? "" : ` (${requiredIds.length - deferIds.size} total non-DEFER REQUIRED at Phase 8)`),
  );
} else if (!fullGate) {
  console.log(
    "[test:e2e:inventory] note: no playwright/e2e tree yet — tag coverage deferred until harness (Phase 1.5+)",
  );
}

process.exit(0);
