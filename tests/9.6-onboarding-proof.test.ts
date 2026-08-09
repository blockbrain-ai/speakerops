/**
 * Section 9.6 — Onboarding proof keystone (Vitest).
 *
 * Named assertions from spec:
 * - assert evidence bundle checklist file exists
 * - assert BC13-15 paths schema in checklist
 * - assert rejects claim without CF evidence or DEFER row
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  checkOnboardingProof,
  evaluateCfClaimGate,
  evaluateBuildChecklistEndCheck,
  parseBcPathsSchema,
  parseBuildChecklistBcStatus,
  EVIDENCE_DIR_REL,
  CHECKLIST_FILE,
  REQUIRED_BUNDLE_FILES,
  BC_ROWS,
  BUILD_CHECKLIST_BC_IDS,
  hasCfDeferRow,
  isCfEvidenceDone,
} from "../scripts/check-onboarding-proof.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = join(root, EVIDENCE_DIR_REL);
const checklistPath = join(evidenceDir, CHECKLIST_FILE);
const sectionDoc = join(root, "docs", "sections", "9.6-onboarding-proof.md");
const packageJsonPath = join(root, "package.json");
const scriptPath = join(root, "scripts", "check-onboarding-proof.ts");
const buildChecklist = join(
  root,
  "KMS-competition",
  "initiative",
  "BUILD_CHECKLIST.md",
);

describe("9.6 Onboarding proof keystone", () => {
  it("assert evidence bundle checklist file exists", () => {
    expect(existsSync(checklistPath), checklistPath).toBe(true);
    for (const name of REQUIRED_BUNDLE_FILES) {
      const p = join(evidenceDir, name);
      expect(existsSync(p), `missing bundle file ${name}`).toBe(true);
    }
    const body = readFileSync(checklistPath, "utf8");
    expect(body).toMatch(/S-ONB-HUMAN/);
    expect(body).toMatch(/S-ONB-AGENT/);
    expect(body).toMatch(/S-DOCS/);
    expect(body).toMatch(/no tribal steps/i);
    expect(body).toMatch(/BC13/);
    expect(body).toMatch(/human-dry-run\.txt/);
    expect(body).toMatch(/agent-dry-run\.txt/);
  });

  it("assert BC13-15 paths schema in checklist", () => {
    const body = readFileSync(checklistPath, "utf8");
    const schema = parseBcPathsSchema(body);
    expect(
      schema.ok,
      schema.errors.join("; ") || "BC13-15 schema",
    ).toBe(true);
    for (const row of BC_ROWS) {
      expect(schema.found[row.id]?.status).toMatch(
        /DONE_WITH_EVIDENCE|OWNER_AMEND/,
      );
      expect(body).toMatch(new RegExp(row.soul));
      expect(body).toMatch(row.evidenceFile);
      for (const src of row.sourcePaths) {
        expect(existsSync(join(root, src)), src).toBe(true);
      }
      expect(existsSync(join(evidenceDir, row.evidenceFile))).toBe(true);
    }
    // DONE paths table keywords
    expect(body).toMatch(/Evidence path/i);
    expect(body).toMatch(/Source path/i);
    expect(body).toMatch(/DONE_WITH_EVIDENCE/);
  });

  it("assert rejects claim without CF evidence or DEFER row", () => {
    // Pure gate: no evidence, no DEFER → reject
    const rejected = evaluateCfClaimGate({
      claim: true,
      cfEvidenceBody: null,
      checklistOrStatusBody: "BC13 DONE_WITH_EVIDENCE only — no CF",
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toMatch(/CF evidence or DEFER/i);

    // Empty evidence body that is not DONE
    const rejected2 = evaluateCfClaimGate({
      claim: true,
      cfEvidenceBody: "placeholder without health",
      checklistOrStatusBody: "no defer here",
    });
    expect(rejected2.ok).toBe(false);

    // DEFER row accepts without CF file
    const deferred = evaluateCfClaimGate({
      claim: true,
      cfEvidenceBody: null,
      checklistOrStatusBody: "| BC10 | S-CF | DEFER | owner waiver |\n",
    });
    expect(deferred.ok).toBe(true);
    expect(hasCfDeferRow("| BC10 | S-CF | DEFER | owner waiver |")).toBe(true);

    // Inactive fenced DEFER examples must not count as a waiver
    const fencedExamples = [
      "# DEFER schema (inactive — documentation only)",
      "",
      "Current status is **not** DEFER.",
      "",
      "```text",
      "BC10 status: DEFER",
      "S-CF status: DEFER",
      "```",
      "",
      "Do not treat prose mentions of the word DEFER as an active waiver.",
    ].join("\n");
    expect(hasCfDeferRow(fencedExamples)).toBe(false);
    expect(
      evaluateCfClaimGate({
        claim: true,
        cfEvidenceBody: null,
        checklistOrStatusBody: fencedExamples,
      }).ok,
    ).toBe(false);

    // Committed cf-status.txt alone (examples only) must not green-wash missing CF
    const liveCfStatus = readFileSync(
      join(evidenceDir, "cf-status.txt"),
      "utf8",
    );
    // When live evidence exists, status file may still contain inactive fences
    expect(hasCfDeferRow(liveCfStatus)).toBe(false);

    // DONE_WITH_EVIDENCE CF file accepts
    const done = evaluateCfClaimGate({
      claim: true,
      cfEvidenceBody:
        "Status: DONE_WITH_EVIDENCE\nGET /health → 200\nredaction rules\n",
      checklistOrStatusBody: "S-CF evidence present",
    });
    expect(done.ok).toBe(true);
    expect(
      isCfEvidenceDone(
        "Status: DONE_WITH_EVIDENCE\nGET /health 200\nURL redaction rules",
      ),
    ).toBe(true);

    // Full checker with overrides must exit 2 (claim gate)
    const result = checkOnboardingProof({
      root,
      claim: true,
      cfEvidenceBodyOverride: null,
      cfStatusBodyOverride: "no defer for S-CF",
      checklistBodyOverride: readFileSync(checklistPath, "utf8"),
      skipBundleFileExistence: true,
      skipArtifactExistence: true,
      skipLinkcheck: true,
      skipBuildChecklistEndCheck: true,
      writeLinkcheck: false,
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(
      result.errors.some((e) => e.code === "CF_CLAIM_GATE"),
    ).toBe(true);

    // Committed cf-status fenced examples + missing CF → claim gate fail (not defer waiver)
    const withFencedStatus = checkOnboardingProof({
      root,
      claim: true,
      cfEvidenceBodyOverride: null,
      cfStatusBodyOverride: liveCfStatus,
      checklistBodyOverride: readFileSync(checklistPath, "utf8"),
      skipBundleFileExistence: true,
      skipArtifactExistence: true,
      skipLinkcheck: true,
      skipBuildChecklistEndCheck: true,
      writeLinkcheck: false,
    });
    expect(withFencedStatus.exitCode).toBe(2);
    expect(
      withFencedStatus.errors.some((e) => e.code === "CF_CLAIM_GATE"),
    ).toBe(true);
  });

  it("BUILD_CHECKLIST end-check requires BC01–BC15 DONE_WITH_EVIDENCE or OWNER_AMEND", () => {
    const openBody = [
      "# BUILD_CHECKLIST",
      "",
      "**End-check before CLAIM_PROVEN:** all rows DONE_WITH_EVIDENCE or OWNER_AMEND.",
      "",
      "| id | soul_ref | done_when | evidence_expected | status | evidence_path | notes |",
      "|----|----------|-----------|-------------------|--------|---------------|-------|",
      ...BUILD_CHECKLIST_BC_IDS.map(
        (id) =>
          `| ${id} | S-X | x | y | ${id === "BC01" ? "OPEN" : "DONE_WITH_EVIDENCE"} | | |`,
      ),
    ].join("\n");
    const open = evaluateBuildChecklistEndCheck({
      buildChecklistBody: openBody,
    });
    expect(open.ok).toBe(false);
    expect(open.errors.some((e) => /BC01/.test(e))).toBe(true);
    expect(parseBuildChecklistBcStatus(openBody, "BC01")).toBe("OPEN");

    const allDone = evaluateBuildChecklistEndCheck({
      buildChecklistBody: openBody.replace(
        "| BC01 | S-X | x | y | OPEN | | |",
        "| BC01 | S-X | x | y | DONE_WITH_EVIDENCE | | |",
      ),
    });
    expect(allDone.ok).toBe(true);

    // Checker surfaces OPEN rows (not claim-safe)
    const result = checkOnboardingProof({
      root,
      claim: true,
      cfEvidenceBodyOverride:
        "Status: DONE_WITH_EVIDENCE\nGET /health → 200\nredaction\n",
      cfStatusBodyOverride: "CF done",
      checklistBodyOverride: readFileSync(checklistPath, "utf8"),
      buildChecklistBodyOverride: openBody,
      skipBundleFileExistence: true,
      skipArtifactExistence: true,
      skipLinkcheck: true,
      writeLinkcheck: false,
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(
      result.errors.some((e) => e.code === "BUILD_CHECKLIST_END_CHECK"),
    ).toBe(true);
  });

  it("live checker exits 0 on workspace evidence bundle", () => {
    const result = checkOnboardingProof({
      root,
      claim: true,
      writeLinkcheck: true,
    });
    expect(
      result.ok,
      result.errors.map((e) => e.message).join("\n"),
    ).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.linkcheckBroken).toBe(0);
  });

  it("pnpm check:onboarding-proof wires script and exits 0", () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["check:onboarding-proof"]).toMatch(
      /check-onboarding-proof/,
    );
    expect(existsSync(scriptPath)).toBe(true);
    expect(existsSync(sectionDoc)).toBe(true);

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
    expect(r.status, r.stderr || r.stdout).toBe(0);
    expect(r.stdout).toMatch(/\[check:onboarding-proof\]/);
  });

  it("BUILD_CHECKLIST BC13–15 point at onboarding-proof evidence", () => {
    const md = readFileSync(buildChecklist, "utf8");
    expect(md).toMatch(/BC13/);
    expect(md).toMatch(/BC14/);
    expect(md).toMatch(/BC15/);
    expect(md).toMatch(/S-ONB-HUMAN/);
    expect(md).toMatch(/S-ONB-AGENT/);
    expect(md).toMatch(/S-DOCS/);
    expect(md).toMatch(/onboarding-proof/);
    expect(md).toMatch(/DONE_WITH_EVIDENCE/);
    // End-check: every BC01–BC15 closed for claim-safe
    const end = evaluateBuildChecklistEndCheck({ buildChecklistBody: md });
    expect(
      end.ok,
      end.errors.join("; ") || "BUILD_CHECKLIST end-check",
    ).toBe(true);
    for (const id of BUILD_CHECKLIST_BC_IDS) {
      expect(end.statuses[id]).toMatch(/DONE_WITH_EVIDENCE|OWNER_AMEND/);
    }
  });

  it("section doc maps named assertions and N/A handlers", () => {
    const md = readFileSync(sectionDoc, "utf8");
    expect(md).toMatch(/9\.6/);
    expect(md).toMatch(/S-ONB-HUMAN/);
    expect(md).toMatch(/S-ONB-AGENT/);
    expect(md).toMatch(/S-DOCS/);
    expect(md).toMatch(/S-CF/);
    expect(md).toMatch(/assert evidence bundle checklist file exists/);
    expect(md).toMatch(/assert BC13-15 paths schema in checklist/);
    expect(md).toMatch(
      /assert rejects claim without CF evidence or DEFER row/,
    );
    expect(md).toMatch(/N\/A/i);
    expect(md).toMatch(/no new product HTTP handlers/i);
  });

  it("human and agent dry-run logs have no tribal steps and no secrets", () => {
    const human = readFileSync(
      join(evidenceDir, "human-dry-run.txt"),
      "utf8",
    );
    const agent = readFileSync(
      join(evidenceDir, "agent-dry-run.txt"),
      "utf8",
    );
    expect(human).toMatch(/S-ONB-HUMAN|BC13/);
    expect(human).toMatch(/ONBOARDING\.md/);
    expect(human).toMatch(/tribal/i);
    expect(agent).toMatch(/S-ONB-AGENT|BC14/);
    expect(agent).toMatch(/AGENT_SETUP\.md/);
    expect(agent).toMatch(/FORBIDDEN|exit 2|deny/i);
    expect(agent).toMatch(/\[REDACTED_KEY\]|redact/i);
    for (const body of [human, agent]) {
      expect(body).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
      expect(body).not.toMatch(/Bearer\s+[A-Za-z0-9\-._~+/]{20,}/);
      expect(body).not.toMatch(/spk_[A-Za-z0-9]{20,}/);
    }
  });
});
