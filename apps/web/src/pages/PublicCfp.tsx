/**
 * Public CFP surface — applies published Design Kit tokens only (section 2.4).
 *
 * Draft tokens never load here (C10). Admin chrome is not used.
 * Full form lands in section 3.3; this page proves brand publish (C05).
 */
import { useEffect, useState, type CSSProperties } from "react";
import { useParams } from "react-router-dom";
import {
  PublicDesignResponseSchema,
  type DesignPublished,
} from "@speakerops/shared";

export function PublicCfpPage() {
  const { slug } = useParams<{ slug: string }>();
  const [published, setPublished] = useState<DesignPublished | null>(null);
  const [cssVariables, setCssVariables] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ok" | "error">(
    "loading",
  );

  useEffect(() => {
    if (!slug) {
      setLoadState("error");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/public/design/${encodeURIComponent(slug)}`,
          { headers: { accept: "application/json" } },
        );
        if (!res.ok) {
          if (!cancelled) setLoadState("error");
          return;
        }
        const raw: unknown = await res.json();
        const parsed = PublicDesignResponseSchema.safeParse(raw);
        if (!parsed.success) {
          if (!cancelled) setLoadState("error");
          return;
        }
        if (!cancelled) {
          setPublished(parsed.data.published);
          setCssVariables(parsed.data.cssVariables);
          setLoadState("ok");
        }
      } catch {
        if (!cancelled) setLoadState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  /** Apply published CSS vars only on this public root — never on admin. */
  const style: CSSProperties | undefined = cssVariables
    ? (() => {
        const s: Record<string, string> = {};
        for (const part of cssVariables.split(";")) {
          const idx = part.indexOf(":");
          if (idx === -1) continue;
          const key = part.slice(0, idx).trim();
          const val = part.slice(idx + 1).trim().replace(/^"|"$/g, "");
          if (key && val) s[key] = val;
        }
        return s as CSSProperties;
      })()
    : undefined;

  return (
    <section
      className="public-cfp"
      data-testid="page-public-cfp"
      data-section="2.4"
      data-has-published={published ? "true" : "false"}
      style={style}
    >
      <p className="page-stub__overline">Public</p>
      <h2 className="page-stub__title" data-testid="public-cfp-title">
        {published?.tokens.wordmark?.trim() || "CFP"}
      </h2>
      {loadState === "loading" ? (
        <p className="page-stub__body" data-testid="public-cfp-skeleton">
          Loading…
        </p>
      ) : null}
      {loadState === "error" ? (
        <p
          className="event-settings__status event-settings__status--error"
          data-testid="public-cfp-error"
        >
          Could not load public design for this event.
        </p>
      ) : null}
      {loadState === "ok" ? (
        <>
          <p className="page-stub__body">
            Public CFP form lands in section 3.3. Brand tokens below come from
            published Design Kit only (never draft).
          </p>
          <div
            className="public-cfp__brand-panel"
            data-testid="public-cfp-brand"
          >
            <button
              type="button"
              className="public-cfp__primary lumen-focusable"
              data-testid="public-cfp-primary"
            >
              Submit proposal
            </button>
            <p
              className="event-settings__meta"
              data-testid="public-cfp-brand-value"
            >
              {published
                ? `published brand ${published.tokens.brand}${
                    published.tokens.brandFg
                      ? ` · fg ${published.tokens.brandFg}`
                      : ""
                  }`
                : "no published brand (Lumen defaults)"}
            </p>
            {published?.tokens.logoFileId ? (
              <>
                <img
                  src={`/api/public/files/${encodeURIComponent(published.tokens.logoFileId)}`}
                  alt=""
                  className="public-cfp__logo"
                  data-testid="public-cfp-logo"
                />
                <p
                  className="event-settings__meta"
                  data-testid="public-cfp-logo-id"
                >
                  logo {published.tokens.logoFileId}
                </p>
              </>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
