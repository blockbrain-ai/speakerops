/**
 * Section 9.4 — Architecture security ops docs (Vitest).
 *
 * Named assertions from spec:
 * - assert each deep doc file line count ≥ 40
 * - assert ARCHITECTURE mentions D1 and one-way Airtable
 * - assert COMPETITION lists struck items
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const DEEP_DOCS = [
  "docs/ARCHITECTURE.md",
  "docs/SECURITY.md",
  "docs/OPERATIONS.md",
  "docs/AIRTABLE.md",
  "docs/E2E.md",
  "docs/COMPETITION.md",
  "docs/TROUBLESHOOTING.md",
  "docs/FIELD_FLOW.md",
] as const;

const SECRET_PATTERNS = [
  /api[_-]?key\s*[:=]\s*["'][^"']{8,}["']/i,
  /secret\s*[:=]\s*["'][^"']{8,}["']/i,
  /password\s*[:=]\s*["'][^"']+["']/i,
  /Bearer\s+[A-Za-z0-9\-._~+/]{20,}=*/,
  /sk-[A-Za-z0-9]{20,}/,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\./,
  /CLOUDFLARE_API_TOKEN\s*=\s*["'][^"']+["']/,
  /AIRTABLE_API_KEY\s*=\s*["'][^"']+["']/,
  /spk_[A-Za-z0-9]{16,}/,
  /magic[_-]?link[^\n]{0,40}[:=]\s*['"][A-Za-z0-9]{16,}/i,
];

function lineCount(rel: string): number {
  const body = readFileSync(join(root, rel), "utf8");
  return body.split(/\r?\n/).length;
}

describe("9.4 Architecture security ops docs", () => {
  it("deliverables exist", () => {
    for (const rel of DEEP_DOCS) {
      expect(existsSync(join(root, rel)), rel).toBe(true);
    }
    expect(existsSync(join(root, "docs/sections/9.4-deep-docs.md"))).toBe(true);
    expect(
      existsSync(join(root, "tests/governance/9.4-deep-docs.test.mjs")),
    ).toBe(true);
  });

  it("assert each deep doc file line count ≥ 40", () => {
    const short: string[] = [];
    for (const rel of DEEP_DOCS) {
      const n = lineCount(rel);
      if (n < 40) short.push(`${rel} (${n} lines)`);
    }
    expect(short, `deep docs under 40 lines: ${short.join(", ")}`).toEqual([]);
  });

  it("assert ARCHITECTURE mentions D1 and one-way Airtable", () => {
    const body = readFileSync(join(root, "docs/ARCHITECTURE.md"), "utf8");
    expect(body).toMatch(/\bD1\b/);
    expect(body).toMatch(/one-way|one‑way/i);
    expect(body).toMatch(/Airtable/i);
    // Stack lock markers
    expect(body).toMatch(/system of record|SoR/i);
    expect(body).toMatch(/dual-write|dual write/i);
  });

  it("assert COMPETITION lists struck items", () => {
    const body = readFileSync(join(root, "docs/COMPETITION.md"), "utf8");
    expect(body).toMatch(/struck/i);
    // Struck brief / non-goals called out
    expect(body).toMatch(/OR-Tools|OR‑Tools/i);
    expect(body).toMatch(/dual-write|dual write/i);
    expect(body).toMatch(/Next\.?js|RSC/i);
    expect(body).toMatch(/agent fleet|multi-agent/i);
    expect(body).toMatch(/Sessionboard|CRM/i);
    // Brief features 1–6 mapped
    expect(body).toMatch(/CFP|form builder/i);
    expect(body).toMatch(/portal/i);
    expect(body).toMatch(/schedule/i);
    expect(body).toMatch(/readiness/i);
  });

  it("SECURITY matches E10", () => {
    const body = readFileSync(join(root, "docs/SECURITY.md"), "utf8");
    expect(body).toMatch(/E10/);
    expect(body).toMatch(/HttpOnly/i);
    expect(body).toMatch(/Content-Security-Policy|CSP/);
    expect(body).toMatch(/names only|env \*\*names\*\*|variable names only/i);
    expect(body).toMatch(/401/);
    expect(body).toMatch(/403/);
    expect(body).toMatch(/no stack|without stack/i);
  });

  it("no secret values in deep docs", () => {
    const scan = [
      ...DEEP_DOCS,
      "docs/sections/9.4-deep-docs.md",
    ];
    for (const rel of scan) {
      const body = readFileSync(join(root, rel), "utf8");
      for (const re of SECRET_PATTERNS) {
        expect(body, `${rel} secret pattern ${re}`).not.toMatch(re);
      }
    }
  });

  it("section 9.4 note declares N/A product surface and named tests", () => {
    const section = readFileSync(
      join(root, "docs/sections/9.4-deep-docs.md"),
      "utf8",
    );
    expect(section).toMatch(/N\/A/i);
    expect(section).toMatch(
      /no new product HTTP handlers|No new product HTTP handlers/i,
    );
    expect(section).toMatch(/assert each deep doc file line count/);
    expect(section).toMatch(/assert ARCHITECTURE mentions D1/);
    expect(section).toMatch(/assert COMPETITION lists struck items/);
    expect(section).toMatch(/S-DOCS/);
    expect(section).toMatch(/9\.4/);
  });

  it("FIELD_FLOW and AIRTABLE are non-stub structured content", () => {
    const field = readFileSync(join(root, "docs/FIELD_FLOW.md"), "utf8");
    const airtable = readFileSync(join(root, "docs/AIRTABLE.md"), "utf8");
    expect(field).toMatch(/I16|form/i);
    expect(field).toMatch(/portal/i);
    expect(field).toMatch(/Person|participation/i);
    expect(airtable).toMatch(/one-way|one‑way/i);
    expect(airtable).toMatch(/internal_id/);
    expect(airtable).toMatch(/outbox|pause/i);
  });
});
