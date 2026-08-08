/**
 * Section 5.1 — merge field render unit tests.
 */
import { describe, it, expect } from "vitest";
import {
  extractMergeFields,
  renderMergeFields,
  CommsUpsertTemplateBodySchema,
  TemplateKeySchema,
  COMMS_OUTBOX_TOPIC,
} from "./comms.js";

describe("comms merge fields (5.1)", () => {
  it("extractMergeFields returns unique first-appearance order", () => {
    const fields = extractMergeFields(
      "Hi {{name}}, welcome to {{eventName}}",
      "{{name}} and {{company}}",
    );
    expect(fields).toEqual(["name", "eventName", "company"]);
  });

  it("renderMergeFields substitutes known values", () => {
    const { rendered, missingFields } = renderMergeFields(
      "Hello {{name}} at {{company}}",
      { name: "Ada", company: "Analytical" },
    );
    expect(rendered).toBe("Hello Ada at Analytical");
    expect(missingFields).toEqual([]);
  });

  it("renderMergeFields reports missing fields and leaves tokens", () => {
    const { rendered, missingFields } = renderMergeFields(
      "Hi {{firstName}} ({{title}})",
      { firstName: "Grace" },
    );
    expect(rendered).toBe("Hi Grace ({{title}})");
    expect(missingFields).toEqual(["title"]);
  });

  it("TemplateKeySchema rejects uppercase / spaces", () => {
    expect(TemplateKeySchema.safeParse("accept-reminder").success).toBe(true);
    expect(TemplateKeySchema.safeParse("Bad Key").success).toBe(false);
  });

  it("Upsert body requires subject and body", () => {
    const ok = CommsUpsertTemplateBodySchema.safeParse({
      subject: "Your talk",
      body: "Hi {{name}}",
    });
    expect(ok.success).toBe(true);
    const bad = CommsUpsertTemplateBodySchema.safeParse({ subject: "" });
    expect(bad.success).toBe(false);
  });

  it("COMMS_OUTBOX_TOPIC is stable for workers", () => {
    expect(COMMS_OUTBOX_TOPIC).toBe("comms.send");
  });
});
