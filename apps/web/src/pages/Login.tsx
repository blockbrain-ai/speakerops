/**
 * Magic-link login — section 2.1 + 11.7 session recovery + role-lifecycle UX.
 *
 * Invite links may carry purpose/eventId. Generic login is email-first;
 * purpose radios are advanced/demo only (not primary customer path).
 *
 * Inventory: B01 admin login path · L2-02 session recovery.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  type MagicLinkPurpose,
  type AuthMembershipOption,
  RequestMagicLinkResponseSchema,
  ExchangeMagicLinkResponseSchema,
  ErrorEnvelopeSchema,
} from "@speakerops/shared";
import { landingPathForPurpose } from "../auth/sessionLanding.js";
import { pathForMembership } from "../layout/RoleShell.js";
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
  const invitePurpose: MagicLinkPurpose | null =
    purposeParam === "speaker" ||
    purposeParam === "evaluator" ||
    purposeParam === "admin"
      ? purposeParam
      : null;
  const showPurposeRadios =
    searchParams.get("demo") === "1" || Boolean(invitePurpose);

  const [email, setEmail] = useState("");
  const [purpose, setPurpose] = useState<MagicLinkPurpose>(
    invitePurpose ?? "speaker",
  );
  const [state, setState] = useState<FormState>(
    tokenFromUrl ? "exchanging" : "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [chooser, setChooser] = useState<AuthMembershipOption[] | null>(null);

  // Hydrate existing session so "Continue as" / sign-out appear when already signed in.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", {
          credentials: "include",
          headers: { accept: "application/json" },
        });
        if (!res.ok || cancelled) return;
        const raw = (await res.json()) as { email?: string };
        if (raw.email && !cancelled) setSessionEmail(raw.email);
      } catch {
        /* optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const resolveLanding = useCallback(
    (opts: {
      purpose: MagicLinkPurpose;
      eventId?: string | null;
      memberships: AuthMembershipOption[];
    }) => {
      if (returnFrom && returnFrom.startsWith("/")) {
        return returnFrom;
      }
      const memberships = opts.memberships ?? [];
      const preferredEvent =
        (opts.eventId && opts.eventId.trim()) ||
        (eventIdFromUrl && eventIdFromUrl.trim()) ||
        null;

      if (preferredEvent) {
        const match = memberships.find(
          (m) =>
            m.eventId === preferredEvent &&
            (m.role === opts.purpose || opts.purpose === "admin"),
        );
        if (match) return pathForMembership(match);
        if (opts.purpose === "admin") return "/admin";
        return landingPathForPurpose(opts.purpose, preferredEvent);
      }

      if (memberships.length === 1) {
        return pathForMembership(memberships[0]!);
      }
      if (memberships.length > 1) {
        return null; // chooser
      }
      // No memberships: land by purpose without inventing dogfood event for customers
      if (opts.purpose === "admin") return "/admin";
      if (opts.purpose === "evaluator") return "/eval";
      return "/portal";
    },
    [eventIdFromUrl, returnFrom],
  );

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
              : "This link is invalid or has expired. Request a new one below.",
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
        const memberships = parsed.data.memberships ?? [];
        const dest = resolveLanding({
          purpose: parsed.data.purpose,
          eventId: parsed.data.eventId ?? eventIdFromUrl,
          memberships,
        });
        if (dest == null) {
          setChooser(memberships);
          setState("idle");
          return;
        }
        setState("idle");
        navigate(dest, { replace: true });
      } catch {
        setError("Network error during exchange");
        setState("error");
      }
    },
    [navigate, eventIdFromUrl, resolveLanding],
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
          // Invite/demo purpose when present; otherwise omit purpose so the
          // server does not grant/clobber memberships (membership-aware login).
          ...(showPurposeRadios || invitePurpose
            ? { purpose }
            : {}),
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
            If that address is registered, a one-time sign-in link is on its
            way to <strong>{email.trim() || "your email"}</strong>. Links
            expire in about 30 minutes and can only be used once.
          </div>
        ) : null}

        {chooser && chooser.length > 1 ? (
          <div
            className="login-card__chooser"
            data-testid="login-membership-chooser"
          >
            <p className="login-form__label">Choose a programme</p>
            <ul className="login-chooser-list">
              {chooser.map((m) => (
                <li key={`${m.eventId}-${m.role}`}>
                  <button
                    type="button"
                    className="login-form__submit lumen-focusable"
                    data-testid={`login-membership-${m.role}-${m.eventId}`}
                    onClick={() =>
                      navigate(pathForMembership(m), { replace: true })
                    }
                  >
                    {m.eventName} · {m.role}
                  </button>
                </li>
              ))}
            </ul>
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

            {showPurposeRadios ? (
              <fieldset className="login-form__purpose">
                <legend className="login-form__label">
                  {invitePurpose
                    ? "Continuing as"
                    : "Demo role (internal)"}
                </legend>
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
            ) : (
              <p className="login-card__hint" data-testid="login-email-first-hint">
                Use the email from your invitation. We&apos;ll open the right
                programme after you sign in.
              </p>
            )}

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

        {sessionEmail ? (
          <div className="login-card__footer">
            <button
              type="button"
              className="login-form__logout lumen-focusable"
              data-testid="login-logout"
              onClick={() => void onLogout()}
            >
              Sign out
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
