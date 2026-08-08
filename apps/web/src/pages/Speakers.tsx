/**
 * Admin speakers list + detail (section 4.1 API surface for N01–N04).
 *
 * Full speakers UX polish lands in 6.3; this page wires real Speakers.List/Get
 * so list/search/detail/files metadata are not placeholders.
 */
import { useCallback, useEffect, useState } from "react";
import {
  AdminSpeakersListResponseSchema,
  AdminSpeakerDetailResponseSchema,
  ErrorEnvelopeSchema,
  type AdminSpeakerListItem,
  type AdminSpeakerDetailResponse,
} from "@speakerops/shared";
import { useEventContext } from "../events/EventContext.js";

export function SpeakersPage() {
  const { activeEventId } = useEventContext();
  const [speakers, setSpeakers] = useState<AdminSpeakerListItem[]>([]);
  const [q, setQ] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminSpeakerDetailResponse | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadList = useCallback(
    async (eventId: string, search: string) => {
      setLoadError(null);
      const params = new URLSearchParams();
      if (search.trim()) params.set("q", search.trim());
      const qs = params.toString();
      const url = `/api/events/${encodeURIComponent(eventId)}/speakers${qs ? `?${qs}` : ""}`;
      try {
        const res = await fetch(url, {
          credentials: "include",
          headers: { accept: "application/json" },
        });
        if (!res.ok) {
          const raw: unknown = await res.json().catch(() => null);
          const env = ErrorEnvelopeSchema.safeParse(raw);
          setLoadError(
            env.success ? env.data.error : `Load failed (${res.status})`,
          );
          return;
        }
        const raw: unknown = await res.json();
        const parsed = AdminSpeakersListResponseSchema.safeParse(raw);
        if (!parsed.success) {
          setLoadError("Unexpected speakers response");
          return;
        }
        setSpeakers(parsed.data.speakers);
      } catch {
        setLoadError("Network error");
      }
    },
    [],
  );

  useEffect(() => {
    if (activeEventId) {
      void loadList(activeEventId, q);
    } else {
      setSpeakers([]);
    }
  }, [activeEventId, q, loadList]);

  async function openDetail(participationId: string) {
    if (!activeEventId) return;
    setSelectedId(participationId);
    setDetail(null);
    setDetailError(null);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(activeEventId)}/speakers/${encodeURIComponent(participationId)}`,
        {
          credentials: "include",
          headers: { accept: "application/json" },
        },
      );
      if (!res.ok) {
        const raw: unknown = await res.json().catch(() => null);
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setDetailError(
          env.success ? env.data.error : `Detail failed (${res.status})`,
        );
        return;
      }
      const raw: unknown = await res.json();
      const parsed = AdminSpeakerDetailResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setDetailError("Unexpected detail response");
        return;
      }
      setDetail(parsed.data);
    } catch {
      setDetailError("Network error");
    }
  }

  return (
    <div className="event-settings" data-testid="page-speakers" data-section="4.1">
      <p className="page-stub__overline">Speakers</p>
      <h2 className="page-stub__title">Speakers</h2>
      <p className="page-stub__body">
        Event-scoped speaker list from accept/direct session participations.
        Search filters by name, email, company, title, bio.
      </p>

      {!activeEventId ? (
        <p className="eval-queue__muted" data-testid="speakers-no-event">
          Select an event to list speakers.
        </p>
      ) : null}

      {activeEventId ? (
        <section
          className="event-settings__card"
          data-testid="speakers-list-section"
        >
          <label className="event-settings__label" htmlFor="speakers-search">
            Search / filter
          </label>
          <input
            id="speakers-search"
            className="event-settings__input lumen-focusable"
            data-testid="speakers-search"
            value={q}
            onChange={(ev) => setQ(ev.target.value)}
            placeholder="Name, email, company…"
            maxLength={200}
          />

          {loadError ? (
            <p
              className="event-settings__status event-settings__status--error"
              data-testid="speakers-load-error"
              role="alert"
            >
              {loadError}
            </p>
          ) : null}

          {speakers.length === 0 && !loadError ? (
            <p className="eval-queue__muted" data-testid="speakers-empty">
              No speakers for this event yet.
            </p>
          ) : (
            <ul className="event-settings__list" data-testid="speakers-list">
              {speakers.map((s) => (
                <li
                  key={s.participation.id}
                  className="event-settings__list-item"
                  data-testid={`speaker-row-${s.participation.id}`}
                  data-participation-id={s.participation.id}
                >
                  <button
                    type="button"
                    className="eval-queue__link lumen-focusable"
                    data-testid={`speaker-open-${s.participation.id}`}
                    onClick={() => void openDetail(s.participation.id)}
                  >
                    {s.participation.personName ?? s.participation.personId}
                  </button>
                  <span className="eval-queue__muted">
                    {" "}
                    · {s.participation.personEmail ?? "—"} · tasks{" "}
                    {s.completedTaskCount}/{s.pendingTaskCount + s.completedTaskCount}{" "}
                    · sessions {s.sessionCount}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {selectedId ? (
        <section
          className="event-settings__card"
          data-testid="speakers-detail-section"
        >
          <h3 className="event-settings__heading">Speaker detail</h3>
          {detailError ? (
            <p
              className="event-settings__status event-settings__status--error"
              data-testid="speakers-detail-error"
              role="alert"
            >
              {detailError}
            </p>
          ) : null}
          {detail ? (
            <div data-testid="speakers-detail">
              <p data-testid="speakers-detail-name">
                <strong>
                  {detail.participation.personName ?? detail.participation.id}
                </strong>
              </p>
              <p className="eval-queue__muted" data-testid="speakers-detail-email">
                {detail.participation.personEmail}
              </p>
              <p data-testid="speakers-detail-bio">
                Bio: {detail.participation.bio ?? "—"}
              </p>

              <h4 className="event-settings__heading">Tasks</h4>
              <ul data-testid="speakers-detail-tasks">
                {detail.tasks.length === 0 ? (
                  <li className="eval-queue__muted">No tasks</li>
                ) : (
                  detail.tasks.map((t) => (
                    <li key={t.id} data-testid={`speakers-task-${t.id}`}>
                      {t.title} · {t.status}
                      {t.dueAt ? ` · due ${t.dueAt}` : ""}
                    </li>
                  ))
                )}
              </ul>

              <h4 className="event-settings__heading">Files</h4>
              <ul data-testid="speakers-detail-files">
                {detail.files.length === 0 ? (
                  <li className="eval-queue__muted" data-testid="speakers-files-empty">
                    No file metadata yet
                  </li>
                ) : (
                  detail.files.map((f) => (
                    <li
                      key={f.id}
                      data-testid={`speakers-file-${f.id}`}
                      data-file-purpose={f.purpose}
                    >
                      {f.filename} · {f.purpose} · {f.mime} · {f.size}b · uploaded=
                      {f.uploaded}
                    </li>
                  ))
                )}
              </ul>
            </div>
          ) : !detailError ? (
            <p className="eval-queue__muted">Loading…</p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
