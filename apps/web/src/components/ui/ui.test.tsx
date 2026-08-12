/**
 * Section 11.0 — Lumen 2 primitive unit tests (AC-11.0-A).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactElement } from "react";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  Icon,
  ICON_NAMES,
  LoadingState,
  Modal,
  NetworkErrorState,
  PageHeader,
  PermissionDeniedState,
  SessionExpiredPanel,
  Skeleton,
} from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));

const errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
  const msg = String(args[0] ?? "");
  if (
    msg.includes("useLayoutEffect") ||
    msg.includes("ReactDOM.useLayoutEffect") ||
    msg.includes("useEffect")
  ) {
    return;
  }
});

afterEach(() => {
  errorSpy.mockClear();
});

function html(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

describe("11.0 UI primitives exist (AC-11.0-A)", () => {
  it("ships required component modules under components/ui/", () => {
    const files = readdirSync(here).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));
    const required = [
      "Button.tsx",
      "Field.tsx",
      "Badge.tsx",
      "Card.tsx",
      "Alert.tsx",
      "Modal.tsx",
      "DataTable.tsx",
      "EmptyState.tsx",
      "PageHeader.tsx",
      "Icon.tsx",
      "Skeleton.tsx",
      "SessionExpiredPanel.tsx",
      "NetworkErrorState.tsx",
      "PermissionDeniedState.tsx",
      "LoadingState.tsx",
      "index.ts",
    ];
    for (const name of required) {
      expect(files, `missing ${name}`).toContain(name);
    }
  });

  it("Button renders variants and state classes", () => {
    const rest = html(createElement(Button, { variant: "primary" }, "Save"));
    expect(rest).toContain("l2-btn");
    expect(rest).toContain("l2-btn--primary");
    expect(rest).toContain('data-state="rest"');

    const pending = html(
      createElement(Button, { variant: "primary", pending: true }, "Saving"),
    );
    expect(pending).toContain("is-pending");
    expect(pending).toContain('data-state="pending"');
    expect(pending).toContain("l2-btn__spinner");

    const disabled = html(
      createElement(Button, { variant: "danger", disabled: true }, "Delete"),
    );
    expect(disabled).toContain("is-disabled");
    expect(disabled).toContain("l2-btn--danger");
  });

  it("Field requires visible label and supports error state", () => {
    const rest = html(
      createElement(Field, {
        id: "f1",
        label: "Title",
        hint: "Shown publicly",
      }),
    );
    expect(rest).toContain("l2-field");
    expect(rest).toContain("Title");
    expect(rest).toContain("l2-field__label");
    expect(rest).toContain('data-state="rest"');

    const err = html(
      createElement(Field, {
        id: "f2",
        label: "Email",
        error: "Enter a valid email so we can contact you.",
        required: true,
      }),
    );
    expect(err).toContain("is-error");
    expect(err).toContain('data-state="error"');
    expect(err).toContain("Enter a valid email");
    expect(err).toContain("(required)");
  });

  it("Badge never ships color-only (text children required by type)", () => {
    const markup = html(
      createElement(Badge, { tone: "success", showDot: true }, "Accepted"),
    );
    expect(markup).toContain("l2-badge--success");
    expect(markup).toContain("Accepted");
    expect(markup).toContain("l2-badge__dot");
  });

  it("Card supports selected and raised states", () => {
    const markup = html(
      createElement(Card, {
        title: "Session",
        raised: true,
        selected: true,
        children: "Body",
      }),
    );
    expect(markup).toContain("l2-card");
    expect(markup).toContain("l2-card--raised");
    expect(markup).toContain("is-selected");
    expect(markup).toContain('data-state="selected"');
  });

  it("Alert renders tone classes", () => {
    const markup = html(
      createElement(Alert, { tone: "danger", title: "Failed" }, "Retry save"),
    );
    expect(markup).toContain("l2-alert--danger");
    expect(markup).toContain("Failed");
    expect(markup).toContain("Retry save");
  });

  it("Modal is closed when open=false and open when open=true", () => {
    const closed = html(
      createElement(Modal, {
        open: false,
        onClose: () => {},
        title: "Confirm",
        children: "Body",
      }),
    );
    expect(closed).toBe("");

    const open = html(
      createElement(Modal, {
        open: true,
        onClose: () => {},
        title: "Confirm reject",
        children: "This cannot be undone.",
        "data-testid": "modal-demo",
      }),
    );
    expect(open).toContain('role="dialog"');
    expect(open).toContain("Confirm reject");
    expect(open).toContain('data-state="open"');
    expect(open).toContain("l2-modal");
  });

  it("DataTable renders headers and selection state class", () => {
    const rows = [
      { id: "1", name: "A" },
      { id: "2", name: "B" },
    ];
    const markup = html(
      createElement(DataTable, {
        columns: [
          {
            id: "name",
            header: "Name",
            primary: true,
            cell: (r: { id: string; name: string }) => r.name,
          },
        ],
        rows,
        getRowId: (r: { id: string }) => r.id,
        selectedIds: new Set(["1"]),
        onToggleRow: () => {},
        "data-testid": "dt",
      }),
    );
    expect(markup).toContain("l2-table");
    expect(markup).toContain("Name");
    expect(markup).toContain("is-selected");
  });

  it("EmptyState, PageHeader, Skeleton, Icon render state hooks", () => {
    expect(
      html(
        createElement(EmptyState, {
          title: "No items",
          description: "Add one to get started.",
          "data-testid": "empty",
        }),
      ),
    ).toContain('data-state="empty"');

    expect(
      html(
        createElement(PageHeader, {
          title: "Overview",
          eyebrow: "Program",
        }),
      ),
    ).toContain("l2-page-header__title");

    expect(
      html(createElement(Skeleton, { variant: "row" })),
    ).toContain('data-state="loading"');

    expect(ICON_NAMES.length).toBeGreaterThan(10);
    const icon = html(createElement(Icon, { name: "check", size: "md" }));
    expect(icon).toContain("l2-icon");
    expect(icon).toContain('data-icon="check"');
    expect(icon).toContain('viewBox="0 0 24 24"');
  });

  it("11.7 LoadingState and NetworkErrorState render recovery anatomy", () => {
    const loading = html(
      createElement(LoadingState, {
        label: "Loading…",
        rows: 2,
        "data-testid": "load",
      }),
    );
    expect(loading).toContain('data-state="loading"');
    expect(loading).toContain("load-label");
    expect(loading).toContain("l2-skeleton");

    const err = html(
      createElement(NetworkErrorState, {
        title: "Couldn't load",
        description: "Retry the same operation.",
        onRetry: () => {},
        "data-testid": "net-err",
      }),
    );
    expect(err).toContain('data-state="error"');
    expect(err).toContain("net-err-retry");
    // SSR escapes apostrophe in "Couldn't"
    expect(err).toMatch(/Couldn(?:'|&#x27;)t load/);
  });

  it("11.7 SessionExpiredPanel and PermissionDeniedState modules export", () => {
    // SessionExpiredPanel / PermissionDeniedState use react-router Link —
    // assert exports and source contracts rather than full router SSR.
    expect(typeof SessionExpiredPanel).toBe("function");
    expect(typeof PermissionDeniedState).toBe("function");
    const sessionSrc = readFileSync(
      join(here, "SessionExpiredPanel.tsx"),
      "utf8",
    );
    expect(sessionSrc).toContain('data-state="session-expired"');
    expect(sessionSrc).toContain("session-expired-panel");
    const permSrc = readFileSync(
      join(here, "PermissionDeniedState.tsx"),
      "utf8",
    );
    expect(permSrc).toContain('data-state="permission-denied"');
  });

  it("components.css defines state anatomy classes", () => {
    const css = readFileSync(join(here, "../../styles/components.css"), "utf8");
    for (const cls of [
      ".l2-btn",
      ".l2-btn.is-pending",
      ".l2-btn:disabled",
      ".l2-field.is-error",
      ".l2-badge",
      ".l2-card.is-selected",
      ".l2-alert",
      ".l2-modal",
      ".l2-table",
      ".l2-empty",
      ".l2-page-header",
      ".l2-skeleton",
      ".l2-icon",
      ".l2-session-expired",
      ".l2-network-error",
      ".l2-permission-denied",
      ".l2-loading-state",
    ]) {
      expect(css, `missing ${cls}`).toContain(cls);
    }
  });
});

describe("11.0 AC-11.0-E no new UI runtime deps", () => {
  it("web package.json runtime deps stay React + router + shared only", () => {
    const pkg = JSON.parse(
      readFileSync(join(here, "../../../package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    const depNames = Object.keys(pkg.dependencies ?? {}).sort();
    expect(depNames).toEqual([
      // F3: dnd-kit for column manager reorder (core + sortable + utilities).
      "@dnd-kit/core",
      "@dnd-kit/sortable",
      "@dnd-kit/utilities",
      // F1 (Sage & Honey lock): self-hosted OFL fonts — the ONLY sanctioned
      // font packages (woff2 binaries only; no runtime JS).
      "@fontsource/hanken-grotesk",
      "@fontsource/ibm-plex-mono",
      "@speakerops/shared",
      // F3: TanStack Table v8 (server-driven DataGrid).
      "@tanstack/react-table",
      // F2 (rich-text primitive): TipTap v3 on ProseMirror — the ONLY
      // sanctioned editor stack (no CDN, no other editor/UI kits). The set
      // is closed: StarterKit bundles Link + Underline (never re-added as
      // separate deps); CharacterCount/Placeholder come from
      // @tiptap/extensions; @tiptap/pm pins the ProseMirror layer.
      "@tiptap/extension-subscript",
      "@tiptap/extension-superscript",
      "@tiptap/extension-text-align",
      "@tiptap/extensions",
      "@tiptap/pm",
      "@tiptap/react",
      "@tiptap/starter-kit",
      // F5: cmdk command palette for ⌘K Find.
      "cmdk",
      "react",
      "react-dom",
      "react-router-dom",
    ]);
    // F2 pin law: EVERY @tiptap/* package pinned to ONE exact version —
    // no ranges (^/~), no mixed versions (TipTap v3 requires lockstep).
    const tiptapVersions = new Set(
      Object.entries(pkg.dependencies ?? {})
        .filter(([name]) => name.startsWith("@tiptap/"))
        .map(([, version]) => version),
    );
    expect(tiptapVersions.size).toBe(1);
    const pinned = [...tiptapVersions][0] ?? "";
    expect(/^\d+\.\d+\.\d+$/.test(pinned), `exact pin, got ${pinned}`).toBe(
      true,
    );
    expect(pinned.startsWith("3.")).toBe(true);
    // Explicit ban list for UI kits / icons / charts / other DnD libs.
    // (@fontsource left the ban list deliberately in F1 — self-hosted fonts
    // are mandated by the locked theme; scope stays limited by the exact
    // dependency assertion above.)
    // F3 unbans @dnd-kit (exact pins below); keeps other DnD/chart kits banned.
    const banned = [
      "@mui/",
      "chakra",
      "antd",
      "lucide",
      "react-icons",
      "heroicons",
      "fontawesome",
      "chart.js",
      "recharts",
      "d3",
      "framer-motion",
      "react-beautiful-dnd",
      "styled-components",
      "@emotion/",
    ];
    const blob = JSON.stringify(pkg);
    for (const b of banned) {
      expect(blob.includes(b), `banned dep fragment ${b}`).toBe(false);
    }
    // F3: exact TanStack Table + dnd-kit set (column manager + grid).
    const deps = pkg.dependencies ?? {};
    expect(deps["@tanstack/react-table"]).toMatch(/^8\./);
    expect(deps["@dnd-kit/core"]).toMatch(/^6\./);
    expect(deps["@dnd-kit/sortable"]).toMatch(/^10\./);
    expect(deps["@dnd-kit/utilities"]).toMatch(/^3\./);
    // F5: cmdk pinned to 1.x
    expect(deps["cmdk"]).toMatch(/^1\./);
  });
});
