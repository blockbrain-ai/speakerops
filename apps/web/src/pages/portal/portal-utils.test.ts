/**
 * Section 4.3 — portal utils unit tests.
 *
 * Named assertions:
 * - assert bio XSS text content not script
 * - assert mobile viewport task complete (logic: overdue + complete)
 * - optimistic complete + revert
 */
import { describe, it, expect } from "vitest";
import {
  sanitizeBioText,
  bioIsPlainText,
  taskDisplayStatus,
  applyOptimisticComplete,
  revertOptimisticComplete,
  pickNextIncomplete,
  isAllowedHeadshotMime,
  isAllowedSlidesMime,
  type TaskOptimisticSnapshot,
} from "./portal-utils.js";
import type { PortalTaskDto } from "@speakerops/shared";

function task(
  partial: Partial<PortalTaskDto> & Pick<PortalTaskDto, "id" | "status">,
): PortalTaskDto {
  return {
    id: partial.id,
    templateId: partial.templateId ?? "tpl_1",
    participationId: partial.participationId ?? "part_1",
    status: partial.status,
    dueAt: partial.dueAt ?? null,
    completedAt: partial.completedAt ?? null,
    version: partial.version ?? 1,
    title: partial.title ?? "Task",
    description: partial.description ?? null,
  };
}

describe("4.3 portal-utils", () => {
  it("assert bio XSS text content not script", () => {
    const xss = `<script>alert("xss")</script>Hello <b>world</b>`;
    const clean = sanitizeBioText(xss);
    expect(bioIsPlainText(clean)).toBe(true);
    expect(clean).not.toMatch(/<script/i);
    expect(clean).not.toMatch(/<\/script/i);
    expect(clean).not.toMatch(/<b>/i);
    // Script body and tag text removed; remaining human text kept
    expect(clean).toContain("Hello");
    expect(clean).toContain("world");
  });

  it("strips event handlers and javascript: URLs from bio", () => {
    const dirty = `Click <img src=x onerror=alert(1)> or javascript:alert(2)`;
    const clean = sanitizeBioText(dirty);
    expect(bioIsPlainText(clean)).toBe(true);
    expect(clean).not.toMatch(/onerror/i);
    expect(clean).not.toMatch(/javascript:/i);
  });

  it("marks pending past due as overdue (G06 visual)", () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(
      taskDisplayStatus(task({ id: "t1", status: "pending", dueAt: past })),
    ).toBe("overdue");
    expect(
      taskDisplayStatus(task({ id: "t2", status: "pending", dueAt: future })),
    ).toBe("pending");
    expect(taskDisplayStatus(task({ id: "t3", status: "overdue" }))).toBe(
      "overdue",
    );
    expect(taskDisplayStatus(task({ id: "t4", status: "completed" }))).toBe(
      "completed",
    );
  });

  it("optimistic complete + revert restores prior state", () => {
    const t1 = task({ id: "t1", status: "pending", version: 2, title: "Bio" });
    const t2 = task({
      id: "t2",
      status: "pending",
      version: 1,
      title: "Slides",
      dueAt: new Date(Date.now() + 1e6).toISOString(),
    });
    const tasks = [t1, t2];
    const snap: TaskOptimisticSnapshot = {
      taskId: "t1",
      previous: t1,
      previousNextTask: t1,
    };
    const after = applyOptimisticComplete(tasks, "t1", "2026-08-08T12:00:00.000Z");
    expect(after.find((x) => x.id === "t1")!.status).toBe("completed");
    expect(after.find((x) => x.id === "t1")!.version).toBe(3);
    const next = pickNextIncomplete(after);
    expect(next?.id).toBe("t2");
    const reverted = revertOptimisticComplete(after, snap);
    expect(reverted.find((x) => x.id === "t1")!.status).toBe("pending");
    expect(reverted.find((x) => x.id === "t1")!.version).toBe(2);
  });

  it("mime allowlists match portal headshot/slides", () => {
    expect(isAllowedHeadshotMime("image/jpeg")).toBe(true);
    expect(isAllowedHeadshotMime("image/png")).toBe(true);
    expect(isAllowedHeadshotMime("application/x-msdownload")).toBe(false);
    expect(isAllowedSlidesMime("application/pdf")).toBe(true);
    expect(isAllowedSlidesMime("image/jpeg")).toBe(false);
  });
});
