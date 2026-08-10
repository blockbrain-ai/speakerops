/**
 * Magic-link login — section 2.1 + 10.4 honest dogfood copy
 * + 11.7 session-expired recovery (S-L2-A11Y).
 *
 * POST /api/auth/magic-link { email, purpose }
 * If ?token= is present, POST /api/auth/exchange and redirect.
 *
 * Lumen tokens only (E6). Inventory: B01 admin login path · L2-02 session recovery.
 * Does **not** promise a public /dev outbox on dogfood (AUTH_DEV_OUTBOX is e2e-only).
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  type MagicLinkPurpose,
  RequestMagicLinkResponseSchema,
  ExchangeMagicLinkResponseSchema,
  ErrorEnvelopeSchema,
  DEFAULT_BOOTSTRAP_EVENT_ID,
} from "@speakerops/shared";
import { landingPathForPurpose } from "../auth/sessionLanding.js";
import { SessionExpiredPanel } from "../components/ui/SessionExpiredPanel.js";

type FormState = "idle" | "sending" | "sent" | "exchanging" | "error";

type LoginLocationState = {
  from?: string;
  sessionExpired?: boolean;
} | null;

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = (location.state as LoginLocationState) ?? null;
  const sessionExpired = Boolean(locationState?.sessionExpired);
  const returnFrom = locationState?.from;
  const tokenFromUrl = searchParams.get("token");
  const purposeParam = searchParams.get("purpose");
  const eventIdFromUrl = searchParams.get("eventId");
  const initialPurpose: MagicLinkPurpose =
    purposeParam === "speaker"
      ? "speaker"
      : purposeParam === "evaluator"
        ? "evaluator"
        : "admin";

  const [email, setEmail] = useState("");
  const [purpose, setPurpose] = useState<MagicLinkPurpose>(initialPurpose);
  const [state, setState] = useState<FormState>(
    tokenFromUrl ? "exchanging" : "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

  const exchangeToken = useCallback(
    async (token: string) => {
      setState("exchanging");
      setError(null);
      try {
        const res = await fetch("/api/auth/exchange", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ token }),
        });
        const raw: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          const env = ErrorEnvelopeSchema.safeParse(raw);
          setError(
            env.success
              ? env.data.error
              : "Invalid or expired magic link",
          );
          setState("error");
          return;
        }
        const parsed = ExchangeMagicLinkResponseSchema.safeParse(raw);
        if (!parsed.success) {
          setError("Unexpected exchange response");
          setState("error");
          return;
        }
        setSessionEmail(parsed.data.email);
        setState("idle");
        // Admin → shell; speaker → portal (eventId required for tasks); evaluator → queue
        const eventId =
          eventIdFromUrl && eventIdFromUrl.trim().length > 0
            ? eventIdFromUrl.trim()
            : DEFAULT_BOOTSTRAP_EVENT_ID;
        navigate(landingPathForPurpose(parsed.data.purpose, eventId), {
          replace: true,
        });
      } catch {
        setError("Network error during exchange");
        setState("error");
      }
    },
    [navigate, eventIdFromUrl],
  );

  useEffect(() => {
    if (tokenFromUrl) {
      void exchangeToken(tokenFromUrl);
    }
  }, [tokenFromUrl, exchangeToken]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: email.trim(),
          purpose,
          ...(eventIdFromUrl && eventIdFromUrl.trim().length > 0
            ? { eventId: eventIdFromUrl.trim() }
            : {}),
        }),
      });
      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setError(env.success ? env.data.error : "Request failed");
        setState("error");
        return;
      }
      const parsed = RequestMagicLinkResponseSchema.safeParse(raw);
      if (!parsed.success || !parsed.data.sent) {
        setError("Unexpected response");
        setState("error");
        return;
      }
      setState("sent");
    } catch {
      setError("Network error");
      setState("error");
    }
  }

  async function onLogout() {
    setError(null);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      setSessionEmail(null);
    } catch {
      setError("Logout failed");
    }
  }

  return (
    <div
      className="login-page"
      data-testid="login-page"
      data-section="11.7"
      data-session-expired={sessionExpired ? "true" : "false"}
    >
      <div className="login-card" data-testid="login-card">
        <p className="login-card__overline">SpeakerOps</p>
        <h1 className="login-card__title" data-testid="login-title">
          {sessionExpired ? "Sign in again" : "Sign in"}
        </h1>
        <p className="login-card__subtitle">
          Magic link — no password. We email a single-use link.
        </p>

        {sessionExpired ? (
          <SessionExpiredPanel
            from={returnFrom}
            data-testid="session-expired-panel"
          />
        ) : null}

        {tokenFromUrl && state === "exchanging" ? (
          <p data-testid="login-exchanging" className="login-card__status">
            Signing you in…
          </p>
        ) : null}

        {state === "sent" ? (
          <div
            className="login-card__status login-card__status--success"
            data-testid="login-sent"
            role="status"
          >
            If that address can receive mail, a magic link is on its way.
            Check your inbox — there is no in-product mail inbox or public
            outbox on dogfood.
          </div>
        ) : null}

        {error ? (
          <div
            className="login-card__status login-card__status--error"
            data-testid="login-error"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        {sessionEmail ? (
          <p className="login-card__status" data-testid="login-session-email">
            Signed in as {sessionEmail}
          </p>
        ) : null}

        {!tokenFromUrl || state === "error" || state === "idle" || state === "sent" ? (
          <form
            className="login-form"
            data-testid="login-form"
            onSubmit={onSubmit}
          >
            <label className="login-form__label" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              className="login-form__input lumen-focusable"
              data-testid="login-email"
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              disabled={state === "sending"}
            />

            <fieldset className="login-form__purpose">
              <legend className="login-form__label">Purpose</legend>
              <label className="login-form__radio">
                <input
                  type="radio"
                  name="purpose"
                  value="admin"
                  data-testid="login-purpose-admin"
                  checked={purpose === "admin"}
                  onChange={() => setPurpose("admin")}
                />
                Admin
              </label>
              <label className="login-form__radio">
                <input
                  type="radio"
                  name="purpose"
                  value="speaker"
                  data-testid="login-purpose-speaker"
                  checked={purpose === "speaker"}
                  onChange={() => setPurpose("speaker")}
                />
                Speaker
              </label>
              <label className="login-form__radio">
                <input
                  type="radio"
                  name="purpose"
                  value="evaluator"
                  data-testid="login-purpose-evaluator"
                  checked={purpose === "evaluator"}
                  onChange={() => setPurpose("evaluator")}
                />
                Evaluator
              </label>
            </fieldset>

            <button
              type="submit"
              className="login-form__submit lumen-focusable"
              data-testid="login-submit"
              disabled={state === "sending"}
            >
              {state === "sending" ? "Sending…" : "Email magic link"}
            </button>
          </form>
        ) : null}

        <div className="login-card__footer">
          <button
            type="button"
            className="login-form__logout lumen-focusable"
            data-testid="login-logout"
            onClick={() => void onLogout()}
          >
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}
