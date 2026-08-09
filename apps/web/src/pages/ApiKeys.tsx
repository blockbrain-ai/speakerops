/**
 * API Keys admin UI (section 7.1 / S-CLI) + 11.7 state polish (S-L2-A11Y).
 *
 * Inventory:
 * - K01 create key with subset of scopes; secret shown once
 * - K02 revoke key
 * - K03 copy prefix only after dismiss secret
 * - K04 non-admin cannot open keys (RequireRole + server 403)
 *
 * Wired to real Keys.List / Keys.Create / Keys.Revoke APIs.
 * Secret is held in component state only until dismissed — never re-fetched.
 * Session 401 → navigate to login recovery (never auth alert inside shell).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  API_SCOPES,
  DEFAULT_DENY_SCOPE_SET,
  SAFE_DEFAULT_SCOPES,
  KeysListResponseSchema,
  KeysCreateResponseSchema,
  KeysRevokeResponseSchema,
  type ApiKeyDto,
  type ApiScope,
  type KeysCreateResponse,
} from "@speakerops/shared";
import { useEventContext } from "../events/EventContext.js";
import {
  EmptyState,
  LoadingState,
  NetworkErrorState,
  PermissionDeniedState,
} from "../components/ui/index.js";

type StatusMsg = { kind: "ok" | "error"; text: string } | null;

export function ApiKeysPage() {
  const { activeEventId } = useEventContext();
  const navigate = useNavigate();
  const location = useLocation();
  const [keys, setKeys] = useState<ApiKeyDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const [name, setName] = useState("");
  /** Multiselect: safe scopes start unchecked; default-deny opt-in. */
  const [selectedScopes, setSelectedScopes] = useState<Set<ApiScope>>(
    () => new Set(),
  );
  const [creating, setCreating] = useState(false);
  const [createStatus, setCreateStatus] = useState<StatusMsg>(null);

  /** One-time secret reveal (K01 / K03) — cleared on dismiss. */
  const [revealed, setRevealed] = useState<KeysCreateResponse | null>(null);
  const [secretDismissed, setSecretDismissed] = useState(false);

  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeStatus, setRevokeStatus] = useState<StatusMsg>(null);

  const loadKeys = useCallback(async () => {
    setLoadError(null);
    setPermissionDenied(false);
    setLoading(true);
    try {
      const res = await fetch("/api/keys", {
        credentials: "include",
        headers: { accept: "application/json" },
      });
      if (res.status === 401) {
        // Fail closed: focused recovery on login, not auth alert in shell.
        setKeys([]);
        setLoading(false);
        navigate("/login", {
          replace: true,
          state: {
            sessionExpired: true,
            from: location.pathname,
          },
        });
        return;
      }
      if (res.status === 403) {
        setPermissionDenied(true);
        setKeys([]);
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setLoadError(`Failed to load keys (${res.status})`);
        setKeys([]);
        setLoading(false);
        return;
      }
      const raw: unknown = await res.json();
      const parsed = KeysListResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setLoadError("Invalid keys response");
        setLoading(false);
        return;
      }
      // Defense: never accept secret/hash fields if a buggy server sends them
      for (const k of parsed.data.keys) {
        const rec = k as ApiKeyDto & { secret?: unknown; keyHash?: unknown };
        if (rec.secret !== undefined || rec.keyHash !== undefined) {
          setLoadError("Server returned secret material — refused");
          setKeys([]);
          setLoading(false);
          return;
        }
      }
      setKeys(parsed.data.keys);
      setLoading(false);
    } catch {
      setLoadError("Network error loading keys");
      setKeys([]);
      setLoading(false);
    }
  }, [navigate, location.pathname]);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  const activeKeys = useMemo(
    () => keys.filter((k) => !k.revokedAt),
    [keys],
  );
  const revokedKeys = useMemo(
    () => keys.filter((k) => !!k.revokedAt),
    [keys],
  );

  function toggleScope(scope: ApiScope) {
    setSelectedScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateStatus(null);
    setRevealed(null);
    setSecretDismissed(false);

    const scopes = [...selectedScopes];
    if (!name.trim() || scopes.length === 0) {
      setCreateStatus({
        kind: "error",
        text: "Name and at least one scope are required",
      });
      setCreating(false);
      return;
    }

    if (!activeEventId) {
      setCreateStatus({
        kind: "error",
        text: "Select an event before creating an API key",
      });
      setCreating(false);
      return;
    }

    try {
      // Always bind to the active event — session admins cannot mint unscoped
      // org-wide keys, and multi-event admins must supply eventId (7.1).
      const res = await fetch("/api/keys", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          name: name.trim(),
          scopes,
          eventId: activeEventId,
        }),
      });
      const raw: unknown = await res.json();
      if (!res.ok) {
        const err = raw as { error?: string };
        setCreateStatus({
          kind: "error",
          text: err.error ?? `Create failed (${res.status})`,
        });
        setCreating(false);
        return;
      }
      const parsed = KeysCreateResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setCreateStatus({ kind: "error", text: "Invalid create response" });
        setCreating(false);
        return;
      }
      setRevealed(parsed.data);
      setName("");
      setSelectedScopes(new Set());
      setCreateStatus({
        kind: "ok",
        text: "Key created — copy the secret now; it will not be shown again",
      });
      await loadKeys();
    } catch {
      setCreateStatus({ kind: "error", text: "Network error creating key" });
    } finally {
      setCreating(false);
    }
  }

  function dismissSecret() {
    setRevealed(null);
    setSecretDismissed(true);
  }

  async function onRevoke(keyId: string) {
    setRevokingId(keyId);
    setRevokeStatus(null);
    try {
      const res = await fetch(`/api/keys/${encodeURIComponent(keyId)}`, {
        method: "DELETE",
        credentials: "include",
        headers: { accept: "application/json" },
      });
      const raw: unknown = await res.json();
      if (!res.ok) {
        const err = raw as { error?: string };
        setRevokeStatus({
          kind: "error",
          text: err.error ?? `Revoke failed (${res.status})`,
        });
        setRevokingId(null);
        return;
      }
      const parsed = KeysRevokeResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setRevokeStatus({ kind: "error", text: "Invalid revoke response" });
        setRevokingId(null);
        return;
      }
      setRevokeStatus({ kind: "ok", text: "Key revoked" });
      // Clear secret banner if it was for this key
      if (revealed?.id === keyId) {
        setRevealed(null);
        setSecretDismissed(true);
      }
      await loadKeys();
    } catch {
      setRevokeStatus({ kind: "error", text: "Network error revoking key" });
    } finally {
      setRevokingId(null);
    }
  }

  async function copyText(text: string, testId: string) {
    try {
      await navigator.clipboard.writeText(text);
      const el = document.querySelector(`[data-testid="${testId}"]`);
      if (el) el.setAttribute("data-copied", "true");
    } catch {
      // Clipboard may be denied in some e2e contexts; selection still works
    }
  }

  if (permissionDenied) {
    return (
      <div
        className="api-keys"
        data-testid="api-keys-page"
        data-section="11.7"
      >
        <PermissionDeniedState
          title="API keys require admin"
          description="You do not have permission to manage API keys. High-risk scopes stay default-deny on the server."
          data-testid="api-keys-permission-denied"
        />
      </div>
    );
  }

  return (
    <div className="api-keys" data-testid="api-keys-page" data-section="11.7">
      <p className="page-stub__overline">Settings · API keys</p>
      <h2 className="page-stub__title">API keys</h2>
      <p className="page-stub__body">
        Mint scoped keys for CLI and agents. The full secret is shown once at
        creation — only the prefix is stored for display. High-risk scopes
        (comms:send, decisions:write, keys:admin) are default-deny unless you
        explicitly select them.
      </p>

      {/* K01 / K03 — one-time secret reveal */}
      {revealed ? (
        <section
          className="event-settings__card api-keys__secret-banner"
          data-testid="api-key-secret-once"
          aria-labelledby="secret-once-heading"
        >
          <h3 id="secret-once-heading" className="event-settings__heading">
            Copy your secret now
          </h3>
          <p className="page-stub__body">
            This is the only time the full secret is available. After you
            dismiss, only the prefix remains visible.
          </p>
          <label className="event-settings__label" htmlFor="api-key-secret">
            Secret
          </label>
          <div className="api-keys__secret-row">
            <input
              id="api-key-secret"
              className="event-settings__input lumen-focusable"
              data-testid="api-key-secret-value"
              readOnly
              value={revealed.secret}
            />
            <button
              type="button"
              className="event-settings__submit lumen-focusable"
              data-testid="api-key-secret-copy"
              onClick={() =>
                void copyText(revealed.secret, "api-key-secret-copy")
              }
            >
              Copy secret
            </button>
          </div>
          <p className="api-keys__meta" data-testid="api-key-created-prefix">
            Prefix: <code data-testid="api-key-prefix-value">{revealed.prefix}</code>
          </p>
          <button
            type="button"
            className="event-settings__submit lumen-focusable"
            data-testid="api-key-secret-dismiss"
            onClick={dismissSecret}
          >
            I have copied the secret
          </button>
        </section>
      ) : null}

      {secretDismissed && !revealed ? (
        <p
          className="event-settings__status event-settings__status--ok"
          data-testid="api-key-secret-dismissed"
          role="status"
        >
          Secret dismissed — only the prefix is available below.
        </p>
      ) : null}

      {/* Create form (K01) */}
      <section
        className="event-settings__card"
        data-testid="api-keys-create-section"
        aria-labelledby="create-key-heading"
      >
        <h3 id="create-key-heading" className="event-settings__heading">
          Create key
        </h3>
        <form
          className="event-settings__form"
          onSubmit={onCreate}
          data-testid="api-keys-create-form"
        >
          <label className="event-settings__label" htmlFor="api-key-name">
            Name
          </label>
          <input
            id="api-key-name"
            className="event-settings__input lumen-focusable"
            data-testid="api-key-name-input"
            value={name}
            onChange={(ev) => setName(ev.target.value)}
            required
            maxLength={200}
            autoComplete="off"
          />

          <fieldset
            className="api-keys__scopes"
            data-testid="api-key-scopes"
          >
            <legend className="event-settings__label">Scopes</legend>
            <p className="api-keys__scopes-hint">
              Safe scopes (not default-deny):
            </p>
            <div
              className="api-keys__scope-grid"
              data-testid="api-key-scopes-safe"
            >
              {SAFE_DEFAULT_SCOPES.map((scope) => (
                <label
                  key={scope}
                  className="api-keys__scope-item lumen-focusable"
                >
                  <input
                    type="checkbox"
                    data-testid={`api-key-scope-${scope}`}
                    checked={selectedScopes.has(scope)}
                    onChange={() => toggleScope(scope)}
                  />
                  <span>{scope}</span>
                </label>
              ))}
            </div>
            <p className="api-keys__scopes-hint api-keys__scopes-hint--danger">
              Default-deny (must opt in explicitly):
            </p>
            <div
              className="api-keys__scope-grid"
              data-testid="api-key-scopes-deny"
            >
              {API_SCOPES.filter((s) => DEFAULT_DENY_SCOPE_SET.has(s)).map(
                (scope) => (
                  <label
                    key={scope}
                    className="api-keys__scope-item api-keys__scope-item--danger lumen-focusable"
                  >
                    <input
                      type="checkbox"
                      data-testid={`api-key-scope-${scope}`}
                      checked={selectedScopes.has(scope)}
                      onChange={() => toggleScope(scope)}
                    />
                    <span>{scope}</span>
                  </label>
                ),
              )}
            </div>
          </fieldset>

          <button
            type="submit"
            className="event-settings__submit lumen-focusable"
            data-testid="api-key-create-submit"
            disabled={creating}
          >
            {creating ? "Creating…" : "Create API key"}
          </button>
          {createStatus ? (
            <p
              className={
                createStatus.kind === "ok"
                  ? "event-settings__status event-settings__status--ok"
                  : "event-settings__status event-settings__status--error"
              }
              data-testid="api-key-create-status"
              role="status"
            >
              {createStatus.text}
            </p>
          ) : null}
        </form>
      </section>

      {/* List (K02 / K03 prefix after dismiss) */}
      <section
        className="event-settings__card"
        data-testid="api-keys-list-section"
        aria-labelledby="list-keys-heading"
      >
        <h3 id="list-keys-heading" className="event-settings__heading">
          Active keys
        </h3>
        {loading ? (
          <LoadingState
            label="Loading API keys…"
            rows={3}
            data-testid="api-keys-loading"
          />
        ) : loadError ? (
          <NetworkErrorState
            title="Couldn't load API keys"
            description={loadError}
            onRetry={() => void loadKeys()}
            data-testid="api-keys-load-error"
          />
        ) : activeKeys.length === 0 ? (
          <EmptyState
            title="No active API keys"
            description="Create a scoped key for the CLI or an agent. The secret is shown once at creation."
            icon="settings"
            data-testid="api-keys-empty"
          />
        ) : (
          <ul className="api-keys__list" data-testid="api-keys-list">
            {activeKeys.map((k) => (
              <li
                key={k.id}
                className="api-keys__row"
                data-testid={`api-key-row-${k.id}`}
                data-key-id={k.id}
              >
                <div className="api-keys__row-main">
                  <span
                    className="api-keys__row-name"
                    data-testid="api-key-row-name"
                  >
                    {k.name}
                  </span>
                  <code
                    className="api-keys__row-prefix"
                    data-testid="api-key-row-prefix"
                  >
                    {k.prefix}
                  </code>
                  <button
                    type="button"
                    className="api-keys__copy-prefix lumen-focusable"
                    data-testid={`api-key-copy-prefix-${k.id}`}
                    onClick={() =>
                      void copyText(k.prefix, `api-key-copy-prefix-${k.id}`)
                    }
                  >
                    Copy prefix
                  </button>
                  <span
                    className="api-keys__row-scopes"
                    data-testid="api-key-row-scopes"
                  >
                    {k.scopes.join(", ")}
                  </span>
                </div>
                <button
                  type="button"
                  className="event-settings__submit lumen-focusable api-keys__revoke"
                  data-testid={`api-key-revoke-${k.id}`}
                  disabled={revokingId === k.id}
                  onClick={() => void onRevoke(k.id)}
                >
                  {revokingId === k.id ? "Revoking…" : "Revoke"}
                </button>
              </li>
            ))}
          </ul>
        )}
        {revokeStatus ? (
          <p
            className={
              revokeStatus.kind === "ok"
                ? "event-settings__status event-settings__status--ok"
                : "event-settings__status event-settings__status--error"
            }
            data-testid="api-key-revoke-status"
            role="status"
          >
            {revokeStatus.text}
          </p>
        ) : null}

        {revokedKeys.length > 0 ? (
          <>
            <h3 className="event-settings__heading api-keys__revoked-heading">
              Revoked
            </h3>
            <ul
              className="api-keys__list api-keys__list--revoked"
              data-testid="api-keys-revoked-list"
            >
              {revokedKeys.map((k) => (
                <li
                  key={k.id}
                  className="api-keys__row api-keys__row--revoked"
                  data-testid={`api-key-revoked-${k.id}`}
                >
                  <span data-testid="api-key-row-name">{k.name}</span>
                  <code data-testid="api-key-row-prefix">{k.prefix}</code>
                  <span className="api-keys__muted">revoked</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
    </div>
  );
}
