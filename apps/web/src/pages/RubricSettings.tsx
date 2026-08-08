/**
 * Admin eval rubric settings (section 3.4 / O04).
 *
 * PUT/GET /api/events/:eventId/eval/rubric — Eval.UpsertRubric.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  EvalRubricResponseSchema,
  ErrorEnvelopeSchema,
  type EvalCriterionDto,
} from "@speakerops/shared";
import { useEventContext } from "../events/EventContext.js";

type StatusMsg = { kind: "ok" | "error"; text: string } | null;

type CriterionDraft = {
  localId: string;
  id?: string;
  name: string;
  maxScore: string;
  weight: string;
};

function emptyCriterion(): CriterionDraft {
  return {
    localId: `local-${Math.random().toString(36).slice(2, 10)}`,
    name: "",
    maxScore: "5",
    weight: "1",
  };
}

export function RubricSettingsPage() {
  const { activeEventId } = useEventContext();
  const [criteria, setCriteria] = useState<CriterionDraft[]>([emptyCriterion()]);
  const [roundName, setRoundName] = useState("Default rubric");
  const [roundId, setRoundId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusMsg>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadRubric = useCallback(async (eventId: string) => {
    setLoadError(null);
    setStatus(null);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/eval/rubric`,
        {
          credentials: "include",
          headers: { accept: "application/json" },
        },
      );
      if (!res.ok) {
        const raw: unknown = await res.json().catch(() => null);
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setLoadError(env.success ? env.data.error : `Load failed (${res.status})`);
        return;
      }
      const raw: unknown = await res.json();
      // Empty rubric: { round: null, criteria: [] }
      if (
        raw &&
        typeof raw === "object" &&
        "round" in raw &&
        (raw as { round: unknown }).round == null
      ) {
        setRoundId(null);
        setRoundName("Default rubric");
        setCriteria([emptyCriterion()]);
        return;
      }
      const parsed = EvalRubricResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setLoadError("Unexpected rubric response");
        return;
      }
      setRoundId(parsed.data.round.id);
      setRoundName(parsed.data.round.name);
      if (parsed.data.criteria.length === 0) {
        setCriteria([emptyCriterion()]);
      } else {
        setCriteria(
          parsed.data.criteria.map((c: EvalCriterionDto) => ({
            localId: c.id,
            id: c.id,
            name: c.name,
            maxScore: String(c.maxScore),
            weight: String(c.weight),
          })),
        );
      }
    } catch {
      setLoadError("Network error");
    }
  }, []);

  useEffect(() => {
    if (activeEventId) {
      void loadRubric(activeEventId);
    }
  }, [activeEventId, loadRubric]);

  function updateCriterion(
    localId: string,
    patch: Partial<CriterionDraft>,
  ) {
    setCriteria((prev) =>
      prev.map((c) => (c.localId === localId ? { ...c, ...patch } : c)),
    );
  }

  function addCriterion() {
    setCriteria((prev) => [...prev, emptyCriterion()]);
  }

  function removeCriterion(localId: string) {
    setCriteria((prev) =>
      prev.length <= 1 ? prev : prev.filter((c) => c.localId !== localId),
    );
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!activeEventId) {
      setStatus({ kind: "error", text: "Select an event first" });
      return;
    }
    setSaving(true);
    setStatus(null);

    const payloadCriteria: Array<{
      id?: string;
      name: string;
      maxScore: number;
      weight: number;
      sortOrder: number;
    }> = [];

    for (let i = 0; i < criteria.length; i++) {
      const c = criteria[i]!;
      const name = c.name.trim();
      const maxScore = Number(c.maxScore);
      const weight = Number(c.weight);
      if (!name) {
        setStatus({ kind: "error", text: "Each criterion needs a name" });
        setSaving(false);
        return;
      }
      if (!(maxScore > 0) || Number.isNaN(maxScore)) {
        setStatus({ kind: "error", text: "maxScore must be a positive number" });
        setSaving(false);
        return;
      }
      if (!(weight > 0) || Number.isNaN(weight)) {
        setStatus({ kind: "error", text: "weight must be a positive number" });
        setSaving(false);
        return;
      }
      payloadCriteria.push({
        ...(c.id ? { id: c.id } : {}),
        name,
        maxScore,
        weight,
        sortOrder: i,
      });
    }

    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(activeEventId)}/eval/rubric`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...(roundId ? { roundId } : {}),
            name: roundName.trim() || "Default rubric",
            criteria: payloadCriteria,
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
      const parsed = EvalRubricResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setStatus({ kind: "error", text: "Unexpected response" });
        setSaving(false);
        return;
      }
      setRoundId(parsed.data.round.id);
      setRoundName(parsed.data.round.name);
      setCriteria(
        parsed.data.criteria.map((c) => ({
          localId: c.id,
          id: c.id,
          name: c.name,
          maxScore: String(c.maxScore),
          weight: String(c.weight),
        })),
      );
      setStatus({ kind: "ok", text: "Rubric saved" });
    } catch {
      setStatus({ kind: "error", text: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="event-settings"
      data-testid="page-rubric-settings"
      data-section="3.4"
    >
      <p className="page-stub__overline">Settings</p>
      <h2 className="page-stub__title">Eval rubric</h2>
      <p className="page-stub__body">
        Configure human evaluation criteria (max score + weight) for the active
        event.{" "}
        <a
          href="/admin/settings"
          className="design-kit__link lumen-focusable"
          data-testid="rubric-settings-back"
        >
          ← Event settings
        </a>
      </p>

      {!activeEventId ? (
        <p className="eval-queue__muted" data-testid="rubric-no-event">
          Select an event to edit the rubric.
        </p>
      ) : null}

      {loadError ? (
        <p
          className="event-settings__status event-settings__status--error"
          data-testid="rubric-load-error"
          role="alert"
        >
          {loadError}
        </p>
      ) : null}

      {activeEventId ? (
        <section
          className="event-settings__card"
          data-testid="rubric-edit-section"
          aria-labelledby="rubric-edit-heading"
        >
          <h3 id="rubric-edit-heading" className="event-settings__heading">
            Criteria
          </h3>
          <form
            className="event-settings__form"
            onSubmit={onSave}
            data-testid="rubric-form"
          >
            <label className="event-settings__label" htmlFor="rubric-round-name">
              Round name
            </label>
            <input
              id="rubric-round-name"
              className="event-settings__input lumen-focusable"
              data-testid="rubric-round-name"
              value={roundName}
              onChange={(ev) => setRoundName(ev.target.value)}
              maxLength={200}
            />

            {criteria.map((c, index) => (
              <div
                key={c.localId}
                className="eval-queue__criterion"
                data-testid={`rubric-criterion-row-${index}`}
              >
                <label
                  className="event-settings__label"
                  htmlFor={`rubric-name-${c.localId}`}
                >
                  Criterion {index + 1} name
                </label>
                <input
                  id={`rubric-name-${c.localId}`}
                  className="event-settings__input lumen-focusable"
                  data-testid={`rubric-criterion-name-${index}`}
                  value={c.name}
                  onChange={(ev) =>
                    updateCriterion(c.localId, { name: ev.target.value })
                  }
                  required
                  maxLength={200}
                />
                <div className="eval-queue__row">
                  <div>
                    <label
                      className="event-settings__label"
                      htmlFor={`rubric-max-${c.localId}`}
                    >
                      Max score
                    </label>
                    <input
                      id={`rubric-max-${c.localId}`}
                      type="number"
                      min={0.01}
                      step="any"
                      className="event-settings__input lumen-focusable"
                      data-testid={`rubric-criterion-max-${index}`}
                      value={c.maxScore}
                      onChange={(ev) =>
                        updateCriterion(c.localId, {
                          maxScore: ev.target.value,
                        })
                      }
                      required
                    />
                  </div>
                  <div>
                    <label
                      className="event-settings__label"
                      htmlFor={`rubric-weight-${c.localId}`}
                    >
                      Weight
                    </label>
                    <input
                      id={`rubric-weight-${c.localId}`}
                      type="number"
                      min={0.01}
                      step="any"
                      className="event-settings__input lumen-focusable"
                      data-testid={`rubric-criterion-weight-${index}`}
                      value={c.weight}
                      onChange={(ev) =>
                        updateCriterion(c.localId, {
                          weight: ev.target.value,
                        })
                      }
                      required
                    />
                  </div>
                </div>
                {criteria.length > 1 ? (
                  <button
                    type="button"
                    className="eval-queue__link lumen-focusable"
                    data-testid={`rubric-criterion-remove-${index}`}
                    onClick={() => removeCriterion(c.localId)}
                  >
                    Remove criterion
                  </button>
                ) : null}
              </div>
            ))}

            <button
              type="button"
              className="eval-queue__link lumen-focusable"
              data-testid="rubric-add-criterion"
              onClick={addCriterion}
            >
              + Add criterion
            </button>

            <button
              type="submit"
              className="event-settings__submit lumen-focusable"
              data-testid="rubric-save"
              disabled={saving}
            >
              {saving ? "Saving…" : "Save rubric"}
            </button>

            {status ? (
              <p
                className={
                  status.kind === "ok"
                    ? "event-settings__status event-settings__status--ok"
                    : "event-settings__status event-settings__status--error"
                }
                data-testid="rubric-status"
                role="status"
              >
                {status.text}
              </p>
            ) : null}
          </form>
        </section>
      ) : null}
    </div>
  );
}
