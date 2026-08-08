/**
 * Section 6.2 — governance / file assertions for Schedule Studio UI.
 *
 * Named plan assertions:
 * - assert each @inv:I01-I16 in playwright
 * - assert conflict drop leaves placement count unchanged
 * - assert keyboard place creates placement
 * - assert reload shows same slot
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const studioPage = join(
  root,
  "apps",
  "web",
  "src",
  "pages",
  "schedule",
  "ScheduleStudio.tsx",
);
const utilsPath = join(
  root,
  "apps",
  "web",
  "src",
  "pages",
  "schedule",
  "schedule-utils.ts",
);
const utilsTest = join(
  root,
  "apps",
  "web",
  "src",
  "pages",
  "schedule",
  "schedule-utils.test.ts",
);
const e2ePath = join(root, "playwright", "e2e", "schedule_studio.spec.ts");
const sectionDoc = join(root, "docs", "sections", "6.2-schedule-ui.md");
const appTsx = join(root, "apps", "web", "src", "App.tsx");
const shellCss = join(root, "apps", "web", "src", "styles", "shell.css");
const sharedSchedule = join(root, "packages", "shared", "src", "schedule.ts");
const inventoryPath = join(
  root,
  "KMS-competition",
  "initiative",
  "BROWSER_E2E_INVENTORY.md",
);

const INV_IDS = [
  "I01",
  "I02",
  "I03",
  "I04",
  "I05",
  "I06",
  "I07",
  "I08",
  "I09",
  "I10",
  "I11",
  "I12",
  "I13",
  "I14",
  "I15",
  "I16",
];

describe("6.2 schedule studio UI governance", () => {
  it("primary files exist", () => {
    assert.equal(existsSync(studioPage), true, "ScheduleStudio.tsx");
    assert.equal(existsSync(utilsPath), true, "schedule-utils.ts");
    assert.equal(existsSync(utilsTest), true, "schedule-utils.test.ts");
    assert.equal(existsSync(e2ePath), true, "schedule_studio.spec.ts");
    assert.equal(existsSync(sectionDoc), true, "6.2-schedule-ui.md");
  });

  it("App routes ScheduleStudioPage at /admin/schedule", () => {
    const src = readFileSync(appTsx, "utf8");
    assert.match(src, /ScheduleStudioPage/);
    assert.match(src, /\/admin\/schedule/);
    assert.doesNotMatch(src, /from "\.\/routes\/placeholders\.js".*SchedulePage/s);
  });

  it("Studio wires real Schedule.* APIs (no placeholder mutations)", () => {
    const src = readFileSync(studioPage, "utf8");
    assert.match(src, /\/schedule\/place/);
    assert.match(src, /\/schedule\/move/);
    assert.match(src, /\/schedule\/unschedule/);
    assert.match(src, /schedule-tray/);
    assert.match(src, /schedule-dnd-ghost/);
    assert.match(src, /schedule-conflict-toast/);
    assert.match(src, /schedule-stale-recovery/);
    assert.match(src, /schedule-timezone/);
    assert.match(src, /schedule-undo/);
    assert.match(src, /schedule-tile/);
    assert.match(src, /lumen-focusable/);
    // View tabs: template `schedule-view-${v}` over SCHEDULE_VIEWS (list|day|week|track|room)
    assert.match(src, /schedule-view-\$\{v\}/);
    assert.match(src, /SCHEDULE_VIEWS/);
    assert.match(src, /"list"/);
    assert.match(src, /"day"/);
    assert.match(src, /"week"/);
    assert.match(src, /"track"/);
    assert.match(src, /"room"/);
  });

  it("shell.css defines schedule tile + toast with Lumen tokens only", () => {
    const css = readFileSync(shellCss, "utf8");
    assert.match(css, /\.schedule-tile\b/);
    assert.match(css, /\.schedule-studio__toast--conflict\b/);
    assert.match(css, /var\(--lumen-/);
    // No freeform hex in schedule-studio block beyond lumen vars (spot-check brand soft usage)
    const studioBlock = css.slice(css.indexOf("Section 6.2"));
    assert.match(studioBlock, /var\(--lumen-brand-soft\)/);
    assert.doesNotMatch(studioBlock, /#[0-9a-fA-F]{3,8}/);
  });

  it("shared schedule DTO allows list title join for Studio", () => {
    const src = readFileSync(sharedSchedule, "utf8");
    assert.match(src, /title: z\.string\(\)\.min\(1\)\.optional\(\)/);
  });

  it("assert each @inv:I01-I16 in playwright", () => {
    const e2e = readFileSync(e2ePath, "utf8");
    for (const id of INV_IDS) {
      assert.match(
        e2e,
        new RegExp(`@inv:${id}\\b`),
        `Playwright must tag @inv:${id}`,
      );
    }
    assert.match(e2e, /assert conflict drop leaves placement count unchanged/);
    assert.match(e2e, /assert keyboard place creates placement/);
    assert.match(e2e, /assert reload shows same slot/);
  });

  it("inventory I01–I16 marked PASS with schedule test_id rows", () => {
    const inv = readFileSync(inventoryPath, "utf8");
    for (const id of INV_IDS) {
      const row = inv
        .split("\n")
        .find((line) => line.startsWith(`| ${id} |`));
      assert.ok(row, `inventory row ${id}`);
      assert.match(row, /REQUIRED/);
      assert.match(row, /\|\s*PASS\s*\|/);
      assert.match(row, /e2e\/sched\//);
    }
  });

  it("section doc exists and lists I01–I16", () => {
    const doc = readFileSync(sectionDoc, "utf8");
    assert.match(doc, /6\.2/);
    assert.match(doc, /S-SCHED/);
    for (const id of INV_IDS) {
      assert.match(doc, new RegExp(id));
    }
  });
});
