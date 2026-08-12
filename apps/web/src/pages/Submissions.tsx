/**
 * Admin submissions + decisions UI (section 3.5 / S-EVAL + 10.1 + 11.4 S-L2-SUB).
 *
 * Lumen 2 + F3: DataGrid (TanStack), server sort, density, sticky bulk bar,
 * filter chips, detail hierarchy.
 *
 * Inventory: E01 list filters · E02 detail · E03 assign · E04 accept
 * · E05 reject · E06 waitlist · E07 direct session · E08 bulk preview/commit
 * · L02/L03 empty/error/loading · S-SUB-LIST page window
 *
 * Wired to real APIs:
 * GET  /api/events/:eventId/submissions  (?status&category&limit&offset)
 * GET  /api/submissions/:id
 * POST /api/submissions/:id/decision
 * POST /api/submissions/:id/assign
 * POST /api/events/:eventId/sessions/direct
 * POST /api/events/:eventId/submissions/bulk-preview
 * POST /api/events/:eventId/submissions/bulk-decision
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  TrackListResponseSchema,
  type TrackDto,
  SubmissionListResponseSchema,
  SubmissionDetailResponseSchema,
  DecisionRecordResponseSchema,
  DirectSessionResponseSchema,
  BulkDecisionPreviewResponseSchema,
  BulkDecisionCommitResponseSchema,
  SubmissionAssignResponseSchema,
  EventMembersResponseSchema,
  EvalReviewsResponseSchema,
  ErrorEnvelopeSchema,
  SUBMISSION_LIST_DEFAULT_LIMIT,
  SUBMISSIONS_GRID_FIELDS,
  SavedViewListResponseSchema,
  SavedViewResponseSchema,
  type SubmissionListItem,
  type SubmissionDetailResponse,
  type BulkDecisionPreviewItem,
  type DecisionValue,
  type EventMember,
  type EvalReviewsResponse,
  type SavedViewDto,
  type GridDensity,
  type SubmissionsGridField,
  RichTextEnvelopeSchema,
} from "@speakerops/shared";
import type {
  ColumnDef,
  SortingState,
  VisibilityState,
} from "@tanstack/react-table";
import { useEventContext } from "../events/EventContext.js";
import { RichText } from "../components/richtext/RichText.js";
import {
  Alert,
  Badge,
  Button,
  Card,
  ColumnManager,
  DataGrid,
  EmptyState,
  PageHeader,
  Skeleton,
  type BadgeTone,
} from "../components/ui/index.js";
import {
  assignIneligibleReason,
  decisionIneligibleReason,
} from "./submissions-eligibility.js";

type StatusMsg = {
  kind: "ok" | "error";
  text: string;
  /**
   * Programme session behind an accept — surfaced as a "View in Schedule"
   * link (+ data-session-id), never as a raw id in the copy (polish veto #3).
   */
  sessionId?: string | null;
} | null;

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
      // F1 urgency ladder: awaiting/in-progress wears honey, not clay
      return "progress";
    case "submitted":
      return "info";
    default:
      return "neutral";
  }
}

type AnswerOption = { value: string; label: string };

/**
 * Resolve a stored option VALUE ("agents") to its human label
 * ("Agents & Tooling") via the pinned form version's field options.
 * Unknown values fall back to the raw stored value so data is never hidden.
 */
function resolveOptionLabel(
  value: string,
  options: AnswerOption[] | undefined,
): string {
  const match = options?.find((o) => o.value === value);
  return match?.label?.trim() ? match.label : value;
}

export function formatAnswerValue(
  value: unknown,
  options?: AnswerOption[],
): string {
  if (value == null) return "—";
  if (typeof value === "string") {
    // File answers are stored as file:<id>
    if (value.startsWith("file:")) return "File attached";
    const label = resolveOptionLabel(value, options);
    // Checkbox answers are stored as the strings "true"/"false"
    if (label === value && (value === "true" || value === "false")) {
      return value === "true" ? "Yes" : "No";
    }
    return label;
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((v) => formatAnswerValue(v, options)).join(", ");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Answer value as ReactNode — `file:<id>` answers render as a working
 * "Uploaded file" link via the files module (admin session authorized).
 */
function renderAnswerValue(value: unknown, options?: AnswerOption[]): ReactNode {
  if (typeof value === "string" && value.startsWith("file:")) {
    const fileId = value.slice("file:".length);
    return (
      <a
        href={`/api/files/${encodeURIComponent(fileId)}`}
        className="eval-queue__link lumen-focusable"
        target="_blank"
        rel="noreferrer"
        data-testid={`submission-file-link-${fileId}`}
        data-file-id={fileId}
      >
        Uploaded file
      </a>
    );
  }
  // F2: rich_text answers are stored envelopes — render via the safe
  // renderer (never raw markup; unknown shapes fall through to JSON text).
  const rich = RichTextEnvelopeSchema.safeParse(value);
  if (typeof value === "object" && value !== null && rich.success) {
    return <RichText doc={rich.data} />;
  }
  return formatAnswerValue(value, options);
}

/** Human heading when API omits label — never show raw track_pref as the primary UI. */
export function humanizeFieldKey(fieldKey: string): string {
  const cleaned = fieldKey
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return fieldKey;
  return cleaned
    .split(" ")
    .map((w) => (w.length ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function answerHeading(a: { fieldKey: string; label?: string }): string {
  const label = a.label?.trim();
  if (label) return label;
  return humanizeFieldKey(a.fieldKey);
}

function statusDisplayLabel(status: string): string {
  const map: Record<string, string> = {
    submitted: "Submitted",
    in_review: "In review",
    accepted: "Accepted",
    rejected: "Rejected",
    waitlist: "Waitlist",
    withdrawn: "Withdrawn",
    draft: "Draft",
  };
  return map[status] ?? humanizeFieldKey(status);
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
  const [searchQ, setSearchQ] = useState("");
  const [page, setPage] = useState(1);
  /** F3 server sort (allowlist). */
  const [sortField, setSortField] = useState<SubmissionsGridField>("submittedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [density, setDensity] = useState<GridDensity>("comfortable");
  const [columnOrder, setColumnOrder] = useState<SubmissionsGridField[]>([
    ...SUBMISSIONS_GRID_FIELDS,
  ]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    () => {
      const vis: VisibilityState = {};
      for (const f of SUBMISSIONS_GRID_FIELDS) vis[f] = true;
      return vis;
    },
  );
  const [columnManagerOpen, setColumnManagerOpen] = useState(false);
  const [savedViews, setSavedViews] = useState<SavedViewDto[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<SubmissionDetailResponse | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailReviews, setDetailReviews] =
    useState<EvalReviewsResponse | null>(null);
  const [status, setStatus] = useState<StatusMsg>(null);
  const [reason, setReason] = useState("");
  /** Selected evaluator user ids for assign (multi-select picker). */
  const [assignUserIds, setAssignUserIds] = useState<Set<string>>(new Set());
  const [evaluators, setEvaluators] = useState<EventMember[]>([]);
  const [busy, setBusy] = useState(false);
  const loadGen = useRef(0);

  // Direct session form (E07 + Wave 2 parity E15: multi-speaker + track)
  const [directOpen, setDirectOpen] = useState(false);
  const [directTitle, setDirectTitle] = useState("");
  const [directDesc, setDirectDesc] = useState("");
  const [directSpeakers, setDirectSpeakers] = useState<
    Array<{ name: string; email: string }>
  >([{ name: "", email: "" }]);
  const [directTrackId, setDirectTrackId] = useState("");
  const [tracks, setTracks] = useState<TrackDto[]>([]);

  // Decision → notify hand-off (Wave 2, E13): exact result set of the last
  // committed decision, offered as a comms audience.
  const [lastDecision, setLastDecision] = useState<{
    decision: DecisionValue;
    submissionIds: string[];
  } | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const navigate = useNavigate();

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
        const qTrim = searchQ.trim();
        if (qTrim) params.set("q", qTrim);
        params.set("sort", sortField);
        params.set("sortDir", sortDir);
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
    [statusFilter, categoryFilter, searchQ, sortField, sortDir],
  );

  // Reset to page 1 when filters or event change (keep filters when paging)
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [statusFilter, categoryFilter, searchQ, sortField, sortDir, activeEventId]);

  /** Reset grid chrome when event changes (never retain prior event's views). */
  function resetGridChrome() {
    setActiveViewId(null);
    setSortField("submittedAt");
    setSortDir("desc");
    setDensity("comfortable");
    setColumnOrder([...SUBMISSIONS_GRID_FIELDS]);
    const vis: VisibilityState = {};
    for (const f of SUBMISSIONS_GRID_FIELDS) vis[f] = true;
    setColumnVisibility(vis);
    setStatusFilter("");
    setCategoryFilter("");
    setSearchQ("");
    setColumnManagerOpen(false);
  }

  function applyViewDefinition(v: SavedViewDto) {
    if (v.definition.sort) {
      setSortField(v.definition.sort.field);
      setSortDir(v.definition.sort.dir);
    } else {
      setSortField("submittedAt");
      setSortDir("desc");
    }
    if (v.definition.density) setDensity(v.definition.density);
    else setDensity("comfortable");
    if (v.definition.columnOrder?.length) {
      setColumnOrder(v.definition.columnOrder as SubmissionsGridField[]);
    } else {
      setColumnOrder([...SUBMISSIONS_GRID_FIELDS]);
    }
    if (v.definition.columns?.length) {
      const vis: VisibilityState = {};
      for (const f of SUBMISSIONS_GRID_FIELDS) {
        vis[f] = v.definition.columns.includes(f);
      }
      setColumnVisibility(vis);
    } else {
      const vis: VisibilityState = {};
      for (const f of SUBMISSIONS_GRID_FIELDS) vis[f] = true;
      setColumnVisibility(vis);
    }
    setStatusFilter(v.definition.status ?? "");
    setCategoryFilter(v.definition.category ?? "");
    setPage(1);
  }

  // F3: load saved views for submissions surface
  useEffect(() => {
    // Always clear chrome + view list first so a prior event never bleeds.
    resetGridChrome();
    setSavedViews([]);
    if (!activeEventId) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/events/${encodeURIComponent(activeEventId)}/saved-views?surface=submissions`,
          {
            credentials: "include",
            headers: { accept: "application/json" },
          },
        );
        if (cancelled || !res.ok) return;
        const parsed = SavedViewListResponseSchema.safeParse(await res.json());
        if (!parsed.success) return;
        setSavedViews(parsed.data.views);
        const def = parsed.data.views.find((v) => v.isDefault);
        if (def) {
          setActiveViewId(def.id);
          applyViewDefinition(def);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeEventId]);

  // Event switch invalidates the decision hand-off audience (cross-event safety).
  useEffect(() => {
    setLastDecision(null);
  }, [activeEventId]);

  /** Track options for the direct/sponsor session dialog (Wave 2 parity). */
  useEffect(() => {
    if (!directOpen || !activeEventId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/events/${encodeURIComponent(activeEventId)}/tracks`,
          {
            credentials: "include",
            headers: { accept: "application/json" },
          },
        );
        if (cancelled || !res.ok) return;
        const raw: unknown = await res.json();
        const parsed = TrackListResponseSchema.safeParse(raw);
        if (!cancelled && parsed.success) setTracks(parsed.data.tracks);
      } catch {
        /* track list optional — dialog still works without it */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [directOpen, activeEventId]);

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

  /** Load evaluator roster for assign picker. */
  useEffect(() => {
    if (!activeEventId) {
      setEvaluators([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/events/${encodeURIComponent(activeEventId)}/members?role=evaluator`,
          {
            credentials: "include",
            headers: { accept: "application/json" },
          },
        );
        if (cancelled) return;
        if (!res.ok) {
          setEvaluators([]);
          return;
        }
        const raw: unknown = await res.json();
        const parsed = EventMembersResponseSchema.safeParse(raw);
        if (!parsed.success) {
          setEvaluators([]);
          return;
        }
        setEvaluators(parsed.data.members);
      } catch {
        if (!cancelled) setEvaluators([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeEventId]);

  async function openDetail(id: string, opts?: { clearStatus?: boolean }) {
    setDetailId(id);
    if (opts?.clearStatus !== false) {
      // Default clear; decision handlers pass clearStatus:false to keep success toast
      setStatus(null);
    }
    setReason("");
    setDetailReviews(null);
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
      // Individual reviews for deliberation (admin).
      try {
        const revRes = await fetch(
          `/api/submissions/${encodeURIComponent(id)}/eval-reviews`,
          {
            credentials: "include",
            headers: { accept: "application/json" },
          },
        );
        if (revRes.ok) {
          const revRaw: unknown = await revRes.json();
          const revParsed = EvalReviewsResponseSchema.safeParse(revRaw);
          if (revParsed.success) setDetailReviews(revParsed.data);
        }
      } catch {
        /* reviews optional for detail view */
      }
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
      // Human decision copy — no raw ids, no "(idempotent)" jargon (veto #3).
      const pastTense: Record<DecisionValue, string> = {
        accept: "accepted",
        reject: "rejected",
        waitlist: "waitlisted",
      };
      const sessionId = parsed.data.session?.id ?? null;
      let text: string;
      if (parsed.data.idempotent) {
        text = `Already ${pastTense[decision]} — nothing changed.`;
      } else if (decision === "accept") {
        const taskCount = parsed.data.tasks.length;
        text = `Accepted — session created with ${taskCount} speaker task${taskCount === 1 ? "" : "s"}.`;
      } else if (decision === "reject") {
        text = "Rejected.";
      } else {
        text = "Waitlisted.";
      }
      setStatus({
        kind: "ok",
        text,
        sessionId: decision === "accept" ? sessionId : null,
      });
      setLastDecision({ decision, submissionIds: [detail.submission.id] });
      await openDetail(detail.submission.id, { clearStatus: false });
      if (activeEventId) await loadList(activeEventId, page);
    } catch {
      setStatus({ kind: "error", text: "Network error" });
    } finally {
      setBusy(false);
    }
  }

  function toggleAssignUser(userId: string) {
    setAssignUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function assignToSubmissionIds(
    submissionIds: string[],
    userIds: string[],
  ): Promise<{ ok: number; failed: number }> {
    let ok = 0;
    let failed = 0;
    for (const submissionId of submissionIds) {
      try {
        const res = await fetch(
          `/api/submissions/${encodeURIComponent(submissionId)}/assign`,
          {
            method: "POST",
            credentials: "include",
            headers: {
              "content-type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify({ userIds }),
          },
        );
        const raw: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          failed += 1;
          continue;
        }
        const parsed = SubmissionAssignResponseSchema.safeParse(raw);
        if (!parsed.success) {
          failed += 1;
          continue;
        }
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    return { ok, failed };
  }

  async function assignEvaluator(e: FormEvent) {
    e.preventDefault();
    if (!detail || assignUserIds.size === 0) return;
    setBusy(true);
    setStatus(null);
    try {
      const userIds = [...assignUserIds];
      const res = await fetch(
        `/api/submissions/${encodeURIComponent(detail.submission.id)}/assign`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({ userIds }),
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
        text: `Assigned ${parsed.data.assignments.length} evaluator${parsed.data.assignments.length === 1 ? "" : "s"}.`,
      });
      setAssignUserIds(new Set());
    } catch {
      setStatus({ kind: "error", text: "Network error" });
    } finally {
      setBusy(false);
    }
  }

  async function batchAssignSelected() {
    if (selected.size === 0 || assignUserIds.size === 0) {
      setStatus({
        kind: "error",
        text: "Select submissions and at least one evaluator",
      });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const result = await assignToSubmissionIds(
        [...selected],
        [...assignUserIds],
      );
      if (result.failed === 0) {
        setStatus({
          kind: "ok",
          text: `Assigned evaluators to ${result.ok} submission${result.ok === 1 ? "" : "s"}.`,
        });
      } else {
        setStatus({
          kind: "error",
          text: `Assigned ${result.ok}, failed ${result.failed}`,
        });
      }
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
        decision: parsed.data.decision as DecisionValue,
        items: parsed.data.items,
      });
      setStatus({
        kind: "ok",
        text: `Preview ready — ${parsed.data.count} submission${parsed.data.count === 1 ? "" : "s"} would be ${decisionAudienceLabel[parsed.data.decision as DecisionValue]}.`,
      });
    } catch {
      setStatus({ kind: "error", text: "Network error" });
    } finally {
      setBusy(false);
    }
  }

  async function runBulkCommit() {
    if (!activeEventId || !bulkPreview) return;
    if (bulkPreview.items.length === 0) {
      setStatus({ kind: "error", text: "Nothing to apply" });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(activeEventId)}/submissions/bulk-decision`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            submissionIds: bulkPreview.items.map((i) => i.submissionId),
            decision: bulkPreview.decision,
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
      const parsed = BulkDecisionCommitResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setStatus({ kind: "error", text: "Unexpected commit response" });
        setBusy(false);
        return;
      }
      const failedItems = parsed.data.items.filter((i) => !i.ok);
      const okIds = parsed.data.items
        .filter((i) => i.ok)
        .map((i) => i.submissionId);
      if (okIds.length > 0) {
        setLastDecision({
          decision: parsed.data.decision as DecisionValue,
          submissionIds: okIds,
        });
      }
      if (failedItems.length === 0) {
        setStatus({
          kind: "ok",
          text: `Applied ${parsed.data.applied} ${parsed.data.decision} decision${parsed.data.applied === 1 ? "" : "s"}.`,
        });
      } else {
        const names = failedItems
          .map((i) => `${i.submissionId}: ${i.error ?? "failed"}`)
          .slice(0, 5)
          .join("; ");
        setStatus({
          kind: "error",
          text: `Applied ${parsed.data.applied}, failed ${parsed.data.failed}. ${names}`,
        });
      }
      setBulkPreview(null);
      setSelected(new Set());
      if (activeEventId) void loadList(activeEventId, page);
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
      const speakers = directSpeakers
        .map((s) => ({ name: s.name.trim(), email: s.email.trim() }))
        .filter((s) => s.name && s.email)
        .map((s, i) => ({ ...s, isPrimary: i === 0 }));
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
            trackId: directTrackId || null,
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
      const speakerNote =
        parsed.data.participations.length > 0
          ? ` · ${parsed.data.participations.length} speaker${parsed.data.participations.length === 1 ? "" : "s"}`
          : "";
      // Session id stays off the copy — the schedule link carries it (veto #3).
      setStatus({
        kind: "ok",
        text: `Direct session created: ${parsed.data.session.title}${speakerNote}`,
        sessionId: parsed.data.session.id,
      });
      setDirectTitle("");
      setDirectDesc("");
      setDirectSpeakers([{ name: "", email: "" }]);
      setDirectTrackId("");
      setDirectOpen(false);
    } catch {
      setStatus({ kind: "error", text: "Network error" });
    } finally {
      setBusy(false);
    }
  }

  function updateDirectSpeaker(
    index: number,
    patch: Partial<{ name: string; email: string }>,
  ) {
    setDirectSpeakers((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    );
  }

  /** Download the filtered submissions as CSV (Wave 2 depth, E14). */
  async function exportCsv() {
    if (!activeEventId) return;
    setExportBusy(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (categoryFilter) params.set("category", categoryFilter);
      const qTrim = searchQ.trim();
      if (qTrim) params.set("q", qTrim);
      const qs = params.toString();
      const res = await fetch(
        `/api/events/${encodeURIComponent(activeEventId)}/submissions/export${qs ? `?${qs}` : ""}`,
        {
          credentials: "include",
          headers: { accept: "text/csv" },
        },
      );
      if (!res.ok) {
        setStatus({
          kind: "error",
          text:
            res.status === 401
              ? "Session expired — sign in again to export"
              : res.status === 403
                ? "You need admin access to export submissions"
                : `Export failed (${res.status})`,
        });
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? "submissions.csv";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.rel = "noopener";
      anchor.dataset.testid = "submissions-export-download-anchor";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setStatus({ kind: "error", text: "Network error during export" });
    } finally {
      setExportBusy(false);
    }
  }

  const decisionAudienceLabel: Record<DecisionValue, string> = {
    accept: "accepted",
    reject: "rejected",
    waitlist: "waitlisted",
  };

  const sorting: SortingState = useMemo(
    () => [{ id: sortField, desc: sortDir === "desc" }],
    [sortField, sortDir],
  );

  const columns: ColumnDef<SubmissionListItem, unknown>[] = useMemo(
    () => [
      {
        id: "title",
        accessorKey: "title",
        header: "Title",
        enableSorting: true,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <>
              <button
                type="button"
                className="l2-table__link lumen-focusable"
                data-testid={`submission-open-${r.id}`}
                onClick={() => void openDetail(r.id)}
              >
                {r.title}
              </button>
              {r.primarySpeakerName ? (
                <span className="l2-table__secondary">
                  {r.primarySpeakerName}
                </span>
              ) : null}
            </>
          );
        },
      },
      {
        id: "status",
        accessorKey: "status",
        header: "Status",
        enableSorting: true,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <Badge
              tone={statusTone(r.status)}
              showDot
              data-testid={`submission-status-badge-${r.id}`}
            >
              <span
                data-testid={`submission-status-${r.id}`}
                data-status={r.status}
              >
                {statusDisplayLabel(r.status)}
              </span>
            </Badge>
          );
        },
      },
      {
        id: "category",
        accessorKey: "category",
        header: "Category",
        enableSorting: true,
        cell: ({ row }) => row.original.category ?? "—",
      },
      {
        id: "primarySpeakerName",
        accessorKey: "primarySpeakerName",
        header: "Speaker",
        enableSorting: true,
        cell: ({ row }) => row.original.primarySpeakerName ?? "—",
      },
      {
        id: "submittedAt",
        accessorKey: "submittedAt",
        header: "Submitted",
        enableSorting: true,
        cell: ({ row }) => {
          const iso = row.original.submittedAt;
          try {
            return (
              <time dateTime={iso} title={iso}>
                {new Date(iso).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </time>
            );
          } catch {
            return iso;
          }
        },
      },
    ],
    // openDetail is stable enough for this page (recreated each render is ok for cell click)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

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
    searchQ.trim()
      ? {
          key: "q",
          label: `Search: ${searchQ.trim()}`,
          clear: () => setSearchQ(""),
        }
      : null,
  ].filter(Boolean) as Array<{
    key: string;
    label: string;
    clear: () => void;
  }>;

  // Mirror server eligibility so ineligible rows disable controls up front
  // instead of 400ing after the click (draft/waitlist assign, draft decision).
  const assignBlocked = detail
    ? assignIneligibleReason(detail.submission.status)
    : null;
  const decisionBlocked = detail
    ? decisionIneligibleReason(detail.submission.status)
    : null;

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
          data-session-id={status.sessionId ?? undefined}
        >
          {status.text}
          {status.sessionId ? (
            <>
              {" "}
              <a
                href="/admin/schedule"
                className="eval-queue__link lumen-focusable"
                data-testid="submissions-status-schedule-link"
                title={`Session ${status.sessionId}`}
              >
                View in Schedule
              </a>
            </>
          ) : null}
        </Alert>
      ) : null}

      {/* Decision → notify hand-off (Wave 2, E13) */}
      {lastDecision && lastDecision.submissionIds.length > 0 ? (
        <div
          className="submissions-page__notify-handoff"
          data-testid="submissions-notify-handoff"
          data-decision={lastDecision.decision}
          data-count={lastDecision.submissionIds.length}
        >
          <Button
            variant="secondary"
            size="sm"
            data-testid={`submissions-notify-${lastDecision.decision}`}
            onClick={() =>
              navigate(
                `/admin/comms?notify=${lastDecision.decision}&submissionIds=${lastDecision.submissionIds
                  .map(encodeURIComponent)
                  .join(",")}`,
              )
            }
          >
            Notify {lastDecision.submissionIds.length}{" "}
            {decisionAudienceLabel[lastDecision.decision]} speaker
            {lastDecision.submissionIds.length === 1 ? "" : "s"}
          </Button>
          <span className="eval-queue__muted">
            Opens Comms with exactly this audience and the{" "}
            {decisionAudienceLabel[lastDecision.decision]} template — preview
            before anything is sent.
          </span>
        </div>
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

          <label className="event-settings__field submissions-page__search-field">
            <span className="event-settings__label">Search</span>
            <input
              type="search"
              className="event-settings__input lumen-focusable"
              data-testid="submissions-filter-q"
              placeholder="Title or speaker…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              aria-label="Search submissions by title or speaker"
            />
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
            <Button
              variant="secondary"
              size="sm"
              data-testid="submissions-export-csv"
              disabled={exportBusy || !activeEventId}
              pending={exportBusy}
              onClick={() => void exportCsv()}
            >
              Export CSV
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
                setSearchQ("");
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
            <label className="event-settings__field">
              <span className="event-settings__label">Track</span>
              <select
                className="event-settings__input lumen-focusable"
                data-testid="direct-session-track"
                value={directTrackId}
                onChange={(e) => setDirectTrackId(e.target.value)}
              >
                <option value="">No track</option>
                {tracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <fieldset
              className="submissions-page__direct-speakers"
              data-testid="direct-session-speakers"
            >
              <legend className="event-settings__label">
                Speakers (first is primary)
              </legend>
              {directSpeakers.map((sp, i) => (
                <div
                  className="eval-queue__row"
                  key={i}
                  data-testid={`direct-session-speaker-row-${i}`}
                >
                  <label className="event-settings__field">
                    <span className="event-settings__label">
                      {i === 0 ? "Speaker name" : `Speaker ${i + 1} name`}
                    </span>
                    <input
                      className="event-settings__input lumen-focusable"
                      data-testid={
                        i === 0
                          ? "direct-session-speaker-name"
                          : `direct-session-speaker-name-${i}`
                      }
                      value={sp.name}
                      onChange={(e) =>
                        updateDirectSpeaker(i, { name: e.target.value })
                      }
                    />
                  </label>
                  <label className="event-settings__field">
                    <span className="event-settings__label">
                      {i === 0 ? "Speaker email" : `Speaker ${i + 1} email`}
                    </span>
                    <input
                      className="event-settings__input lumen-focusable"
                      data-testid={
                        i === 0
                          ? "direct-session-speaker-email"
                          : `direct-session-speaker-email-${i}`
                      }
                      type="email"
                      value={sp.email}
                      onChange={(e) =>
                        updateDirectSpeaker(i, { email: e.target.value })
                      }
                    />
                  </label>
                  {directSpeakers.length > 1 ? (
                    <Button
                      type="button"
                      variant="quiet"
                      size="sm"
                      data-testid={`direct-session-speaker-remove-${i}`}
                      disabled={busy}
                      onClick={() =>
                        setDirectSpeakers((prev) =>
                          prev.filter((_, idx) => idx !== i),
                        )
                      }
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              ))}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="direct-session-speaker-add"
                disabled={busy || directSpeakers.length >= 20}
                onClick={() =>
                  setDirectSpeakers((prev) => [
                    ...prev,
                    { name: "", email: "" },
                  ])
                }
              >
                Add another speaker
              </Button>
            </fieldset>
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
          title={`Bulk preview — ${statusDisplayLabel(bulkPreview.decision)}`}
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
                  {statusDisplayLabel(item.currentStatus)} →{" "}
                  {statusDisplayLabel(item.nextStatus)}
                </span>
              </li>
            ))}
          </ul>
          <div className="eval-queue__row" style={{ marginTop: "0.75rem" }}>
            <Button
              type="button"
              variant="primary"
              data-testid="submissions-bulk-commit"
              pending={busy}
              disabled={busy || bulkPreview.items.length === 0}
              onClick={() => void runBulkCommit()}
            >
              Confirm apply ({bulkPreview.items.length})
            </Button>
            <Button
              type="button"
              variant="secondary"
              data-testid="submissions-bulk-preview-dismiss"
              disabled={busy}
              onClick={() => setBulkPreview(null)}
            >
              Dismiss
            </Button>
          </div>
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
              <DataGrid
                data-testid="submissions-table"
                columns={columns}
                data={rows}
                getRowId={(r) => r.id}
                sorting={sorting}
                onSortingChange={(updater) => {
                  const next =
                    typeof updater === "function" ? updater(sorting) : updater;
                  const first = next[0];
                  if (!first) return;
                  const field = first.id as SubmissionsGridField;
                  if (
                    (SUBMISSIONS_GRID_FIELDS as readonly string[]).includes(
                      field,
                    )
                  ) {
                    setSortField(field);
                    setSortDir(first.desc ? "desc" : "asc");
                    setPage(1);
                  }
                }}
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
                  "data-sort": sortField,
                  "data-sort-dir": sortDir,
                }}
                density={density}
                columnVisibility={columnVisibility}
                onColumnVisibilityChange={setColumnVisibility}
                columnOrder={columnOrder}
                ariaRowCount={total}
                onRowActivate={(r) => void openDetail(r.id)}
                toolbar={
                  <div
                    className="submissions-page__grid-toolbar"
                    data-testid="submissions-grid-toolbar"
                  >
                    <label className="submissions-page__density">
                      Density
                      <select
                        className="lumen-focusable"
                        data-testid="submissions-density"
                        value={density}
                        onChange={(e) =>
                          setDensity(e.target.value as GridDensity)
                        }
                      >
                        <option value="comfortable">Comfortable</option>
                        <option value="compact">Compact</option>
                      </select>
                    </label>
                    <label className="submissions-page__views">
                      Saved view
                      <select
                        className="lumen-focusable"
                        data-testid="submissions-saved-views"
                        value={activeViewId ?? ""}
                        onChange={(e) => {
                          const id = e.target.value || null;
                          setActiveViewId(id);
                          if (!id) {
                            // Built-in Default: clear filters/sort/columns to stock.
                            resetGridChrome();
                            setPage(1);
                            return;
                          }
                          const v = savedViews.find((x) => x.id === id);
                          if (!v) return;
                          applyViewDefinition(v);
                        }}
                      >
                        <option value="">Default</option>
                        {savedViews.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                            {v.isDefault ? " ★" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="submissions-page__col-mgr-wrap">
                      <Button
                        type="button"
                        variant="quiet"
                        size="sm"
                        data-testid="submissions-columns-toggle"
                        aria-expanded={columnManagerOpen}
                        onClick={() => setColumnManagerOpen((o) => !o)}
                      >
                        Columns
                      </Button>
                      {columnManagerOpen ? (
                        <ColumnManager
                          data-testid="submissions-column-manager"
                          available={[
                            { id: "title", label: "Title" },
                            { id: "status", label: "Status" },
                            { id: "category", label: "Category" },
                            {
                              id: "primarySpeakerName",
                              label: "Speaker",
                            },
                            { id: "submittedAt", label: "Submitted" },
                          ]}
                          order={columnOrder}
                          onChange={({ order, visibility }) => {
                            setColumnOrder(
                              order.filter((id): id is SubmissionsGridField =>
                                (
                                  SUBMISSIONS_GRID_FIELDS as readonly string[]
                                ).includes(id),
                              ),
                            );
                            setColumnVisibility(visibility);
                          }}
                        />
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="quiet"
                      size="sm"
                      data-testid="submissions-save-view"
                      disabled={!activeEventId || busy}
                      onClick={() => {
                        if (!activeEventId) return;
                        void (async () => {
                          try {
                            const name = window.prompt(
                              "Name this view",
                              "My view",
                            );
                            if (!name?.trim()) return;
                            const visibleCols = columnOrder.filter(
                              (id) => columnVisibility[id] !== false,
                            );
                            const cols =
                              visibleCols.length > 0
                                ? visibleCols
                                : [...SUBMISSIONS_GRID_FIELDS];
                            const res = await fetch(
                              `/api/events/${encodeURIComponent(activeEventId)}/saved-views?surface=submissions`,
                              {
                                method: "POST",
                                credentials: "include",
                                headers: {
                                  "content-type": "application/json",
                                  accept: "application/json",
                                },
                                body: JSON.stringify({
                                  name: name.trim(),
                                  definition: {
                                    columns: cols,
                                    columnOrder: cols,
                                    sort: { field: sortField, dir: sortDir },
                                    density,
                                    status: statusFilter || null,
                                    category: categoryFilter || null,
                                  },
                                  isDefault: false,
                                }),
                              },
                            );
                            if (!res.ok) {
                              const raw: unknown = await res
                                .json()
                                .catch(() => null);
                              const env = ErrorEnvelopeSchema.safeParse(raw);
                              setStatus({
                                kind: "error",
                                text: env.success
                                  ? env.data.error
                                  : `Could not save view (${res.status})`,
                              });
                              return;
                            }
                            const parsed = SavedViewResponseSchema.safeParse(
                              await res.json(),
                            );
                            if (!parsed.success) {
                              setStatus({
                                kind: "error",
                                text: "Saved view response was unexpected",
                              });
                              return;
                            }
                            setSavedViews((prev) => [
                              ...prev,
                              parsed.data.view,
                            ]);
                            setActiveViewId(parsed.data.view.id);
                            setStatus({
                              kind: "ok",
                              text: `Saved view “${parsed.data.view.name}”`,
                            });
                          } catch {
                            setStatus({
                              kind: "error",
                              text: "Network error saving view",
                            });
                          }
                        })();
                      }}
                    >
                      Save view
                    </Button>
                    {activeViewId ? (
                      <>
                        <Button
                          type="button"
                          variant="quiet"
                          size="sm"
                          data-testid="submissions-set-default-view"
                          disabled={!activeEventId || busy}
                          onClick={() => {
                            if (!activeEventId || !activeViewId) return;
                            const cur = savedViews.find(
                              (v) => v.id === activeViewId,
                            );
                            if (!cur) return;
                            void (async () => {
                              try {
                                const res = await fetch(
                                  `/api/events/${encodeURIComponent(activeEventId)}/saved-views/${encodeURIComponent(activeViewId)}?surface=submissions`,
                                  {
                                    method: "PATCH",
                                    credentials: "include",
                                    headers: {
                                      "content-type": "application/json",
                                      accept: "application/json",
                                    },
                                    body: JSON.stringify({
                                      isDefault: true,
                                      expectedVersion: cur.version,
                                    }),
                                  },
                                );
                                if (!res.ok) {
                                  setStatus({
                                    kind: "error",
                                    text: "Could not set default view",
                                  });
                                  return;
                                }
                                const parsed = SavedViewResponseSchema.safeParse(
                                  await res.json(),
                                );
                                if (!parsed.success) return;
                                setSavedViews((prev) =>
                                  prev.map((v) =>
                                    v.id === parsed.data.view.id
                                      ? parsed.data.view
                                      : { ...v, isDefault: false },
                                  ),
                                );
                                setStatus({
                                  kind: "ok",
                                  text: `“${parsed.data.view.name}” is now default`,
                                });
                              } catch {
                                setStatus({
                                  kind: "error",
                                  text: "Network error setting default view",
                                });
                              }
                            })();
                          }}
                        >
                          Set default
                        </Button>
                        <Button
                          type="button"
                          variant="quiet"
                          size="sm"
                          data-testid="submissions-delete-view"
                          disabled={!activeEventId || busy}
                          onClick={() => {
                            if (!activeEventId || !activeViewId) return;
                            void (async () => {
                              try {
                                const res = await fetch(
                                  `/api/events/${encodeURIComponent(activeEventId)}/saved-views/${encodeURIComponent(activeViewId)}?surface=submissions`,
                                  {
                                    method: "DELETE",
                                    credentials: "include",
                                    headers: { accept: "application/json" },
                                  },
                                );
                                if (!res.ok) {
                                  setStatus({
                                    kind: "error",
                                    text: "Could not delete view",
                                  });
                                  return;
                                }
                                setSavedViews((prev) =>
                                  prev.filter((v) => v.id !== activeViewId),
                                );
                                resetGridChrome();
                                setPage(1);
                                setStatus({ kind: "ok", text: "View deleted" });
                              } catch {
                                setStatus({
                                  kind: "error",
                                  text: "Network error deleting view",
                                });
                              }
                            })();
                          }}
                        >
                          Delete view
                        </Button>
                      </>
                    ) : null}
                  </div>
                }
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
                    <span
                      data-testid="submission-detail-status"
                      data-status={detail.submission.status}
                    >
                      {statusDisplayLabel(detail.submission.status)}
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
                      Decision: {statusDisplayLabel(detail.decision.decision)}
                    </Badge>
                  ) : null}
                </div>
              </header>

              <section
                className="submissions-page__detail-section"
                data-testid="submission-detail-section-reviews"
                aria-labelledby="detail-reviews-heading"
              >
                <h4
                  id="detail-reviews-heading"
                  className="submissions-page__subhead"
                >
                  Reviews
                </h4>
                {!detailReviews || detailReviews.reviews.length === 0 ? (
                  <p
                    className="eval-queue__muted"
                    data-testid="submission-detail-reviews-empty"
                  >
                    No evaluation reviews yet.
                  </p>
                ) : (
                  <ul
                    className="eval-reviews-list"
                    data-testid="submission-detail-reviews"
                  >
                    {detailReviews.reviews.map((r) => (
                      <li
                        key={r.assignmentId}
                        className="eval-reviews-list__item"
                        data-testid={`submission-detail-review-${r.assignmentId}`}
                      >
                        <div className="eval-reviews-list__meta">
                          <strong>
                            {r.evaluatorEmail ?? r.evaluatorUserId}
                          </strong>
                          <span className="eval-queue__muted">
                            {" "}
                            · {r.status}
                            {r.aggregateScore != null
                              ? ` · ${r.aggregateScore.toFixed(1)}`
                              : ""}
                          </span>
                        </div>
                        {r.overallComment ? (
                          <p className="eval-reviews-list__comment">
                            {r.overallComment}
                          </p>
                        ) : (
                          <p className="eval-queue__muted">No overall comment</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

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
                {detail.answers.length === 0 ? (
                  <p
                    className="eval-queue__muted"
                    data-testid="submission-detail-answers-empty"
                  >
                    No form answers recorded for this submission.
                  </p>
                ) : (
                  <dl
                    className="submissions-page__answer-list"
                    data-testid="submission-detail-answers"
                  >
                    {detail.answers.map((a) => (
                      <div
                        key={a.fieldKey}
                        className="submissions-page__answer-row"
                        data-testid={`answer-${a.fieldKey}`}
                        data-field-key={a.fieldKey}
                      >
                        <dt
                          className="submissions-page__answer-key"
                          data-testid={`answer-label-${a.fieldKey}`}
                        >
                          {answerHeading(a)}
                        </dt>
                        <dd className="submissions-page__answer-value">
                          {renderAnswerValue(a.value, a.options)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </section>

              {detail.session ? (
                <section
                  className="submissions-page__detail-section"
                  data-testid="submission-detail-section-session"
                >
                  <h4 className="submissions-page__subhead">Programme session</h4>
                  <p data-testid="submission-detail-session">
                    {detail.session.title}
                    <span className="eval-queue__muted">
                      {" "}
                      · {statusDisplayLabel(detail.session.status)}
                    </span>
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
                  <fieldset
                    className="submissions-page__evaluator-picker"
                    data-testid="submission-assign-evaluator-picker"
                  >
                    <legend className="event-settings__label">
                      Assign evaluator(s)
                    </legend>
                    {evaluators.length === 0 ? (
                      <p
                        className="eval-queue__muted"
                        data-testid="submission-assign-no-evaluators"
                      >
                        No evaluators on this event. Invite evaluators first.
                      </p>
                    ) : (
                      <ul className="submissions-page__evaluator-list">
                        {evaluators.map((m) => {
                          const checked = assignUserIds.has(m.userId);
                          return (
                            <li key={m.userId}>
                              <label
                                className="submissions-page__evaluator-option lumen-focusable"
                                data-testid={`submission-assign-evaluator-${m.userId}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleAssignUser(m.userId)}
                                  data-testid={`submission-assign-check-${m.userId}`}
                                />
                                <span>
                                  {m.email}
                                  <span className="eval-queue__muted">
                                    {" "}
                                    · {m.assignmentCount} assigned
                                  </span>
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </fieldset>
                  {assignBlocked ? (
                    <p
                      className="eval-queue__muted"
                      data-testid="submission-assign-ineligible"
                    >
                      {assignBlocked}
                    </p>
                  ) : null}
                  <div className="eval-queue__row">
                    <Button
                      type="submit"
                      variant="secondary"
                      data-testid="submission-assign-submit"
                      disabled={
                        busy || assignUserIds.size === 0 || assignBlocked != null
                      }
                      pending={busy}
                    >
                      Assign to this submission
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      data-testid="submission-assign-batch"
                      disabled={
                        busy ||
                        assignUserIds.size === 0 ||
                        selected.size === 0
                      }
                      pending={busy}
                      onClick={() => void batchAssignSelected()}
                    >
                      Assign to selected ({selected.size})
                    </Button>
                  </div>
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
                {decisionBlocked ? (
                  <p
                    className="eval-queue__muted"
                    data-testid="submission-decision-ineligible"
                  >
                    {decisionBlocked}
                  </p>
                ) : null}
                <div
                  className="submissions-page__decision-actions"
                  data-testid="submission-decision-actions"
                >
                  <Button
                    variant="success"
                    data-testid="submission-accept"
                    disabled={busy || decisionBlocked != null}
                    pending={busy}
                    onClick={() => void recordDecision("accept")}
                  >
                    Accept
                  </Button>
                  <Button
                    variant="danger"
                    data-testid="submission-reject"
                    disabled={busy || decisionBlocked != null}
                    onClick={() => void recordDecision("reject")}
                  >
                    Reject
                  </Button>
                  <Button
                    variant="secondary"
                    data-testid="submission-waitlist"
                    disabled={busy || decisionBlocked != null}
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
