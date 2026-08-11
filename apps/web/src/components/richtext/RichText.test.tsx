import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RichText } from "./RichText.js";
import type { RichTextEnvelope, RichTextNode } from "@speakerops/shared";

const HERE = dirname(fileURLToPath(import.meta.url));

function env(content: RichTextNode[]): RichTextEnvelope {
  return { schema: "v1", doc: { type: "doc", content } };
}
function render(doc: RichTextEnvelope | null): string {
  return renderToStaticMarkup(createElement(RichText, { doc }));
}

describe("F2 <RichText> safe renderer", () => {
  it("renders known block/inline nodes as real elements", () => {
    const html = render(
      env([
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Title" }] },
        { type: "paragraph", content: [{ type: "text", text: "Body", marks: [{ type: "bold" }] }] },
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "item" }] }] }],
        },
      ]),
    );
    expect(html).toContain("<h2");
    expect(html).toContain("Title");
    expect(html).toContain("<strong>Body</strong>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>");
  });

  it("gives allowlisted links rel/target and drops banned protocols", () => {
    const ok = render(env([{ type: "paragraph", content: [{ type: "text", text: "go", marks: [{ type: "link", attrs: { href: "https://ok.com" } }] }] }]));
    expect(ok).toContain('href="https://ok.com"');
    expect(ok).toContain('rel="noopener noreferrer"');
    expect(ok).toContain('target="_blank"');

    const bad = render(env([{ type: "paragraph", content: [{ type: "text", text: "go", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }]));
    expect(bad).not.toContain("javascript:");
    expect(bad).not.toContain("<a ");
    expect(bad).toContain("go");
  });

  it("XSS: raw markup in text content is escaped, never emitted live", () => {
    const html = render(env([{ type: "paragraph", content: [{ type: "text", text: "<script>alert(1)</script>" }] }]));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("XSS: an image/onerror node is unknown → degrades to text, never an <img>", () => {
    const html = render(
      env([
        { type: "image", attrs: { src: "x", onerror: "alert(1)" }, content: [{ type: "text", text: "boom" }] } as RichTextNode,
      ]),
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("onerror");
  });

  it("XSS: iframe/style/script node types never render as those tags", () => {
    for (const type of ["iframe", "style", "script"]) {
      const html = render(env([{ type, content: [{ type: "text", text: "payload" }] } as RichTextNode]));
      expect(html, `${type} not emitted as a tag`).not.toContain(`<${type}`);
    }
  });

  it("unknown marks render content unmarked (never as markup)", () => {
    const html = render(env([{ type: "paragraph", content: [{ type: "text", text: "hi", marks: [{ type: "evilMark" }] }] }]));
    expect(html).toContain("hi");
    expect(html).not.toContain("evilMark");
  });

  it("null/empty doc renders nothing (no crash)", () => {
    expect(render(null)).toBe("");
    expect(render({ schema: "v1", doc: { type: "notdoc" } } as unknown as RichTextEnvelope)).toBe("");
  });

  it("CRASH-GUARD: malformed non-array doc.content degrades to empty, never throws", () => {
    // The confirmed crash vector: a doc that a loose schema let through and
    // that then threw on `.map`. The renderer must survive it defensively even
    // if it reaches <RichText> by a path that skipped RichTextEnvelopeSchema.
    const malformed = {
      schema: "v1",
      doc: { type: "doc", content: 123 },
    } as unknown as RichTextEnvelope;
    let html = "";
    expect(() => {
      html = render(malformed);
    }).not.toThrow();
    // Degrades to an empty container (no blocks), never markup.
    expect(html).not.toContain("undefined");
  });

  it("CRASH-GUARD: non-array nested content (paragraph/list/text) never throws", () => {
    const cases: unknown[] = [
      { schema: "v1", doc: { type: "doc", content: [{ type: "paragraph", content: 5 }] } },
      { schema: "v1", doc: { type: "doc", content: [{ type: "bulletList", content: 9 }] } },
      {
        schema: "v1",
        doc: {
          type: "doc",
          content: [{ type: "bulletList", content: [{ type: "listItem", content: "nope" }] }],
        },
      },
      { schema: "v1", doc: { type: "doc", content: [{ type: "weird", content: {} }] } },
    ];
    for (const bad of cases) {
      expect(() => render(bad as RichTextEnvelope)).not.toThrow();
    }
  });

  it("GREP-PROOF: no dangerouslySetInnerHTML *usage* in the richtext components", () => {
    // Match a real JSX prop / object key (`dangerouslySetInnerHTML=` or `:`),
    // not the word appearing in a doc comment.
    const usageRe = /dangerouslySetInnerHTML\s*[=:]/;
    for (const f of ["RichText.tsx", "RichTextEditor.tsx"]) {
      const src = readFileSync(join(HERE, f), "utf8");
      expect(usageRe.test(src), `${f} never USES dangerouslySetInnerHTML`).toBe(false);
    }
  });
});
