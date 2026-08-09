/**
 * Section 9.1 — Docs IA and README map (node:test / test:ci).
 *
 * Named assertions from spec:
 * - assert every outline path exists as file
 * - assert linkcheck 0 broken internal links
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, resolve, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Phase 9 markdown / root leaves from 0.5 outline (docs IA scope). */
const OUTLINE_PATHS = [
  "README.md",
  "docs/ONBOARDING.md",
  "docs/AGENT_SETUP.md",
  "docs/ARCHITECTURE.md",
  "docs/SECURITY.md",
  "docs/CLI.md",
  "docs/OPERATIONS.md",
  "docs/AIRTABLE.md",
  "docs/E2E.md",
  "docs/COMPETITION.md",
  "docs/TROUBLESHOOTING.md",
  "docs/FIELD_FLOW.md",
  "docs/CONTRACTS.md",
  "docs/governance/0.1-programme-contract.md",
  "docs/governance/0.2-lumen-lock.md",
  "docs/governance/0.3-e2e-inventory-law.md",
  "docs/governance/0.4-domain-map.md",
  "docs/governance/0.5-docs-onboarding-outline.md",
  "docs/sections/9.1-docs-ia.md",
];

const SECRET_PATTERNS = [
  /api[_-]?key\s*[:=]\s*["'][^"']{8,}["']/i,
  /secret\s*[:=]\s*["'][^"']{8,}["']/i,
  /password\s*[:=]\s*["'][^"']+["']/i,
  /Bearer\s+[A-Za-z0-9\-._~+/]{20,}=*/,
  /sk-[A-Za-z0-9]{20,}/,
  /CLOUDFLARE_API_TOKEN\s*=\s*["'][^"']+["']/,
  /AIRTABLE_API_KEY\s*=\s*["'][^"']+["']/,
  /spk_[A-Za-z0-9]{16,}/,
  /magic[_-]?link[^\n]{0,40}[:=]\s*['"][A-Za-z0-9]{16,}/i,
];

/**
 * Walk markdown files under docs/ plus root README for linkcheck.
 * @param {string} dir
 * @param {string[]} acc
 */
function walkMarkdown(dir, acc = []) {
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

/**
 * Collect broken relative markdown links (file targets only).
 * @param {string[]} files absolute paths
 * @returns {{ file: string, target: string, resolved: string }[]}
 */
function findBrokenInternalLinks(files) {
  const linkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
  const broken = [];
  for (const file of files) {
    const body = readFileSync(file, "utf8");
    let m;
    while ((m = linkRe.exec(body))) {
      let target = m[2].trim();
      // strip optional title: (url "title")
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
      if (!pathPart) continue;
      // skip pure query / data
      if (pathPart.startsWith("data:")) continue;
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

describe("9.1 Docs IA and README map", () => {
  it("assert every outline path exists as file", () => {
    const missing = [];
    for (const rel of OUTLINE_PATHS) {
      const p = join(root, rel);
      if (!existsSync(p)) missing.push(rel);
    }
    assert.deepEqual(
      missing,
      [],
      `outline paths missing (0.5 tree): ${missing.join(", ")}`,
    );
  });

  it("assert linkcheck 0 broken internal links", () => {
    const files = walkMarkdown(join(root, "docs"));
    const readme = join(root, "README.md");
    if (existsSync(readme)) files.push(readme);
    const broken = findBrokenInternalLinks(files);
    assert.equal(
      broken.length,
      0,
      `broken internal links:\n${broken
        .map((b) => `  ${b.file} → ${b.target} (resolved ${b.resolved})`)
        .join("\n")}`,
    );
  });

  it("README has 5-minute orientation and docs map links", () => {
    const readme = readFileSync(join(root, "README.md"), "utf8");
    assert.match(
      readme,
      /5-minute orientation|5-minute Orientation/i,
      "README must include 5-minute orientation",
    );
    assert.match(readme, /docs\/ONBOARDING\.md/, "README must link ONBOARDING");
    assert.match(
      readme,
      /docs\/AGENT_SETUP\.md/,
      "README must link AGENT_SETUP",
    );
    assert.match(
      readme,
      /docs\/ARCHITECTURE\.md/,
      "README must link ARCHITECTURE",
    );
    assert.match(readme, /S-ONB-HUMAN|S-ONB-AGENT|S-DOCS/, "souls in map");
    // Map should surface the IA section note
    assert.match(
      readme,
      /9\.1-docs-ia\.md|Docs map|docs map/i,
      "README must present docs map / 9.1",
    );
  });

  it("section doc declares N/A product surface and named tests", () => {
    const section = readFileSync(
      join(root, "docs/sections/9.1-docs-ia.md"),
      "utf8",
    );
    assert.match(section, /N\/A/i);
    assert.match(section, /no new product HTTP handlers|no new routes/i);
    assert.match(section, /assert every outline path exists as file/);
    assert.match(section, /assert linkcheck 0 broken internal links/);
    assert.match(section, /S-DOCS/);
  });

  it("stubs name purpose and owning phase sections", () => {
    const stubs = [
      ["docs/ONBOARDING.md", /S-ONB-HUMAN|9\.2/],
      ["docs/AGENT_SETUP.md", /S-ONB-AGENT|9\.3/],
      ["docs/ARCHITECTURE.md", /Purpose|9\.4/],
      ["docs/AIRTABLE.md", /one-way|projection/i],
      ["docs/FIELD_FLOW.md", /FIELD_FLOW|I16|form/i],
      ["docs/COMPETITION.md", /non-goal/i],
      ["docs/TROUBLESHOOTING.md", /Purpose|recover/i],
    ];
    for (const [rel, re] of stubs) {
      const body = readFileSync(join(root, rel), "utf8");
      assert.match(body, /Purpose/i, `${rel} must have purpose blurb`);
      assert.match(body, re, `${rel} must match ${re}`);
    }
  });

  it("no secrets or magic-link tokens in 9.1 docs surface", () => {
    const scan = [
      "README.md",
      "docs/ONBOARDING.md",
      "docs/AGENT_SETUP.md",
      "docs/ARCHITECTURE.md",
      "docs/AIRTABLE.md",
      "docs/COMPETITION.md",
      "docs/TROUBLESHOOTING.md",
      "docs/FIELD_FLOW.md",
      "docs/sections/9.1-docs-ia.md",
    ];
    for (const rel of scan) {
      const body = readFileSync(join(root, rel), "utf8");
      for (const re of SECRET_PATTERNS) {
        assert.doesNotMatch(
          body,
          re,
          `${rel} must not contain secret pattern ${re}`,
        );
      }
    }
    // Env names only rule stated somewhere in stubs / section
    const onboarding = readFileSync(join(root, "docs/ONBOARDING.md"), "utf8");
    assert.match(
      onboarding,
      /names only|variable names only|env \*\*names\*\* only/i,
    );
  });
});
