/**
 * Speaker portal pure helpers (section 4.3 / S-PORTAL).
 *
 * - Task display status (overdue visual from dueAt)
 * - Bio XSS: strip/control characters; never treat as HTML
 * - Optimistic complete snapshot / revert helpers
 */

import type { PortalTaskDto, ParticipationProfileDto } from "@speakerops/shared";

/** Display status for task list badges (G05/G06). */
export type TaskDisplayStatus = "pending" | "overdue" | "completed" | "cancelled";

/**
 * Compute visual task status.
 * Pending tasks past dueAt render as overdue (G06).
 */
export function taskDisplayStatus(
  task: Pick<PortalTaskDto, "status" | "dueAt">,
  nowMs: number = Date.now(),
): TaskDisplayStatus {
  const raw = (task.status ?? "").toLowerCase();
  if (raw === "completed") return "completed";
  if (raw === "cancelled") return "cancelled";
  if (raw === "overdue") return "overdue";
  if (raw === "pending" && task.dueAt) {
    const due = Date.parse(task.dueAt);
    if (Number.isFinite(due) && due <= nowMs) return "overdue";
  }
  return "pending";
}

/** True when task still needs speaker action. */
export function isIncompleteTask(task: Pick<PortalTaskDto, "status">): boolean {
  const s = (task.status ?? "").toLowerCase();
  return s === "pending" || s === "overdue";
}

/**
 * Sanitize bio for safe storage/display as text (G02 XSS).
 * - Strips HTML tags and angle brackets
 * - Removes control characters except newline/tab
 * - Never returns markup — callers must render as text nodes only
 */
export function sanitizeBioText(raw: string): string {
  let s = raw;
  // Remove tags first so script bodies remain as plain text without execution
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, "");
  s = s.replace(/[<>]/g, "");
  // Neutralize common XSS remnants that can appear as plain text
  s = s.replace(/javascript\s*:/gi, "");
  s = s.replace(/\bon\w+\s*=/gi, "");
  // Drop control chars except \n \r \t
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  return s.slice(0, 8000);
}

/**
 * Assert bio is plain text for display — no script tags remain.
 * Used by unit tests (assert bio XSS text content not script).
 */
export function bioIsPlainText(bio: string): boolean {
  if (/<script\b/i.test(bio)) return false;
  if (/javascript\s*:/i.test(bio)) return false;
  if (/on\w+\s*=/i.test(bio)) return false;
  return true;
}

/** Snapshot for optimistic complete + revert. */
export type TaskOptimisticSnapshot = {
  taskId: string;
  previous: PortalTaskDto;
  previousNextTask: PortalTaskDto | null;
};

export function applyOptimisticComplete(
  tasks: PortalTaskDto[],
  taskId: string,
  completedAt: string,
): PortalTaskDto[] {
  return tasks.map((t) =>
    t.id === taskId
      ? {
          ...t,
          status: "completed",
          completedAt,
          version: t.version + 1,
        }
      : t,
  );
}

export function revertOptimisticComplete(
  tasks: PortalTaskDto[],
  snapshot: TaskOptimisticSnapshot,
): PortalTaskDto[] {
  return tasks.map((t) =>
    t.id === snapshot.taskId ? snapshot.previous : t,
  );
}

export function pickNextIncomplete(
  tasks: PortalTaskDto[],
  nowMs: number = Date.now(),
): PortalTaskDto | null {
  const pending = tasks.filter((t) => {
    const d = taskDisplayStatus(t, nowMs);
    return d === "pending" || d === "overdue";
  });
  if (pending.length === 0) return null;
  pending.sort((a, b) => {
    const ad = a.dueAt ?? "9999";
    const bd = b.dueAt ?? "9999";
    if (ad !== bd) return ad.localeCompare(bd);
    return a.id.localeCompare(b.id);
  });
  return pending[0] ?? null;
}

/** Primary participation for profile form. */
export function primaryParticipation(
  list: ParticipationProfileDto[],
): ParticipationProfileDto | null {
  return list[0] ?? null;
}

/** Profile completion steps for portal progress (11.6 Lumen 2). */
export type PortalProfileStepId =
  | "bio"
  | "company"
  | "title"
  | "headshot";

export type PortalProfileStep = {
  id: PortalProfileStepId;
  label: string;
  done: boolean;
  /** Why we ask — public vs private (design pack). */
  why: string;
};

/**
 * Discrete profile progress steps — never expose raw task types.
 */
export function profileProgressSteps(
  part: ParticipationProfileDto | null,
): PortalProfileStep[] {
  const has = (v: string | null | undefined) =>
    typeof v === "string" && v.trim().length > 0;
  return [
    {
      id: "bio",
      label: "Bio",
      done: has(part?.bio),
      why: "Shown on the public programme when published.",
    },
    {
      id: "company",
      label: "Company",
      done: has(part?.company),
      why: "Public affiliation for the speaker listing.",
    },
    {
      id: "title",
      label: "Title",
      done: has(part?.title),
      why: "Public role label next to your name.",
    },
    {
      id: "headshot",
      label: "Headshot",
      done: Boolean(part?.headshotFileId),
      why: "Public portrait for the programme page.",
    },
  ];
}

export type PortalTaskProgress = {
  total: number;
  completed: number;
  pending: number;
  percent: number;
};

/** Task completion progress for the branded progress rail. */
export function taskProgress(
  tasks: readonly Pick<PortalTaskDto, "status">[],
): PortalTaskProgress {
  const total = tasks.length;
  let completed = 0;
  let pending = 0;
  for (const t of tasks) {
    const s = (t.status ?? "").toLowerCase();
    if (s === "completed") completed += 1;
    else if (s === "cancelled") {
      /* exclude from pending */
    } else pending += 1;
  }
  const denom = completed + pending;
  const percent =
    denom === 0 ? 100 : Math.round((completed / denom) * 100);
  return { total, completed, pending, percent };
}

/** Overall portal readiness percent: average of profile + tasks. */
export function overallPortalProgress(
  part: ParticipationProfileDto | null,
  tasks: readonly Pick<PortalTaskDto, "status">[],
): { percent: number; profileDone: number; profileTotal: number } {
  const steps = profileProgressSteps(part);
  const profileDone = steps.filter((s) => s.done).length;
  const profileTotal = steps.length;
  const profilePct =
    profileTotal === 0 ? 100 : Math.round((profileDone / profileTotal) * 100);
  const tasksPct = taskProgress(tasks).percent;
  // Weight tasks slightly higher when they exist
  const percent =
    tasks.length === 0
      ? profilePct
      : Math.round(profilePct * 0.4 + tasksPct * 0.6);
  return { percent, profileDone, profileTotal };
}

/** Human participation state label — no admin-only vocabulary. */
export function participationStateLabel(status: string | null | undefined): string {
  const s = (status ?? "").toLowerCase();
  if (s === "accepted" || s === "confirmed" || s === "active") {
    return "Accepted speaker";
  }
  if (s === "withdrawn") return "Withdrawn";
  if (s === "declined") return "Declined";
  if (!s) return "Participant";
  return "Speaker";
}

/** Hex SHA-256 of file bytes for File.CompleteUpload. */
export async function sha256Hex(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", buf);
    const bytes = new Uint8Array(digest);
    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i]!.toString(16).padStart(2, "0");
    }
    return `sha256:${hex}`;
  }
  // Fallback (non-browser unit envs): length-based opaque checksum
  return `sha256:len${buf.byteLength}`;
}

/** Headshot mime allowlist mirror (shared package is source of truth for API). */
export const PORTAL_HEADSHOT_MIMES = ["image/jpeg", "image/png"] as const;
export const PORTAL_SLIDES_MIMES = ["application/pdf"] as const;

export function isAllowedHeadshotMime(mime: string): boolean {
  return (PORTAL_HEADSHOT_MIMES as readonly string[]).includes(
    mime.trim().toLowerCase(),
  );
}

export function isAllowedSlidesMime(mime: string): boolean {
  return (PORTAL_SLIDES_MIMES as readonly string[]).includes(
    mime.trim().toLowerCase(),
  );
}

/**
 * Resolve effective mime for portal upload (browser may leave type empty).
 * Extension fallback only for known safe extensions — never for .exe/.svg.
 */
export function resolveUploadMime(
  file: Pick<File, "type" | "name">,
  purpose: "headshot" | "slides",
): string {
  const typed = (file.type ?? "").trim().toLowerCase();
  if (typed) return typed;
  const name = file.name.toLowerCase();
  if (purpose === "headshot") {
    if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
    if (name.endsWith(".png")) return "image/png";
  }
  if (purpose === "slides" && name.endsWith(".pdf")) return "application/pdf";
  return typed;
}

/* ─── Onboarding workflow (one step at a time) ─────────────────────────── */

/** What the current wizard step renders. */
export type OnboardingStepKind =
  | "bio"
  | "company"
  | "title"
  | "headshot"
  | "slides"
  /** Free-text answer stored as draft; Continue marks task complete. */
  | "task_text"
  /** Confirm / checkbox-style organiser task. */
  | "task_confirm";

export type OnboardingStep = {
  /** Stable id: `profile:bio` | `task:<taskId>` */
  id: string;
  kind: OnboardingStepKind;
  label: string;
  why: string;
  done: boolean;
  /** Linked speaker task when this step satisfies an organiser checklist item. */
  taskId?: string;
  taskVersion?: number;
  taskTitle?: string;
  taskDescription?: string | null;
};

export type OnboardingDraftState = {
  /** Steps the speaker deferred — resurfaced after non-skipped incomplete steps. */
  skippedIds: string[];
  /** Freeform draft answers keyed by step id (talk description, etc.). */
  freeformDrafts: Record<string, string>;
  /** Speaker chose Save draft / finish later — exclusive form dump stays hidden. */
  paused: boolean;
};

const emptyDraftState = (): OnboardingDraftState => ({
  skippedIds: [],
  freeformDrafts: {},
  paused: false,
});

export function onboardingStorageKey(participationId: string): string {
  return `speakerops:onboarding:${participationId}`;
}

export function loadOnboardingDraft(
  participationId: string | null | undefined,
): OnboardingDraftState {
  if (!participationId || typeof localStorage === "undefined") {
    return emptyDraftState();
  }
  try {
    const raw = localStorage.getItem(onboardingStorageKey(participationId));
    if (!raw) return emptyDraftState();
    const parsed = JSON.parse(raw) as Partial<OnboardingDraftState>;
    return {
      skippedIds: Array.isArray(parsed.skippedIds)
        ? parsed.skippedIds.filter((x): x is string => typeof x === "string")
        : [],
      freeformDrafts:
        parsed.freeformDrafts && typeof parsed.freeformDrafts === "object"
          ? Object.fromEntries(
              Object.entries(parsed.freeformDrafts).filter(
                (e): e is [string, string] => typeof e[1] === "string",
              ),
            )
          : {},
      paused: Boolean(parsed.paused),
    };
  } catch {
    return emptyDraftState();
  }
}

export function saveOnboardingDraft(
  participationId: string,
  state: OnboardingDraftState,
): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      onboardingStorageKey(participationId),
      JSON.stringify(state),
    );
  } catch {
    /* quota / private mode — wizard still works in-memory */
  }
}

/**
 * Classify an organiser task title into a wizard field kind.
 * Profile field kinds let one step both edit the field and complete the task.
 */
export function classifyTaskTitle(title: string): OnboardingStepKind {
  const t = title.trim().toLowerCase();
  if (/\bheadshot\b|\bphoto\b|\bportrait\b|\bavatar\b/.test(t)) {
    return "headshot";
  }
  if (/\bslides?\b|\bpresentation\b|\bdeck\b/.test(t)) {
    return "slides";
  }
  if (/\bbio\b|\bbiograph/.test(t)) {
    return "bio";
  }
  if (/\bcompan(y|ies)\b|\baffiliation\b|\borgani[sz]ation\b/.test(t)) {
    return "company";
  }
  if (/\bjob title\b|\brole title\b|^title\b|\btitle\/role\b/.test(t)) {
    return "title";
  }
  // Talk description / abstract / notes need free text, not a bare complete button.
  if (
    /\btalk\b|\babstract\b|\bdescription\b|\bsession title\b|\bsynopsis\b|\bblurb\b/.test(
      t,
    )
  ) {
    return "task_text";
  }
  if (
    /\bconsent\b|\bagree\b|\bconfirm\b|\bav\b|\bhotel\b|\btravel\b|\bflight\b|\bsocial\b|\bcolleague/.test(
      t,
    )
  ) {
    return "task_confirm";
  }
  // Default free text so speakers always have somewhere to type (never orphan complete).
  return "task_text";
}

function fieldDone(
  part: ParticipationProfileDto | null,
  kind: "bio" | "company" | "title" | "headshot" | "slides",
  files?: readonly { purpose: string; uploaded: boolean }[],
): boolean {
  const has = (v: string | null | undefined) =>
    typeof v === "string" && v.trim().length > 0;
  if (kind === "bio") return has(part?.bio);
  if (kind === "company") return has(part?.company);
  if (kind === "title") return has(part?.title);
  if (kind === "headshot") return Boolean(part?.headshotFileId);
  if (kind === "slides") {
    return Boolean(
      files?.some((f) => f.purpose === "slides" && f.uploaded),
    );
  }
  return false;
}

const PROFILE_ORDER: Array<{
  kind: "bio" | "company" | "title" | "headshot";
  label: string;
  why: string;
}> = [
  {
    kind: "bio",
    label: "Your bio",
    why: "Shown on the public programme when published. Plain text only.",
  },
  {
    kind: "company",
    label: "Company / affiliation",
    why: "Public affiliation for the speaker listing.",
  },
  {
    kind: "title",
    label: "Your title",
    why: "Public role label next to your name.",
  },
  {
    kind: "headshot",
    label: "Headshot",
    why: "Public portrait for the programme page. JPEG or PNG.",
  },
];

/**
 * Ordered onboarding steps: profile fields first, then incomplete tasks
 * not already covered by a profile field step.
 */
export function buildOnboardingSteps(
  part: ParticipationProfileDto | null,
  tasks: readonly PortalTaskDto[],
  files: readonly { purpose: string; uploaded: boolean }[] = [],
): OnboardingStep[] {
  const steps: OnboardingStep[] = [];
  const coveredKinds = new Set<OnboardingStepKind>();

  // Attach incomplete tasks that map to profile kinds onto those steps.
  const incomplete = tasks.filter((t) => isIncompleteTask(t));
  const tasksByKind = new Map<OnboardingStepKind, PortalTaskDto>();
  for (const t of incomplete) {
    const kind = classifyTaskTitle(t.title);
    if (
      kind === "bio" ||
      kind === "company" ||
      kind === "title" ||
      kind === "headshot" ||
      kind === "slides"
    ) {
      if (!tasksByKind.has(kind)) tasksByKind.set(kind, t);
    }
  }

  for (const p of PROFILE_ORDER) {
    const linked = tasksByKind.get(p.kind);
    coveredKinds.add(p.kind);
    const fieldOk = fieldDone(part, p.kind, files);
    // Field filled is not enough when an organiser task is still open —
    // otherwise headshot upload exits the wizard before Continue / task complete.
    const taskOk = !linked || !isIncompleteTask(linked);
    steps.push({
      id: `profile:${p.kind}`,
      kind: p.kind,
      label: p.label,
      why: p.why,
      done: fieldOk && taskOk,
      taskId: linked?.id,
      taskVersion: linked?.version,
      taskTitle: linked?.title,
      taskDescription: linked?.description ?? null,
    });
  }

  // Slides only if there's a slides task or uploaded slides (keep wizard lean).
  const slidesTask = tasksByKind.get("slides");
  const hasSlidesFile = fieldDone(part, "slides", files);
  if (slidesTask || hasSlidesFile) {
    coveredKinds.add("slides");
    steps.push({
      id: slidesTask ? `task:${slidesTask.id}` : "profile:slides",
      kind: "slides",
      label: slidesTask?.title ?? "Upload slides",
      why:
        slidesTask?.description?.trim() ||
        "PDF slides for organisers — private, not public.",
      done: hasSlidesFile && (!slidesTask || !isIncompleteTask(slidesTask)),
      taskId: slidesTask?.id,
      taskVersion: slidesTask?.version,
      taskTitle: slidesTask?.title,
      taskDescription: slidesTask?.description ?? null,
    });
  }

  // Remaining incomplete tasks (not mapped to covered profile kinds).
  for (const t of incomplete) {
    const kind = classifyTaskTitle(t.title);
    if (
      (kind === "bio" ||
        kind === "company" ||
        kind === "title" ||
        kind === "headshot" ||
        kind === "slides") &&
      coveredKinds.has(kind)
    ) {
      // Already represented by a profile step — skip duplicate task step.
      continue;
    }
    const freeform = kind === "task_text" || kind === "task_confirm" ? kind : "task_text";
    steps.push({
      id: `task:${t.id}`,
      kind: freeform,
      label: t.title,
      why:
        t.description?.trim() ||
        (freeform === "task_confirm"
          ? "Confirm this item when you are ready."
          : "Add a short answer for the organisers, or skip and return later."),
      done: false,
      taskId: t.id,
      taskVersion: t.version,
      taskTitle: t.title,
      taskDescription: t.description ?? null,
    });
  }

  return steps;
}

/**
 * Whether the speaker still has unfinished onboarding work.
 */
export function onboardingNeedsWork(steps: readonly OnboardingStep[]): boolean {
  return steps.some((s) => !s.done);
}

/**
 * Pick the next step index to show.
 * Prefer first incomplete that is not skipped; if only skipped remain, return first skipped incomplete.
 */
export function pickWizardStepIndex(
  steps: readonly OnboardingStep[],
  skippedIds: readonly string[],
  preferredId?: string | null,
): number {
  if (steps.length === 0) return 0;
  if (preferredId) {
    const pref = steps.findIndex((s) => s.id === preferredId && !s.done);
    if (pref >= 0) return pref;
  }
  const skipped = new Set(skippedIds);
  const firstOpen = steps.findIndex((s) => !s.done && !skipped.has(s.id));
  if (firstOpen >= 0) return firstOpen;
  const firstSkipped = steps.findIndex((s) => !s.done && skipped.has(s.id));
  if (firstSkipped >= 0) return firstSkipped;
  // All done — park on last
  return Math.max(0, steps.length - 1);
}

export function wizardProgress(
  steps: readonly OnboardingStep[],
): { done: number; total: number; percent: number } {
  const total = steps.length;
  const done = steps.filter((s) => s.done).length;
  const percent = total === 0 ? 100 : Math.round((done / total) * 100);
  return { done, total, percent };
}
