/**
 * Design Kit admin — section 2.4 (S-THEME).
 *
 * Inventory: C03 brand, C04 logo, C05 publish, C06 no freeform CSS,
 * C08 contrast, C09 SVG reject, C10 draft isolation.
 *
 * Admin chrome does NOT retheme — live preview is scoped to a panel only.
 * Wired to Design.Get / SetDraft / Publish + File.Presign (logo PNG).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import {
  DesignGetResponseSchema,
  DesignSetDraftResponseSchema,
  DesignPublishResponseSchema,
  FilePresignResponseSchema,
  ErrorEnvelopeSchema,
  designTokensToCssVariables,
  deriveBrandFg,
  softTintFromBrand,
  type DesignDraft,
  type DesignPublished,
  type DesignTokens,
  type DesignRadius,
} from "@speakerops/shared";
import { useEventContext } from "../events/EventContext.js";
import { Link } from "react-router-dom";

type StatusMsg = { kind: "ok" | "error" | "warn"; text: string } | null;

const RADIUS_OPTIONS: { value: DesignRadius; label: string }[] = [
  { value: "soft", label: "Soft" },
  { value: "curvy", label: "Curvy" },
  { value: "round", label: "Round" },
];

const EMPTY_TOKENS: DesignTokens = {
  brand: "#4f46e5",
  brandSoft: "#eef2ff",
  radius: "soft",
  wordmark: "",
  logoFileId: null,
  brandFg: "#ffffff",
};

export function DesignKitPage() {
  const { activeEventId, activeEvent } = useEventContext();

  const [draft, setDraft] = useState<DesignDraft | null>(null);
  const [published, setPublished] = useState<DesignPublished | null>(null);
  const [brand, setBrand] = useState(EMPTY_TOKENS.brand);
  const [radius, setRadius] = useState<DesignRadius>("soft");
  const [wordmark, setWordmark] = useState("");
  const [logoFileId, setLogoFileId] = useState<string | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusMsg>(null);
  const [publishStatus, setPublishStatus] = useState<StatusMsg>(null);
  const [logoStatus, setLogoStatus] = useState<StatusMsg>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  /**
   * Monotonic load generation + active event id for correlating async design
   * fetches. A slower response for a previous event must not overwrite draft /
   * published / form state (C10 race: wrong tokens saved or published).
   */
  const loadGenRef = useRef(0);
  /**
   * Monotonic generations for save/publish so a completed request only clears
   * its own busy flag. Event switches bump these and reset saving/publishing;
   * otherwise a mid-flight finally that gated on activeEventId would leave the
   * new event stuck with formBusy forever, and a stale finally must not clear
   * a newer operation on the same (or re-selected) event.
   */
  const saveGenRef = useRef(0);
  const publishGenRef = useRef(0);
  const activeEventIdRef = useRef(activeEventId);
  activeEventIdRef.current = activeEventId;
  const activeEventNameRef = useRef(activeEvent?.name);
  activeEventNameRef.current = activeEvent?.name;

  const loadDesign = useCallback(async (eventId: string) => {
    const gen = ++loadGenRef.current;
    setLoadError(null);
    setLoading(true);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/design`,
        {
          credentials: "include",
          headers: { accept: "application/json" },
        },
      );
      // Stale: event switched or a newer load started.
      if (gen !== loadGenRef.current || activeEventIdRef.current !== eventId) {
        return;
      }
      if (!res.ok) {
        setLoadError(`Failed to load design (${res.status})`);
        return;
      }
      const raw: unknown = await res.json();
      if (gen !== loadGenRef.current || activeEventIdRef.current !== eventId) {
        return;
      }
      const parsed = DesignGetResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setLoadError("Invalid design response");
        return;
      }
      setDraft(parsed.data.draft);
      setPublished(parsed.data.published);
      if (parsed.data.draft) {
        const t = parsed.data.draft.tokens;
        setBrand(t.brand);
        setRadius(t.radius ?? "soft");
        setWordmark(t.wordmark ?? "");
        setLogoFileId(t.logoFileId ?? null);
      } else {
        setBrand(EMPTY_TOKENS.brand);
        setRadius("soft");
        setWordmark(activeEventNameRef.current ?? "");
        setLogoFileId(null);
      }
    } catch {
      if (gen !== loadGenRef.current || activeEventIdRef.current !== eventId) {
        return;
      }
      setLoadError("Failed to load design");
    } finally {
      if (gen === loadGenRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    // Invalidate in-flight load/save/publish so their finally blocks cannot
    // leave formBusy stuck or clear a newer operation on the next event.
    loadGenRef.current += 1;
    saveGenRef.current += 1;
    publishGenRef.current += 1;
    setSaving(false);
    setPublishing(false);

    if (!activeEventId) {
      setLoading(false);
      setDraft(null);
      setPublished(null);
      setBrand(EMPTY_TOKENS.brand);
      setRadius("soft");
      setWordmark("");
      setLogoFileId(null);
      setLoadError(null);
      setStatus(null);
      setPublishStatus(null);
      return;
    }
    // Reset form immediately on event switch so prior event tokens cannot be
    // saved/published against the new event while the load is in flight.
    setDraft(null);
    setPublished(null);
    setStatus(null);
    setPublishStatus(null);
    setLogoStatus(null);
    void loadDesign(activeEventId);
  }, [activeEventId, loadDesign]);

  const liveTokens: DesignTokens = useMemo(
    () => ({
      brand,
      brandSoft: softTintFromBrand(brand),
      radius,
      wordmark: wordmark.trim() === "" ? null : wordmark.trim(),
      logoFileId,
      brandFg: deriveBrandFg(brand),
    }),
    [brand, radius, wordmark, logoFileId],
  );

  /** Scoped preview styles only — never applied to admin-shell. */
  const previewStyle = useMemo(() => {
    const css = designTokensToCssVariables(liveTokens);
    // Convert "a: b; c: d" into a style object for React
    const style: Record<string, string> = {};
    for (const part of css.split(";")) {
      const idx = part.indexOf(":");
      if (idx === -1) continue;
      const key = part.slice(0, idx).trim();
      const val = part.slice(idx + 1).trim();
      if (key && val) style[key] = val.replace(/^"|"$/g, "");
    }
    return style as CSSProperties;
  }, [liveTokens]);

  async function onSaveDraft(e: FormEvent) {
    e.preventDefault();
    if (!activeEventId || loading) return;
    const eventId = activeEventId;
    const gen = ++saveGenRef.current;
    setSaving(true);
    setStatus(null);
    try {
      const body = {
        tokens: liveTokens,
        expectedVersion: draft?.version,
      };
      const res = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/design`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      // Ignore result if superseded (event switch or newer save).
      if (gen !== saveGenRef.current || activeEventIdRef.current !== eventId) {
        return;
      }
      const raw: unknown = await res.json().catch(() => null);
      if (gen !== saveGenRef.current || activeEventIdRef.current !== eventId) {
        return;
      }
      if (!res.ok) {
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setStatus({
          kind: "error",
          text: env.success ? env.data.error : `Save failed (${res.status})`,
        });
        return;
      }
      const parsed = DesignSetDraftResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setStatus({ kind: "error", text: "Unexpected response" });
        return;
      }
      setDraft(parsed.data.draft);
      setStatus({ kind: "ok", text: "Draft saved" });
    } catch {
      if (gen !== saveGenRef.current || activeEventIdRef.current !== eventId) {
        return;
      }
      setStatus({ kind: "error", text: "Network error" });
    } finally {
      if (gen === saveGenRef.current) {
        setSaving(false);
      }
    }
  }

  async function onPublish() {
    if (!activeEventId || !draft || loading) {
      setPublishStatus({
        kind: "error",
        text: "Save a draft before publishing",
      });
      return;
    }
    const eventId = activeEventId;
    const expectedVersion = draft.version;
    const gen = ++publishGenRef.current;
    setPublishing(true);
    setPublishStatus(null);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/design/publish`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expectedVersion }),
        },
      );
      if (gen !== publishGenRef.current || activeEventIdRef.current !== eventId) {
        return;
      }
      const raw: unknown = await res.json().catch(() => null);
      if (gen !== publishGenRef.current || activeEventIdRef.current !== eventId) {
        return;
      }
      if (!res.ok) {
        const env = ErrorEnvelopeSchema.safeParse(raw);
        const code = env.success ? env.data.code : "";
        const msg = env.success ? env.data.error : `Publish failed (${res.status})`;
        setPublishStatus({
          kind: code === "CONTRAST_FAILED" ? "warn" : "error",
          text: msg,
        });
        return;
      }
      const parsed = DesignPublishResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setPublishStatus({ kind: "error", text: "Unexpected response" });
        return;
      }
      setPublished(parsed.data.published);
      // Reload draft (may include derived brandFg) — only if still this event.
      if (
        gen === publishGenRef.current &&
        activeEventIdRef.current === eventId
      ) {
        await loadDesign(eventId);
      }
      if (gen !== publishGenRef.current || activeEventIdRef.current !== eventId) {
        return;
      }
      setPublishStatus({
        kind: "ok",
        text: `Published (brandFg ${parsed.data.published.tokens.brandFg ?? "derived"})`,
      });
    } catch {
      if (gen !== publishGenRef.current || activeEventIdRef.current !== eventId) {
        return;
      }
      setPublishStatus({ kind: "error", text: "Network error" });
    } finally {
      if (gen === publishGenRef.current) {
        setPublishing(false);
      }
    }
  }

  async function onLogoFileChange(fileList: FileList | null) {
    if (!activeEventId || loading || !fileList || fileList.length === 0) return;
    const eventId = activeEventId;
    const file = fileList[0]!;
    setLogoStatus(null);

    // Client-side reject SVG / non-PNG (server also rejects)
    if (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) {
      setLogoStatus({
        kind: "error",
        text: "SVG logos are not allowed",
      });
      return;
    }
    if (file.type !== "image/png") {
      setLogoStatus({
        kind: "error",
        text: "Logo must be PNG only",
      });
      return;
    }

    try {
      const res = await fetch("/api/files/presign", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventId,
          purpose: "logo",
          mime: file.type || "image/png",
          size: file.size,
          filename: file.name,
        }),
      });
      if (activeEventIdRef.current !== eventId) return;
      const raw: unknown = await res.json().catch(() => null);
      if (activeEventIdRef.current !== eventId) return;
      if (!res.ok) {
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setLogoStatus({
          kind: "error",
          text: env.success ? env.data.error : `Upload rejected (${res.status})`,
        });
        return;
      }
      const parsed = FilePresignResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setLogoStatus({ kind: "error", text: "Unexpected presign response" });
        return;
      }

      // PUT PNG bytes to the presigned upload URL (required before logo is ready)
      const uploadRes = await fetch(parsed.data.url, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "image/png" },
        body: file,
      });
      if (activeEventIdRef.current !== eventId) return;
      if (!uploadRes.ok) {
        const uploadRaw: unknown = await uploadRes.json().catch(() => null);
        const env = ErrorEnvelopeSchema.safeParse(uploadRaw);
        setLogoStatus({
          kind: "error",
          text: env.success
            ? env.data.error
            : `Upload failed (${uploadRes.status})`,
        });
        return;
      }

      setLogoFileId(parsed.data.fileId);
      // Local object URL for inert <img> preview (never execute SVG)
      if (logoPreviewUrl) URL.revokeObjectURL(logoPreviewUrl);
      setLogoPreviewUrl(URL.createObjectURL(file));
      setLogoStatus({
        kind: "ok",
        text: `Logo ready (${parsed.data.fileId.slice(0, 8)}…)`,
      });
    } catch {
      if (activeEventIdRef.current !== eventId) return;
      setLogoStatus({ kind: "error", text: "Network error" });
    }
  }

  const formBusy = loading || saving || publishing;

  return (
    <div className="design-kit" data-testid="page-design-kit" data-section="2.4">
      <p className="page-stub__overline">Settings · Design</p>
      <h2 className="page-stub__title">Design Kit</h2>
      <p className="page-stub__body">
        Brand tokens for public CFP only. Admin chrome stays Lumen default.
        No freeform CSS.{" "}
        <Link to="/admin/settings" className="design-kit__link lumen-focusable">
          ← Event settings
        </Link>
      </p>

      {loadError ? (
        <p
          className="event-settings__status event-settings__status--error"
          data-testid="design-load-error"
        >
          {loadError}
        </p>
      ) : null}

      {!activeEventId ? (
        <p className="page-stub__body" data-testid="design-no-event">
          Select or create an event first.
        </p>
      ) : (
        <div className="design-kit__grid">
          <form
            className="event-settings__card design-kit__form"
            onSubmit={onSaveDraft}
            data-testid="design-form"
            data-loading={loading ? "true" : "false"}
            aria-busy={loading}
          >
            <h3 className="event-settings__heading">Draft tokens</h3>

            <label className="event-settings__label" htmlFor="design-brand">
              Brand color
            </label>
            <div className="design-kit__brand-row">
              <input
                id="design-brand"
                type="color"
                className="design-kit__color lumen-focusable"
                data-testid="design-brand-color"
                value={brand.length === 7 ? brand : "#4f46e5"}
                onChange={(ev) => setBrand(ev.target.value)}
                disabled={formBusy}
              />
              <input
                className="event-settings__input lumen-focusable"
                data-testid="design-brand-hex"
                value={brand}
                onChange={(ev) => setBrand(ev.target.value)}
                pattern="^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$"
                maxLength={7}
                aria-label="Brand hex"
                disabled={formBusy}
              />
            </div>

            <label className="event-settings__label" htmlFor="design-radius">
              Radius
            </label>
            <select
              id="design-radius"
              className="event-settings__input lumen-focusable"
              data-testid="design-radius"
              value={radius}
              onChange={(ev) => setRadius(ev.target.value as DesignRadius)}
              disabled={formBusy}
            >
              {RADIUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            <label className="event-settings__label" htmlFor="design-wordmark">
              Wordmark
            </label>
            <input
              id="design-wordmark"
              className="event-settings__input lumen-focusable"
              data-testid="design-wordmark"
              value={wordmark}
              onChange={(ev) => setWordmark(ev.target.value)}
              maxLength={120}
              disabled={formBusy}
            />

            <label className="event-settings__label" htmlFor="design-logo">
              Logo (PNG only)
            </label>
            <input
              id="design-logo"
              type="file"
              accept="image/png"
              className="event-settings__input lumen-focusable"
              data-testid="design-logo-input"
              onChange={(ev) => void onLogoFileChange(ev.target.files)}
              disabled={formBusy}
            />
            {logoStatus ? (
              <p
                className={
                  logoStatus.kind === "ok"
                    ? "event-settings__status event-settings__status--ok"
                    : "event-settings__status event-settings__status--error"
                }
                data-testid="design-logo-status"
                role="status"
              >
                {logoStatus.text}
              </p>
            ) : null}
            {logoFileId ? (
              <p className="event-settings__meta" data-testid="design-logo-file-id">
                logoFileId: {logoFileId}
              </p>
            ) : null}

            {/* C06: freeform CSS control must be absent — do not render any custom CSS field */}

            <button
              type="submit"
              className="event-settings__submit lumen-focusable"
              data-testid="design-save-draft"
              disabled={formBusy}
            >
              {saving ? "Saving…" : loading ? "Loading…" : "Save draft"}
            </button>
            {status ? (
              <p
                className={
                  status.kind === "ok"
                    ? "event-settings__status event-settings__status--ok"
                    : "event-settings__status event-settings__status--error"
                }
                data-testid="design-save-status"
                role="status"
              >
                {status.text}
              </p>
            ) : null}

            <div className="design-kit__publish">
              <button
                type="button"
                className="event-settings__submit lumen-focusable"
                data-testid="design-publish"
                disabled={formBusy || !draft}
                onClick={() => void onPublish()}
              >
                {publishing ? "Publishing…" : "Publish tokens"}
              </button>
              {publishStatus ? (
                <p
                  className={
                    publishStatus.kind === "ok"
                      ? "event-settings__status event-settings__status--ok"
                      : publishStatus.kind === "warn"
                        ? "event-settings__status event-settings__status--warn"
                        : "event-settings__status event-settings__status--error"
                  }
                  data-testid="design-publish-status"
                  role="status"
                >
                  {publishStatus.text}
                </p>
              ) : null}
              {published ? (
                <p
                  className="event-settings__meta"
                  data-testid="design-published-meta"
                >
                  Published v{published.version} at {published.publishedAt} · brand{" "}
                  {published.tokens.brand}
                  {published.tokens.brandFg
                    ? ` · fg ${published.tokens.brandFg}`
                    : ""}
                </p>
              ) : (
                <p className="event-settings__meta" data-testid="design-not-published">
                  No published tokens yet — public CFP uses Lumen defaults.
                </p>
              )}
            </div>
          </form>

          {/* Live preview — scoped tokens only; does not retheme admin chrome */}
          <section
            className="event-settings__card design-kit__preview"
            data-testid="design-preview"
            style={previewStyle}
            aria-label="Brand preview"
          >
            <h3 className="event-settings__heading">Live preview</h3>
            <p className="design-kit__preview-wordmark" data-testid="design-preview-wordmark">
              {wordmark.trim() || activeEvent?.name || "Wordmark"}
            </p>
            {logoPreviewUrl ? (
              <img
                src={logoPreviewUrl}
                alt="Logo preview"
                className="design-kit__preview-logo"
                data-testid="design-preview-logo"
              />
            ) : null}
            <button
              type="button"
              className="design-kit__preview-btn lumen-focusable"
              data-testid="design-preview-button"
            >
              Primary action
            </button>
            <p className="event-settings__meta" data-testid="design-preview-brand">
              brand {brand} · radius {radius} · onBrand {liveTokens.brandFg}
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
