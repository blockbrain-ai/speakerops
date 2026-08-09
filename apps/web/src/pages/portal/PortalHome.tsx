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
 * Lumen 2 (page-atlas /portal):
 * - Branded welcome + participation state
 * - Progress model (profile + tasks)
 * - Dominant next-task card
 * - Mobile-first; bottom nav on narrow viewports
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
  type ProgramSessionDto,
} from "@speakerops/shared";
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

export function PortalHomePage() {
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get("eventId")?.trim() || "";

  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [home, setHome] = useState<PortalHomeResponse | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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
  const [fileBusy, setFileBusy] = useState(false);

  // Task complete busy set
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set());

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

  const loadHome = useCallback(async (eid: string) => {
    setLoadState("loading");
    setError(null);
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
        setError(env.success ? env.data.error : `Load failed (${res.status})`);
        setLoadState("error");
        return;
      }
      const parsed = PortalHomeResponseSchema.safeParse(raw);
      if (!parsed.success) {
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
  const sessions: ProgramSessionDto[] = home?.sessions ?? [];
  const nextTask = useMemo(
    () => (home ? pickNextIncomplete(home.tasks) : null),
    [home],
  );

  const profileSteps = useMemo(
    () => profileProgressSteps(participation),
    [participation],
  );
  const tasksProg = useMemo(() => taskProgress(tasks), [tasks]);
  const overallProg = useMemo(
    () => overallPortalProgress(participation, tasks),
    [participation, tasks],
  );

  /** Brand token surface: Lumen brand CSS variables (portal/public scope only). */
  const portalStyle = useMemo((): CSSProperties => {
    return {
      // Speaker surface may use brand tokens (E6 / Lumen lock blast radius)
      ["--lumen-brand" as string]: "var(--lumen-brand)",
      ["--lumen-brand-soft" as string]: "var(--lumen-brand-soft)",
    };
  }, []);

  async function onSaveProfile(e: FormEvent) {
    e.preventDefault();
    if (!participation || !eventId) return;
    setProfileSaving(true);
    setProfileStatus(null);
    const cleanBio = sanitizeBioText(bio);
    if (!bioIsPlainText(cleanBio)) {
      setProfileStatus("Bio must be plain text only");
      setProfileSaving(false);
      return;
    }
    try {
      const res = await fetch(
        `/api/portal/participations/${encodeURIComponent(participation.id)}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            bio: cleanBio,
            company: company.trim() || null,
            title: title.trim() || null,
            expectedVersion: participation.version,
          }),
        },
      );
      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setProfileStatus(
          env.success ? env.data.error : `Save failed (${res.status})`,
        );
        setProfileSaving(false);
        return;
      }
      const parsed = ParticipationUpdateProfileResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setProfileStatus("Unexpected profile response");
        setProfileSaving(false);
        return;
      }
      // Re-bind local form from server (sanitized text)
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
      setProfileStatus("Saved");
      showToast("Profile saved");
    } catch {
      setProfileStatus("Network error");
    } finally {
      setProfileSaving(false);
    }
  }

  async function completeTask(task: PortalTaskDto) {
    if (!home) return;
    if (completingIds.has(task.id)) return;
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
        return;
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
        return;
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
    setFileBusy(true);
    if (purpose === "headshot") setHeadshotStatus(null);
    else setSlidesStatus(null);

    const setStatus = purpose === "headshot" ? setHeadshotStatus : setSlidesStatus;

    const mime = resolveUploadMime(file, purpose);
    if (purpose === "headshot" && !isAllowedHeadshotMime(mime)) {
      setStatus("Headshot must be JPEG or PNG");
      setFileBusy(false);
      return;
    }
    if (purpose === "slides" && !isAllowedSlidesMime(mime)) {
      setStatus("Slides must be PDF");
      setFileBusy(false);
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
        setFileBusy(false);
        return;
      }
      const presign = FilePresignResponseSchema.safeParse(presignRaw);
      if (!presign.success) {
        setStatus("Unexpected presign response");
        setFileBusy(false);
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
        setFileBusy(false);
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
        setFileBusy(false);
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
          setFileBusy(false);
          return;
        }
        const parsed =
          ParticipationUpdateProfileResponseSchema.safeParse(patchRaw);
        if (!parsed.success) {
          setStatus("Unexpected profile update response");
          setFileBusy(false);
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
      } else {
        setStatus(`Slides uploaded (${file.name})`);
        showToast("Slides uploaded");
      }
    } catch {
      setStatus("Network error");
    } finally {
      setFileBusy(false);
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
          <h1 className="portal-title">Choose an event</h1>
          <p className="portal-subtitle">
            Open your magic link with an event, or append{" "}
            <code>?eventId=…</code> to this URL.
          </p>
          <p className="portal-muted">
            <Link className="portal-link lumen-focusable" to="/login?purpose=speaker">
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

  return (
    <div
      className="portal-page portal-page--l2"
      data-testid="portal-home"
      data-section="11.6"
      data-event-id={eventId}
      data-layout="next-task-first"
      style={portalStyle}
    >
      {/* Desktop / tablet compact top nav */}
      <header className="portal-header" data-testid="portal-header">
        <div>
          <p className="portal-overline">Speaker portal</p>
          <h1 className="portal-title">Your programme home</h1>
        </div>
        <nav
          className="portal-nav portal-nav--top"
          aria-label="Portal sections"
          data-testid="portal-nav-top"
        >
          <a className="portal-nav__link lumen-focusable" href="#portal-home-top">
            Home
          </a>
          <a className="portal-nav__link lumen-focusable" href="#portal-tasks">
            Tasks
          </a>
          <a className="portal-nav__link lumen-focusable" href="#portal-profile">
            Profile
          </a>
          <a className="portal-nav__link lumen-focusable" href="#portal-sessions">
            My sessions
          </a>
        </nav>
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

      {loadState === "ready" && home ? (
        <div className="portal-home-stack" id="portal-home-top">
          {/* Branded welcome */}
          <section
            className="portal-welcome"
            data-testid="portal-welcome"
            aria-label="Welcome"
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
          </section>

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

          {/* G01 — next incomplete task (dominant) */}
          <section
            className={
              nextTask
                ? "portal-card portal-card--highlight portal-card--next-dominant"
                : "portal-card portal-card--highlight portal-card--celebrate"
            }
            id="portal-next-task"
            data-testid="portal-next-task"
          >
            <p className="portal-next-kicker" data-testid="portal-next-kicker">
              {nextTask ? "Your next step" : "You are ready"}
            </p>
            <h2 className="portal-heading portal-heading--next">
              {nextTask ? "Next up" : "All set"}
            </h2>
            {nextTask ? (
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
            ) : (
              <div
                className="portal-celebrate"
                data-testid="portal-next-task-empty"
              >
                <p className="portal-celebrate__title">
                  All tasks complete. You are ready.
                </p>
                <p className="portal-muted">
                  Keep your profile current and check session details below.
                </p>
              </div>
            )}
          </section>

          {/* G02 — profile bio */}
          <section
            className="portal-card"
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
          </section>

          {/* G03 / G04 — files */}
          <section
            className="portal-card"
            id="portal-files"
            data-testid="portal-files"
          >
            <h2 className="portal-heading">Files</h2>

            <div className="portal-file-block" data-testid="portal-headshot">
              <h3 className="portal-subheading">Headshot</h3>
              <p className="portal-muted">
                JPEG or PNG · max 10 MiB · public portrait for the programme
              </p>
              <input
                type="file"
                accept="image/jpeg,image/png"
                className="portal-file-input lumen-focusable"
                data-testid="portal-headshot-input"
                disabled={fileBusy}
                onChange={(ev) => {
                  const f = ev.target.files?.[0];
                  if (f) void uploadFile(f, "headshot");
                  ev.target.value = "";
                }}
              />
              {headshotPreview ? (
                <img
                  className="portal-headshot-preview"
                  data-testid="portal-headshot-preview"
                  src={headshotPreview}
                  alt="Headshot preview"
                />
              ) : null}
              {headshotStatus ? (
                <p
                  className="portal-status"
                  data-testid="portal-headshot-status"
                  role="status"
                >
                  {headshotStatus}
                </p>
              ) : null}
            </div>

            <div className="portal-file-block" data-testid="portal-slides">
              <h3 className="portal-subheading">Slides</h3>
              <p className="portal-muted">PDF only · max 10 MiB · private to organisers</p>
              <input
                type="file"
                accept="application/pdf"
                className="portal-file-input lumen-focusable"
                data-testid="portal-slides-input"
                disabled={fileBusy}
                onChange={(ev) => {
                  const f = ev.target.files?.[0];
                  if (f) void uploadFile(f, "slides");
                  ev.target.value = "";
                }}
              />
              {slidesStatus ? (
                <p
                  className="portal-status"
                  data-testid="portal-slides-status"
                  role="status"
                >
                  {slidesStatus}
                </p>
              ) : null}
            </div>
          </section>

          {/* G05 / G06 — tasks list */}
          <section
            className="portal-card"
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

          {/* G07 — own sessions only */}
          <section
            className="portal-card"
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
                {sessions.map((s) => (
                  <li
                    key={s.id}
                    className="portal-session"
                    data-testid={`portal-session-${s.id}`}
                    data-session-id={s.id}
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
                  </li>
                ))}
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

      {/* Mobile bottom navigation (page-atlas) */}
      <nav
        className="portal-bottom-nav"
        aria-label="Portal primary"
        data-testid="portal-bottom-nav"
      >
        <a
          className="portal-bottom-nav__link lumen-focusable"
          href="#portal-home-top"
          data-testid="portal-bottom-home"
        >
          Home
        </a>
        <a
          className="portal-bottom-nav__link lumen-focusable"
          href="#portal-next-task"
          data-testid="portal-bottom-next"
        >
          Next
        </a>
        <a
          className="portal-bottom-nav__link lumen-focusable"
          href="#portal-tasks"
          data-testid="portal-bottom-tasks"
        >
          Tasks
        </a>
        <a
          className="portal-bottom-nav__link lumen-focusable"
          href="#portal-profile"
          data-testid="portal-bottom-profile"
        >
          Profile
        </a>
        <a
          className="portal-bottom-nav__link lumen-focusable"
          href="#portal-sessions"
          data-testid="portal-bottom-sessions"
        >
          Sessions
        </a>
      </nav>
    </div>
  );
}
