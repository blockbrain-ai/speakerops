import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RichTextEditor, normalizeLinkInput } from "./RichTextEditor.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("F2 RichTextEditor: normalizeLinkInput", () => {
  it("defaults bare hosts to https://", () => {
    expect(normalizeLinkInput("example.com")).toBe("https://example.com");
    expect(normalizeLinkInput("  example.com  ")).toBe("https://example.com");
  });
  it("preserves an explicit scheme", () => {
    expect(normalizeLinkInput("https://x.com")).toBe("https://x.com");
    expect(normalizeLinkInput("mailto:a@b.com")).toBe("mailto:a@b.com");
    // Preserved even if disallowed — the API/isAllowedRichTextHref rejects it later.
    expect(normalizeLinkInput("javascript:alert(1)")).toBe("javascript:alert(1)");
  });
  it("empty input stays empty (clears the link)", () => {
    expect(normalizeLinkInput("   ")).toBe("");
  });
});

describe("F2 RichTextEditor: SSR structure (node env, editor unmounted)", () => {
  function render(props: Parameters<typeof RichTextEditor>[0]): string {
    // TipTap useEditor schedules creation in an effect (immediatelyRender:false),
    // which never runs under renderToStaticMarkup — so we get the static shell.
    // Swallow React's SSR effect warnings, matching the repo's tsx-test pattern.
    vi.spyOn(console, "error").mockImplementation(() => {});
    return renderToStaticMarkup(createElement(RichTextEditor, props));
  }

  it("full/cfpContent toolbar exposes headings but never an image button", () => {
    const html = render({
      value: null,
      onChange: () => {},
      context: "cfpContent",
      variant: "full",
      "data-testid": "rte-cfp",
    });
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('aria-label="Bold"');
    expect(html).toContain('aria-label="Heading level 2"');
    expect(html).toContain('aria-label="Heading level 3"');
    expect(html).toContain('aria-label="Superscript"');
    // Image support cut this wave — no image control.
    expect(html.toLowerCase()).not.toContain('aria-label="image"');
    expect(html).toContain('data-testid="rte-cfp-toolbar"');
  });

  it("compact/bio toolbar omits headings and super/subscript", () => {
    const html = render({
      value: null,
      onChange: () => {},
      context: "bio",
      variant: "compact",
      "data-testid": "rte-bio",
    });
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('aria-label="Bold"');
    expect(html).not.toContain('aria-label="Heading level 2"');
    expect(html).not.toContain('aria-label="Superscript"');
  });

  it("renders a char counter when maxChars is set", () => {
    const html = render({
      value: null,
      onChange: () => {},
      context: "bio",
      variant: "compact",
      maxChars: 200,
      "data-testid": "rte-bio",
    });
    expect(html).toContain('data-testid="rte-bio-count"');
  });
});
