/**
 * Speaker onboarding workflow — exclusive one-step-at-a-time UI.
 *
 * During onboarding the full profile form dump is hidden. Speakers can:
 * - Save draft (persist current value without requiring completion)
 * - Skip (defer; step returns after other open items)
 * - Continue (save + advance; completes linked task when appropriate)
 * - Finish later (pause wizard without showing every field)
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { OnboardingStep } from "./portal-utils.js";
import { taskDisplayStatus } from "./portal-utils.js";
import { PortalFileField } from "../../components/portal/PortalFileField.js";

export type OnboardingWizardProps = {
  steps: OnboardingStep[];
  stepIndex: number;
  skippedIds: readonly string[];
  freeformDrafts: Record<string, string>;
  speakerName: string;
  eventName: string;
  /** Optional dueAt for current step's linked task (overdue styling). */
  currentTaskDueAt?: string | null;
  currentTaskStatus?: string | null;
  /** Profile field drafts bound by parent (authoritative while editing). */
  bio: string;
  company: string;
  title: string;
  onBioChange: (v: string) => void;
  onCompanyChange: (v: string) => void;
  onTitleChange: (v: string) => void;
  onFreeformChange: (stepId: string, v: string) => void;
  headshotPreview: string | null;
  hasHeadshot: boolean;
  hasSlides: boolean;
  headshotStatus: string | null;
  slidesStatus: string | null;
  slidesFileName: string | null;
  fileBusyPurpose: null | "headshot" | "slides";
  saving: boolean;
  statusMessage: string | null;
  statusOk: boolean;
  onUploadHeadshot: (file: File) => void;
  onUploadSlides: (file: File) => void;
  onSaveDraft: () => void | Promise<void>;
  onContinue: () => void | Promise<void>;
  onSkip: () => void;
  onBack: () => void;
  onFinishLater: () => void;
  onJumpToStep: (index: number) => void;
};

function statusClass(ok: boolean): string {
  return ok
    ? "portal-status portal-status--ok"
    : "portal-status portal-status--error";
}

export function OnboardingWizard(props: OnboardingWizardProps) {
  const {
    steps,
    stepIndex,
    skippedIds,
    freeformDrafts,
    speakerName,
    eventName,
    currentTaskDueAt,
    currentTaskStatus,
    bio,
    company,
    title,
    onBioChange,
    onCompanyChange,
    onTitleChange,
    onFreeformChange,
    headshotPreview,
    hasHeadshot,
    hasSlides,
    headshotStatus,
    slidesStatus,
    slidesFileName,
    fileBusyPurpose,
    saving,
    statusMessage,
    statusOk,
    onUploadHeadshot,
    onUploadSlides,
    onSaveDraft,
    onContinue,
    onSkip,
    onBack,
    onFinishLater,
    onJumpToStep,
  } = props;

  const step = steps[stepIndex] ?? null;
  const total = steps.length;
  const doneCount = steps.filter((s) => s.done).length;
  const percent =
    total === 0 ? 100 : Math.round((doneCount / total) * 100);
  const skippedSet = useMemo(() => new Set(skippedIds), [skippedIds]);

  const freeform = step ? (freeformDrafts[step.id] ?? "") : "";
  const [confirmChecked, setConfirmChecked] = useState(false);

  useEffect(() => {
    setConfirmChecked(false);
  }, [step?.id]);

  if (!step) {
    return (
      <section
        className="portal-card portal-wizard"
        data-testid="portal-onboarding-wizard"
        data-wizard-empty="true"
      >
        <p className="portal-muted">No onboarding steps remaining.</p>
      </section>
    );
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void onContinue();
  }

  return (
    <section
      className="portal-card portal-wizard"
      data-testid="portal-onboarding-wizard"
      data-step-id={step.id}
      data-step-kind={step.kind}
      data-step-index={stepIndex}
      aria-label="Speaker onboarding"
    >
      <header className="portal-wizard__header">
        <p className="portal-wizard__eyebrow" data-testid="portal-wizard-eyebrow">
          {eventName}
        </p>
        <h1 className="portal-wizard__title" data-testid="portal-wizard-title">
          Set up your speaker profile
        </h1>
        <p className="portal-muted" data-testid="portal-wizard-greeting">
          Hi {speakerName} — one step at a time. You can skip and come back, or
          save a draft anytime.
        </p>
      </header>

      <div
        className="portal-wizard__progress"
        data-testid="portal-wizard-progress"
      >
        <div className="portal-wizard__progress-meta">
          <span data-testid="portal-wizard-step-count">
            Step {Math.min(stepIndex + 1, total)} of {total}
          </span>
          <span data-testid="portal-wizard-percent">{percent}% complete</span>
        </div>
        <div
          className="portal-progress__track"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Onboarding progress"
          data-testid="portal-wizard-progress-bar"
        >
          <div
            className="portal-progress__fill"
            style={{ width: `${percent}%` }}
          />
        </div>
        <ol
          className="portal-wizard__dots"
          data-testid="portal-wizard-dots"
          aria-label="Steps"
        >
          {steps.map((s, i) => {
            const skipped = skippedSet.has(s.id) && !s.done;
            const cls = [
              "portal-wizard__dot",
              s.done ? "portal-wizard__dot--done" : "",
              i === stepIndex ? "portal-wizard__dot--current" : "",
              skipped ? "portal-wizard__dot--skipped" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className={cls}
                  data-testid={`portal-wizard-dot-${i}`}
                  data-step-id={s.id}
                  data-done={s.done ? "true" : "false"}
                  data-skipped={skipped ? "true" : "false"}
                  aria-label={`${s.label}${s.done ? " (done)" : skipped ? " (skipped)" : ""}${i === stepIndex ? " (current)" : ""}`}
                  aria-current={i === stepIndex ? "step" : undefined}
                  onClick={() => onJumpToStep(i)}
                  title={s.label}
                />
              </li>
            );
          })}
        </ol>
      </div>

      <form
        className="portal-wizard__body"
        data-testid="portal-wizard-step"
        onSubmit={handleSubmit}
      >
        <p className="portal-next-kicker" data-testid="portal-wizard-kicker">
          {step.done ? "Review" : skippedSet.has(step.id) ? "Skipped — return to this" : "Current step"}
        </p>
        <h2
          className="portal-heading portal-heading--next"
          data-testid="portal-wizard-step-label"
        >
          {step.label}
        </h2>
        <p className="portal-field-why" data-testid="portal-wizard-step-why">
          {step.why}
        </p>
        {step.taskTitle && step.taskTitle !== step.label ? (
          <p className="portal-muted" data-testid="portal-wizard-task-title">
            Organiser task: {step.taskTitle}
          </p>
        ) : null}
        {step.taskId && (currentTaskStatus || currentTaskDueAt) ? (
          <div className="portal-row" data-testid="portal-wizard-task-meta">
            <span
              className={
                taskDisplayStatus({
                  status: currentTaskStatus ?? "pending",
                  dueAt: currentTaskDueAt ?? null,
                }) === "overdue"
                  ? "portal-status-chip lumen-status lumen-status--danger"
                  : "portal-status-chip lumen-status lumen-status--warn"
              }
              data-testid="portal-wizard-task-status"
              data-status={taskDisplayStatus({
                status: currentTaskStatus ?? "pending",
                dueAt: currentTaskDueAt ?? null,
              })}
            >
              {taskDisplayStatus({
                status: currentTaskStatus ?? "pending",
                dueAt: currentTaskDueAt ?? null,
              })}
            </span>
            {currentTaskDueAt ? (
              <span className="portal-muted" data-testid="portal-wizard-task-due">
                Due {new Date(currentTaskDueAt).toLocaleDateString()}
              </span>
            ) : null}
          </div>
        ) : null}

        {step.kind === "bio" ? (
          <>
            <label className="portal-label" htmlFor="portal-bio">
              Bio
            </label>
            <textarea
              id="portal-bio"
              className="portal-textarea lumen-focusable"
              data-testid="portal-bio-input"
              value={bio}
              onChange={(ev) => onBioChange(ev.target.value)}
              maxLength={8000}
              rows={6}
              placeholder="Short bio for the programme (plain text only)"
              autoFocus
            />
            <p className="portal-muted" data-testid="portal-bio-preview">
              Preview: {bio || "—"}
            </p>
          </>
        ) : null}

        {step.kind === "company" ? (
          <>
            <label className="portal-label" htmlFor="portal-company">
              Company
            </label>
            <input
              id="portal-company"
              className="portal-input lumen-focusable"
              data-testid="portal-company-input"
              value={company}
              onChange={(ev) => onCompanyChange(ev.target.value)}
              maxLength={200}
              autoFocus
            />
          </>
        ) : null}

        {step.kind === "title" ? (
          <>
            <label className="portal-label" htmlFor="portal-title">
              Title
            </label>
            <input
              id="portal-title"
              className="portal-input lumen-focusable"
              data-testid="portal-title-input"
              value={title}
              onChange={(ev) => onTitleChange(ev.target.value)}
              maxLength={200}
              autoFocus
            />
          </>
        ) : null}

        {step.kind === "headshot" ? (
          <PortalFileField
            fieldTestId="portal-headshot"
            inputTestId="portal-headshot-input"
            chooseTestId="portal-headshot-choose"
            statusTestId="portal-headshot-status"
            previewTestId="portal-headshot-preview"
            title="Headshot"
            hint="JPEG or PNG · max 10 MiB · public portrait for the programme"
            privacyNote="Shown on the public programme listing. Replace anytime."
            accept="image/jpeg,image/png"
            disabled={false}
            disabledReason={null}
            busy={fileBusyPurpose === "headshot"}
            status={headshotStatus}
            previewUrl={headshotPreview}
            hasFile={hasHeadshot}
            onFile={(f) => onUploadHeadshot(f)}
          />
        ) : null}

        {step.kind === "slides" ? (
          <PortalFileField
            fieldTestId="portal-slides"
            inputTestId="portal-slides-input"
            chooseTestId="portal-slides-choose"
            statusTestId="portal-slides-status"
            title="Slides"
            hint="PDF only · max 10 MiB · private to organisers"
            privacyNote="Private to organisers — not published on the public CFP."
            accept="application/pdf"
            disabled={false}
            disabledReason={null}
            busy={fileBusyPurpose === "slides"}
            status={
              slidesStatus ??
              (slidesFileName ? `On file: ${slidesFileName}` : null)
            }
            hasFile={hasSlides}
            onFile={(f) => onUploadSlides(f)}
          />
        ) : null}

        {step.kind === "task_text" ? (
          <>
            <label className="portal-label" htmlFor="portal-wizard-freeform">
              Your response
            </label>
            <textarea
              id="portal-wizard-freeform"
              className="portal-textarea lumen-focusable"
              data-testid="portal-wizard-freeform"
              value={freeform}
              onChange={(ev) => onFreeformChange(step.id, ev.target.value)}
              maxLength={8000}
              rows={5}
              placeholder="Write a draft answer — you can save and finish later"
              autoFocus
            />
            <p className="portal-muted">
              Saved as a draft on this device until you mark this step complete.
            </p>
          </>
        ) : null}

        {step.kind === "task_confirm" ? (
          <label
            className="portal-wizard__confirm"
            data-testid="portal-wizard-confirm"
          >
            <input
              type="checkbox"
              className="lumen-focusable"
              data-testid="portal-wizard-confirm-check"
              checked={confirmChecked}
              onChange={(ev) => setConfirmChecked(ev.target.checked)}
            />
            <span>
              I confirm this item
              {step.taskTitle ? ` — ${step.taskTitle}` : ""}.
            </span>
          </label>
        ) : null}

        {statusMessage ? (
          <p
            className={statusClass(statusOk)}
            data-testid="portal-bio-status"
            role="status"
          >
            {statusMessage}
          </p>
        ) : null}

        <div className="portal-wizard__actions" data-testid="portal-wizard-actions">
          <button
            type="button"
            className="portal-btn portal-btn--secondary lumen-focusable"
            data-testid="portal-wizard-back"
            disabled={stepIndex <= 0 || saving}
            onClick={onBack}
          >
            Back
          </button>
          <button
            type="button"
            className="portal-btn portal-btn--secondary lumen-focusable"
            data-testid="portal-wizard-skip"
            disabled={saving || step.done}
            onClick={onSkip}
          >
            Skip for now
          </button>
          <button
            type="button"
            className="portal-btn portal-btn--secondary lumen-focusable"
            data-testid="portal-wizard-save-draft"
            disabled={saving}
            onClick={() => void onSaveDraft()}
          >
            {saving ? "Saving…" : "Save draft"}
          </button>
          <button
            type="submit"
            className="portal-btn portal-btn--dominant lumen-focusable"
            data-testid="portal-wizard-continue"
            disabled={
              saving ||
              fileBusyPurpose !== null ||
              (step.kind === "task_confirm" && !confirmChecked && !step.done)
            }
          >
            {saving
              ? "Saving…"
              : step.done
                ? "Next"
                : stepIndex >= total - 1
                  ? "Finish"
                  : "Continue"}
          </button>
        </div>

        <button
          type="button"
          className="portal-wizard__finish-later lumen-focusable"
          data-testid="portal-wizard-finish-later"
          disabled={saving}
          onClick={onFinishLater}
        >
          Save &amp; finish later
        </button>
      </form>
    </section>
  );
}

/** Compact resume card when speaker paused onboarding (no full form dump). */
export function OnboardingPausedCard(props: {
  speakerName: string;
  eventName: string;
  percent: number;
  done: number;
  total: number;
  skippedCount: number;
  onContinue: () => void;
}) {
  return (
    <section
      className="portal-card portal-wizard portal-wizard--paused"
      data-testid="portal-onboarding-paused"
    >
      <p className="portal-next-kicker">Draft saved</p>
      <h2 className="portal-heading portal-heading--next">
        Continue when you are ready
      </h2>
      <p className="portal-muted" data-testid="portal-paused-summary">
        Hi {props.speakerName} — your progress on {props.eventName} is saved.
        You completed {props.done} of {props.total} steps
        {props.skippedCount > 0
          ? ` (${props.skippedCount} skipped — you will return to them)`
          : ""}
        .
      </p>
      <div
        className="portal-progress__track"
        role="progressbar"
        aria-valuenow={props.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        data-testid="portal-paused-progress"
      >
        <div
          className="portal-progress__fill"
          style={{ width: `${props.percent}%` }}
        />
      </div>
      <button
        type="button"
        className="portal-btn portal-btn--dominant lumen-focusable"
        data-testid="portal-wizard-resume"
        onClick={props.onContinue}
      >
        Continue setup
      </button>
    </section>
  );
}
