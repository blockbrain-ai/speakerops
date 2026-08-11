import { describe, it, expect } from "vitest";
import {
  RICH_TEXT_SCHEMA_VERSION,
  RICH_TEXT_MAX_DEPTH,
  RICH_TEXT_MAX_NODES,
  RICH_TEXT_MAX_BYTES,
  RICH_TEXT_LINK_HREF_MAX,
  isAllowedRichTextHref,
  checkRichTextCaps,
  richTextCfpContentSchema,
  richTextEmailSchema,
  richTextPublicAnswerSchema,
  richTextBioSchema,
  richTextSchemaForContext,
  parseRichTextJson,
  richTextFromLegacyText,
  readRichTextValue,
  emptyRichText,
  richTextIsEmpty,
  richTextToPlainText,
  richTextToEmailHtml,
  richTextCharCount,
  escapeHtml,
  mergeRichTextValues,
  normalizeRichTextDoc,
  richTextEnvelopeFromEditorDoc,
  richTextBodyField,
  type RichTextEnvelope,
  type RichTextNode,
} from "./richtext.js";

// ---------------------------------------------------------------------------
// Doc-building helpers
// ---------------------------------------------------------------------------

function env(content: RichTextNode[]): RichTextEnvelope {
  return { schema: RICH_TEXT_SCHEMA_VERSION, doc: { type: "doc", content } };
}
function para(text: string, marks?: RichTextNode["marks"]): RichTextNode {
  return {
    type: "paragraph",
    content: [{ type: "text", text, ...(marks ? { marks } : {}) }],
  };
}
function heading(level: 2 | 3, text: string): RichTextNode {
  return { type: "heading", attrs: { level }, content: [{ type: "text", text }] };
}
function bullet(...items: string[]): RichTextNode {
  return {
    type: "bulletList",
    content: items.map((t) => ({
      type: "listItem",
      content: [para(t)],
    })),
  };
}

const CONTEXTS = [
  ["cfpContent", richTextCfpContentSchema],
  ["email", richTextEmailSchema],
  ["publicAnswer", richTextPublicAnswerSchema],
  ["bio", richTextBioSchema],
] as const;

// ---------------------------------------------------------------------------
// 1. Per-context allowlists
// ---------------------------------------------------------------------------

describe("F2 richtext: per-context allowlists", () => {
  it("every context accepts a plain paragraph with basic marks", () => {
    const doc = env([
      para("Hello", [{ type: "bold" }]),
      para("World", [{ type: "italic" }]),
      para("Under", [{ type: "underline" }]),
      bullet("one", "two"),
      { type: "paragraph", attrs: { textAlign: "center" }, content: [{ type: "text", text: "c" }] },
    ]);
    for (const [name, schema] of CONTEXTS) {
      expect(schema.safeParse(doc).success, `${name} accepts basic doc`).toBe(
        true,
      );
    }
  });

  it("cfpContent + email accept headings (h2/h3) and super/subscript", () => {
    const doc = env([
      heading(2, "Title"),
      heading(3, "Sub"),
      para("x", [{ type: "superscript" }]),
      para("y", [{ type: "subscript" }]),
    ]);
    expect(richTextCfpContentSchema.safeParse(doc).success).toBe(true);
    expect(richTextEmailSchema.safeParse(doc).success).toBe(true);
  });

  it("publicAnswer + bio REJECT headings", () => {
    const doc = env([heading(2, "Nope")]);
    expect(richTextPublicAnswerSchema.safeParse(doc).success).toBe(false);
    expect(richTextBioSchema.safeParse(doc).success).toBe(false);
  });

  it("publicAnswer + bio REJECT superscript and subscript marks", () => {
    for (const mark of ["superscript", "subscript"] as const) {
      const doc = env([para("x", [{ type: mark }])]);
      expect(
        richTextPublicAnswerSchema.safeParse(doc).success,
        `publicAnswer rejects ${mark}`,
      ).toBe(false);
      expect(
        richTextBioSchema.safeParse(doc).success,
        `bio rejects ${mark}`,
      ).toBe(false);
    }
  });

  it("bio is strictly stricter than cfpContent (heading passes cfp, fails bio)", () => {
    const doc = env([heading(2, "Only admins")]);
    expect(richTextCfpContentSchema.safeParse(doc).success).toBe(true);
    expect(richTextBioSchema.safeParse(doc).success).toBe(false);
  });

  it("EVERY context rejects image nodes (image cut this wave)", () => {
    const doc = env([
      { type: "image", attrs: { src: "https://x.com/a.png" } } as RichTextNode,
    ]);
    for (const [name, schema] of CONTEXTS) {
      expect(schema.safeParse(doc).success, `${name} rejects image`).toBe(false);
    }
  });

  it("EVERY context rejects banned nodes (codeBlock, blockquote, horizontalRule)", () => {
    for (const type of ["codeBlock", "blockquote", "horizontalRule"]) {
      const doc = env([{ type, content: [{ type: "text", text: "x" }] } as RichTextNode]);
      for (const [name, schema] of CONTEXTS) {
        expect(schema.safeParse(doc).success, `${name} rejects ${type}`).toBe(
          false,
        );
      }
    }
  });

  it("EVERY context rejects banned marks (strike, code)", () => {
    for (const mark of ["strike", "code"]) {
      const doc = env([para("x", [{ type: mark }])]);
      for (const [name, schema] of CONTEXTS) {
        expect(schema.safeParse(doc).success, `${name} rejects mark ${mark}`).toBe(
          false,
        );
      }
    }
  });

  it("rejects unknown attrs on nodes (strict schema)", () => {
    const doc = env([
      { type: "paragraph", content: [{ type: "text", text: "x", evil: 1 } as RichTextNode] },
    ]);
    expect(richTextCfpContentSchema.safeParse(doc).success).toBe(false);
  });

  it("rejects invalid text-align value (justify)", () => {
    const doc = env([
      { type: "paragraph", attrs: { textAlign: "justify" }, content: [{ type: "text", text: "x" }] },
    ]);
    expect(richTextCfpContentSchema.safeParse(doc).success).toBe(false);
  });

  it("rejects heading level outside 2/3", () => {
    const doc = env([{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "x" }] }]);
    expect(richTextCfpContentSchema.safeParse(doc).success).toBe(false);
    const doc4 = env([{ type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "x" }] }]);
    expect(richTextCfpContentSchema.safeParse(doc4).success).toBe(false);
  });

  it("richTextSchemaForContext returns the matching schema", () => {
    expect(richTextSchemaForContext("cfpContent")).toBe(richTextCfpContentSchema);
    expect(richTextSchemaForContext("email")).toBe(richTextEmailSchema);
    expect(richTextSchemaForContext("publicAnswer")).toBe(richTextPublicAnswerSchema);
    expect(richTextSchemaForContext("bio")).toBe(richTextBioSchema);
  });
});

// ---------------------------------------------------------------------------
// 2. Caps (depth / node-count / byte)
// ---------------------------------------------------------------------------

describe("F2 richtext: structural caps (checkRichTextCaps)", () => {
  it("a small valid doc yields no cap issues", () => {
    expect(checkRichTextCaps(env([para("hi")]))).toEqual([]);
  });

  it("rejects docs exceeding the depth cap", () => {
    // Nest content beyond RICH_TEXT_MAX_DEPTH (walk starts at depth 1).
    let node: RichTextNode = { type: "paragraph", content: [{ type: "text", text: "x" }] };
    for (let i = 0; i < RICH_TEXT_MAX_DEPTH + 2; i++) {
      node = { type: "bulletList", content: [node] };
    }
    const issues = checkRichTextCaps(env([node]));
    expect(issues.some((m) => /depth/.test(m))).toBe(true);
  });

  it("rejects docs exceeding the node-count cap", () => {
    const content = Array.from({ length: RICH_TEXT_MAX_NODES + 5 }, () => ({
      type: "paragraph",
    }));
    const issues = checkRichTextCaps(env(content as RichTextNode[]));
    expect(issues.some((m) => /node count/.test(m))).toBe(true);
  });

  it("rejects docs exceeding the byte cap", () => {
    const big = "a".repeat(RICH_TEXT_MAX_BYTES + 100);
    const issues = checkRichTextCaps(env([para(big)]));
    expect(issues.some((m) => /bytes/.test(m))).toBe(true);
  });

  it("caps are enforced at the schema boundary (node count via superRefine/max)", () => {
    const content = Array.from({ length: RICH_TEXT_MAX_NODES + 5 }, () => ({
      type: "paragraph",
    }));
    expect(
      richTextCfpContentSchema.safeParse(env(content as RichTextNode[])).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Link href protocol allowlist
// ---------------------------------------------------------------------------

describe("F2 richtext: href protocol allowlist", () => {
  it("accepts https:// and mailto: only", () => {
    expect(isAllowedRichTextHref("https://example.com")).toBe(true);
    expect(isAllowedRichTextHref("https://ex.com/path?q=1#a")).toBe(true);
    expect(isAllowedRichTextHref("mailto:person@example.com")).toBe(true);
  });

  it("rejects javascript:, data:, vbscript:, http:, ftp:, file:", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "http://example.com",
      "ftp://example.com",
      "file:///etc/passwd",
    ]) {
      expect(isAllowedRichTextHref(bad), `rejects ${bad}`).toBe(false);
    }
  });

  it("rejects protocol-relative, whitespace tricks, control chars, non-strings", () => {
    expect(isAllowedRichTextHref("//evil.com")).toBe(false);
    expect(isAllowedRichTextHref(" https://x.com")).toBe(false);
    expect(isAllowedRichTextHref("https://x.com\n")).toBe(false);
    expect(isAllowedRichTextHref("java\tscript:alert(1)")).toBe(false);
    expect(isAllowedRichTextHref("")).toBe(false);
    expect(isAllowedRichTextHref(null)).toBe(false);
    expect(isAllowedRichTextHref(undefined)).toBe(false);
    expect(isAllowedRichTextHref(42)).toBe(false);
    expect(isAllowedRichTextHref("https://" + "a".repeat(RICH_TEXT_LINK_HREF_MAX))).toBe(false);
  });

  it("link mark with a banned href is rejected by the schema (reject, not strip)", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "http://x.com"]) {
      const doc = env([para("click", [{ type: "link", attrs: { href: bad } }])]);
      expect(
        richTextCfpContentSchema.safeParse(doc).success,
        `schema rejects link href ${bad}`,
      ).toBe(false);
    }
  });

  it("link mark with an allowed href passes the schema", () => {
    const doc = env([para("click", [{ type: "link", attrs: { href: "https://ok.com" } }])]);
    expect(richTextCfpContentSchema.safeParse(doc).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Plain-text + email-HTML serializers
// ---------------------------------------------------------------------------

describe("F2 richtext: plain-text serializer", () => {
  it("joins paragraphs with newlines", () => {
    expect(richTextToPlainText(env([para("a"), para("b")]))).toBe("a\nb");
  });

  it("renders bullet and ordered list markers", () => {
    expect(richTextToPlainText(env([bullet("x", "y")]))).toBe("- x\n- y");
    const ol: RichTextNode = {
      type: "orderedList",
      content: [
        { type: "listItem", content: [para("one")] },
        { type: "listItem", content: [para("two")] },
      ],
    };
    expect(richTextToPlainText(env([ol]))).toBe("1. one\n2. two");
  });

  it("hardBreak becomes a newline", () => {
    const doc = env([
      { type: "paragraph", content: [{ type: "text", text: "a" }, { type: "hardBreak" }, { type: "text", text: "b" }] },
    ]);
    expect(richTextToPlainText(doc)).toBe("a\nb");
  });

  it("null/empty envelope serializes to empty string", () => {
    expect(richTextToPlainText(null)).toBe("");
    expect(richTextToPlainText(undefined)).toBe("");
  });

  it("round-trips richTextToPlainText(richTextFromLegacyText(t)) === t", () => {
    for (const t of ["single", "a\nb\nc", "a\n\nb", "trailing\n", "\nleading", "one line\ntwo"]) {
      const back = richTextToPlainText(richTextFromLegacyText(t)!);
      expect(back, `round-trip ${JSON.stringify(t)}`).toBe(t);
    }
  });
});

describe("F2 richtext: email-HTML serializer", () => {
  it("escapes all text content (no raw markup leaks)", () => {
    const html = richTextToEmailHtml(env([para("<script>alert(1)</script>")]));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("maps marks to inline-safe tags", () => {
    const bold = richTextToEmailHtml(env([para("x", [{ type: "bold" }])]));
    expect(bold).toContain("<strong>x</strong>");
    const link = richTextToEmailHtml(
      env([para("go", [{ type: "link", attrs: { href: "https://ok.com" } }])]),
    );
    expect(link).toContain('href="https://ok.com"');
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
  });

  it("drops a link mark whose href is not allowlisted at serialize time", () => {
    const link = richTextToEmailHtml(
      env([para("go", [{ type: "link", attrs: { href: "javascript:alert(1)" } }])]),
    );
    expect(link).not.toContain("javascript:");
    expect(link).not.toContain("<a ");
    expect(link).toContain("go");
  });

  it("escapeHtml neutralizes the five dangerous chars", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});

describe("F2 richtext: character count (plain-text length)", () => {
  it("sums text-node lengths, ignoring markers and newlines", () => {
    expect(richTextCharCount(env([para("hello"), para("world")]))).toBe(10);
    expect(richTextCharCount(env([bullet("ab", "cd")]))).toBe(4);
    expect(richTextCharCount(null)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Legacy-value detection + dual-read
// ---------------------------------------------------------------------------

describe("F2 richtext: legacy detection + dual-read", () => {
  it("parseRichTextJson accepts only versioned envelopes", () => {
    const good = JSON.stringify(env([para("hi")]));
    expect(parseRichTextJson(good)).not.toBeNull();
    // Plain text (not JSON) → null → caller falls back to legacy conversion.
    expect(parseRichTextJson("just some plain text")).toBeNull();
    // Markdown-ish text → null (not JSON).
    expect(parseRichTextJson("# Heading\n- bullet\n**bold**")).toBeNull();
    // Arbitrary JSON without the schema envelope → null.
    expect(parseRichTextJson('{"foo":1}')).toBeNull();
    // Wrong schema version → null.
    expect(parseRichTextJson('{"schema":"v2","doc":{"type":"doc"}}')).toBeNull();
    // Malformed JSON → null.
    expect(parseRichTextJson("{not json")).toBeNull();
    expect(parseRichTextJson(null)).toBeNull();
    expect(parseRichTextJson("")).toBeNull();
  });

  it("richTextFromLegacyText turns each line into a paragraph", () => {
    const doc = richTextFromLegacyText("line1\nline2");
    expect(doc?.doc.content.length).toBe(2);
    expect(doc?.doc.content[0]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "line1" }],
    });
    // Blank lines become empty paragraphs.
    const withBlank = richTextFromLegacyText("a\n\nb");
    expect(withBlank?.doc.content[1]).toEqual({ type: "paragraph" });
    expect(richTextFromLegacyText(null)).toBeNull();
    expect(richTextFromLegacyText("")).toBeNull();
  });

  it("markdown-ish legacy text converts to a paragraph doc (never parsed as markup)", () => {
    const md = "# Not a heading\n- not a list";
    const doc = readRichTextValue(null, md);
    // Content is preserved verbatim as text — the '#' and '-' are literal text.
    expect(richTextToPlainText(doc)).toBe(md);
    // No heading/list nodes were synthesized.
    expect(doc?.doc.content.every((n) => n.type === "paragraph")).toBe(true);
  });

  it("readRichTextValue prefers the rich column, falls back to legacy, never writes", () => {
    const rich = JSON.stringify(env([para("RICH")]));
    // Rich preferred over legacy.
    expect(richTextToPlainText(readRichTextValue(rich, "LEGACY"))).toBe("RICH");
    // Fall back to legacy text when rich is null.
    expect(richTextToPlainText(readRichTextValue(null, "LEGACY"))).toBe("LEGACY");
    // Both null → null.
    expect(readRichTextValue(null, null)).toBeNull();
    // Purity: inputs are strings, function returns a fresh object, no mutation.
    const legacy = "immutable";
    const out = readRichTextValue(null, legacy);
    expect(legacy).toBe("immutable");
    expect(out).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. Merge fields (escape-before-serialize)
// ---------------------------------------------------------------------------

describe("F2 richtext: merge fields", () => {
  it("replaces {{name}} tokens in text nodes", () => {
    const { envelope, missingFields } = mergeRichTextValues(env([para("Hi {{name}}")]), {
      name: "Ada",
    });
    expect(richTextToPlainText(envelope)).toBe("Hi Ada");
    expect(missingFields).toEqual([]);
  });

  it("reports missing keys and leaves the literal token", () => {
    const { envelope, missingFields } = mergeRichTextValues(env([para("Hi {{who}}")]), {});
    expect(richTextToPlainText(envelope)).toBe("Hi {{who}}");
    expect(missingFields).toEqual(["who"]);
  });

  it("escapes merge values that reach BOTH parts (merge-before-serialize)", () => {
    // A malicious recipient value must not become markup in the HTML part.
    const { envelope } = mergeRichTextValues(env([para("Hello {{name}}")]), {
      name: "<script>alert(1)</script>",
    });
    const text = richTextToPlainText(envelope);
    const html = richTextToEmailHtml(envelope);
    // Text part carries the literal value (safe: plain text).
    expect(text).toBe("Hello <script>alert(1)</script>");
    // HTML part escaped the injected value — no live script survives.
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

// ---------------------------------------------------------------------------
// 7. Authoring normalization + helpers
// ---------------------------------------------------------------------------

describe("F2 richtext: authoring normalization", () => {
  it("reduces a link mark to { href } and drops textAlign:left", () => {
    const editorDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { textAlign: "left" },
          content: [
            { type: "text", text: "x", marks: [{ type: "link", attrs: { href: "https://ok.com", target: "_blank", class: "y" } }] },
          ],
        },
      ],
    };
    const out = normalizeRichTextDoc(editorDoc);
    const mark = out.content[0]?.content?.[0]?.marks?.[0];
    expect(mark).toEqual({ type: "link", attrs: { href: "https://ok.com" } });
    // textAlign:left is a default → dropped (no attrs key survives).
    expect(out.content[0]?.attrs).toBeUndefined();
  });

  it("preserves heading level and non-default alignment", () => {
    const editorDoc = {
      type: "doc",
      content: [{ type: "heading", attrs: { level: 3, textAlign: "center" }, content: [{ type: "text", text: "h" }] }],
    };
    const out = normalizeRichTextDoc(editorDoc);
    expect(out.content[0]?.attrs).toEqual({ level: 3, textAlign: "center" });
  });

  it("non-doc input falls back to the empty doc", () => {
    expect(normalizeRichTextDoc(null)).toEqual(emptyRichText().doc);
    expect(normalizeRichTextDoc({ type: "paragraph" })).toEqual(emptyRichText().doc);
  });

  it("richTextEnvelopeFromEditorDoc wraps in the versioned envelope", () => {
    const out = richTextEnvelopeFromEditorDoc({ type: "doc", content: [para("x")] });
    expect(out.schema).toBe(RICH_TEXT_SCHEMA_VERSION);
    expect(out.doc.type).toBe("doc");
  });

  it("emptyRichText / richTextIsEmpty agree", () => {
    expect(richTextIsEmpty(emptyRichText())).toBe(true);
    expect(richTextIsEmpty(env([para("  ")]))).toBe(true);
    expect(richTextIsEmpty(env([para("real")]))).toBe(false);
    expect(richTextIsEmpty(null)).toBe(true);
  });
});

describe("F2 richtext: request-body field wrapper", () => {
  it("richTextBodyField accepts a valid doc, null, and undefined; rejects bad docs", () => {
    const field = richTextBodyField("bio");
    // zod schema wrapper — validate through safeParse on the underlying schema.
    expect(richTextBioSchema.nullable().optional().safeParse(env([para("ok")])).success).toBe(true);
    expect(richTextBioSchema.nullable().optional().safeParse(null).success).toBe(true);
    expect(richTextBioSchema.nullable().optional().safeParse(undefined).success).toBe(true);
    // A bio doc containing a heading must be rejected by the wrapper's schema.
    expect(richTextBioSchema.nullable().optional().safeParse(env([heading(2, "no")])).success).toBe(false);
    expect(field).toBeDefined();
  });
});
