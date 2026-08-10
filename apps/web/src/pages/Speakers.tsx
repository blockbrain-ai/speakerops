/**
 * Admin speakers lifecycle table + detail pane (section 4.1 / 6.3 / 11.6 S-L2-PORTAL).
 *
 * Inventory N01–N04 + L05:
 *   N01 list · N02 search/filter · N03 detail tasks+files · N04 file metadata
 *   L05 150-row seed list paginates (page size 25)
 *
 * Lumen 2 composition (page-atlas /admin/speakers):
 *   Lifecycle table over participations (not a portrait gallery CMS)
 *   Discrete readiness: accepted · confirmed · profile · tasks · session
 *   View filters: Needs action · All · Unconfirmed · Profile incomplete · Travel/tasks
 *   Detail pane: contact · sessions · tasks · files
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
import {
  SPEAKERS_VIEW_OPTIONS,
  deriveSpeakerReadiness,
  filterSpeakersByView,
  participationStatusLabel,
  readinessScore,
  speakerNeedsAction,
  READINESS_DIMENSION_LABELS,
  READINESS_DIMENSION_ORDER,
  type SpeakersViewFilter,
  type SpeakerReadiness,
  type SpeakerReadinessDimension,
} from "./speakers-utils.js";
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  Skeleton,
  type BadgeTone,
  type DataTableColumn,
} from "../components/ui/index.js";

function dimTone(ok: boolean): BadgeTone {
  return ok ? "success" : "warn";
}

function ReadinessDots({
  readiness,
  participationId,
}: {
  readiness: SpeakerReadiness;
  participationId: string;
}) {
  return (
    <div
      className="speakers-page__readiness"
      data-testid={`speakers-readiness-${participationId}`}
      data-score={readinessScore(readiness)}
      aria-label={`Readiness ${readinessScore(readiness)} of 5`}
    >
      {READINESS_DIMENSION_ORDER.map((dim: SpeakerReadinessDimension) => {
        const ok = readiness[dim];
        return (
          <span
            key={dim}
            className={
              ok
                ? "speakers-page__ready-dot speakers-page__ready-dot--ok"
                : "speakers-page__ready-dot speakers-page__ready-dot--gap"
            }
            data-testid={`speakers-ready-${dim}-${participationId}`}
            data-dim={dim}
            data-ready={ok ? "true" : "false"}
            title={READINESS_DIMENSION_LABELS[dim]}
          >
            <span className="speakers-page__ready-dot-label">
              {READINESS_DIMENSION_LABELS[dim]}
            </span>
          </span>
        );
      })}
    </div>
  );
}

export function SpeakersPage() {
  const { activeEventId } = useEventContext();
  const location = useLocation();
  const [speakers, setSpeakers] = useState<AdminSpeakerListItem[]>([]);
  const [q, setQ] = useState("");
  const [view, setView] = useState<SpeakersViewFilter>("needs_action");
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

  // Reset page when filter, view, or event changes
  useEffect(() => {
    setPage(1);
  }, [q, view, activeEventId]);

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
      // Deep-link should show the row even when "Needs action" would hide ready speakers
      setView("all");
      void openDetail(id);
    }
  }, [location.search, activeEventId, openDetail]);

  const filtered = useMemo(
    () => filterSpeakersByView(speakers, view),
    [speakers, view],
  );

  const paged = useMemo(
    () => paginateSlice(filtered, page, SPEAKERS_PAGE_SIZE),
    [filtered, page],
  );

  const columns: DataTableColumn<AdminSpeakerListItem>[] = useMemo(
    () => [
      {
        id: "speaker",
        header: "Speaker",
        primary: true,
        cell: (row) => {
          const name =
            row.participation.personName ?? row.participation.personId;
          const email = row.participation.personEmail ?? "—";
          return (
            <div>
              <button
                type="button"
                className="l2-table__link lumen-focusable"
                data-testid={`speaker-open-${row.participation.id}`}
                onClick={() => void openDetail(row.participation.id)}
              >
                <span className="l2-table__primary">{name}</span>
              </button>
              <span className="l2-table__secondary">{email}</span>
            </div>
          );
        },
      },
      {
        id: "status",
        header: "Status",
        cell: (row) => (
          <Badge
            tone={
              row.participation.status === "accepted" ||
              row.participation.status === "confirmed"
                ? "success"
                : "neutral"
            }
            data-testid={`speakers-status-${row.participation.id}`}
          >
            {participationStatusLabel(row.participation.status)}
          </Badge>
        ),
      },
      {
        id: "readiness",
        header: "Readiness",
        cell: (row) => (
          <ReadinessDots
            readiness={deriveSpeakerReadiness(row)}
            participationId={row.participation.id}
          />
        ),
      },
      {
        id: "tasks",
        header: "Tasks",
        cell: (row) => {
          const total = row.pendingTaskCount + row.completedTaskCount;
          return (
            <span data-testid={`speakers-tasks-count-${row.participation.id}`}>
              {row.completedTaskCount}/{total}
              {row.pendingTaskCount > 0 ? (
                <span className="l2-table__secondary">
                  {row.pendingTaskCount} open
                </span>
              ) : null}
            </span>
          );
        },
      },
      {
        id: "sessions",
        header: "Sessions",
        cell: (row) => (
          <span data-testid={`speakers-sessions-count-${row.participation.id}`}>
            {row.sessionCount}
          </span>
        ),
      },
    ],
    [openDetail],
  );

  const needsActionCount = useMemo(
    () =>
      speakers.filter((s) => speakerNeedsAction(deriveSpeakerReadiness(s)))
        .length,
    [speakers],
  );

  return (
    <div
      className="speakers-page speakers-page--l2"
      data-testid="page-speakers"
      data-section="11.6"
      data-layout="lifecycle-table"
    >
      <PageHeader
        eyebrow="Speakers"
        title="Speaker lifecycle"
        description="Move accepted participants from invitation to programme-ready. Readiness stays split across acceptance, confirmation, profile, tasks, and sessions — not a portrait gallery."
        data-testid="speakers-page-header"
      />

      {!activeEventId ? (
        <p className="eval-queue__muted" data-testid="speakers-no-event">
          Select an event to list speakers.
        </p>
      ) : null}

      {activeEventId ? (
        <div
          className="speakers-page__layout"
          data-testid="speakers-master-detail"
        >
          <section
            className="speakers-page__list-pane"
            data-testid="speakers-list-section"
            aria-label="Speaker lifecycle list"
          >
            <div
              className="speakers-page__toolbar"
              data-testid="speakers-filters"
            >
              <div
                className="speakers-page__filter-chips"
                data-testid="speakers-filter-chips"
                role="group"
                aria-label="Speaker views"
              >
                {SPEAKERS_VIEW_OPTIONS.map((opt) => {
                  const active = view === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      className={
                        active
                          ? "l2-chip l2-chip--active lumen-focusable"
                          : "l2-chip lumen-focusable"
                      }
                      data-testid={`speakers-chip-${opt.value}`}
                      aria-pressed={active}
                      onClick={() => setView(opt.value)}
                    >
                      {opt.label}
                      {opt.value === "needs_action" && needsActionCount > 0
                        ? ` (${needsActionCount})`
                        : ""}
                    </button>
                  );
                })}
              </div>

              <label
                className="speakers-page__search-label"
                htmlFor="speakers-search"
              >
                Search / filter
              </label>
              <input
                id="speakers-search"
                className="l2-field__control lumen-focusable speakers-page__search"
                data-testid="speakers-search"
                value={q}
                onChange={(ev) => setQ(ev.target.value)}
                placeholder="Name, email, company…"
                maxLength={200}
              />
            </div>

            {loadError ? (
              <Alert
                tone="danger"
                data-testid="speakers-load-error"
                role="alert"
              >
                {loadError}
              </Alert>
            ) : null}

            {loading && speakers.length === 0 ? (
              <div data-testid="speakers-loading" className="speakers-page__loading">
                <Skeleton variant="row" />
                <Skeleton variant="row" />
                <Skeleton variant="row" />
                <Skeleton variant="row" />
                <Skeleton variant="row" />
              </div>
            ) : null}

            {!loading && speakers.length === 0 && !loadError ? (
              <EmptyState
                title="No speakers yet"
                description="Accept a submission or create a direct session to materialize programme speakers for this event."
                data-testid="speakers-empty"
              />
            ) : null}

            {!loading &&
            speakers.length > 0 &&
            filtered.length === 0 &&
            !loadError ? (
              <EmptyState
                title="No speakers match this view"
                description="Try All speakers or clear the search to see the full lifecycle list."
                data-testid="speakers-empty"
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="speakers-view-all"
                    onClick={() => setView("all")}
                  >
                    Show all speakers
                  </Button>
                }
              />
            ) : null}

            {paged.pageItems.length > 0 ? (
              <>
                <div
                  className="speakers-list__meta"
                  data-testid="speakers-list-meta"
                  data-total={paged.total}
                  data-page={paged.page}
                  data-page-size={SPEAKERS_PAGE_SIZE}
                  data-view={view}
                >
                  <span className="eval-queue__muted">
                    {paged.total} speaker{paged.total === 1 ? "" : "s"}
                    {view !== "all" ? ` · ${view.replace(/_/g, " ")}` : ""}
                    {paged.totalPages > 1
                      ? ` · page ${paged.page} of ${paged.totalPages}`
                      : ""}
                  </span>
                </div>

                <DataTable
                  columns={columns}
                  rows={paged.pageItems}
                  getRowId={(row) => row.participation.id}
                  activeRowId={selectedId}
                  data-testid="speakers-list"
                  getRowTestId={(row) => `speaker-row-${row.participation.id}`}
                  wrapAttrs={{
                    "data-total": paged.total,
                    "data-visible": paged.pageItems.length,
                    "data-layout": "lifecycle-table",
                  }}
                  className="speakers-list__window"
                  density="compact"
                />
                {paged.totalPages > 1 ? (
                  <div
                    className="speakers-list__pager"
                    data-testid="speakers-pager"
                  >
                    <Button
                      variant="secondary"
                      size="sm"
                      data-testid="speakers-page-prev"
                      disabled={paged.page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      Previous
                    </Button>
                    <span
                      className="eval-queue__muted"
                      data-testid="speakers-page-label"
                    >
                      Page {paged.page} / {paged.totalPages}
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      data-testid="speakers-page-next"
                      disabled={paged.page >= paged.totalPages}
                      onClick={() =>
                        setPage((p) => Math.min(paged.totalPages, p + 1))
                      }
                    >
                      Next
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}
          </section>

          <aside
            className="speakers-page__detail-pane"
            data-testid="speakers-detail-section"
            aria-label="Speaker detail"
          >
            {!selectedId ? (
              <EmptyState
                title="Select a speaker"
                description="Open a row to review contact, sessions, tasks, and file metadata."
                icon="users"
                data-testid="speakers-detail-empty"
              />
            ) : null}

            {selectedId && detailError ? (
              <Alert
                tone="danger"
                data-testid="speakers-detail-error"
                role="alert"
              >
                {detailError}
              </Alert>
            ) : null}

            {selectedId && !detail && !detailError ? (
              <p className="eval-queue__muted" data-testid="speakers-detail-loading">
                Loading detail…
              </p>
            ) : null}

            {detail ? (
              <div
                className="speakers-page__detail"
                data-testid="speakers-detail"
              >
                <header
                  className="speakers-page__detail-header"
                  data-testid="speakers-detail-header"
                >
                  <h2
                    className="speakers-page__detail-title"
                    data-testid="speakers-detail-name"
                  >
                    {detail.participation.personName ??
                      detail.participation.id}
                  </h2>
                  <div className="speakers-page__detail-badges">
                    <Badge tone="brand">
                      {participationStatusLabel(detail.participation.status)}
                    </Badge>
                    <Badge
                      tone={
                        detail.participation.userId ? "success" : "warn"
                      }
                      data-testid="speakers-detail-confirmed"
                    >
                      {detail.participation.userId
                        ? "Account linked"
                        : "Unconfirmed"}
                    </Badge>
                  </div>
                </header>

                {/* Profile (admin view of speaker-facing fields) */}
                <Card
                  className="speakers-page__detail-card"
                  data-testid="speakers-detail-section-contact"
                >
                  <h3 className="speakers-page__detail-section-title">
                    Profile
                  </h3>
                  <div className="speakers-page__profile-layout">
                    <div
                      className="speakers-page__headshot-slot"
                      data-testid="speakers-detail-headshot"
                      data-has-headshot={
                        detail.participation.headshotFileId ? "true" : "false"
                      }
                    >
                      {detail.files.some((f) => f.purpose === "headshot") ? (
                        <span className="speakers-page__headshot-badge">
                          Photo on file
                        </span>
                      ) : detail.participation.headshotFileId ? (
                        <span className="speakers-page__headshot-badge">
                          Photo linked
                        </span>
                      ) : (
                        <span className="speakers-page__headshot-empty">
                          No photo
                        </span>
                      )}
                    </div>
                    <dl className="speakers-page__profile-dl">
                      <div className="speakers-page__profile-row">
                        <dt>Email</dt>
                        <dd data-testid="speakers-detail-email">
                          {detail.participation.personEmail ?? "—"}
                        </dd>
                      </div>
                      <div className="speakers-page__profile-row">
                        <dt>Job title</dt>
                        <dd data-testid="speakers-detail-title">
                          {detail.participation.title?.trim() || "—"}
                        </dd>
                      </div>
                      <div className="speakers-page__profile-row">
                        <dt>Company / organisation</dt>
                        <dd data-testid="speakers-detail-company">
                          {detail.participation.company?.trim() || "—"}
                        </dd>
                      </div>
                      <div className="speakers-page__profile-row speakers-page__profile-row--bio">
                        <dt>Bio</dt>
                        <dd data-testid="speakers-detail-bio">
                          {detail.participation.bio?.trim() || (
                            <span className="eval-queue__muted">
                              No bio yet — speaker can complete this in the
                              portal.
                            </span>
                          )}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </Card>

                {/* Readiness summary in detail */}
                <Card
                  className="speakers-page__detail-card"
                  data-testid="speakers-detail-section-readiness"
                >
                  <h3 className="speakers-page__detail-section-title">
                    Readiness
                  </h3>
                  <ul
                    className="speakers-page__ready-list"
                    data-testid="speakers-detail-readiness"
                  >
                    {READINESS_DIMENSION_ORDER.map((dim) => {
                      // Recompute from list row when available for list dims;
                      // detail enriches profile/tasks/sessions.
                      const listRow = speakers.find(
                        (s) => s.participation.id === detail.participation.id,
                      );
                      const fromList = listRow
                        ? deriveSpeakerReadiness(listRow)
                        : null;
                      let ok = false;
                      if (dim === "accepted") {
                        ok =
                          fromList?.accepted ??
                          (detail.participation.status === "accepted" ||
                            detail.participation.status === "confirmed");
                      } else if (dim === "confirmed") {
                        ok = Boolean(detail.participation.userId);
                      } else if (dim === "profile") {
                        const bioOk = Boolean(
                          detail.participation.bio?.trim(),
                        );
                        const affiliationOk =
                          Boolean(detail.participation.company?.trim()) ||
                          Boolean(detail.participation.title?.trim());
                        const photoOk = Boolean(
                          detail.participation.headshotFileId,
                        );
                        ok = bioOk && affiliationOk && photoOk;
                      } else if (dim === "tasks") {
                        ok =
                          detail.tasks.filter(
                            (t) =>
                              t.status === "pending" || t.status === "overdue",
                          ).length === 0;
                      } else if (dim === "session") {
                        ok = detail.sessions.length > 0;
                      }
                      return (
                        <li
                          key={dim}
                          data-testid={`speakers-detail-ready-${dim}`}
                          data-ready={ok ? "true" : "false"}
                        >
                          <Badge tone={dimTone(ok)} showDot>
                            {READINESS_DIMENSION_LABELS[dim]}
                            {ok ? " ready" : " needs work"}
                          </Badge>
                        </li>
                      );
                    })}
                  </ul>
                </Card>

                {/* Sessions */}
                <Card
                  className="speakers-page__detail-card"
                  data-testid="speakers-detail-section-sessions"
                >
                  <h3 className="speakers-page__detail-section-title">
                    Sessions
                  </h3>
                  <ul data-testid="speakers-detail-sessions">
                    {detail.sessions.length === 0 ? (
                      <li className="eval-queue__muted">No sessions linked</li>
                    ) : (
                      detail.sessions.map((s) => (
                        <li
                          key={s.id}
                          data-testid={`speakers-session-${s.id}`}
                          data-session-status={s.status}
                        >
                          {s.title} · {s.status}
                        </li>
                      ))
                    )}
                  </ul>
                </Card>

                {/* Tasks */}
                <Card
                  className="speakers-page__detail-card"
                  data-testid="speakers-detail-section-tasks"
                >
                  <h3 className="speakers-page__detail-section-title">Tasks</h3>
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
                </Card>

                {/* Files */}
                <Card
                  className="speakers-page__detail-card"
                  data-testid="speakers-detail-section-files"
                >
                  <h3 className="speakers-page__detail-section-title">Files</h3>
                  <ul
                    className="speakers-page__file-list"
                    data-testid="speakers-detail-files"
                  >
                    {detail.files.length === 0 ? (
                      <li
                        className="eval-queue__muted"
                        data-testid="speakers-files-empty"
                      >
                        No files yet (headshot / slides upload via speaker
                        portal)
                      </li>
                    ) : (
                      detail.files.map((f) => (
                        <li
                          key={f.id}
                          data-testid={`speakers-file-${f.id}`}
                          data-file-purpose={f.purpose}
                        >
                          <span className="speakers-page__file-name">
                            {f.filename || f.id}
                          </span>
                          <span className="speakers-page__file-meta">
                            {f.purpose === "headshot"
                              ? "Headshot"
                              : f.purpose === "slides"
                                ? "Slides"
                                : f.purpose}{" "}
                            · {f.mime}
                            {f.size
                              ? ` · ${Math.max(1, Math.round(f.size / 1024))} KB`
                              : ""}
                            {f.uploaded ? " · uploaded" : " · pending"}
                          </span>
                        </li>
                      ))
                    )}
                  </ul>
                </Card>
              </div>
            ) : null}
          </aside>
        </div>
      ) : null}
    </div>
  );
}
