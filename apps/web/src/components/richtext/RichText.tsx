/**
 * <RichText doc={...}> — safe React renderer for rich-text envelopes (F2).
 *
 * Maps allowed ProseMirror nodes/marks to React elements. NO
 * dangerouslySetInnerHTML anywhere (E10) — every piece of user content is a
 * React text child. Links are re-validated at render time and always get
 * rel="noopener noreferrer" target="_blank". Unknown nodes degrade to their
 * plain-text content and are counted in a dev-only console warning.
 *
 * Image nodes are NOT rendered this wave (image support cut — F2 correction).
 */
import type { CSSProperties, ReactNode } from "react";
import {
  isAllowedRichTextHref,
  type RichTextEnvelope,
  type RichTextNode,
} from "@speakerops/shared";

type UnknownCounter = { count: number; types: Set<string> };

function alignStyle(node: RichTextNode): CSSProperties | undefined {
  const align = node.attrs?.["textAlign"];
  if (align === "center" || align === "right") {
    return { textAlign: align };
  }
  return undefined;
}

function isNode(value: unknown): value is RichTextNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function marksOf(node: RichTextNode): Array<{ type: string; attrs?: Record<string, unknown> }> {
  // Defensive: marks:123 (or any non-array) must not reach `for...of`.
  return Array.isArray(node.marks) ? (node.marks as Array<{ type: string; attrs?: Record<string, unknown> }>) : [];
}

function renderInline(
  nodes: RichTextNode[] | undefined,
  keyPrefix: string,
  unknown: UnknownCounter,
): ReactNode[] {
  // Defensive: a malformed doc (non-array content) must never reach `.map`.
  if (!Array.isArray(nodes)) return [];
  return nodes.flatMap((raw, i) => {
    const key = `${keyPrefix}-${i}`;
    // content:[null] / non-objects — skip, never throw on `.type`.
    if (!isNode(raw)) return [];
    const node = raw;
    if (node.type === "hardBreak") return [<br key={key} />];
    if (node.type !== "text") {
      unknown.count += 1;
      unknown.types.add(node.type);
      // Unknown inline node → plain text fallback (its own text content).
      return [<span key={key}>{typeof node.text === "string" ? node.text : ""}</span>];
    }
    let el: ReactNode = typeof node.text === "string" ? node.text : "";
    let href: string | null = null;
    for (const mark of marksOf(node)) {
      if (!mark || typeof mark.type !== "string") continue;
      switch (mark.type) {
        case "bold":
          el = <strong>{el}</strong>;
          break;
        case "italic":
          el = <em>{el}</em>;
          break;
        case "underline":
          el = <u>{el}</u>;
          break;
        case "superscript":
          el = <sup>{el}</sup>;
          break;
        case "subscript":
          el = <sub>{el}</sub>;
          break;
        case "link": {
          const candidate = mark.attrs?.["href"];
          // Defense-in-depth: protocol allowlist re-checked at render time.
          if (isAllowedRichTextHref(candidate)) href = candidate;
          break;
        }
        default:
          unknown.count += 1;
          unknown.types.add(`mark:${mark.type}`);
          break; // Unknown mark: content renders unmarked, never as markup.
      }
    }
    if (href != null) {
      el = (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="l2-richtext__link"
        >
          {el}
        </a>
      );
    }
    return [<span key={key}>{el}</span>];
  });
}

function plainTextOf(node: RichTextNode): string {
  let out = "";
  if (node.type === "text") out += typeof node.text === "string" ? node.text : "";
  // Defensive: only iterate a real array (never a crafted non-array content).
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      if (isNode(child)) out += plainTextOf(child);
    }
  }
  return out;
}

function renderBlock(
  node: RichTextNode,
  key: string,
  unknown: UnknownCounter,
): ReactNode {
  if (!isNode(node)) return null;
  switch (node.type) {
    case "paragraph":
      return (
        <p key={key} style={alignStyle(node)}>
          {renderInline(node.content, key, unknown)}
        </p>
      );
    case "heading": {
      const level = node.attrs?.["level"] === 3 ? 3 : 2;
      const children = renderInline(node.content, key, unknown);
      return level === 2 ? (
        <h2 key={key} style={alignStyle(node)}>
          {children}
        </h2>
      ) : (
        <h3 key={key} style={alignStyle(node)}>
          {children}
        </h3>
      );
    }
    case "bulletList":
    case "orderedList": {
      const listItems = Array.isArray(node.content) ? node.content : [];
      const items = listItems.flatMap((item, i) => {
        if (!isNode(item)) return [];
        const children = Array.isArray(item.content) ? item.content : [];
        return [
          <li key={`${key}-li${i}`}>
            {children.flatMap((child, j) => {
              if (!isNode(child)) return [];
              return [renderBlock(child, `${key}-li${i}-${j}`, unknown)];
            })}
          </li>,
        ];
      });
      if (node.type === "orderedList") {
        const start =
          typeof node.attrs?.["start"] === "number" &&
          (node.attrs["start"] as number) > 1
            ? (node.attrs["start"] as number)
            : undefined;
        return (
          <ol key={key} start={start}>
            {items}
          </ol>
        );
      }
      return <ul key={key}>{items}</ul>;
    }
    default: {
      unknown.count += 1;
      unknown.types.add(node.type);
      // Unknown block → plain text fallback (never markup, never dropped).
      const text = plainTextOf(node);
      return text.length > 0 ? <p key={key}>{text}</p> : null;
    }
  }
}

export type RichTextProps = {
  doc: RichTextEnvelope | null | undefined;
  className?: string;
  "data-testid"?: string;
};

/**
 * Safe rich-text renderer. Renders nothing for null/empty docs.
 */
export function RichText({
  doc,
  className,
  "data-testid": testId,
}: RichTextProps): ReactNode {
  if (doc == null || doc.doc?.type !== "doc") return null;
  const unknown: UnknownCounter = { count: 0, types: new Set() };
  // Defensive: a malformed envelope with non-array `doc.content` must degrade
  // to empty, never throw (belt-and-suspenders with RichTextEnvelopeSchema).
  // Also skip null/non-object entries (content:[null]) so `.type` never throws.
  const topBlocks = Array.isArray(doc.doc.content) ? doc.doc.content : [];
  const blocks = topBlocks.flatMap((node, i) => {
    if (!isNode(node)) return [];
    return [renderBlock(node, `rt-${i}`, unknown)];
  });
  if (unknown.count > 0 && import.meta.env.DEV) {
    // Dev-only observability for schema drift (spec §3) — never throws.
    console.warn(
      `RichText: ${unknown.count} unknown node(s)/mark(s) rendered as plain text:`,
      [...unknown.types].join(", "),
    );
  }
  return (
    <div
      className={className ? `l2-richtext ${className}` : "l2-richtext"}
      data-testid={testId}
    >
      {blocks}
    </div>
  );
}
