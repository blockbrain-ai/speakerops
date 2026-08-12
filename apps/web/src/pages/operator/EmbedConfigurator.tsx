/**
 * N4 public embeds configurator — copy iframe code for published programme feeds.
 * Same read model as /e/:slug/* (F7 programme publication); no separate SoR.
 */
import { useMemo, useState } from "react";
import { useEventContext } from "../../events/EventContext.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { Button } from "../../components/ui/Button.js";

const EMBED_TYPES = [
  { id: "sessions", label: "Session list", path: "sessions" },
  { id: "speakers", label: "Speaker list", path: "speakers" },
  { id: "agenda", label: "Agenda", path: "agenda" },
  { id: "itinerary", label: "Schedule itinerary", path: "itinerary" },
  { id: "gallery", label: "Speaker gallery", path: "gallery" },
] as const;

type EmbedTypeId = (typeof EMBED_TYPES)[number]["id"];

export function EmbedConfiguratorPage() {
  const { activeEvent } = useEventContext();
  const [embedType, setEmbedType] = useState<EmbedTypeId>("sessions");
  const [height, setHeight] = useState(640);
  const [copied, setCopied] = useState(false);

  const slug = activeEvent?.slug?.trim() || "";
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://www.speakerops.org";

  const selected = EMBED_TYPES.find((t) => t.id === embedType) ?? EMBED_TYPES[0];
  const embedUrl = useMemo(() => {
    if (!slug) return "";
    return `${origin}/embed/${encodeURIComponent(slug)}/${selected.path}`;
  }, [origin, slug, selected.path]);

  const iframeCode = useMemo(() => {
    if (!embedUrl) return "";
    return `<iframe\n  src="${embedUrl}"\n  title="SpeakerOps ${selected.label}"\n  width="100%"\n  height="${height}"\n  style="border:0;border-radius:12px;background:#fff"\n  loading="lazy"\n  referrerpolicy="no-referrer-when-downgrade"\n></iframe>`;
  }, [embedUrl, height, selected.label]);

  async function copyCode() {
    if (!iframeCode) return;
    try {
      await navigator.clipboard.writeText(iframeCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div data-testid="page-embeds" data-section="n4-embeds">
      <PageHeader
        eyebrow="Public"
        title="Embeds"
        description="Drop published programme feeds on your event site. Requires Publish programme on Overview first."
        data-testid="embeds-page-header"
      />
      {!slug ? (
        <p className="eval-queue__muted" data-testid="embeds-no-slug">
          Select an event with a public slug to generate embed code.
        </p>
      ) : (
        <div className="embeds-config" data-testid="embeds-config">
          <div className="embeds-config__controls">
            <label className="portal-label" htmlFor="embed-type">
              Feed type
            </label>
            <select
              id="embed-type"
              className="portal-input lumen-focusable"
              data-testid="embed-type-select"
              value={embedType}
              onChange={(e) => setEmbedType(e.target.value as EmbedTypeId)}
            >
              {EMBED_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>

            <label className="portal-label" htmlFor="embed-height">
              Iframe height (px)
            </label>
            <input
              id="embed-height"
              type="number"
              min={320}
              max={1600}
              step={20}
              className="portal-input lumen-focusable"
              data-testid="embed-height-input"
              value={height}
              onChange={(e) => setHeight(Number(e.target.value) || 640)}
            />

            <p className="eval-queue__muted" data-testid="embed-url-preview">
              URL: <code>{embedUrl}</code>
            </p>

            <Button
              type="button"
              data-testid="embed-copy-code"
              onClick={() => void copyCode()}
            >
              {copied ? "Copied" : "Copy embed code"}
            </Button>
          </div>

          <div className="embeds-config__preview">
            <label className="portal-label">Live preview</label>
            <iframe
              title={`Embed preview ${selected.label}`}
              src={embedUrl}
              className="embeds-config__frame"
              data-testid="embed-live-preview"
              height={height}
            />
            <label className="portal-label" htmlFor="embed-code">
              Code
            </label>
            <textarea
              id="embed-code"
              className="portal-textarea lumen-focusable"
              data-testid="embed-code"
              readOnly
              rows={8}
              value={iframeCode}
            />
          </div>
        </div>
      )}
    </div>
  );
}
