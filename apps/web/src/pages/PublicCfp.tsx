/**
 * Public CFP surface — section 3.3 (S-CFP).
 *
 * - Published Design Kit tokens only (S-THEME / 2.4)
 * - Form.GetPublic + Submission.Create + file upload
 * - Turnstile (test key path for e2e)
 * - Multi-speaker min/max, conditionals, category routing
 * - XSS-safe: all user/copy content as text (no dangerouslySetInnerHTML)
 * - Inventory A01–A11
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useParams } from "react-router-dom";
import {
  PublicDesignResponseSchema,
  PublicCfpResponseSchema,
  SubmissionCreateResponseSchema,
  CfpFileUploadResponseSchema,
  ErrorEnvelopeSchema,
  TURNSTILE_DEV_PASS_TOKEN,
  TURNSTILE_TEST_SITE_KEY,
  CFP_MIN_SPEAKERS,
  CFP_MAX_SPEAKERS,
  isFieldVisible,
  deriveCategoryFromRules,
  type DesignPublished,
  type FormVersionDto,
  type FormFieldDto,
  type FormRuleDto,
  type SubmissionSpeakerInput,
} from "@speakerops/shared";

/** Cloudflare Turnstile global (loaded from challenges.cloudflare.com). */
type TurnstileApi = {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
      theme?: "light" | "dark" | "auto";
    },
  ) => string;
  remove: (widgetId: string) => void;
  reset: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let turnstileScriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("no window"));
  }
  if (window.turnstile) return Promise.resolve();
  if (turnstileScriptPromise) return turnstileScriptPromise;
  turnstileScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src^="https://challenges.cloudflare.com/turnstile/"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Turnstile script failed")),
        { once: true },
      );
      // Already loaded
      if (window.turnstile) resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Turnstile script failed"));
    document.head.appendChild(script);
  });
  return turnstileScriptPromise;
}

type LoadState = "loading" | "ok" | "error" | "not_found";
type SubmitState = "idle" | "submitting" | "success" | "error";

type SpeakerDraft = {
  clientId: string;
  name: string;
  email: string;
};

function newSpeakerId(): string {
  return `sp_${Math.random().toString(36).slice(2, 10)}`;
}

function cssVarsFromString(
  cssVariables: string | null,
): CSSProperties | undefined {
  if (!cssVariables) return undefined;
  const s: Record<string, string> = {};
  for (const part of cssVariables.split(";")) {
    const idx = part.indexOf(":");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim().replace(/^"|"$/g, "");
    if (key && val) s[key] = val;
  }
  return s as CSSProperties;
}

export function PublicCfpPage() {
  const { slug } = useParams<{ slug: string }>();

  const [published, setPublished] = useState<DesignPublished | null>(null);
  const [cssVariables, setCssVariables] = useState<string | null>(null);
  const [formVersion, setFormVersion] = useState<FormVersionDto | null>(null);
  const [windowState, setWindowState] = useState<string>("no_form");
  const [minSpeakers, setMinSpeakers] = useState<number>(CFP_MIN_SPEAKERS);
  const [maxSpeakers, setMaxSpeakers] = useState<number>(CFP_MAX_SPEAKERS);
  const [fileAllowlist, setFileAllowlist] = useState<string[]>([]);
  const [fileMaxBytes, setFileMaxBytes] = useState(5 * 1024 * 1024);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string>(
    TURNSTILE_TEST_SITE_KEY,
  );
  const [loadState, setLoadState] = useState<LoadState>("loading");

  const [title, setTitle] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [speakers, setSpeakers] = useState<SpeakerDraft[]>([
    { clientId: newSpeakerId(), name: "", email: "" },
  ]);
  /** True when captcha completed (widget callback or local test control). */
  const [turnstileChecked, setTurnstileChecked] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    id: string;
    title: string;
    category: string | null;
    thankYouMd: string | null;
    abstractEcho: string | null;
  } | null>(null);
  const [fileStatus, setFileStatus] = useState<string | null>(null);
  const [derivedCategory, setDerivedCategory] = useState<string | null>(null);

  const firstErrorRef = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const turnstileHostRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);

  /** Production site key → real CF widget; Cloudflare always-pass test key → e2e control. */
  const useLiveTurnstileWidget =
    turnstileSiteKey.length > 0 && turnstileSiteKey !== TURNSTILE_TEST_SITE_KEY;

  // Load design + form in parallel
  useEffect(() => {
    if (!slug) {
      setLoadState("not_found");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [designRes, formRes] = await Promise.all([
          fetch(`/api/public/design/${encodeURIComponent(slug)}`, {
            headers: { accept: "application/json" },
          }),
          fetch(`/api/public/cfp/${encodeURIComponent(slug)}`, {
            headers: { accept: "application/json" },
          }),
        ]);

        if (formRes.status === 404) {
          if (!cancelled) setLoadState("not_found");
          return;
        }
        if (!formRes.ok) {
          if (!cancelled) setLoadState("error");
          return;
        }

        const formRaw: unknown = await formRes.json();
        const formParsed = PublicCfpResponseSchema.safeParse(formRaw);
        if (!formParsed.success) {
          if (!cancelled) setLoadState("error");
          return;
        }

        if (designRes.ok) {
          const designRaw: unknown = await designRes.json();
          const designParsed = PublicDesignResponseSchema.safeParse(designRaw);
          if (designParsed.success && !cancelled) {
            setPublished(designParsed.data.published);
            setCssVariables(designParsed.data.cssVariables);
          }
        }

        if (!cancelled) {
          setFormVersion(formParsed.data.formVersion);
          setWindowState(formParsed.data.windowState ?? "no_form");
          setMinSpeakers(formParsed.data.minSpeakers ?? CFP_MIN_SPEAKERS);
          setMaxSpeakers(formParsed.data.maxSpeakers ?? CFP_MAX_SPEAKERS);
          setFileAllowlist(formParsed.data.fileMimeAllowlist ?? []);
          setFileMaxBytes(formParsed.data.fileMaxBytes ?? 5 * 1024 * 1024);
          setTurnstileSiteKey(
            formParsed.data.turnstileSiteKey ?? TURNSTILE_TEST_SITE_KEY,
          );
          setLoadState("ok");
        }
      } catch {
        if (!cancelled) setLoadState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const fields: FormFieldDto[] = useMemo(
    () => formVersion?.fields ?? formVersion?.snapshotJson?.fields ?? [],
    [formVersion],
  );
  const rules: FormRuleDto[] = useMemo(
    () => formVersion?.rules ?? formVersion?.snapshotJson?.rules ?? [],
    [formVersion],
  );

  const sortedFields = useMemo(
    () => [...fields].sort((a, b) => a.sortOrder - b.sortOrder),
    [fields],
  );

  const answerMap = useMemo(() => {
    const m: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(answers)) m[k] = v;
    return m;
  }, [answers]);

  const visibleFields = useMemo(
    () => sortedFields.filter((f) => isFieldVisible(f, sortedFields, answerMap)),
    [sortedFields, answerMap],
  );

  useEffect(() => {
    const cat = deriveCategoryFromRules(
      rules.map((r) => ({ when: r.when, routeToCategory: r.routeToCategory })),
      answerMap,
    );
    setDerivedCategory(cat);
  }, [rules, answerMap]);

  const welcomeMd =
    formVersion?.welcomeMd ?? formVersion?.snapshotJson?.welcomeMd ?? null;
  const isClosed =
    windowState === "closed" ||
    windowState === "not_yet_open" ||
    windowState === "no_form";
  const canSubmit = !isClosed && formVersion != null && submitState !== "success";

  const setAnswer = useCallback((fieldKey: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [fieldKey]: value }));
  }, []);

  const addSpeaker = () => {
    if (speakers.length >= maxSpeakers) return;
    setSpeakers((prev) => [
      ...prev,
      { clientId: newSpeakerId(), name: "", email: "" },
    ]);
  };

  const removeSpeaker = (clientId: string) => {
    if (speakers.length <= minSpeakers) return;
    setSpeakers((prev) => prev.filter((s) => s.clientId !== clientId));
  };

  const updateSpeaker = (
    clientId: string,
    patch: Partial<Pick<SpeakerDraft, "name" | "email">>,
  ) => {
    setSpeakers((prev) =>
      prev.map((s) => (s.clientId === clientId ? { ...s, ...patch } : s)),
    );
  };

  const validateClient = (): Record<string, string> => {
    const errs: Record<string, string> = {};
    if (!title.trim()) errs.title = "Title is required";
    for (const f of visibleFields) {
      if (!f.required) continue;
      const v = answers[f.fieldKey] ?? "";
      if (!v.trim()) errs[`field:${f.fieldKey}`] = `${f.label} is required`;
    }
    if (speakers.length < minSpeakers) {
      errs.speakers = `At least ${minSpeakers} speaker required`;
    }
    speakers.forEach((s, i) => {
      if (!s.name.trim()) errs[`speaker-name-${i}`] = "Speaker name required";
      if (!s.email.trim() || !s.email.includes("@")) {
        errs[`speaker-email-${i}`] = "Valid speaker email required";
      }
    });
    if (!turnstileChecked || !turnstileToken) {
      errs.turnstile = "Please complete the captcha";
    }
    return errs;
  };

  const focusFirstError = (errs: Record<string, string>) => {
    const order = Object.keys(errs);
    if (order.length === 0) return;
    const first = order[0]!;
    let el: HTMLElement | null = null;
    if (first === "title") el = titleRef.current;
    else if (first.startsWith("field:")) {
      el = document.querySelector(
        `[data-testid="cfp-field-${first.slice(6)}"]`,
      );
    } else if (first.startsWith("speaker-")) {
      el = document.querySelector(`[data-testid="cfp-${first}"]`);
    } else if (first === "turnstile") {
      el = document.querySelector('[data-testid="cfp-turnstile"]');
    } else if (first === "speakers") {
      el = document.querySelector('[data-testid="cfp-speakers"]');
    }
    if (el) {
      firstErrorRef.current = el;
      el.focus();
    }
  };

  /**
   * Local/e2e path: Cloudflare always-pass test site key.
   * Interactive control only — never auto-submit a token without user action.
   * Server accepts TURNSTILE_DEV_PASS_TOKEN only when TURNSTILE_SECRET_KEY is unset.
   */
  const onTurnstileToggle = () => {
    if (turnstileChecked) {
      setTurnstileChecked(false);
      setTurnstileToken("");
    } else {
      setTurnstileChecked(true);
      setTurnstileToken(TURNSTILE_DEV_PASS_TOKEN);
    }
  };

  // Mount Cloudflare Turnstile widget for production site keys.
  useEffect(() => {
    if (loadState !== "ok" || !useLiveTurnstileWidget || !canSubmit) {
      return;
    }
    let cancelled = false;
    const host = turnstileHostRef.current;
    if (!host) return;

    void (async () => {
      try {
        await loadTurnstileScript();
        if (cancelled || !window.turnstile || !turnstileHostRef.current) return;
        // Clear previous widget
        if (turnstileWidgetIdRef.current) {
          try {
            window.turnstile.remove(turnstileWidgetIdRef.current);
          } catch {
            /* ignore */
          }
          turnstileWidgetIdRef.current = null;
        }
        host.innerHTML = "";
        const widgetId = window.turnstile.render(host, {
          sitekey: turnstileSiteKey,
          callback: (token: string) => {
            setTurnstileToken(token);
            setTurnstileChecked(true);
            setFieldErrors((prev) => {
              if (!prev.turnstile) return prev;
              const next = { ...prev };
              delete next.turnstile;
              return next;
            });
          },
          "expired-callback": () => {
            setTurnstileToken("");
            setTurnstileChecked(false);
          },
          "error-callback": () => {
            setTurnstileToken("");
            setTurnstileChecked(false);
          },
          theme: "auto",
        });
        turnstileWidgetIdRef.current = widgetId;
      } catch {
        // Widget failed to load — leave token empty; submit validation fails closed
        if (!cancelled) {
          setTurnstileToken("");
          setTurnstileChecked(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (turnstileWidgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(turnstileWidgetIdRef.current);
        } catch {
          /* ignore */
        }
        turnstileWidgetIdRef.current = null;
      }
    };
    // canSubmit is derived; re-render widget when form becomes submittable
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: remount when site key / load / form open state change
  }, [loadState, useLiveTurnstileWidget, turnstileSiteKey, windowState, formVersion?.id]);

  const onFileSelected = async (
    fieldKey: string,
    file: File | null,
  ): Promise<void> => {
    if (!file || !slug) return;
    setFileStatus(null);
    if (file.size > fileMaxBytes) {
      setFieldErrors((prev) => ({
        ...prev,
        [`field:${fieldKey}`]: `File exceeds max size (${fileMaxBytes} bytes)`,
      }));
      setFileStatus("rejected:size");
      return;
    }
    if (fileAllowlist.length > 0 && !fileAllowlist.includes(file.type)) {
      setFieldErrors((prev) => ({
        ...prev,
        [`field:${fieldKey}`]: `File type not allowed (${file.type || "unknown"})`,
      }));
      setFileStatus("rejected:type");
      return;
    }
    // Client pre-reject SVG/HTML even if browser reports empty type
    const lower = file.name.toLowerCase();
    if (
      lower.endsWith(".svg") ||
      lower.endsWith(".html") ||
      lower.endsWith(".js") ||
      file.type === "image/svg+xml"
    ) {
      setFieldErrors((prev) => ({
        ...prev,
        [`field:${fieldKey}`]: "File type not allowed",
      }));
      setFileStatus("rejected:type");
      return;
    }

    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    const contentBase64 = btoa(binary);
    const mime = file.type || "application/octet-stream";

    try {
      const res = await fetch(
        `/api/public/cfp/${encodeURIComponent(slug)}/files`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            mime,
            size: bytes.byteLength,
            contentBase64,
          }),
        },
      );
      if (!res.ok) {
        const raw: unknown = await res.json().catch(() => null);
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setFieldErrors((prev) => ({
          ...prev,
          [`field:${fieldKey}`]: env.success
            ? env.data.error
            : "Upload failed",
        }));
        setFileStatus("rejected:server");
        return;
      }
      const raw: unknown = await res.json();
      const parsed = CfpFileUploadResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setFieldErrors((prev) => ({
          ...prev,
          [`field:${fieldKey}`]: "Upload response invalid",
        }));
        return;
      }
      setAnswer(fieldKey, `file:${parsed.data.fileId}`);
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[`field:${fieldKey}`];
        return next;
      });
      setFileStatus(`ok:${parsed.data.fileId}`);
    } catch {
      setFieldErrors((prev) => ({
        ...prev,
        [`field:${fieldKey}`]: "Upload failed",
      }));
      setFileStatus("rejected:network");
    }
  };

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!slug || !formVersion || !canSubmit) return;

    const errs = validateClient();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) {
      setSubmitState("error");
      setSubmitError("Please fix the highlighted fields");
      // defer focus to after paint
      queueMicrotask(() => focusFirstError(errs));
      return;
    }

    setSubmitState("submitting");
    setSubmitError(null);

    const speakerPayload: SubmissionSpeakerInput[] = speakers.map((s, i) => ({
      name: s.name.trim(),
      email: s.email.trim(),
      isPrimary: i === 0,
    }));

    const answerPayload = visibleFields
      .filter((f) => answers[f.fieldKey] != null && answers[f.fieldKey] !== "")
      .map((f) => ({
        fieldKey: f.fieldKey,
        value: answers[f.fieldKey],
      }));

    const body = {
      formVersionId: formVersion.id,
      title: title.trim(),
      answers: answerPayload,
      speakers: speakerPayload,
      turnstileToken,
      category: derivedCategory,
    };

    try {
      const res = await fetch(
        `/api/public/cfp/${encodeURIComponent(slug)}/submissions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-correlation-id": `cfp-ui-${Date.now()}`,
          },
          body: JSON.stringify(body),
        },
      );
      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setSubmitState("error");
        setSubmitError(
          env.success ? env.data.error : `Submit failed (${res.status})`,
        );
        return;
      }
      const parsed = SubmissionCreateResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setSubmitState("error");
        setSubmitError("Unexpected response");
        return;
      }

      // Abstract echo for XSS proof — text only
      const abstractAnswer =
        parsed.data.answers.find(
          (a) =>
            a.fieldKey.includes("abstract") ||
            a.fieldKey.includes("body") ||
            a.fieldKey.includes("description"),
        ) ??
        parsed.data.answers.find((a) => typeof a.value === "string");

      setConfirmation({
        id: parsed.data.submission.id,
        title: parsed.data.submission.title,
        category: parsed.data.submission.category,
        thankYouMd: parsed.data.thankYouMd,
        abstractEcho:
          abstractAnswer && typeof abstractAnswer.value === "string"
            ? abstractAnswer.value
            : null,
      });
      setSubmitState("success");
    } catch {
      setSubmitState("error");
      setSubmitError("Network error");
    }
  };

  const onFormKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    // Allow Enter in textarea; Ctrl/Cmd+Enter submits for keyboard journey
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const style = cssVarsFromString(cssVariables);

  return (
    <section
      className="public-cfp"
      data-testid="page-public-cfp"
      data-section="3.3"
      data-has-published={published ? "true" : "false"}
      data-window-state={windowState}
      style={style}
    >
      <p className="page-stub__overline">Public</p>
      <h1 className="page-stub__title" data-testid="public-cfp-title">
        {published?.tokens.wordmark?.trim() || "CFP"}
      </h1>

      {loadState === "loading" ? (
        <p className="page-stub__body" data-testid="public-cfp-skeleton">
          Loading…
        </p>
      ) : null}

      {loadState === "error" ? (
        <p
          className="event-settings__status event-settings__status--error"
          data-testid="public-cfp-error"
        >
          Could not load public CFP for this event.
        </p>
      ) : null}

      {loadState === "not_found" ? (
        <p
          className="event-settings__status event-settings__status--error"
          data-testid="public-cfp-not-found"
        >
          Event not found.
        </p>
      ) : null}

      {loadState === "ok" ? (
        <>
          <div
            className="public-cfp__brand-panel"
            data-testid="public-cfp-brand"
          >
            <p
              className="event-settings__meta"
              data-testid="public-cfp-brand-value"
            >
              {published
                ? `published brand ${published.tokens.brand}${
                    published.tokens.brandFg
                      ? ` · fg ${published.tokens.brandFg}`
                      : ""
                  }`
                : "no published brand (Lumen defaults)"}
            </p>
            {published?.tokens.logoFileId ? (
              <>
                <img
                  src={`/api/public/files/${encodeURIComponent(published.tokens.logoFileId)}`}
                  alt=""
                  className="public-cfp__logo"
                  data-testid="public-cfp-logo"
                />
                <p
                  className="event-settings__meta"
                  data-testid="public-cfp-logo-id"
                >
                  logo {published.tokens.logoFileId}
                </p>
              </>
            ) : null}
          </div>

          {welcomeMd ? (
            <div
              className="public-cfp__welcome"
              data-testid="public-cfp-welcome"
            >
              {/* Text node only — XSS-safe (A10) */}
              {welcomeMd}
            </div>
          ) : (
            <p className="page-stub__body" data-testid="public-cfp-welcome">
              Call for proposals
            </p>
          )}

          {isClosed ? (
            <div
              className="public-cfp__closed"
              data-testid="public-cfp-closed"
              role="status"
            >
              <p className="public-cfp__closed-title">
                {windowState === "not_yet_open"
                  ? "This CFP is not open yet"
                  : windowState === "no_form"
                    ? "No published CFP form"
                    : "This CFP is closed"}
              </p>
              <p className="page-stub__body">
                Submissions are not accepted at this time.
              </p>
            </div>
          ) : null}

          {submitState === "success" && confirmation ? (
            <div
              className="public-cfp__confirmation"
              data-testid="public-cfp-confirmation"
              role="status"
            >
              <h2 className="public-cfp__section-title">Submission received</h2>
              {confirmation.thankYouMd ? (
                <p data-testid="public-cfp-thankyou">{confirmation.thankYouMd}</p>
              ) : (
                <p data-testid="public-cfp-thankyou">
                  Thank you — your proposal has been submitted.
                </p>
              )}
              <p className="event-settings__meta" data-testid="public-cfp-submission-id">
                Reference {confirmation.id}
              </p>
              <p data-testid="public-cfp-confirmation-title">
                {confirmation.title}
              </p>
              {confirmation.category ? (
                <p data-testid="public-cfp-confirmation-category">
                  Category: {confirmation.category}
                </p>
              ) : null}
              {confirmation.abstractEcho != null ? (
                <p data-testid="public-cfp-xss-echo">
                  {confirmation.abstractEcho}
                </p>
              ) : null}
            </div>
          ) : null}

          {canSubmit ? (
            <form
              className="public-cfp__form"
              data-testid="public-cfp-form"
              onSubmit={(e) => void handleSubmit(e)}
              onKeyDown={onFormKeyDown}
              noValidate
            >
              <div className="public-cfp__field">
                <label className="public-cfp__label" htmlFor="cfp-title">
                  Proposal title *
                </label>
                <input
                  ref={titleRef}
                  id="cfp-title"
                  className="public-cfp__input lumen-focusable"
                  data-testid="cfp-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  aria-invalid={fieldErrors.title ? "true" : undefined}
                  aria-describedby={
                    fieldErrors.title ? "cfp-title-error" : undefined
                  }
                />
                {fieldErrors.title ? (
                  <p
                    id="cfp-title-error"
                    className="public-cfp__error"
                    data-testid="cfp-error-title"
                    role="alert"
                  >
                    {fieldErrors.title}
                  </p>
                ) : null}
              </div>

              {visibleFields.map((f) => (
                <div
                  key={f.id}
                  className="public-cfp__field"
                  data-testid={`cfp-field-wrap-${f.fieldKey}`}
                  data-field-key={f.fieldKey}
                >
                  <label
                    className="public-cfp__label"
                    htmlFor={`cfp-field-${f.fieldKey}`}
                    data-testid={`cfp-label-${f.fieldKey}`}
                  >
                    {f.label}
                    {f.required ? " *" : ""}
                  </label>
                  {f.type === "textarea" ? (
                    <textarea
                      id={`cfp-field-${f.fieldKey}`}
                      className="public-cfp__input lumen-focusable"
                      data-testid={`cfp-field-${f.fieldKey}`}
                      rows={4}
                      value={answers[f.fieldKey] ?? ""}
                      onChange={(e) => setAnswer(f.fieldKey, e.target.value)}
                      aria-invalid={
                        fieldErrors[`field:${f.fieldKey}`] ? "true" : undefined
                      }
                    />
                  ) : f.type === "select" || f.type === "multiselect" ? (
                    <select
                      id={`cfp-field-${f.fieldKey}`}
                      className="public-cfp__input lumen-focusable"
                      data-testid={`cfp-field-${f.fieldKey}`}
                      value={answers[f.fieldKey] ?? ""}
                      onChange={(e) => setAnswer(f.fieldKey, e.target.value)}
                      aria-invalid={
                        fieldErrors[`field:${f.fieldKey}`] ? "true" : undefined
                      }
                    >
                      <option value="">—</option>
                      {(f.options ?? []).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : f.type === "checkbox" ? (
                    <input
                      id={`cfp-field-${f.fieldKey}`}
                      type="checkbox"
                      className="lumen-focusable"
                      data-testid={`cfp-field-${f.fieldKey}`}
                      checked={(answers[f.fieldKey] ?? "") === "true"}
                      onChange={(e) =>
                        setAnswer(f.fieldKey, e.target.checked ? "true" : "false")
                      }
                    />
                  ) : f.type === "url" ? (
                    <div className="public-cfp__file-row">
                      <input
                        id={`cfp-field-${f.fieldKey}`}
                        type="file"
                        className="public-cfp__input lumen-focusable"
                        data-testid={`cfp-field-${f.fieldKey}`}
                        data-file-status={fileStatus ?? undefined}
                        accept={
                          fileAllowlist.length > 0
                            ? fileAllowlist.join(",")
                            : undefined
                        }
                        onChange={(e) => {
                          const file = e.target.files?.[0] ?? null;
                          void onFileSelected(f.fieldKey, file);
                        }}
                      />
                      {answers[f.fieldKey] ? (
                        <p
                          className="event-settings__meta"
                          data-testid={`cfp-file-id-${f.fieldKey}`}
                        >
                          {answers[f.fieldKey]}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <input
                      id={`cfp-field-${f.fieldKey}`}
                      type={
                        f.type === "email"
                          ? "email"
                          : f.type === "number"
                            ? "number"
                            : f.type === "date"
                              ? "date"
                              : "text"
                      }
                      className="public-cfp__input lumen-focusable"
                      data-testid={`cfp-field-${f.fieldKey}`}
                      value={answers[f.fieldKey] ?? ""}
                      onChange={(e) => setAnswer(f.fieldKey, e.target.value)}
                      aria-invalid={
                        fieldErrors[`field:${f.fieldKey}`] ? "true" : undefined
                      }
                    />
                  )}
                  {fieldErrors[`field:${f.fieldKey}`] ? (
                    <p
                      className="public-cfp__error"
                      data-testid={`cfp-error-${f.fieldKey}`}
                      role="alert"
                    >
                      {fieldErrors[`field:${f.fieldKey}`]}
                    </p>
                  ) : null}
                </div>
              ))}

              {derivedCategory ? (
                <p
                  className="event-settings__meta"
                  data-testid="cfp-derived-category"
                >
                  Routing category: {derivedCategory}
                </p>
              ) : null}

              <div
                className="public-cfp__speakers"
                data-testid="cfp-speakers"
              >
                <h2 className="public-cfp__section-title">Speakers</h2>
                <p className="event-settings__meta" data-testid="cfp-speaker-bounds">
                  {minSpeakers}–{maxSpeakers} speakers
                </p>
                {fieldErrors.speakers ? (
                  <p
                    className="public-cfp__error"
                    data-testid="cfp-error-speakers"
                    role="alert"
                  >
                    {fieldErrors.speakers}
                  </p>
                ) : null}
                {speakers.map((s, i) => (
                  <div
                    key={s.clientId}
                    className="public-cfp__speaker-block"
                    data-testid={`cfp-speaker-block-${i}`}
                  >
                    <p className="public-cfp__speaker-heading">
                      Speaker {i + 1}
                      {i === 0 ? " (primary)" : ""}
                    </p>
                    <label className="public-cfp__label" htmlFor={`sp-name-${i}`}>
                      Name *
                    </label>
                    <input
                      id={`sp-name-${i}`}
                      className="public-cfp__input lumen-focusable"
                      data-testid={`cfp-speaker-name-${i}`}
                      value={s.name}
                      onChange={(e) =>
                        updateSpeaker(s.clientId, { name: e.target.value })
                      }
                      aria-invalid={
                        fieldErrors[`speaker-name-${i}`] ? "true" : undefined
                      }
                    />
                    {fieldErrors[`speaker-name-${i}`] ? (
                      <p
                        className="public-cfp__error"
                        data-testid={`cfp-error-speaker-name-${i}`}
                        role="alert"
                      >
                        {fieldErrors[`speaker-name-${i}`]}
                      </p>
                    ) : null}
                    <label
                      className="public-cfp__label"
                      htmlFor={`sp-email-${i}`}
                    >
                      Email *
                    </label>
                    <input
                      id={`sp-email-${i}`}
                      type="email"
                      className="public-cfp__input lumen-focusable"
                      data-testid={`cfp-speaker-email-${i}`}
                      value={s.email}
                      onChange={(e) =>
                        updateSpeaker(s.clientId, { email: e.target.value })
                      }
                      aria-invalid={
                        fieldErrors[`speaker-email-${i}`] ? "true" : undefined
                      }
                    />
                    {fieldErrors[`speaker-email-${i}`] ? (
                      <p
                        className="public-cfp__error"
                        data-testid={`cfp-error-speaker-email-${i}`}
                        role="alert"
                      >
                        {fieldErrors[`speaker-email-${i}`]}
                      </p>
                    ) : null}
                    {speakers.length > minSpeakers ? (
                      <button
                        type="button"
                        className="public-cfp__btn public-cfp__btn--ghost lumen-focusable"
                        data-testid={`cfp-speaker-remove-${i}`}
                        onClick={() => removeSpeaker(s.clientId)}
                      >
                        Remove speaker
                      </button>
                    ) : null}
                  </div>
                ))}
                {speakers.length < maxSpeakers ? (
                  <button
                    type="button"
                    className="public-cfp__btn public-cfp__btn--secondary lumen-focusable"
                    data-testid="cfp-speaker-add"
                    onClick={addSpeaker}
                  >
                    Add speaker
                  </button>
                ) : null}
              </div>

              <div
                className="public-cfp__turnstile"
                data-testid="cfp-turnstile"
                data-sitekey={turnstileSiteKey}
                data-turnstile-mode={
                  useLiveTurnstileWidget ? "live" : "test"
                }
              >
                {useLiveTurnstileWidget ? (
                  <div
                    ref={turnstileHostRef}
                    className="public-cfp__turnstile-widget"
                    data-testid="cfp-turnstile-widget"
                  />
                ) : (
                  <label className="public-cfp__turnstile-label">
                    <input
                      type="checkbox"
                      className="lumen-focusable"
                      data-testid="cfp-turnstile-check"
                      checked={turnstileChecked}
                      onChange={onTurnstileToggle}
                    />
                    <span>I am human (Turnstile test)</span>
                  </label>
                )}
                {fieldErrors.turnstile ? (
                  <p
                    className="public-cfp__error"
                    data-testid="cfp-error-turnstile"
                    role="alert"
                  >
                    {fieldErrors.turnstile}
                  </p>
                ) : null}
                <input
                  type="hidden"
                  data-testid="cfp-turnstile-token"
                  value={turnstileToken}
                  readOnly
                />
              </div>

              {submitError ? (
                <p
                  className="public-cfp__error"
                  data-testid="public-cfp-submit-error"
                  role="alert"
                >
                  {submitError}
                </p>
              ) : null}

              <button
                type="submit"
                className="public-cfp__primary lumen-focusable"
                data-testid="public-cfp-primary"
                disabled={submitState === "submitting"}
              >
                {submitState === "submitting" ? "Submitting…" : "Submit proposal"}
              </button>
            </form>
          ) : null}

          {/* Keep primary button visible when closed for layout, but disabled */}
          {isClosed && submitState !== "success" ? (
            <button
              type="button"
              className="public-cfp__primary lumen-focusable"
              data-testid="public-cfp-primary"
              disabled
            >
              Submit proposal
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
