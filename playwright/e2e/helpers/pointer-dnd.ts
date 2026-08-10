/**
 * Real-mouse drag helper for Schedule Studio's pointer-event DnD.
 *
 * The studio no longer uses native HTML5 drag (Chromium's native drag
 * intermittently resolved as a click). Dragging is plain pointer events with a
 * ~6px activation threshold, so Playwright's real mouse input drives exactly
 * the code path humans use — no synthetic DragEvent/DataTransfer needed.
 */
import { expect, type Page } from "@playwright/test";

/**
 * Drag source element to target element with the real mouse:
 * press on source center, cross the drag-activation threshold, glide to the
 * target center, release. Elements are scrolled into view as needed.
 */
export async function pointerDragTo(
  page: Page,
  sourceTestId: string,
  targetTestId: string,
): Promise<void> {
  const source = page.getByTestId(sourceTestId);
  const target = page.getByTestId(targetTestId);
  await expect(source).toBeVisible({ timeout: 15_000 });
  await expect(target).toBeAttached({ timeout: 15_000 });

  // hover() auto-scrolls the source into view and parks the cursor on it.
  await source.hover();
  const sb = await source.boundingBox();
  if (!sb) throw new Error(`drag source not visible: ${sourceTestId}`);
  const sx = sb.x + sb.width / 2;
  const sy = sb.y + sb.height / 2;

  await page.mouse.move(sx, sy);
  await page.mouse.down();
  // Cross the 6px activation threshold deterministically (drag, not click).
  await page.mouse.move(sx + 12, sy + 10, { steps: 3 });

  // Pointer capture is held by the source; page scroll is safe mid-drag.
  await target.scrollIntoViewIfNeeded();
  const tb = await target.boundingBox();
  if (!tb) throw new Error(`drag target not visible: ${targetTestId}`);
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
}
