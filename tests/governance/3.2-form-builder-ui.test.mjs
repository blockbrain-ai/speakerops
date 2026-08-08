/**
 * Section 3.2 — governance / file assertions for form builder admin UI.
 *
 * Named plan assertions:
 * - assert @inv:D01 through @inv:D10 each appear in playwright file
 * - assert preview shows field label after add (utils + e2e)
 * - assert publish button disabled when invariant violated
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const formBuilderPage = join(
  root,
  "apps",
  "web",
  "src",
  "pages",
  "FormBuilder.tsx",
);
const formPreview = join(
  root,
  "apps",
  "web",
  "src",
  "components",
  "forms",
  "FormPreview.tsx",
);
const formUtils = join(
  root,
  "apps",
  "web",
  "src",
  "components",
  "forms",
  "form-builder-utils.ts",
);
const formUtilsTest = join(
  root,
  "apps",
  "web",
  "src",
  "components",
  "forms",
  "form-builder-utils.test.ts",
);
const appTsx = join(root, "apps", "web", "src", "App.tsx");
const e2ePath = join(root, "playwright", "e2e", "form_builder.spec.ts");
const sectionDoc = join(root, "docs", "sections", "3.2-form-builder-ui.md");
const inventoryPath = join(
  root,
  "KMS-competition",
  "initiative",
  "BROWSER_E2E_INVENTORY.md",
);
const shellCss = join(root, "apps", "web", "src", "styles", "shell.css");

const INV_IDS = [
  "D01",
  "D02",
  "D03",
  "D04",
  "D05",
  "D06",
  "D07",
  "D08",
  "D09",
  "D10",
];

describe("3.2 form builder admin UI governance", () => {
  it("FormBuilder page, FormPreview, utils exist", () => {
    assert.equal(existsSync(formBuilderPage), true, "FormBuilder.tsx");
    assert.equal(existsSync(formPreview), true, "FormPreview.tsx");
    assert.equal(existsSync(formUtils), true, "form-builder-utils.ts");
    assert.equal(existsSync(formUtilsTest), true, "form-builder-utils.test.ts");
    assert.equal(existsSync(sectionDoc), true, "section doc");
  });

  it("App routes /admin/cfp to FormBuilderPage", () => {
    const app = readFileSync(appTsx, "utf8");
    assert.match(app, /FormBuilderPage/);
    assert.match(app, /path="\/admin\/cfp"/);
    assert.doesNotMatch(
      app,
      /path="\/admin\/cfp"[\s\S]{0,80}CfpFormsPage/,
    );
  });

  it("assert @inv:D01 through @inv:D10 each appear in playwright file", () => {
    assert.equal(existsSync(e2ePath), true, "form_builder.spec.ts");
    const e2e = readFileSync(e2ePath, "utf8");
    for (const id of INV_IDS) {
      assert.match(e2e, new RegExp(`@inv:${id}`), `missing @inv:${id}`);
    }
    for (const testId of [
      "e2e/admin/form-create",
      "e2e/admin/form-reorder",
      "e2e/admin/form-conditional",
      "e2e/admin/form-routing",
      "e2e/admin/form-required",
      "e2e/admin/form-copy",
      "e2e/admin/form-preview",
      "e2e/admin/form-publish-version",
      "e2e/admin/form-limits",
      "e2e/admin/form-link",
    ]) {
      assert.match(e2e, new RegExp(testId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("assert preview shows field label after add (utils + UI anchors)", () => {
    const utilsTest = readFileSync(formUtilsTest, "utf8");
    assert.match(utilsTest, /assert preview shows field label after add/);
    const page = readFileSync(formBuilderPage, "utf8");
    assert.match(page, /form-preview/);
    assert.match(page, /FormPreview/);
    const preview = readFileSync(formPreview, "utf8");
    assert.match(preview, /form-preview-label-/);
  });

  it("assert publish button disabled when invariant violated", () => {
    const utilsTest = readFileSync(formUtilsTest, "utf8");
    assert.match(
      utilsTest,
      /assert publish button disabled when invariant violated/,
    );
    const page = readFileSync(formBuilderPage, "utf8");
    assert.match(page, /form-publish/);
    assert.match(page, /publishEnabled|canPublish/);
    assert.match(page, /disabled=\{busy \|\| !publishEnabled\}/);
    const e2e = readFileSync(e2ePath, "utf8");
    assert.match(e2e, /form-publish.*toBeDisabled|toBeDisabled.*form-publish/s);
  });

  it("wires Form.* APIs only (Create, UpdateDraft, Publish)", () => {
    const page = readFileSync(formBuilderPage, "utf8");
    assert.match(page, /\/api\/events\/.*\/forms/);
    assert.match(page, /\/api\/forms\/.*\/draft/);
    assert.match(page, /\/api\/forms\/.*\/publish/);
    // No invented form list/get admin endpoints
    assert.doesNotMatch(page, /\/api\/forms\/list/);
  });

  it("Lumen-only form-builder styles (no freeform hex palette in builder CSS)", () => {
    const css = readFileSync(shellCss, "utf8");
    assert.match(css, /\.form-builder\b/);
    assert.match(css, /--lumen-brand/);
    // Builder block should not introduce raw hex outside comments
    const builderStart = css.indexOf("/* ---------------------------------------------------------------------------\n * Form builder");
    assert.ok(builderStart >= 0, "form builder CSS section present");
    const builderCss = css.slice(builderStart);
    assert.doesNotMatch(builderCss, /#[0-9a-fA-F]{3,8}\b/);
  });

  it("inventory D01–D10 status IMPLEMENTED or PASS", () => {
    const inv = readFileSync(inventoryPath, "utf8");
    for (const id of INV_IDS) {
      assert.match(
        inv,
        new RegExp(
          `\\|\\s*${id}\\s*\\|[^|]+\\|[^|]+\\|[^|]+\\|[^|]+\\|[^|]+\\|\\s*REQUIRED\\s*\\|\\s*(IMPLEMENTED|PASS)\\s*\\|`,
        ),
        `inventory ${id} must be IMPLEMENTED or PASS`,
      );
    }
  });

  it("empty state + keyboard-reachable control anchors exist", () => {
    const page = readFileSync(formBuilderPage, "utf8");
    assert.match(page, /field-list-empty/);
    assert.match(page, /lumen-focusable/);
    assert.match(page, /form-builder-empty|form-builder-no-event/);
  });
});
