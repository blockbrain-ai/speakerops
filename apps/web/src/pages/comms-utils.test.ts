/**
 * Section 5.3 — comms UI trust-before-send unit tests.
 * Section 11.2 — audience filter / pagination (AC-11.2-SEL / AC-11.2-SCALE).
 *
 * Named assertions:
 * - assert send button disabled until preview
 * - unit audience filter
 */
import { describe, it, expect } from "vitest";
import {
  isSendEnabled,
  segmentFingerprint,
  sendDisabledReason,
  filterAudienceSpeakers,
  paginateAudience,
  audienceCount,
  isSelectionStable,
  buildCommsSegment,
  canRunCommsPreview,
  previewDisabledReason,
  AUDIENCE_PAGE_SIZE,
  CAMPAIGN_STEPS,
  type AudienceSpeakerRow,
} from "./comms-utils.js";

function rows(n: number, status = "accepted"): AudienceSpeakerRow[] {
  return Array.from({ length: n }, (_, i) => ({
    participationId: `p_${String(i + 1).padStart(3, "0")}`,
    name: `Speaker ${i + 1}`,
    email: `spk${i + 1}@example.com`,
    status: i % 10 === 0 ? "waitlisted" : status,
  }));
}

describe("5.3 comms-utils trust-before-send", () => {
  it("assert send button disabled until preview", () => {
    expect(
      isSendEnabled({
        previewId: null,
        previewValid: false,
        recipientCount: 0,
      }),
    ).toBe(false);

    expect(
      isSendEnabled({
        previewId: null,
        previewValid: true,
        recipientCount: 3,
      }),
    ).toBe(false);

    // Preview completed but audience edited → invalid
    expect(
      isSendEnabled({
        previewId: "job_1",
        previewValid: false,
        recipientCount: 3,
      }),
    ).toBe(false);

    // Empty audience
    expect(
      isSendEnabled({
        previewId: "job_1",
        previewValid: true,
        recipientCount: 0,
      }),
    ).toBe(false);

    // Ready to send
    expect(
      isSendEnabled({
        previewId: "job_1",
        previewValid: true,
        recipientCount: 2,
      }),
    ).toBe(true);

    // In flight
    expect(
      isSendEnabled({
        previewId: "job_1",
        previewValid: true,
        recipientCount: 2,
        sending: true,
      }),
    ).toBe(false);

    expect(
      sendDisabledReason({
        previewId: null,
        previewValid: false,
        recipientCount: 0,
      }),
    ).toMatch(/preview/i);
  });

  it("assert audience edit invalidates preview fingerprint", () => {
    const a = segmentFingerprint({
      status: "accepted",
      participationIds: [],
      templateId: "tpl_1",
      eventId: "evt_a",
    });
    const b = segmentFingerprint({
      status: "waitlisted",
      participationIds: [],
      templateId: "tpl_1",
      eventId: "evt_a",
    });
    expect(a).not.toBe(b);

    const c = segmentFingerprint({
      status: "accepted",
      participationIds: ["p2", "p1"],
      templateId: "tpl_1",
      eventId: "evt_a",
    });
    const d = segmentFingerprint({
      status: "accepted",
      participationIds: ["p1", "p2"],
      templateId: "tpl_1",
      eventId: "evt_a",
    });
    // Order-independent
    expect(c).toBe(d);
  });

  it("assert search query changes fingerprint (AC-11.2-SEL)", () => {
    const noSearch = segmentFingerprint({
      status: "accepted",
      participationIds: [],
      templateId: "tpl_1",
      eventId: "evt_a",
      query: "",
    });
    const withSearch = segmentFingerprint({
      status: "accepted",
      participationIds: [],
      templateId: "tpl_1",
      eventId: "evt_a",
      query: "ada",
    });
    expect(noSearch).not.toBe(withSearch);

    // Resolved ids for search also change fingerprint
    const resolved = segmentFingerprint({
      status: "",
      participationIds: ["p_001", "p_002"],
      templateId: "tpl_1",
      eventId: "evt_a",
      query: "ada",
    });
    expect(resolved).not.toBe(noSearch);
  });

  it("assert event switch invalidates preview fingerprint", () => {
    const a = segmentFingerprint({
      status: "accepted",
      participationIds: ["p1"],
      templateId: "tpl_1",
      eventId: "evt_a",
    });
    const b = segmentFingerprint({
      status: "accepted",
      participationIds: ["p1"],
      templateId: "tpl_1",
      eventId: "evt_b",
    });
    expect(a).not.toBe(b);
  });

  it("buildCommsSegment resolves search to participationIds for preview parity", () => {
    // Explicit selection wins
    expect(
      buildCommsSegment({
        selectedParticipationIds: ["p_a", "p_b"],
        segmentStatus: "accepted",
        audienceQuery: "ignored",
        filteredParticipationIds: ["p_x"],
      }),
    ).toEqual({ participationIds: ["p_a", "p_b"] });

    // Search without selection → filtered ids (not status-only)
    expect(
      buildCommsSegment({
        selectedParticipationIds: [],
        segmentStatus: "accepted",
        audienceQuery: "ada",
        filteredParticipationIds: ["p_001", "p_012"],
      }),
    ).toEqual({ participationIds: ["p_001", "p_012"] });

    // Zero-match search → explicit empty list (must not omit field / status-default)
    expect(
      buildCommsSegment({
        selectedParticipationIds: [],
        segmentStatus: "accepted",
        audienceQuery: "zzznomatch",
        filteredParticipationIds: [],
      }),
    ).toEqual({ participationIds: [] });
    // Empty array is present — API treats as empty audience, not absent
    expect(
      Object.prototype.hasOwnProperty.call(
        buildCommsSegment({
          selectedParticipationIds: [],
          segmentStatus: "accepted",
          audienceQuery: "zzznomatch",
          filteredParticipationIds: [],
        }),
        "participationIds",
      ),
    ).toBe(true);

    // Status-only when no selection and no search
    expect(
      buildCommsSegment({
        selectedParticipationIds: [],
        segmentStatus: "waitlisted",
        audienceQuery: "  ",
        filteredParticipationIds: ["p_001"],
      }),
    ).toEqual({ status: "waitlisted" });
  });

  it("blocks preview for zero-match audience", () => {
    expect(
      canRunCommsPreview({
        templateId: "tpl_1",
        segmentCount: 0,
      }),
    ).toBe(false);
    expect(
      previewDisabledReason({
        templateId: "tpl_1",
        segmentCount: 0,
      }),
    ).toMatch(/no recipients/i);

    expect(
      canRunCommsPreview({
        templateId: "tpl_1",
        segmentCount: 3,
      }),
    ).toBe(true);
    expect(
      canRunCommsPreview({
        templateId: null,
        segmentCount: 3,
      }),
    ).toBe(false);
  });
});

describe("11.2 unit audience filter (AC-11.2-SEL / AC-11.2-SCALE)", () => {
  it("filters by status and search query", () => {
    const all = rows(30);
    const accepted = filterAudienceSpeakers(all, {
      status: "accepted",
      query: "",
    });
    expect(accepted.every((r) => r.status === "accepted")).toBe(true);
    expect(accepted.length).toBeLessThan(all.length);

    const hit = filterAudienceSpeakers(all, {
      status: "all",
      query: "Speaker 12",
    });
    expect(hit).toHaveLength(1);
    expect(hit[0]!.participationId).toBe("p_012");

    const byEmail = filterAudienceSpeakers(all, {
      status: "accepted",
      query: "spk5@",
    });
    expect(byEmail.some((r) => r.email?.includes("spk5@"))).toBe(true);
  });

  it("paginates so primary window is ≤25 at 150 scale", () => {
    expect(AUDIENCE_PAGE_SIZE).toBe(25);
    // All accepted (no mixed statuses) for a clean 150-scale window.
    const all: AudienceSpeakerRow[] = Array.from({ length: 150 }, (_, i) => ({
      participationId: `p_${String(i + 1).padStart(3, "0")}`,
      name: `Speaker ${i + 1}`,
      email: `spk${i + 1}@example.com`,
      status: "accepted",
    }));
    const filtered = filterAudienceSpeakers(all, {
      status: "accepted",
      query: "",
    });
    expect(filtered.length).toBe(150);

    const page1 = paginateAudience(filtered, 1);
    expect(page1.pageItems.length).toBe(AUDIENCE_PAGE_SIZE);
    expect(page1.pageItems.length).toBeLessThanOrEqual(25);
    expect(page1.total).toBe(150);
    expect(page1.totalPages).toBe(6);

    const page6 = paginateAudience(filtered, 6);
    expect(page6.pageItems.length).toBe(25);
    expect(page6.page).toBe(6);

    // Clamp overflow page
    const overflow = paginateAudience(filtered, 99);
    expect(overflow.page).toBe(6);
    expect(overflow.pageItems.length).toBeLessThanOrEqual(25);
  });

  it("keeps selection stable across filter/page (AC-11.2-SEL)", () => {
    const selected = ["p_003", "p_001", "p_050"];
    const afterPage = ["p_050", "p_003", "p_001"];
    expect(isSelectionStable(selected, afterPage)).toBe(true);

    const afterEdit = ["p_003", "p_001"];
    expect(isSelectionStable(selected, afterEdit)).toBe(false);

    // Explicit selection count wins over filtered total
    expect(
      audienceCount({
        selectedParticipationIds: selected,
        filteredTotal: 150,
      }),
    ).toBe(3);

    expect(
      audienceCount({
        selectedParticipationIds: [],
        filteredTotal: 150,
      }),
    ).toBe(150);
  });

  it("exposes four campaign steps Audience→Message→Review→Send", () => {
    expect(CAMPAIGN_STEPS.map((s) => s.id)).toEqual([
      "audience",
      "message",
      "review",
      "send",
    ]);
    expect(CAMPAIGN_STEPS.map((s) => s.label)).toEqual([
      "Audience",
      "Message",
      "Review",
      "Send",
    ]);
  });
});
