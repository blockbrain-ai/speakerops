/**
 * Render SpeakerOps overview HTML pages to PNGs (terminal aesthetic).
 */
import { chromium } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(root, "speakerops-overview.html");
const url = pathToFileURL(htmlPath).href;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1200, height: 2200 },
  deviceScaleFactor: 2,
});
await page.goto(url, { waitUntil: "networkidle" });

for (const id of ["page1", "page2"]) {
  const el = page.locator(`#${id}`);
  const box = await el.boundingBox();
  if (!box) throw new Error(`missing ${id}`);
  await page.screenshot({
    path: join(root, `speakerops-overview-${id === "page1" ? "1" : "2"}.png`),
    type: "png",
    clip: {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    },
  });
}

await browser.close();
console.log("Wrote speakerops-overview-1.png and speakerops-overview-2.png");
