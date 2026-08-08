/**
 * Admin speakers list + detail (section 4.1 API + 6.3 large list L05).
 *
 * Inventory N01–N04 + L05:
 *   N01 list · N02 search/filter · N03 detail tasks+files · N04 file metadata
 *   L05 150-row seed list paginates (page size 25)
 *
 * Deep-link from readiness H03: ?participationId=
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  AdminSpeakersListResponseSchema,
  AdminSpeakerDetailResponseSchema,
  ErrorEnvelopeSchema,
  type AdminSpeakerListItem,
  type AdminSpeakerDetailResponse,
} from "@speakerops/shared";
import { useEventContext } from "../events/EventContext.js";
import {
  SPEAKERS_PAGE_SIZE,
  paginateSlice,
  participationIdFromSearch,
} from "./readiness-utils.js";

export function SpeakersPage() {
  const { activeEventId } = useEventContext();
  const location = useLocation();
  const [speakers, setSpeakers] = useState<AdminSpeakerListItem[]>([]);
  const [q, setQ] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminSpeakerDetailResponse | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const loadList = useCallback(
    async (eventId: string, search: string) => {
      setLoadError(null);
      setLoading(true);
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
          setSpeakers([]);
          return;
        }
        const raw: unknown = await res.json();
        const parsed = AdminSpeakersListResponseSchema.safeParse(raw);
        if (!parsed.success) {
          setLoadError("Unexpected speakers response");
          setSpeakers([]);
          return;
        }
        setSpeakers(parsed.data.speakers);
      } catch {
        setLoadError("Network error");
        setSpeakers([]);
      } finally {
        setLoading(false);
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

  // Reset page when filter or event changes
  useEffect(() => {
    setPage(1);
  }, [q, activeEventId]);

  const openDetail = useCallback(
    async (participationId: string) => {
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
    },
    [activeEventId],
  );

  // H03 deep-link from readiness drill
  useEffect(() => {
    const id = participationIdFromSearch(location.search);
    if (id && activeEventId) {
      void openDetail(id);
    }
  }, [location.search, activeEventId, openDetail]);

  const paged = useMemo(
    () => paginateSlice(speakers, page, SPEAKERS_PAGE_SIZE),
    [speakers, page],
  );

  return (
    <div
      className="event-settings"
      data-testid="page-speakers"
      data-section="6.3"
    >
      <p className="page-stub__overline">Speakers</p>
      <h2 className="page-stub__title">Speakers</h2>
      <p className="page-stub__body">
        Event-scoped speaker list from accept/direct session participations.
        Search filters by name, email, company, title, bio. Lists paginate for
        seed sizes up to 150 (L05).
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

          {loading && speakers.length === 0 ? (
            <p className="eval-queue__muted" data-testid="speakers-loading">
              Loading speakers…
            </p>
          ) : null}

          {speakers.length === 0 && !loadError && !loading ? (
            <p className="eval-queue__muted" data-testid="speakers-empty">
              No speakers for this event yet.
            </p>
          ) : null}

          {speakers.length > 0 ? (
            <>
              <div
                className="speakers-list__meta"
                data-testid="speakers-list-meta"
                data-total={paged.total}
                data-page={paged.page}
                data-page-size={SPEAKERS_PAGE_SIZE}
              >
                <span className="eval-queue__muted">
                  {paged.total} speaker{paged.total === 1 ? "" : "s"}
                  {paged.totalPages > 1
                    ? ` · page ${paged.page} of ${paged.totalPages}`
                    : ""}
                </span>
              </div>

              <ul
                className="event-settings__list speakers-list__window"
                data-testid="speakers-list"
                data-total={paged.total}
                data-visible={paged.pageItems.length}
              >
                {paged.pageItems.map((s) => (
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
                      {s.completedTaskCount}/
                      {s.pendingTaskCount + s.completedTaskCount} · sessions{" "}
                      {s.sessionCount}
                    </span>
                  </li>
                ))}
              </ul>

              {paged.totalPages > 1 ? (
                <div
                  className="speakers-list__pager"
                  data-testid="speakers-pager"
                >
                  <button
                    type="button"
                    className="event-settings__submit lumen-focusable"
                    data-testid="speakers-page-prev"
                    disabled={paged.page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </button>
                  <span
                    className="eval-queue__muted"
                    data-testid="speakers-page-label"
                  >
                    Page {paged.page} / {paged.totalPages}
                  </span>
                  <button
                    type="button"
                    className="event-settings__submit lumen-focusable"
                    data-testid="speakers-page-next"
                    disabled={paged.page >= paged.totalPages}
                    onClick={() =>
                      setPage((p) => Math.min(paged.totalPages, p + 1))
                    }
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
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
