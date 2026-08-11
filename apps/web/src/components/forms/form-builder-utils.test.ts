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
    helpText: partial.helpText ?? null,
    placeholder: partial.placeholder ?? null,
    maxChars: partial.maxChars ?? null,
    nodeKind: partial.nodeKind ?? "input",
    layoutType: partial.layoutType ?? null,
    descriptionRich: partial.descriptionRich ?? null,
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

  // --- Wave 1B: layout nodes + per-submitter cap ---

  it("layout nodes never satisfy the publish field requirement", () => {
    const layoutOnly = [
      field({
        fieldKey: "layout_intro",
        type: "text",
        label: "Intro",
        nodeKind: "layout",
        layoutType: "section",
      }),
    ];
    expect(
      publishBlockReasons({ formId: "form_1", fields: layoutOnly, rules: [] }),
    ).toContain("no_fields");
    const mixed = [
      ...layoutOnly,
      field({ fieldKey: "title", type: "text", label: "Title" }),
    ];
    expect(canPublish({ formId: "form_1", fields: mixed, rules: [] })).toBe(
      true,
    );
  });

  it("conditions and rules referencing layout keys are invalid refs", () => {
    const fields = [
      field({
        fieldKey: "layout_intro",
        type: "text",
        label: "Intro",
        nodeKind: "layout",
        layoutType: "section",
      }),
      field({
        fieldKey: "title",
        type: "text",
        label: "Title",
        conditions: {
          showWhen: { fieldKey: "layout_intro", op: "eq", value: "x" },
        },
      }),
    ];
    const reasons = publishBlockReasons({
      formId: "form_1",
      fields,
      rules: [
        {
          clientId: "r1",
          when: { fieldKey: "layout_intro", op: "eq", value: "x" },
          routeToCategory: "nope",
        },
      ],
    });
    expect(reasons).toContain("invalid_condition_ref");
    expect(reasons).toContain("invalid_rule_ref");
  });

  it("layout nodes are always visible in preview and reorder like fields", () => {
    const fields = [
      field({
        fieldKey: "layout_break",
        type: "text",
        label: "Divider",
        nodeKind: "layout",
        layoutType: "divider",
        sortOrder: 0,
      }),
      field({ fieldKey: "title", type: "text", label: "Title", sortOrder: 1 }),
    ];
    expect(isFieldVisibleInPreview(fields[0]!, fields, {})).toBe(true);
    const reordered = reorderFields(fields, 0, 1);
    expect(reordered.map((f) => f.fieldKey)).toEqual([
      "title",
      "layout_break",
    ]);
  });

  it("toDraftBody normalizes layout nodes and carries perSubmitterLimit", () => {
    const fields = [
      field({
        fieldKey: "layout_intro",
        type: "text",
        label: "Intro",
        nodeKind: "layout",
        layoutType: "section",
        // Stray input knobs must be stripped for layout nodes.
        required: true,
        helpText: "should drop",
        maxChars: 10,
      }),
      field({ fieldKey: "title", type: "text", label: "Title" }),
    ];
    const body = toDraftBody({
      fields,
      rules: [],
      welcomeMd: "",
      thankYouMd: "",
      opensAt: "",
      closesAt: "",
      submissionLimit: "",
      perSubmitterLimit: "3",
    });
    expect(body.perSubmitterLimit).toBe(3);
    const layout = body.fields[0]!;
    expect(layout.nodeKind).toBe("layout");
    expect(layout.layoutType).toBe("section");
    expect(layout.required).toBe(false);
    expect(layout.helpText).toBeNull();
    expect(layout.maxChars).toBeNull();
    const input = body.fields[1]!;
    expect(input.nodeKind).toBe("input");
    expect(input.layoutType).toBeNull();
  });

  it("toDraftBody carries descriptionRich on section nodes and nulls it elsewhere (F2)", () => {
    const descDoc = {
      schema: "v1" as const,
      doc: {
        type: "doc" as const,
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Tell us about your talk." }] },
        ],
      },
    };
    const fields = [
      field({
        fieldKey: "layout_about",
        type: "text",
        label: "About",
        nodeKind: "layout",
        layoutType: "section",
        descriptionRich: descDoc,
      }),
      // A divider layout node must NOT carry descriptionRich (API rejects it).
      field({
        fieldKey: "layout_rule",
        type: "text",
        label: "rule",
        nodeKind: "layout",
        layoutType: "divider",
        descriptionRich: descDoc,
      }),
      // An input node must NOT carry descriptionRich either.
      field({ fieldKey: "title", type: "text", label: "Title", descriptionRich: descDoc }),
    ];
    const body = toDraftBody({
      fields,
      rules: [],
      welcomeMd: "",
      thankYouMd: "",
      opensAt: "",
      closesAt: "",
      submissionLimit: "",
    });
    expect(body.fields[0]!.descriptionRich).toEqual(descDoc);
    expect(body.fields[1]!.descriptionRich).toBeNull();
    expect(body.fields[2]!.descriptionRich).toBeNull();
  });
});
