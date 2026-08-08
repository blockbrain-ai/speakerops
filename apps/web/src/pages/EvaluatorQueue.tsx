/**
 * Evaluator queue + scoring UI (section 3.4 / S-EVAL).
 *
 * Inventory: F01 queue assigned-only · F02 score save · F03 no accept · F04 keyboard.
 * Wired to GET /api/me/eval-queue and POST /api/assignments/:id/scores.
 * No Decision.Record / accept-reject controls (F03).
 */
import { useCallback, useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  EvalQueueResponseSchema,
  EvalScoreResponseSchema,
  ErrorEnvelopeSchema,
  type EvalQueueItem,
  type EvalCriterionDto,
} from "@speakerops/shared";

type StatusMsg = { kind: "ok" | "error"; text: string } | null;

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
      className="eval-queue"
      data-testid="evaluator-queue"
      data-section="3.4"
    >
      <p className="page-stub__overline">Evaluator</p>
      <h2 className="page-stub__title" data-testid="eval-queue-title">
        Evaluation queue
      </h2>
      <p className="page-stub__body">
        Score only submissions assigned to you. Accept/reject is admin-only —
        those controls are not available here.
      </p>

      {loading ? (
        <p className="eval-queue__muted" data-testid="eval-queue-loading">
          Loading queue…
        </p>
      ) : null}
      {loadError ? (
        <p
          className="event-settings__status event-settings__status--error"
          data-testid="eval-queue-error"
          role="alert"
        >
          {loadError}
        </p>
      ) : null}

      {!loading && !loadError && items.length === 0 ? (
        <p className="eval-queue__muted" data-testid="eval-queue-empty">
          No assigned submissions.
        </p>
      ) : null}

      <div className="eval-queue__layout">
        <ul
          className="eval-queue__list"
          data-testid="eval-queue-list"
          aria-label="Assigned submissions"
        >
          {items.map((item) => (
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
              </button>
            </li>
          ))}
        </ul>

        {active ? (
          <section
            className="event-settings__card eval-queue__score-panel"
            data-testid="eval-score-panel"
            aria-labelledby="eval-score-heading"
          >
            <h3 id="eval-score-heading" className="event-settings__heading">
              Score: {active.submission.title}
            </h3>
            <p className="eval-queue__muted" data-testid="eval-score-event">
              {active.event.name}
            </p>

            <form
              className="event-settings__form"
              onSubmit={onSave}
              onKeyDown={onScoreKeyDown}
              data-testid="eval-score-form"
            >
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

              <button
                type="submit"
                className="event-settings__submit lumen-focusable"
                data-testid="eval-score-save"
                disabled={saving}
              >
                {saving ? "Saving…" : "Save scores"}
              </button>

              {/* F03: no accept / reject / decide controls for evaluator */}
              {status ? (
                <p
                  className={
                    status.kind === "ok"
                      ? "event-settings__status event-settings__status--ok"
                      : "event-settings__status event-settings__status--error"
                  }
                  data-testid="eval-score-status"
                  role="status"
                >
                  {status.text}
                </p>
              ) : null}
            </form>
          </section>
        ) : null}
      </div>
    </div>
  );
}
