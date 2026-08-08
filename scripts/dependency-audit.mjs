#!/usr/bin/env node
/**
 * Dependency audit gate (section 8.3 — supply chain / E10).
 *
 * Policy (docs/SECURITY.md + docs/sections/8.3-security-hardening.md):
 * - Run `pnpm audit` (npm audit fallback) against the committed lockfile.
 * - Fail the process on **high** or **critical** severity findings.
 * - Moderate/low are reported but do not fail the dogfood gate.
 * - Never print secret env values; audit only uses registry metadata.
 *
 * Usage:
 *   pnpm run audit:deps
 *   node scripts/dependency-audit.mjs
 *   node scripts/dependency-audit.mjs --json
 *
 * Exit codes: 0 = pass (no high/critical), 1 = policy fail, 2 = tool error.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wantJson = process.argv.includes("--json");

/** Fail on high and above (critical included). */
const AUDIT_LEVEL = "high";

/**
 * Documented policy object — governance tests assert these fields exist
 * in this file and in docs/SECURITY.md.
 */
export const DEPENDENCY_AUDIT_POLICY = {
  tool: "pnpm audit (npm audit fallback)",
  failOn: ["high", "critical"],
  auditLevel: AUDIT_LEVEL,
  lockfileRequired: true,
  docs: ["docs/SECURITY.md", "docs/sections/8.3-security-hardening.md"],
};

function run(cmd, args) {
  return spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
}

function hasPnpm() {
  return run("pnpm", ["--version"]).status === 0;
}

/**
 * Count high/critical from pnpm/npm audit JSON shapes.
 */
function countHighCritical(auditJson) {
  let high = 0;
  let critical = 0;

  const meta = auditJson?.metadata?.vulnerabilities;
  if (meta && typeof meta === "object") {
    high = Number(meta.high ?? 0) || 0;
    critical = Number(meta.critical ?? 0) || 0;
    return { high, critical };
  }

  const advisories = auditJson?.advisories;
  if (advisories && typeof advisories === "object") {
    for (const adv of Object.values(advisories)) {
      const sev = String(adv?.severity ?? "").toLowerCase();
      if (sev === "critical") critical += 1;
      else if (sev === "high") high += 1;
    }
    return { high, critical };
  }

  const vulns = auditJson?.vulnerabilities;
  if (vulns && typeof vulns === "object") {
    for (const v of Object.values(vulns)) {
      const sev = String(v?.severity ?? "").toLowerCase();
      if (sev === "critical") critical += 1;
      else if (sev === "high") high += 1;
    }
    return { high, critical };
  }

  return { high: 0, critical: 0 };
}

function parseAuditJson(stdout) {
  const start = stdout.indexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(stdout.slice(start));
  } catch {
    return null;
  }
}

function main() {
  const hasLock =
    existsSync(join(root, "pnpm-lock.yaml")) ||
    existsSync(join(root, "package-lock.json"));
  if (!hasLock) {
    console.error(
      "[audit:deps] No lockfile found (pnpm-lock.yaml or package-lock.json). " +
        "Commit a lockfile before running the audit policy.",
    );
    process.exit(2);
  }

  const usePnpm = hasPnpm();
  const cmd = usePnpm ? "pnpm" : "npm";
  const args = ["audit", "--json", `--audit-level=${AUDIT_LEVEL}`];
  const result = run(cmd, args);
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const parsed = parseAuditJson(stdout);

  if (!parsed) {
    if (result.status === 0) {
      const ok = {
        ok: true,
        tool: cmd,
        auditLevel: AUDIT_LEVEL,
        high: 0,
        critical: 0,
        message: "Audit clean (no high/critical; empty or zero report).",
        policy: DEPENDENCY_AUDIT_POLICY,
      };
      if (wantJson) console.log(JSON.stringify(ok, null, 2));
      else console.log(`[audit:deps] PASS — ${ok.message}`);
      process.exit(0);
    }
    console.error(
      `[audit:deps] Failed to parse ${cmd} audit JSON (exit ${result.status}).`,
    );
    if (stderr.trim()) console.error(stderr.slice(0, 2000));
    if (stdout.trim()) console.error(stdout.slice(0, 2000));
    process.exit(2);
  }

  const { high, critical } = countHighCritical(parsed);
  const fail = high > 0 || critical > 0;
  const summary = {
    ok: !fail,
    tool: cmd,
    auditLevel: AUDIT_LEVEL,
    high,
    critical,
    policy: DEPENDENCY_AUDIT_POLICY,
  };

  if (wantJson) {
    console.log(JSON.stringify(summary, null, 2));
  } else if (fail) {
    console.error(
      `[audit:deps] FAIL — high=${high} critical=${critical} (policy: fail on high/critical).`,
    );
    console.error(
      `[audit:deps] Re-run: ${cmd} audit --audit-level=${AUDIT_LEVEL}`,
    );
  } else {
    console.log(
      `[audit:deps] PASS — high=${high} critical=${critical} (threshold: high).`,
    );
  }

  process.exit(fail ? 1 : 0);
}

main();
