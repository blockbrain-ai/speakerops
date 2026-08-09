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
  profileProgressSteps,
  taskProgress,
  overallPortalProgress,
  participationStateLabel,
  type TaskOptimisticSnapshot,
} from "./portal-utils.js";
import type { PortalTaskDto, ParticipationProfileDto } from "@speakerops/shared";

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

  it("profile + task progress for branded portal (11.6)", () => {
    const part: ParticipationProfileDto = {
      id: "p1",
      eventId: "e1",
      personId: "per1",
      userId: "u1",
      roleLabel: "speaker",
      status: "accepted",
      version: 1,
      bio: "Hello",
      company: null,
      title: "Engineer",
      headshotFileId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const steps = profileProgressSteps(part);
    expect(steps.find((s) => s.id === "bio")!.done).toBe(true);
    expect(steps.find((s) => s.id === "company")!.done).toBe(false);
    expect(steps.find((s) => s.id === "title")!.done).toBe(true);
    expect(steps.find((s) => s.id === "headshot")!.done).toBe(false);

    const tp = taskProgress([
      task({ id: "t1", status: "completed" }),
      task({ id: "t2", status: "pending" }),
      task({ id: "t3", status: "cancelled" }),
    ]);
    expect(tp.completed).toBe(1);
    expect(tp.pending).toBe(1);
    expect(tp.percent).toBe(50);

    const overall = overallPortalProgress(part, [
      task({ id: "t1", status: "completed" }),
      task({ id: "t2", status: "pending" }),
    ]);
    expect(overall.profileDone).toBe(2);
    expect(overall.profileTotal).toBe(4);
    expect(overall.percent).toBeGreaterThan(0);
    expect(overall.percent).toBeLessThan(100);

    expect(participationStateLabel("accepted")).toBe("Accepted speaker");
  });
});
