/**
 * Section 11.8 — Visual suite + taste score ≥8.0 (S-L2-SCORE).
 *
 * Gates:
 * - visual_lumen2.spec.ts exists with nine artifact classes + authz negative
 * - LUMEN2_TASTE_SCORE.md overall ≥ 8.0 and no primary surface < 7.0
 * - LUMEN2_QA_EVIDENCE.md documents suite + QA checklist
 * - package.json exposes test:e2e:visual
 * - no new apps/web runtime UI dependencies introduced for this section
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const visualSpec = join(root, "playwright", "e2e", "visual_lumen2.spec.ts");
const tasteScore = join(root, "docs", "audits", "LUMEN2_TASTE_SCORE.md");
const qaEvidence = join(root, "docs", "audits", "LUMEN2_QA_EVIDENCE.md");
const packageJson = join(root, "package.json");
const webPackageJson = join(root, "apps", "web", "package.json");
const livability = join(
  root,
  "initiative",
  "PHASE10_11_GAP_CLOSE",
  "02_LIVABILITY_MATRIX.md",
);

const NINE_CLASSES = [
  "state sheet",
  "overview",
  "cfp builder",
  "public cfp",
  "submissions",
  "schedule",
  "comms",
  "portal",
  "error",
];

describe("11.8 visual score gates (S-L2-SCORE)", () => {
  it("visual_lumen2.spec.ts exists and names nine artifact classes", () => {
    assert.equal(existsSync(visualSpec), true, "visual_lumen2.spec.ts must exist");
    const src = readFileSync(visualSpec, "utf8");
    assert.match(src, /AC-11\.8-SUITE/);
    assert.match(src, /AC-11\.8-AUTHZ/);
    assert.match(src, /AC-11\.8-SCORE/);
    assert.match(src, /docs\/audits\/visual-lumen2/);
    assert.match(src, /01-state-sheet/);
    assert.match(src, /02-overview/);
    assert.match(src, /03-cfp-builder/);
    assert.match(src, /04-public-cfp/);
    assert.match(src, /05-submissions-bulk/);
    assert.match(src, /06-schedule-conflict/);
    assert.match(src, /07-comms-audience/);
    assert.match(src, /08-portal/);
    assert.match(src, /09-error-states/);
    assert.match(src, /1440/);
    assert.match(src, /390/);
    // must-not unauthenticated admin
    assert.match(src, /unauthenticated/i);
    assert.match(src, /admin-shell/);
  });

  it("LUMEN2_TASTE_SCORE.md overall ≥ 8.0 and no primary < 7.0", () => {
    assert.equal(existsSync(tasteScore), true, "LUMEN2_TASTE_SCORE.md must exist");
    const body = readFileSync(tasteScore, "utf8");

    const overall = body.match(
      /\*\*Overall(?: weighted)? score:\*\*\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*10/i,
    );
    assert.ok(overall, "must declare **Overall score:** N / 10");
    const overallN = Number(overall[1]);
    assert.ok(
      overallN >= 8.0,
      `overall score ${overallN} must be ≥ 8.0 (fail section if lower)`,
    );

    const primaryBlock = body.match(
      /## Primary surface scores[\s\S]*?(?=\n## |$)/i,
    );
    assert.ok(primaryBlock, "must have ## Primary surface scores section");

    const rowRe = /^\|\s*([^|]+?)\s*\|\s*([0-9]+(?:\.[0-9]+)?)\s*\|/gm;
    let m;
    let rows = 0;
    const below = [];
    while ((m = rowRe.exec(primaryBlock[0])) !== null) {
      const label = m[1].trim();
      if (/^-+$/.test(label) || /surface/i.test(label)) continue;
      const score = Number(m[2]);
      rows += 1;
      if (score < 7.0) below.push(`${label}=${score}`);
    }
    assert.ok(rows >= 9, `expected ≥9 primary surface rows, got ${rows}`);
    assert.equal(
      below.length,
      0,
      `primary surfaces below 7.0: ${below.join(", ")}`,
    );

    // Critical set called out in design audit exit gate
    for (const name of ["Overview", "Communications", "Public CFP", "Schedule"]) {
      assert.match(
        body,
        new RegExp(name, "i"),
        `taste score must rate primary surface: ${name}`,
      );
    }
  });

  it("LUMEN2_QA_EVIDENCE.md covers visual suite and QA checklist", () => {
    assert.equal(existsSync(qaEvidence), true, "LUMEN2_QA_EVIDENCE.md must exist");
    const body = readFileSync(qaEvidence, "utf8");
    assert.match(body, /11\.8/);
    assert.match(body, /visual-lumen2/);
    assert.match(body, /LUMEN2_TASTE_SCORE/);
    assert.match(body, /Nine artifact|nine artifact/i);
    assert.match(body, /QA checklist/i);
    assert.match(body, /Stack safety/i);
    assert.match(body, /No new UI runtime deps/i);
    for (const cls of NINE_CLASSES) {
      assert.match(
        body.toLowerCase(),
        new RegExp(cls.toLowerCase()),
        `QA evidence should mention artifact class: ${cls}`,
      );
    }
  });

  it("package.json exposes test:e2e:visual wired to visual_lumen2.spec.ts", () => {
    const pkg = JSON.parse(readFileSync(packageJson, "utf8"));
    assert.ok(pkg.scripts?.["test:e2e:visual"], "test:e2e:visual script required");
    assert.match(
      pkg.scripts["test:e2e:visual"],
      /visual_lumen2\.spec\.ts/,
    );
  });

  it("livability matrix maps S-L2-SCORE to visual_lumen2 + taste score", () => {
    assert.equal(existsSync(livability), true);
    const body = readFileSync(livability, "utf8");
    assert.match(body, /S-L2-SCORE/);
    assert.match(body, /visual_lumen2\.spec\.ts/);
    assert.match(body, /LUMEN2_TASTE_SCORE\.md/);
    assert.match(body, /11\.8/);
  });

  it("apps/web package.json has no new UI kit / icon / chart / font runtime deps", () => {
    const pkg = JSON.parse(readFileSync(webPackageJson, "utf8"));
    const deps = {
      ...(pkg.dependencies || {}),
      ...(pkg.peerDependencies || {}),
    };
    const forbidden = [
      "@mui/",
      "@chakra",
      "antd",
      "styled-components",
      "@emotion/",
      "tailwindcss",
      "chart.js",
      "recharts",
      "d3",
      "lucide-react",
      "react-icons",
      "fontawesome",
      "framer-motion",
    ];
    // F1 (Sage & Honey lock): the two self-hosted OFL font packages are the
    // ONLY sanctioned @fontsource deps (woff2 binaries, no runtime JS).
    const allowedFonts = new Set([
      "@fontsource/hanken-grotesk",
      "@fontsource/ibm-plex-mono",
    ]);
    for (const name of Object.keys(deps)) {
      if (allowedFonts.has(name)) continue;
      for (const bad of forbidden) {
        assert.ok(
          !name.includes(bad) && name !== bad.replace(/\/$/, ""),
          `forbidden UI runtime dependency: ${name}`,
        );
      }
    }
    // Allowed baseline only
    assert.ok(deps.react, "react required");
    assert.ok(deps["react-dom"], "react-dom required");
    assert.ok(deps["react-router-dom"], "react-router-dom required");
  });
});
