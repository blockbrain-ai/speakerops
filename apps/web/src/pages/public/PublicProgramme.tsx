/**
 * P11 public programme pages — Sessions, Speakers, Agenda, Itinerary, Gallery.
 * Fail-closed until F7 programme is published for the event slug.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, useParams } from "react-router-dom";
import {
  PublicProgrammeResponseSchema,
  type PublicProgrammeResponse,
  ErrorEnvelopeSchema,
} from "@speakerops/shared";

export type ProgrammeView =
  | "hub"
  | "sessions"
  | "speakers"
  | "agenda"
  | "itinerary"
  | "gallery";

function useProgramme(slug: string | undefined) {
  const [data, setData] = useState<PublicProgrammeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) {
      setError("Missing event");
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/public/programme/${encodeURIComponent(slug)}`,
          { headers: { accept: "application/json" } },
        );
        if (cancelled) return;
        if (!res.ok) {
          const raw: unknown = await res.json().catch(() => null);
          const env = ErrorEnvelopeSchema.safeParse(raw);
          setError(
            env.success
              ? env.data.error
              : res.status === 404
                ? "Programme not published yet"
                : `Failed (${res.status})`,
          );
          setData(null);
          return;
        }
        const parsed = PublicProgrammeResponseSchema.safeParse(
          await res.json(),
        );
        if (!parsed.success) {
          setError("Unexpected programme response");
          setData(null);
          return;
        }
        setData(parsed.data);
      } catch {
        if (!cancelled) {
          setError("Network error");
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return { data, error, loading };
}

function ProgrammeShell({
  slug,
  view,
  children,
  eventName,
  embed = false,
}: {
  slug: string;
  view: ProgrammeView;
  children: React.ReactNode;
  eventName?: string;
  /** N4: chrome-less embed host (iframe-friendly). */
  embed?: boolean;
}) {
  const base = embed
    ? `/embed/${encodeURIComponent(slug)}`
    : `/e/${encodeURIComponent(slug)}`;
  const nav: Array<{ view: ProgrammeView; path: string; label: string }> = [
    { view: "hub", path: base, label: "Overview" },
    { view: "sessions", path: `${base}/sessions`, label: "Sessions" },
    { view: "speakers", path: `${base}/speakers`, label: "Speakers" },
    { view: "agenda", path: `${base}/agenda`, label: "Agenda" },
    { view: "itinerary", path: `${base}/itinerary`, label: "Itinerary" },
    { view: "gallery", path: `${base}/gallery`, label: "Gallery" },
  ];
  return (
    <div
      className={
        embed
          ? "public-programme public-programme--embed"
          : "public-programme"
      }
      data-testid={embed ? "public-programme-embed" : "public-programme"}
      data-view={view}
      data-embed={embed ? "1" : "0"}
    >
      {embed ? (
        <header className="public-programme__embed-bar" data-testid="embed-header">
          {eventName ? (
            <h1 className="public-programme__title" data-testid="public-programme-title">
              {eventName}
            </h1>
          ) : (
            <span className="public-programme__muted">Programme embed</span>
          )}
        </header>
      ) : (
        <header className="public-programme__header">
          <div className="public-programme__brand">
            <Link to="/" className="public-programme__home lumen-focusable">
              speakerops
            </Link>
            {eventName ? (
              <h1
                className="public-programme__title"
                data-testid="public-programme-title"
              >
                {eventName}
              </h1>
            ) : null}
          </div>
          <nav className="public-programme__nav" aria-label="Programme">
            {nav.map((n) => (
              <NavLink
                key={n.view}
                to={n.path}
                end={n.view === "hub"}
                className={({ isActive }) =>
                  isActive
                    ? "public-programme__nav-link is-active lumen-focusable"
                    : "public-programme__nav-link lumen-focusable"
                }
                data-testid={`public-nav-${n.view}`}
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
        </header>
      )}
      <main className="public-programme__main">{children}</main>
    </div>
  );
}

export function PublicProgrammePage({
  view,
  embed = false,
}: {
  view: ProgrammeView;
  embed?: boolean;
}) {
  const { slug } = useParams<{ slug: string }>();
  const { data, error, loading } = useProgramme(slug);

  if (!slug) {
    return (
      <div className="public-programme" data-testid="public-programme-missing">
        <p>Missing event slug.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <ProgrammeShell slug={slug} view={view} embed={embed}>
        <p className="public-programme__muted" data-testid="public-programme-loading">
          Loading programme…
        </p>
      </ProgrammeShell>
    );
  }

  if (error || !data) {
    return (
      <ProgrammeShell slug={slug} view={view} embed={embed}>
        <div
          className="public-programme__empty"
          data-testid="public-programme-unpublished"
          role="status"
        >
          <h2>Programme not available</h2>
          <p>{error ?? "This programme has not been published yet."}</p>
          {!embed ? (
            <Link to="/" className="l2-btn l2-btn--secondary lumen-focusable">
              Back home
            </Link>
          ) : null}
        </div>
      </ProgrammeShell>
    );
  }

  return (
    <ProgrammeShell
      slug={slug}
      view={view}
      eventName={data.event.name}
      embed={embed}
    >
      {view === "hub" ? (
        <HubView data={data} slug={slug} embed={embed} />
      ) : null}
      {view === "sessions" ? <SessionsView data={data} /> : null}
      {view === "speakers" ? <SpeakersView data={data} /> : null}
      {view === "agenda" || view === "itinerary" ? (
        <AgendaView data={data} mode={view} />
      ) : null}
      {view === "gallery" ? <GalleryView data={data} /> : null}
      <p className="public-programme__fresh" data-testid="public-programme-fresh">
        Published {new Date(data.publishedAt).toLocaleString()} · v{data.version}
      </p>
    </ProgrammeShell>
  );
}

function HubView({
  data,
  slug,
  embed = false,
}: {
  data: PublicProgrammeResponse;
  slug: string;
  embed?: boolean;
}) {
  const base = embed
    ? `/embed/${encodeURIComponent(slug)}`
    : `/e/${encodeURIComponent(slug)}`;
  return (
    <div data-testid="public-hub">
      <p className="public-programme__lede">
        {data.sessions.length} sessions · {data.speakers.length} speakers
        {data.agenda.length > 0 ? ` · ${data.agenda.length} scheduled` : ""}
      </p>
      <div className="public-programme__tiles">
        <Link to={`${base}/sessions`} className="public-programme__tile lumen-focusable">
          <strong>Sessions</strong>
          <span>Browse the full list of talks</span>
        </Link>
        <Link to={`${base}/speakers`} className="public-programme__tile lumen-focusable">
          <strong>Speakers</strong>
          <span>Meet the people on stage</span>
        </Link>
        <Link to={`${base}/agenda`} className="public-programme__tile lumen-focusable">
          <strong>Agenda</strong>
          <span>Day-by-day schedule</span>
        </Link>
        <Link to={`${base}/gallery`} className="public-programme__tile lumen-focusable">
          <strong>Gallery</strong>
          <span>Speaker portraits</span>
        </Link>
      </div>
    </div>
  );
}

function SessionsView({ data }: { data: PublicProgrammeResponse }) {
  return (
    <div data-testid="public-sessions">
      <h2 className="public-programme__h2">Sessions</h2>
      {data.sessions.length === 0 ? (
        <p className="public-programme__muted">No sessions published yet.</p>
      ) : (
        <ul className="public-programme__list">
          {data.sessions.map((s) => (
            <li
              key={s.id}
              className="public-programme__card"
              data-testid={`public-session-${s.id}`}
            >
              <h3>{s.title}</h3>
              {s.trackName ? (
                <span
                  className="public-programme__chip"
                  style={
                    s.trackColor
                      ? {
                          background: s.trackColor,
                          color: "var(--lumen-text)",
                        }
                      : undefined
                  }
                >
                  {s.trackName}
                </span>
              ) : null}
              {s.speakers.length > 0 ? (
                <p className="public-programme__meta">
                  {s.speakers.map((sp) => sp.name).join(", ")}
                </p>
              ) : null}
              {s.startsAt ? (
                <p className="public-programme__meta">
                  {new Date(s.startsAt).toLocaleString()}
                  {s.roomName ? ` · ${s.roomName}` : ""}
                </p>
              ) : (
                <p className="public-programme__meta">Time TBA</p>
              )}
              {s.description ? (
                <p className="public-programme__desc">{s.description}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SpeakersView({ data }: { data: PublicProgrammeResponse }) {
  return (
    <div data-testid="public-speakers">
      <h2 className="public-programme__h2">Speakers</h2>
      {data.speakers.length === 0 ? (
        <p className="public-programme__muted">No speakers published yet.</p>
      ) : (
        <ul className="public-programme__speaker-grid">
          {data.speakers.map((sp) => (
            <li
              key={sp.id}
              className="public-programme__speaker-card"
              data-testid={`public-speaker-${sp.id}`}
            >
              <div className="public-programme__avatar" aria-hidden>
                {sp.headshotUrl ? (
                  <img src={sp.headshotUrl} alt="" />
                ) : (
                  <span>{sp.name.slice(0, 1)}</span>
                )}
              </div>
              <h3>{sp.name}</h3>
              {(sp.title || sp.company) && (
                <p className="public-programme__meta">
                  {[sp.title, sp.company].filter(Boolean).join(" · ")}
                </p>
              )}
              {sp.bio ? <p className="public-programme__desc">{sp.bio}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatInTz(
  iso: string,
  timeZone: string,
  opts: Intl.DateTimeFormatOptions,
): string {
  try {
    return new Date(iso).toLocaleString(undefined, { timeZone, ...opts });
  } catch {
    return new Date(iso).toLocaleString(undefined, opts);
  }
}

function dayKeyInTz(iso: string, timeZone: string): string {
  try {
    // en-CA → YYYY-MM-DD
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function AgendaView({
  data,
  mode,
}: {
  data: PublicProgrammeResponse;
  mode: "agenda" | "itinerary";
}) {
  const tz = data.event.timezone || "UTC";
  const byDay = useMemo(() => {
    const map = new Map<string, typeof data.agenda>();
    for (const item of data.agenda) {
      const day = dayKeyInTz(item.startsAt, tz);
      const list = map.get(day) ?? [];
      list.push(item);
      map.set(day, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data.agenda, tz]);

  return (
    <div data-testid={mode === "agenda" ? "public-agenda" : "public-itinerary"}>
      <h2 className="public-programme__h2">
        {mode === "agenda" ? "Agenda" : "Schedule itinerary"}
      </h2>
      {mode === "itinerary" ? (
        <p className="public-programme__lede">
          Chronological itinerary in {tz}.
        </p>
      ) : null}
      {data.agenda.length === 0 ? (
        <p className="public-programme__muted">Nothing scheduled yet.</p>
      ) : (
        byDay.map(([day, items]) => (
          <section key={day} className="public-programme__day">
            <h3 className="public-programme__day-title">
              {formatInTz(items[0]!.startsAt, tz, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </h3>
            <ol className="public-programme__agenda">
              {items.map((item) => (
                <li
                  key={item.placementId}
                  className="public-programme__agenda-row"
                  data-testid={`public-agenda-${item.placementId}`}
                >
                  <time className="public-programme__time">
                    {formatInTz(item.startsAt, tz, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                    {" – "}
                    {formatInTz(item.endsAt, tz, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </time>
                  <div>
                    <strong>{item.title}</strong>
                    <p className="public-programme__meta">
                      {[item.roomName, item.trackName, item.speakerNames.join(", ")]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ))
      )}
    </div>
  );
}

function GalleryView({ data }: { data: PublicProgrammeResponse }) {
  return (
    <div data-testid="public-gallery">
      <h2 className="public-programme__h2">Speaker gallery</h2>
      {data.speakers.length === 0 ? (
        <p className="public-programme__muted">Gallery is empty.</p>
      ) : (
        <ul className="public-programme__gallery">
          {data.speakers.map((sp) => (
            <li
              key={sp.id}
              className="public-programme__gallery-card"
              data-testid={`public-gallery-${sp.id}`}
            >
              <div className="public-programme__gallery-photo" aria-hidden>
                {sp.headshotUrl ? (
                  <img src={sp.headshotUrl} alt="" />
                ) : (
                  <span>{sp.name.slice(0, 1)}</span>
                )}
              </div>
              <h3>{sp.name}</h3>
              {(sp.title || sp.company) && (
                <p className="public-programme__meta">
                  {[sp.title, sp.company].filter(Boolean).join(" · ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
