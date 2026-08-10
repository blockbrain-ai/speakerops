/**
 * Admin submissions + decisions UI (section 3.5 / S-EVAL + 10.1 + 11.4 S-L2-SUB).
 *
 * Lumen 2: DataTable, toolbar, sticky bulk bar, filter chips, detail hierarchy.
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
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useSearchParams } from "react-router-dom";
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

type StatusMsg = { kind: "ok" | "error"; text: string } | null;

const STATUS_CHIP_OPTIONS = [
  { value: "", label: "All" },
  { value: "submitted", label: "Submitted" },
  { value: "in_review", label: "In review" },
  { value: "accepted", label: "Accepted" },
  { value: "rejected", label: "Rejected" },
  { value: "waitlist", label: "Waitlist" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "draft", label: "Draft" },
] as const;

/** Abort hung list fetches so Loading never sticks forever (AC-10.1-B). */
const LIST_FETCH_TIMEOUT_MS = 12_000;

function statusTone(status: string): BadgeTone {
  switch (status) {
    case "accepted":
      return "success";
    case "rejected":
    case "withdrawn":
      return "danger";
    case "waitlist":
    case "in_review":
      return "warn";
    case "submitted":
      return "info";
    default:
      return "neutral";
  }
}

function formatAnswerValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function SubmissionsPage() {
  const { activeEventId } = useEventContext();
  const [searchParams] = useSearchParams();
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
        const offset = Math.max(
          0,
          (pageNum - 1) * SUBMISSION_LIST_DEFAULT_LIMIT,
        );
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
    setSelected(new Set());
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

  // Deep-link from evaluations rollup (and other hubs): ?submissionId=
  useEffect(() => {
    const id = searchParams.get("submissionId");
    if (!id || !activeEventId) return;
    void openDetail(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once per query id
  }, [searchParams, activeEventId]);

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

  const columns: DataTableColumn<SubmissionListItem>[] = [
    {
      id: "title",
      header: "Title",
      primary: true,
      cell: (row) => (
        <>
          <button
            type="button"
            className="l2-table__link lumen-focusable"
            data-testid={`submission-open-${row.id}`}
            onClick={() => void openDetail(row.id)}
          >
            {row.title}
          </button>
          {row.primarySpeakerName ? (
            <span className="l2-table__secondary">{row.primarySpeakerName}</span>
          ) : null}
        </>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <Badge
          tone={statusTone(row.status)}
          showDot
          data-testid={`submission-status-badge-${row.id}`}
        >
          <span data-testid={`submission-status-${row.id}`}>{row.status}</span>
        </Badge>
      ),
    },
    {
      id: "category",
      header: "Category",
      cell: (row) => row.category ?? "—",
    },
    {
      id: "speaker",
      header: "Speaker",
      cell: (row) => row.primarySpeakerName ?? "—",
    },
  ];

  const activeFilters = [
    statusFilter
      ? {
          key: "status",
          label: `Status: ${statusFilter}`,
          clear: () => setStatusFilter(""),
        }
      : null,
    categoryFilter
      ? {
          key: "category",
          label: `Category: ${categoryFilter}`,
          clear: () => setCategoryFilter(""),
        }
      : null,
  ].filter(Boolean) as Array<{
    key: string;
    label: string;
    clear: () => void;
  }>;

  return (
    <div
      className="submissions-page submissions-page--l2"
      data-testid="page-submissions"
      data-section="11.4"
      data-layout="master-detail"
    >
      <PageHeader
        eyebrow="Submissions"
        title="Submissions & decisions"
        description="Review CFP submissions, assign evaluators, and record accept / reject / waitlist. Accept materializes a programme session and speaker tasks."
        data-testid="submissions-page-header"
        actions={
          <Button
            variant="secondary"
            size="sm"
            data-testid="submissions-direct-open"
            onClick={() => setDirectOpen((v) => !v)}
          >
            {directOpen ? "Hide direct session" : "Direct / sponsor session"}
          </Button>
        }
      />

      {!activeEventId ? (
        <p className="eval-queue__muted" data-testid="submissions-no-event">
          Select an event.
        </p>
      ) : null}

      {status ? (
        <Alert
          tone={status.kind === "ok" ? "success" : "danger"}
          data-testid="submissions-status"
        >
          {status.text}
        </Alert>
      ) : null}

      {/* Toolbar + filter chips (E01) */}
      <section
        className="submissions-page__toolbar-card"
        data-testid="submissions-filters"
        aria-label="Submission filters"
      >
        <div
          className="submissions-page__filter-chips"
          data-testid="submissions-filter-chips"
          role="group"
          aria-label="Status filters"
        >
          {STATUS_CHIP_OPTIONS.map((opt) => {
            const active = statusFilter === opt.value;
            return (
              <button
                key={opt.value || "all"}
                type="button"
                className={
                  active
                    ? "l2-chip l2-chip--active lumen-focusable"
                    : "l2-chip lumen-focusable"
                }
                data-testid={
                  opt.value
                    ? `submissions-chip-status-${opt.value}`
                    : "submissions-chip-status-all"
                }
                aria-pressed={active}
                onClick={() => setStatusFilter(opt.value)}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* Hidden native select keeps E01 e2e + a11y label contract */}
        <div className="submissions-page__toolbar-row">
          <label className="submissions-page__sr-only" htmlFor="submissions-filter-status">
            Status
          </label>
          <select
            id="submissions-filter-status"
            className="l2-field__control lumen-focusable submissions-page__status-select"
            data-testid="submissions-filter-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Status"
          >
            {STATUS_CHIP_OPTIONS.map((s) => (
              <option key={s.value || "all"} value={s.value}>
                {s.label === "All" ? "All statuses" : s.label}
              </option>
            ))}
          </select>

          <label className="event-settings__field submissions-page__category-field">
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
              {categoryFilter && !categories.includes(categoryFilter) ? (
                <option value={categoryFilter}>{categoryFilter}</option>
              ) : null}
            </select>
          </label>

          {/* Always-available bulk preview controls (E08 empty selection) */}
          <div
            className="submissions-page__toolbar-actions"
            data-testid="submissions-toolbar-actions"
          >
            <Button
              variant="secondary"
              size="sm"
              data-testid="submissions-bulk-preview-accept"
              disabled={busy}
              onClick={() => void runBulkPreview("accept")}
            >
              Preview bulk accept
            </Button>
            <Button
              variant="secondary"
              size="sm"
              data-testid="submissions-bulk-preview-reject"
              disabled={busy}
              onClick={() => void runBulkPreview("reject")}
            >
              Preview bulk reject
            </Button>
            <Button
              variant="secondary"
              size="sm"
              data-testid="submissions-bulk-preview-waitlist"
              disabled={busy}
              onClick={() => void runBulkPreview("waitlist")}
            >
              Preview bulk waitlist
            </Button>
          </div>
        </div>

        {activeFilters.length > 0 ? (
          <div
            className="submissions-page__active-filters"
            data-testid="submissions-active-filters"
          >
            {activeFilters.map((f) => (
              <button
                key={f.key}
                type="button"
                className="l2-chip l2-chip--removable lumen-focusable"
                data-testid={`submissions-active-filter-${f.key}`}
                onClick={f.clear}
              >
                {f.label}
                <span aria-hidden="true"> ×</span>
              </button>
            ))}
            <Button
              variant="quiet"
              size="sm"
              data-testid="submissions-clear-filters"
              onClick={() => {
                setStatusFilter("");
                setCategoryFilter("");
              }}
            >
              Clear filters
            </Button>
          </div>
        ) : null}
      </section>

      {/* Direct session E07 */}
      {directOpen && activeEventId ? (
        <Card
          title="Direct / sponsor session"
          data-testid="submissions-direct-form"
          className="submissions-page__direct"
        >
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
            <Button
              type="submit"
              variant="primary"
              data-testid="direct-session-submit"
              disabled={busy || !directTitle.trim()}
              pending={busy}
            >
              Create session
            </Button>
          </form>
        </Card>
      ) : null}

      {/* Bulk preview E08 */}
      {bulkPreview ? (
        <Card
          title={`Bulk preview → ${bulkPreview.decision}`}
          data-testid="submissions-bulk-preview"
        >
          <ul
            className="submissions-page__preview-list"
            data-testid="bulk-preview-list"
          >
            {bulkPreview.items.map((item) => (
              <li
                key={item.submissionId}
                data-testid={`bulk-preview-item-${item.submissionId}`}
              >
                <strong>{item.title}</strong>{" "}
                <span className="eval-queue__muted">
                  {item.currentStatus} → {item.nextStatus}
                </span>
              </li>
            ))}
          </ul>
        </Card>
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
            <Skeleton variant="row" />
            <Skeleton variant="row" />
            <Skeleton variant="row" />
          </div>
        </div>
      ) : null}
      {loadError ? (
        <div
          className="list-error-state"
          data-testid="submissions-error-state"
          role="alert"
        >
          <Alert tone="danger" data-testid="submissions-load-error">
            {loadError}
          </Alert>
          <p className="page-stub__body">
            The submissions list could not be loaded. Check your connection and
            try again — the page is not blank.
          </p>
          <Button
            variant="secondary"
            data-testid="submissions-error-retry"
            onClick={() => {
              if (activeEventId) void loadList(activeEventId, page);
            }}
          >
            Retry
          </Button>
        </div>
      ) : null}

      <div
        className="submissions-page__layout"
        data-testid="submissions-master-detail"
      >
        {/* List E01 · empty CTA L01 · page window 10.1 · DataTable 11.4 */}
        <section
          className="submissions-page__list"
          data-testid="submissions-list-section"
        >
          {activeEventId && !loading && !loadError && rows.length === 0 ? (
            <EmptyState
              title="No submissions yet"
              description="No submissions match these filters. Publish a CFP form or add a direct / sponsor session to get started."
              data-testid="submissions-empty"
              action={
                <div className="list-empty-state__actions">
                  <Button
                    variant="primary"
                    data-testid="submissions-empty-cta"
                    data-inv="L01"
                    onClick={() => setDirectOpen(true)}
                  >
                    Add direct / sponsor session
                  </Button>
                  <a
                    href="/admin/cfp"
                    className="l2-btn l2-btn--secondary lumen-focusable"
                    data-testid="submissions-empty-forms-link"
                  >
                    <span className="l2-btn__label">Open form builder</span>
                  </a>
                </div>
              }
            />
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
                  {totalPages > 1 ? ` · page ${page} of ${totalPages}` : ""}
                </span>
              </div>
              <DataTable
                data-testid="submissions-table"
                columns={columns}
                rows={rows}
                getRowId={(r) => r.id}
                selectedIds={selected}
                onToggleRow={toggleSelect}
                onToggleAll={(all) => {
                  if (all) setSelected(new Set(rows.map((r) => r.id)));
                  else setSelected(new Set());
                }}
                selectAllTestId="submissions-select-all"
                getSelectTestId={(r) => `submission-select-${r.id}`}
                getRowTestId={(r) => `submission-row-${r.id}`}
                activeRowId={detailId}
                getRowAttrs={(r) => ({
                  "data-status": r.status,
                  "data-category": r.category ?? "",
                })}
                wrapAttrs={{
                  "data-total": total,
                  "data-visible": rows.length,
                }}
                density="comfortable"
                bulkBar={
                  <>
                    <span
                      className="submissions-page__bulk-count"
                      data-testid="submissions-bulk-count"
                    >
                      {selected.size} selected
                    </span>
                    <Button
                      variant="success"
                      size="sm"
                      data-testid="submissions-bulk-bar-accept"
                      disabled={busy}
                      onClick={() => void runBulkPreview("accept")}
                    >
                      Preview accept
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      data-testid="submissions-bulk-bar-reject"
                      disabled={busy}
                      onClick={() => void runBulkPreview("reject")}
                    >
                      Preview reject
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      data-testid="submissions-bulk-bar-waitlist"
                      disabled={busy}
                      onClick={() => void runBulkPreview("waitlist")}
                    >
                      Preview waitlist
                    </Button>
                    <Button
                      variant="quiet"
                      size="sm"
                      data-testid="submissions-bulk-clear"
                      onClick={() => setSelected(new Set())}
                    >
                      Clear
                    </Button>
                  </>
                }
              />
              {totalPages > 1 ? (
                <div
                  className="submissions-page__pager"
                  data-testid="submissions-pager"
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="submissions-page-prev"
                    disabled={page <= 1 || loading}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <span
                    className="eval-queue__muted"
                    data-testid="submissions-page-label"
                  >
                    Page {page} / {totalPages}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="submissions-page-next"
                    disabled={page >= totalPages || loading}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </section>

        {/* Detail hierarchy E02 + decisions E04–E06 + assign E03 */}
        <aside
          className="submissions-page__detail"
          data-testid="submissions-detail"
          aria-label="Submission detail"
        >
          {!detail ? (
            <p
              className="eval-queue__muted"
              data-testid="submissions-detail-empty"
            >
              Select a submission to view answers, speakers, and record a
              decision.
            </p>
          ) : (
            <div
              className="submissions-page__detail-hierarchy"
              data-testid="submission-detail-hierarchy"
            >
              <header
                className="submissions-page__detail-header"
                data-testid="submission-detail-header"
              >
                <h3
                  className="submissions-page__detail-title"
                  data-testid="submission-detail-title"
                >
                  {detail.submission.title}
                </h3>
                <div className="submissions-page__detail-badges">
                  <Badge
                    tone={statusTone(detail.submission.status)}
                    showDot
                    data-testid="submission-detail-status-badge"
                  >
                    <span data-testid="submission-detail-status">
                      {detail.submission.status}
                    </span>
                  </Badge>
                  {detail.submission.category ? (
                    <Badge tone="neutral" data-testid="submission-detail-category">
                      {detail.submission.category}
                    </Badge>
                  ) : null}
                  {detail.decision ? (
                    <Badge
                      tone={statusTone(detail.decision.decision)}
                      data-testid="submission-detail-decision-badge"
                    >
                      decided: {detail.decision.decision}
                    </Badge>
                  ) : null}
                </div>
                <p
                  className="submissions-page__detail-meta"
                  data-testid="submission-detail-meta"
                >
                  Status:{" "}
                  <span>{detail.submission.status}</span>
                  {detail.submission.category
                    ? ` · ${detail.submission.category}`
                    : ""}
                  {detail.decision
                    ? ` · decided: ${detail.decision.decision}`
                    : ""}
                </p>
              </header>

              <section
                className="submissions-page__detail-section"
                data-testid="submission-detail-section-speakers"
                aria-labelledby="detail-speakers-heading"
              >
                <h4
                  id="detail-speakers-heading"
                  className="submissions-page__subhead"
                >
                  Speakers
                </h4>
                <ul
                  className="submissions-page__speaker-list"
                  data-testid="submission-detail-speakers"
                >
                  {detail.speakers.map((s) => (
                    <li
                      key={s.personId}
                      className="submissions-page__speaker-card"
                      data-testid={`speaker-${s.personId}`}
                    >
                      <span className="submissions-page__speaker-name">
                        {s.name}
                      </span>
                      <span className="submissions-page__speaker-email">
                        {s.email}
                      </span>
                      {s.isPrimary ? (
                        <Badge tone="brand" data-testid={`speaker-primary-${s.personId}`}>
                          Primary
                        </Badge>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>

              <section
                className="submissions-page__detail-section"
                data-testid="submission-detail-section-answers"
                aria-labelledby="detail-answers-heading"
              >
                <h4
                  id="detail-answers-heading"
                  className="submissions-page__subhead"
                >
                  Answers
                </h4>
                <dl
                  className="submissions-page__answer-list"
                  data-testid="submission-detail-answers"
                >
                  {detail.answers.map((a) => (
                    <div
                      key={a.fieldKey}
                      className="submissions-page__answer-row"
                      data-testid={`answer-${a.fieldKey}`}
                    >
                      <dt className="submissions-page__answer-key">
                        {a.fieldKey}
                      </dt>
                      <dd className="submissions-page__answer-value">
                        {formatAnswerValue(a.value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>

              {detail.session ? (
                <section
                  className="submissions-page__detail-section"
                  data-testid="submission-detail-section-session"
                >
                  <h4 className="submissions-page__subhead">Programme session</h4>
                  <p data-testid="submission-detail-session">
                    Session: {detail.session.title} ({detail.session.id})
                  </p>
                </section>
              ) : null}

              <section
                className="submissions-page__detail-section submissions-page__detail-section--assign"
                data-testid="submission-detail-section-assign"
                aria-labelledby="detail-assign-heading"
              >
                <h4
                  id="detail-assign-heading"
                  className="submissions-page__subhead"
                >
                  Assignment
                </h4>
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
                  <Button
                    type="submit"
                    variant="secondary"
                    data-testid="submission-assign-submit"
                    disabled={busy || !assignUserId.trim()}
                    pending={busy}
                  >
                    Assign
                  </Button>
                </form>
              </section>

              <section
                className="submissions-page__detail-section submissions-page__detail-section--decision"
                data-testid="submission-detail-section-decision"
                aria-labelledby="detail-decision-heading"
              >
                <h4
                  id="detail-decision-heading"
                  className="submissions-page__subhead"
                >
                  Decision
                </h4>
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
                <div
                  className="submissions-page__decision-actions"
                  data-testid="submission-decision-actions"
                >
                  <Button
                    variant="success"
                    data-testid="submission-accept"
                    disabled={busy}
                    pending={busy}
                    onClick={() => void recordDecision("accept")}
                  >
                    Accept
                  </Button>
                  <Button
                    variant="danger"
                    data-testid="submission-reject"
                    disabled={busy}
                    onClick={() => void recordDecision("reject")}
                  >
                    Reject
                  </Button>
                  <Button
                    variant="secondary"
                    data-testid="submission-waitlist"
                    disabled={busy}
                    onClick={() => void recordDecision("waitlist")}
                  >
                    Waitlist
                  </Button>
                </div>
              </section>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
