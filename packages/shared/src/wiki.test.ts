import { describe, it, expect } from "vitest";
import { parseWikiMarkdown, wikiEmbedSrc } from "./wiki.js";

describe("wikiEmbedSrc", () => {
  it("maps YouTube watch URLs to nocookie embed", () => {
    const e = wikiEmbedSrc("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(e?.src).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(e?.provider).toBe("youtube");
  });

  it("rejects youtube.com substring on a foreign host", () => {
    expect(
      wikiEmbedSrc("https://evil.example/youtube.com/embed/dQw4w9WgXcQ"),
    ).toBeNull();
  });

  it("rejects javascript: and http", () => {
    expect(wikiEmbedSrc("javascript:alert(1)")).toBeNull();
    expect(wikiEmbedSrc("http://evil.example/x")).toBeNull();
  });

  it("accepts Google Maps embed URLs only", () => {
    const ok = wikiEmbedSrc(
      "https://www.google.com/maps/embed?pb=hello",
    );
    expect(ok?.provider).toBe("maps");
    expect(wikiEmbedSrc("https://www.google.com/search?q=x")).toBeNull();
  });
});

describe("parseWikiMarkdown", () => {
  it("keeps XSS-looking text as text and rejects bad links", () => {
    const blocks = parseWikiMarkdown(
      'Hello [x](javascript:alert(1))\n<script>alert(1)</script>',
    );
    const texts = JSON.stringify(blocks);
    expect(texts).toContain("<script>");
    expect(texts).not.toContain('"type":"link"');
  });

  it("parses allowlisted embed fences", () => {
    const blocks = parseWikiMarkdown(
      "```embed https://youtu.be/dQw4w9WgXcQ\n```",
    );
    expect(blocks.some((b) => b.type === "embed")).toBe(true);
  });
});
