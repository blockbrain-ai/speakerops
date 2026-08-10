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
 * - Full multi-section layout only after onboarding is complete (or review mode)
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
} from "@speakerops/shared";
import { RoleShell } from "../../layout/RoleShell.js";
import { PortalFileField } from "../../components/portal/PortalFileField.js";
import {
  OnboardingWizard,
  OnboardingPausedCard,
} from "./OnboardingWizard.js";
import {
  sanitizeBioText,
  bioIsPlainText,
  taskDisplayStatus,
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
  switch (status) {
    case "completed":
      return "lumen-status lumen-status--success";
    case "overdue":
      return "lumen-status lumen-status--danger";
    case "cancelled":
      return "lumen-status lumen-status--info";
    default:
      return "lumen-status lumen-status--warn";
  }
}

const PORTAL_SECTIONS = [
  { id: "portal-home", label: "Home", testId: "portal-nav-home" },
  { id: "portal-profile", label: "Profile", testId: "portal-nav-profile" },
  { id: "portal-tasks", label: "Tasks", testId: "portal-nav-tasks" },
  { id: "portal-sessions", label: "Sessions", testId: "portal-nav-sessions" },
] as const;

export function PortalHomePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const eventId = searchParams.get("eventId")?.trim() || "";
  const sectionParam = searchParams.get("section")?.trim() || "";

  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [home, setHome] = useState<PortalHomeResponse | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState("portal-home");
  const [sectionFlash, setSectionFlash] = useState<string | null>(null);

  // Profile form
  const [bio, setBio] = useState("");
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

  const selectSection = useCallback(
    (sectionId: string) => {
      setActiveSection(sectionId);
      setSectionFlash(sectionId);
      window.setTimeout(() => setSectionFlash(null), 450);
      const next = new URLSearchParams(searchParams);
      if (eventId) next.set("eventId", eventId);
      next.set("section", sectionId.replace(/^portal-/, ""));
      setSearchParams(next, { replace: true });
      const el = document.getElementById(sectionId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        // Profile: focus bio so "Update profile" lands in the editable form
        if (sectionId === "portal-profile") {
          window.setTimeout(() => {
            const bioEl = document.getElementById("portal-bio");
            if (bioEl instanceof HTMLElement) {
              bioEl.focus({ preventScroll: true });
            }
          }, 320);
        } else {
          const heading = el.querySelector("h2, h1");
          if (heading instanceof HTMLElement) {
            heading.setAttribute("tabindex", "-1");
            heading.focus({ preventScroll: true });
          }
        }
      }
    },
    [eventId, searchParams, setSearchParams],
  );

  // Deep link + IntersectionObserver for active section
  useEffect(() => {
    if (loadState !== "ready") return;
    const map: Record<string, string> = {
      home: "portal-home",
      profile: "portal-profile",
      tasks: "portal-tasks",
      sessions: "portal-sessions",
    };
    const fromQuery = sectionParam ? map[sectionParam] : null;
    if (fromQuery) {
      setActiveSection(fromQuery);
      window.requestAnimationFrame(() => {
        document.getElementById(fromQuery)?.scrollIntoView({ block: "start" });
      });
    }
  }, [loadState, sectionParam]);

  useEffect(() => {
    if (loadState !== "ready") return;
    const ids = PORTAL_SECTIONS.map((s) => s.id);
    const els = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (els.length === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target?.id) {
          setActiveSection(visible[0].target.id);
        }
      },
      { rootMargin: "-20% 0px -55% 0px", threshold: [0.1, 0.35, 0.6] },
    );
    for (const el of els) obs.observe(el);
    return () => obs.disconnect();
  }, [loadState, home]);

  async function patchProfileFields(fields: {
    bio?: string | null;
    company?: string | null;
    title?: string | null;
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!participation || !eventId) {
      return { ok: false, error: "No speaker record linked" };
    }
    const body: Record<string, unknown> = {
      expectedVersion: participation.version,
    };
    if (fields.bio !== undefined) {
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
      bio,
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
          <p className="portal-overline">Speaker portal</p>
          <h1 className="portal-title">Choose your programme</h1>
          <p className="portal-subtitle">
            Sign in with the email used for your invitation. We&apos;ll open
            your event automatically — or let you pick if you have more than
            one.
          </p>
          <p className="portal-muted">
            <Link
              className="portal-link lumen-focusable"
              to="/login"
              data-testid="portal-login-link-no-event"
            >
              Sign in
            </Link>
          </p>
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
          <p className="portal-overline">Speaker portal</p>
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
      sections={[...PORTAL_SECTIONS]}
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

      {loadState === "ready" && home && portalMode === "review" ? (
        <div className="portal-home-stack">
          {/* Home: welcome + progress + next action */}
          <section
            className={`portal-section${sectionFlash === "portal-home" ? " portal-section--flash" : ""}`}
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
            <h2 className="portal-welcome__name" data-testid="portal-welcome-name">
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
                <div className="portal-row">
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
                      Due {new Date(nextTask.dueAt).toLocaleDateString()}
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
          </section>{/* end #portal-home */}

          {/* Profile + files (headshot & slides) — review mode only */}
          <section
            className={`portal-card portal-section${sectionFlash === "portal-profile" ? " portal-section--flash" : ""}`}
            id="portal-profile"
            data-testid="portal-profile"
          >
            <h2 className="portal-heading">Profile</h2>
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
              <label className="portal-label" htmlFor="portal-bio">
                Bio
              </label>
              <p className="portal-field-why">
                Shown on the public programme when published. Plain text only.
              </p>
              <textarea
                id="portal-bio"
                className="portal-textarea lumen-focusable"
                data-testid="portal-bio-input"
                value={bio}
                onChange={(ev) => setBio(ev.target.value)}
                maxLength={8000}
                rows={4}
                disabled={!participation}
                placeholder="Short bio for the programme (plain text only)"
              />
              {/* Display as text only — React text children, never HTML injection */}
              <p className="portal-muted" data-testid="portal-bio-preview">
                Preview: {bio || "—"}
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

          {/* Tasks */}
          <section
            className={`portal-card portal-section${sectionFlash === "portal-tasks" ? " portal-section--flash" : ""}`}
            id="portal-tasks"
            data-testid="portal-tasks"
          >
            <h2 className="portal-heading">All tasks</h2>
            {tasks.length === 0 ? (
              <p className="portal-muted" data-testid="portal-tasks-empty">
                No tasks yet.
              </p>
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
                        <span
                          className={statusBadgeClass(display)}
                          data-testid={`portal-task-status-${t.id}`}
                        >
                          {display}
                        </span>
                      </div>
                      {t.dueAt ? (
                        <p className="portal-muted portal-task__due">
                          Due {new Date(t.dueAt).toLocaleString()}
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

          {/* Sessions */}
          <section
            className={`portal-card portal-section${sectionFlash === "portal-sessions" ? " portal-section--flash" : ""}`}
            id="portal-sessions"
            data-testid="portal-sessions"
          >
            <h2 className="portal-heading">Your sessions</h2>
            {sessions.length === 0 ? (
              <p className="portal-muted" data-testid="portal-sessions-empty">
                No sessions linked yet.
              </p>
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
                    try {
                      const start = new Date(place.startsAt);
                      const end = new Date(place.endsAt);
                      const tz = home.eventTimezone ?? undefined;
                      const fmt: Intl.DateTimeFormatOptions = {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: tz,
                      };
                      whenWhere = `${start.toLocaleString(undefined, fmt)} – ${end.toLocaleTimeString(undefined, { timeStyle: "short", timeZone: tz })}`;
                      if (place.roomName) {
                        whenWhere += ` · ${place.roomName}`;
                      }
                    } catch {
                      whenWhere = `${place.startsAt} – ${place.endsAt}`;
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
              aria-current={activeSection === s.id ? "true" : undefined}
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
