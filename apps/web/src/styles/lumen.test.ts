/**
 * Section 1.4 + 11.0 — lumen.css named assertions + token lint.
 * Spec: --lumen-brand / --lumen-focus-ring; AC-11.0-B extended tokens;
 * no parallel --l2 SoT; no undefined --lumen refs in shell/components.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const lumenCss = readFileSync(join(here, "lumen.css"), "utf8");
const shellCss = readFileSync(join(here, "shell.css"), "utf8");
const componentsCss = readFileSync(join(here, "components.css"), "utf8");
const webSrc = join(here, "..");

/** Extract --lumen-* definitions from :root / file (property declarations). */
function definedLumenVars(css: string): Set<string> {
  const set = new Set<string>();
  const re = /(--lumen-[a-z0-9-]+)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    set.add(m[1]!);
  }
  return set;
}

/** Collect var(--lumen-*) references. */
function referencedLumenVars(css: string): Set<string> {
  const set = new Set<string>();
  const re = /var\(\s*(--lumen-[a-z0-9-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    set.add(m[1]!);
  }
  return set;
}

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "dist-types") {
      continue;
    }
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkSourceFiles(p, out);
    else if (/\.(tsx?|css)$/.test(name) && !name.endsWith(".test.ts") && !name.endsWith(".test.tsx")) {
      out.push(p);
    }
  }
  return out;
}

describe("1.4 lumen.css tokens", () => {
  it("assert lumen.css defines --lumen-brand and --lumen-focus-ring", () => {
    expect(lumenCss).toMatch(/--lumen-brand\s*:/);
    expect(lumenCss).toMatch(/--lumen-focus-ring\s*:/);
    expect(lumenCss).toMatch(/--lumen-focus\s*:/);
  });

  it("defines brand soft and status soft pairs", () => {
    expect(lumenCss).toMatch(/--lumen-brand-soft\s*:/);
    expect(lumenCss).toMatch(/--lumen-success-soft\s*:/);
    expect(lumenCss).toMatch(/--lumen-warn-soft\s*:/);
    expect(lumenCss).toMatch(/--lumen-danger-soft\s*:/);
    expect(lumenCss).toMatch(/--lumen-info-soft\s*:/);
    expect(lumenCss).toMatch(/--lumen-success\s*:/);
    expect(lumenCss).toMatch(/--lumen-warn\s*:/);
    expect(lumenCss).toMatch(/--lumen-danger\s*:/);
    expect(lumenCss).toMatch(/--lumen-info\s*:/);
  });

  it("is light-default (no dark-default theme)", () => {
    expect(lumenCss).toMatch(/--lumen-bg\s*:\s*#f5f5f7/);
    expect(lumenCss).toMatch(/color-scheme:\s*light/);
    // Must not set a dark body background as default
    expect(lumenCss).not.toMatch(/body\s*\{[^}]*background:\s*#0[0-9a-fA-F]{5}/);
  });

  it("includes focus ring utility class", () => {
    expect(lumenCss).toMatch(/\.lumen-focusable:focus-visible/);
    expect(lumenCss).toMatch(/box-shadow:\s*var\(--lumen-focus-ring\)/);
  });
});

describe("11.0 lumen.css Lumen 2 extended tokens (AC-11.0-B)", () => {
  it("defines extended space scale including space-5 used by shell", () => {
    expect(lumenCss).toMatch(/--lumen-space-5\s*:/);
    expect(lumenCss).toMatch(/--lumen-space-8\s*:/);
    expect(lumenCss).toMatch(/--lumen-space-10\s*:/);
    expect(lumenCss).toMatch(/--lumen-space-12\s*:/);
    expect(lumenCss).toMatch(/--lumen-space-16\s*:/);
  });

  it("defines type scale tokens", () => {
    expect(lumenCss).toMatch(/--lumen-text-title\s*:/);
    expect(lumenCss).toMatch(/--lumen-text-section\s*:/);
    expect(lumenCss).toMatch(/--lumen-text-ui\s*:/);
    expect(lumenCss).toMatch(/--lumen-text-meta\s*:/);
    expect(lumenCss).toMatch(/--lumen-text-stat\s*:/);
    expect(lumenCss).toMatch(/--lumen-text-tertiary\s*:/);
  });

  it("defines elevation and border scales", () => {
    expect(lumenCss).toMatch(/--lumen-shadow-raised\s*:/);
    expect(lumenCss).toMatch(/--lumen-shadow-modal\s*:/);
    expect(lumenCss).toMatch(/--lumen-shadow-popover\s*:/);
    expect(lumenCss).toMatch(/--lumen-border-subtle\s*:/);
    expect(lumenCss).toMatch(/--lumen-border-control\s*:/);
    expect(lumenCss).toMatch(/--lumen-border-strong\s*:/);
    expect(lumenCss).toMatch(/--lumen-radius\s*:/);
  });

  it("defines control geometry and motion scale", () => {
    expect(lumenCss).toMatch(/--lumen-control-h\s*:/);
    expect(lumenCss).toMatch(/--lumen-control-h-sm\s*:/);
    expect(lumenCss).toMatch(/--lumen-motion-fast\s*:/);
    expect(lumenCss).toMatch(/--lumen-motion-slow\s*:/);
    expect(lumenCss).toMatch(/--lumen-icon-md\s*:/);
  });

  it("does not install a parallel --l2 theme SoT (aliases only)", () => {
    // Any --l2-* definition must be an alias to var(--lumen-*)
    const l2Defs = [
      ...lumenCss.matchAll(/(--l2-[a-z0-9-]+)\s*:\s*([^;]+);/g),
    ];
    expect(l2Defs.length).toBeGreaterThan(0);
    for (const m of l2Defs) {
      const value = m[2]!.trim();
      expect(
        value.startsWith("var(--lumen-"),
        `${m[1]} must alias --lumen-*, got: ${value}`,
      ).toBe(true);
    }
    // Frozen brand remains the action color SoT
    expect(lumenCss).toMatch(/--lumen-brand\s*:\s*#4f46e5/);
  });

  it("shell and components.css have no undefined --lumen var references", () => {
    const defined = definedLumenVars(lumenCss);
    const used = new Set([
      ...referencedLumenVars(shellCss),
      ...referencedLumenVars(componentsCss),
      ...referencedLumenVars(lumenCss),
    ]);
    const missing = [...used].filter((v) => !defined.has(v)).sort();
    expect(missing, `undefined --lumen vars: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("components.css / shell.css introduce no raw hex palette (token lint)", () => {
    // Hex may appear only in governed lumen.css. Style sheets and Lumen 2
    // primitives must consume var(--lumen-*). Domain pages may hold brand hex
    // as Design Kit form *data* (not freeform CSS) — not linted here.
    const files = [
      join(here, "shell.css"),
      join(here, "components.css"),
      ...walkSourceFiles(join(webSrc, "components", "ui")).filter((f) =>
        f.endsWith(".tsx"),
      ),
      join(webSrc, "pages", "L2StateSheet.tsx"),
    ];
    const offenders: string[] = [];
    const hexRe = /#[0-9a-fA-F]{3,8}\b/;
    for (const file of files) {
      const body = readFileSync(file, "utf8");
      const withoutComments = body
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      if (file.endsWith(".css")) {
        if (hexRe.test(withoutComments)) offenders.push(file);
      } else if (
        /['"`]#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/.test(
          withoutComments,
        )
      ) {
        offenders.push(file);
      }
    }
    expect(
      offenders,
      `raw hex outside lumen.css SoT: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
