/**
 * Section 11.6 — speakers lifecycle helpers.
 */
import { describe, it, expect } from "vitest";
import {
  deriveSpeakerReadiness,
  filterSpeakersByView,
  speakerNeedsAction,
  readinessScore,
  participationStatusLabel,
} from "./speakers-utils.js";
import type { AdminSpeakerListItem } from "@speakerops/shared";

function item(
  partial: Partial<AdminSpeakerListItem> & {
    participation?: Partial<AdminSpeakerListItem["participation"]>;
  } = {},
): AdminSpeakerListItem {
  return {
    participation: {
      id: partial.participation?.id ?? "part_1",
      eventId: partial.participation?.eventId ?? "evt_1",
      personId: partial.participation?.personId ?? "per_1",
      userId: partial.participation?.userId ?? null,
      roleLabel: partial.participation?.roleLabel ?? "speaker",
      status: partial.participation?.status ?? "accepted",
      version: partial.participation?.version ?? 1,
      bio: partial.participation?.bio ?? null,
      company: partial.participation?.company ?? null,
      title: partial.participation?.title ?? null,
      headshotFileId: partial.participation?.headshotFileId ?? null,
      createdAt: partial.participation?.createdAt ?? "2026-01-01T00:00:00.000Z",
      updatedAt: partial.participation?.updatedAt ?? "2026-01-01T00:00:00.000Z",
      personName: partial.participation?.personName ?? "Ada",
      personEmail: partial.participation?.personEmail ?? "ada@example.com",
    },
    pendingTaskCount: partial.pendingTaskCount ?? 0,
    completedTaskCount: partial.completedTaskCount ?? 0,
    sessionCount: partial.sessionCount ?? 0,
  };
}

describe("11.6 speakers-utils readiness", () => {
  it("separates acceptance, confirmation, profile, tasks, session", () => {
    const r = deriveSpeakerReadiness(
      item({
        participation: {
          status: "accepted",
          userId: null,
          bio: null,
          company: null,
          title: null,
          headshotFileId: null,
        },
        pendingTaskCount: 2,
        sessionCount: 0,
      }),
    );
    expect(r.accepted).toBe(true);
    expect(r.confirmed).toBe(false);
    expect(r.profile).toBe(false);
    expect(r.tasks).toBe(false);
    expect(r.session).toBe(false);
    expect(speakerNeedsAction(r)).toBe(true);
    expect(readinessScore(r)).toBe(1);
  });

  it("marks profile ready only with bio + affiliation + headshot", () => {
    expect(
      deriveSpeakerReadiness(
        item({ participation: { bio: "Hello" } }),
      ).profile,
    ).toBe(false);
    expect(
      deriveSpeakerReadiness(
        item({ participation: { headshotFileId: "file_1" } }),
      ).profile,
    ).toBe(false);
    expect(
      deriveSpeakerReadiness(
        item({
          participation: {
            bio: "Hello",
            company: "Acme",
            headshotFileId: "file_1",
          },
        }),
      ).profile,
    ).toBe(true);
    expect(
      deriveSpeakerReadiness(
        item({
          participation: {
            bio: "Hello",
            title: "Eng",
            headshotFileId: "file_1",
          },
        }),
      ).profile,
    ).toBe(true);
  });

  it("marks confirmed when userId is linked", () => {
    const r = deriveSpeakerReadiness(
      item({ participation: { userId: "usr_1" } }),
    );
    expect(r.confirmed).toBe(true);
  });

  it("filters views: needs_action, unconfirmed, profile, travel_tasks", () => {
    const incomplete = item({
      participation: {
        id: "p1",
        userId: null,
        bio: null,
      },
      pendingTaskCount: 1,
      sessionCount: 0,
    });
    const ready = item({
      participation: {
        id: "p2",
        userId: "usr_2",
        bio: "Done",
        company: "Acme",
        headshotFileId: "f1",
      },
      pendingTaskCount: 0,
      completedTaskCount: 2,
      sessionCount: 1,
    });
    const list = [incomplete, ready];

    expect(filterSpeakersByView(list, "all")).toHaveLength(2);
    expect(filterSpeakersByView(list, "needs_action").map((s) => s.participation.id)).toEqual([
      "p1",
    ]);
    expect(
      filterSpeakersByView(list, "unconfirmed").map((s) => s.participation.id),
    ).toEqual(["p1"]);
    expect(
      filterSpeakersByView(list, "profile_incomplete").map(
        (s) => s.participation.id,
      ),
    ).toEqual(["p1"]);
    expect(
      filterSpeakersByView(list, "travel_tasks").map((s) => s.participation.id),
    ).toEqual(["p1"]);
  });

  it("labels participation status in sentence case", () => {
    expect(participationStatusLabel("accepted")).toBe("Accepted");
    expect(participationStatusLabel("withdrawn")).toBe("Withdrawn");
  });
});
