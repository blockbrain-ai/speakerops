/**
 * Evaluator queue + scoring UI (section 3.4 / S-EVAL + 11.4 S-L2-SUB).
 *
 * Low-distraction review workspace: progress, focused score panel, no admin chrome.
 *
 * Inventory: F01 queue assigned-only · F02 score save · F03 no accept · F04 keyboard.
 * Wired to GET /api/me/eval-queue and POST /api/assignments/:id/scores.
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
  ErrorEnvelopeSchema,
  type EvalQueueItem,
  type EvalCriterionDto,
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

export function EvaluatorQueuePage() {
  const [items, setItems] = useState<EvalQueueItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState<StatusMsg>(null);
  const [saving, setSaving] = useState(false);

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

  const active = items.find((i) => i.assignment.id === activeId) ?? null;

  const progress = useMemo(() => {
    const total = items.length;
    const done = items.filter(isAssignmentComplete).length;
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);
    return { total, done, pct };
  }, [items]);

  function selectItem(item: EvalQueueItem) {
    setActiveId(item.assignment.id);
    seedScores(item);
  }

  async function onSave(e?: FormEvent) {
    e?.preventDefault();
    if (!active) return;
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
        description="Score only submissions assigned to you. Accept/reject is admin-only — those controls are not available here."
        data-testid="eval-queue-header"
      />
      {/* Preserve title testid used by older specs */}
      <h2 className="eval-queue__sr-only" data-testid="eval-queue-title">
        Evaluation queue
      </h2>

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
          title="No assigned submissions"
          description="When an admin assigns you a proposal, it will appear here for low-distraction scoring."
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
        <ul
          className="eval-queue__list"
          data-testid="eval-queue-list"
          aria-label="Assigned submissions"
        >
          {items.map((item) => {
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
              />

              <Button
                type="submit"
                variant="primary"
                data-testid="eval-score-save"
                disabled={saving}
                pending={saving}
              >
                {saving ? "Saving…" : "Save scores"}
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
        ) : null}
      </div>
    </div>
  );
}
