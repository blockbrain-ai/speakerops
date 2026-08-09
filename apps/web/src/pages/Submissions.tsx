/**
 * Admin submissions + decisions UI (section 3.5 / S-EVAL + 10.1 reliability).
 *
 * Inventory: E01 list filters · E02 detail · E03 assign · E04 accept
 * · E05 reject · E06 waitlist · E07 direct session · E08 bulk preview
 * · L02/L03 empty/error/loading · S-SUB-LIST page window
 *
 * Wired to real APIs:
 * GET  /api/events/:eventId/submissions  (?status&category&limit&offset)
 * GET  /api/submissions/:id
 * POST /api/submissions/:id/decision
 * POST /api/submissions/:id/assign
 * POST /api/events/:eventId/sessions/direct
 * POST /api/events/:eventId/submissions/bulk-preview
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  SubmissionListResponseSchema,
  SubmissionDetailResponseSchema,
  DecisionRecordResponseSchema,
  DirectSessionResponseSchema,
  BulkDecisionPreviewResponseSchema,
  SubmissionAssignResponseSchema,
  ErrorEnvelopeSchema,
  SUBMISSION_LIST_DEFAULT_LIMIT,
  type SubmissionListItem,
  type SubmissionDetailResponse,
  type BulkDecisionPreviewItem,
  type DecisionValue,
} from "@speakerops/shared";
import { useEventContext } from "../events/EventContext.js";

type StatusMsg = { kind: "ok" | "error"; text: string } | null;

const STATUS_OPTIONS = [
  "",
  "submitted",
  "in_review",
  "accepted",
  "rejected",
  "waitlist",
  "withdrawn",
  "draft",
] as const;

/** Abort hung list fetches so Loading never sticks forever (AC-10.1-B). */
const LIST_FETCH_TIMEOUT_MS = 12_000;

export function SubmissionsPage() {
  const { activeEventId } = useEventContext();
  const [rows, setRows] = useState<SubmissionListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [listLimit, setListLimit] = useState<number>(
    SUBMISSION_LIST_DEFAULT_LIMIT,
  );
  const [listOffset, setListOffset] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<SubmissionDetailResponse | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusMsg>(null);
  const [reason, setReason] = useState("");
  const [assignUserId, setAssignUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const loadGen = useRef(0);

  // Direct session form (E07)
  const [directOpen, setDirectOpen] = useState(false);
  const [directTitle, setDirectTitle] = useState("");
  const [directDesc, setDirectDesc] = useState("");
  const [directSpeakerName, setDirectSpeakerName] = useState("");
  const [directSpeakerEmail, setDirectSpeakerEmail] = useState("");

  // Bulk preview (E08)
  const [bulkPreview, setBulkPreview] = useState<{
    decision: DecisionValue;
    items: BulkDecisionPreviewItem[];
  } | null>(null);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / Math.max(1, listLimit)) || 1),
    [total, listLimit],
  );

  const loadList = useCallback(
    async (eventId: string, pageNum: number) => {
      const gen = ++loadGen.current;
      setLoading(true);
      setLoadError(null);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), LIST_FETCH_TIMEOUT_MS);
      try {
        const offset = Math.max(0, (pageNum - 1) * SUBMISSION_LIST_DEFAULT_LIMIT);
        const params = new URLSearchParams();
        if (statusFilter) params.set("status", statusFilter);
        if (categoryFilter) params.set("category", categoryFilter);
        params.set("limit", String(SUBMISSION_LIST_DEFAULT_LIMIT));
        params.set("offset", String(offset));
        const qs = params.toString();
        const url = `/api/events/${encodeURIComponent(eventId)}/submissions?${qs}`;
        const res = await fetch(url, {
          credentials: "include",
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        if (gen !== loadGen.current) return;
        if (!res.ok) {
          const raw: unknown = await res.json().catch(() => null);
          const env = ErrorEnvelopeSchema.safeParse(raw);
          setLoadError(
            env.success
              ? env.data.error
              : res.status === 401
                ? "Session expired — sign in again"
                : `Failed (${res.status})`,
          );
          setRows([]);
          setTotal(0);
          return;
        }
        const raw: unknown = await res.json();
        const parsed = SubmissionListResponseSchema.safeParse(raw);
        if (!parsed.success) {
          setLoadError(
            "Unexpected list response — could not display submissions. Retry or contact support.",
          );
          setRows([]);
          setTotal(0);
          return;
        }
        setRows(parsed.data.submissions);
        setTotal(parsed.data.total);
        setListLimit(parsed.data.limit);
        setListOffset(parsed.data.offset);
        setCategories(parsed.data.categories ?? []);
      } catch (err) {
        if (gen !== loadGen.current) return;
        if (err instanceof DOMException && err.name === "AbortError") {
          setLoadError(
            "Submissions list timed out. Check your connection and retry.",
          );
        } else {
          setLoadError("Network error — could not load submissions.");
        }
        setRows([]);
        setTotal(0);
      } finally {
        clearTimeout(timer);
        if (gen === loadGen.current) {
          setLoading(false);
        }
      }
    },
    [statusFilter, categoryFilter],
  );

  // Reset to page 1 when filters or event change (keep filters when paging)
  useEffect(() => {
    setPage(1);
  }, [statusFilter, categoryFilter, activeEventId]);

  useEffect(() => {
    if (activeEventId) {
      void loadList(activeEventId, page);
    } else {
      setRows([]);
      setTotal(0);
      setLoadError(null);
      setLoading(false);
    }
  }, [activeEventId, loadList, page]);

  async function openDetail(id: string, opts?: { clearStatus?: boolean }) {
    setDetailId(id);
    if (opts?.clearStatus !== false) {
      // Default clear; decision handlers pass clearStatus:false to keep success toast
      setStatus(null);
    }
    setReason("");
    try {
      const res = await fetch(`/api/submissions/${encodeURIComponent(id)}`, {
        credentials: "include",
        headers: { accept: "application/json" },
      });
      if (!res.ok) {
        const raw: unknown = await res.json().catch(() => null);
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setStatus({
          kind: "error",
          text: env.success ? env.data.error : `Failed (${res.status})`,
        });
        setDetail(null);
        return;
      }
      const raw: unknown = await res.json();
      const parsed = SubmissionDetailResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setStatus({ kind: "error", text: "Unexpected detail response" });
        setDetail(null);
        return;
      }
      setDetail(parsed.data);
    } catch {
      setStatus({ kind: "error", text: "Network error" });
    }
  }

  async function recordDecision(decision: DecisionValue) {
    if (!detail) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch(
        `/api/submissions/${encodeURIComponent(detail.submission.id)}/decision`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            decision,
            reason: reason.trim() ? reason.trim() : null,
            expectedVersion: detail.submission.version,
          }),
        },
      );
      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setStatus({
          kind: "error",
          text: env.success ? env.data.error : `Failed (${res.status})`,
        });
        setBusy(false);
        return;
      }
      const parsed = DecisionRecordResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setStatus({ kind: "error", text: "Unexpected decision response" });
        setBusy(false);
        return;
      }
      const taskNote =
        decision === "accept"
          ? ` · session ${parsed.data.session?.id ?? "—"} · ${parsed.data.tasks.length} task(s)`
          : "";
      setStatus({
        kind: "ok",
        text: `${decision} recorded${taskNote}${parsed.data.idempotent ? " (idempotent)" : ""}`,
      });
      await openDetail(detail.submission.id, { clearStatus: false });
      if (activeEventId) await loadList(activeEventId, page);
    } catch {
      setStatus({ kind: "error", text: "Network error" });
    } finally {
      setBusy(false);
    }
  }

  async function assignEvaluator(e: FormEvent) {
    e.preventDefault();
    if (!detail || !assignUserId.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch(
        `/api/submissions/${encodeURIComponent(detail.submission.id)}/assign`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({ userIds: [assignUserId.trim()] }),
        },
      );
      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setStatus({
          kind: "error",
          text: env.success ? env.data.error : `Failed (${res.status})`,
        });
        setBusy(false);
        return;
      }
      const parsed = SubmissionAssignResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setStatus({ kind: "error", text: "Unexpected assign response" });
        setBusy(false);
        return;
      }
      setStatus({
        kind: "ok",
        text: `Assigned ${parsed.data.assignments.length} evaluator(s)`,
      });
      setAssignUserId("");
    } catch {
      setStatus({ kind: "error", text: "Network error" });
    } finally {
      setBusy(false);
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === rows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((r) => r.id)));
    }
  }

  async function runBulkPreview(decision: DecisionValue) {
    if (!activeEventId) return;
    if (selected.size === 0) {
      setStatus({ kind: "error", text: "Select at least one submission" });
      setBulkPreview(null);
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(activeEventId)}/submissions/bulk-preview`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            submissionIds: [...selected],
            decision,
          }),
        },
      );
      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setStatus({
          kind: "error",
          text: env.success ? env.data.error : `Failed (${res.status})`,
        });
        setBulkPreview(null);
        setBusy(false);
        return;
      }
      const parsed = BulkDecisionPreviewResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setStatus({ kind: "error", text: "Unexpected preview response" });
        setBusy(false);
        return;
      }
      setBulkPreview({
        decision: parsed.data.decision,
        items: parsed.data.items,
      });
      setStatus({
        kind: "ok",
        text: `Preview: ${parsed.data.count} submission(s) → ${parsed.data.decision}`,
      });
    } catch {
      setStatus({ kind: "error", text: "Network error" });
    } finally {
      setBusy(false);
    }
  }

  async function createDirectSession(e: FormEvent) {
    e.preventDefault();
    if (!activeEventId) return;
    setBusy(true);
    setStatus(null);
    try {
      const speakers =
        directSpeakerName.trim() && directSpeakerEmail.trim()
          ? [
              {
                name: directSpeakerName.trim(),
                email: directSpeakerEmail.trim(),
                isPrimary: true,
              },
            ]
          : [];
      const res = await fetch(
        `/api/events/${encodeURIComponent(activeEventId)}/sessions/direct`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            title: directTitle.trim(),
            description: directDesc.trim() || null,
            speakers,
          }),
        },
      );
      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setStatus({
          kind: "error",
          text: env.success ? env.data.error : `Failed (${res.status})`,
        });
        setBusy(false);
        return;
      }
      const parsed = DirectSessionResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setStatus({ kind: "error", text: "Unexpected session response" });
        setBusy(false);
        return;
      }
      setStatus({
        kind: "ok",
        text: `Direct session created: ${parsed.data.session.title} (${parsed.data.session.id})`,
      });
      setDirectTitle("");
      setDirectDesc("");
      setDirectSpeakerName("");
      setDirectSpeakerEmail("");
      setDirectOpen(false);
    } catch {
      setStatus({ kind: "error", text: "Network error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="submissions-page"
      data-testid="page-submissions"
      data-section="3.5"
    >
      <p className="page-stub__overline">Submissions</p>
      <h2 className="page-stub__title">Submissions & decisions</h2>
      <p className="page-stub__body">
        Review CFP submissions, assign evaluators, and record accept / reject /
        waitlist. Accept materializes a programme session and speaker tasks.
      </p>

      {!activeEventId ? (
        <p className="eval-queue__muted">Select an event.</p>
      ) : null}

      {status ? (
        <p
          className={
            status.kind === "ok"
              ? "event-settings__status event-settings__status--ok"
              : "event-settings__status event-settings__status--error"
          }
          data-testid="submissions-status"
          role="status"
        >
          {status.text}
        </p>
      ) : null}

      {/* Filters E01 */}
      <section
        className="event-settings__card submissions-page__filters"
        data-testid="submissions-filters"
      >
        <div className="eval-queue__row">
          <label className="event-settings__field">
            <span className="event-settings__label">Status</span>
            <select
              className="event-settings__input lumen-focusable"
              data-testid="submissions-filter-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s || "all"} value={s}>
                  {s || "All statuses"}
                </option>
              ))}
            </select>
          </label>
          <label className="event-settings__field">
            <span className="event-settings__label">Category</span>
            <select
              className="event-settings__input lumen-focusable"
              data-testid="submissions-filter-category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              {/* Keep current filter selectable even if categories reload empty */}
              {categoryFilter && !categories.includes(categoryFilter) ? (
                <option value={categoryFilter}>{categoryFilter}</option>
              ) : null}
            </select>
          </label>
        </div>

        <div className="submissions-page__toolbar">
          <button
            type="button"
            className="event-settings__btn lumen-focusable"
            data-testid="submissions-bulk-preview-accept"
            disabled={busy}
            onClick={() => void runBulkPreview("accept")}
          >
            Preview bulk accept
          </button>
          <button
            type="button"
            className="event-settings__btn lumen-focusable"
            data-testid="submissions-bulk-preview-reject"
            disabled={busy}
            onClick={() => void runBulkPreview("reject")}
          >
            Preview bulk reject
          </button>
          <button
            type="button"
            className="event-settings__btn lumen-focusable"
            data-testid="submissions-bulk-preview-waitlist"
            disabled={busy}
            onClick={() => void runBulkPreview("waitlist")}
          >
            Preview bulk waitlist
          </button>
          <button
            type="button"
            className="event-settings__btn lumen-focusable"
            data-testid="submissions-direct-open"
            onClick={() => setDirectOpen((v) => !v)}
          >
            {directOpen ? "Hide direct session" : "Direct / sponsor session"}
          </button>
        </div>
      </section>

      {/* Direct session E07 */}
      {directOpen && activeEventId ? (
        <section
          className="event-settings__card"
          data-testid="submissions-direct-form"
        >
          <h3 className="event-settings__card-title">Direct / sponsor session</h3>
          <form onSubmit={(e) => void createDirectSession(e)}>
            <label className="event-settings__field">
              <span className="event-settings__label">Title</span>
              <input
                className="event-settings__input lumen-focusable"
                data-testid="direct-session-title"
                value={directTitle}
                onChange={(e) => setDirectTitle(e.target.value)}
                required
                maxLength={500}
              />
            </label>
            <label className="event-settings__field">
              <span className="event-settings__label">Description</span>
              <textarea
                className="event-settings__input lumen-focusable"
                data-testid="direct-session-description"
                value={directDesc}
                onChange={(e) => setDirectDesc(e.target.value)}
                rows={2}
              />
            </label>
            <div className="eval-queue__row">
              <label className="event-settings__field">
                <span className="event-settings__label">Speaker name</span>
                <input
                  className="event-settings__input lumen-focusable"
                  data-testid="direct-session-speaker-name"
                  value={directSpeakerName}
                  onChange={(e) => setDirectSpeakerName(e.target.value)}
                />
              </label>
              <label className="event-settings__field">
                <span className="event-settings__label">Speaker email</span>
                <input
                  className="event-settings__input lumen-focusable"
                  data-testid="direct-session-speaker-email"
                  type="email"
                  value={directSpeakerEmail}
                  onChange={(e) => setDirectSpeakerEmail(e.target.value)}
                />
              </label>
            </div>
            <button
              type="submit"
              className="event-settings__btn event-settings__btn--primary lumen-focusable"
              data-testid="direct-session-submit"
              disabled={busy || !directTitle.trim()}
            >
              Create session
            </button>
          </form>
        </section>
      ) : null}

      {/* Bulk preview E08 */}
      {bulkPreview ? (
        <section
          className="event-settings__card"
          data-testid="submissions-bulk-preview"
        >
          <h3 className="event-settings__card-title">
            Bulk preview → {bulkPreview.decision}
          </h3>
          <ul className="submissions-page__preview-list" data-testid="bulk-preview-list">
            {bulkPreview.items.map((item) => (
              <li key={item.submissionId} data-testid={`bulk-preview-item-${item.submissionId}`}>
                <strong>{item.title}</strong>{" "}
                <span className="eval-queue__muted">
                  {item.currentStatus} → {item.nextStatus}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {loading ? (
        <div
          className="list-skeleton"
          data-testid="submissions-loading"
          data-skeleton="true"
          aria-busy="true"
          aria-live="polite"
        >
          <p className="eval-queue__muted" data-testid="submissions-skeleton">
            Loading submissions…
          </p>
          <div className="list-skeleton__bars" aria-hidden="true">
            <span className="list-skeleton__bar" />
            <span className="list-skeleton__bar" />
            <span className="list-skeleton__bar" />
          </div>
        </div>
      ) : null}
      {loadError ? (
        <div
          className="event-settings__card list-error-state"
          data-testid="submissions-error-state"
          role="alert"
        >
          <p
            className="event-settings__status event-settings__status--error"
            data-testid="submissions-load-error"
          >
            {loadError}
          </p>
          <p className="page-stub__body">
            The submissions list could not be loaded. Check your connection and
            try again — the page is not blank.
          </p>
          <button
            type="button"
            className="event-settings__btn lumen-focusable"
            data-testid="submissions-error-retry"
            onClick={() => {
              if (activeEventId) void loadList(activeEventId, page);
            }}
          >
            Retry
          </button>
        </div>
      ) : null}

      <div className="eval-queue__layout">
        {/* List E01 · empty CTA L01 · page window 10.1 */}
        <section data-testid="submissions-list-section">
          {activeEventId && !loading && !loadError && rows.length === 0 ? (
            <div
              className="event-settings__card list-empty-state"
              data-testid="submissions-empty"
            >
              <h3 className="event-settings__heading">No submissions yet</h3>
              <p className="page-stub__body">
                No submissions match these filters. Publish a CFP form or add a
                direct / sponsor session to get started.
              </p>
              <div className="list-empty-state__actions">
                <button
                  type="button"
                  className="event-settings__btn event-settings__btn--primary lumen-focusable"
                  data-testid="submissions-empty-cta"
                  data-inv="L01"
                  onClick={() => setDirectOpen(true)}
                >
                  Add direct / sponsor session
                </button>
                <a
                  href="/admin/cfp"
                  className="event-settings__btn lumen-focusable"
                  data-testid="submissions-empty-forms-link"
                >
                  Open form builder
                </a>
              </div>
            </div>
          ) : null}
          {rows.length > 0 ? (
            <>
              <div
                className="submissions-page__meta"
                data-testid="submissions-list-meta"
                data-total={total}
                data-page={page}
                data-page-size={listLimit}
                data-offset={listOffset}
                data-visible={rows.length}
              >
                <span className="eval-queue__muted">
                  {total} submission{total === 1 ? "" : "s"}
                  {totalPages > 1
                    ? ` · page ${page} of ${totalPages}`
                    : ""}
                </span>
              </div>
              <table
                className="eval-queue__table"
                data-testid="submissions-table"
                data-total={total}
                data-visible={rows.length}
              >
                <thead>
                  <tr>
                    <th scope="col">
                      <input
                        type="checkbox"
                        data-testid="submissions-select-all"
                        aria-label="Select all on page"
                        checked={
                          rows.length > 0 && selected.size === rows.length
                        }
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th scope="col">Title</th>
                    <th scope="col">Status</th>
                    <th scope="col">Category</th>
                    <th scope="col">Speaker</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      data-testid={`submission-row-${row.id}`}
                      data-status={row.status}
                      data-category={row.category ?? ""}
                      className={
                        detailId === row.id
                          ? "submissions-page__row--active"
                          : undefined
                      }
                    >
                      <td>
                        <input
                          type="checkbox"
                          data-testid={`submission-select-${row.id}`}
                          aria-label={`Select ${row.title}`}
                          checked={selected.has(row.id)}
                          onChange={() => toggleSelect(row.id)}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="eval-queue__link lumen-focusable"
                          data-testid={`submission-open-${row.id}`}
                          onClick={() => void openDetail(row.id)}
                        >
                          {row.title}
                        </button>
                      </td>
                      <td data-testid={`submission-status-${row.id}`}>
                        <span
                          className="submissions-page__badge"
                          data-testid={`submission-status-badge-${row.id}`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td>{row.category ?? "—"}</td>
                      <td>{row.primarySpeakerName ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {totalPages > 1 ? (
                <div
                  className="submissions-page__pager"
                  data-testid="submissions-pager"
                >
                  <button
                    type="button"
                    className="event-settings__btn lumen-focusable"
                    data-testid="submissions-page-prev"
                    disabled={page <= 1 || loading}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </button>
                  <span
                    className="eval-queue__muted"
                    data-testid="submissions-page-label"
                  >
                    Page {page} / {totalPages}
                  </span>
                  <button
                    type="button"
                    className="event-settings__btn lumen-focusable"
                    data-testid="submissions-page-next"
                    disabled={page >= totalPages || loading}
                    onClick={() =>
                      setPage((p) => Math.min(totalPages, p + 1))
                    }
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </section>

        {/* Detail E02 + decisions E04–E06 + assign E03 */}
        <section
          className="event-settings__card"
          data-testid="submissions-detail"
        >
          {!detail ? (
            <p className="eval-queue__muted" data-testid="submissions-detail-empty">
              Select a submission to view answers, speakers, and record a
              decision.
            </p>
          ) : (
            <>
              <h3
                className="event-settings__card-title"
                data-testid="submission-detail-title"
              >
                {detail.submission.title}
              </h3>
              <p className="eval-queue__item-meta" data-testid="submission-detail-meta">
                Status:{" "}
                <span data-testid="submission-detail-status">
                  {detail.submission.status}
                </span>
                {detail.submission.category
                  ? ` · ${detail.submission.category}`
                  : ""}
                {detail.decision
                  ? ` · decided: ${detail.decision.decision}`
                  : ""}
              </p>

              <h4 className="submissions-page__subhead">Answers</h4>
              <ul data-testid="submission-detail-answers">
                {detail.answers.map((a) => (
                  <li key={a.fieldKey} data-testid={`answer-${a.fieldKey}`}>
                    <strong>{a.fieldKey}</strong>:{" "}
                    {typeof a.value === "string"
                      ? a.value
                      : JSON.stringify(a.value)}
                  </li>
                ))}
              </ul>

              <h4 className="submissions-page__subhead">Speakers</h4>
              <ul data-testid="submission-detail-speakers">
                {detail.speakers.map((s) => (
                  <li
                    key={s.personId}
                    data-testid={`speaker-${s.personId}`}
                  >
                    {s.name} ({s.email})
                    {s.isPrimary ? " · primary" : ""}
                  </li>
                ))}
              </ul>

              {detail.session ? (
                <p data-testid="submission-detail-session">
                  Session: {detail.session.title} ({detail.session.id})
                </p>
              ) : null}

              <form
                className="submissions-page__assign"
                data-testid="submission-assign-form"
                onSubmit={(e) => void assignEvaluator(e)}
              >
                <label className="event-settings__field">
                  <span className="event-settings__label">
                    Assign evaluator (user id)
                  </span>
                  <input
                    className="event-settings__input lumen-focusable"
                    data-testid="submission-assign-user-id"
                    value={assignUserId}
                    onChange={(e) => setAssignUserId(e.target.value)}
                    placeholder="Evaluator user id"
                  />
                </label>
                <button
                  type="submit"
                  className="event-settings__btn lumen-focusable"
                  data-testid="submission-assign-submit"
                  disabled={busy || !assignUserId.trim()}
                >
                  Assign
                </button>
              </form>

              <label className="event-settings__field">
                <span className="event-settings__label">Decision reason</span>
                <textarea
                  className="event-settings__input lumen-focusable"
                  data-testid="submission-decision-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  placeholder="Optional reason (required for clear reject trail)"
                />
              </label>

              <div className="submissions-page__toolbar">
                <button
                  type="button"
                  className="event-settings__btn event-settings__btn--primary lumen-focusable"
                  data-testid="submission-accept"
                  disabled={busy}
                  onClick={() => void recordDecision("accept")}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="event-settings__btn lumen-focusable"
                  data-testid="submission-reject"
                  disabled={busy}
                  onClick={() => void recordDecision("reject")}
                >
                  Reject
                </button>
                <button
                  type="button"
                  className="event-settings__btn lumen-focusable"
                  data-testid="submission-waitlist"
                  disabled={busy}
                  onClick={() => void recordDecision("waitlist")}
                >
                  Waitlist
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
