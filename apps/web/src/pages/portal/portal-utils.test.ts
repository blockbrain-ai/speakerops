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
  formatTaskDue,
  formatSessionRange,
  applyOptimisticComplete,
  revertOptimisticComplete,
  pickNextIncomplete,
  isAllowedHeadshotMime,
  isAllowedSlidesMime,
  profileProgressSteps,
  taskProgress,
  overallPortalProgress,
  participationStateLabel,
  classifyTaskTitle,
  buildOnboardingSteps,
  onboardingNeedsWork,
  pickWizardStepIndex,
  wizardProgress,
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

  it("classifies task titles into wizard field kinds", () => {
    expect(classifyTaskTitle("Finalize speaker bio")).toBe("bio");
    expect(classifyTaskTitle("Upload headshot")).toBe("headshot");
    expect(classifyTaskTitle("Upload slides")).toBe("slides");
    expect(classifyTaskTitle("Finalize talk description")).toBe("task_text");
    expect(classifyTaskTitle("AV consent")).toBe("task_confirm");
    expect(classifyTaskTitle("Confirm hotel details")).toBe("task_confirm");
  });

  it("builds ordered onboarding steps — one profile field then tasks", () => {
    const part: ParticipationProfileDto = {
      id: "p1",
      eventId: "e1",
      personId: "per1",
      userId: "u1",
      roleLabel: "speaker",
      status: "accepted",
      version: 1,
      bio: null,
      company: null,
      title: null,
      headshotFileId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const steps = buildOnboardingSteps(part, [
      task({ id: "t-bio", status: "pending", title: "Finalize speaker bio" }),
      task({
        id: "t-talk",
        status: "pending",
        title: "Finalize talk description",
      }),
      task({ id: "t-av", status: "pending", title: "AV consent" }),
    ]);
    expect(steps[0]!.kind).toBe("bio");
    expect(steps[0]!.taskId).toBe("t-bio");
    expect(steps.some((s) => s.kind === "company")).toBe(true);
    expect(steps.some((s) => s.kind === "headshot")).toBe(true);
    // Talk description is freeform — never a bare complete-only orphan
    const talk = steps.find((s) => s.taskId === "t-talk");
    expect(talk?.kind).toBe("task_text");
    expect(onboardingNeedsWork(steps)).toBe(true);

    const prog = wizardProgress(steps);
    expect(prog.done).toBe(0);
    expect(prog.total).toBeGreaterThanOrEqual(5);

    // Skip bio → pick company first (non-skipped incomplete)
    const idx = pickWizardStepIndex(steps, ["profile:bio"]);
    expect(steps[idx]!.id).not.toBe("profile:bio");
    expect(steps[idx]!.done).toBe(false);
  });

  it("pickWizardStepIndex resurfaces skipped when only skipped remain", () => {
    const steps = buildOnboardingSteps(
      {
        id: "p1",
        eventId: "e1",
        personId: "per1",
        userId: "u1",
        roleLabel: "speaker",
        status: "accepted",
        version: 1,
        bio: "done",
        company: "Co",
        title: "Eng",
        headshotFileId: "f1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      [task({ id: "t1", status: "pending", title: "Finalize talk description" })],
    );
    const talk = steps.find((s) => s.taskId === "t1")!;
    const idx = pickWizardStepIndex(steps, [talk.id]);
    expect(steps[idx]!.id).toBe(talk.id);
  });

  /* B1 — timezone-labelled formatters. Explicit timeZone options only, so
   * assertions never depend on the machine's local zone. */
  describe("formatTaskDue zone labels (B1)", () => {
    const iso = "2026-08-17T14:30:00.000Z";

    it("renders event-local time with a short UTC zone label", () => {
      const out = formatTaskDue(iso, "UTC");
      expect(out).toContain("17 Aug 2026");
      expect(out).toContain("14:30");
      expect(out).toContain("UTC");
    });

    it("renders event-local time in a non-UTC event zone with its label", () => {
      const out = formatTaskDue(iso, "America/New_York");
      // 14:30Z on 17 Aug = 10:30 in New York (DST) — labelled EDT or GMT-4
      // depending on ICU data, never bare.
      expect(out).toContain("17 Aug 2026");
      expect(out).toContain("10:30");
      expect(out).toMatch(/EDT|GMT-4/);
    });

    it("falls back to the viewer zone — still labelled — for an invalid event zone", () => {
      const out = formatTaskDue(iso, "Not/AZone");
      // Time varies by machine; the zone LABEL must still be present
      // (more than the bare "d MMM yyyy, HH:mm" prefix).
      expect(out).toMatch(/\d{2}:\d{2}\s+\S+/);
    });

    it("returns the raw input when unparseable (data never hidden)", () => {
      expect(formatTaskDue("not-a-date", "UTC")).toBe("not-a-date");
    });
  });

  describe("formatSessionRange zone labels (B1)", () => {
    const startIso = "2026-10-01T09:00:00.000Z";
    const endIso = "2026-10-01T10:00:00.000Z";

    it("renders the event-local range with one zone label at the end", () => {
      const out = formatSessionRange(startIso, endIso, "UTC");
      expect(out).toContain("1 Oct 2026");
      expect(out).toContain("09:00");
      expect(out).toContain("– ");
      expect(out).toContain("10:00");
      expect(out).toContain("UTC");
      // Zone label appears exactly once (on the end time).
      expect(out.match(/UTC/g)).toHaveLength(1);
    });

    it("converts to a non-UTC event zone", () => {
      const out = formatSessionRange(startIso, endIso, "America/New_York");
      // 09:00Z–10:00Z = 05:00–06:00 New York (DST).
      expect(out).toContain("1 Oct 2026");
      expect(out).toContain("05:00");
      expect(out).toContain("06:00");
      expect(out).toMatch(/EDT|GMT-4/);
    });

    it("falls back to the raw range when unparseable", () => {
      expect(formatSessionRange("bad", "worse", "UTC")).toBe("bad – worse");
    });
  });
});
