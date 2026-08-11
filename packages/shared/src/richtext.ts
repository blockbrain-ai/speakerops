import { z } from "zod";

/**
 * Rich-text platform primitive (F2 wave) — canonical structured ProseMirror
 * JSON, never HTML-as-truth.
 *
 * Storage model
 * -------------
 * Docs persist as a versioned envelope `{ schema: "v1", doc: {...} }` in
 * dedicated nullable `*_rich_json` TEXT columns (migration 0036 — additive,
 * expand/dual). Legacy plain-text columns stay authoritative for old readers.
 *
 * Dual-read rule (documented contract):
 *   1. Prefer the `*_rich_json` column when non-null and parseable.
 *   2. Fall back to the legacy text column converted line-by-line into a
 *      paragraph doc (`richTextFromLegacyText`) — AT READ TIME ONLY.
 *   3. Never write during a read. Writers write BOTH columns on save
 *      (rich doc + plain-text serialization) during the dual window.
 *
 * Four per-context allowlisted schemas (spec-review correction #4):
 *   - richTextCfpContentSchema  — admin-authored CFP content (welcome /
 *     thank-you / section descriptions): + headings h2/h3, + super/sub.
 *   - richTextEmailSchema       — comms template bodies (inline-safe subset).
 *   - richTextPublicAnswerSchema — public submitter answers: NO headings,
 *     NO super/sub, NO images.
 *   - richTextBioSchema         — speaker bio: same strictness as answers.
 *
 * IMAGE SUPPORT IS CUT FROM THIS WAVE (correction #5) — no image node in any
 * context. Text / marks / lists / links / alignment only.
 *
 * Validation posture: REJECT invalid docs at the API boundary (E4 envelope),
 * never silently strip. Renderer-side unknown nodes degrade to plain text.
 */

// ---------------------------------------------------------------------------
// Version + caps
// ---------------------------------------------------------------------------

export const RICH_TEXT_SCHEMA_VERSION = "v1" as const;

/** Maximum nesting depth of the ProseMirror doc tree. */
export const RICH_TEXT_MAX_DEPTH = 12 as const;
/** Maximum total node count (all nodes, text nodes included). */
export const RICH_TEXT_MAX_NODES = 2000 as const;
/** Maximum serialized envelope size in UTF-8 bytes. */
export const RICH_TEXT_MAX_BYTES = 64 * 1024;

/** Link protocol allowlist — https + mailto only (http rejected on purpose). */
export const RICH_TEXT_LINK_PROTOCOLS = ["https:", "mailto:"] as const;

/** Max href length inside a link mark. */
export const RICH_TEXT_LINK_HREF_MAX = 2000 as const;

/** Max text length of a single text node (defense-in-depth under byte cap). */
export const RICH_TEXT_TEXT_NODE_MAX = 50_000 as const;

/** Heading levels allowed in admin-authored contexts. */
export const RICH_TEXT_HEADING_LEVELS = [2, 3] as const;

// ---------------------------------------------------------------------------
// Doc shape types
// ---------------------------------------------------------------------------

export type RichTextMark = {
  type: string;
  attrs?: Record<string, unknown>;
};

export type RichTextNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichTextNode[];
  marks?: RichTextMark[];
  text?: string;
};

export type RichTextDoc = {
  type: "doc";
  content: RichTextNode[];
};

export type RichTextEnvelope = {
  schema: typeof RICH_TEXT_SCHEMA_VERSION;
  doc: RichTextDoc;
};

/**
 * Render/response envelope schema — STRUCTURAL strictness (no context
 * allowlist, no caps), used by response DTOs AND the render-time gate that
 * decides whether an arbitrary `z.unknown()` answer is a rich-text doc.
 *
 * Posture: permissive on node/mark VOCABULARY (unknown types still parse and
 * degrade to plain text in <RichText>) so legacy rows and dual-read
 * conversions of any size keep rendering — but STRICT on shape so a
 * renderer-crashing doc can never parse. Concretely: a versioned envelope,
 * `doc.type === "doc"` with an ARRAY `doc.content`, and — recursively — every
 * node is an object with a string `type` whose `content` (when present) is an
 * ARRAY, `marks` (when present) an ARRAY of `{type}` objects, and `text` a
 * string. This closes the confirmed crash/DoS vector where a crafted
 * `{schema:"v1",doc:{type:"doc",content:123}}` loosely parsed and then threw
 * on `.map` in admin submission detail + CSV export.
 *
 * Defense-in-depth: <RichText> ALSO guards `Array.isArray` before every map,
 * so a malformed doc reaching the renderer by any other path degrades to
 * empty/plain text rather than throwing.
 */
const richTextRenderNodeSchema: z.ZodTypeAny = z.lazy(() =>
  z
    .object({
      type: z.string(),
      text: z.string().optional(),
      marks: z.array(z.object({ type: z.string() }).passthrough()).optional(),
      content: z.array(richTextRenderNodeSchema).optional(),
    })
    .passthrough(),
);

export const RichTextEnvelopeSchema = z
  .object({
    schema: z.literal(RICH_TEXT_SCHEMA_VERSION),
    doc: z
      .object({
        type: z.literal("doc"),
        content: z.array(richTextRenderNodeSchema),
      })
      .passthrough(),
  })
  .passthrough() as unknown as z.ZodType<RichTextEnvelope>;

/** Rich-text contexts, each with its own allowlist. */
export const RICH_TEXT_CONTEXTS = [
  "cfpContent",
  "email",
  "publicAnswer",
  "bio",
] as const;
export type RichTextContext = (typeof RICH_TEXT_CONTEXTS)[number];

// ---------------------------------------------------------------------------
// Link href validation
// ---------------------------------------------------------------------------

/**
 * True only for an absolute https:// or mailto: URL within length bounds.
 * javascript:, data:, http:, vbscript:, protocol-relative and malformed
 * values are all rejected.
 */
export function isAllowedRichTextHref(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length < 1 || value.length > RICH_TEXT_LINK_HREF_MAX) return false;
  // Reject control chars / whitespace tricks before parsing.
  if (/[\u0000-\u001f\u007f\s]/.test(value)) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return (RICH_TEXT_LINK_PROTOCOLS as readonly string[]).includes(
    parsed.protocol,
  );
}

// ---------------------------------------------------------------------------
// Per-context Zod schemas
// ---------------------------------------------------------------------------

const TextAlignSchema = z.enum(["left", "center", "right"]);

/** Marks shared by every context. */
const boldMark = z.object({ type: z.literal("bold") }).strict();
const italicMark = z.object({ type: z.literal("italic") }).strict();
const underlineMark = z.object({ type: z.literal("underline") }).strict();
const superscriptMark = z.object({ type: z.literal("superscript") }).strict();
const subscriptMark = z.object({ type: z.literal("subscript") }).strict();
const linkMark = z
  .object({
    type: z.literal("link"),
    attrs: z
      .object({
        href: z
          .string()
          .refine(isAllowedRichTextHref, {
            message: "link href must be https:// or mailto:",
          }),
      })
      .strict(),
  })
  .strict();

type MarkSchema = z.ZodTypeAny;

/** Alignment attr envelope for paragraph/heading (TipTap TextAlign). */
const alignAttrs = z
  .object({ textAlign: TextAlignSchema.nullable().optional() })
  .strict()
  .optional();

function buildContextSchemas(opts: {
  headings: boolean;
  superSub: boolean;
}): z.ZodType<RichTextEnvelope> {
  const marks: MarkSchema[] = [boldMark, italicMark, underlineMark, linkMark];
  if (opts.superSub) marks.push(superscriptMark, subscriptMark);
  const markSchema = z.union(
    marks as [MarkSchema, MarkSchema, ...MarkSchema[]],
  );

  const textNode = z
    .object({
      type: z.literal("text"),
      text: z.string().min(1).max(RICH_TEXT_TEXT_NODE_MAX),
      marks: z.array(markSchema).max(8).optional(),
    })
    .strict();

  const hardBreakNode = z
    .object({
      type: z.literal("hardBreak"),
      // TipTap copies active marks onto hardBreak nodes; accept the same set.
      marks: z.array(markSchema).max(8).optional(),
    })
    .strict();

  const inlineNode = z.union([textNode, hardBreakNode]);

  const paragraphNode = z
    .object({
      type: z.literal("paragraph"),
      attrs: alignAttrs,
      content: z.array(inlineNode).max(RICH_TEXT_MAX_NODES).optional(),
    })
    .strict();

  const headingNode = z
    .object({
      type: z.literal("heading"),
      attrs: z
        .object({
          level: z
            .number()
            .int()
            .refine(
              (l) => (RICH_TEXT_HEADING_LEVELS as readonly number[]).includes(l),
              { message: "heading level must be 2 or 3" },
            ),
          textAlign: TextAlignSchema.nullable().optional(),
        })
        .strict(),
      content: z.array(inlineNode).max(RICH_TEXT_MAX_NODES).optional(),
    })
    .strict();

  type ListItem = z.ZodTypeAny;

  // listItem contains paragraphs and nested lists (recursive; depth-capped).
  const listItemNode: ListItem = z.lazy(() =>
    z
      .object({
        type: z.literal("listItem"),
        content: z
          .array(z.union([paragraphNode, bulletListNode, orderedListNode]))
          .min(1)
          .max(RICH_TEXT_MAX_NODES),
      })
      .strict(),
  );

  const bulletListNode: z.ZodTypeAny = z.lazy(() =>
    z
      .object({
        type: z.literal("bulletList"),
        content: z.array(listItemNode).min(1).max(RICH_TEXT_MAX_NODES),
      })
      .strict(),
  );

  const orderedListNode: z.ZodTypeAny = z.lazy(() =>
    z
      .object({
        type: z.literal("orderedList"),
        attrs: z
          .object({
            start: z.number().int().min(1).max(1_000_000).optional(),
            // TipTap v3 OrderedList carries a `type` attr (list style); allow null.
            type: z.null().optional(),
          })
          .strict()
          .optional(),
        content: z.array(listItemNode).min(1).max(RICH_TEXT_MAX_NODES),
      })
      .strict(),
  );

  const blockNodes: z.ZodTypeAny[] = [
    paragraphNode,
    bulletListNode,
    orderedListNode,
  ];
  if (opts.headings) blockNodes.push(headingNode);
  const blockNode = z.union(
    blockNodes as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]],
  );

  const docSchema = z
    .object({
      type: z.literal("doc"),
      content: z.array(blockNode).max(RICH_TEXT_MAX_NODES),
    })
    .strict();

  return z
    .object({
      schema: z.literal(RICH_TEXT_SCHEMA_VERSION),
      doc: docSchema,
    })
    .strict()
    .superRefine((envelope, ctx) => {
      const issues = checkRichTextCaps(envelope as RichTextEnvelope);
      for (const message of issues) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ["doc"] });
      }
    }) as unknown as z.ZodType<RichTextEnvelope>;
}

/**
 * Structural caps shared by every context: depth ≤ 12, nodes ≤ 2000,
 * serialized bytes ≤ 64KB. Returns human-readable issue list (empty = ok).
 */
export function checkRichTextCaps(envelope: RichTextEnvelope): string[] {
  const issues: string[] = [];
  let nodeCount = 0;
  let maxDepth = 0;
  const walk = (node: RichTextNode, depth: number): void => {
    nodeCount += 1;
    if (depth > maxDepth) maxDepth = depth;
    if (nodeCount > RICH_TEXT_MAX_NODES || depth > RICH_TEXT_MAX_DEPTH) return;
    for (const child of node.content ?? []) walk(child, depth + 1);
  };
  walk(envelope.doc as unknown as RichTextNode, 1);
  if (maxDepth > RICH_TEXT_MAX_DEPTH) {
    issues.push(
      `rich text exceeds maximum depth of ${RICH_TEXT_MAX_DEPTH}`,
    );
  }
  if (nodeCount > RICH_TEXT_MAX_NODES) {
    issues.push(
      `rich text exceeds maximum node count of ${RICH_TEXT_MAX_NODES}`,
    );
  }
  const bytes = utf8ByteLength(JSON.stringify(envelope));
  if (bytes > RICH_TEXT_MAX_BYTES) {
    issues.push(
      `rich text exceeds maximum size of ${RICH_TEXT_MAX_BYTES} bytes`,
    );
  }
  return issues;
}

function utf8ByteLength(s: string): number {
  // Workers + Node both provide TextEncoder (no Buffer dependency in shared).
  return new TextEncoder().encode(s).length;
}

/**
 * Admin-authored CFP content: welcome / thank-you / per-section
 * "Description & Instructions". Headings h2/h3 + super/sub allowed.
 */
export const richTextCfpContentSchema = buildContextSchemas({
  headings: true,
  superSub: true,
});

/** Comms template bodies — inline-safe subset (same nodes; no images ever). */
export const richTextEmailSchema = buildContextSchemas({
  headings: true,
  superSub: true,
});

/** Public submitter answers — NO headings, NO super/sub, NO images. */
export const richTextPublicAnswerSchema = buildContextSchemas({
  headings: false,
  superSub: false,
});

/** Speaker bio — same strictness as public answers. */
export const richTextBioSchema = buildContextSchemas({
  headings: false,
  superSub: false,
});

export function richTextSchemaForContext(
  context: RichTextContext,
): z.ZodType<RichTextEnvelope> {
  switch (context) {
    case "cfpContent":
      return richTextCfpContentSchema;
    case "email":
      return richTextEmailSchema;
    case "publicAnswer":
      return richTextPublicAnswerSchema;
    case "bio":
      return richTextBioSchema;
  }
}

// ---------------------------------------------------------------------------
// Parsing + dual-read helpers
// ---------------------------------------------------------------------------

/**
 * Parse a stored `*_rich_json` column value. Returns null when the value is
 * null/empty/unparseable (callers then fall back to the legacy text column).
 * Context allowlists run at WRITE time; reads use RichTextEnvelopeSchema
 * (structural strictness, permissive vocabulary) so crash-shaped envelopes
 * (`content:123`, `content:[null]`, `marks:123`) never become typed values
 * that later throw in render/CSV.
 */
export function parseRichTextJson(
  value: string | null | undefined,
): RichTextEnvelope | null {
  if (value == null || value === "") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    const result = RichTextEnvelopeSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Lossless legacy conversion at READ time: each line of the plain-text value
 * becomes one paragraph (empty lines become empty paragraphs), so
 * `richTextToPlainText(richTextFromLegacyText(t)) === t` for any t.
 * NEVER writes — write-back only happens on the next explicit save.
 */
export function richTextFromLegacyText(
  text: string | null | undefined,
): RichTextEnvelope | null {
  if (text == null || text === "") return null;
  const lines = text.split(/\r\n|\r|\n/);
  return {
    schema: RICH_TEXT_SCHEMA_VERSION,
    doc: {
      type: "doc",
      content: lines.map((line) =>
        line.length > 0
          ? { type: "paragraph", content: [{ type: "text", text: line }] }
          : { type: "paragraph" },
      ),
    },
  };
}

/**
 * Canonical dual-read: prefer the rich column, fall back to legacy text as a
 * paragraph doc. Pure function — never writes (migration law).
 */
export function readRichTextValue(
  richJson: string | null | undefined,
  legacyText: string | null | undefined,
): RichTextEnvelope | null {
  return parseRichTextJson(richJson) ?? richTextFromLegacyText(legacyText);
}

/** Empty doc helper (single empty paragraph). */
export function emptyRichText(): RichTextEnvelope {
  return {
    schema: RICH_TEXT_SCHEMA_VERSION,
    doc: { type: "doc", content: [{ type: "paragraph" }] },
  };
}

/** True when the doc has no visible text content (whitespace-only). */
export function richTextIsEmpty(
  envelope: RichTextEnvelope | null | undefined,
): boolean {
  if (envelope == null) return true;
  return richTextToPlainText(envelope).trim().length === 0;
}

// ---------------------------------------------------------------------------
// Plain-text serialization (deterministic; API + web agree)
// ---------------------------------------------------------------------------

function inlineToPlainText(nodes: RichTextNode[] | undefined): string {
  // Defensive: non-array content must never reach `for...of`.
  if (!Array.isArray(nodes)) return "";
  let out = "";
  for (const node of nodes) {
    if (node == null || typeof node !== "object") continue;
    if (node.type === "text") out += node.text ?? "";
    else if (node.type === "hardBreak") out += "\n";
  }
  return out;
}

function blockToPlainLines(node: RichTextNode, indent: string): string[] {
  if (node == null || typeof node !== "object") return [];
  switch (node.type) {
    case "paragraph":
    case "heading": {
      const text = inlineToPlainText(node.content);
      return text.split("\n").map((line, i) => (i === 0 ? indent + line : line));
    }
    case "bulletList":
    case "orderedList": {
      const lines: string[] = [];
      const ordered = node.type === "orderedList";
      const start =
        typeof node.attrs?.["start"] === "number"
          ? (node.attrs["start"] as number)
          : 1;
      const items = Array.isArray(node.content) ? node.content : [];
      items.forEach((item, idx) => {
        if (item == null || typeof item !== "object") return;
        const marker = ordered ? `${start + idx}. ` : "- ";
        const childLines: string[] = [];
        const children = Array.isArray(item.content) ? item.content : [];
        for (const child of children) {
          if (child == null || typeof child !== "object") continue;
          childLines.push(...blockToPlainLines(child, ""));
        }
        childLines.forEach((line, li) => {
          lines.push(
            li === 0 ? indent + marker + line : indent + "  " + line,
          );
        });
        if (childLines.length === 0) lines.push(indent + marker);
      });
      return lines;
    }
    default: {
      // Unknown node: degrade to its text content (never markup).
      const text = inlineToPlainText(node.content);
      return text.length > 0 ? [indent + text] : [];
    }
  }
}

/**
 * Deterministic plain-text serializer — used for CSV export, search bodies,
 * email text parts, and legacy-column write-back on save.
 */
export function richTextToPlainText(
  envelope: RichTextEnvelope | null | undefined,
): string {
  if (envelope == null) return "";
  const lines: string[] = [];
  const blocks = Array.isArray(envelope.doc?.content)
    ? envelope.doc.content
    : [];
  for (const block of blocks) {
    if (block == null || typeof block !== "object") continue;
    lines.push(...blockToPlainLines(block, ""));
  }
  return lines.join("\n");
}

/**
 * Canonical character count for maxChars enforcement: total authored text
 * characters (sum of text-node lengths — matches TipTap CharacterCount, which
 * counts doc.textContent; list markers / newlines are NOT counted).
 */
export function richTextCharCount(
  envelope: RichTextEnvelope | null | undefined,
): number {
  if (envelope == null) return 0;
  let count = 0;
  const walk = (node: RichTextNode): void => {
    if (node == null || typeof node !== "object") return;
    if (node.type === "text") count += (node.text ?? "").length;
    const children = Array.isArray(node.content) ? node.content : [];
    for (const child of children) walk(child);
  };
  walk(envelope.doc as unknown as RichTextNode);
  return count;
}

// ---------------------------------------------------------------------------
// Email-HTML serialization (inline-styled minimal HTML)
// ---------------------------------------------------------------------------

/** Escape a string for safe interpolation into HTML text/attribute position. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const EMAIL_FONT =
  "'Hanken Grotesk', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const EMAIL_TEXT_COLOR = "#1e2621";
const EMAIL_LINK_COLOR = "#3e6b50";

function inlineToEmailHtml(nodes: RichTextNode[] | undefined): string {
  // Defensive: non-array / null entries must never throw in serializers.
  if (!Array.isArray(nodes)) return "";
  let out = "";
  for (const node of nodes) {
    if (node == null || typeof node !== "object") continue;
    if (node.type === "hardBreak") {
      out += "<br />";
      continue;
    }
    if (node.type !== "text") continue;
    let html = escapeHtml(node.text ?? "");
    let href: string | null = null;
    const marks = Array.isArray(node.marks) ? node.marks : [];
    for (const mark of marks) {
      if (mark == null || typeof mark !== "object" || typeof mark.type !== "string") {
        continue;
      }
      switch (mark.type) {
        case "bold":
          html = `<strong>${html}</strong>`;
          break;
        case "italic":
          html = `<em>${html}</em>`;
          break;
        case "underline":
          html = `<u>${html}</u>`;
          break;
        case "superscript":
          html = `<sup>${html}</sup>`;
          break;
        case "subscript":
          html = `<sub>${html}</sub>`;
          break;
        case "link": {
          const candidate = mark.attrs?.["href"];
          // Defense-in-depth: re-check protocol at serialize time.
          if (isAllowedRichTextHref(candidate)) href = candidate;
          break;
        }
        default:
          break; // Unknown marks: text passes through unmarked, never markup.
      }
    }
    if (href != null) {
      html = `<a href="${escapeHtml(href)}" style="color: ${EMAIL_LINK_COLOR}; text-decoration: underline;" target="_blank" rel="noopener noreferrer">${html}</a>`;
    }
    out += html;
  }
  return out;
}

function alignStyle(node: RichTextNode): string {
  const align = node.attrs?.["textAlign"];
  if (align === "center" || align === "right") {
    return ` text-align: ${align};`;
  }
  return "";
}

function blockToEmailHtml(node: RichTextNode): string {
  switch (node.type) {
    case "paragraph": {
      const inner = inlineToEmailHtml(node.content);
      return `<p style="margin: 0 0 12px 0; font-family: ${EMAIL_FONT}; font-size: 15px; line-height: 1.55; color: ${EMAIL_TEXT_COLOR};${alignStyle(node)}">${inner.length > 0 ? inner : "&nbsp;"}</p>`;
    }
    case "heading": {
      const level = node.attrs?.["level"] === 3 ? 3 : 2;
      const size = level === 2 ? "20px" : "17px";
      const inner = inlineToEmailHtml(node.content);
      return `<h${level} style="margin: 20px 0 8px 0; font-family: ${EMAIL_FONT}; font-size: ${size}; line-height: 1.3; color: ${EMAIL_TEXT_COLOR}; font-weight: 700;${alignStyle(node)}">${inner}</h${level}>`;
    }
    case "bulletList":
    case "orderedList": {
      const tag = node.type === "orderedList" ? "ol" : "ul";
      const start =
        node.type === "orderedList" &&
        typeof node.attrs?.["start"] === "number" &&
        (node.attrs["start"] as number) > 1
          ? ` start="${node.attrs["start"] as number}"`
          : "";
      const listItems = Array.isArray(node.content) ? node.content : [];
      const items = listItems
        .filter((item) => item != null && typeof item === "object")
        .map((item) => {
          const children = Array.isArray(item.content) ? item.content : [];
          const inner = children
            .filter((child) => child != null && typeof child === "object")
            .map((child) => blockToEmailHtml(child))
            .join("");
          return `<li style="margin: 0 0 4px 0;">${inner}</li>`;
        })
        .join("");
      return `<${tag}${start} style="margin: 0 0 12px 0; padding-left: 24px; font-family: ${EMAIL_FONT}; font-size: 15px; line-height: 1.55; color: ${EMAIL_TEXT_COLOR};">${items}</${tag}>`;
    }
    default: {
      // Unknown block: emit escaped text content only.
      const text = inlineToPlainText(node.content);
      return text.length > 0
        ? `<p style="margin: 0 0 12px 0; font-family: ${EMAIL_FONT}; font-size: 15px; line-height: 1.55; color: ${EMAIL_TEXT_COLOR};">${escapeHtml(text)}</p>`
        : "";
    }
  }
}

/**
 * Email-HTML serializer — inline-styled minimal fragment for message bodies.
 * All text content is HTML-escaped here, so merge values applied to the DOC
 * (see mergeRichTextValues) can never become markup. No images this wave.
 */
export function richTextToEmailHtml(
  envelope: RichTextEnvelope | null | undefined,
): string {
  if (envelope == null) return "";
  const blocks = Array.isArray(envelope.doc?.content)
    ? envelope.doc.content
    : [];
  return blocks
    .filter((b) => b != null && typeof b === "object")
    .map((b) => blockToEmailHtml(b))
    .join("\n");
}

// ---------------------------------------------------------------------------
// Merge fields (comms) — merge BEFORE serialization, values stay text
// ---------------------------------------------------------------------------

/**
 * Apply `{{name}}` merge values to every text node of a doc. Values are
 * inserted as TEXT NODE CONTENT (doc-space) BEFORE serialization, so the
 * plain-text part and the HTML part are serialized from one merged doc and
 * the HTML serializer escapes recipient data like any other text.
 * Missing keys are left as literal `{{name}}` and reported (trust-before-send).
 */
export function mergeRichTextValues(
  envelope: RichTextEnvelope,
  data: Record<string, string | null | undefined>,
): { envelope: RichTextEnvelope; missingFields: string[] } {
  const missing = new Set<string>();
  const mergeNode = (node: RichTextNode): RichTextNode => {
    const next: RichTextNode = { ...node };
    if (node.type === "text" && typeof node.text === "string") {
      next.text = node.text.replace(
        /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g,
        (_full, name: string) => {
          const value = data[name];
          if (value === undefined || value === null || value === "") {
            missing.add(name);
            return `{{${name}}}`;
          }
          return value;
        },
      );
    }
    if (node.content) next.content = node.content.map(mergeNode);
    return next;
  };
  return {
    envelope: {
      schema: envelope.schema,
      doc: mergeNode(envelope.doc as unknown as RichTextNode) as RichTextDoc,
    },
    missingFields: [...missing],
  };
}

// ---------------------------------------------------------------------------
// Authoring normalization (client-side, before save — NOT the API gate)
// ---------------------------------------------------------------------------

/**
 * Normalize a TipTap getJSON() doc into canonical stored form: link marks
 * reduced to `{ href }`, null/absent attrs dropped, `textAlign: "left"` and
 * `heading level` defaults preserved. This is authoring-time canonicalization
 * in the EDITOR save path only — the API still REJECTS (never strips) any
 * doc that fails its context schema.
 */
export function normalizeRichTextDoc(doc: unknown): RichTextDoc {
  const normNode = (raw: unknown): RichTextNode | null => {
    if (typeof raw !== "object" || raw === null) return null;
    const node = raw as RichTextNode;
    if (typeof node.type !== "string") return null;
    const out: RichTextNode = { type: node.type };
    if (typeof node.text === "string") out.text = node.text;
    if (Array.isArray(node.marks)) {
      const marks: RichTextMark[] = [];
      for (const mark of node.marks) {
        if (typeof mark !== "object" || mark === null) continue;
        const m = mark as RichTextMark;
        if (typeof m.type !== "string") continue;
        if (m.type === "link") {
          const href = m.attrs?.["href"];
          if (typeof href === "string") {
            marks.push({ type: "link", attrs: { href } });
          }
          continue;
        }
        marks.push({ type: m.type });
      }
      if (marks.length > 0) out.marks = marks;
    }
    if (node.attrs && typeof node.attrs === "object") {
      const attrs: Record<string, unknown> = {};
      const level = node.attrs["level"];
      if (node.type === "heading" && typeof level === "number") {
        attrs["level"] = level;
      }
      const textAlign = node.attrs["textAlign"];
      if (
        (node.type === "paragraph" || node.type === "heading") &&
        (textAlign === "left" || textAlign === "center" || textAlign === "right")
      ) {
        if (textAlign !== "left") attrs["textAlign"] = textAlign;
      }
      const start = node.attrs["start"];
      if (
        node.type === "orderedList" &&
        typeof start === "number" &&
        start !== 1
      ) {
        attrs["start"] = start;
      }
      if (Object.keys(attrs).length > 0) out.attrs = attrs;
    }
    if (Array.isArray(node.content)) {
      const content = node.content
        .map(normNode)
        .filter((n): n is RichTextNode => n !== null);
      if (content.length > 0) out.content = content;
    }
    return out;
  };
  const normalized = normNode(doc);
  if (
    normalized == null ||
    normalized.type !== "doc" ||
    !Array.isArray(normalized.content)
  ) {
    return emptyRichText().doc;
  }
  return normalized as RichTextDoc;
}

/** Wrap a TipTap getJSON() doc in the canonical versioned envelope. */
export function richTextEnvelopeFromEditorDoc(doc: unknown): RichTextEnvelope {
  return {
    schema: RICH_TEXT_SCHEMA_VERSION,
    doc: normalizeRichTextDoc(doc),
  };
}

/**
 * Optional-nullable Zod wrapper used by request bodies: accepts a rich-text
 * envelope for the given context, or null to clear.
 */
export function richTextBodyField(
  context: RichTextContext,
): z.ZodType<RichTextEnvelope | null | undefined> {
  return richTextSchemaForContext(context)
    .nullable()
    .optional() as z.ZodType<RichTextEnvelope | null | undefined>;
}
