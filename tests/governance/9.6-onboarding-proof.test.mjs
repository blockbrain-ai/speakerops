/**
 * Section 9.6 — Onboarding proof keystone (node:test / test:ci).
 *
 * Named assertions from spec:
 * - assert evidence bundle checklist file exists
 * - assert BC13-15 paths schema in checklist
 * - assert rejects claim without CF evidence or DEFER row
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const evidenceDir = join(
  root,
  "KMS-competition/initiative/evidence/onboarding-proof",
);
const checklistPath = join(evidenceDir, "README.md");
const paths = {
  checklist: checklistPath,
  human: join(evidenceDir, "human-dry-run.txt"),
  agent: join(evidenceDir, "agent-dry-run.txt"),
  linkcheck: join(evidenceDir, "linkcheck.txt"),
  docsReports: join(evidenceDir, "docs-reports.txt"),
  cfStatus: join(evidenceDir, "cf-status.txt"),
  cfEvidence: join(
    root,
    "KMS-competition/initiative/evidence/cf-dogfood.txt",
  ),
  script: join(root, "scripts/check-onboarding-proof.ts"),
  section: join(root, "docs/sections/9.6-onboarding-proof.md"),
  packageJson: join(root, "package.json"),
  buildChecklist: join(
    root,
    "KMS-competition/initiative/BUILD_CHECKLIST.md",
  ),
  reportsIndex: join(root, "reports/index.html"),
  onboarding: join(root, "docs/ONBOARDING.md"),
  agentSetup: join(root, "docs/AGENT_SETUP.md"),
};

describe("9.6 Onboarding proof keystone", () => {
  it("assert evidence bundle checklist file exists", () => {
    assert.equal(existsSync(paths.checklist), true, "checklist README missing");
    for (const key of [
      "human",
      "agent",
      "linkcheck",
      "docsReports",
      "cfStatus",
      "script",
      "section",
    ]) {
      assert.equal(existsSync(paths[key]), true, `missing ${key}`);
    }
    const body = readFileSync(paths.checklist, "utf8");
    assert.match(body, /S-ONB-HUMAN/);
    assert.match(body, /S-ONB-AGENT/);
    assert.match(body, /S-DOCS/);
    assert.match(body, /no tribal steps/i);
  });

  it("assert BC13-15 paths schema in checklist", () => {
    const body = readFileSync(paths.checklist, "utf8");
    assert.match(body, /BC13/);
    assert.match(body, /BC14/);
    assert.match(body, /BC15/);
    assert.match(body, /S-ONB-HUMAN/);
    assert.match(body, /S-ONB-AGENT/);
    assert.match(body, /S-DOCS/);
    assert.match(body, /DONE_WITH_EVIDENCE/);
    assert.match(body, /Evidence path/i);
    assert.match(body, /Source path/i);
    assert.match(body, /human-dry-run\.txt/);
    assert.match(body, /agent-dry-run\.txt/);
    assert.match(body, /docs-reports\.txt/);
    assert.equal(existsSync(paths.onboarding), true);
    assert.equal(existsSync(paths.agentSetup), true);
    assert.equal(existsSync(paths.reportsIndex), true);
  });

  it("assert rejects claim without CF evidence or DEFER row", () => {
    // Negative: override via env is not available; spawn checker after
    // temporarily is heavy — import pure helpers through tsx one-shot.
    const r = spawnSync(
      "pnpm",
      [
        "exec",
        "tsx",
        "-e",
        `
import {
  evaluateCfClaimGate,
  checkOnboardingProof,
  hasCfDeferRow,
  evaluateBuildChecklistEndCheck,
} from "./scripts/check-onboarding-proof.ts";
const rejected = evaluateCfClaimGate({
  claim: true,
  cfEvidenceBody: null,
  checklistOrStatusBody: "BC13 only",
});
if (rejected.ok) { console.error("expected reject"); process.exit(1); }
const deferred = evaluateCfClaimGate({
  claim: true,
  cfEvidenceBody: null,
  checklistOrStatusBody: "| BC10 | S-CF | DEFER | waiver |",
});
if (!deferred.ok) { console.error("expected defer ok"); process.exit(1); }
// Fenced DEFER examples must not waive CF
const fenced = ["\`\`\`text", "BC10 status: DEFER", "S-CF status: DEFER", "\`\`\`"].join("\\n");
if (hasCfDeferRow(fenced)) { console.error("fenced defer should be inactive"); process.exit(1); }
const bad = checkOnboardingProof({
  claim: true,
  cfEvidenceBodyOverride: null,
  cfStatusBodyOverride: "no defer",
  checklistBodyOverride: "BC13 DONE_WITH_EVIDENCE",
  skipBundleFileExistence: true,
  skipArtifactExistence: true,
  skipLinkcheck: true,
  skipBuildChecklistEndCheck: true,
  writeLinkcheck: false,
});
if (bad.exitCode !== 2) {
  console.error("expected exit 2", bad);
  process.exit(1);
}
// OPEN BC fails end-check
const openEnd = evaluateBuildChecklistEndCheck({
  buildChecklistBody: "| BC01 | S-THEME | x | y | OPEN | initiative/evidence/x.txt | |\\n**End-check before CLAIM_PROVEN**",
  skipEvidencePathExistence: true,
});
if (openEnd.ok) { console.error("expected open end-check fail"); process.exit(1); }
// DONE_WITH_EVIDENCE with empty evidence_path is not claim-safe
const emptyPath = evaluateBuildChecklistEndCheck({
  buildChecklistBody: [
    "**End-check before CLAIM_PROVEN**",
    "| id | soul_ref | done_when | evidence_expected | status | evidence_path | notes |",
    "|----|----------|-----------|-------------------|--------|---------------|-------|",
    ...["BC01","BC02","BC03","BC04","BC05","BC06","BC07","BC08","BC09","BC10","BC11","BC12","BC13","BC14","BC15"].map(
      (id) => "| " + id + " | S-X | x | y | DONE_WITH_EVIDENCE | | |"
    ),
  ].join("\\n"),
  skipEvidencePathExistence: true,
});
if (emptyPath.ok) { console.error("expected empty evidence_path fail"); process.exit(1); }
if (!emptyPath.errors.some((e) => /evidence_path/.test(e))) {
  console.error("expected evidence_path errors", emptyPath.errors);
  process.exit(1);
}
console.log("cf-gate-ok");
`,
      ],
      {
        cwd: root,
        encoding: "utf8",
        shell: false,
        env: { ...process.env },
      },
    );
    assert.equal(
      r.status,
      0,
      `cf gate negative failed: ${r.stderr || r.stdout}`,
    );
    assert.match(r.stdout, /cf-gate-ok/);

    // Live CF evidence present so claim is allowed
    assert.equal(existsSync(paths.cfEvidence), true);
    const cf = readFileSync(paths.cfEvidence, "utf8");
    assert.match(cf, /DONE_WITH_EVIDENCE|\/health/);
  });

  it("checker script exit 0 and package script wired", () => {
    const pkg = JSON.parse(readFileSync(paths.packageJson, "utf8"));
    assert.equal(typeof pkg.scripts?.["check:onboarding-proof"], "string");
    assert.match(pkg.scripts["check:onboarding-proof"], /check-onboarding-proof/);

    const r = spawnSync(
      "pnpm",
      ["exec", "tsx", "scripts/check-onboarding-proof.ts"],
      {
        cwd: root,
        encoding: "utf8",
        shell: false,
        env: { ...process.env },
      },
    );
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout, /\[check:onboarding-proof\]/);
  });

  it("BUILD_CHECKLIST BC13–15 DONE_WITH_EVIDENCE with onboarding-proof path", () => {
    const md = readFileSync(paths.buildChecklist, "utf8");
    assert.match(md, /BC13/);
    assert.match(md, /BC14/);
    assert.match(md, /BC15/);
    assert.match(md, /onboarding-proof/);
    // Each of BC13–15 should be DONE_WITH_EVIDENCE in the table
    for (const id of ["BC13", "BC14", "BC15"]) {
      const re = new RegExp(
        `\\|\\s*${id}\\s*\\|[^\\n]*DONE_WITH_EVIDENCE[^\\n]*onboarding-proof`,
      );
      assert.match(md, re, `${id} row must be DONE_WITH_EVIDENCE + onboarding-proof`);
    }
  });

  it("section doc lists named assertions", () => {
    const md = readFileSync(paths.section, "utf8");
    assert.match(md, /assert evidence bundle checklist file exists/);
    assert.match(md, /assert BC13-15 paths schema in checklist/);
    assert.match(md, /assert rejects claim without CF evidence or DEFER row/);
    assert.match(md, /N\/A/i);
  });
});
