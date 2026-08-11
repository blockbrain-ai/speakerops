/**
 * RichTextEditor — the F2 rich-text platform primitive (TipTap v3 on
 * ProseMirror; never hand-rolled contentEditable).
 *
 * One component, two variants:
 *  - "full"    — B/I/U, x²/x₂, H2/H3 (heading contexts), link, lists,
 *                indent/outdent, align L/C/R, clear-format.
 *  - "compact" — B/I/U, lists, align, link, clear.
 * The image button is deliberately ABSENT — image support is cut from this
 * wave (F2 correction #5).
 *
 * Context drives the schema: extensions outside the context allowlist are
 * never registered, so pasted content (Docs/Word) is sanitized by the
 * ProseMirror schema itself. StarterKit v3 bundles Link + Underline — they
 * are configured, not double-registered (F2 correction #6).
 *
 * Output is the canonical versioned envelope via
 * richTextEnvelopeFromEditorDoc (authoring normalization); the API still
 * REJECTS anything outside its per-context Zod schema.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Superscript from "@tiptap/extension-superscript";
import Subscript from "@tiptap/extension-subscript";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import {
  isAllowedRichTextHref,
  richTextCharCount,
  richTextEnvelopeFromEditorDoc,
  richTextIsEmpty,
  type RichTextContext,
  type RichTextEnvelope,
} from "@speakerops/shared";
import { Icon, type IconName } from "../ui/index.js";
import {
  charCountLabel,
  charCountTone,
} from "../forms/char-count.js";

export type RichTextEditorVariant = "full" | "compact";

export type RichTextEditorProps = {
  /** Stored doc (envelope) or null for empty. */
  value: RichTextEnvelope | null;
  /**
   * Fired on every doc change with the normalized envelope (null when the
   * doc has no visible text).
   */
  onChange: (value: RichTextEnvelope | null) => void;
  /** Per-context schema — controls headings/super/sub availability. */
  context: RichTextContext;
  variant?: RichTextEditorVariant;
  /** data-testid applied to the contenteditable surface (inventory anchor). */
  "data-testid"?: string;
  /** id applied to the contenteditable surface (label wiring). */
  id?: string;
  /** Editor is labelled by its field label (a11y). */
  ariaLabelledBy?: string;
  ariaLabel?: string;
  placeholder?: string;
  /** Plain-text char cap — counter + typing limit (richTextCharCount). */
  maxChars?: number | null;
  disabled?: boolean;
};

/** Contexts whose allowlist includes headings + super/subscript. */
function contextAllowsHeadings(context: RichTextContext): boolean {
  return context === "cfpContent" || context === "email";
}

type ToolbarAction = {
  key: string;
  icon: IconName;
  label: string;
  isActive?: (editor: Editor) => boolean;
  isDisabled?: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
  /** Text stand-in for icon (H2/H3). */
  text?: string;
};

type ToolbarItem = ToolbarAction | { key: string; divider: true };

function isDivider(item: ToolbarItem): item is { key: string; divider: true } {
  return (item as { divider?: boolean }).divider === true;
}

function buildToolbar(
  variant: RichTextEditorVariant,
  context: RichTextContext,
  openLinkDialog: () => void,
): ToolbarItem[] {
  const headings = contextAllowsHeadings(context);
  const full = variant === "full";
  const items: ToolbarItem[] = [
    {
      key: "bold",
      icon: "bold",
      label: "Bold",
      isActive: (e) => e.isActive("bold"),
      run: (e) => e.chain().focus().toggleBold().run(),
    },
    {
      key: "italic",
      icon: "italic",
      label: "Italic",
      isActive: (e) => e.isActive("italic"),
      run: (e) => e.chain().focus().toggleItalic().run(),
    },
    {
      key: "underline",
      icon: "underline",
      label: "Underline",
      isActive: (e) => e.isActive("underline"),
      run: (e) => e.chain().focus().toggleUnderline().run(),
    },
  ];
  if (full && headings) {
    items.push(
      { key: "d1", divider: true },
      {
        key: "h2",
        icon: "edit",
        text: "H2",
        label: "Heading level 2",
        isActive: (e) => e.isActive("heading", { level: 2 }),
        run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
      },
      {
        key: "h3",
        icon: "edit",
        text: "H3",
        label: "Heading level 3",
        isActive: (e) => e.isActive("heading", { level: 3 }),
        run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
      },
    );
  }
  if (full && headings) {
    items.push(
      { key: "d2", divider: true },
      {
        key: "superscript",
        icon: "superscript",
        label: "Superscript",
        isActive: (e) => e.isActive("superscript"),
        run: (e) => e.chain().focus().toggleSuperscript().run(),
      },
      {
        key: "subscript",
        icon: "subscript",
        label: "Subscript",
        isActive: (e) => e.isActive("subscript"),
        run: (e) => e.chain().focus().toggleSubscript().run(),
      },
    );
  }
  items.push(
    { key: "d3", divider: true },
    {
      key: "link",
      icon: "link",
      label: "Link",
      isActive: (e) => e.isActive("link"),
      run: () => openLinkDialog(),
    },
    { key: "d4", divider: true },
    {
      key: "bulletList",
      icon: "list-bullet",
      label: "Bullet list",
      isActive: (e) => e.isActive("bulletList"),
      run: (e) => e.chain().focus().toggleBulletList().run(),
    },
    {
      key: "orderedList",
      icon: "list-ordered",
      label: "Numbered list",
      isActive: (e) => e.isActive("orderedList"),
      run: (e) => e.chain().focus().toggleOrderedList().run(),
    },
  );
  if (full) {
    items.push(
      {
        key: "indent",
        icon: "indent",
        label: "Indent list item",
        isDisabled: (e) => !e.can().sinkListItem("listItem"),
        run: (e) => e.chain().focus().sinkListItem("listItem").run(),
      },
      {
        key: "outdent",
        icon: "outdent",
        label: "Outdent list item",
        isDisabled: (e) => !e.can().liftListItem("listItem"),
        run: (e) => e.chain().focus().liftListItem("listItem").run(),
      },
    );
  }
  items.push(
    { key: "d5", divider: true },
    {
      key: "align-left",
      icon: "align-left",
      label: "Align left",
      isActive: (e) => e.isActive({ textAlign: "left" }),
      run: (e) => e.chain().focus().setTextAlign("left").run(),
    },
    {
      key: "align-center",
      icon: "align-center",
      label: "Align center",
      isActive: (e) => e.isActive({ textAlign: "center" }),
      run: (e) => e.chain().focus().setTextAlign("center").run(),
    },
    {
      key: "align-right",
      icon: "align-right",
      label: "Align right",
      isActive: (e) => e.isActive({ textAlign: "right" }),
      run: (e) => e.chain().focus().setTextAlign("right").run(),
    },
    { key: "d6", divider: true },
    {
      key: "clear-format",
      icon: "clear-format",
      label: "Clear formatting",
      run: (e) => e.chain().focus().unsetAllMarks().clearNodes().run(),
    },
  );
  // NOTE: no image button — image support is cut from this wave (F2 #5).
  return items;
}

/** Normalize a user-typed URL: default to https:// when no scheme given. */
export function normalizeLinkInput(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function RichTextEditor({
  value,
  onChange,
  context,
  variant = "full",
  "data-testid": testId,
  id,
  ariaLabelledBy,
  ariaLabel,
  placeholder,
  maxChars,
  disabled = false,
}: RichTextEditorProps): ReactNode {
  const headings = contextAllowsHeadings(context);
  const lastEmittedRef = useRef<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [, setSelectionTick] = useState(0);
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  const extensions = useMemo(() => {
    const list = [
      // StarterKit v3 bundles Link + Underline (do NOT double-register);
      // nodes/marks outside the context allowlist are explicitly disabled.
      StarterKit.configure({
        heading: headings ? { levels: [2, 3] } : false,
        blockquote: false,
        codeBlock: false,
        code: false,
        strike: false,
        horizontalRule: false,
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          protocols: ["https", "mailto"],
        },
      }),
      TextAlign.configure({
        types: headings ? ["heading", "paragraph"] : ["paragraph"],
        alignments: ["left", "center", "right"],
      }),
      CharacterCount.configure(
        maxChars != null ? { limit: maxChars } : {},
      ),
      ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
      ...(variant === "full" && headings ? [Superscript, Subscript] : []),
    ];
    return list;
    // Extensions are structural — context/variant/maxChars never change
    // within one mounted editor in practice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, variant, headings, maxChars, placeholder]);

  const editor = useEditor(
    {
      extensions,
      content: value ? value.doc : undefined,
      editable: !disabled,
      // SSR/unit-test safety (TipTap v3): never render synchronously into DOM
      // during React render.
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: "l2-rte__content lumen-focusable",
          role: "textbox",
          "aria-multiline": "true",
          // contenteditable=false alone does not announce as disabled —
          // role=textbox needs an explicit aria-disabled state (a11y + tests).
          "aria-disabled": disabled ? "true" : "false",
          ...(id ? { id } : {}),
          ...(testId ? { "data-testid": testId } : {}),
          ...(ariaLabelledBy ? { "aria-labelledby": ariaLabelledBy } : {}),
          ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
        },
      },
      onUpdate: ({ editor: e }) => {
        const envelope = richTextEnvelopeFromEditorDoc(e.getJSON());
        const next = richTextIsEmpty(envelope) ? null : envelope;
        lastEmittedRef.current = next ? JSON.stringify(next) : null;
        onChange(next);
      },
      onSelectionUpdate: () => {
        // Re-render so aria-pressed states track the caret.
        setSelectionTick((t) => t + 1);
      },
    },
    // Recreate only on structural change.
    [context, variant, disabled],
  );

  // External value sync (load-after-mount, reset) without update loops.
  useEffect(() => {
    if (!editor) return;
    const incoming = value ? JSON.stringify(value) : null;
    if (incoming === lastEmittedRef.current) return;
    lastEmittedRef.current = incoming;
    editor.commands.setContent(value ? value.doc : "", {
      emitUpdate: false,
    });
  }, [editor, value]);

  const openLinkDialog = useCallback(() => {
    if (!editor) return;
    const current = editor.getAttributes("link")["href"];
    setLinkValue(typeof current === "string" ? current : "");
    setLinkError(null);
    setLinkOpen(true);
  }, [editor]);

  const applyLink = useCallback(() => {
    if (!editor) return;
    const normalized = normalizeLinkInput(linkValue);
    if (normalized === "") {
      editor.chain().focus().unsetLink().run();
      setLinkOpen(false);
      return;
    }
    if (!isAllowedRichTextHref(normalized)) {
      setLinkError("Enter a valid https:// or mailto: link");
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: normalized })
      .run();
    setLinkOpen(false);
  }, [editor, linkValue]);

  const removeLink = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkOpen(false);
  }, [editor]);

  const toolbar = useMemo(
    () => buildToolbar(variant, context, openLinkDialog),
    [variant, context, openLinkDialog],
  );

  // Toolbar roving focus: arrow keys move between buttons (a11y law).
  const onToolbarKeyDown = useCallback((ev: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(ev.key)) return;
    const root = toolbarRef.current;
    if (!root) return;
    const buttons = Array.from(
      root.querySelectorAll<HTMLButtonElement>("button:not([disabled])"),
    );
    if (buttons.length === 0) return;
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = idx;
    if (ev.key === "ArrowLeft") next = idx <= 0 ? buttons.length - 1 : idx - 1;
    if (ev.key === "ArrowRight") next = idx === buttons.length - 1 ? 0 : idx + 1;
    if (ev.key === "Home") next = 0;
    if (ev.key === "End") next = buttons.length - 1;
    ev.preventDefault();
    buttons[next]?.focus();
  }, []);

  const currentDoc: RichTextEnvelope | null = editor
    ? richTextEnvelopeFromEditorDoc(editor.getJSON())
    : value;
  const count = richTextCharCount(
    currentDoc && !richTextIsEmpty(currentDoc) ? currentDoc : null,
  );

  return (
    <div
      className={`l2-rte l2-rte--${variant}${disabled ? " is-disabled" : ""}`}
      data-context={context}
    >
      <div
        ref={toolbarRef}
        role="toolbar"
        aria-label={variant === "full" ? "Formatting" : "Formatting (compact)"}
        aria-orientation="horizontal"
        className="l2-rte__toolbar"
        data-testid={testId ? `${testId}-toolbar` : undefined}
        onKeyDown={onToolbarKeyDown}
      >
        {toolbar.map((item, i) =>
          isDivider(item) ? (
            <span key={item.key} className="l2-rte__divider" aria-hidden="true" />
          ) : (
            <button
              key={item.key}
              type="button"
              className={`l2-rte__btn lumen-focusable${
                editor && item.isActive?.(editor) ? " is-active" : ""
              }`}
              aria-label={item.label}
              title={item.label}
              aria-pressed={
                item.isActive ? (editor ? item.isActive(editor) : false) : undefined
              }
              disabled={
                disabled || !editor || (editor && item.isDisabled?.(editor)) === true
              }
              tabIndex={i === 0 ? 0 : -1}
              data-testid={testId ? `${testId}-btn-${item.key}` : undefined}
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => editor && item.run(editor)}
            >
              {item.text ? (
                <span className="l2-rte__btn-text">{item.text}</span>
              ) : (
                <Icon name={item.icon} size="sm" decorative />
              )}
            </button>
          ),
        )}
      </div>
      {linkOpen ? (
        <div
          className="l2-rte__linkbar"
          data-testid={testId ? `${testId}-linkbar` : undefined}
        >
          <input
            className="l2-rte__linkinput lumen-focusable"
            type="text"
            inputMode="url"
            placeholder="https://example.com"
            aria-label="Link URL"
            value={linkValue}
            data-testid={testId ? `${testId}-link-input` : undefined}
            onChange={(ev) => {
              setLinkValue(ev.target.value);
              setLinkError(null);
            }}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") {
                ev.preventDefault();
                applyLink();
              }
              if (ev.key === "Escape") setLinkOpen(false);
            }}
          />
          <button
            type="button"
            className="l2-rte__btn l2-rte__btn--label lumen-focusable"
            data-testid={testId ? `${testId}-link-apply` : undefined}
            onClick={applyLink}
          >
            Set link
          </button>
          <button
            type="button"
            className="l2-rte__btn l2-rte__btn--label lumen-focusable"
            data-testid={testId ? `${testId}-link-remove` : undefined}
            onClick={removeLink}
          >
            Remove
          </button>
          <button
            type="button"
            className="l2-rte__btn l2-rte__btn--label lumen-focusable"
            data-testid={testId ? `${testId}-link-cancel` : undefined}
            onClick={() => setLinkOpen(false)}
          >
            Cancel
          </button>
          {linkError ? (
            <span
              className="l2-rte__linkerror"
              role="alert"
              data-testid={testId ? `${testId}-link-error` : undefined}
            >
              {linkError}
            </span>
          ) : null}
        </div>
      ) : null}
      <EditorContent editor={editor} className="l2-rte__surface" />
      {maxChars != null ? (
        <p
          className="l2-rte__count"
          data-tone={charCountTone(count, maxChars)}
          data-testid={testId ? `${testId}-count` : undefined}
          aria-live="polite"
        >
          {charCountLabel(count, maxChars)}
        </p>
      ) : null}
    </div>
  );
}
