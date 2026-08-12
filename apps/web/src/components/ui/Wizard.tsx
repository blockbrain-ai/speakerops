/**
 * D1 Wizard — exclusive step composition (Comms campaign and similar flows).
 * Only the active step's children mount. Forward jumps require prior steps valid.
 */
import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";
import { Button } from "./Button.js";

export type WizardStep = {
  id: string;
  label: string;
  /** Whether this step's own inputs are complete enough to leave it. */
  valid: boolean;
};

export type WizardProps = {
  steps: WizardStep[];
  activeId: string;
  onStepChange: (id: string) => void;
  /** Content for the active step only (parent switches on activeId). */
  children: ReactNode;
  /**
   * data-testid for step nav buttons. Default: `wizard-step-nav-${id}`.
   * Comms passes `(id) => \`comms-step-nav-${id}\``.
   */
  stepNavTestId?: (id: string) => string;
  /** When false, hide the shared Back/Next chrome (step provides its own). */
  showChrome?: boolean;
  className?: string;
  "data-testid"?: string;
};

/** True when every step before `targetId` is valid (target itself unchecked). */
export function canActivateWizardStep(
  steps: readonly WizardStep[],
  targetId: string,
): boolean {
  const idx = steps.findIndex((s) => s.id === targetId);
  if (idx < 0) return false;
  for (let i = 0; i < idx; i++) {
    if (!steps[i]!.valid) return false;
  }
  return true;
}

export function Wizard({
  steps,
  activeId,
  onStepChange,
  children,
  stepNavTestId = (id) => `wizard-step-nav-${id}`,
  showChrome = true,
  className = "",
  "data-testid": testId = "wizard",
}: WizardProps) {
  const headingId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const activeIdx = Math.max(
    0,
    steps.findIndex((s) => s.id === activeId),
  );
  const active = steps[activeIdx] ?? steps[0];
  const isFirst = activeIdx <= 0;
  const isLast = activeIdx >= steps.length - 1;
  const canNext = Boolean(active?.valid) && !isLast;

  // Move focus to the step panel heading region when the step changes.
  useEffect(() => {
    const root = panelRef.current;
    if (!root) return;
    const heading = root.querySelector<HTMLElement>(
      "h2,h3,[data-wizard-heading]",
    );
    if (heading) {
      if (!heading.hasAttribute("tabindex")) {
        heading.setAttribute("tabindex", "-1");
      }
      heading.focus({ preventScroll: true });
    } else {
      root.focus({ preventScroll: true });
    }
  }, [activeId]);

  function tryActivate(id: string) {
    if (id === activeId) return;
    if (!canActivateWizardStep(steps, id)) return;
    onStepChange(id);
  }

  function goBack() {
    if (isFirst) return;
    const prev = steps[activeIdx - 1];
    if (prev) onStepChange(prev.id);
  }

  function goNext() {
    if (!canNext) return;
    const next = steps[activeIdx + 1];
    if (next) onStepChange(next.id);
  }

  return (
    <div
      className={["l2-wizard", className].filter(Boolean).join(" ")}
      data-testid={testId}
      data-active-step={active?.id ?? ""}
    >
      <nav
        className="comms-campaign__steps l2-wizard__steps"
        aria-label="Wizard steps"
        data-testid={`${testId}-steps`}
      >
        {steps.map((step, i) => {
          const reachable = canActivateWizardStep(steps, step.id);
          const isActive = step.id === activeId;
          return (
            <button
              key={step.id}
              type="button"
              className={
                isActive
                  ? "comms-campaign__step is-active lumen-focusable"
                  : "comms-campaign__step lumen-focusable"
              }
              data-testid={stepNavTestId(step.id)}
              data-step={step.id}
              data-valid={step.valid ? "true" : "false"}
              data-reachable={reachable ? "true" : "false"}
              aria-current={isActive ? "step" : undefined}
              aria-disabled={!reachable && !isActive ? true : undefined}
              disabled={!reachable && !isActive}
              onClick={() => tryActivate(step.id)}
            >
              <span className="comms-campaign__step-index" aria-hidden="true">
                {i + 1}
              </span>
              <span className="comms-campaign__step-label">{step.label}</span>
            </button>
          );
        })}
      </nav>

      <div
        ref={panelRef}
        className="l2-wizard__panel"
        data-testid={`${testId}-panel`}
        tabIndex={-1}
        aria-labelledby={headingId}
      >
        <span id={headingId} className="sr-only">
          Step: {active?.label ?? ""}
        </span>
        {children}
      </div>

      {showChrome ? (
        <div
          className="comms-campaign__step-footer l2-wizard__chrome"
          data-testid={`${testId}-chrome`}
        >
          <Button
            type="button"
            variant="secondary"
            data-testid="comms-wizard-back"
            disabled={isFirst}
            onClick={goBack}
          >
            Back
          </Button>
          {!isLast ? (
            <Button
              type="button"
              variant="primary"
              data-testid="comms-wizard-next"
              disabled={!canNext}
              onClick={goNext}
            >
              Next
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
