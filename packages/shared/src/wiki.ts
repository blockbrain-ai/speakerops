/**
 * Safe wiki / resource body: markdown subset + allowlisted embed URLs.
 * Never treat untrusted HTML as source of truth (E10).
 */

export type WikiInline =
  | { type: "text"; text: string }
  | { type: "link"; href: string; text: string };

export type WikiBlock =
  | { type: "p"; children: WikiInline[] }
  | { type: "h"; level: 1 | 2 | 3; children: WikiInline[] }
  | { type: "ul"; items: WikiInline[][] }
  | { type: "pre"; text: string }
  | { type: "embed"; src: string; provider: "youtube" | "maps" };

const YT_WATCH = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{6,})/i;
const MAPS_EMBED = /^https:\/\/www\.google\.com\/maps\/embed(\?|\/)/i;

export function isHttpsHttpUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:") return null;
    return u;
  } catch {
    return null;
  }
}

/** Paste URL → exact iframe src (not a host wildcard). */
export function wikiEmbedSrc(
  raw: string,
): { src: string; provider: "youtube" | "maps" } | null {
  const u = isHttpsHttpUrl(raw);
  if (!u) return null;
  const yt = raw.match(YT_WATCH);
  if (yt) {
    return {
      src: `https://www.youtube-nocookie.com/embed/${yt[1]}`,
      provider: "youtube",
    };
  }
  if (MAPS_EMBED.test(u.href) || u.hostname === "www.google.com" && u.pathname.startsWith("/maps/embed")) {
    return { src: u.href, provider: "maps" };
  }
  return null;
}

function parseInlines(line: string): WikiInline[] {
  const out: WikiInline[] = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push({ type: "text", text: line.slice(last, m.index) });
    const href = isHttpsHttpUrl(m[2] ?? "");
    if (href) out.push({ type: "link", href: href.href, text: m[1] ?? href.href });
    else out.push({ type: "text", text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ type: "text", text: line.slice(last) });
  return out.length ? out : [{ type: "text", text: "" }];
}

export function parseWikiMarkdown(src: string): WikiBlock[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: WikiBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const embedFence = line.match(/^```embed\s+(\S+)/i);
    const embedColon = line.match(/^:::embed\s+(\S+)/i);
    if (embedFence || embedColon) {
      const raw = (embedFence?.[1] ?? embedColon?.[1] ?? "").trim();
      const emb = wikiEmbedSrc(raw);
      if (emb) blocks.push({ type: "embed", ...emb });
      else blocks.push({ type: "p", children: [{ type: "text", text: raw || line }] });
      if (embedFence) {
        i += 1;
        while (i < lines.length && lines[i] !== "```") i += 1;
      }
      i += 1;
      continue;
    }
    if (line.startsWith("```")) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && lines[i] !== "```") {
        buf.push(lines[i] ?? "");
        i += 1;
      }
      blocks.push({ type: "pre", text: buf.join("\n") });
      i += 1;
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      const level = h[1]!.length as 1 | 2 | 3;
      blocks.push({ type: "h", level, children: parseInlines(h[2] ?? "") });
      i += 1;
      continue;
    }
    if (line.match(/^[-*]\s+/)) {
      const items: WikiInline[][] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i] ?? "")) {
        items.push(parseInlines((lines[i] ?? "").replace(/^[-*]\s+/, "")));
        i += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    const para: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() !== "" &&
      !/^(#{1,3})\s+/.test(lines[i] ?? "") &&
      !/^[-*]\s+/.test(lines[i] ?? "") &&
      !(lines[i] ?? "").startsWith("```") &&
      !/^:::embed/.test(lines[i] ?? "")
    ) {
      para.push(lines[i] ?? "");
      i += 1;
    }
    blocks.push({ type: "p", children: parseInlines(para.join(" ")) });
  }
  return blocks;
}
