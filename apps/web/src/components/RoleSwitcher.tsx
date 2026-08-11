/**
 * Section 8.4 — Dogfood/dev role switcher for judges.
 *
 * Visible only when the SPA flag is on:
 *   - import.meta.env.DEV (local Vite), OR
 *   - VITE_ROLE_SWITCHER === "1" (explicit dogfood build)
 *
 * Calls POST /api/auth/dev/role-switch (server route also flag-gated).
 * Does not weaken server authz — issues a real session for seeded demo users.
 *
 * Inventory: supports L05 via demo seed accounts; no separate inv row.
 */
import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DevRoleSwitchResponseSchema,
  ErrorEnvelopeSchema,
  type EventRole,
  DEMO_ROLE_EMAILS,
} from "@speakerops/shared";

const ROLES: readonly EventRole[] = ["admin", "evaluator", "speaker"] as const;

/**
 * True when the dogfood/dev role switcher chrome may render.
 * Production builds require explicit VITE_ROLE_SWITCHER=1.
 */
export function isRoleSwitcherEnabled(): boolean {
  try {
    // Vite injects import.meta.env at build time
    const env = import.meta.env as {
      DEV?: boolean;
      VITE_ROLE_SWITCHER?: string;
      MODE?: string;
    };
    if (env.VITE_ROLE_SWITCHER === "1") return true;
    if (env.DEV === true) return true;
    return false;
  } catch {
    return false;
  }
}

export type RoleSwitcherProps = {
  /** Override enable check (unit tests). */
  forceEnabled?: boolean;
  /** Active event id for membership check (optional). */
  eventId?: string | null;
};

export function RoleSwitcher({
  forceEnabled,
  eventId,
}: RoleSwitcherProps) {
  const navigate = useNavigate();
  const enabled = forceEnabled === true || isRoleSwitcherEnabled();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentRole, setCurrentRole] = useState<EventRole | "">("");

  const onSwitch = useCallback(
    async (role: EventRole) => {
      setBusy(true);
      setError(null);
      try {
        const body: { role: EventRole; eventId?: string } = { role };
        if (eventId) body.eventId = eventId;
        const res = await fetch("/api/auth/dev/role-switch", {
          method: "POST",
          credentials: "include",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        });
        if (res.status === 404) {
          setError("Role switcher API disabled");
          return;
        }
        if (!res.ok) {
          const raw: unknown = await res.json().catch(() => null);
          const env = ErrorEnvelopeSchema.safeParse(raw);
          setError(env.success ? env.data.error : `Switch failed (${res.status})`);
          return;
        }
        const raw: unknown = await res.json();
        const parsed = DevRoleSwitchResponseSchema.safeParse(raw);
        if (!parsed.success) {
          setError("Unexpected role-switch response");
          return;
        }
        setCurrentRole(parsed.data.role);
        navigate(parsed.data.redirectTo, { replace: true });
        // Full reload so RequireRole re-probes the new session cookie
        window.location.assign(parsed.data.redirectTo);
      } catch {
        setError("Network error");
      } finally {
        setBusy(false);
      }
    },
    [eventId, navigate],
  );

  if (!enabled) {
    return null;
  }

  return (
    <div
      className="role-switcher"
      data-testid="role-switcher"
      data-section="8.4"
      role="region"
      aria-label="Dogfood role switcher"
    >
      <label className="role-switcher__label">
        <span className="role-switcher__label-text">Role</span>
        <select
          className="role-switcher__select lumen-focusable"
          data-testid="role-switcher-select"
          disabled={busy}
          value={currentRole}
          aria-label="Switch demo role"
          onChange={(e) => {
            const v = e.target.value as EventRole | "";
            if (!v) return;
            void onSwitch(v);
          }}
        >
          <option value="" disabled>
            Switch role…
          </option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r} ({DEMO_ROLE_EMAILS[r]})
            </option>
          ))}
        </select>
      </label>
      {error ? (
        <p
          className="role-switcher__error"
          data-testid="role-switcher-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <span
        className="role-switcher__badge"
        data-testid="role-switcher-badge"
        title="Shared demo — data is shared between reviewers and reset periodically; API keys created here expire after 4 hours"
      >
        Shared demo
      </span>
    </div>
  );
}
