/**
 * Section 9.1 — Docs IA and README map (Vitest).
 *
 * Named assertions from spec:
 * - assert every outline path exists as file
 * - assert linkcheck 0 broken internal links
 */
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, resolve, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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
] as const;

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

function findBrokenInternalLinks(
  files: string[],
): { file: string; target: string; resolved: string }[] {
  const linkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
  const broken: { file: string; target: string; resolved: string }[] = [];
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

describe("9.1 Docs IA and README map", () => {
  it("assert every outline path exists as file", () => {
    const missing = OUTLINE_PATHS.filter((rel) => !existsSync(join(root, rel)));
    expect(missing, `missing outline paths: ${missing.join(", ")}`).toEqual([]);
  });

  it("assert linkcheck 0 broken internal links", () => {
    const files = walkMarkdown(join(root, "docs"));
    const readme = join(root, "README.md");
    if (existsSync(readme)) files.push(readme);
    const broken = findBrokenInternalLinks(files);
    expect(
      broken,
      broken
        .map((b) => `${b.file} → ${b.target} (${b.resolved})`)
        .join("\n"),
    ).toEqual([]);
  });

  it("README 5-minute orientation links core docs", () => {
    const readme = readFileSync(join(root, "README.md"), "utf8");
    expect(readme).toMatch(/5-minute orientation/i);
    expect(readme).toMatch(/docs\/ONBOARDING\.md/);
    expect(readme).toMatch(/docs\/AGENT_SETUP\.md/);
    expect(readme).toMatch(/docs\/ARCHITECTURE\.md/);
    expect(readme).toMatch(/docs\/OPERATIONS\.md/);
    expect(readme).toMatch(/docs\/SECURITY\.md/);
    expect(readme).toMatch(/docs\/CLI\.md/);
    expect(readme).toMatch(/docs\/E2E\.md/);
  });

  it("section 9.1 note and tests are wired", () => {
    expect(existsSync(join(root, "docs/sections/9.1-docs-ia.md"))).toBe(true);
    expect(existsSync(join(root, "tests/governance/9.1-docs-ia.test.mjs"))).toBe(
      true,
    );
    const section = readFileSync(
      join(root, "docs/sections/9.1-docs-ia.md"),
      "utf8",
    );
    expect(section).toMatch(/assert every outline path exists as file/);
    expect(section).toMatch(/assert linkcheck 0 broken internal links/);
  });
});
