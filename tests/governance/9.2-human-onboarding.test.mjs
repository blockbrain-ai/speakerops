/**
 * Section 9.2 — Human onboarding path (node:test / test:ci).
 *
 * Named assertions from spec:
 * - assert ONBOARDING has numbered steps ≥10
 * - assert env names table has no values matching sk- or eyJ
 * - assert demo path mentions CFP and schedule
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const onboardingPath = join(root, "docs/ONBOARDING.md");
const sectionPath = join(root, "docs/sections/9.2-human-onboarding.md");

const SECRET_PATTERNS = [
  /api[_-]?key\s*[:=]\s*["'][^"']{8,}["']/i,
  /secret\s*[:=]\s*["'][^"']{8,}["']/i,
  /password\s*[:=]\s*["'][^"']+["']/i,
  /Bearer\s+[A-Za-z0-9\-._~+/]{20,}=*/,
  /sk-[A-Za-z0-9]{20,}/,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/,
  /CLOUDFLARE_API_TOKEN\s*=\s*["'][^"']+["']/,
  /AIRTABLE_API_KEY\s*=\s*["'][^"']+["']/,
  /spk_[A-Za-z0-9]{16,}/,
  /magic[_-]?link[^\n]{0,40}[:=]\s*['"][A-Za-z0-9]{16,}/i,
];

/**
 * Count numbered checklist steps (### N. Title preferred).
 * @param {string} body
 */
function countNumberedSteps(body) {
  const headingSteps = new Set();
  const headingRe = /^#{2,4}\s+(\d+)\.\s+\S/gm;
  let m;
  while ((m = headingRe.exec(body))) {
    headingSteps.add(Number(m[1]));
  }
  if (headingSteps.size >= 10) return headingSteps.size;

  const listSteps = new Set();
  const listRe = /^\s*(\d+)\.\s+\S/gm;
  while ((m = listRe.exec(body))) {
    listSteps.add(Number(m[1]));
  }
  return Math.max(headingSteps.size, listSteps.size);
}

/**
 * @param {string} body
 * @returns {string[]}
 */
function envTableRows(body) {
  const rows = [];
  const lines = body.split("\n");
  let inEnvTable = false;
  for (const line of lines) {
    if (/^\|.*\bName\b.*\|/i.test(line) && /Required|Purpose|for/i.test(line)) {
      inEnvTable = true;
      continue;
    }
    if (inEnvTable) {
      if (!line.trim().startsWith("|")) {
        inEnvTable = false;
        continue;
      }
      if (/^\|[\s\-:|]+\|$/.test(line.trim())) continue;
      rows.push(line);
    }
  }
  return rows;
}

describe("9.2 Human onboarding path", () => {
  it("assert ONBOARDING has numbered steps ≥10", () => {
    assert.ok(existsSync(onboardingPath), "docs/ONBOARDING.md must exist");
    const body = readFileSync(onboardingPath, "utf8");
    const n = countNumberedSteps(body);
    assert.ok(
      n >= 10,
      `ONBOARDING must have ≥10 numbered steps, found ${n}`,
    );
    assert.match(
      body,
      /<90\s*m|under\s+90|90\s*minutes|≤\s*90|&lt;90/i,
      "timebox target e.g. <90m must be stated",
    );
    assert.match(body, /S-ONB-HUMAN/, "soul S-ONB-HUMAN required");
    assert.match(
      body,
      /Timed checklist|timed checklist|Timebox/i,
      "timed checklist framing required",
    );
    // In-scope topics present
    assert.match(body, /Prerequisite|Prerequisites/i);
    assert.match(body, /wrangler/i);
    assert.match(body, /db:migrate|migrate/i);
    assert.match(body, /\bseed\b/i);
    assert.match(body, /first admin|BOOTSTRAP_ADMIN_EMAIL/i);
    assert.match(body, /test:e2e/);
    assert.match(body, /Airtable/i);
  });

  it("assert env names table has no values matching sk- or eyJ", () => {
    const body = readFileSync(onboardingPath, "utf8");
    assert.doesNotMatch(body, /\bsk-[A-Za-z0-9]{10,}/);
    assert.doesNotMatch(body, /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/);

    const rows = envTableRows(body);
    assert.ok(rows.length > 0, "env names table must have data rows");
    for (const row of rows) {
      assert.doesNotMatch(row, /\bsk-[A-Za-z0-9]{10,}/, row);
      assert.doesNotMatch(row, /\beyJ[A-Za-z0-9_-]{10,}/, row);
      assert.match(
        row,
        /`[A-Z][A-Z0-9_]+`|[A-Z][A-Z0-9_]{2,}/,
        `row must name an env variable: ${row}`,
      );
    }
    assert.match(
      body,
      /names only|variable names only|Env \*\*names\*\*/i,
    );

    for (const re of SECRET_PATTERNS) {
      assert.doesNotMatch(
        body,
        re,
        `ONBOARDING must not contain secret pattern ${re}`,
      );
    }
  });

  it("assert demo path mentions CFP and schedule", () => {
    const body = readFileSync(onboardingPath, "utf8");
    assert.match(body, /Demo path|demo path/);
    assert.match(body, /CFP|public CFP|\/cfp\//i);
    assert.match(body, /schedule|Schedule/i);
    assert.match(body, /eval|portal|readiness/i);
  });

  it("section 9.2 note wires AC → proof and N/A product surface", () => {
    assert.ok(existsSync(sectionPath), "section note must exist");
    const section = readFileSync(sectionPath, "utf8");
    assert.match(section, /N\/A/i);
    assert.match(section, /no new product HTTP handlers|No new routes/i);
    assert.match(section, /assert ONBOARDING has numbered steps/);
    assert.match(section, /assert env names table has no values matching sk-/);
    assert.match(section, /assert demo path mentions CFP and schedule/);
    assert.match(section, /S-ONB-HUMAN/);
    assert.match(section, /9\.2/);
  });

  it("no secrets in section note", () => {
    const section = readFileSync(sectionPath, "utf8");
    for (const re of SECRET_PATTERNS) {
      assert.doesNotMatch(
        section,
        re,
        `section note must not contain secret pattern ${re}`,
      );
    }
  });
});
