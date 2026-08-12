/**
 * Judge access — competition entry (`/judge`).
 *
 * Open demo: pick a role and enter. POST /api/auth/judge-access (B07) mints a
 * 4-hour demo-persona session on the seeded event. The route is live when
 * ROLE_SWITCHER_ENABLED=1; elsewhere the API 404s and this page explains that.
 *
 * No access code. Rate-limited on the Worker. Role switcher chrome then
 * moves between roles without leaving the demo session.
 */
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { BrandLockup } from "../components/ui/BrandMark.js";
import {
  JudgeAccessResponseSchema,
  type EventRole,
} from "@speakerops/shared";

const ROLES: { value: EventRole; label: string; blurb: string }[] = [
  {
    value: "admin",
    label: "Program admin",
    blurb: "Forms, submissions, decisions, schedule, comms, readiness",
  },
  {
    value: "evaluator",
    label: "Evaluator",
    blurb: "Assigned queue, proposal panel, rubric scoring",
  },
  {
    value: "speaker",
    label: "Speaker",
    blurb: "Portal onboarding, profile, tasks, sessions",
  },
];

export default function JudgeAccessPage() {
  const navigate = useNavigate();
  const [role, setRole] = useState<EventRole>("admin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/judge-access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (res.status === 404) {
        setError(
          "Judge access is not enabled on this deployment. Use the deployed demo URL from the submission.",
        );
        return;
      }
      if (res.status === 429) {
        setError("Too many attempts — wait a few minutes and try again.");
        return;
      }
      if (!res.ok) {
        setError("Could not enter the demo — try again.");
        return;
      }
      const parsed = JudgeAccessResponseSchema.safeParse(await res.json());
      if (!parsed.success) {
        setError("Unexpected response — try again.");
        return;
      }
      navigate(parsed.data.redirectTo, { replace: true });
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page" data-testid="judge-page">
      <div className="login-card">
        {/* F1 — Signal mark + wordmark lockup */}
        <div className="login-card__brand">
          <BrandLockup size={24} />
        </div>
        <p className="login-card__overline">SpeakerOps · shared demo</p>
        <h1 className="login-card__title">Enter the demo</h1>
        <p className="login-card__subtitle">
          Pick a role and explore the seeded AI Engineer event. No access
          code. Sessions last about 4 hours; data is shared and reset
          periodically. Use the role switcher in the top bar to change seats.
        </p>
        <form onSubmit={onSubmit} className="login-form" data-testid="judge-form">
          <fieldset className="login-form__purpose" disabled={busy}>
            <legend className="login-form__label">Explore as</legend>
            {ROLES.map((r) => (
              <label key={r.value} className="login-form__radio">
                <input
                  type="radio"
                  name="judge-role"
                  value={r.value}
                  checked={role === r.value}
                  onChange={() => setRole(r.value)}
                  data-testid={`judge-role-${r.value}`}
                />
                <span>
                  <strong>{r.label}</strong>
                  <br />
                  <small>{r.blurb}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <button
            type="submit"
            disabled={busy}
            data-testid="judge-submit"
            className="login-form__submit lumen-focusable"
          >
            {busy ? "Entering…" : "Enter demo"}
          </button>
          {error ? (
            <p role="alert" className="login-card__status login-card__status--error" data-testid="judge-error">
              {error}
            </p>
          ) : null}
        </form>
      </div>
    </div>
  );
}
