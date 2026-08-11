/**
 * Judge access — competition entry (`/judge`).
 *
 * Exchanges an access code (provided in the competition submission, never in
 * the repo) for a short-lived demo-role session on the shared demo event via
 * POST /api/auth/judge-access (B07). The route is live only on the demo
 * deployment (ROLE_SWITCHER_ENABLED=1 + JUDGE_ACCESS_CODE secret); elsewhere
 * the API 404s and this page explains that access is disabled.
 *
 * Security: code posted in the body (never a URL param); generic error copy;
 * sessions expire in ~4 hours; the role switcher chrome allows moving between
 * roles afterwards without re-entering the code.
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
  const [code, setCode] = useState("");
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
        body: JSON.stringify({ code, role }),
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
        setError("Invalid access code.");
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
        <h1 className="login-card__title">Judge access</h1>
        <p className="login-card__subtitle">
          Enter the access code from the competition submission to explore the
          seeded demo event in any role. Sessions last about 4 hours; data is
          shared between judges and reset periodically.
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
          <label className="login-form__label" htmlFor="judge-code">
            Access code
          </label>
          <input
            id="judge-code"
            type="password"
            autoComplete="off"
            required
            minLength={8}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            data-testid="judge-code"
            className="login-form__input lumen-focusable"
          />
          <button
            type="submit"
            disabled={busy || code.length < 8}
            data-testid="judge-submit"
            className="login-form__submit lumen-focusable"
          >
            {busy ? "Checking…" : "Enter demo"}
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
