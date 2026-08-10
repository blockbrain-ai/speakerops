/**
 * Section 4.3 — governance / file assertions for speaker portal UI.
 *
 * Named plan assertions:
 * - assert @inv:G01-G08
 * - assert bio XSS text content not script
 * - assert mobile viewport task complete
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const portalPage = join(
  root,
  "apps",
  "web",
  "src",
  "pages",
  "portal",
  "PortalHome.tsx",
);
const portalUtils = join(
  root,
  "apps",
  "web",
  "src",
  "pages",
  "portal",
  "portal-utils.ts",
);
const portalUtilsTest = join(
  root,
  "apps",
  "web",
  "src",
  "pages",
  "portal",
  "portal-utils.test.ts",
);
const portalReexport = join(
  root,
  "apps",
  "web",
  "src",
  "pages",
  "PortalHome.tsx",
);
const appTsx = join(root, "apps", "web", "src", "App.tsx");
const shellCss = join(root, "apps", "web", "src", "styles", "shell.css");
const e2ePath = join(root, "playwright", "e2e", "portal_ui.spec.ts");
const sectionDoc = join(root, "docs", "sections", "4.3-portal-ui.md");
const inventoryPath = join(
  root,
  "KMS-competition",
  "initiative",
  "BROWSER_E2E_INVENTORY.md",
);

const INV_IDS = ["G01", "G02", "G03", "G04", "G05", "G06", "G07", "G08"];

describe("4.3 speaker portal UI governance", () => {
  it("portal page, utils, e2e, section doc exist", () => {
    assert.equal(existsSync(portalPage), true, "portal/PortalHome.tsx");
    assert.equal(existsSync(portalUtils), true, "portal-utils.ts");
    assert.equal(existsSync(portalUtilsTest), true, "portal-utils.test.ts");
    assert.equal(existsSync(portalReexport), true, "pages/PortalHome.tsx");
    assert.equal(existsSync(e2ePath), true, "portal_ui.spec.ts");
    assert.equal(existsSync(sectionDoc), true, "4.3-portal-ui.md");
  });

  it("assert @inv:G01-G08 appear in Playwright e2e file", () => {
    const src = readFileSync(e2ePath, "utf8");
    for (const id of INV_IDS) {
      assert.match(
        src,
        new RegExp(`@inv:${id}\\b`),
        `missing @inv:${id} in portal_ui.spec.ts`,
      );
    }
    assert.match(src, /e2e\/portal\/home/);
    assert.match(src, /e2e\/portal\/bio/);
    assert.match(src, /e2e\/portal\/headshot/);
    assert.match(src, /e2e\/portal\/slides/);
    assert.match(src, /e2e\/portal\/task-complete/);
    assert.match(src, /e2e\/portal\/task-overdue/);
    assert.match(src, /e2e\/portal\/session/);
    assert.match(src, /e2e\/portal\/mobile/);
  });

  it("assert bio XSS text content not script (utils + UI)", () => {
    const utils = readFileSync(portalUtils, "utf8");
    const utilsTest = readFileSync(portalUtilsTest, "utf8");
    const page = readFileSync(portalPage, "utf8");
    assert.match(utils, /sanitizeBioText/);
    assert.match(utils, /bioIsPlainText/);
    assert.match(utilsTest, /assert bio XSS text content not script/);
    assert.match(page, /sanitizeBioText/);
    // Never inject HTML for bio (JSX prop form only — comments may mention safety)
    assert.doesNotMatch(page, /dangerouslySetInnerHTML\s*=/);
  });

  it("assert mobile viewport task complete in G08 e2e", () => {
    const src = readFileSync(e2ePath, "utf8");
    assert.match(src, /@inv:G08/);
    assert.match(src, /setViewportSize/);
    assert.match(src, /assert mobile viewport task complete/);
    // Onboarding wizard (post-11.9 UX wave) drives mobile complete via
    // portal-wizard-* controls; legacy portal-bio-save path retained as alt.
    assert.match(
      src,
      /portal-wizard-continue|portal-wizard-task-status|portal-bio-save|portal-next-task-complete/,
    );
  });

  it("portal CSS uses Lumen tokens only (no freeform hex in portal-*)", () => {
    const css = readFileSync(shellCss, "utf8");
    assert.match(css, /\.portal-page\s*\{/);
    assert.match(css, /var\(--lumen-brand\)/);
    assert.match(css, /var\(--lumen-space-/);
    // Mobile media query for G08
    assert.match(css, /@media\s*\(max-width:\s*480px\)/);
    // Extract portal block and ensure no hard-coded palette hex outside comments
    const portalStart = css.indexOf("Speaker portal (section 4.3");
    assert.ok(portalStart >= 0, "portal section comment present");
    const portalCss = css.slice(portalStart);
    const hexMatches = portalCss.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    assert.equal(
      hexMatches.length,
      0,
      `portal CSS must not use freeform hex: ${hexMatches.join(", ")}`,
    );
  });

  it("App routes portal and section data-section is 4.3", () => {
    const app = readFileSync(appTsx, "utf8");
    assert.match(app, /path="\/portal"/);
    assert.match(app, /PortalHomePage/);
    assert.match(app, /data-section="4\.3"/);
  });

  it("inventory G01–G08 status PASS (no shrinkage)", () => {
    const inv = readFileSync(inventoryPath, "utf8");
    for (const id of INV_IDS) {
      const row = inv
        .split("\n")
        .find((line) => line.includes(`| ${id} |`));
      assert.ok(row, `inventory row for ${id}`);
      assert.match(row, /\|\s*PASS\s*\|/, `${id} must be PASS`);
      assert.match(row, /REQUIRED/, `${id} must remain REQUIRED`);
    }
  });

  it("optimistic complete + headshot/slides testids wired", () => {
    const page = readFileSync(portalPage, "utf8");
    assert.match(page, /applyOptimisticComplete/);
    assert.match(page, /revertOptimisticComplete/);
    // File inputs render via PortalFileField (inputTestId prop) — the DOM
    // data-testid is unchanged; portal_ui G03/G04 prove it renders.
    assert.match(page, /(?:data-testid|inputTestId)="portal-headshot-input"/);
    assert.match(page, /(?:data-testid|inputTestId)="portal-slides-input"/);
    assert.match(page, /data-testid="portal-bio-input"/);
    assert.match(page, /data-testid="portal-next-task"/);
    assert.match(page, /data-testid="portal-sessions"/);
  });
});
