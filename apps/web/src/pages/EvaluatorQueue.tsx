/**
 * Evaluator queue + scoring UI (section 3.4 / S-EVAL + 11.4 S-L2-SUB).
 *
 * Low-distraction review workspace: progress, proposal panel, focused score panel.
 *
 * Inventory: F01 queue assigned-only · F02 score save · F03 no accept · F04 keyboard.
 * Wired to GET /api/me/eval-queue, GET /api/me/eval-assignments/:id/proposal,
 * and POST /api/assignments/:id/scores.
 * No Decision.Record / accept-reject controls (F03).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  EvalQueueResponseSchema,
  EvalScoreResponseSchema,
  EvalProposalResponseSchema,
  EvalReviewsResponseSchema,
  ErrorEnvelopeSchema,
  type EvalQueueItem,
  type EvalCriterionDto,
  type EvalProposalResponse,
  type EvalReviewItem,
} from "@speakerops/shared";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
} from "../components/ui/index.js";
import {
  buildEvalRoundStrip,
  formatRoundDeadline,
} from "./eval-queue-utils.js";

type StatusMsg = { kind: "ok" | "error"; text: string } | null;

function isAssignmentComplete(item: EvalQueueItem): boolean {
  if (item.assignment.status === "scored") return true;
  if (item.assignment.aggregateScore != null) return true;
  const scores = item.assignment.scores ?? [];
  if (item.criteria.length === 0) return false;
  return item.criteria.every((c) =>
    scores.some((s) => s.criterionId === c.id && s.value != null),
  );
}

function formatAnswerValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") {
    if (value.startsWith("file:")) return "Uploaded";
    return value;
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(String).join(", ");
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function EvaluatorQueuePage() {
  const [items, setItems] = useState<EvalQueueItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState<StatusMsg>(null);
  const [saving, setSaving] = useState(false);

  const [proposal, setProposal] = useState<EvalProposalResponse | null>(null);
  const [proposalLoading, setProposalLoading] = useState(false);
  const [proposalError, setProposalError] = useState<string | null>(null);
  /** True after a successful proposal load for the current assignment (empty ok). */
  const [proposalReady, setProposalReady] = useState(false);

  const [peerOpen, setPeerOpen] = useState(false);
  const [peerReviews, setPeerReviews] = useState<EvalReviewItem[]>([]);
  const [peerLoading, setPeerLoading] = useState(false);
  const [peerError, setPeerError] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/me/eval-queue", {
        credentials: "include",
        headers: { accept: "application/json" },
      });
      if (res.status === 401) {
        setLoadError("Sign in required");
        setItems([]);
        setLoading(false);
        return;
      }
      if (!res.ok) {
        const raw: unknown = await res.json().catch(() => null);
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setLoadError(env.success ? env.data.error : `Failed (${res.status})`);
        setItems([]);
        setLoading(false);
        return;
      }
      const raw: unknown = await res.json();
      const parsed = EvalQueueResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setLoadError("Unexpected queue response");
        setItems([]);
        setLoading(false);
        return;
      }
      setItems(parsed.data.items);
      if (parsed.data.items.length > 0 && !activeId) {
        const first = parsed.data.items[0]!;
        setActiveId(first.assignment.id);
        seedScores(first);
      }
    } catch {
      setLoadError("Network error");
    } finally {
      setLoading(false);
    }
  }, [activeId]);

  function seedScores(item: EvalQueueItem) {
    const next: Record<string, string> = {};
    for (const c of item.criteria) {
      const existing = item.assignment.scores?.find(
        (s) => s.criterionId === c.id,
      );
      next[c.id] = existing != null ? String(existing.value) : "";
    }
    setValues(next);
    setComment(item.assignment.overallComment ?? "");
    setStatus(null);
  }

  useEffect(() => {
    void loadQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount load
  }, []);

  /** Load proposal when active assignment changes. */
  useEffect(() => {
    if (!activeId) {
      setProposal(null);
      setProposalReady(false);
      setProposalError(null);
      setProposalLoading(false);
      return;
    }
    let cancelled = false;
    setProposal(null);
    setProposalReady(false);
    setProposalError(null);
    setProposalLoading(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/me/eval-assignments/${encodeURIComponent(activeId)}/proposal`,
          {
            credentials: "include",
            headers: { accept: "application/json" },
          },
        );
        if (cancelled) return;
        if (!res.ok) {
          const raw: unknown = await res.json().catch(() => null);
          const env = ErrorEnvelopeSchema.safeParse(raw);
          setProposalError(
            env.success ? env.data.error : `Failed (${res.status})`,
          );
          setProposal(null);
          setProposalReady(false);
          return;
        }
        const raw: unknown = await res.json();
        const parsed = EvalProposalResponseSchema.safeParse(raw);
        if (!parsed.success) {
          setProposalError("Unexpected proposal response");
          setProposal(null);
          setProposalReady(false);
          return;
        }
        setProposal(parsed.data);
        setProposalReady(true);
        setProposalError(null);
      } catch {
        if (!cancelled) {
          setProposalError("Network error loading proposal");
          setProposal(null);
          setProposalReady(false);
        }
      } finally {
        if (!cancelled) setProposalLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const active = items.find((i) => i.assignment.id === activeId) ?? null;

  /** Peer reviews (reveal-after-submit) for the active submission. */
  useEffect(() => {
    if (!active || !peerOpen) {
      if (!active) {
        setPeerReviews([]);
        setPeerError(null);
        setPeerLoading(false);
      }
      return;
    }
    let cancelled = false;
    setPeerLoading(true);
    setPeerError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/submissions/${encodeURIComponent(active.submission.id)}/eval-reviews`,
          {
            credentials: "include",
            headers: { accept: "application/json" },
          },
        );
        if (cancelled) return;
        if (!res.ok) {
          const raw: unknown = await res.json().catch(() => null);
          const env = ErrorEnvelopeSchema.safeParse(raw);
          setPeerError(
            env.success ? env.data.error : `Failed (${res.status})`,
          );
          setPeerReviews([]);
          return;
        }
        const raw: unknown = await res.json();
        const parsed = EvalReviewsResponseSchema.safeParse(raw);
        if (!parsed.success) {
          setPeerError("Unexpected peer reviews response");
          setPeerReviews([]);
          return;
        }
        // Peers only (exclude self) for the collapsible panel label.
        setPeerReviews(
          parsed.data.reviews.filter((r) => r.isSelf !== true),
        );
        setPeerError(null);
      } catch {
        if (!cancelled) {
          setPeerError("Network error loading peer reviews");
          setPeerReviews([]);
        }
      } finally {
        if (!cancelled) setPeerLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, peerOpen]);

  const [queueSearch, setQueueSearch] = useState("");
  const [queueFilter, setQueueFilter] = useState<"all" | "pending" | "scored">(
    "all",
  );

  const filteredItems = useMemo(() => {
    const q = queueSearch.trim().toLowerCase();
    return items.filter((item) => {
      if (queueFilter === "pending" && isAssignmentComplete(item)) return false;
      if (queueFilter === "scored" && !isAssignmentComplete(item)) return false;
      if (!q) return true;
      return (
        item.submission.title.toLowerCase().includes(q) ||
        (item.submission.category ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, queueSearch, queueFilter]);

  const progress = useMemo(() => {
    const total = items.length;
    const done = items.filter(isAssignmentComplete).length;
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);
    return { total, done, pct };
  }, [items]);

  /** Active-round strip (deadline + round-scoped progress). */
  const roundStrip = useMemo(
    () => buildEvalRoundStrip(items, activeId),
    [items, activeId],
  );

  function selectItem(item: EvalQueueItem) {
    setActiveId(item.assignment.id);
    seedScores(item);
  }

  function goNextUnreviewed() {
    const pending = items.filter((i) => !isAssignmentComplete(i));
    if (pending.length === 0) return;
    const idx = pending.findIndex((i) => i.assignment.id === activeId);
    const next = pending[(idx + 1) % pending.length]!;
    selectItem(next);
  }

  async function onSave(e?: FormEvent) {
    e?.preventDefault();
    if (!active) return;
    if (!proposalReady) {
      setStatus({
        kind: "error",
        text: "Wait for the proposal to load before scoring",
      });
      return;
    }
    setSaving(true);
    setStatus(null);

    const scores: Array<{ criterionId: string; value: number }> = [];
    for (const c of active.criteria) {
      const raw = values[c.id] ?? "";
      const num = Number(raw);
      if (raw.trim() === "" || Number.isNaN(num)) {
        setStatus({
          kind: "error",
          text: `Enter a score for “${c.name}” (0–${c.maxScore})`,
        });
        setSaving(false);
        return;
      }
      if (num < 0 || num > c.maxScore) {
        setStatus({
          kind: "error",
          text: `Score for “${c.name}” must be ≤ ${c.maxScore}`,
        });
        setSaving(false);
        return;
      }
      scores.push({ criterionId: c.id, value: num });
    }

    try {
      const res = await fetch(
        `/api/assignments/${encodeURIComponent(active.assignment.id)}/scores`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            scores,
            comment: comment.trim() === "" ? null : comment.trim(),
          }),
        },
      );
      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setStatus({
          kind: "error",
          text: env.success ? env.data.error : `Save failed (${res.status})`,
        });
        setSaving(false);
        return;
      }
      const parsed = EvalScoreResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setStatus({ kind: "error", text: "Unexpected response" });
        setSaving(false);
        return;
      }
      setStatus({
        kind: "ok",
        text: `Saved (aggregate ${parsed.data.assignment.aggregateScore ?? "—"})`,
      });
      await loadQueue();
    } catch {
      setStatus({ kind: "error", text: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  function onScoreKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    // F04: Ctrl/Cmd+Enter saves without mouse
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void onSave();
    }
  }

  return (
    <div
      className="eval-queue eval-queue--l2"
      data-testid="evaluator-queue"
      data-section="11.4"
      data-layout="low-distraction"
    >
      <PageHeader
        eyebrow="Evaluator"
        title="Evaluation queue"
        description={
          items[0]?.event?.name
            ? `Reviewing for ${items[0].event.name}. Score only submissions assigned to you — accept/reject is admin-only.`
            : "Score only submissions assigned to you. Accept/reject is admin-only — those controls are not available here."
        }
        data-testid="eval-queue-header"
      />
      {/* Preserve title testid used by older specs */}
      <h2 className="eval-queue__sr-only" data-testid="eval-queue-title">
        Evaluation queue
      </h2>

      {!loading && !loadError && roundStrip ? (
        <div
          className="eval-round-strip"
          data-testid="eval-round-strip"
          data-round-id={roundStrip.roundId}
          data-round-status={roundStrip.roundStatus}
        >
          <div className="eval-round-strip__row">
            <div>
              <p className="eval-round-strip__event" data-testid="eval-round-strip-event">
                {roundStrip.eventName}
              </p>
              <p className="eval-round-strip__round" data-testid="eval-round-strip-round">
                {roundStrip.roundName}
              </p>
            </div>
            <Badge tone="info" data-testid="eval-round-strip-status">
              {roundStrip.roundStatus}
            </Badge>
          </div>
          <p className="eval-round-strip__deadline" data-testid="eval-round-strip-deadline">
            Deadline: {formatRoundDeadline(roundStrip.closesAt)}
          </p>
          <p
            className="eval-round-strip__progress"
            data-testid="eval-round-strip-progress"
            data-done={roundStrip.done}
            data-total={roundStrip.total}
          >
            This round: {roundStrip.done} of {roundStrip.total} complete (
            {roundStrip.pct}%)
          </p>
          <p className="eval-round-strip__guidance" data-testid="eval-round-strip-guidance">
            Score each criterion in the panel; save with Ctrl/Cmd+Enter. Rubric
            criteria for this assignment appear beside the proposal.
          </p>
        </div>
      ) : null}

      {loading ? (
        <div data-testid="eval-queue-loading" aria-busy="true">
          <p className="eval-queue__muted">Loading queue…</p>
          <Skeleton variant="row" />
          <Skeleton variant="row" />
        </div>
      ) : null}
      {loadError ? (
        <Alert tone="danger" data-testid="eval-queue-error">
          {loadError}
        </Alert>
      ) : null}

      {!loading && !loadError && items.length === 0 ? (
        <EmptyState
          title="No assigned submissions yet"
          description="You're signed in as a reviewer. When the programme team assigns proposals, they'll appear here. Nothing is wrong — check back after assignments are made, or contact the organiser if you expected work already."
          data-testid="eval-queue-empty"
        />
      ) : null}

      {!loading && !loadError && items.length > 0 ? (
        <div
          className="eval-queue__progress-card"
          data-testid="eval-queue-progress"
          data-done={progress.done}
          data-total={progress.total}
          data-pct={progress.pct}
        >
          <div className="eval-queue__progress-meta">
            <span data-testid="eval-queue-progress-label">
              {progress.done} of {progress.total} complete
            </span>
            <Badge
              tone={progress.pct === 100 ? "success" : "info"}
              data-testid="eval-queue-progress-badge"
            >
              {progress.pct}%
            </Badge>
          </div>
          <div
            className="eval-coverage__summary-track"
            role="progressbar"
            aria-valuenow={progress.pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Queue progress ${progress.pct}%`}
            data-testid="eval-queue-progress-bar"
          >
            <div
              className="eval-coverage__fill"
              style={{ width: `${progress.pct}%` }}
            />
          </div>
        </div>
      ) : null}

      <div className="eval-queue__layout">
        <div className="eval-queue__list-tools" data-testid="eval-queue-tools">
          <input
            type="search"
            className="event-settings__input lumen-focusable"
            placeholder="Search titles…"
            value={queueSearch}
            onChange={(e) => setQueueSearch(e.target.value)}
            data-testid="eval-queue-search"
            aria-label="Search queue"
          />
          <select
            className="event-settings__input lumen-focusable"
            value={queueFilter}
            onChange={(e) =>
              setQueueFilter(e.target.value as "all" | "pending" | "scored")
            }
            data-testid="eval-queue-filter"
            aria-label="Filter by review state"
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="scored">Scored</option>
          </select>
          <Button
            type="button"
            variant="secondary"
            data-testid="eval-queue-next-unreviewed"
            onClick={goNextUnreviewed}
            disabled={!items.some((i) => !isAssignmentComplete(i))}
          >
            Next unreviewed
          </Button>
        </div>
        <ul
          className="eval-queue__list"
          data-testid="eval-queue-list"
          aria-label="Assigned submissions"
        >
          {filteredItems.map((item) => {
            const done = isAssignmentComplete(item);
            return (
              <li key={item.assignment.id}>
                <button
                  type="button"
                  className={
                    item.assignment.id === activeId
                      ? "eval-queue__item eval-queue__item--active lumen-focusable"
                      : "eval-queue__item lumen-focusable"
                  }
                  data-testid={`eval-queue-item-${item.assignment.id}`}
                  data-submission-id={item.submission.id}
                  data-submission-title={item.submission.title}
                  data-complete={done ? "1" : "0"}
                  onClick={() => selectItem(item)}
                >
                  <span className="eval-queue__item-title">
                    {item.submission.title}
                  </span>
                  <span className="eval-queue__item-meta">
                    {item.assignment.status}
                    {item.assignment.aggregateScore != null
                      ? ` · ${item.assignment.aggregateScore.toFixed(1)}`
                      : ""}
                  </span>
                  {done ? (
                    <Badge tone="success" showDot>
                      Done
                    </Badge>
                  ) : (
                    <Badge tone="warn" showDot>
                      To do
                    </Badge>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        {active ? (
          <div
            className="eval-queue__review"
            data-testid="eval-queue-review"
          >
            <Card
              className="eval-queue__proposal-panel"
              data-testid="eval-proposal-panel"
              title={
                proposal?.submission.title ?? active.submission.title
              }
              meta={active.event.name}
              raised
            >
              {proposalLoading ? (
                <p
                  className="eval-queue__muted"
                  data-testid="eval-proposal-loading"
                >
                  Loading proposal…
                </p>
              ) : null}
              {proposalError ? (
                <Alert tone="danger" data-testid="eval-proposal-error">
                  {proposalError}
                </Alert>
              ) : null}
              {proposalReady && proposal ? (
                <>
                  {proposal.submission.category ? (
                    <p
                      className="eval-queue__muted"
                      data-testid="eval-proposal-category"
                    >
                      Category: {proposal.submission.category}
                    </p>
                  ) : null}

                  <section
                    className="eval-queue__proposal-speakers"
                    data-testid="eval-proposal-speakers"
                    aria-label="Speakers"
                  >
                    <h3 className="eval-queue__proposal-heading">Speakers</h3>
                    {proposal.speakers.length === 0 ? (
                      <p className="eval-queue__muted">No speakers listed.</p>
                    ) : (
                      <ul className="eval-queue__proposal-speaker-list">
                        {proposal.speakers.map((s) => (
                          <li
                            key={`${s.personId}-${s.sortOrder}`}
                            data-testid={`eval-proposal-speaker-${s.sortOrder}`}
                          >
                            <strong>{s.name || "Unnamed"}</strong>
                            {s.email ? (
                              <span className="eval-queue__muted">
                                {" "}
                                · {s.email}
                              </span>
                            ) : null}
                            {s.isPrimary ? (
                              <Badge tone="info">Primary</Badge>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section
                    className="eval-queue__proposal-answers"
                    data-testid="eval-proposal-answers"
                    aria-label="Proposal answers"
                  >
                    <h3 className="eval-queue__proposal-heading">Answers</h3>
                    {proposal.answers.length === 0 ? (
                      <p
                        className="eval-queue__muted"
                        data-testid="eval-proposal-answers-empty"
                      >
                        No form answers on this submission.
                      </p>
                    ) : (
                      <dl className="eval-queue__proposal-answer-list">
                        {proposal.answers.map((a) => (
                          <div
                            key={a.fieldKey}
                            className="eval-queue__proposal-answer"
                            data-testid={`eval-proposal-answer-${a.fieldKey}`}
                          >
                            <dt>{a.label ?? a.fieldKey}</dt>
                            <dd>{formatAnswerValue(a.value)}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </section>
                </>
              ) : null}
            </Card>

            <Card
              className="eval-queue__score-panel"
              data-testid="eval-score-panel"
              title={`Score: ${active.submission.title}`}
              meta={active.event.name}
              raised
            >
              <p className="eval-queue__muted" data-testid="eval-score-event">
                {active.event.name}
              </p>

              <form
                className="event-settings__form eval-queue__score-form"
                onSubmit={onSave}
                onKeyDown={onScoreKeyDown}
                data-testid="eval-score-form"
              >
                <p
                  className="eval-queue__hint"
                  data-testid="eval-score-keyboard-hint"
                >
                  Tip: Ctrl/Cmd+Enter saves without leaving the keyboard.
                </p>

                {active.criteria.map((c: EvalCriterionDto) => (
                  <div key={c.id} className="eval-queue__criterion">
                    <label
                      className="event-settings__label"
                      htmlFor={`score-${c.id}`}
                    >
                      {c.name}{" "}
                      <span className="eval-queue__muted">
                        (max {c.maxScore}, weight {c.weight})
                      </span>
                    </label>
                    <input
                      id={`score-${c.id}`}
                      type="number"
                      min={0}
                      max={c.maxScore}
                      step="any"
                      className="event-settings__input lumen-focusable"
                      data-testid={`eval-score-input-${c.id}`}
                      data-criterion-id={c.id}
                      data-max-score={c.maxScore}
                      value={values[c.id] ?? ""}
                      onChange={(ev) =>
                        setValues((prev) => ({
                          ...prev,
                          [c.id]: ev.target.value,
                        }))
                      }
                      required
                      disabled={!proposalReady || proposalLoading}
                    />
                  </div>
                ))}

                <label className="event-settings__label" htmlFor="eval-comment">
                  Comment
                </label>
                <textarea
                  id="eval-comment"
                  className="event-settings__input lumen-focusable"
                  data-testid="eval-score-comment"
                  rows={3}
                  value={comment}
                  onChange={(ev) => setComment(ev.target.value)}
                  maxLength={4000}
                  disabled={!proposalReady || proposalLoading}
                />

                <Button
                  type="submit"
                  variant="primary"
                  data-testid="eval-score-save"
                  disabled={saving || !proposalReady || proposalLoading}
                  pending={saving}
                >
                  {saving
                    ? "Saving…"
                    : proposalLoading
                      ? "Loading proposal…"
                      : "Save scores"}
                </Button>

                {/* F03: no accept / reject / decide controls for evaluator */}
                {status ? (
                  <Alert
                    tone={status.kind === "ok" ? "success" : "danger"}
                    data-testid="eval-score-status"
                  >
                    {status.text}
                  </Alert>
                ) : null}
              </form>
            </Card>

            <details
              className="eval-queue__peer-reviews"
              data-testid="eval-peer-reviews"
              open={peerOpen}
              onToggle={(e) => {
                setPeerOpen((e.target as HTMLDetailsElement).open);
              }}
            >
              <summary
                className="eval-queue__peer-reviews-summary lumen-focusable"
                data-testid="eval-peer-reviews-toggle"
              >
                Peer reviews
              </summary>
              {peerLoading ? (
                <p
                  className="eval-queue__muted"
                  data-testid="eval-peer-reviews-loading"
                >
                  Loading peer reviews…
                </p>
              ) : null}
              {peerError ? (
                <Alert tone="danger" data-testid="eval-peer-reviews-error">
                  {peerError}
                </Alert>
              ) : null}
              {!peerLoading && !peerError && peerReviews.length === 0 ? (
                <p
                  className="eval-queue__muted"
                  data-testid="eval-peer-reviews-empty"
                >
                  No peer reviews revealed yet. Peers appear after they submit
                  scores.
                </p>
              ) : null}
              {!peerLoading && peerReviews.length > 0 ? (
                <ul
                  className="eval-reviews-list"
                  data-testid="eval-peer-reviews-list"
                >
                  {peerReviews.map((r) => (
                    <li
                      key={r.assignmentId}
                      className="eval-reviews-list__item"
                      data-testid={`eval-peer-review-${r.assignmentId}`}
                      data-status={r.status}
                    >
                      <div className="eval-reviews-list__meta">
                        <strong>
                          {r.evaluatorEmail?.trim() || r.evaluatorUserId}
                        </strong>
                        <Badge
                          tone={r.status === "scored" ? "success" : "neutral"}
                        >
                          {r.status}
                        </Badge>
                        <span className="eval-queue__muted">
                          {r.aggregateScore != null
                            ? `score ${r.aggregateScore.toFixed(2)}`
                            : "no score"}
                        </span>
                      </div>
                      {r.overallComment ? (
                        <p className="eval-reviews-list__comment">
                          {r.overallComment}
                        </p>
                      ) : (
                        <p className="eval-queue__muted">No comment.</p>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </details>
          </div>
        ) : null}
      </div>
    </div>
  );
}
