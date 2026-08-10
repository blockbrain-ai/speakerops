/**
 * Public CFP surface — section 3.3 (S-CFP) + 10.5 draft save/resume (S-CFP-DRAFT)
 * + 11.3 Lumen 2 branded public CFP with recovery (S-L2-CFP).
 *
 * - Published Design Kit tokens only (S-THEME / 2.4)
 * - Form.GetPublic + Submission.Create + file upload
 * - Submission.SaveDraft / GetDraft (title-only allowed; closed disables)
 * - Turnstile (test key path for e2e)
 * - Multi-speaker min/max, conditionals, category routing
 * - XSS-safe: all user/copy content as text (no dangerouslySetInnerHTML)
 * - Branded intro, section progress, load/submit failure recovery
 * - Inventory A01–A11, A17
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
import { useParams, useSearchParams } from "react-router-dom";
import {
  PublicDesignResponseSchema,
  PublicCfpResponseSchema,
  SubmissionCreateResponseSchema,
  SubmissionSaveDraftResponseSchema,
  SubmissionGetDraftResponseSchema,
  CfpFileUploadResponseSchema,
  ErrorEnvelopeSchema,
  TURNSTILE_DEV_PASS_TOKEN,
  TURNSTILE_TEST_SITE_KEY,
  CFP_MIN_SPEAKERS,
  CFP_MAX_SPEAKERS,
  isFieldVisible,
  isInputNode,
  isLayoutNode,
  deriveCategoryFromRules,
  type DesignPublished,
  type FormVersionDto,
  type FormFieldDto,
  type FormRuleDto,
  type SubmissionSpeakerInput,
} from "@speakerops/shared";
import {
  charCountLabel,
  charCountOverMessage,
  charCountTone,
} from "../components/forms/char-count.js";

/** localStorage key for last draft id per event slug (resume without URL). */
function draftStorageKey(eventSlug: string): string {
  return `speakerops:cfp-draft:${eventSlug}`;
}

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

type DraftSaveState = "idle" | "saving" | "saved" | "error";

/** Multiselect UI stores JSON array string; empty → []. */
function parseMultiselectValues(raw: string | undefined): string[] {
  if (raw == null || raw === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    /* legacy single value */
  }
  return [raw];
}

/** Coerce answer state for condition/routing maps (parse JSON arrays). */
function coerceAnswerForMap(raw: string): unknown {
  if (raw.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* keep string */
    }
  }
  return raw;
}

/** Build submit/draft answer value; multiselect → string[]. */
function answerValueForPayload(
  fieldKey: string,
  raw: string,
  fieldTypes: Map<string, string>,
): unknown {
  if (fieldTypes.get(fieldKey) === "multiselect") {
    return parseMultiselectValues(raw);
  }
  return raw;
}

export function PublicCfpPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

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

  /** Active draft id for re-save / resume (section 10.5). */
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftSaveState, setDraftSaveState] = useState<DraftSaveState>("idle");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftConfirmation, setDraftConfirmation] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const draftResumeAttempted = useRef(false);

  const firstErrorRef = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const turnstileHostRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);
  /** Bump to re-run public load (failure recovery). */
  const [loadAttempt, setLoadAttempt] = useState(0);
  /** Active form section for progress chrome (11.3). */
  const [activeSection, setActiveSection] = useState<
    "proposal" | "details" | "speakers" | "submit"
  >("proposal");
  /** Suppress scroll-spy while a stepper click smooth-scrolls to a section. */
  const sectionScrollLockUntil = useRef(0);

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
    setLoadState("loading");
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
  }, [slug, loadAttempt]);

  const retryLoad = useCallback(() => {
    setLoadState("loading");
    setLoadAttempt((n) => n + 1);
  }, []);

  // Scroll-spy: keep the stepper label honest by reflecting the section
  // actually in view (11.3). Clicks temporarily suppress this so smooth
  // scrolling cannot overwrite an explicit selection mid-flight.
  useEffect(() => {
    if (loadState !== "ok") return;
    const sectionIds = ["proposal", "details", "speakers", "submit"] as const;
    const onScroll = () => {
      if (Date.now() < sectionScrollLockUntil.current) return;
      const line = window.innerHeight * 0.35;
      let current: (typeof sectionIds)[number] = "proposal";
      for (const id of sectionIds) {
        const el = document.querySelector(`[data-cfp-section="${id}"]`);
        if (el instanceof HTMLElement && el.getBoundingClientRect().top <= line) {
          current = id;
        }
      }
      setActiveSection(current);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [loadState]);

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

  const fieldTypeByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of fields) {
      if (isInputNode(f)) m.set(f.fieldKey, f.type);
    }
    return m;
  }, [fields]);

  const answerMap = useMemo(() => {
    const m: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(answers)) m[k] = coerceAnswerForMap(v);
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
  /** Draft save only when CFP open and not already fully submitted. */
  const canSaveDraft =
    !isClosed && formVersion != null && submitState !== "success";

  const setAnswer = useCallback((fieldKey: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [fieldKey]: value }));
  }, []);

  /** Apply GetDraft / SaveDraft snapshot into form state. */
  const applyDraftSnapshot = useCallback(
    (snap: {
      title: string;
      answers: Array<{ fieldKey: string; value?: unknown }>;
      speakers: Array<{
        name: string;
        email: string;
        isPrimary: boolean;
        sortOrder: number;
      }>;
    }) => {
      setTitle(snap.title);
      const nextAnswers: Record<string, string> = {};
      for (const a of snap.answers) {
        if (a.value == null) continue;
        if (Array.isArray(a.value)) {
          nextAnswers[a.fieldKey] = JSON.stringify(a.value.map(String));
        } else if (typeof a.value === "string") {
          nextAnswers[a.fieldKey] = a.value;
        } else {
          nextAnswers[a.fieldKey] = String(a.value);
        }
      }
      setAnswers(nextAnswers);
      if (snap.speakers.length > 0) {
        setSpeakers(
          snap.speakers
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((s) => ({
              clientId: newSpeakerId(),
              name: s.name,
              email: s.email,
            })),
        );
      }
    },
    [],
  );

  // Resume draft from ?draft= or localStorage after form load (AC-10.5-B).
  useEffect(() => {
    if (loadState !== "ok" || !slug || !canSaveDraft || draftResumeAttempted.current) {
      return;
    }
    draftResumeAttempted.current = true;

    const fromQuery = searchParams.get("draft");
    let fromStorage: string | null = null;
    try {
      fromStorage = localStorage.getItem(draftStorageKey(slug));
    } catch {
      fromStorage = null;
    }
    const resumeId = fromQuery || fromStorage;
    if (!resumeId) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/public/cfp/${encodeURIComponent(slug)}/drafts/${encodeURIComponent(resumeId)}`,
          { headers: { accept: "application/json" } },
        );
        if (!res.ok) {
          // Stale localStorage / wrong event — clear quietly
          if (!fromQuery) {
            try {
              localStorage.removeItem(draftStorageKey(slug));
            } catch {
              /* ignore */
            }
          }
          return;
        }
        const raw: unknown = await res.json();
        const parsed = SubmissionGetDraftResponseSchema.safeParse(raw);
        if (!parsed.success || cancelled) return;
        setDraftId(parsed.data.submission.id);
        applyDraftSnapshot(parsed.data.snapshot);
        setDraftConfirmation({
          id: parsed.data.submission.id,
          title: parsed.data.snapshot.title,
        });
        setDraftSaveState("saved");
        try {
          localStorage.setItem(
            draftStorageKey(slug),
            parsed.data.submission.id,
          );
        } catch {
          /* ignore */
        }
      } catch {
        /* network — leave form empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    loadState,
    slug,
    canSaveDraft,
    searchParams,
    applyDraftSnapshot,
  ]);

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
      // Layout nodes (section/divider) are structure only — never validated.
      if (isLayoutNode(f)) continue;
      // Character cap (client mirror of the server rule).
      if (
        f.maxChars != null &&
        (f.type === "text" || f.type === "textarea") &&
        (answers[f.fieldKey] ?? "").length > f.maxChars
      ) {
        errs[`field:${f.fieldKey}`] = charCountOverMessage(
          f.label,
          f.maxChars,
        );
        continue;
      }
      if (!f.required) continue;
      if (f.type === "multiselect") {
        const selected = parseMultiselectValues(answers[f.fieldKey]);
        if (selected.length === 0) {
          errs[`field:${f.fieldKey}`] = `${f.label} is required`;
        }
        continue;
      }
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
   * Local/e2e + DEMO_MODE path: Cloudflare always-pass test site key.
   * Interactive control only — never auto-submit a token without user action.
   * Server accepts TURNSTILE_DEV_PASS_TOKEN only when demoMode is true and
   * (if allowlist enabled) the request host/event is allowlisted (section 10.3).
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

  const handleSaveDraft = async () => {
    if (!slug || !formVersion || !canSaveDraft) return;

    const trimmed = title.trim();
    if (!trimmed) {
      setFieldErrors((prev) => ({ ...prev, title: "Title is required" }));
      setDraftSaveState("error");
      setDraftError("Title is required to save a draft");
      queueMicrotask(() => titleRef.current?.focus());
      return;
    }

    setDraftSaveState("saving");
    setDraftError(null);

    const speakerPayload: SubmissionSpeakerInput[] = speakers
      .filter((s) => s.name.trim() && s.email.trim() && s.email.includes("@"))
      .map((s, i) => ({
        name: s.name.trim(),
        email: s.email.trim(),
        isPrimary: i === 0,
      }));

    const answerPayload = Object.entries(answers)
      .filter(([fieldKey, v]) => {
        if (v == null || v === "") return false;
        if (fieldTypeByKey.get(fieldKey) === "multiselect") {
          return parseMultiselectValues(v).length > 0;
        }
        return true;
      })
      .map(([fieldKey, value]) => ({
        fieldKey,
        value: answerValueForPayload(fieldKey, value, fieldTypeByKey),
      }));

    const body: Record<string, unknown> = {
      formVersionId: formVersion.id,
      title: trimmed,
      answers: answerPayload,
      speakers: speakerPayload,
      category: derivedCategory,
    };
    if (draftId) body.draftId = draftId;

    try {
      const res = await fetch(
        `/api/public/cfp/${encodeURIComponent(slug)}/drafts`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-correlation-id": `cfp-draft-${Date.now()}`,
          },
          body: JSON.stringify(body),
        },
      );
      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setDraftSaveState("error");
        setDraftError(
          env.success ? env.data.error : `Draft save failed (${res.status})`,
        );
        return;
      }
      const parsed = SubmissionSaveDraftResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setDraftSaveState("error");
        setDraftError("Unexpected draft response");
        return;
      }

      const id = parsed.data.submission.id;
      setDraftId(id);
      setDraftConfirmation({
        id,
        title: parsed.data.snapshot.title,
      });
      setDraftSaveState("saved");
      setFieldErrors((prev) => {
        if (!prev.title) return prev;
        const next = { ...prev };
        delete next.title;
        return next;
      });
      try {
        localStorage.setItem(draftStorageKey(slug), id);
      } catch {
        /* ignore */
      }
      // Keep resume URL in query without full navigation
      const next = new URLSearchParams(searchParams);
      next.set("draft", id);
      setSearchParams(next, { replace: true });
    } catch {
      setDraftSaveState("error");
      setDraftError("Network error");
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
      .filter((f) => {
        // Layout nodes never enter the submission payload (Wave 1B).
        if (isLayoutNode(f)) return false;
        const raw = answers[f.fieldKey];
        if (raw == null || raw === "") return false;
        if (f.type === "multiselect") {
          return parseMultiselectValues(raw).length > 0;
        }
        return true;
      })
      .map((f) => ({
        fieldKey: f.fieldKey,
        value: answerValueForPayload(
          f.fieldKey,
          answers[f.fieldKey] ?? "",
          fieldTypeByKey,
        ),
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

  const wordmark =
    published?.tokens.wordmark?.trim() || "Call for proposals";

  const progressSections = [
    { id: "proposal" as const, label: "Proposal", testId: "cfp-progress-proposal" },
    { id: "details" as const, label: "Details", testId: "cfp-progress-details" },
    { id: "speakers" as const, label: "Speakers", testId: "cfp-progress-speakers" },
    { id: "submit" as const, label: "Submit", testId: "cfp-progress-submit" },
  ];

  const progressIndex = progressSections.findIndex((s) => s.id === activeSection);

  return (
    <section
      className="public-cfp"
      data-testid="page-public-cfp"
      data-section="11.3"
      data-has-published={published ? "true" : "false"}
      data-window-state={windowState}
      data-active-section={activeSection}
      style={style}
    >
      {/* Branded intro hero */}
      <header
        className="public-cfp__intro"
        data-testid="public-cfp-intro"
      >
        <p className="public-cfp__eyebrow">Public CFP</p>
        <h1 className="public-cfp__title" data-testid="public-cfp-title">
          {wordmark}
        </h1>
      </header>

      {loadState === "loading" ? (
        <p className="page-stub__body" data-testid="public-cfp-skeleton">
          Loading…
        </p>
      ) : null}

      {loadState === "error" ? (
        <div
          className="public-cfp__recovery"
          data-testid="public-cfp-error"
          role="alert"
        >
          <p className="public-cfp__recovery-title">
            Could not load public CFP for this event.
          </p>
          <p className="page-stub__body">
            Check your connection and try again. Your draft is not lost if you
            already saved one.
          </p>
          <button
            type="button"
            className="public-cfp__btn public-cfp__btn--secondary lumen-focusable"
            data-testid="public-cfp-retry-load"
            onClick={retryLoad}
          >
            Retry
          </button>
        </div>
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
            data-has-published={published ? "true" : "false"}
            data-brand={published?.tokens.brand ?? ""}
          >
            {/* Friendly brand strip only — no token dumps or raw file ids. */}
            <p
              className="event-settings__meta"
              data-testid="public-cfp-brand-value"
            >
              {published?.tokens.wordmark?.trim()
                ? published.tokens.wordmark.trim()
                : wordmark}
            </p>
            {published?.tokens.logoFileId ? (
              <img
                src={`/api/public/files/${encodeURIComponent(published.tokens.logoFileId)}`}
                alt=""
                className="public-cfp__logo"
                data-testid="public-cfp-logo"
              />
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

          {/* Section progress (open form only) */}
          {canSubmit ? (
            <nav
              className="public-cfp__progress"
              data-testid="public-cfp-progress"
              aria-label="Form progress"
            >
              <ol className="public-cfp__progress-list">
                {progressSections.map((s, i) => {
                  const done = i < progressIndex;
                  const current = s.id === activeSection;
                  return (
                    <li
                      key={s.id}
                      className={
                        current
                          ? "public-cfp__progress-item is-current"
                          : done
                            ? "public-cfp__progress-item is-done"
                            : "public-cfp__progress-item"
                      }
                    >
                      <button
                        type="button"
                        className="public-cfp__progress-btn lumen-focusable"
                        data-testid={s.testId}
                        aria-current={current ? "step" : undefined}
                        onClick={() => {
                          sectionScrollLockUntil.current = Date.now() + 1000;
                          setActiveSection(s.id);
                          const el = document.querySelector(
                            `[data-cfp-section="${s.id}"]`,
                          );
                          if (el instanceof HTMLElement) {
                            el.scrollIntoView({
                              behavior: "smooth",
                              block: "start",
                            });
                          }
                        }}
                      >
                        <span className="public-cfp__progress-index">
                          {i + 1}
                        </span>
                        <span className="public-cfp__progress-label">
                          {s.label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              <p
                className="event-settings__meta"
                data-testid="public-cfp-progress-meta"
              >
                Step {progressIndex + 1} of {progressSections.length} ·{" "}
                {progressSections[progressIndex]?.label}
              </p>
            </nav>
          ) : null}

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
              <p
                className="event-settings__meta"
                data-testid="public-cfp-submission-id"
              >
                We&apos;ve saved your submission
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
              <div
                className="public-cfp__field"
                data-cfp-section="proposal"
                onFocus={() => setActiveSection("proposal")}
              >
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

              <div
                className="public-cfp__details"
                data-cfp-section="details"
                data-testid="cfp-section-details"
                onFocus={() => setActiveSection("details")}
              >
              {visibleFields.map((f) =>
                isLayoutNode(f) ? (
                  <div
                    key={f.id}
                    className="public-cfp__layout"
                    data-testid={`cfp-layout-${f.fieldKey}`}
                    data-layout-type={f.layoutType ?? undefined}
                  >
                    {f.layoutType === "section" ? (
                      <h3
                        className="public-cfp__section-heading"
                        data-testid={`cfp-section-heading-${f.fieldKey}`}
                      >
                        {f.label}
                      </h3>
                    ) : (
                      <hr
                        className="public-cfp__divider"
                        data-testid={`cfp-divider-${f.fieldKey}`}
                        aria-hidden="true"
                      />
                    )}
                  </div>
                ) : (
                <div
                  key={f.id}
                  className="public-cfp__field"
                  data-testid={`cfp-field-wrap-${f.fieldKey}`}
                  data-field-key={f.fieldKey}
                >
                  {f.type !== "checkbox" ? (
                    <label
                      className="public-cfp__label"
                      htmlFor={`cfp-field-${f.fieldKey}`}
                      data-testid={`cfp-label-${f.fieldKey}`}
                    >
                      {f.label}
                      {f.required ? " *" : ""}
                    </label>
                  ) : null}
                  {f.helpText?.trim() ? (
                    <p
                      className="public-cfp__field-help"
                      id={`cfp-help-${f.fieldKey}`}
                      data-testid={`cfp-help-${f.fieldKey}`}
                    >
                      {f.helpText}
                    </p>
                  ) : null}
                  {f.type === "textarea" ? (
                    <textarea
                      id={`cfp-field-${f.fieldKey}`}
                      className="public-cfp__input lumen-focusable"
                      data-testid={`cfp-field-${f.fieldKey}`}
                      rows={4}
                      value={answers[f.fieldKey] ?? ""}
                      placeholder={f.placeholder ?? undefined}
                      onChange={(e) => setAnswer(f.fieldKey, e.target.value)}
                      aria-describedby={
                        f.helpText?.trim() ? `cfp-help-${f.fieldKey}` : undefined
                      }
                      aria-invalid={
                        fieldErrors[`field:${f.fieldKey}`] ? "true" : undefined
                      }
                    />
                  ) : f.type === "select" ? (
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
                  ) : f.type === "multiselect" ? (
                    <div
                      className="public-cfp__multiselect"
                      id={`cfp-field-${f.fieldKey}`}
                      data-testid={`cfp-field-${f.fieldKey}`}
                      role="group"
                      aria-label={f.label}
                      aria-invalid={
                        fieldErrors[`field:${f.fieldKey}`] ? "true" : undefined
                      }
                    >
                      {(f.options ?? []).map((o) => {
                        const selected = parseMultiselectValues(
                          answers[f.fieldKey],
                        );
                        const checked = selected.includes(o.value);
                        return (
                          <label
                            key={o.value}
                            className="public-cfp__multiselect-option"
                          >
                            <input
                              type="checkbox"
                              className="lumen-focusable"
                              data-testid={`cfp-field-${f.fieldKey}-${o.value}`}
                              checked={checked}
                              onChange={(e) => {
                                const cur = parseMultiselectValues(
                                  answers[f.fieldKey],
                                );
                                const next = e.target.checked
                                  ? [...new Set([...cur, o.value])]
                                  : cur.filter((v) => v !== o.value);
                                setAnswer(f.fieldKey, JSON.stringify(next));
                              }}
                            />
                            <span>{o.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : f.type === "checkbox" ? (
                    <label
                      className="public-cfp__checkbox-label"
                      htmlFor={`cfp-field-${f.fieldKey}`}
                      data-testid={`cfp-label-${f.fieldKey}`}
                    >
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
                      <span>
                        {f.label}
                        {f.required ? " *" : ""}
                      </span>
                    </label>
                  ) : f.type === "url" ? (
                    <input
                      id={`cfp-field-${f.fieldKey}`}
                      type="url"
                      className="public-cfp__input lumen-focusable"
                      data-testid={`cfp-field-${f.fieldKey}`}
                      value={answers[f.fieldKey] ?? ""}
                      onChange={(e) => setAnswer(f.fieldKey, e.target.value)}
                      placeholder="https://"
                      aria-invalid={
                        fieldErrors[`field:${f.fieldKey}`] ? "true" : undefined
                      }
                    />
                  ) : f.type === "file" ? (
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
                          Uploaded
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
                      placeholder={f.placeholder ?? undefined}
                      onChange={(e) => setAnswer(f.fieldKey, e.target.value)}
                      aria-describedby={
                        f.helpText?.trim() ? `cfp-help-${f.fieldKey}` : undefined
                      }
                      aria-invalid={
                        fieldErrors[`field:${f.fieldKey}`] ? "true" : undefined
                      }
                    />
                  )}
                  {f.maxChars != null &&
                  (f.type === "text" || f.type === "textarea") ? (
                    <p
                      className={`public-cfp__char-count public-cfp__char-count--${charCountTone(
                        (answers[f.fieldKey] ?? "").length,
                        f.maxChars,
                      )}`}
                      data-testid={`cfp-char-count-${f.fieldKey}`}
                      data-tone={charCountTone(
                        (answers[f.fieldKey] ?? "").length,
                        f.maxChars,
                      )}
                      aria-live="polite"
                    >
                      {charCountLabel(
                        (answers[f.fieldKey] ?? "").length,
                        f.maxChars,
                      )}
                    </p>
                  ) : null}
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
                ),
              )}
              </div>

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
                data-cfp-section="speakers"
                onFocus={() => setActiveSection("speakers")}
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
                <button
                  type="button"
                  className="public-cfp__btn public-cfp__btn--secondary lumen-focusable"
                  data-testid="cfp-speaker-add"
                  onClick={addSpeaker}
                  disabled={speakers.length >= maxSpeakers}
                  aria-disabled={speakers.length >= maxSpeakers}
                >
                  Add speaker
                </button>
                {speakers.length >= maxSpeakers ? (
                  <p
                    className="event-settings__meta"
                    data-testid="cfp-speaker-max-note"
                    role="status"
                  >
                    {maxSpeakers === 1
                      ? "This form takes a single speaker."
                      : `That's the maximum — this form takes up to ${maxSpeakers} speakers.`}
                  </p>
                ) : null}
              </div>

              <div
                className="public-cfp__turnstile"
                data-testid="cfp-turnstile"
                data-cfp-section="submit"
                data-sitekey={turnstileSiteKey}
                data-turnstile-mode={
                  useLiveTurnstileWidget ? "live" : "test"
                }
                onFocus={() => setActiveSection("submit")}
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
                    <span>I&apos;m human</span>
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
                <div
                  className="public-cfp__recovery public-cfp__recovery--inline"
                  data-testid="public-cfp-submit-error"
                  role="alert"
                >
                  <p className="public-cfp__error">{submitError}</p>
                  <p className="event-settings__meta">
                    Your answers are still on this page. Fix any issues and try
                    again — nothing was discarded.
                  </p>
                  <button
                    type="button"
                    className="public-cfp__btn public-cfp__btn--secondary lumen-focusable"
                    data-testid="public-cfp-retry-submit"
                    onClick={() => {
                      setSubmitState("idle");
                      setSubmitError(null);
                      void handleSubmit();
                    }}
                  >
                    Retry submit
                  </button>
                </div>
              ) : null}

              {draftError ? (
                <div
                  className="public-cfp__recovery public-cfp__recovery--inline"
                  data-testid="cfp-draft-error-wrap"
                >
                  <p
                    className="public-cfp__error"
                    data-testid="cfp-draft-error"
                    role="alert"
                  >
                    {draftError}
                  </p>
                  <p className="event-settings__meta">
                    Draft was not saved. You can retry without losing form input.
                  </p>
                </div>
              ) : null}

              {draftConfirmation && draftSaveState === "saved" ? (
                <div
                  className="public-cfp__draft-confirmation"
                  data-testid="cfp-draft-confirmation"
                  role="status"
                >
                  <p className="public-cfp__draft-confirmation-title">
                    Draft saved
                  </p>
                  <p
                    className="event-settings__meta"
                    data-testid="cfp-draft-id"
                  >
                    Reference saved
                  </p>
                  <p data-testid="cfp-draft-confirmation-title">
                    {draftConfirmation.title}
                  </p>
                  <p className="event-settings__meta">
                    You can reload this page to continue where you left off.
                  </p>
                </div>
              ) : null}

              {draftSaveState === "saving" ? (
                <p
                  className="event-settings__meta"
                  data-testid="cfp-draft-saving"
                  role="status"
                >
                  Saving draft…
                </p>
              ) : null}

              <div className="public-cfp__actions" data-cfp-section="submit">
                <button
                  type="button"
                  className="public-cfp__btn public-cfp__btn--secondary lumen-focusable"
                  data-testid="cfp-draft-save"
                  disabled={draftSaveState === "saving"}
                  onClick={() => void handleSaveDraft()}
                >
                  {draftSaveState === "saving" ? "Saving draft…" : "Save as draft"}
                </button>
                <button
                  type="submit"
                  className="public-cfp__primary lumen-focusable"
                  data-testid="public-cfp-primary"
                  disabled={submitState === "submitting"}
                >
                  {submitState === "submitting" ? "Submitting…" : "Submit proposal"}
                </button>
              </div>
            </form>
          ) : null}

          {/* Keep primary + draft controls visible when closed for layout, but disabled */}
          {isClosed && submitState !== "success" ? (
            <div className="public-cfp__actions">
              <button
                type="button"
                className="public-cfp__btn public-cfp__btn--secondary lumen-focusable"
                data-testid="cfp-draft-save"
                disabled
              >
                Save as draft
              </button>
              <button
                type="button"
                className="public-cfp__primary lumen-focusable"
                data-testid="public-cfp-primary"
                disabled
              >
                Submit proposal
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
