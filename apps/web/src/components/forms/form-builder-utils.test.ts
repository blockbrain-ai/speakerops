/**
 * Section 3.2 — form builder pure helpers.
 * Named assertions from plan: publish disabled when invariant violated;
 * circular conditions; preview visibility.
 */
import { describe, it, expect } from "vitest";
import {
  canPublish,
  hasCircularConditions,
  isFieldVisibleInPreview,
  publishBlockReasons,
  reorderFields,
  uniqueFieldKey,
  toDraftBody,
  type BuilderField,
  type BuilderRule,
} from "./form-builder-utils.js";

function field(
  partial: Partial<BuilderField> & Pick<BuilderField, "fieldKey" | "type" | "label">,
): BuilderField {
  return {
    clientId: partial.clientId ?? `id_${partial.fieldKey}`,
    fieldKey: partial.fieldKey,
    type: partial.type,
    label: partial.label,
    required: partial.required ?? false,
    options: partial.options ?? null,
    sortOrder: partial.sortOrder ?? 0,
    conditions: partial.conditions ?? null,
  };
}

describe("3.2 form-builder-utils", () => {
  it("assert publish button disabled when invariant violated (no fields)", () => {
    const reasons = publishBlockReasons({
      formId: "form_1",
      fields: [],
      rules: [],
    });
    expect(reasons).toContain("no_fields");
    expect(
      canPublish({ formId: "form_1", fields: [], rules: [] }),
    ).toBe(false);
  });

  it("assert publish allowed when form has valid fields", () => {
    const fields = [
      field({
        fieldKey: "title",
        type: "text",
        label: "Title",
      }),
    ];
    expect(canPublish({ formId: "form_1", fields, rules: [] })).toBe(true);
  });

  it("assert circular condition field_key dependency is detected", () => {
    const fields = [
      field({
        fieldKey: "a",
        type: "text",
        label: "A",
        conditions: { showWhen: { fieldKey: "b", op: "eq", value: "1" } },
      }),
      field({
        fieldKey: "b",
        type: "text",
        label: "B",
        conditions: { showWhen: { fieldKey: "a", op: "eq", value: "1" } },
      }),
    ];
    expect(hasCircularConditions(fields)).toBe(true);
    expect(
      publishBlockReasons({ formId: "f", fields, rules: [] }),
    ).toContain("circular_conditions");
  });

  it("assert preview shows field when condition met", () => {
    const fields = [
      field({
        fieldKey: "category",
        type: "select",
        label: "Category",
        options: [
          { value: "talk", label: "Talk" },
          { value: "panel", label: "Panel" },
        ],
      }),
      field({
        fieldKey: "panel_size",
        type: "number",
        label: "Panel size",
        conditions: {
          showWhen: { fieldKey: "category", op: "eq", value: "panel" },
        },
      }),
    ];
    expect(
      isFieldVisibleInPreview(fields[1]!, fields, { category: "panel" }),
    ).toBe(true);
    expect(
      isFieldVisibleInPreview(fields[1]!, fields, { category: "talk" }),
    ).toBe(false);
  });

  it("assert preview shows field label after add (reorder preserves labels)", () => {
    const fields = [
      field({ fieldKey: "a", type: "text", label: "First", sortOrder: 0 }),
      field({ fieldKey: "b", type: "text", label: "Second", sortOrder: 1 }),
    ];
    const reordered = reorderFields(fields, 0, 1);
    expect(reordered.map((f) => f.label)).toEqual(["Second", "First"]);
    expect(reordered[0]!.sortOrder).toBe(0);
    expect(reordered[1]!.sortOrder).toBe(1);
  });

  it("uniqueFieldKey avoids collisions", () => {
    expect(uniqueFieldKey("title", [])).toBe("title");
    expect(uniqueFieldKey("title", ["title"])).toBe("title_2");
  });

  it("toDraftBody maps builder state to Form.UpdateDraftFields body", () => {
    const fields = [
      field({
        fieldKey: "title",
        type: "text",
        label: "Title",
        required: true,
      }),
    ];
    const rules: BuilderRule[] = [
      {
        clientId: "r1",
        when: { fieldKey: "title", op: "eq", value: "x" },
        routeToCategory: "track_a",
      },
    ];
    const body = toDraftBody({
      fields,
      rules,
      welcomeMd: "Welcome",
      thankYouMd: "Thanks",
      opensAt: "2026-01-01T00:00:00.000Z",
      closesAt: "2026-12-31T23:59:59.000Z",
      submissionLimit: "50",
    });
    expect(body.fields[0]?.fieldKey).toBe("title");
    expect(body.fields[0]?.required).toBe(true);
    expect(body.welcomeMd).toBe("Welcome");
    expect(body.submissionLimit).toBe(50);
    expect(body.rules[0]?.routeToCategory).toBe("track_a");
  });
});
