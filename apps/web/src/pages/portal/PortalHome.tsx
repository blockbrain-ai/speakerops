/**
 * Speaker portal UI — section 4.3 (S-PORTAL) + 11.6 (S-L2-PORTAL).
 *
 * Surfaces G01–G08:
 * - G01 next incomplete task home
 * - G02 profile bio save (XSS text-only)
 * - G03 headshot upload + preview
 * - G04 slides upload
 * - G05 task complete (optimistic + revert)
 * - G06 overdue visual state
 * - G07 own session status only
 * - G08 mobile bio + task
 *
 * Onboarding workflow (product rule):
 * - Incomplete speakers get an exclusive one-step wizard (not CTA + full form dump)
 * - Skip defers a step to the end; Save draft persists partial work
 * - Full tabbed layout only after onboarding is complete (or review mode)
 *
 * Review layout is true tabs: `?section=` (home|profile|tasks|sessions) is the
 * tab state; only the active view renders. Header nav + mobile bottom nav
 * switch tabs (URL push, focus moves to the view — no scrolling).
 *
 * APIs: Portal.GetHome · Participation.UpdateProfile · Task.Complete
 *       File.PresignUpload · File.Upload · File.CompleteUpload
 * Lumen tokens only (E6); speaker surface may use brand tokens.
 * Status semantics never rethemed by event brand.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  PortalHomeResponseSchema,
  ParticipationUpdateProfileResponseSchema,
  TaskCompleteResponseSchema,
  FilePresignResponseSchema,
  FileUploadResponseSchema,
  FileCompleteResponseSchema,
  ErrorEnvelopeSchema,
  type PortalHomeResponse,
  type PortalTaskDto,
  type ParticipationProfileDto,
  type PortalSessionDto,
  richTextToPlainText,
  type RichTextEnvelope,
} from "@speakerops/shared";
import { RichTextEditor } from "../../components/richtext/RichTextEditor.js";
import { RoleShell } from "../../layout/RoleShell.js";
import { BrandMark } from "../../components/ui/BrandMark.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { PortalFileField } from "../../components/portal/PortalFileField.js";
import {
  OnboardingWizard,
  OnboardingPausedCard,
} from "./OnboardingWizard.js";
import {
  sanitizeBioText,
  bioIsPlainText,
  taskDisplayStatus,
  formatTaskDue,
  formatSessionRange,
  applyOptimisticComplete,
  revertOptimisticComplete,
  pickNextIncomplete,
  primaryParticipation,
  sha256Hex,
  isAllowedHeadshotMime,
  isAllowedSlidesMime,
  resolveUploadMime,
  profileProgressSteps,
  taskProgress,
  overallPortalProgress,
  participationStateLabel,
  buildOnboardingSteps,
  onboardingNeedsWork,
  pickWizardStepIndex,
  wizardProgress,
  loadOnboardingDraft,
  saveOnboardingDraft,
  isIncompleteTask,
  type OnboardingDraftState,
  type OnboardingStep,
  type TaskOptimisticSnapshot,
} from "./portal-utils.js";

type LoadState = "idle" | "loading" | "ready" | "error" | "unauthenticated";

function statusBadgeClass(status: string): string {
  // portal-status-chip capitalizes the raw enum for display only
  // (text/data-* values stay lowercase for tests and tooling).
  // F1 urgency ladder: leaf/sage = done · honey = in-progress/awaiting ·
  // clay = overdue/warning · red stays destructive-only.
  switch (status) {
    case "completed":
      return "portal-status-chip lumen-status lumen-status--success";
    case "overdue":
      return "portal-status-chip lumen-status lumen-status--warn";
    case "cancelled":
      return "portal-status-chip lumen-status lumen-status--info";
    default:
      return "portal-status-chip lumen-status lumen-status--progress";
  }
}

const PORTAL_SECTIONS = [
  { id: "portal-home", label: "Home", testId: "portal-nav-home" },
  { id: "portal-profile", label: "Profile", testId: "portal-nav-profile" },
  { id: "portal-tasks", label: "Tasks", testId: "portal-nav-tasks" },
  { id: "portal-sessions", label: "Sessions", testId: "portal-nav-sessions" },
] as const;

/** `?section=` value → tab view id. Unknown/absent values open Home. */
const SECTION_FROM_PARAM: Record<string, string> = {
  home: "portal-home",
  profile: "portal-profile",
  tasks: "portal-tasks",
  sessions: "portal-sessions",
};

export function PortalHomePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const eventId = searchParams.get("eventId")?.trim() || "";
  const sectionParam = searchParams.get("section")?.trim() || "";

  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [home, setHome] = useState<PortalHomeResponse | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /**
   * Tab state lives in the URL (`?section=`): only the active view renders,
   * deep links open the right tab, and browser Back walks tab history.
   */
  const activeSection = SECTION_FROM_PARAM[sectionParam] ?? "portal-home";
  /**
   * Tab switched by user this render cycle — move focus to the new view.
   * `target` distinguishes a plain tab switch (view heading — mobile
   * keyboards must never pop uninvited) from the explicit "Update profile"
   * CTA (bio field).
   */
  const pendingFocusRef = useRef<{
    section: string;
    target: "heading" | "bio";
  } | null>(null);

  // Profile form
  const [bio, setBio] = useState("");
  /**
   * F2: rich bio doc (bio schema — no headings/images). The profile tab
   * edits this; the onboarding wizard keeps the legacy plain-text path
   * (server clears/rebuilds the rich column on legacy-only writes).
   */
  const [bioRich, setBioRich] = useState<RichTextEnvelope | null>(null);
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileStatus, setProfileStatus] = useState<string | null>(null);

  // Files
  const [headshotPreview, setHeadshotPreview] = useState<string | null>(null);
  const [headshotStatus, setHeadshotStatus] = useState<string | null>(null);
  const [slidesStatus, setSlidesStatus] = useState<string | null>(null);
  const [fileBusyPurpose, setFileBusyPurpose] = useState<
    null | "headshot" | "slides"
  >(null);

  // Task complete busy set
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set());

  // Onboarding wizard — exclusive one-step flow while incomplete
  const [draftState, setDraftState] = useState<OnboardingDraftState>({
    skippedIds: [],
    freeformDrafts: {},
    paused: false,
  });
  const [wizardStepIndex, setWizardStepIndex] = useState(0);
  const [wizardSaving, setWizardSaving] = useState(false);
  const [wizardStatus, setWizardStatus] = useState<string | null>(null);
  const [wizardStatusOk, setWizardStatusOk] = useState(true);
  /** After onboarding completes, allow multi-section review without re-forcing wizard. */
  const [forceReview, setForceReview] = useState(false);
  const draftHydratedFor = useRef<string | null>(null);

  const headshotPreviewRef = useRef<string | null>(null);
  useEffect(() => {
    return () => {
      if (headshotPreviewRef.current) {
        URL.revokeObjectURL(headshotPreviewRef.current);
      }
    };
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  /**
   * Load portal home.
   * soft=true: keep current ready UI mounted (no form unmount) — used after save/upload.
   */
  const loadHome = useCallback(async (eid: string, opts?: { soft?: boolean }) => {
    const soft = opts?.soft === true;
    if (!soft) {
      setLoadState("loading");
      setError(null);
    }
    try {
      const res = await fetch(
        `/api/portal/home?eventId=${encodeURIComponent(eid)}`,
        {
          credentials: "include",
          headers: { accept: "application/json" },
        },
      );
      if (res.status === 401) {
        setLoadState("unauthenticated");
        setHome(null);
        return;
      }
      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const env = ErrorEnvelopeSchema.safeParse(raw);
        const msg = env.success
          ? env.data.error
          : `Load failed (${res.status})`;
        if (soft) {
          // Keep form mounted; surface as non-fatal status
          setProfileStatus(msg);
          return;
        }
        setError(msg);
        setLoadState("error");
        return;
      }
      const parsed = PortalHomeResponseSchema.safeParse(raw);
      if (!parsed.success) {
        if (soft) {
          setProfileStatus("Saved, but refresh failed — reload the page");
          return;
        }
        setError("Unexpected portal home response");
        setLoadState("error");
        return;
      }
      setHome(parsed.data);
      const part = primaryParticipation(parsed.data.participations);
      if (part) {
        setBio(part.bio ?? "");
        setBioRich(part.bioRich ?? null);
        setCompany(part.company ?? "");
        setTitle(part.title ?? "");
      }
      setLoadState("ready");
    } catch {
      if (soft) {
        setProfileStatus("Network error refreshing — your save may have worked");
        return;
      }
      setError("Network error");
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    if (eventId) {
      void loadHome(eventId);
    } else {
      setLoadState("idle");
      setHome(null);
    }
  }, [eventId, loadHome]);

  const participation: ParticipationProfileDto | null = useMemo(
    () => (home ? primaryParticipation(home.participations) : null),
    [home],
  );

  const tasks: PortalTaskDto[] = home?.tasks ?? [];
  const sessions: PortalSessionDto[] = home?.sessions ?? [];
  const portalFiles = home?.files ?? [];
  const slidesFile = useMemo(
    () =>
      [...portalFiles]
        .filter((f) => f.purpose === "slides" && f.uploaded)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null,
    [portalFiles],
  );
  const nextTask = useMemo(
    () => (home ? pickNextIncomplete(home.tasks) : null),
    [home],
  );

  const profileSteps = useMemo(
    () => profileProgressSteps(participation),
    [participation],
  );
  const tasksProg = useMemo(() => taskProgress(tasks), [tasks]);
  /** Prefer server readiness percent; fall back to client only if missing. */
  const overallProg = useMemo(() => {
    if (home?.readiness) {
      return {
        percent: home.readiness.percent,
        profileDone: home.readiness.profileDone,
        profileTotal: home.readiness.profileTotal,
      };
    }
    return overallPortalProgress(participation, tasks);
  }, [home, participation, tasks]);

  const onboardingSteps = useMemo(
    () => buildOnboardingSteps(participation, tasks, portalFiles),
    [participation, tasks, portalFiles],
  );
  const needsOnboarding = useMemo(
    () => Boolean(participation) && onboardingNeedsWork(onboardingSteps),
    [participation, onboardingSteps],
  );
  const wizardProg = useMemo(
    () => wizardProgress(onboardingSteps),
    [onboardingSteps],
  );

  // Hydrate draft / skipped state once per participation
  useEffect(() => {
    if (!participation?.id) return;
    if (draftHydratedFor.current === participation.id) return;
    draftHydratedFor.current = participation.id;
    const loaded = loadOnboardingDraft(participation.id);
    setDraftState(loaded);
    setForceReview(false);
    setWizardStepIndex(
      pickWizardStepIndex(
        buildOnboardingSteps(participation, tasks, portalFiles),
        loaded.skippedIds,
      ),
    );
  }, [participation, tasks, portalFiles]);

  // Keep step index in bounds only — do not auto-skip completed steps
  // (upload can mark headshot done; user still clicks Continue to advance).
  useEffect(() => {
    if (!needsOnboarding) return;
    setWizardStepIndex((idx) => {
      if (onboardingSteps.length === 0) return 0;
      if (idx >= onboardingSteps.length) {
        return Math.max(0, onboardingSteps.length - 1);
      }
      return idx;
    });
  }, [needsOnboarding, onboardingSteps.length]);

  const persistDraft = useCallback(
    (next: OnboardingDraftState) => {
      setDraftState(next);
      if (participation?.id) saveOnboardingDraft(participation.id, next);
    },
    [participation?.id],
  );

  /** In-wizard exclusive mode vs paused resume card vs full review layout. */
  const portalMode: "wizard" | "paused" | "review" = !needsOnboarding
    ? "review"
    : forceReview
      ? "review"
      : draftState.paused
        ? "paused"
        : "wizard";

  /** Published design tokens only (portal brand blast radius). */
  const portalStyle = useMemo((): CSSProperties => {
    const style: CSSProperties = {};
    if (home?.brandColor) {
      (style as Record<string, string>)["--lumen-brand"] = home.brandColor;
    }
    if (home?.brandSoft) {
      (style as Record<string, string>)["--lumen-brand-soft"] = home.brandSoft;
    }
    if (home?.brandFg) {
      (style as Record<string, string>)["--lumen-brand-fg"] = home.brandFg;
    }
    return style;
  }, [home?.brandColor, home?.brandSoft, home?.brandFg]);

  /**
   * Move focus into the (already rendered) tab view — no scroll jank.
   * A plain tab switch ALWAYS lands on the view heading (tabindex=-1) —
   * focusing the bio textarea on a plain switch pops the mobile keyboard
   * uninvited (B2). Only the explicit "Update profile" CTA passes
   * target="bio" to land in the editable form.
   */
  const focusSectionView = useCallback(
    (sectionId: string, target: "heading" | "bio" = "heading") => {
      if (sectionId === "portal-profile" && target === "bio") {
        // F2: the bio surface is a TipTap contenteditable that mounts a beat
        // after the view (immediatelyRender:false) — retry briefly until the
        // element exists and actually takes focus.
        let attempts = 0;
        const tryFocus = () => {
          const bioEl = document.getElementById("portal-bio");
          if (bioEl instanceof HTMLElement) {
            bioEl.focus({ preventScroll: true });
            if (document.activeElement === bioEl) return;
          }
          attempts += 1;
          if (attempts < 20) window.setTimeout(tryFocus, 50);
        };
        tryFocus();
        return;
      }
      const el = document.getElementById(sectionId);
      const heading = el?.querySelector("h2, h1");
      if (heading instanceof HTMLElement) {
        heading.focus({ preventScroll: true });
      }
    },
    [],
  );

  /**
   * Switch tabs: push `?section=` (tabs are navigation — Back returns to the
   * previous tab), keep `eventId`, and move focus into the new view.
   * Canonical home URL carries NO section param (B4) — every nav path
   * (desktop Home tab, mobile Home button, summary cards) agrees.
   */
  const selectSection = useCallback(
    (sectionId: string, opts?: { focus?: "heading" | "bio" }) => {
      const target = opts?.focus ?? "heading";
      if (sectionId === activeSection) {
        focusSectionView(sectionId, target);
        return;
      }
      pendingFocusRef.current = { section: sectionId, target };
      const next = new URLSearchParams(searchParams);
      if (eventId) next.set("eventId", eventId);
      if (sectionId === "portal-home") {
        next.delete("section");
      } else {
        next.set("section", sectionId.replace(/^portal-/, ""));
      }
      setSearchParams(next);
    },
    [activeSection, eventId, focusSectionView, searchParams, setSearchParams],
  );

  // After a user-initiated tab switch renders, focus the new view.
  // Deep links / Back-Forward simply show the tab without stealing focus.
  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending || pending.section !== activeSection) return;
    pendingFocusRef.current = null;
    focusSectionView(pending.section, pending.target);
  }, [activeSection, focusSectionView]);

  /** Header tabs carry real URLs (copy link / open in new tab both work).
   *  Home is canonical without a section param (B4). */
  const navSections = useMemo(
    () =>
      PORTAL_SECTIONS.map((s) => ({
        ...s,
        href:
          s.id === "portal-home"
            ? `/portal?eventId=${encodeURIComponent(eventId)}`
            : `/portal?eventId=${encodeURIComponent(eventId)}&section=${s.id.replace(/^portal-/, "")}`,
      })),
    [eventId],
  );

  async function patchProfileFields(fields: {
    bio?: string | null;
    /** F2: rich bio doc — profile-tab editor path (server dual-writes). */
    bioRich?: RichTextEnvelope | null;
    company?: string | null;
    title?: string | null;
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!participation || !eventId) {
      return { ok: false, error: "No speaker record linked" };
    }
    const body: Record<string, unknown> = {
      expectedVersion: participation.version,
    };
    if (fields.bioRich !== undefined) {
      // Doc-based path (F2): the API validates against the bio schema and
      // REJECTS invalid docs; the legacy column gets the plain-text
      // serialization server-side (dual-write).
      body.bioRich = fields.bioRich;
    } else if (fields.bio !== undefined) {
      const cleanBio = sanitizeBioText(fields.bio ?? "");
      if (!bioIsPlainText(cleanBio)) {
        return { ok: false, error: "Bio must be plain text only" };
      }
      body.bio = cleanBio;
    }
    if (fields.company !== undefined) {
      body.company =
        fields.company === null || fields.company.trim() === ""
          ? null
          : fields.company.trim();
    }
    if (fields.title !== undefined) {
      body.title =
        fields.title === null || fields.title.trim() === ""
          ? null
          : fields.title.trim();
    }
    try {
      const res = await fetch(
        `/api/portal/participations/${encodeURIComponent(participation.id)}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const env = ErrorEnvelopeSchema.safeParse(raw);
        return {
          ok: false,
          error: env.success ? env.data.error : `Save failed (${res.status})`,
        };
      }
      const parsed = ParticipationUpdateProfileResponseSchema.safeParse(raw);
      if (!parsed.success) {
        return { ok: false, error: "Unexpected profile response" };
      }
      const p = parsed.data.participation;
      setBio(p.bio ?? "");
      setBioRich(p.bioRich ?? null);
      setCompany(p.company ?? "");
      setTitle(p.title ?? "");
      setHome((prev) =>
        prev
          ? {
              ...prev,
              participations: prev.participations.map((x) =>
                x.id === p.id ? p : x,
              ),
            }
          : prev,
      );
      return { ok: true };
    } catch {
      return { ok: false, error: "Network error" };
    }
  }

  async function onSaveProfile(e: FormEvent) {
    e.preventDefault();
    if (!participation || !eventId) return;
    setProfileSaving(true);
    setProfileStatus(null);
    const result = await patchProfileFields({
      // F2: profile tab edits the rich doc; server derives the legacy text.
      bioRich,
      company,
      title,
    });
    if (!result.ok) {
      setProfileStatus(result.error);
      setProfileSaving(false);
      return;
    }
    setProfileStatus("Saved");
    showToast("Profile saved");
    await loadHome(eventId, { soft: true });
    setProfileSaving(false);
  }

  async function completeTaskById(
    taskId: string,
    expectedVersion: number,
  ): Promise<boolean> {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return false;
    return completeTask({ ...task, version: expectedVersion });
  }

  function advanceWizardAfter(step: OnboardingStep) {
    // Clear skip flag for this step once completed
    if (draftState.skippedIds.includes(step.id)) {
      persistDraft({
        ...draftState,
        skippedIds: draftState.skippedIds.filter((id) => id !== step.id),
      });
    }
    const nextSteps = onboardingSteps.map((s) =>
      s.id === step.id ? { ...s, done: true } : s,
    );
    const nextIdx = pickWizardStepIndex(
      nextSteps,
      draftState.skippedIds.filter((id) => id !== step.id),
    );
    // If everything done, leave wizard
    if (!onboardingNeedsWork(nextSteps)) {
      setForceReview(false);
      showToast("Onboarding complete");
    } else {
      setWizardStepIndex(nextIdx);
    }
  }

  async function wizardSaveCurrent(opts: {
    complete: boolean;
  }): Promise<boolean> {
    const step = onboardingSteps[wizardStepIndex];
    if (!step || !participation) return false;
    setWizardSaving(true);
    setWizardStatus(null);
    setWizardStatusOk(true);

    try {
      if (step.kind === "bio") {
        const result = await patchProfileFields({ bio });
        if (!result.ok) {
          setWizardStatusOk(false);
          setWizardStatus(result.error);
          return false;
        }
        if (opts.complete && !bio.trim()) {
          setWizardStatusOk(false);
          setWizardStatus("Add a bio, or Skip for now");
          return false;
        }
        if (opts.complete && step.taskId && step.taskVersion != null) {
          const ok = await completeTaskById(step.taskId, step.taskVersion);
          if (!ok) {
            setWizardStatusOk(false);
            setWizardStatus("Profile saved, but linked task failed");
            return false;
          }
        }
      } else if (step.kind === "company") {
        const result = await patchProfileFields({ company });
        if (!result.ok) {
          setWizardStatusOk(false);
          setWizardStatus(result.error);
          return false;
        }
        if (opts.complete && !company.trim()) {
          setWizardStatusOk(false);
          setWizardStatus("Add a company, or Skip for now");
          return false;
        }
        if (opts.complete && step.taskId && step.taskVersion != null) {
          const ok = await completeTaskById(step.taskId, step.taskVersion);
          if (!ok) {
            setWizardStatusOk(false);
            setWizardStatus("Saved, but linked task failed");
            return false;
          }
        }
      } else if (step.kind === "title") {
        const result = await patchProfileFields({ title });
        if (!result.ok) {
          setWizardStatusOk(false);
          setWizardStatus(result.error);
          return false;
        }
        if (opts.complete && !title.trim()) {
          setWizardStatusOk(false);
          setWizardStatus("Add a title, or Skip for now");
          return false;
        }
        if (opts.complete && step.taskId && step.taskVersion != null) {
          const ok = await completeTaskById(step.taskId, step.taskVersion);
          if (!ok) {
            setWizardStatusOk(false);
            setWizardStatus("Saved, but linked task failed");
            return false;
          }
        }
      } else if (step.kind === "headshot") {
        if (opts.complete && !participation.headshotFileId && !headshotPreview) {
          setWizardStatusOk(false);
          setWizardStatus("Upload a headshot, or Skip for now");
          return false;
        }
        if (
          opts.complete &&
          (participation.headshotFileId || headshotPreview) &&
          step.taskId
        ) {
          // Prefer live task version from home (upload/soft refresh may bump it)
          const live = tasks.find((t) => t.id === step.taskId) ?? null;
          if (live && isIncompleteTask(live)) {
            const ok = await completeTaskById(live.id, live.version);
            if (!ok) {
              setWizardStatusOk(false);
              setWizardStatus("Headshot ready, but linked task failed");
              return false;
            }
          }
        }
      } else if (step.kind === "slides") {
        if (opts.complete && !slidesFile) {
          setWizardStatusOk(false);
          setWizardStatus("Upload slides, or Skip for now");
          return false;
        }
        if (opts.complete && slidesFile && step.taskId && step.taskVersion != null) {
          const ok = await completeTaskById(step.taskId, step.taskVersion);
          if (!ok) {
            setWizardStatusOk(false);
            setWizardStatus("Slides ready, but linked task failed");
            return false;
          }
        }
      } else if (step.kind === "task_text") {
        const text = (draftState.freeformDrafts[step.id] ?? "").trim();
        persistDraft(draftState);
        if (opts.complete) {
          if (!text) {
            setWizardStatusOk(false);
            setWizardStatus("Add a response, or Skip for now");
            return false;
          }
          if (step.taskId && step.taskVersion != null) {
            const ok = await completeTaskById(step.taskId, step.taskVersion);
            if (!ok) {
              setWizardStatusOk(false);
              setWizardStatus("Could not complete this task");
              return false;
            }
          }
        }
      } else if (step.kind === "task_confirm") {
        if (opts.complete && step.taskId && step.taskVersion != null) {
          const ok = await completeTaskById(step.taskId, step.taskVersion);
          if (!ok) {
            setWizardStatusOk(false);
            setWizardStatus("Could not complete this task");
            return false;
          }
        }
      }

      if (eventId) await loadHome(eventId, { soft: true });
      setWizardStatus(opts.complete ? "Saved" : "Draft saved");
      setWizardStatusOk(true);
      showToast(opts.complete ? "Step saved" : "Draft saved");
      if (opts.complete) {
        advanceWizardAfter(step);
      }
      return true;
    } finally {
      setWizardSaving(false);
    }
  }

  function onWizardSkip() {
    const step = onboardingSteps[wizardStepIndex];
    if (!step) return;
    const skippedIds = draftState.skippedIds.includes(step.id)
      ? draftState.skippedIds
      : [...draftState.skippedIds, step.id];
    const next = { ...draftState, skippedIds, paused: false };
    persistDraft(next);
    const nextIdx = pickWizardStepIndex(
      onboardingSteps,
      skippedIds,
      // Prefer first open after current
    );
    // Move past current if still pointing at it
    if (
      nextIdx === wizardStepIndex &&
      wizardStepIndex < onboardingSteps.length - 1
    ) {
      // Find next incomplete after current, else first skipped
      let found = -1;
      for (let i = wizardStepIndex + 1; i < onboardingSteps.length; i++) {
        if (!onboardingSteps[i]!.done) {
          found = i;
          break;
        }
      }
      if (found < 0) {
        for (let i = 0; i < onboardingSteps.length; i++) {
          if (!onboardingSteps[i]!.done && i !== wizardStepIndex) {
            found = i;
            break;
          }
        }
      }
      setWizardStepIndex(found >= 0 ? found : wizardStepIndex);
    } else {
      setWizardStepIndex(nextIdx);
    }
    setWizardStatus("Skipped — we'll bring you back to this step later");
    setWizardStatusOk(true);
    showToast("Step skipped");
  }

  function onWizardFinishLater() {
    void wizardSaveCurrent({ complete: false }).then(() => {
      persistDraft({ ...draftState, paused: true });
      showToast("Draft saved — continue anytime");
    });
  }

  function onWizardResume() {
    persistDraft({ ...draftState, paused: false });
    setWizardStepIndex(
      pickWizardStepIndex(onboardingSteps, draftState.skippedIds),
    );
  }

  async function completeTask(task: PortalTaskDto): Promise<boolean> {
    if (!home) return false;
    if (completingIds.has(task.id)) return false;
    const snap: TaskOptimisticSnapshot = {
      taskId: task.id,
      previous: task,
      previousNextTask: home.nextTask,
    };
    const completedAt = new Date().toISOString();
    // Optimistic UI (design system: speed as brand; revert on reject)
    setHome((prev) => {
      if (!prev) return prev;
      const nextTasks = applyOptimisticComplete(prev.tasks, task.id, completedAt);
      return {
        ...prev,
        tasks: nextTasks,
        nextTask: pickNextIncomplete(nextTasks),
      };
    });
    setCompletingIds((s) => new Set(s).add(task.id));

    try {
      const res = await fetch(
        `/api/portal/tasks/${encodeURIComponent(task.id)}/complete`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expectedVersion: task.version }),
        },
      );
      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setHome((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            tasks: revertOptimisticComplete(prev.tasks, snap),
            nextTask: snap.previousNextTask,
          };
        });
        const env = ErrorEnvelopeSchema.safeParse(raw);
        showToast(
          env.success ? env.data.error : `Complete failed (${res.status})`,
        );
        return false;
      }
      const parsed = TaskCompleteResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setHome((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            tasks: revertOptimisticComplete(prev.tasks, snap),
            nextTask: snap.previousNextTask,
          };
        });
        showToast("Unexpected complete response");
        return false;
      }
      // Reconcile with server task (version / completedAt)
      setHome((prev) => {
        if (!prev) return prev;
        const nextTasks = prev.tasks.map((t) =>
          t.id === parsed.data.task.id
            ? {
                ...t,
                status: parsed.data.task.status,
                completedAt: parsed.data.task.completedAt,
                version: parsed.data.task.version,
              }
            : t,
        );
        return {
          ...prev,
          tasks: nextTasks,
          nextTask: pickNextIncomplete(nextTasks),
        };
      });
      showToast("Task completed");
      if (eventId) await loadHome(eventId, { soft: true });
      return true;
    } catch {
      setHome((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          tasks: revertOptimisticComplete(prev.tasks, snap),
          nextTask: snap.previousNextTask,
        };
      });
      showToast("Network error completing task");
      return false;
    } finally {
      setCompletingIds((s) => {
        const n = new Set(s);
        n.delete(task.id);
        return n;
      });
    }
  }

  async function uploadFile(
    file: File,
    purpose: "headshot" | "slides",
  ): Promise<void> {
    if (!eventId || !participation) return;
    setFileBusyPurpose(purpose);
    if (purpose === "headshot") setHeadshotStatus(null);
    else setSlidesStatus(null);

    const setStatus = purpose === "headshot" ? setHeadshotStatus : setSlidesStatus;

    const mime = resolveUploadMime(file, purpose);
    if (purpose === "headshot" && !isAllowedHeadshotMime(mime)) {
      setStatus("Headshot must be JPEG or PNG");
      setFileBusyPurpose(null);
      return;
    }
    if (purpose === "slides" && !isAllowedSlidesMime(mime)) {
      setStatus("Slides must be PDF");
      setFileBusyPurpose(null);
      return;
    }

    try {
      const presignRes = await fetch("/api/files/presign", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventId,
          purpose,
          mime,
          size: file.size,
          filename: file.name,
          ownerParticipationId: participation.id,
        }),
      });
      const presignRaw: unknown = await presignRes.json().catch(() => null);
      if (!presignRes.ok) {
        const env = ErrorEnvelopeSchema.safeParse(presignRaw);
        setStatus(
          env.success
            ? env.data.error
            : `Presign rejected (${presignRes.status})`,
        );
        setFileBusyPurpose(null);
        return;
      }
      const presign = FilePresignResponseSchema.safeParse(presignRaw);
      if (!presign.success) {
        setStatus("Unexpected presign response");
        setFileBusyPurpose(null);
        return;
      }

      const uploadRes = await fetch(presign.data.url, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": mime },
        body: file,
      });
      if (!uploadRes.ok) {
        const uploadRaw: unknown = await uploadRes.json().catch(() => null);
        const env = ErrorEnvelopeSchema.safeParse(uploadRaw);
        setStatus(
          env.success
            ? env.data.error
            : `Upload failed (${uploadRes.status})`,
        );
        setFileBusyPurpose(null);
        return;
      }
      FileUploadResponseSchema.safeParse(await uploadRes.json().catch(() => null));

      const checksum = await sha256Hex(file);
      const completeRes = await fetch(
        `/api/files/${encodeURIComponent(presign.data.fileId)}/complete`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            eventId,
            checksum,
            filename: file.name,
          }),
        },
      );
      if (!completeRes.ok) {
        const completeRaw: unknown = await completeRes.json().catch(() => null);
        const env = ErrorEnvelopeSchema.safeParse(completeRaw);
        setStatus(
          env.success
            ? env.data.error
            : `Complete failed (${completeRes.status})`,
        );
        setFileBusyPurpose(null);
        return;
      }
      FileCompleteResponseSchema.safeParse(
        await completeRes.json().catch(() => null),
      );

      if (purpose === "headshot") {
        // Bind headshot to participation profile before claiming success
        const patchRes = await fetch(
          `/api/portal/participations/${encodeURIComponent(participation.id)}`,
          {
            method: "PATCH",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              headshotFileId: presign.data.fileId,
              expectedVersion: participation.version,
            }),
          },
        );
        const patchRaw: unknown = await patchRes.json().catch(() => null);
        if (!patchRes.ok) {
          const env = ErrorEnvelopeSchema.safeParse(patchRaw);
          setStatus(
            env.success
              ? env.data.error
              : `Profile update failed (${patchRes.status})`,
          );
          setFileBusyPurpose(null);
          return;
        }
        const parsed =
          ParticipationUpdateProfileResponseSchema.safeParse(patchRaw);
        if (!parsed.success) {
          setStatus("Unexpected profile update response");
          setFileBusyPurpose(null);
          return;
        }
        const p = parsed.data.participation;
        setHome((prev) =>
          prev
            ? {
                ...prev,
                participations: prev.participations.map((x) =>
                  x.id === p.id ? p : x,
                ),
              }
            : prev,
        );

        // Local object URL preview only after successful profile bind
        if (headshotPreviewRef.current) {
          URL.revokeObjectURL(headshotPreviewRef.current);
        }
        const url = URL.createObjectURL(file);
        headshotPreviewRef.current = url;
        setHeadshotPreview(url);

        setStatus(`Headshot uploaded (${file.name})`);
        showToast("Headshot ready");
        await loadHome(eventId, { soft: true });
      } else {
        setStatus(`Slides uploaded (${file.name})`);
        showToast("Slides uploaded");
        await loadHome(eventId, { soft: true });
      }
    } catch {
      setStatus("Network error");
    } finally {
      setFileBusyPurpose(null);
    }
  }

  if (!eventId) {
    return (
      <div
        className="portal-page portal-page--l2"
        data-testid="portal-home"
        data-section="11.6"
        style={portalStyle}
      >
        <div className="portal-card" data-testid="portal-missing-event">
          {/* F1 — Signal mark on the bare programme-chooser card */}
          <div className="role-shell__brand-row">
            <BrandMark size={20} decorative />
            <p className="portal-overline">Speaker portal</p>
          </div>
          <h1 className="portal-title">Choose your programme</h1>
          <p className="portal-subtitle">
            Sign in with the email used for your invitation. We&apos;ll open
            your event automatically — or let you pick if you have more than
            one.
          </p>
          <Link
            className="portal-btn lumen-focusable"
            to="/login"
            data-testid="portal-login-link-no-event"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  if (loadState === "unauthenticated") {
    return (
      <div
        className="portal-page portal-page--l2"
        data-testid="portal-home"
        data-section="11.6"
        style={portalStyle}
      >
        <div className="portal-card" data-testid="portal-unauthenticated">
          <div className="role-shell__brand-row">
            <BrandMark size={20} decorative />
            <p className="portal-overline">Speaker portal</p>
          </div>
          <h1 className="portal-title">Sign in required</h1>
          <p className="portal-subtitle">
            Your session expired or is missing. Request a speaker magic link.
          </p>
          <Link
            className="portal-btn lumen-focusable"
            to={`/login?purpose=speaker&eventId=${encodeURIComponent(eventId)}`}
            data-testid="portal-login-link"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const speakerName = participation?.personName ?? "Speaker";
  const stateLabel = participationStateLabel(participation?.status);
  const inExclusiveOnboarding =
    portalMode === "wizard" || portalMode === "paused";

  return (
    <RoleShell
      role="speaker"
      eventName={home?.eventName ?? null}
      eventId={eventId}
      sections={navSections}
      activeSectionId={activeSection}
      onSectionSelect={selectSection}
      hideSectionNav={inExclusiveOnboarding}
    >
    <div
      className="portal-page portal-page--l2"
      data-testid="portal-home"
      data-section="11.6"
      data-event-id={eventId}
      data-layout={inExclusiveOnboarding ? "onboarding-wizard" : "next-task-first"}
      data-portal-mode={portalMode}
      data-active-section={activeSection}
      style={portalStyle}
    >
      <header className="portal-header" data-testid="portal-header">
        <div>
          <p className="portal-overline" data-testid="portal-event-name">
            {home?.eventName ?? "Speaker portal"}
          </p>
          <p className="portal-muted" data-testid="portal-speaker-name">
            {speakerName}
            {stateLabel ? ` · ${stateLabel}` : ""}
          </p>
        </div>
        {home?.logoFileId ? (
          <img
            className="portal-event-logo"
            data-testid="portal-event-logo"
            src={`/api/public/files/${encodeURIComponent(home.logoFileId)}`}
            alt=""
          />
        ) : null}
      </header>

      {toast ? (
        <div className="portal-toast" data-testid="portal-toast" role="status">
          {toast}
        </div>
      ) : null}

      {loadState === "loading" ? (
        <p className="portal-muted" data-testid="portal-loading">
          Loading your tasks…
        </p>
      ) : null}

      {error ? (
        <p
          className="portal-status portal-status--error"
          data-testid="portal-load-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {loadState === "ready" && home && portalMode === "wizard" ? (
        <div className="portal-home-stack" data-testid="portal-onboarding-stack">
          <OnboardingWizard
            steps={onboardingSteps}
            stepIndex={wizardStepIndex}
            skippedIds={draftState.skippedIds}
            freeformDrafts={draftState.freeformDrafts}
            speakerName={speakerName}
            eventName={home.eventName}
            eventTimezone={home.eventTimezone}
            currentTaskDueAt={
              onboardingSteps[wizardStepIndex]?.taskId
                ? tasks.find(
                    (t) => t.id === onboardingSteps[wizardStepIndex]?.taskId,
                  )?.dueAt ?? null
                : null
            }
            currentTaskStatus={
              onboardingSteps[wizardStepIndex]?.taskId
                ? tasks.find(
                    (t) => t.id === onboardingSteps[wizardStepIndex]?.taskId,
                  )?.status ?? null
                : null
            }
            bio={bio}
            company={company}
            title={title}
            onBioChange={setBio}
            onCompanyChange={setCompany}
            onTitleChange={setTitle}
            onFreeformChange={(stepId, v) => {
              persistDraft({
                ...draftState,
                freeformDrafts: {
                  ...draftState.freeformDrafts,
                  [stepId]: v,
                },
              });
            }}
            headshotPreview={headshotPreview}
            hasHeadshot={Boolean(
              headshotPreview || participation?.headshotFileId,
            )}
            hasSlides={Boolean(slidesFile)}
            headshotStatus={headshotStatus}
            slidesStatus={slidesStatus}
            slidesFileName={slidesFile?.filename ?? null}
            fileBusyPurpose={fileBusyPurpose}
            saving={wizardSaving || profileSaving}
            statusMessage={wizardStatus ?? profileStatus}
            statusOk={wizardStatusOk && profileStatus !== "Bio must be plain text only"}
            onUploadHeadshot={(f) => void uploadFile(f, "headshot")}
            onUploadSlides={(f) => void uploadFile(f, "slides")}
            onSaveDraft={() => void wizardSaveCurrent({ complete: false })}
            onContinue={() => void wizardSaveCurrent({ complete: true })}
            onSkip={onWizardSkip}
            onBack={() =>
              setWizardStepIndex((i) => Math.max(0, i - 1))
            }
            onFinishLater={onWizardFinishLater}
            onJumpToStep={(i) => setWizardStepIndex(i)}
          />
        </div>
      ) : null}

      {loadState === "ready" && home && portalMode === "paused" ? (
        <div className="portal-home-stack" data-testid="portal-paused-stack">
          <OnboardingPausedCard
            speakerName={speakerName}
            eventName={home.eventName}
            percent={wizardProg.percent}
            done={wizardProg.done}
            total={wizardProg.total}
            skippedCount={draftState.skippedIds.length}
            onContinue={onWizardResume}
          />
        </div>
      ) : null}

      {loadState === "ready" && home && portalMode === "review" && activeSection === "portal-home" ? (
        <div className="portal-home-stack">
          {/* Home tab: welcome + progress + next action + tab summaries */}
          <section
            id="portal-home"
            data-testid="portal-section-home"
            aria-label="Home"
          >
          <div
            className="portal-welcome"
            data-testid="portal-welcome"
          >
            <div className="portal-welcome__brand" aria-hidden="true" />
            <p className="portal-welcome__eyebrow">Welcome back</p>
            <h2
              className="portal-welcome__name"
              data-testid="portal-welcome-name"
              tabIndex={-1}
            >
              {speakerName}
            </h2>
            <p className="portal-welcome__state" data-testid="portal-participation-state">
              {stateLabel}
              {participation?.personEmail
                ? ` · ${participation.personEmail}`
                : ""}
            </p>
          </div>

          {needsOnboarding ? (
            <section
              className="portal-card portal-card--highlight"
              data-testid="portal-resume-onboarding"
            >
              <p className="portal-next-kicker">Setup incomplete</p>
              <h2 className="portal-heading portal-heading--next">
                Finish remaining steps
              </h2>
              <p className="portal-muted">
                {wizardProg.done} of {wizardProg.total} steps done
                {draftState.skippedIds.length > 0
                  ? ` · ${draftState.skippedIds.length} skipped`
                  : ""}
                .
              </p>
              <button
                type="button"
                className="portal-btn portal-btn--dominant lumen-focusable"
                data-testid="portal-wizard-resume"
                onClick={() => {
                  setForceReview(false);
                  persistDraft({ ...draftState, paused: false });
                  setWizardStepIndex(
                    pickWizardStepIndex(
                      onboardingSteps,
                      draftState.skippedIds,
                    ),
                  );
                }}
              >
                Continue setup
              </button>
            </section>
          ) : null}

          {/* Progress model */}
          <section
            className="portal-card portal-progress"
            data-testid="portal-progress"
            aria-label="Your progress"
          >
            <div className="portal-progress__header">
              <h2 className="portal-heading">Your progress</h2>
              <span
                className="portal-progress__percent"
                data-testid="portal-progress-percent"
                data-percent={overallProg.percent}
              >
                {overallProg.percent}%
              </span>
            </div>
            <div
              className="portal-progress__track"
              role="progressbar"
              aria-valuenow={overallProg.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Overall readiness"
              data-testid="portal-progress-bar"
            >
              <div
                className="portal-progress__fill"
                style={{ width: `${overallProg.percent}%` }}
              />
            </div>
            <p className="portal-muted" data-testid="portal-progress-summary">
              Profile {overallProg.profileDone} of {overallProg.profileTotal}
              {tasksProg.total > 0
                ? ` · Tasks ${tasksProg.completed} of ${tasksProg.completed + tasksProg.pending}`
                : ""}
            </p>
            <ul
              className="portal-progress__steps"
              data-testid="portal-profile-steps"
            >
              {profileSteps.map((step) => (
                <li
                  key={step.id}
                  className={
                    step.done
                      ? "portal-progress__step portal-progress__step--done"
                      : "portal-progress__step"
                  }
                  data-testid={`portal-profile-step-${step.id}`}
                  data-done={step.done ? "true" : "false"}
                >
                  <span className="portal-progress__step-label">{step.label}</span>
                  <span className="portal-progress__step-why">{step.why}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* G01 — next action from single readiness contract (review mode only) */}
          <section
            className={
              nextTask && (home?.readiness?.profileComplete ?? true)
                ? "portal-card portal-card--highlight portal-card--next-dominant"
                : home?.readiness?.state === "complete"
                  ? "portal-card portal-card--highlight portal-card--celebrate"
                  : "portal-card portal-card--highlight"
            }
            id="portal-next-task"
            data-testid="portal-next-task"
            data-readiness={home?.readiness?.state ?? "needs_action"}
          >
            <p className="portal-next-kicker" data-testid="portal-next-kicker">
              {home?.readiness?.headline ??
                (nextTask ? "Your next step" : "Status")}
            </p>
            <h2 className="portal-heading portal-heading--next">
              {home?.readiness?.state === "complete"
                ? "All set"
                : home?.readiness?.state === "waiting_on_organiser"
                  ? "Waiting on organiser"
                  : nextTask
                    ? "Next up"
                    : "Action needed"}
            </h2>
            {nextTask && (home?.readiness?.profileComplete ?? true) ? (
              <div data-testid="portal-next-task-card">
                <p
                  className="portal-next-title"
                  data-testid="portal-next-task-title"
                >
                  {nextTask.title}
                </p>
                {nextTask.description ? (
                  <p className="portal-muted">{nextTask.description}</p>
                ) : null}
                {nextTask.linkUrl ? (
                  <p className="portal-task__link">
                    <a
                      className="eval-queue__link lumen-focusable"
                      data-testid="portal-next-task-link"
                      href={nextTask.linkUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open resource
                    </a>
                  </p>
                ) : null}
                <div className="portal-row">
                  {nextTask.required ? (
                    <span
                      className="portal-status-chip lumen-status lumen-status--danger"
                      data-testid="portal-next-task-required"
                      title="This task must be finished before you're ready"
                    >
                      Required
                    </span>
                  ) : null}
                  <span
                    className={statusBadgeClass(taskDisplayStatus(nextTask))}
                    data-testid="portal-next-task-status"
                    data-status={taskDisplayStatus(nextTask)}
                  >
                    {taskDisplayStatus(nextTask)}
                  </span>
                  {nextTask.dueAt ? (
                    <span
                      className="portal-muted"
                      data-testid="portal-next-task-due"
                    >
                      Due {formatTaskDue(nextTask.dueAt, home?.eventTimezone)}
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="portal-btn portal-btn--dominant lumen-focusable"
                  data-testid="portal-next-task-complete"
                  disabled={completingIds.has(nextTask.id)}
                  onClick={() => void completeTask(nextTask)}
                >
                  Mark complete
                </button>
              </div>
            ) : home?.readiness?.state === "complete" ? (
              <div
                className="portal-celebrate"
                data-testid="portal-next-task-empty"
                data-readiness="complete"
              >
                <p className="portal-celebrate__title">
                  {home.readiness.detail}
                </p>
              </div>
            ) : (
              <div data-testid="portal-next-task-empty" data-readiness={home?.readiness?.state}>
                <p className="portal-celebrate__title">
                  {home?.readiness?.detail ??
                    "Complete your profile to continue."}
                </p>
                {needsOnboarding ? (
                  <button
                    type="button"
                    className="portal-btn lumen-focusable"
                    data-testid="portal-next-profile-cta"
                    onClick={() => {
                      setForceReview(false);
                      persistDraft({ ...draftState, paused: false });
                    }}
                  >
                    Continue setup
                  </button>
                ) : null}
              </div>
            )}
          </section>
          {/* Quick look across the other tabs — each card opens its tab */}
          <section
            className="portal-summary"
            aria-label="Your portal at a glance"
            data-testid="portal-summary-cards"
          >
            <button
              type="button"
              className="portal-summary__card lumen-focusable"
              data-testid="portal-summary-profile"
              onClick={() => selectSection("portal-profile", { focus: "bio" })}
            >
              <span className="portal-summary__label">Profile</span>
              <span className="portal-summary__value">
                {overallProg.profileDone >= overallProg.profileTotal
                  ? "Profile complete"
                  : `${overallProg.profileDone} of ${overallProg.profileTotal} details added`}
              </span>
              <span className="portal-summary__hint">
                Update profile — bio, headshot and slides
              </span>
            </button>
            <button
              type="button"
              className="portal-summary__card lumen-focusable"
              data-testid="portal-summary-tasks"
              onClick={() => selectSection("portal-tasks")}
            >
              <span className="portal-summary__label">Tasks</span>
              <span className="portal-summary__value">
                {tasksProg.completed + tasksProg.pending === 0
                  ? "No tasks yet"
                  : tasksProg.pending === 0
                    ? "All tasks done"
                    : `${tasksProg.completed} of ${tasksProg.completed + tasksProg.pending} tasks done`}
              </span>
              <span className="portal-summary__hint">
                Everything the organisers have asked for
              </span>
            </button>
            <button
              type="button"
              className="portal-summary__card lumen-focusable"
              data-testid="portal-summary-sessions"
              onClick={() => selectSection("portal-sessions")}
            >
              <span className="portal-summary__label">Sessions</span>
              <span className="portal-summary__value">
                {sessions.length === 0
                  ? "No sessions yet"
                  : (() => {
                      const scheduled = sessions.filter(
                        (s) => s.placement,
                      ).length;
                      if (scheduled === 0) {
                        return sessions.length === 1
                          ? "1 session — time coming soon"
                          : `${sessions.length} sessions — times coming soon`;
                      }
                      if (scheduled === sessions.length) {
                        return scheduled === 1
                          ? "1 session scheduled"
                          : `${scheduled} sessions scheduled`;
                      }
                      return `${scheduled} of ${sessions.length} sessions scheduled`;
                    })()}
              </span>
              <span className="portal-summary__hint">
                Times, rooms and calendar invites
              </span>
            </button>
          </section>
          </section>{/* end #portal-home */}
        </div>
      ) : null}

      {/* Profile tab: bio form + files (headshot & slides) */}
      {loadState === "ready" && home && portalMode === "review" && activeSection === "portal-profile" ? (
        <div className="portal-home-stack">
          <section
            className="portal-card"
            id="portal-profile"
            data-testid="portal-profile"
          >
            <h2 className="portal-heading" tabIndex={-1}>Profile</h2>
            <p className="portal-muted">
              {speakerName}
              {participation?.personEmail
                ? ` · ${participation.personEmail}`
                : ""}
            </p>
            {!participation ? (
              <div
                className="portal-status portal-status--error"
                data-testid="portal-bio-no-participation"
                role="alert"
              >
                <p>
                  No speaker record is linked to this sign-in for this event.
                  Save and file upload are disabled until the invitation email
                  matches your account.
                </p>
                <p className="portal-muted">
                  Sign out and use the email from your invitation, or ask the
                  organiser to re-send your speaker invite.
                </p>
              </div>
            ) : null}
            <form
              className="portal-form"
              data-testid="portal-bio-form"
              onSubmit={(ev) => void onSaveProfile(ev)}
            >
              <label
                className="portal-label"
                id="portal-bio-label"
                htmlFor="portal-bio"
              >
                Bio
              </label>
              <p className="portal-field-why">
                Shown on the public programme when published.
              </p>
              {/* F2: compact rich editor (bio schema — no headings/images).
                  The API rejects anything outside the allowlist. */}
              <RichTextEditor
                id="portal-bio"
                context="bio"
                variant="compact"
                value={bioRich}
                onChange={setBioRich}
                ariaLabelledBy="portal-bio-label"
                maxChars={8000}
                disabled={!participation}
                placeholder="Short bio for the programme"
                data-testid="portal-bio-input"
              />
              {/* Display as text only — React text children, never HTML injection */}
              <p className="portal-muted" data-testid="portal-bio-preview">
                Preview: {richTextToPlainText(bioRich) || "—"}
              </p>

              <label className="portal-label" htmlFor="portal-company">
                Company
              </label>
              <p className="portal-field-why">
                Public affiliation for the speaker listing.
              </p>
              <input
                id="portal-company"
                className="portal-input lumen-focusable"
                data-testid="portal-company-input"
                value={company}
                onChange={(ev) => setCompany(ev.target.value)}
                maxLength={200}
                disabled={!participation}
              />

              <label className="portal-label" htmlFor="portal-title">
                Title
              </label>
              <p className="portal-field-why">
                Public role label next to your name.
              </p>
              <input
                id="portal-title"
                className="portal-input lumen-focusable"
                data-testid="portal-title-input"
                value={title}
                onChange={(ev) => setTitle(ev.target.value)}
                maxLength={200}
                disabled={!participation}
              />
              <button
                type="submit"
                className="portal-btn lumen-focusable"
                data-testid="portal-bio-save"
                disabled={profileSaving || !participation}
              >
                {profileSaving ? "Saving…" : "Save profile"}
              </button>
              {profileStatus ? (
                <p
                  className={
                    profileStatus === "Saved"
                      ? "portal-status portal-status--ok"
                      : "portal-status portal-status--error"
                  }
                  data-testid="portal-bio-status"
                  role="status"
                >
                  {profileStatus}
                </p>
              ) : null}
            </form>

            {/* Headshot + slides belong in Profile (same tab as bio) */}
            <div className="portal-files" id="portal-files" data-testid="portal-files">
              <h3 className="portal-subheading">Programme files</h3>
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
                disabled={!participation}
                disabledReason={
                  !participation
                    ? "Link your invitation email before uploading."
                    : null
                }
                busy={fileBusyPurpose === "headshot"}
                status={headshotStatus}
                previewUrl={headshotPreview}
                hasFile={Boolean(
                  headshotPreview || participation?.headshotFileId,
                )}
                onFile={(f) => void uploadFile(f, "headshot")}
              />

              <PortalFileField
                fieldTestId="portal-slides"
                inputTestId="portal-slides-input"
                chooseTestId="portal-slides-choose"
                statusTestId="portal-slides-status"
                title="Slides"
                hint="PDF only · max 10 MiB · private to organisers"
                privacyNote="Private to organisers — not published on the public CFP."
                accept="application/pdf"
                disabled={!participation}
                disabledReason={
                  !participation
                    ? "Link your invitation email before uploading."
                    : null
                }
                busy={fileBusyPurpose === "slides"}
                status={
                  slidesStatus ??
                  (slidesFile
                    ? `On file: ${slidesFile.filename ?? "slides.pdf"}`
                    : null)
                }
                hasFile={Boolean(slidesFile)}
                onFile={(f) => void uploadFile(f, "slides")}
              />
            </div>
          </section>
        </div>
      ) : null}

      {/* Tasks tab */}
      {loadState === "ready" && home && portalMode === "review" && activeSection === "portal-tasks" ? (
        <div className="portal-home-stack">
          <section
            className="portal-card"
            id="portal-tasks"
            data-testid="portal-tasks"
          >
            <h2 className="portal-heading" tabIndex={-1}>All tasks</h2>
            {tasks.length === 0 ? (
              <EmptyState
                data-testid="portal-tasks-empty"
                icon="inbox"
                title="No tasks yet"
                description="When the organisers ask for something — a bio, slides, a confirmation — it will appear here with its due date."
              />
            ) : (
              <ul className="portal-task-list" data-testid="portal-task-list">
                {tasks.map((t) => {
                  const display = taskDisplayStatus(t);
                  return (
                    <li
                      key={t.id}
                      className={
                        display === "overdue"
                          ? "portal-task portal-task--overdue"
                          : "portal-task"
                      }
                      data-testid={`portal-task-${t.id}`}
                      data-task-status={display}
                      data-task-id={t.id}
                    >
                      <div className="portal-task__main">
                        <span className="portal-task__title">{t.title}</span>
                        {t.required ? (
                          <span
                            className="portal-status-chip lumen-status lumen-status--danger"
                            data-testid={`portal-task-required-${t.id}`}
                            title="This task must be finished before you're ready"
                          >
                            Required
                          </span>
                        ) : null}
                        <span
                          className={statusBadgeClass(display)}
                          data-testid={`portal-task-status-${t.id}`}
                        >
                          {display}
                        </span>
                      </div>
                      {t.dueAt ? (
                        <p className="portal-muted portal-task__due">
                          Due {formatTaskDue(t.dueAt, home?.eventTimezone)}
                        </p>
                      ) : null}
                      {t.linkUrl ? (
                        <p className="portal-task__link">
                          <a
                            className="eval-queue__link lumen-focusable"
                            data-testid={`portal-task-link-${t.id}`}
                            href={t.linkUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open resource
                          </a>
                        </p>
                      ) : null}
                      {display === "pending" || display === "overdue" ? (
                        <button
                          type="button"
                          className="portal-btn portal-btn--secondary lumen-focusable"
                          data-testid={`portal-task-complete-${t.id}`}
                          disabled={completingIds.has(t.id)}
                          onClick={() => void completeTask(t)}
                        >
                          Complete
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      ) : null}

      {/* Sessions tab */}
      {loadState === "ready" && home && portalMode === "review" && activeSection === "portal-sessions" ? (
        <div className="portal-home-stack">
          <section
            className="portal-card"
            id="portal-sessions"
            data-testid="portal-sessions"
          >
            <h2 className="portal-heading" tabIndex={-1}>Your sessions</h2>
            {sessions.length === 0 ? (
              <EmptyState
                data-testid="portal-sessions-empty"
                icon="calendar"
                title="No sessions linked yet"
                description="Once the organisers place your talk on the programme, its time, room and calendar invite will show here."
              />
            ) : (
              <ul
                className="portal-session-list"
                data-testid="portal-session-list"
              >
                {sessions.map((s) => {
                  const place = s.placement ?? null;
                  let whenWhere =
                    "Not scheduled yet — organisers will place this session.";
                  if (place) {
                    // Event-local time with a short zone label (B1) — a bare
                    // viewer-local "3:00 AM" reads as a bug.
                    whenWhere = formatSessionRange(
                      place.startsAt,
                      place.endsAt,
                      home.eventTimezone,
                    );
                    if (place.roomName) {
                      whenWhere += ` · ${place.roomName}`;
                    }
                  }
                  return (
                    <li
                      key={s.id}
                      className="portal-session"
                      data-testid={`portal-session-${s.id}`}
                      data-session-id={s.id}
                      data-has-placement={place ? "true" : "false"}
                    >
                      <span className="portal-session__title">{s.title}</span>
                      <span
                        className={statusBadgeClass(
                          s.status === "confirmed" ? "completed" : "pending",
                        )}
                        data-testid={`portal-session-status-${s.id}`}
                        data-session-status={s.status}
                      >
                        {s.status}
                      </span>
                      <p
                        className="portal-muted portal-session__when"
                        data-testid={`portal-session-when-${s.id}`}
                      >
                        {whenWhere}
                      </p>
                      {place ? (
                        // Real download (Portal.SessionIcs, G09) — a plain
                        // anchor is correct here: it streams text/calendar
                        // with an attachment disposition, not SPA navigation.
                        <a
                          className="portal-session__ics lumen-focusable"
                          href={`/api/portal/sessions/${encodeURIComponent(s.id)}/invite.ics?eventId=${encodeURIComponent(eventId)}`}
                          download="invite.ics"
                          data-testid={`portal-session-ics-${s.id}`}
                        >
                          Add to calendar (.ics)
                        </a>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            <p
              className="portal-muted portal-sessions-note"
              data-testid="portal-sessions-privacy"
            >
              Only your own sessions are shown.
            </p>
          </section>
        </div>
      ) : null}

      {/* Mobile bottom navigation — hidden during exclusive onboarding */}
      {!inExclusiveOnboarding ? (
        <nav
          className="portal-bottom-nav"
          aria-label="Portal primary"
          data-testid="portal-bottom-nav"
        >
          {PORTAL_SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`portal-bottom-nav__link lumen-focusable${
                activeSection === s.id ? " portal-bottom-nav__link--active" : ""
              }`}
              data-testid={`portal-bottom-${s.id.replace("portal-", "")}`}
              aria-current={activeSection === s.id ? "page" : undefined}
              onClick={() => selectSection(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>
      ) : null}
    </div>
    </RoleShell>
  );
}
