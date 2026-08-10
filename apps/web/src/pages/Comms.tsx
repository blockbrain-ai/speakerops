/**
 * Admin Comms — campaign workflow (section 11.2 / S-L2-COMMS) on top of
 * trust-before-send (section 5.3 / S-COMMS).
 *
 * Steps: Audience → Message → Review → Send
 * Audience: search, status segment, pagination ≤25 (no 150-checkbox wall).
 *
 * Inventory J01–J10. APIs:
 *   PUT  /api/events/:eventId/templates/:key
 *   GET  /api/events/:eventId/templates
 *   POST /api/comms/preview
 *   POST /api/comms/send
 *   GET  /api/events/:eventId/comms/jobs
 *   GET  /api/events/:eventId/comms/jobs/:jobId
 *   GET/POST /api/events/:eventId/comms/ics
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  CommsUpsertTemplateResponseSchema,
  CommsPreviewResponseSchema,
  CommsSendResponseSchema,
  CommsListTemplatesResponseSchema,
  CommsListJobsResponseSchema,
  CommsGetJobResponseSchema,
  CommsListIcsResponseSchema,
  CommsIcsForPlacementResponseSchema,
  AdminSpeakersListResponseSchema,
  extractMergeFields,
  type EmailTemplateDto,
  type CommsPreviewResponse,
  type CommsJobSummary,
  type CommsGetJobResponse,
  type CalendarInviteDto,
  type AdminSpeakerListItem,
} from "@speakerops/shared";
import { useEventContext } from "../events/EventContext.js";
import { Button } from "../components/ui/Button.js";
import { Badge } from "../components/ui/Badge.js";
import { PageHeader } from "../components/ui/PageHeader.js";
import {
  isSendEnabled,
  segmentFingerprint,
  sendDisabledReason,
  newIdempotencyKey,
  AUDIENCE_PAGE_SIZE,
  CAMPAIGN_STEPS,
  filterAudienceSpeakers,
  paginateAudience,
  audienceCount,
  buildCommsSegment,
  canRunCommsPreview,
  previewDisabledReason,
  type CampaignStepId,
  type AudienceSpeakerRow,
} from "./comms-utils.js";

export function CommsPage() {
  const { activeEventId } = useEventContext();

  /**
   * Monotonic load generation + active event id so a slower response for event A
   * cannot overwrite templates/speakers/jobs/invites after switching to event B
   * (stale template pick → preview/send against A while UI shows B).
   */
  const loadGenRef = useRef(0);
  const activeEventIdRef = useRef(activeEventId);
  activeEventIdRef.current = activeEventId;

  // —— Campaign step chrome (AC-11.2-UI) ——
  const [activeStep, setActiveStep] = useState<CampaignStepId>("audience");

  // —— Template editor (J01) ——
  const [key, setKey] = useState("accept-reminder");
  const [subject, setSubject] = useState(
    "Your talk was accepted — {{eventName}}",
  );
  const [body, setBody] = useState(
    "Hi {{name}},\n\nPlease complete your portal tasks for {{eventName}}.\n\nThanks!",
  );
  const [expectedVersion, setExpectedVersion] = useState<number | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<EmailTemplateDto | null>(null);
  const [templateStatus, setTemplateStatus] = useState<
    { kind: "ok" | "error"; text: string } | null
  >(null);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<EmailTemplateDto[]>([]);

  // —— Segment / audience (J02) + scale (AC-11.2-SCALE) ——
  const [segmentStatus, setSegmentStatus] = useState("accepted");
  const [selectedParticipationIds, setSelectedParticipationIds] = useState<
    string[]
  >([]);
  const [speakers, setSpeakers] = useState<AdminSpeakerListItem[]>([]);
  const [speakersError, setSpeakersError] = useState<string | null>(null);
  const [audienceQuery, setAudienceQuery] = useState("");
  const [audiencePage, setAudiencePage] = useState(1);

  // —— Preview (J03) / invalidation (J09) ——
  const [preview, setPreview] = useState<CommsPreviewResponse | null>(null);
  const [previewFingerprint, setPreviewFingerprint] = useState<string | null>(
    null,
  );
  const [previewing, setPreviewing] = useState(false);
  const [previewStatus, setPreviewStatus] = useState<
    { kind: "ok" | "error"; text: string } | null
  >(null);

  // —— Send (J04 / J08) ——
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<
    { kind: "ok" | "error"; text: string } | null
  >(null);
  const [lastIdempotencyKey, setLastIdempotencyKey] = useState<string | null>(
    null,
  );
  const [lastJobId, setLastJobId] = useState<string | null>(null);
  /** Optional ICS attach on Comms.Send (calendar_invite_id). */
  const [attachCalendarInviteId, setAttachCalendarInviteId] = useState<
    string | null
  >(null);

  // —— Delivery log (J05) ——
  const [jobs, setJobs] = useState<CommsJobSummary[]>([]);
  const [selectedJob, setSelectedJob] = useState<CommsGetJobResponse | null>(
    null,
  );
  const [logError, setLogError] = useState<string | null>(null);

  // —— ICS attach (J06 / J10) ——
  const [icsPlacementId, setIcsPlacementId] = useState("plc_fixture_1");
  const [icsSummary, setIcsSummary] = useState("Opening keynote");
  const [icsStartsAt, setIcsStartsAt] = useState("2026-09-01T10:00:00.000Z");
  const [icsEndsAt, setIcsEndsAt] = useState("2026-09-01T11:00:00.000Z");
  const [icsLocation, setIcsLocation] = useState("Main Hall");
  const [invites, setInvites] = useState<CalendarInviteDto[]>([]);
  const [icsStatus, setIcsStatus] = useState<
    { kind: "ok" | "error"; text: string } | null
  >(null);
  const [icsBusy, setIcsBusy] = useState(false);

  const mergeFields = extractMergeFields(subject, body);

  const audienceRows: AudienceSpeakerRow[] = useMemo(
    () =>
      speakers.map((s) => ({
        participationId: s.participation.id,
        name:
          s.participation.personName ??
          s.participation.personEmail ??
          s.participation.id,
        email: s.participation.personEmail ?? null,
        status: s.participation.status,
      })),
    [speakers],
  );

  const filteredAudience = useMemo(
    () =>
      filterAudienceSpeakers(audienceRows, {
        status: segmentStatus,
        query: audienceQuery,
      }),
    [audienceRows, segmentStatus, audienceQuery],
  );

  const audiencePageData = useMemo(
    () => paginateAudience(filteredAudience, audiencePage, AUDIENCE_PAGE_SIZE),
    [filteredAudience, audiencePage],
  );

  // Clamp page when filter shrinks the result set.
  useEffect(() => {
    if (audiencePage !== audiencePageData.page) {
      setAudiencePage(audiencePageData.page);
    }
  }, [audiencePage, audiencePageData.page]);

  const segmentCount = audienceCount({
    selectedParticipationIds,
    filteredTotal: filteredAudience.length,
  });

  /** Effective segment for preview/send — must match displayed audience count. */
  const previewSegment = useMemo(
    () =>
      buildCommsSegment({
        selectedParticipationIds,
        segmentStatus,
        audienceQuery,
        filteredParticipationIds: filteredAudience.map((r) => r.participationId),
      }),
    [
      selectedParticipationIds,
      segmentStatus,
      audienceQuery,
      filteredAudience,
    ],
  );

  const currentFingerprint = useMemo(
    () =>
      segmentFingerprint({
        status: previewSegment.status ?? "",
        participationIds: previewSegment.participationIds ?? [],
        templateId,
        eventId: activeEventId,
        // Search is part of audience rules only when not using explicit selection
        // (selection already pins the set; filter is UI-only then).
        query:
          selectedParticipationIds.length > 0
            ? ""
            : audienceQuery,
      }),
    [
      previewSegment,
      templateId,
      activeEventId,
      selectedParticipationIds.length,
      audienceQuery,
    ],
  );

  const previewValid =
    preview != null &&
    previewFingerprint != null &&
    previewFingerprint === currentFingerprint;

  const previewEnabled = canRunCommsPreview({
    templateId,
    segmentCount,
    previewing,
  });

  const previewBlockReason = previewDisabledReason({
    templateId,
    segmentCount,
    previewing,
  });

  const sendEnabled = isSendEnabled({
    previewId: previewValid ? preview?.previewId ?? null : null,
    previewValid,
    recipientCount: preview?.recipientCount ?? 0,
    sending,
  });

  const sendReason = sendDisabledReason({
    previewId: previewValid ? preview?.previewId ?? null : null,
    previewValid,
    recipientCount: preview?.recipientCount ?? 0,
    sending,
  });

  const invalidatePreview = useCallback(() => {
    setPreview(null);
    setPreviewFingerprint(null);
    setPreviewStatus(null);
    // New audience/template → new send key (prior key was for the old preview).
    setLastIdempotencyKey(null);
  }, []);

  const isCurrentEventLoad = useCallback(
    (eventId: string, gen: number) =>
      gen === loadGenRef.current && activeEventIdRef.current === eventId,
    [],
  );

  const loadTemplates = useCallback(
    async (eventId: string, gen?: number) => {
      const loadGen = gen ?? loadGenRef.current;
      try {
        const res = await fetch(
          `/api/events/${encodeURIComponent(eventId)}/templates`,
          {
            credentials: "include",
            headers: { accept: "application/json" },
          },
        );
        if (!isCurrentEventLoad(eventId, loadGen)) return;
        if (!res.ok) return;
        const raw: unknown = await res.json();
        if (!isCurrentEventLoad(eventId, loadGen)) return;
        const parsed = CommsListTemplatesResponseSchema.safeParse(raw);
        if (parsed.success) {
          setTemplates(parsed.data.templates);
        }
      } catch {
        /* non-fatal */
      }
    },
    [isCurrentEventLoad],
  );

  const loadSpeakers = useCallback(
    async (eventId: string, gen?: number) => {
      const loadGen = gen ?? loadGenRef.current;
      if (isCurrentEventLoad(eventId, loadGen)) {
        setSpeakersError(null);
      }
      try {
        const res = await fetch(
          `/api/events/${encodeURIComponent(eventId)}/speakers`,
          {
            credentials: "include",
            headers: { accept: "application/json" },
          },
        );
        if (!isCurrentEventLoad(eventId, loadGen)) return;
        if (!res.ok) {
          setSpeakersError(`Speakers load failed (${res.status})`);
          setSpeakers([]);
          return;
        }
        const raw: unknown = await res.json();
        if (!isCurrentEventLoad(eventId, loadGen)) return;
        const parsed = AdminSpeakersListResponseSchema.safeParse(raw);
        if (!parsed.success) {
          setSpeakersError("Unexpected speakers response");
          return;
        }
        setSpeakers(parsed.data.speakers);
      } catch {
        if (!isCurrentEventLoad(eventId, loadGen)) return;
        setSpeakersError("Network error loading speakers");
      }
    },
    [isCurrentEventLoad],
  );

  const loadJobs = useCallback(
    async (eventId: string, gen?: number) => {
      const loadGen = gen ?? loadGenRef.current;
      if (isCurrentEventLoad(eventId, loadGen)) {
        setLogError(null);
      }
      try {
        const res = await fetch(
          `/api/events/${encodeURIComponent(eventId)}/comms/jobs`,
          {
            credentials: "include",
            headers: { accept: "application/json" },
          },
        );
        if (!isCurrentEventLoad(eventId, loadGen)) return;
        if (!res.ok) {
          setLogError(`Delivery log failed (${res.status})`);
          return;
        }
        const raw: unknown = await res.json();
        if (!isCurrentEventLoad(eventId, loadGen)) return;
        const parsed = CommsListJobsResponseSchema.safeParse(raw);
        if (!parsed.success) {
          setLogError("Unexpected jobs response");
          return;
        }
        setJobs(parsed.data.jobs);
      } catch {
        if (!isCurrentEventLoad(eventId, loadGen)) return;
        setLogError("Network error loading delivery log");
      }
    },
    [isCurrentEventLoad],
  );

  const loadInvites = useCallback(
    async (eventId: string, gen?: number) => {
      const loadGen = gen ?? loadGenRef.current;
      try {
        const res = await fetch(
          `/api/events/${encodeURIComponent(eventId)}/comms/ics`,
          {
            credentials: "include",
            headers: { accept: "application/json" },
          },
        );
        if (!isCurrentEventLoad(eventId, loadGen)) return;
        if (!res.ok) return;
        const raw: unknown = await res.json();
        if (!isCurrentEventLoad(eventId, loadGen)) return;
        const parsed = CommsListIcsResponseSchema.safeParse(raw);
        if (parsed.success) {
          setInvites(parsed.data.invites);
        }
      } catch {
        /* non-fatal */
      }
    },
    [isCurrentEventLoad],
  );

  // Event switch: clear event-scoped send state so a still-enabled Send cannot
  // submit the prior event's preview while the UI shows the new event.
  // Bump loadGen so in-flight loads for the prior event are ignored on resolve.
  useEffect(() => {
    const gen = ++loadGenRef.current;

    setSelectedParticipationIds([]);
    setTemplateId(null);
    setLastSaved(null);
    setExpectedVersion(null);
    setTemplateStatus(null);
    setPreview(null);
    setPreviewFingerprint(null);
    setPreviewStatus(null);
    setSendStatus(null);
    setLastIdempotencyKey(null);
    setLastJobId(null);
    setSelectedJob(null);
    setLogError(null);
    setIcsStatus(null);
    setSpeakersError(null);
    setSpeakers([]);
    setJobs([]);
    setInvites([]);
    setTemplates([]);
    setAudienceQuery("");
    setAudiencePage(1);
    setActiveStep("audience");

    if (!activeEventId) {
      return;
    }
    void loadTemplates(activeEventId, gen);
    void loadSpeakers(activeEventId, gen);
    void loadJobs(activeEventId, gen);
    void loadInvites(activeEventId, gen);
  }, [activeEventId, loadTemplates, loadSpeakers, loadJobs, loadInvites]);

  const onSaveTemplate = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!activeEventId) return;
      setSaving(true);
      setTemplateStatus(null);
      try {
        const payload: {
          subject: string;
          body: string;
          expectedVersion?: number;
        } = { subject, body };
        if (expectedVersion != null) {
          payload.expectedVersion = expectedVersion;
        }
        const res = await fetch(
          `/api/events/${encodeURIComponent(activeEventId)}/templates/${encodeURIComponent(key)}`,
          {
            method: "PUT",
            credentials: "include",
            headers: {
              "content-type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify(payload),
          },
        );
        const raw: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          const err = raw as { error?: string; code?: string } | null;
          setTemplateStatus({
            kind: "error",
            text: err?.error ?? `Save failed (${res.status})`,
          });
          return;
        }
        const parsed = CommsUpsertTemplateResponseSchema.safeParse(raw);
        if (!parsed.success) {
          setTemplateStatus({
            kind: "error",
            text: "Unexpected template response",
          });
          return;
        }
        setLastSaved(parsed.data.template);
        setExpectedVersion(parsed.data.template.version);
        setTemplateId(parsed.data.template.id);
        setSubject(parsed.data.template.subject);
        setBody(parsed.data.template.body);
        setTemplateStatus({
          kind: "ok",
          text: `Template “${parsed.data.template.key}” saved (v${parsed.data.template.version})`,
        });
        // Template id change invalidates preview
        invalidatePreview();
        void loadTemplates(activeEventId);
      } catch {
        setTemplateStatus({ kind: "error", text: "Network error" });
      } finally {
        setSaving(false);
      }
    },
    [
      activeEventId,
      key,
      subject,
      body,
      expectedVersion,
      invalidatePreview,
      loadTemplates,
    ],
  );

  const selectTemplate = useCallback(
    (tpl: EmailTemplateDto) => {
      setKey(tpl.key);
      setSubject(tpl.subject);
      setBody(tpl.body);
      setExpectedVersion(tpl.version);
      setTemplateId(tpl.id);
      setLastSaved(tpl);
      invalidatePreview();
    },
    [invalidatePreview],
  );

  const onPreview = useCallback(async () => {
    if (!activeEventId || !templateId) {
      setPreviewStatus({
        kind: "error",
        text: "Save a template first to obtain a template id",
      });
      return;
    }
    // Block zero-match audience so UI count 0 never expands to status-default
    // on the server (explicit empty participationIds is also enforced API-side).
    if (segmentCount <= 0) {
      setPreviewStatus({
        kind: "error",
        text: "No recipients match this audience — adjust search or status",
      });
      setPreview(null);
      setPreviewFingerprint(null);
      return;
    }
    setPreviewing(true);
    setPreviewStatus(null);
    // Capture fingerprint for the segment we are about to preview so a concurrent
    // audience edit cannot leave a mismatched "valid" preview.
    const fp = currentFingerprint;
    const segment = previewSegment;
    try {
      const res = await fetch("/api/comms/preview", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ templateId, segment }),
      });
      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const err = raw as { error?: string } | null;
        setPreviewStatus({
          kind: "error",
          text: err?.error ?? `Preview failed (${res.status})`,
        });
        setPreview(null);
        setPreviewFingerprint(null);
        return;
      }
      const parsed = CommsPreviewResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setPreviewStatus({ kind: "error", text: "Unexpected preview response" });
        return;
      }
      setPreview(parsed.data);
      setPreviewFingerprint(fp);
      setPreviewStatus({
        kind: "ok",
        text: `Preview ready — ${parsed.data.recipientCount} recipient(s)`,
      });
      setSendStatus(null);
      // Successful preview starts a new send attempt chain (new audience rules).
      setLastIdempotencyKey(null);
    } catch {
      setPreviewStatus({ kind: "error", text: "Network error" });
    } finally {
      setPreviewing(false);
    }
  }, [
    activeEventId,
    templateId,
    currentFingerprint,
    previewSegment,
    segmentCount,
  ]);

  const onSend = useCallback(async () => {
    if (!previewValid || !preview || sending) return;
    setSending(true);
    setSendStatus(null);
    // Persist idempotency key *before* the request so a lost response still
    // retries with the same key (AC-11.2-SEND / J04). Reset only when
    // preview/audience changes (invalidatePreview / successful new preview).
    const idempotencyKey = lastIdempotencyKey ?? newIdempotencyKey("send");
    setLastIdempotencyKey(idempotencyKey);
    try {
      const res = await fetch("/api/comms/send", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          previewId: preview.previewId,
          idempotencyKey,
          ...(attachCalendarInviteId
            ? { calendarInviteId: attachCalendarInviteId }
            : {}),
        }),
      });
      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const err = raw as { error?: string; code?: string } | null;
        setSendStatus({
          kind: "error",
          text: err?.error ?? `Send failed (${res.status})`,
        });
        return;
      }
      const parsed = CommsSendResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setSendStatus({ kind: "error", text: "Unexpected send response" });
        return;
      }
      setLastJobId(parsed.data.job.id);
      setSendStatus({
        kind: "ok",
        text: parsed.data.enqueued
          ? `Enqueued job ${parsed.data.job.id} (status ${parsed.data.job.status})`
          : `Idempotent replay — same job ${parsed.data.job.id}`,
      });
      if (activeEventId) {
        void loadJobs(activeEventId);
      }
    } catch {
      // Ambiguous network failure: keep lastIdempotencyKey for safe retry.
      setSendStatus({ kind: "error", text: "Network error" });
    } finally {
      setSending(false);
    }
  }, [
    previewValid,
    preview,
    lastIdempotencyKey,
    attachCalendarInviteId,
    activeEventId,
    loadJobs,
    sending,
  ]);

  const openJobDetail = useCallback(
    async (jobId: string) => {
      if (!activeEventId) return;
      try {
        const res = await fetch(
          `/api/events/${encodeURIComponent(activeEventId)}/comms/jobs/${encodeURIComponent(jobId)}`,
          {
            credentials: "include",
            headers: { accept: "application/json" },
          },
        );
        if (!res.ok) {
          setLogError(`Job detail failed (${res.status})`);
          return;
        }
        const raw: unknown = await res.json();
        const parsed = CommsGetJobResponseSchema.safeParse(raw);
        if (!parsed.success) {
          setLogError("Unexpected job detail response");
          return;
        }
        setSelectedJob(parsed.data);
      } catch {
        setLogError("Network error loading job");
      }
    },
    [activeEventId],
  );

  const onIcsSubmit = useCallback(
    async (e: FormEvent, options?: { cancel?: boolean }) => {
      e.preventDefault();
      if (!activeEventId) return;
      setIcsBusy(true);
      setIcsStatus(null);
      try {
        const res = await fetch(
          `/api/events/${encodeURIComponent(activeEventId)}/comms/ics`,
          {
            method: "POST",
            credentials: "include",
            headers: {
              "content-type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify({
              placementId: icsPlacementId,
              summary: icsSummary,
              startsAt: icsStartsAt,
              endsAt: icsEndsAt,
              location: icsLocation || null,
              cancel: options?.cancel ?? false,
            }),
          },
        );
        const raw: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          const err = raw as { error?: string } | null;
          setIcsStatus({
            kind: "error",
            text: err?.error ?? `ICS failed (${res.status})`,
          });
          return;
        }
        const parsed = CommsIcsForPlacementResponseSchema.safeParse(raw);
        if (!parsed.success) {
          setIcsStatus({ kind: "error", text: "Unexpected ICS response" });
          return;
        }
        const inv = parsed.data.invite;
        setIcsStatus({
          kind: "ok",
          text: `ICS ${inv.method} · UID ${inv.uid} · SEQUENCE ${inv.sequence}`,
        });
        void loadInvites(activeEventId);
      } catch {
        setIcsStatus({ kind: "error", text: "Network error" });
      } finally {
        setIcsBusy(false);
      }
    },
    [
      activeEventId,
      icsPlacementId,
      icsSummary,
      icsStartsAt,
      icsEndsAt,
      icsLocation,
      loadInvites,
    ],
  );

  function toggleParticipation(id: string) {
    setSelectedParticipationIds((prev) => {
      const next = prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id];
      return next;
    });
    invalidatePreview();
  }

  function selectVisiblePage() {
    const pageIds = audiencePageData.pageItems.map((r) => r.participationId);
    setSelectedParticipationIds((prev) => {
      const set = new Set(prev);
      for (const id of pageIds) set.add(id);
      return [...set];
    });
    invalidatePreview();
  }

  function selectAllMatching() {
    setSelectedParticipationIds(
      filteredAudience.map((r) => r.participationId),
    );
    invalidatePreview();
  }

  function goToStep(step: CampaignStepId) {
    setActiveStep(step);
    const el = document.getElementById(`comms-step-${step}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  const previewStateLabel = !preview
    ? "No preview"
    : previewValid
      ? "Preview ready"
      : "Preview stale";

  return (
    <div
      className="comms-campaign"
      data-testid="page-comms"
      data-section="11.2"
    >
      <PageHeader
        eyebrow="Comms"
        title="Campaign"
        description="Audience → Message → Review → Send. Trust-before-send: preview every recipient, then send once (idempotent). Audience lists stay at most 25 rows visible."
        data-testid="comms-page-header"
      />

      {!activeEventId ? (
        <p className="eval-queue__muted" data-testid="comms-no-event">
          Select an event to manage comms.
        </p>
      ) : null}

      {activeEventId ? (
        <>
          {/* Sticky campaign summary — count always visible (AC-11.2-SCALE) */}
          <div
            className="comms-campaign__summary"
            data-testid="comms-campaign-summary"
            role="status"
          >
            <div className="comms-campaign__summary-main">
              <span
                className="comms-campaign__summary-count"
                data-testid="comms-summary-count"
                data-count={String(segmentCount)}
              >
                <strong>{segmentCount}</strong> recipient
                {segmentCount === 1 ? "" : "s"}
              </span>
              <Badge
                tone={
                  previewValid ? "success" : preview ? "warn" : "neutral"
                }
                data-testid="comms-summary-preview-badge"
              >
                {previewStateLabel}
              </Badge>
              {selectedParticipationIds.length > 0 ? (
                <Badge tone="brand" data-testid="comms-summary-selection-mode">
                  Explicit selection
                </Badge>
              ) : (
                <Badge tone="info" data-testid="comms-summary-status-mode">
                  Status = {segmentStatus}
                </Badge>
              )}
            </div>
            <nav
              className="comms-campaign__steps"
              aria-label="Campaign steps"
              data-testid="comms-campaign-steps"
            >
              {CAMPAIGN_STEPS.map((step) => (
                <button
                  key={step.id}
                  type="button"
                  className={
                    activeStep === step.id
                      ? "comms-campaign__step is-active lumen-focusable"
                      : "comms-campaign__step lumen-focusable"
                  }
                  data-testid={`comms-step-nav-${step.id}`}
                  data-step={step.id}
                  aria-current={activeStep === step.id ? "step" : undefined}
                  onClick={() => goToStep(step.id)}
                >
                  <span className="comms-campaign__step-index" aria-hidden="true">
                    {step.index}
                  </span>
                  <span className="comms-campaign__step-label">{step.label}</span>
                </button>
              ))}
            </nav>
          </div>

          {/* —— Step 1: Audience (J02 + scale) —— */}
          <section
            id="comms-step-audience"
            className="event-settings__card comms-campaign__panel"
            data-testid="comms-segment-builder"
            data-step="audience"
            aria-labelledby="comms-segment-heading"
            onFocusCapture={() => setActiveStep("audience")}
          >
            <div className="comms-campaign__panel-header">
              <Badge tone="brand">1 · Audience</Badge>
              <h3 id="comms-segment-heading" className="event-settings__heading">
                Segment audience
              </h3>
            </div>
            <p className="page-stub__body">
              Filter by participation status and search. Lists show at most{" "}
              {AUDIENCE_PAGE_SIZE} rows — use pagination or select-all matching.
              Summary count stays visible above.
            </p>
            {speakersError ? (
              <p
                className="event-settings__status event-settings__status--error"
                role="alert"
              >
                {speakersError}
              </p>
            ) : null}

            <div className="comms-campaign__audience-controls">
              <label
                className="event-settings__label"
                htmlFor="comms-segment-status"
              >
                Status filter
              </label>
              <select
                id="comms-segment-status"
                className="event-settings__input lumen-focusable"
                data-testid="comms-segment-status"
                value={segmentStatus}
                onChange={(e) => {
                  setSegmentStatus(e.target.value);
                  setAudiencePage(1);
                  invalidatePreview();
                }}
                disabled={selectedParticipationIds.length > 0}
              >
                <option value="accepted">accepted</option>
                <option value="waitlisted">waitlisted</option>
                <option value="rejected">rejected</option>
                <option value="invited">invited</option>
              </select>

              <label
                className="event-settings__label"
                htmlFor="comms-audience-search"
              >
                Search
              </label>
              <input
                id="comms-audience-search"
                className="event-settings__input lumen-focusable"
                data-testid="comms-audience-search"
                type="search"
                placeholder="Name, email, or id"
                value={audienceQuery}
                onChange={(e) => {
                  setAudienceQuery(e.target.value);
                  setAudiencePage(1);
                  // Search is part of audience rules when no explicit selection
                  // (narrows displayed count + preview segment). Always invalidate
                  // so a prior status-only preview cannot stay "valid".
                  invalidatePreview();
                }}
                autoComplete="off"
              />
            </div>

            <p
              className="event-settings__meta"
              data-testid="comms-segment-count"
              data-count={String(segmentCount)}
            >
              Audience count: <strong>{segmentCount}</strong>
              {selectedParticipationIds.length > 0
                ? " (explicit selection)"
                : ` (status=${segmentStatus})`}
              {audienceQuery.trim()
                ? ` · filtered ${filteredAudience.length} of ${audienceRows.length}`
                : ""}
            </p>

            <div
              className="comms-campaign__audience-actions"
              data-testid="comms-audience-actions"
            >
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="comms-audience-select-page"
                onClick={() => selectVisiblePage()}
                disabled={audiencePageData.pageItems.length === 0}
              >
                Select page
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="comms-audience-select-all"
                onClick={() => selectAllMatching()}
                disabled={filteredAudience.length === 0}
              >
                Select all matching
              </Button>
              {selectedParticipationIds.length > 0 ? (
                <Button
                  type="button"
                  variant="quiet"
                  size="sm"
                  data-testid="comms-segment-clear"
                  onClick={() => {
                    setSelectedParticipationIds([]);
                    invalidatePreview();
                  }}
                >
                  Clear selection (use status filter)
                </Button>
              ) : null}
            </div>

            <ul
              className="event-settings__list comms-campaign__audience-list"
              data-testid="comms-segment-speakers"
              data-page={String(audiencePageData.page)}
              data-page-size={String(audiencePageData.pageSize)}
              data-visible-count={String(audiencePageData.pageItems.length)}
              data-total={String(audiencePageData.total)}
            >
              {speakers.length === 0 ? (
                <li
                  className="event-settings__list-empty"
                  data-testid="comms-segment-empty"
                >
                  No speakers yet — accept a submission or create a direct
                  session.
                </li>
              ) : audiencePageData.pageItems.length === 0 ? (
                <li
                  className="event-settings__list-empty"
                  data-testid="comms-audience-empty-filter"
                >
                  No speakers match this filter or search.
                </li>
              ) : (
                audiencePageData.pageItems.map((row) => {
                  const id = row.participationId;
                  const checked = selectedParticipationIds.includes(id);
                  return (
                    <li key={id} data-testid={`comms-audience-row-${id}`}>
                      <label className="eval-queue__row comms-campaign__audience-row">
                        <input
                          type="checkbox"
                          className="lumen-focusable"
                          data-testid={`comms-segment-pick-${id}`}
                          checked={checked}
                          onChange={() => toggleParticipation(id)}
                        />{" "}
                        <span className="comms-campaign__audience-label">
                          {row.name}
                        </span>{" "}
                        <span className="eval-queue__muted">
                          ({row.status}
                          {row.email ? ` · ${row.email}` : ""})
                        </span>
                      </label>
                    </li>
                  );
                })
              )}
            </ul>

            {audiencePageData.total > 0 ? (
              <div
                className="comms-campaign__pager"
                data-testid="comms-audience-pager"
              >
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="comms-audience-prev"
                  disabled={audiencePageData.page <= 1}
                  onClick={() =>
                    setAudiencePage((p) => Math.max(1, p - 1))
                  }
                >
                  Previous
                </Button>
                <span
                  className="comms-campaign__pager-meta"
                  data-testid="comms-audience-page-meta"
                  data-page={String(audiencePageData.page)}
                  data-total-pages={String(audiencePageData.totalPages)}
                >
                  Page {audiencePageData.page} of {audiencePageData.totalPages}
                  {" · "}
                  showing {audiencePageData.pageItems.length} of{" "}
                  {audiencePageData.total}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="comms-audience-next"
                  disabled={
                    audiencePageData.page >= audiencePageData.totalPages
                  }
                  onClick={() =>
                    setAudiencePage((p) =>
                      Math.min(audiencePageData.totalPages, p + 1),
                    )
                  }
                >
                  Next
                </Button>
              </div>
            ) : null}

            <div className="comms-campaign__step-footer">
              <Button
                type="button"
                variant="primary"
                data-testid="comms-step-next-message"
                onClick={() => goToStep("message")}
              >
                Continue to message
              </Button>
            </div>
          </section>

          {/* —— Step 2: Message / template (J01) —— */}
          <section
            id="comms-step-message"
            className="event-settings__card comms-campaign__panel"
            data-testid="comms-template-editor"
            data-step="message"
            aria-labelledby="comms-template-heading"
            onFocusCapture={() => setActiveStep("message")}
          >
            <div className="comms-campaign__panel-header">
              <Badge tone="brand">2 · Message</Badge>
              <h3 id="comms-template-heading" className="event-settings__heading">
                Template editor
              </h3>
            </div>
            {templates.length > 0 ? (
              <div
                className="event-settings__list"
                data-testid="comms-template-list"
              >
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="eval-queue__link lumen-focusable"
                    data-testid={`comms-template-pick-${t.key}`}
                    onClick={() => selectTemplate(t)}
                  >
                    {t.key} (v{t.version})
                  </button>
                ))}
              </div>
            ) : null}
            <form
              className="event-settings__form"
              data-testid="comms-template-form"
              onSubmit={(e) => void onSaveTemplate(e)}
            >
              <label
                className="event-settings__label"
                htmlFor="comms-template-key"
              >
                Key
              </label>
              <input
                id="comms-template-key"
                className="event-settings__input lumen-focusable"
                data-testid="comms-template-key-input"
                value={key}
                onChange={(e) => {
                  setKey(e.target.value.trim().toLowerCase());
                  setExpectedVersion(null);
                  setTemplateId(null);
                  setLastSaved(null);
                  invalidatePreview();
                }}
                pattern="[a-z][a-z0-9_-]*"
                required
                maxLength={64}
              />

              <label
                className="event-settings__label"
                htmlFor="comms-template-subject"
              >
                Subject
              </label>
              <input
                id="comms-template-subject"
                className="event-settings__input lumen-focusable"
                data-testid="comms-template-subject-input"
                value={subject}
                onChange={(e) => {
                  setSubject(e.target.value);
                  invalidatePreview();
                }}
                required
                maxLength={500}
              />

              <label
                className="event-settings__label"
                htmlFor="comms-template-body"
              >
                Body
              </label>
              <textarea
                id="comms-template-body"
                className="event-settings__input lumen-focusable"
                data-testid="comms-template-body-input"
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  invalidatePreview();
                }}
                required
                rows={8}
                maxLength={50_000}
              />

              <p className="eval-queue__muted" data-testid="comms-merge-fields">
                Merge fields detected:{" "}
                {mergeFields.length === 0
                  ? "none"
                  : mergeFields.map((f) => `{{${f}}}`).join(", ")}
              </p>

              <Button
                type="submit"
                variant="primary"
                data-testid="comms-template-save"
                pending={saving}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save template"}
              </Button>
            </form>

            {templateStatus ? (
              <p
                className={
                  templateStatus.kind === "error"
                    ? "event-settings__status event-settings__status--error"
                    : "event-settings__status"
                }
                data-testid="comms-template-status"
                role={templateStatus.kind === "error" ? "alert" : "status"}
              >
                {templateStatus.text}
              </p>
            ) : null}

            {lastSaved ? (
              <p
                className="eval-queue__muted"
                data-testid="comms-template-saved-subject"
              >
                Saved subject: {lastSaved.subject}
              </p>
            ) : null}
            {templateId ? (
              <p
                className="eval-queue__muted"
                data-testid="comms-template-id"
                data-template-id={templateId}
              >
                Template id: {templateId}
              </p>
            ) : null}

            <div className="comms-campaign__step-footer">
              <Button
                type="button"
                variant="secondary"
                data-testid="comms-step-back-audience"
                onClick={() => goToStep("audience")}
              >
                Back
              </Button>
              <Button
                type="button"
                variant="primary"
                data-testid="comms-step-next-review"
                onClick={() => goToStep("review")}
              >
                Continue to review
              </Button>
            </div>
          </section>

          {/* —— Step 3: Review (J03 / J08 preview gate) —— */}
          <section
            id="comms-step-review"
            className="event-settings__card comms-campaign__panel"
            data-testid="comms-preview-panel"
            data-step="review"
            aria-labelledby="comms-preview-heading"
            onFocusCapture={() => setActiveStep("review")}
          >
            <div className="comms-campaign__panel-header">
              <Badge tone="brand">3 · Review</Badge>
              <h3 id="comms-preview-heading" className="event-settings__heading">
                Preview recipients
              </h3>
            </div>
            <p className="page-stub__body">
              Run a full preview before send. Editing audience or message
              invalidates this preview.
            </p>
            <div className="eval-queue__row">
              <Button
                type="button"
                variant="secondary"
                data-testid="comms-preview-run"
                pending={previewing}
                disabled={!previewEnabled}
                onClick={() => void onPreview()}
              >
                {previewing ? "Previewing…" : "Run preview"}
              </Button>
            </div>
            {!previewEnabled && previewBlockReason && !previewing ? (
              <p
                className="event-settings__meta"
                data-testid="comms-preview-blocked-reason"
                role="status"
              >
                {previewBlockReason}
              </p>
            ) : null}
            {previewStatus ? (
              <p
                className={
                  previewStatus.kind === "error"
                    ? "event-settings__status event-settings__status--error"
                    : "event-settings__status"
                }
                data-testid="comms-preview-status"
                role={previewStatus.kind === "error" ? "alert" : "status"}
              >
                {previewStatus.text}
              </p>
            ) : null}

            {previewValid && preview ? (
              <div data-testid="comms-preview-results">
                <p
                  className="event-settings__meta"
                  data-testid="comms-preview-recipient-count"
                  data-count={String(preview.recipientCount)}
                >
                  Recipients: {preview.recipientCount}
                  {preview.missingFields.length > 0
                    ? ` · missing fields: ${preview.missingFields.join(", ")}`
                    : ""}
                </p>
                <ul data-testid="comms-preview-recipients">
                  {preview.recipients.map((r) => (
                    <li
                      key={r.participationId}
                      data-testid={`comms-preview-recipient-${r.participationId}`}
                    >
                      {r.name} &lt;{r.email}&gt;
                    </li>
                  ))}
                </ul>
                <div data-testid="comms-preview-bodies">
                  {preview.bodies.map((b) => (
                    <article
                      key={b.participationId}
                      className="event-settings__card"
                      data-testid={`comms-preview-body-${b.participationId}`}
                    >
                      <h4 className="event-settings__heading">{b.subject}</h4>
                      <pre className="eval-queue__muted">{b.body}</pre>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="comms-campaign__step-footer">
              <Button
                type="button"
                variant="secondary"
                data-testid="comms-step-back-message"
                onClick={() => goToStep("message")}
              >
                Back
              </Button>
              <Button
                type="button"
                variant="primary"
                data-testid="comms-step-next-send"
                onClick={() => goToStep("send")}
              >
                Continue to send
              </Button>
            </div>
          </section>

          {/* —— Step 4: Send (J04 / J08 gated) —— */}
          <section
            id="comms-step-send"
            className="event-settings__card comms-campaign__panel"
            data-testid="comms-send-panel"
            data-step="send"
            aria-labelledby="comms-send-heading"
            onFocusCapture={() => setActiveStep("send")}
          >
            <div className="comms-campaign__panel-header">
              <Badge tone="brand">4 · Send</Badge>
              <h3 id="comms-send-heading" className="event-settings__heading">
                Confirm &amp; send
              </h3>
            </div>
            <p className="page-stub__body">
              Send is disabled until a valid preview matches the current
              audience and message. Double-submit is guarded; retries reuse the
              same idempotency key.
            </p>
            <label
              className="event-settings__label"
              htmlFor="comms-attach-invite"
            >
              Attach calendar invite (optional)
            </label>
            <select
              id="comms-attach-invite"
              className="event-settings__input lumen-focusable"
              data-testid="comms-attach-calendar-invite"
              value={attachCalendarInviteId ?? ""}
              onChange={(e) =>
                setAttachCalendarInviteId(
                  e.target.value.trim() === "" ? null : e.target.value,
                )
              }
            >
              <option value="">— none —</option>
              {invites.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {(inv.summary ?? inv.placementId) +
                    ` · seq ${inv.sequence}`}
                </option>
              ))}
            </select>
            <div className="eval-queue__row">
              <Button
                type="button"
                variant="primary"
                data-testid="comms-send-button"
                pending={sending}
                disabled={!sendEnabled}
                aria-disabled={!sendEnabled}
                title={sendReason ?? "Send once (idempotent)"}
                onClick={() => void onSend()}
              >
                {sending ? "Sending…" : "Send"}
              </Button>
            </div>
            {!sendEnabled && sendReason ? (
              <p
                className="eval-queue__muted"
                data-testid="comms-send-blocked-reason"
              >
                {sendReason}
              </p>
            ) : null}
            {sendStatus ? (
              <p
                className={
                  sendStatus.kind === "error"
                    ? "event-settings__status event-settings__status--error"
                    : "event-settings__status"
                }
                data-testid="comms-send-status"
                role={sendStatus.kind === "error" ? "alert" : "status"}
                data-job-id={lastJobId ?? ""}
                data-idempotency-key={lastIdempotencyKey ?? ""}
              >
                {sendStatus.text}
              </p>
            ) : null}

            <div className="comms-campaign__step-footer">
              <Button
                type="button"
                variant="secondary"
                data-testid="comms-step-back-review"
                onClick={() => goToStep("review")}
              >
                Back to review
              </Button>
            </div>
          </section>

          {/* —— J05 Delivery log —— */}
          <section
            className="event-settings__card"
            data-testid="comms-delivery-log"
            aria-labelledby="comms-log-heading"
          >
            <h3 id="comms-log-heading" className="event-settings__heading">
              Delivery log
            </h3>
            <Button
              type="button"
              variant="quiet"
              size="sm"
              data-testid="comms-log-refresh"
              onClick={() => {
                if (activeEventId) void loadJobs(activeEventId);
              }}
            >
              Refresh
            </Button>
            {logError ? (
              <p
                className="event-settings__status event-settings__status--error"
                role="alert"
                data-testid="comms-log-error"
              >
                {logError}
              </p>
            ) : null}
            {jobs.length === 0 ? (
              <p
                className="event-settings__list-empty"
                data-testid="comms-log-empty"
              >
                No message jobs yet.
              </p>
            ) : (
              <table
                className="eval-queue__table"
                data-testid="comms-log-table"
              >
                <thead>
                  <tr>
                    <th scope="col">Job</th>
                    <th scope="col">Status</th>
                    <th scope="col">Recipients</th>
                    <th scope="col">Idempotency</th>
                    <th scope="col">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr
                      key={j.id}
                      data-testid={`comms-log-row-${j.id}`}
                      data-status={j.status}
                    >
                      <td>
                        <button
                          type="button"
                          className="eval-queue__link lumen-focusable"
                          data-testid={`comms-log-open-${j.id}`}
                          onClick={() => void openJobDetail(j.id)}
                        >
                          {j.id.slice(0, 8)}…
                        </button>
                      </td>
                      <td data-testid={`comms-log-status-${j.id}`}>
                        {j.status}
                      </td>
                      <td>{j.recipientCount}</td>
                      <td className="eval-queue__muted">
                        {j.idempotencyKey ?? "—"}
                      </td>
                      <td className="eval-queue__muted">{j.createdAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {selectedJob ? (
              <div data-testid="comms-log-detail">
                <h4 className="event-settings__heading">
                  Job {selectedJob.job.id} · {selectedJob.job.status}
                </h4>
                <ul data-testid="comms-log-recipients">
                  {selectedJob.recipients.map((r) => (
                    <li
                      key={r.id}
                      data-testid={`comms-log-recipient-${r.id}`}
                    >
                      {r.toEmail} — {r.status}
                      {r.subject ? ` · ${r.subject}` : ""}
                    </li>
                  ))}
                </ul>
                {selectedJob.deliveryEvents.length > 0 ? (
                  <ul data-testid="comms-log-deliveries">
                    {selectedJob.deliveryEvents.map((d) => (
                      <li key={d.id}>
                        {d.provider}/{d.status} attempt {d.attempt}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="eval-queue__muted">
                    No delivery_events yet (outbox pending drain).
                  </p>
                )}
              </div>
            ) : null}
          </section>

          {/* —— J06 / J10 ICS attach —— */}
          <section
            className="event-settings__card"
            data-testid="comms-ics-panel"
            aria-labelledby="comms-ics-heading"
          >
            <h3 id="comms-ics-heading" className="event-settings__heading">
              ICS attach (scheduled session)
            </h3>
            <p className="page-stub__body">
              Fixture placement form for Phase 5. Stable UID per event +
              placement; reschedule bumps SEQUENCE (J10).
            </p>
            <form
              className="event-settings__form"
              data-testid="comms-ics-form"
              onSubmit={(e) => void onIcsSubmit(e)}
            >
              <label
                className="event-settings__label"
                htmlFor="comms-ics-placement"
              >
                Placement id
              </label>
              <input
                id="comms-ics-placement"
                className="event-settings__input lumen-focusable"
                data-testid="comms-ics-placement-input"
                value={icsPlacementId}
                onChange={(e) => setIcsPlacementId(e.target.value)}
                required
              />
              <label
                className="event-settings__label"
                htmlFor="comms-ics-summary"
              >
                Summary
              </label>
              <input
                id="comms-ics-summary"
                className="event-settings__input lumen-focusable"
                data-testid="comms-ics-summary-input"
                value={icsSummary}
                onChange={(e) => setIcsSummary(e.target.value)}
                required
              />
              <label
                className="event-settings__label"
                htmlFor="comms-ics-starts"
              >
                Starts (ISO)
              </label>
              <input
                id="comms-ics-starts"
                className="event-settings__input lumen-focusable"
                data-testid="comms-ics-starts-input"
                value={icsStartsAt}
                onChange={(e) => setIcsStartsAt(e.target.value)}
                required
              />
              <label className="event-settings__label" htmlFor="comms-ics-ends">
                Ends (ISO)
              </label>
              <input
                id="comms-ics-ends"
                className="event-settings__input lumen-focusable"
                data-testid="comms-ics-ends-input"
                value={icsEndsAt}
                onChange={(e) => setIcsEndsAt(e.target.value)}
                required
              />
              <label
                className="event-settings__label"
                htmlFor="comms-ics-location"
              >
                Location
              </label>
              <input
                id="comms-ics-location"
                className="event-settings__input lumen-focusable"
                data-testid="comms-ics-location-input"
                value={icsLocation}
                onChange={(e) => setIcsLocation(e.target.value)}
              />
              <div className="eval-queue__row">
                <Button
                  type="submit"
                  variant="primary"
                  data-testid="comms-ics-generate"
                  pending={icsBusy}
                  disabled={icsBusy}
                >
                  {icsBusy ? "Saving…" : "Generate / update ICS"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  data-testid="comms-ics-cancel"
                  disabled={icsBusy}
                  onClick={(e) => void onIcsSubmit(e, { cancel: true })}
                >
                  Cancel invite
                </Button>
              </div>
            </form>
            {icsStatus ? (
              <p
                className={
                  icsStatus.kind === "error"
                    ? "event-settings__status event-settings__status--error"
                    : "event-settings__status"
                }
                data-testid="comms-ics-status"
                role={icsStatus.kind === "error" ? "alert" : "status"}
              >
                {icsStatus.text}
              </p>
            ) : null}
            {invites.length === 0 ? (
              <p
                className="event-settings__list-empty"
                data-testid="comms-ics-empty"
              >
                No calendar invites yet.
              </p>
            ) : (
              <ul data-testid="comms-ics-list">
                {invites.map((inv) => (
                  <li
                    key={inv.id}
                    data-testid={`comms-ics-invite-${inv.placementId}`}
                    data-uid={inv.uid}
                    data-sequence={String(inv.sequence)}
                    data-method={inv.method}
                  >
                    <strong>{inv.summary ?? inv.placementId}</strong>
                    <br />
                    <span className="eval-queue__muted">
                      UID: {inv.uid} · SEQUENCE: {inv.sequence} ·{" "}
                      {inv.method}
                    </span>
                    <pre
                      className="eval-queue__muted"
                      data-testid={`comms-ics-body-${inv.placementId}`}
                    >
                      {inv.icsBody}
                    </pre>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
