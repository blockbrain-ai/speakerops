/**
 * Section 9.5 — Beautiful HTML reports portal (S-DOCS).
 *
 * Builds offline-readable Lumen-styled reports under `reports/`:
 *   index.html, onboarding.html, agent-setup.html, architecture.html,
 *   cli-reference.html, design-lumen.html, and links/refreshes e2e-coverage.html.
 *
 * CLI (non-interactive):
 *   pnpm docs:reports
 *   tsx scripts/build-docs-reports.ts
 *   tsx scripts/build-docs-reports.ts --out-dir=path --no-e2e
 *
 * Env **names** only (E10):
 *   DOCS_REPORTS_DIR — output directory (default reports/)
 *
 * Never logs secrets, API keys, or magic-link tokens.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildE2eReport } from "./build-e2e-report.js";

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Escape text for HTML text/attr contexts. */
export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Resolve short git SHA for footer (no network). */
export function resolveGitSha(root: string, override?: string): string {
  if (override && override.trim()) return override.trim();
  try {
    const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      shell: false,
    });
    if (r.status === 0 && r.stdout?.trim()) return r.stdout.trim();
  } catch {
    /* ignore */
  }
  return "unknown";
}

/** Lumen tokens inlined for offline HTML (E6 — no freeform palette). */
export const LUMEN_REPORTS_CSS = `
:root {
  --lumen-bg: #f5f5f7;
  --lumen-surface: #ffffff;
  --lumen-text: #1d1d1f;
  --lumen-text-secondary: #6e6e73;
  --lumen-border: rgba(0, 0, 0, 0.08);
  --lumen-brand: #4f46e5;
  --lumen-brand-soft: #eef2ff;
  --lumen-accent: #0d9488;
  --lumen-success: #059669;
  --lumen-warn: #d97706;
  --lumen-danger: #dc2626;
  --lumen-info: #0284c7;
  --lumen-radius-sm: 8px;
  --lumen-radius-md: 12px;
  --lumen-radius-lg: 16px;
  --lumen-radius-xl: 22px;
  --lumen-radius-pill: 9999px;
  --lumen-font: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --lumen-shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.03);
  --lumen-focus: #4f46e5;
  --lumen-focus-ring: 0 0 0 3px rgba(79, 70, 229, 0.35);
  --lumen-space-1: 4px;
  --lumen-space-2: 8px;
  --lumen-space-3: 12px;
  --lumen-space-4: 16px;
  --lumen-space-6: 24px;
  --lumen-success-soft: #d1fae5;
  --lumen-warn-soft: #fef3c7;
  --lumen-danger-soft: #fee2e2;
  --lumen-info-soft: #e0f2fe;
}
html { color-scheme: light; }
body {
  margin: 0;
  min-height: 100vh;
  font-family: var(--lumen-font);
  font-size: 15px;
  line-height: 1.55;
  color: var(--lumen-text);
  background: var(--lumen-bg);
  -webkit-font-smoothing: antialiased;
}
*, *::before, *::after { box-sizing: border-box; }
a { color: var(--lumen-brand); text-decoration: none; }
a:hover { text-decoration: underline; }
a:focus-visible {
  outline: none;
  box-shadow: var(--lumen-focus-ring);
  border-radius: 2px;
}
.site-header {
  background: var(--lumen-surface);
  border-bottom: 1px solid var(--lumen-border);
  position: sticky;
  top: 0;
  z-index: 10;
}
.site-header-inner {
  max-width: 1100px;
  margin: 0 auto;
  padding: var(--lumen-space-3) var(--lumen-space-4);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--lumen-space-3);
}
.brand {
  font-weight: 650;
  letter-spacing: -0.02em;
  color: var(--lumen-text);
  text-decoration: none;
  margin-right: var(--lumen-space-2);
}
.brand:hover { color: var(--lumen-brand); text-decoration: none; }
.brand span { color: var(--lumen-brand); }
.nav {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 6px;
  align-items: center;
}
.nav a {
  font-size: 13px;
  padding: 6px 10px;
  border-radius: var(--lumen-radius-pill);
  color: var(--lumen-text-secondary);
  border: 1px solid transparent;
}
.nav a:hover {
  color: var(--lumen-brand);
  background: var(--lumen-brand-soft);
  text-decoration: none;
}
.nav a[aria-current="page"] {
  color: var(--lumen-brand);
  background: var(--lumen-brand-soft);
  border-color: transparent;
  font-weight: 600;
}
.wrap {
  max-width: 1100px;
  margin: 0 auto;
  padding: var(--lumen-space-6) var(--lumen-space-4);
}
header.card, .card, article.prose {
  background: var(--lumen-surface);
  border: 1px solid var(--lumen-border);
  border-radius: var(--lumen-radius-lg);
  box-shadow: var(--lumen-shadow-sm);
  padding: var(--lumen-space-6);
  margin-bottom: var(--lumen-space-6);
}
h1 {
  margin: 0 0 var(--lumen-space-2);
  font-size: 1.65rem;
  font-weight: 650;
  letter-spacing: -0.03em;
  line-height: 1.25;
}
h2 {
  margin: var(--lumen-space-6) 0 var(--lumen-space-3);
  font-size: 1.2rem;
  font-weight: 650;
  letter-spacing: -0.02em;
  padding-top: var(--lumen-space-2);
  border-top: 1px solid var(--lumen-border);
}
h2:first-child { border-top: none; padding-top: 0; margin-top: 0; }
h3 {
  margin: var(--lumen-space-4) 0 var(--lumen-space-2);
  font-size: 1.05rem;
  font-weight: 600;
}
h4 {
  margin: var(--lumen-space-3) 0 var(--lumen-space-2);
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--lumen-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.sub {
  color: var(--lumen-text-secondary);
  margin: 0 0 var(--lumen-space-4);
}
.badges { display: flex; flex-wrap: wrap; gap: var(--lumen-space-2); margin-top: var(--lumen-space-3); }
.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  border: 1px solid var(--lumen-border);
  background: var(--lumen-brand-soft);
  color: var(--lumen-brand);
}
.badge.accent { background: var(--lumen-info-soft); color: var(--lumen-accent); border-color: transparent; }
.badge.success { background: var(--lumen-success-soft); color: var(--lumen-success); border-color: transparent; }
.report-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--lumen-space-4);
}
.report-card {
  display: flex;
  flex-direction: column;
  gap: var(--lumen-space-2);
  background: var(--lumen-surface);
  border: 1px solid var(--lumen-border);
  border-radius: var(--lumen-radius-lg);
  box-shadow: var(--lumen-shadow-sm);
  padding: var(--lumen-space-6) var(--lumen-space-4);
  text-decoration: none;
  color: inherit;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}
.report-card:hover {
  border-color: var(--lumen-brand);
  box-shadow: var(--lumen-shadow-sm);
  text-decoration: none;
}
.report-card h2 {
  margin: 0;
  border: none;
  padding: 0;
  font-size: 1.05rem;
  color: var(--lumen-text);
}
.report-card p {
  margin: 0;
  color: var(--lumen-text-secondary);
  font-size: 13px;
  flex: 1;
}
.report-card .meta {
  font-size: 12px;
  color: var(--lumen-brand);
  font-weight: 600;
}
.prose p { margin: 0 0 var(--lumen-space-3); }
.prose ul, .prose ol {
  margin: 0 0 var(--lumen-space-3);
  padding-left: 1.4rem;
}
.prose li { margin-bottom: 4px; }
.prose blockquote {
  margin: 0 0 var(--lumen-space-4);
  padding: var(--lumen-space-3) var(--lumen-space-4);
  border-left: 3px solid var(--lumen-brand);
  background: var(--lumen-brand-soft);
  border-radius: 0 var(--lumen-radius-sm) var(--lumen-radius-sm) 0;
  color: var(--lumen-text);
}
.prose blockquote p:last-child { margin-bottom: 0; }
.prose hr {
  border: none;
  border-top: 1px solid var(--lumen-border);
  margin: var(--lumen-space-6) 0;
}
.prose pre {
  margin: 0 0 var(--lumen-space-4);
  padding: var(--lumen-space-3) var(--lumen-space-4);
  background: var(--lumen-bg);
  border: 1px solid var(--lumen-border);
  border-radius: var(--lumen-radius-md);
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.45;
}
.prose code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.9em;
}
.prose :not(pre) > code {
  background: var(--lumen-brand-soft);
  color: var(--lumen-brand);
  padding: 1px 6px;
  border-radius: 4px;
}
.prose pre code {
  background: none;
  color: inherit;
  padding: 0;
  border-radius: 0;
  font-size: 13px;
}
.prose table {
  width: 100%;
  border-collapse: collapse;
  background: var(--lumen-surface);
  border: 1px solid var(--lumen-border);
  border-radius: var(--lumen-radius-md);
  overflow: hidden;
  margin: 0 0 var(--lumen-space-4);
  font-size: 14px;
}
.prose th, .prose td {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid var(--lumen-border);
  vertical-align: top;
}
.prose th {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--lumen-text-secondary);
  background: var(--lumen-bg);
}
.prose tr:last-child td { border-bottom: none; }
.prose img { max-width: 100%; height: auto; }
.muted { color: var(--lumen-text-secondary); font-size: 12px; }
.source-note {
  font-size: 13px;
  color: var(--lumen-text-secondary);
  margin: 0 0 var(--lumen-space-4);
}
footer.report-footer {
  margin-top: var(--lumen-space-6);
  padding: var(--lumen-space-4) var(--lumen-space-6);
  background: var(--lumen-surface);
  border: 1px solid var(--lumen-border);
  border-radius: var(--lumen-radius-md);
  color: var(--lumen-text-secondary);
  font-size: 13px;
}
footer.report-footer code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: var(--lumen-text);
}
.swatch-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lumen-space-3);
  margin: var(--lumen-space-4) 0;
}
.swatch {
  width: 96px;
  border-radius: var(--lumen-radius-md);
  border: 1px solid var(--lumen-border);
  overflow: hidden;
  background: var(--lumen-surface);
  box-shadow: var(--lumen-shadow-sm);
}
.swatch .chip {
  height: 48px;
}
.swatch .label {
  padding: 6px 8px;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
@media (prefers-reduced-motion: reduce) {
  .report-card { transition: none; }
}
`.trim();

export type ReportPageId =
  | "index"
  | "onboarding"
  | "agent-setup"
  | "architecture"
  | "cli-reference"
  | "design-lumen"
  | "e2e-coverage";

export type ReportPageMeta = {
  id: ReportPageId;
  file: string;
  title: string;
  description: string;
  soul: string;
  /** Markdown source relative to repo root (null for portal / e2e builder). */
  source: string | null;
};

/** Portal + generated report set (0.5 outline). */
export const REPORT_PAGES: ReportPageMeta[] = [
  {
    id: "index",
    file: "index.html",
    title: "Reports portal",
    description: "Navigable entry to all offline HTML reports (S-DOCS).",
    soul: "S-DOCS",
    source: null,
  },
  {
    id: "onboarding",
    file: "onboarding.html",
    title: "Human onboarding",
    description: "Zero → running path for operators (S-ONB-HUMAN).",
    soul: "S-ONB-HUMAN",
    source: "docs/ONBOARDING.md",
  },
  {
    id: "agent-setup",
    file: "agent-setup.html",
    title: "Agent setup",
    description: "CLI + scoped keys path for agents (S-ONB-AGENT).",
    soul: "S-ONB-AGENT",
    source: "docs/AGENT_SETUP.md",
  },
  {
    id: "architecture",
    file: "architecture.html",
    title: "Architecture",
    description: "D1 SoR, one-way Airtable, stack lock, composition roots.",
    soul: "S-DOCS",
    source: "docs/ARCHITECTURE.md",
  },
  {
    id: "cli-reference",
    file: "cli-reference.html",
    title: "CLI reference",
    description: "speakerops domain commands, scopes, exit codes.",
    soul: "S-CLI",
    source: "docs/CLI.md",
  },
  {
    id: "design-lumen",
    file: "design-lumen.html",
    title: "Lumen design kit",
    description: "Light Lumen tokens, invariants, and Design Kit summary.",
    soul: "S-THEME",
    source: "docs/governance/0.2-lumen-lock.md",
  },
  {
    id: "e2e-coverage",
    file: "e2e-coverage.html",
    title: "E2E coverage",
    description: "Inventory + Playwright results (section 8.5 · S-E2E-RUN).",
    soul: "S-E2E-RUN",
    source: null,
  },
];

/** Map markdown path fragments → sibling report HTML. */
const MD_TO_REPORT: Record<string, string> = {
  "ONBOARDING.md": "onboarding.html",
  "AGENT_SETUP.md": "agent-setup.html",
  "ARCHITECTURE.md": "architecture.html",
  "CLI.md": "cli-reference.html",
  "0.2-lumen-lock.md": "design-lumen.html",
  "01_DESIGN_SYSTEM_LUMEN.md": "design-lumen.html",
  "e2e-coverage.html": "e2e-coverage.html",
};

export type BuildDocsReportsOptions = {
  root?: string;
  outDir?: string;
  /** Override git SHA (tests). */
  gitSha?: string;
  /** Override generated-at ISO timestamp (tests). */
  generatedAt?: string;
  /** Skip refreshing e2e-coverage.html via 8.5 builder. */
  skipE2eRefresh?: boolean;
  /** When true, do not write files — return HTML map only. */
  dryRun?: boolean;
};

export type BuildDocsReportsResult = {
  outDir: string;
  gitSha: string;
  generatedAt: string;
  /** Relative path → full HTML. */
  pages: Record<string, string>;
  written: string[];
};

function navHtml(current: ReportPageId): string {
  const links = REPORT_PAGES.map((p) => {
    const currentAttr =
      p.id === current ? ' aria-current="page"' : "";
    return `<a href="${escapeHtml(p.file)}"${currentAttr}>${escapeHtml(p.title)}</a>`;
  }).join("\n      ");
  return `<header class="site-header">
  <div class="site-header-inner">
    <a class="brand" href="index.html">SpeakerOps <span>Reports</span></a>
    <nav class="nav" aria-label="Reports">
      ${links}
    </nav>
  </div>
</header>`;
}

function footerHtml(gitSha: string, generatedAt: string, note: string): string {
  return `<footer class="report-footer" data-generated-at="${escapeHtml(generatedAt)}" data-git-sha="${escapeHtml(gitSha)}">
  <div><strong>Generated:</strong> <time datetime="${escapeHtml(generatedAt)}">${escapeHtml(generatedAt)}</time></div>
  <div><strong>Git SHA:</strong> <code>${escapeHtml(gitSha)}</code></div>
  <div class="muted">${escapeHtml(note)}</div>
</footer>`;
}

function shellHtml(input: {
  title: string;
  current: ReportPageId;
  body: string;
  gitSha: string;
  generatedAt: string;
  footerNote: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <meta name="generator" content="speakerops-docs-reports" />
  <title>${escapeHtml(input.title)} — SpeakerOps Reports</title>
  <style>
${LUMEN_REPORTS_CSS}
  </style>
</head>
<body>
${navHtml(input.current)}
  <div class="wrap">
${input.body}
    ${footerHtml(input.gitSha, input.generatedAt, input.footerNote)}
  </div>
</body>
</html>
`;
}

/**
 * Rewrite markdown href for offline reports/ layout.
 * Source markdown lives under docs/; HTML is written under reports/.
 */
export function rewriteMdHref(href: string, sourceRel: string): string {
  const raw = href.trim();
  if (
    !raw ||
    raw.startsWith("http://") ||
    raw.startsWith("https://") ||
    raw.startsWith("mailto:") ||
    raw.startsWith("tel:") ||
    raw.startsWith("data:") ||
    raw.startsWith("#")
  ) {
    return raw;
  }

  const [pathPart, hash = ""] = raw.split("#");
  const hashSuffix = hash ? `#${hash}` : "";
  if (!pathPart) return raw;

  const baseName = pathPart.split("/").pop() ?? pathPart;
  if (MD_TO_REPORT[baseName]) {
    return `${MD_TO_REPORT[baseName]}${hashSuffix}`;
  }
  if (baseName === "e2e-coverage.html") {
    return `e2e-coverage.html${hashSuffix}`;
  }

  // Resolve relative to source file, then make path relative to reports/
  const sourceDir = dirname(sourceRel.replace(/\\/g, "/"));
  const resolved = join(sourceDir, pathPart).replace(/\\/g, "/");
  // From reports/ → repo-relative
  let fromReports = relative("reports", resolved).replace(/\\/g, "/");
  if (!fromReports.startsWith(".")) {
    fromReports = `../${fromReports}`;
  }
  return `${fromReports}${hashSuffix}`;
}

function renderInline(text: string, sourceRel: string): string {
  // Protect code spans first
  const codes: string[] = [];
  let s = text.replace(/`([^`]+)`/g, (_, code: string) => {
    const i = codes.length;
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000C${i}\u0000`;
  });

  // Protect generated links/images from later emphasis passes (underscores in
  // hrefs like FIELD_FLOW.md / CLI_INVENTORY.md / BROWSER_E2E_INVENTORY.md).
  const protectedHtml: string[] = [];
  const protect = (html: string): string => {
    const i = protectedHtml.length;
    protectedHtml.push(html);
    return `\u0000P${i}\u0000`;
  };

  // Images ![alt](src)
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt: string, src: string) => {
    const href = rewriteMdHref(src.trim().replace(/\s+".*"$/, ""), sourceRel);
    return protect(
      `<img src="${escapeHtml(href)}" alt="${escapeHtml(alt)}" />`,
    );
  });

  // Links [text](href)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, hrefRaw: string) => {
    let href = hrefRaw.trim();
    href = href.replace(/\s+".*"$/, "").replace(/\s+'.*'$/, "");
    const rewritten = rewriteMdHref(href, sourceRel);
    return protect(
      `<a href="${escapeHtml(rewritten)}">${escapeHtml(label)}</a>`,
    );
  });

  // Bold / italic (order: bold first). Placeholders use \u0000 so _ and *
  // inside protected hrefs cannot match.
  s = s.replace(/\*\*([^*]+)\*\*/g, (_, t: string) => `<strong>${escapeHtml(t)}</strong>`);
  s = s.replace(/__([^_]+)__/g, (_, t: string) => `<strong>${escapeHtml(t)}</strong>`);
  s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, t: string) => `<em>${escapeHtml(t)}</em>`);
  s = s.replace(/(?<!_)_([^_]+)_(?!_)/g, (_, t: string) => `<em>${escapeHtml(t)}</em>`);

  // Restore protected HTML + code; escape remaining plain text.
  const parts = s.split(/(\u0000C\d+\u0000|\u0000P\d+\u0000|<[^>]+>)/);
  s = parts
    .map((part) => {
      const codeM = /^\u0000C(\d+)\u0000$/.exec(part);
      if (codeM) return codes[Number(codeM[1])] ?? "";
      const protM = /^\u0000P(\d+)\u0000$/.exec(part);
      if (protM) return protectedHtml[Number(protM[1])] ?? "";
      if (part.startsWith("<") && part.endsWith(">")) return part;
      return escapeHtml(part);
    })
    .join("");

  return s;
}

function isTableSeparator(line: string): boolean {
  return /^\|?[\s:|-]+\|[\s:|-]+/.test(line.trim()) && /---/.test(line);
}

/**
 * Minimal offline Markdown → HTML (GFM-ish: headings, lists, tables, fences, quotes).
 * Not a full CommonMark parser — sufficient for SpeakerOps docs tree.
 */
export function markdownToHtml(md: string, sourceRel: string): string {
  // Normalize newlines; strip BOM
  const text = md.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  let inUl = false;
  let inOl = false;

  const closeLists = () => {
    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      out.push("</ol>");
      inOl = false;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code
    const fence = /^(```|~~~)(.*)$/.exec(line);
    if (fence) {
      closeLists();
      const fenceMark = fence[1];
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].startsWith(fenceMark)) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1; // closing fence
      out.push(
        `<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`,
      );
      continue;
    }

    // Heading
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      closeLists();
      const level = heading[1].length;
      const raw = heading[2].replace(/\s+#+\s*$/, "");
      out.push(`<h${level}>${renderInline(raw, sourceRel)}</h${level}>`);
      i += 1;
      continue;
    }

    // HR
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim()) && line.trim().length >= 3) {
      closeLists();
      out.push("<hr />");
      i += 1;
      continue;
    }

    // Blockquote (possibly multi-line)
    if (line.startsWith(">")) {
      closeLists();
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i].startsWith(">") || lines[i].trim() === "")) {
        if (lines[i].startsWith(">")) {
          quoteLines.push(lines[i].replace(/^>\s?/, ""));
        } else if (quoteLines.length > 0 && lines[i + 1]?.startsWith(">")) {
          quoteLines.push("");
        } else {
          break;
        }
        i += 1;
      }
      const inner = quoteLines
        .join("\n")
        .split(/\n\n+/)
        .filter(Boolean)
        .map((p) => `<p>${renderInline(p.replace(/\n/g, " "), sourceRel)}</p>`)
        .join("");
      out.push(`<blockquote>${inner}</blockquote>`);
      continue;
    }

    // Table
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      closeLists();
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|")) {
        const rowLine = lines[i].trim();
        if (isTableSeparator(rowLine)) {
          i += 1;
          continue;
        }
        if (!rowLine) break;
        const cells = rowLine
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());
        rows.push(cells);
        i += 1;
      }
      if (rows.length > 0) {
        const [header, ...body] = rows;
        const thead = `<thead><tr>${header
          .map((c) => `<th>${renderInline(c, sourceRel)}</th>`)
          .join("")}</tr></thead>`;
        const tbody =
          body.length === 0
            ? ""
            : `<tbody>${body
                .map(
                  (r) =>
                    `<tr>${r
                      .map((c) => `<td>${renderInline(c, sourceRel)}</td>`)
                      .join("")}</tr>`,
                )
                .join("")}</tbody>`;
        out.push(`<table>${thead}${tbody}</table>`);
      }
      continue;
    }

    // Unordered list
    const ul = /^(\s*)[-*+]\s+(.+)$/.exec(line);
    if (ul) {
      if (inOl) {
        out.push("</ol>");
        inOl = false;
      }
      if (!inUl) {
        out.push("<ul>");
        inUl = true;
      }
      out.push(`<li>${renderInline(ul[2], sourceRel)}</li>`);
      i += 1;
      continue;
    }

    // Ordered list
    const ol = /^(\s*)\d+\.\s+(.+)$/.exec(line);
    if (ol) {
      if (inUl) {
        out.push("</ul>");
        inUl = false;
      }
      if (!inOl) {
        out.push("<ol>");
        inOl = true;
      }
      out.push(`<li>${renderInline(ol[2], sourceRel)}</li>`);
      i += 1;
      continue;
    }

    // Blank
    if (line.trim() === "") {
      closeLists();
      i += 1;
      continue;
    }

    // Paragraph (merge consecutive non-empty non-special lines)
    closeLists();
    const para: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^(```|~~~)/.test(lines[i]) &&
      !lines[i].startsWith(">") &&
      !/^(\s*)[-*+]\s+/.test(lines[i]) &&
      !/^(\s*)\d+\.\s+/.test(lines[i]) &&
      !(
        lines[i].includes("|") &&
        i + 1 < lines.length &&
        isTableSeparator(lines[i + 1])
      ) &&
      !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i].trim())
    ) {
      para.push(lines[i]);
      i += 1;
    }
    out.push(`<p>${renderInline(para.join(" "), sourceRel)}</p>`);
  }

  closeLists();
  return out.join("\n");
}

function designLumenExtras(): string {
  return `
<section class="card" aria-label="Lumen token swatches">
  <h2 style="margin:0 0 12px;border:none;padding:0;font-size:1.1rem">Light Lumen tokens</h2>
  <p class="sub" style="margin-bottom:12px">Dogfood default palette (E6). Status colors do not retheme with brand. Dark mode out of scope.</p>
  <div class="swatch-row">
    <div class="swatch"><div class="chip" style="background:#f5f5f7"></div><div class="label">bg #f5f5f7</div></div>
    <div class="swatch"><div class="chip" style="background:#ffffff;border-bottom:1px solid rgba(0,0,0,0.08)"></div><div class="label">surface</div></div>
    <div class="swatch"><div class="chip" style="background:#4f46e5"></div><div class="label">brand #4f46e5</div></div>
    <div class="swatch"><div class="chip" style="background:#0d9488"></div><div class="label">accent #0d9488</div></div>
    <div class="swatch"><div class="chip" style="background:#059669"></div><div class="label">success</div></div>
    <div class="swatch"><div class="chip" style="background:#d97706"></div><div class="label">warn</div></div>
    <div class="swatch"><div class="chip" style="background:#dc2626"></div><div class="label">danger</div></div>
    <div class="swatch"><div class="chip" style="background:#0284c7"></div><div class="label">info</div></div>
  </div>
</section>`;
}

export function renderIndexHtml(input: {
  gitSha: string;
  generatedAt: string;
}): string {
  const cards = REPORT_PAGES.filter((p) => p.id !== "index")
    .map(
      (p) => `<a class="report-card" href="${escapeHtml(p.file)}">
  <div class="badges"><span class="badge">${escapeHtml(p.soul)}</span></div>
  <h2>${escapeHtml(p.title)}</h2>
  <p>${escapeHtml(p.description)}</p>
  <div class="meta">Open ${escapeHtml(p.file)} →</div>
</a>`,
    )
    .join("\n");

  const body = `
    <header class="card">
      <h1>SpeakerOps reports portal</h1>
      <p class="sub">
        Offline Lumen-styled HTML reports for constitution soul <strong>S-DOCS</strong>.
        Open any card without a server. Section <strong>9.5</strong> ·
        <code>pnpm docs:reports</code>.
      </p>
      <div class="badges" role="status">
        <span class="badge">S-DOCS</span>
        <span class="badge accent">S-ONB-HUMAN</span>
        <span class="badge accent">S-ONB-AGENT</span>
        <span class="badge success">S-E2E-RUN</span>
        <span class="badge">light Lumen</span>
      </div>
    </header>
    <div class="report-grid">
${cards}
    </div>
`;

  return shellHtml({
    title: "Reports portal",
    current: "index",
    body,
    gitSha: input.gitSha,
    generatedAt: input.generatedAt,
    footerNote: "Section 9.5 · pnpm docs:reports · offline portal · no secrets in report",
  });
}

export function renderDocReportHtml(input: {
  page: ReportPageMeta;
  markdown: string;
  gitSha: string;
  generatedAt: string;
}): string {
  const source = input.page.source ?? "docs";
  const content = markdownToHtml(input.markdown, source);
  const extras =
    input.page.id === "design-lumen" ? designLumenExtras() : "";

  const body = `
    <header class="card">
      <h1>${escapeHtml(input.page.title)}</h1>
      <p class="sub">${escapeHtml(input.page.description)}</p>
      <p class="source-note">Source: <code>${escapeHtml(source)}</code> · Soul: <strong>${escapeHtml(input.page.soul)}</strong></p>
      <div class="badges">
        <span class="badge">${escapeHtml(input.page.soul)}</span>
        <span class="badge">section 9.5</span>
      </div>
    </header>
    ${extras}
    <article class="prose card">
${content}
    </article>
`;

  return shellHtml({
    title: input.page.title,
    current: input.page.id,
    body,
    gitSha: input.gitSha,
    generatedAt: input.generatedAt,
    footerNote: `Section 9.5 · pnpm docs:reports · source ${source} · no secrets in report`,
  });
}

/**
 * Build and optionally write the docs reports portal.
 */
export function buildDocsReports(
  options: BuildDocsReportsOptions = {},
): BuildDocsReportsResult {
  const root = resolve(options.root ?? defaultRoot);
  const outDir = resolve(
    options.outDir ??
      process.env.DOCS_REPORTS_DIR ??
      join(root, "reports"),
  );
  const gitSha = resolveGitSha(root, options.gitSha);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const pages: Record<string, string> = {};
  const written: string[] = [];

  // Portal index
  pages["index.html"] = renderIndexHtml({ gitSha, generatedAt });

  // Markdown-backed reports
  for (const page of REPORT_PAGES) {
    if (!page.source) continue;
    const srcPath = join(root, page.source);
    if (!existsSync(srcPath)) {
      throw new Error(`report source missing: ${page.source}`);
    }
    const md = readFileSync(srcPath, "utf8");
    pages[page.file] = renderDocReportHtml({
      page,
      markdown: md,
      gitSha,
      generatedAt,
    });
  }

  // Refresh e2e coverage (8.5) into the same outDir unless skipped
  if (!options.skipE2eRefresh) {
    const e2eOut = join(outDir, "e2e-coverage.html");
    if (!options.dryRun) {
      const e2e = buildE2eReport({
        root,
        outPath: e2eOut,
        gitSha,
        generatedAt,
      });
      pages["e2e-coverage.html"] = e2e.html;
      written.push(e2e.outPath);
    } else {
      const e2e = buildE2eReport({
        root,
        outPath: e2eOut,
        gitSha,
        generatedAt,
        dryRun: true,
      });
      pages["e2e-coverage.html"] = e2e.html;
    }
  } else if (existsSync(join(outDir, "e2e-coverage.html"))) {
    // Keep existing file reference for dry-run consumers
    pages["e2e-coverage.html"] = readFileSync(
      join(outDir, "e2e-coverage.html"),
      "utf8",
    );
  }

  if (!options.dryRun) {
    mkdirSync(outDir, { recursive: true });
    for (const [file, html] of Object.entries(pages)) {
      if (file === "e2e-coverage.html" && !options.skipE2eRefresh) {
        // already written by buildE2eReport
        continue;
      }
      const dest = join(outDir, file);
      writeFileSync(dest, html, "utf8");
      written.push(dest);
    }
    // Ensure e2e path is listed
    if (!options.skipE2eRefresh) {
      const e2ePath = join(outDir, "e2e-coverage.html");
      if (existsSync(e2ePath) && !written.includes(e2ePath)) {
        written.push(e2ePath);
      }
    }
  }

  return { outDir, gitSha, generatedAt, pages, written };
}

/** CLI argv parser (non-interactive). */
export function parseCliArgs(argv: string[]): {
  outDir?: string;
  noE2e?: boolean;
  help?: boolean;
} {
  const out: { outDir?: string; noE2e?: boolean; help?: boolean } = {};
  for (const a of argv) {
    if (a === "--help" || a === "-h") out.help = true;
    else if (a.startsWith("--out-dir=")) out.outDir = a.slice("--out-dir=".length);
    else if (a === "--no-e2e") out.noE2e = true;
  }
  return out;
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMain()) {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: tsx scripts/build-docs-reports.ts [options]

Options:
  --out-dir=path    Output directory (default reports/)
  --no-e2e          Do not refresh e2e-coverage.html via 8.5 builder
  -h, --help        Show help

Env names: DOCS_REPORTS_DIR

Emits: index.html, onboarding.html, agent-setup.html, architecture.html,
       cli-reference.html, design-lumen.html, e2e-coverage.html
`);
    process.exit(0);
  }

  try {
    const result = buildDocsReports({
      outDir: args.outDir,
      skipE2eRefresh: args.noE2e === true,
    });
    const files = Object.keys(result.pages).sort().join(", ");
    console.log(
      `[docs:reports] wrote ${result.outDir}` +
        ` · pages ${Object.keys(result.pages).length}` +
        ` · sha ${result.gitSha}` +
        ` · at ${result.generatedAt}`,
    );
    console.log(`[docs:reports] files: ${files}`);
    process.exit(0);
  } catch (e) {
    console.error(
      "[docs:reports] failed:",
      e instanceof Error ? e.message : e,
    );
    process.exit(1);
  }
}
