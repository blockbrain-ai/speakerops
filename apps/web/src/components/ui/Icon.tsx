/**
 * First-party Lumen 2 icons — 24×24 viewBox, stroke 1.75 (section 11.0).
 * No icon package dependency (AC-11.0-E).
 */
import type { SVGProps } from "react";

export type IconName =
  | "check"
  | "close"
  | "warning"
  | "info"
  | "plus"
  | "search"
  | "chevron-down"
  | "chevron-right"
  | "chevron-left"
  | "trash"
  | "edit"
  | "mail"
  | "users"
  | "calendar"
  | "settings"
  | "home"
  | "external"
  | "inbox"
  | "clock"
  | "file"
  | "filter"
  | "more"
  | "spark"
  // Rich-text toolbar icons (F2) — same 24×24 stroke-1.75 family.
  | "bold"
  | "italic"
  | "underline"
  | "superscript"
  | "subscript"
  | "link"
  | "list-bullet"
  | "list-ordered"
  | "indent"
  | "outdent"
  | "align-left"
  | "align-center"
  | "align-right"
  | "clear-format"
  // Public chrome source marks — same 24×24 stroke-1.75 family (not brand-fill).
  | "github"
  | "forge";

export type IconSize = "sm" | "md" | "lg";

/** Path data for each semantic icon (stroke-based, 24×24). */
const PATHS: Record<IconName, string> = {
  check: "M5 12l5 5L20 7",
  close: "M6 6l12 12M18 6L6 18",
  warning:
    "M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z",
  info: "M12 16v-4m0-4h.01M12 21a9 9 0 100-18 9 9 0 000 18z",
  plus: "M12 5v14M5 12h14",
  search: "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35",
  "chevron-down": "M6 9l6 6 6-6",
  "chevron-right": "M9 6l6 6-6 6",
  "chevron-left": "M15 18l-6-6 6-6",
  trash: "M3 6h18M8 6V4h8v2m-1 0v14a1 1 0 01-1 1H9a1 1 0 01-1-1V6h10z",
  edit: "M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z",
  mail: "M4 6h16v12H4V6zm0 0l8 7 8-7",
  users:
    "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zm13 10v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  calendar:
    "M8 2v3M16 2v3M4 9h16M6 4h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2z",
  settings:
    "M12 15a3 3 0 100-6 3 3 0 000 6zm7.4-3a7.4 7.4 0 01-.1 1.1l2 1.5-2 3.5-2.3-1a7.5 7.5 0 01-1.9 1.1L14.5 21h-5l-.6-2.8a7.5 7.5 0 01-1.9-1.1l-2.3 1-2-3.5 2-1.5A7.4 7.4 0 014.6 12a7.4 7.4 0 01.1-1.1l-2-1.5 2-3.5 2.3 1a7.5 7.5 0 011.9-1.1L9.5 3h5l.6 2.8a7.5 7.5 0 011.9 1.1l2.3-1 2 3.5-2 1.5c.1.36.1.73.1 1.1z",
  home: "M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1v-9.5z",
  external: "M14 4h6v6M20 4l-9 9M10 6H5a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1v-5",
  inbox:
    "M4 6h16v12H4V6zm0 8h4l2 2h4l2-2h4",
  clock: "M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z",
  file: "M14 3H7a1 1 0 00-1 1v16a1 1 0 001 1h10a1 1 0 001-1V8l-4-5zM14 3v5h5",
  filter: "M4 5h16l-6 7v5l-4 2v-7L4 5z",
  more: "M6 12h.01M12 12h.01M18 12h.01",
  spark: "M12 3v4M12 17v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M3 12h4M17 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8",
  // Rich-text toolbar (F2)
  bold: "M7 4h6a3.5 3.5 0 010 7H7V4zm0 7h7a3.5 3.5 0 010 7H7v-7z",
  italic: "M14 4h5M5 20h5M15 4l-6 16",
  underline: "M6 3v7a6 6 0 0012 0V3M5 21h14",
  superscript:
    "M4 6l8 12M12 6L4 18M17 4c2-1.5 4 .5 2.5 2L17 8.5h4",
  subscript: "M4 5l8 12M12 5L4 17M17 15c2-1.5 4 .5 2.5 2L17 19.5h4",
  link:
    "M10 14a5 5 0 007.07 0l2.5-2.5a5 5 0 00-7.07-7.07L11 5.9M14 10a5 5 0 00-7.07 0l-2.5 2.5a5 5 0 007.07 7.07L13 18.1",
  "list-bullet": "M9 6h12M9 12h12M9 18h12M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  "list-ordered":
    "M10 6h11M10 12h11M10 18h11M4 5l1.5-1v5M4 13.5c0-1 2-1.5 2-.5 0 .8-2 1.5-2 3h2.5",
  indent: "M11 6h10M11 12h10M3 12h4m0 0l-2.5-2.5M7 12l-2.5 2.5M11 18h10",
  outdent: "M11 6h10M11 12h10M7 12H3m0 0l2.5-2.5M3 12l2.5 2.5M11 18h10",
  "align-left": "M4 6h16M4 10h10M4 14h16M4 18h10",
  "align-center": "M4 6h16M7 10h10M4 14h16M7 18h10",
  "align-right": "M4 6h16M10 10h10M4 14h16M10 18h10",
  "clear-format": "M6 4h12M9 4l-2 16h4M14 14l6 6m0-6l-6 6",
  // Feather-family GitHub mark (stroke). Official octocat is a filled silhouette.
  github:
    "M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22",
  // Stroke mallet of the SmolForge hammer (official mark is multi-colour fill).
  forge: "M5 6h14a2 2 0 012 2v3H3V8a2 2 0 012-2zM11 11v8a1 1 0 002 0v-8",
};

export type IconProps = {
  name: IconName;
  size?: IconSize;
  className?: string;
  title?: string;
  /** Decorative when no title; hides from AT. */
  decorative?: boolean;
} & Omit<SVGProps<SVGSVGElement>, "name" | "children">;

const SIZE_CLASS: Record<IconSize, string> = {
  sm: "l2-icon--sm",
  md: "l2-icon--md",
  lg: "l2-icon--lg",
};

export function Icon({
  name,
  size = "md",
  className = "",
  title,
  decorative = !title,
  ...rest
}: IconProps) {
  const path = PATHS[name];
  const classes = ["l2-icon", SIZE_CLASS[size], className].filter(Boolean).join(" ");

  return (
    <svg
      className={classes}
      viewBox="0 0 24 24"
      width={size === "sm" ? 16 : size === "lg" ? 24 : 20}
      height={size === "sm" ? 16 : size === "lg" ? 24 : 20}
      aria-hidden={decorative ? true : undefined}
      role={decorative ? undefined : "img"}
      data-icon={name}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <path d={path} />
    </svg>
  );
}

export const ICON_NAMES = Object.keys(PATHS) as IconName[];
