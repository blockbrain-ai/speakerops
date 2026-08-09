/**
 * Unit tests for readiness helpers (section 6.3 + 11.1 attention ranking).
 */
import { describe, it, expect } from "vitest";
import {
  READINESS_POLL_MS,
  SPEAKERS_PAGE_SIZE,
  paginateSlice,
  speakerDetailPath,
  participationIdFromSearch,
} from "./readiness-utils.js";
import {
  buildAttentionQueue,
  type OverviewProgramMetrics,
} from "./Readiness.js";
import type { ReadinessOutstandingItem } from "@speakerops/shared";

describe("readiness-utils", () => {
  it("poll interval is ≤5s (H04)", () => {
    expect(READINESS_POLL_MS).toBeLessThanOrEqual(5000);
    expect(READINESS_POLL_MS).toBeGreaterThan(0);
  });

  it("paginateSlice windows large lists (L05)", () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const page1 = paginateSlice(items, 1, SPEAKERS_PAGE_SIZE);
    expect(page1.pageItems).toHaveLength(SPEAKERS_PAGE_SIZE);
    expect(page1.total).toBe(50);
    expect(page1.totalPages).toBe(2);
  });

  it("speakerDetailPath deep-links with participationId (H03)", () => {
    expect(speakerDetailPath("part_1")).toBe(
      "/admin/speakers?participationId=part_1",
    );
  });

  it("participationIdFromSearch parses query", () => {
    expect(participationIdFromSearch("?participationId=abc")).toBe("abc");
    expect(participationIdFromSearch("")).toBeNull();
  });
});

describe("11.1 buildAttentionQueue", () => {
  const baseMetrics: OverviewProgramMetrics = {
    submissions: 3,
    evaluationsTotal: 3,
    evaluationsScored: 1,
    speakers: 2,
    schedulePlaced: 1,
    scheduleUnscheduled: 2,
  };

  const overdueRow: ReadinessOutstandingItem = {
    taskId: "task_overdue",
    participationId: "part_1",
    personId: "person_1",
    personName: "Ada",
    personEmail: "ada@example.com",
    taskTitle: "Upload headshot",
    templateId: "tpl_1",
    status: "overdue",
    dueAt: "2020-01-01T00:00:00.000Z",
    isOverdue: true,
    version: 1,
  };

  const pendingRow: ReadinessOutstandingItem = {
    taskId: "task_pending",
    participationId: "part_2",
    personId: "person_2",
    personName: "Bob",
    personEmail: "bob@example.com",
    taskTitle: "Confirm travel",
    templateId: "tpl_2",
    status: "pending",
    dueAt: null,
    isOverdue: false,
    version: 1,
  };

  it("ranks overdue tasks ahead of program gaps", () => {
    const queue = buildAttentionQueue([pendingRow, overdueRow], baseMetrics);
    expect(queue[0]!.taskId).toBe("task_overdue");
    expect(queue[0]!.severity).toBe("danger");
    expect(queue.some((i) => i.id === "gap-schedule")).toBe(true);
    expect(queue.some((i) => i.id === "gap-eval")).toBe(true);
    // ranks are 1-based sequential
    expect(queue.map((i) => i.rank)).toEqual(
      queue.map((_, idx) => idx + 1),
    );
  });

  it("empty program surfaces guided setup attention", () => {
    const empty: OverviewProgramMetrics = {
      submissions: 0,
      evaluationsTotal: 0,
      evaluationsScored: 0,
      speakers: 0,
      schedulePlaced: 0,
      scheduleUnscheduled: 0,
    };
    const queue = buildAttentionQueue([], empty);
    expect(queue.some((i) => i.id === "gap-setup")).toBe(true);
    expect(queue[0]!.href).toBe("/admin/cfp");
  });

  it("all-clear metrics produce empty queue when no tasks", () => {
    const clear: OverviewProgramMetrics = {
      submissions: 5,
      evaluationsTotal: 5,
      evaluationsScored: 5,
      speakers: 4,
      schedulePlaced: 4,
      scheduleUnscheduled: 0,
    };
    expect(buildAttentionQueue([], clear)).toEqual([]);
  });
});
