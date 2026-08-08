/**
 * Section 5.3 — comms UI trust-before-send unit tests.
 *
 * Named assertions:
 * - assert send button disabled until preview
 */
import { describe, it, expect } from "vitest";
import {
  isSendEnabled,
  segmentFingerprint,
  sendDisabledReason,
} from "./comms-utils.js";

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
});
