import { z } from "zod";

/**
 * Design Kit DTOs (section 2.4).
 * Commands: Design.Get / Design.SetDraft / Design.Publish
 * File.PresignUpload (purpose=logo, PNG only)
 * HTTP: COMMANDS.md design + files map; public published tokens for CFP
 */

/** Hex color #RGB or #RRGGBB (case-insensitive). */
export const HexColorSchema = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Invalid hex color");

/** Radius scale — no freeform CSS; closed set only. */
export const DesignRadiusSchema = z.enum(["soft", "curvy", "round"]);
export type DesignRadius = z.infer<typeof DesignRadiusSchema>;

/**
 * Design token payload (SCHEMA.md design_tokens).
 * brandFg is derived on publish for WCAG AA primary-button text (not freeform CSS).
 */
export const DesignTokensSchema = z.object({
  brand: HexColorSchema,
  brandSoft: HexColorSchema.optional().nullable(),
  radius: DesignRadiusSchema.default("soft"),
  wordmark: z.string().max(120).optional().nullable(),
  logoFileId: z.string().min(1).max(128).optional().nullable(),
  /** Derived on-brand foreground for primary buttons (publish gate). */
  brandFg: HexColorSchema.optional().nullable(),
});
export type DesignTokens = z.infer<typeof DesignTokensSchema>;

/** Draft aggregate with optimistic version. */
export const DesignDraftSchema = z.object({
  eventId: z.string().min(1),
  tokens: DesignTokensSchema,
  version: z.number().int().positive(),
  updatedAt: z.string().min(1),
});
export type DesignDraft = z.infer<typeof DesignDraftSchema>;

/** Published aggregate. */
export const DesignPublishedSchema = z.object({
  eventId: z.string().min(1),
  tokens: DesignTokensSchema,
  version: z.number().int().positive(),
  publishedAt: z.string().min(1),
});
export type DesignPublished = z.infer<typeof DesignPublishedSchema>;

/** Design.Get response — GET /api/events/:eventId/design */
export const DesignGetResponseSchema = z.object({
  draft: DesignDraftSchema.nullable(),
  published: DesignPublishedSchema.nullable(),
});
export type DesignGetResponse = z.infer<typeof DesignGetResponseSchema>;

/** Design.SetDraft body — PUT /api/events/:eventId/design */
export const DesignSetDraftBodySchema = z.object({
  tokens: DesignTokensSchema,
  expectedVersion: z.number().int().positive().optional(),
});
export type DesignSetDraftBody = z.infer<typeof DesignSetDraftBodySchema>;

/** Design.SetDraft response */
export const DesignSetDraftResponseSchema = z.object({
  draft: DesignDraftSchema,
});
export type DesignSetDraftResponse = z.infer<typeof DesignSetDraftResponseSchema>;

/** Design.Publish body — POST /api/events/:eventId/design/publish */
export const DesignPublishBodySchema = z.object({
  expectedVersion: z.number().int().positive(),
});
export type DesignPublishBody = z.infer<typeof DesignPublishBodySchema>;

/** Design.Publish response */
export const DesignPublishResponseSchema = z.object({
  published: DesignPublishedSchema,
});
export type DesignPublishResponse = z.infer<typeof DesignPublishResponseSchema>;

/**
 * Public published design (CFP).
 * Never returns draft — draft isolation (C10).
 */
export const PublicDesignResponseSchema = z.object({
  eventId: z.string().min(1),
  slug: z.string().min(1),
  published: DesignPublishedSchema.nullable(),
  /** Inline CSS custom properties for public surfaces (tokens only, no freeform). */
  cssVariables: z.string().nullable(),
});
export type PublicDesignResponse = z.infer<typeof PublicDesignResponseSchema>;

/** File purpose allowlist for dogfood (logo in 2.4; headshot/slides later). */
export const FilePurposeSchema = z.enum(["logo", "headshot", "slides", "other"]);
export type FilePurpose = z.infer<typeof FilePurposeSchema>;

/** Logo mime allowlist — PNG only in dogfood (SVG rejected; no freeform). */
export const LOGO_MIME_ALLOWLIST = ["image/png"] as const;

/** File.PresignUpload body — POST /api/files/presign */
export const FilePresignBodySchema = z.object({
  eventId: z.string().min(1),
  purpose: FilePurposeSchema,
  mime: z.string().min(1).max(128),
  size: z.number().int().positive().max(10 * 1024 * 1024),
  filename: z.string().min(1).max(255).optional(),
});
export type FilePresignBody = z.infer<typeof FilePresignBodySchema>;

/** File.PresignUpload response */
export const FilePresignResponseSchema = z.object({
  fileId: z.string().min(1),
  /** Upload target (local/dev may be a stub URL; production R2 presign later). */
  url: z.string().min(1),
  mime: z.string().min(1),
  purpose: FilePurposeSchema,
  expiresAt: z.string().min(1),
});
export type FilePresignResponse = z.infer<typeof FilePresignResponseSchema>;

/** Default Lumen brand when no draft exists. */
export const DEFAULT_DESIGN_TOKENS: DesignTokens = {
  brand: "#4f46e5",
  brandSoft: "#eef2ff",
  radius: "soft",
  wordmark: null,
  logoFileId: null,
  brandFg: "#ffffff",
};

/** Map radius scale → CSS pixel token (closed set; not freeform). */
export function radiusToCss(radius: DesignRadius): string {
  switch (radius) {
    case "soft":
      return "8px";
    case "curvy":
      return "12px";
    case "round":
      return "22px";
    default:
      return "8px";
  }
}

/**
 * Build CSS custom properties string from published tokens only.
 * Used by public CFP; admin chrome must not inject these globally.
 */
export function designTokensToCssVariables(tokens: DesignTokens): string {
  const brandSoft = tokens.brandSoft ?? softTintFromBrand(tokens.brand);
  const brandFg = tokens.brandFg ?? "#ffffff";
  const radius = radiusToCss(tokens.radius ?? "soft");
  return [
    `--lumen-brand: ${tokens.brand}`,
    `--lumen-brand-soft: ${brandSoft}`,
    `--lumen-brand-fg: ${brandFg}`,
    `--lumen-radius-md: ${radius}`,
    `--event-wordmark: ${JSON.stringify(tokens.wordmark ?? "")}`,
  ].join("; ");
}

/** Simple soft tint: brand at ~10% opacity over white (hex blend approximation). */
export function softTintFromBrand(brand: string): string {
  const rgb = parseHexRgb(brand);
  if (!rgb) return "#eef2ff";
  const mix = (c: number) => Math.round(c * 0.12 + 255 * 0.88);
  return rgbToHex(mix(rgb.r), mix(rgb.g), mix(rgb.b));
}

export function parseHexRgb(
  hex: string,
): { r: number; g: number; b: number } | null {
  const m = hex.trim().match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    "#" +
    [clamp(r), clamp(g), clamp(b)]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("")
  );
}

/** Relative luminance (sRGB → WCAG). */
export function relativeLuminance(hex: string): number | null {
  const rgb = parseHexRgb(hex);
  if (!rgb) return null;
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const R = channel(rgb.r);
  const G = channel(rgb.g);
  const B = channel(rgb.b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** Contrast ratio between two hex colors (WCAG). */
export function contrastRatio(hexA: string, hexB: string): number | null {
  const l1 = relativeLuminance(hexA);
  const l2 = relativeLuminance(hexB);
  if (l1 == null || l2 == null) return null;
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Derive on-brand foreground (white or near-black) for primary buttons.
 * Prefers the option with higher contrast against brand.
 */
export function deriveBrandFg(brand: string): string {
  const white = "#ffffff";
  const dark = "#1d1d1f";
  const cWhite = contrastRatio(brand, white) ?? 0;
  const cDark = contrastRatio(brand, dark) ?? 0;
  return cDark >= cWhite ? dark : white;
}

/**
 * Contrast gate for Design.Publish (S-THEME / MF contrast).
 * - Derives brandFg for AA text on primary button (brand bg).
 * - Blocks when neither white nor dark meets UI AA (3:1) against brand.
 * - Soft-blocks near-white brand that fails brand-vs-surface for link text
 *   is handled by derived fg; primary button always gets brandFg.
 *
 * Returns ok with enriched tokens, or fail with machine-readable code.
 */
export type ContrastGateResult =
  | { ok: true; tokens: DesignTokens; brandFg: string; ratio: number }
  | {
      ok: false;
      code: "CONTRAST_FAILED" | "VALIDATION_ERROR";
      error: string;
      details?: unknown;
    };

/** WCAG AA normal text threshold. */
export const CONTRAST_AA_TEXT = 4.5;
/** WCAG AA large text / UI component threshold. */
export const CONTRAST_AA_UI = 3.0;

export function validateContrastGate(tokens: DesignTokens): ContrastGateResult {
  const brand = tokens.brand;
  if (!parseHexRgb(brand)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Invalid brand color",
    };
  }

  const brandFg = deriveBrandFg(brand);
  const ratio = contrastRatio(brand, brandFg);
  if (ratio == null) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      error: "Could not compute contrast",
    };
  }

  // Primary button: brand background + brandFg must meet UI AA (3:1).
  // Near-white brands get dark fg (high ratio); dark brands get white fg.
  if (ratio < CONTRAST_AA_UI) {
    return {
      ok: false,
      code: "CONTRAST_FAILED",
      error: "Brand color fails contrast gate for primary buttons (WCAG AA)",
      details: {
        brand,
        brandFg,
        ratio,
        required: CONTRAST_AA_UI,
      },
    };
  }

  // Prefer text AA when possible; still allow UI AA for edge mid-tones.
  // Document: derived safe fg always attached so public CFP never relies on draft.
  const brandSoft = tokens.brandSoft ?? softTintFromBrand(brand);

  return {
    ok: true,
    brandFg,
    ratio,
    tokens: {
      ...tokens,
      brandSoft,
      brandFg,
    },
  };
}
