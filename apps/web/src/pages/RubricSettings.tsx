/**
 * Admin eval rubric settings (section 3.4 / O04).
 *
 * PUT/GET /api/events/:eventId/eval/rubric — Eval.UpsertRubric.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  EvalRubricResponseSchema,
  ErrorEnvelopeSchema,
  isEvalRoundClosed,
  type EvalCriterionDto,
} from "@speakerops/shared";
import { useEventContext } from "../events/EventContext.js";
import { Alert, Field } from "../components/ui/index.js";
import { datetimeLocalToIso, isoToDatetimeLocal } from "./datetime-utils.js";

// Re-exported for existing imports/tests — canonical home is datetime-utils.
export { datetimeLocalToIso, isoToDatetimeLocal };

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
  /** Review deadline (datetime-local input value; "" = no deadline). */
  const [closesAtLocal, setClosesAtLocal] = useState("");
  /** Evaluator guidance shown in the queue banner (plain text). */
  const [instructions, setInstructions] = useState("");
  /** Hide speaker identities from evaluators (Wave 1B; server-side omit). */
  const [hideSpeakers, setHideSpeakers] = useState(false);
  const [roundStatus, setRoundStatus] = useState<"open" | "closed">("open");
  const [rubricReady, setRubricReady] = useState(false);

  const loadRubric = useCallback(async (eventId: string) => {
    setLoadError(null);
    setStatus(null);
    setRubricReady(false);
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
        setClosesAtLocal("");
        setInstructions("");
        setHideSpeakers(false);
        setRoundStatus("open");
        return;
      }
      const parsed = EvalRubricResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setLoadError("Unexpected rubric response");
        return;
      }
      setRoundId(parsed.data.round.id);
      setRoundName(parsed.data.round.name);
      setClosesAtLocal(isoToDatetimeLocal(parsed.data.round.closesAt));
      setInstructions(parsed.data.round.instructionsMd ?? "");
      setHideSpeakers(parsed.data.round.hideSpeakers === true);
      setRoundStatus(parsed.data.round.status);
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
    } finally {
      setRubricReady(true);
    }
  }, []);

  useEffect(() => {
    if (activeEventId) {
      void loadRubric(activeEventId);
    } else {
      setRubricReady(false);
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
        setStatus({ kind: "error", text: "Max score must be a positive number" });
        setSaving(false);
        return;
      }
      if (!(weight > 0) || Number.isNaN(weight)) {
        setStatus({ kind: "error", text: "Weight must be a positive number" });
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
            closesAt: datetimeLocalToIso(closesAtLocal),
            instructionsMd: instructions.trim() ? instructions : null,
            hideSpeakers,
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
      setClosesAtLocal(isoToDatetimeLocal(parsed.data.round.closesAt));
      setInstructions(parsed.data.round.instructionsMd ?? "");
      setHideSpeakers(parsed.data.round.hideSpeakers === true);
      setRoundStatus(parsed.data.round.status);
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

      {activeEventId && !rubricReady ? (
        <p className="eval-queue__muted" data-testid="rubric-loading">
          Loading rubric…
        </p>
      ) : null}

      {activeEventId && rubricReady ? (
        <section
          className="event-settings__card"
          data-testid="rubric-edit-section"
          data-ready="true"
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

            {/* Post-11.9 depth — review deadline + evaluator guidance.
                Titled sub-card so round-level knobs read as their own group
                (polish veto #6), consistent with the criteria card. */}
            <section
              className="rubric-settings__round-knobs"
              data-testid="rubric-round-knobs"
              aria-labelledby="rubric-round-settings-heading"
            >
              <h4
                id="rubric-round-settings-heading"
                className="rubric-settings__subheading"
              >
                Review round settings
              </h4>
              <Field
                id="rubric-closes-at"
                label="Review deadline"
                hint="Scoring locks after this moment — evaluators see it in their queue. Leave empty for no deadline."
                inputProps={{
                  type: "datetime-local",
                  value: closesAtLocal,
                  onChange: (ev) => setClosesAtLocal(ev.target.value),
                  "data-testid": "rubric-closes-at",
                }}
              />
              <Field
                id="rubric-instructions"
                as="textarea"
                label="Instructions for evaluators"
                hint="Shown above the queue. Plain text — links and formatting render as written."
                inputProps={{
                  rows: 4,
                  maxLength: 10_000,
                  value: instructions,
                  onChange: (ev) => setInstructions(ev.target.value),
                  "data-testid": "rubric-instructions",
                }}
              />
              {/* Wave 1B — hide speaker identities (server-side DTO omit) */}
              <div
                className="rubric-settings__toggle"
                data-testid="rubric-hide-speakers-row"
              >
                <label className="form-builder__check-row">
                  <input
                    type="checkbox"
                    className="lumen-focusable"
                    checked={hideSpeakers}
                    onChange={(ev) => setHideSpeakers(ev.target.checked)}
                    data-testid="rubric-hide-speakers"
                  />
                  <span>Hide speaker identities from evaluators</span>
                </label>
                <p className="l2-field__hint" id="rubric-hide-speakers-hint">
                  Removes the speaker roster from what evaluators see — names
                  and emails never leave the server. Titles and answers may
                  still reveal who wrote a proposal. Admin views are unchanged.
                </p>
              </div>
              {isEvalRoundClosed({
                status: roundStatus,
                closesAt: datetimeLocalToIso(closesAtLocal),
              }) ? (
                <Alert
                  tone="warn"
                  title="This round is closed for scoring"
                  data-testid="rubric-closed-note"
                >
                  The deadline has passed — evaluators can no longer save
                  scores or abstain. Move the deadline forward to reopen.
                </Alert>
              ) : null}
            </section>

            {criteria.map((c, index) => (
              <div
                key={c.localId}
                className="eval-queue__criterion rubric-settings__criterion"
                data-testid={`rubric-criterion-row-${index}`}
              >
                <Field
                  id={`rubric-name-${c.localId}`}
                  label={`Criterion ${index + 1} name`}
                  required
                  inputProps={{
                    value: c.name,
                    maxLength: 200,
                    onChange: (ev) =>
                      updateCriterion(c.localId, { name: ev.target.value }),
                    "data-testid": `rubric-criterion-name-${index}`,
                  }}
                />
                <div className="rubric-settings__criterion-nums">
                  <Field
                    id={`rubric-max-${c.localId}`}
                    label="Max score"
                    required
                    inputProps={{
                      type: "number",
                      min: 0.01,
                      step: "any",
                      value: c.maxScore,
                      onChange: (ev) =>
                        updateCriterion(c.localId, {
                          maxScore: ev.target.value,
                        }),
                      "data-testid": `rubric-criterion-max-${index}`,
                    }}
                  />
                  <Field
                    id={`rubric-weight-${c.localId}`}
                    label="Weight"
                    required
                    inputProps={{
                      type: "number",
                      min: 0.01,
                      step: "any",
                      value: c.weight,
                      onChange: (ev) =>
                        updateCriterion(c.localId, {
                          weight: ev.target.value,
                        }),
                      "data-testid": `rubric-criterion-weight-${index}`,
                    }}
                  />
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
