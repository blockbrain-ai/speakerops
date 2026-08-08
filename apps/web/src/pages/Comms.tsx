/**
 * Admin Comms — trust-before-send UI (section 5.3 / S-COMMS).
 *
 * Templates · Segment builder · Preview · Gated send · Delivery log · ICS attach
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
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
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
import {
  isSendEnabled,
  segmentFingerprint,
  sendDisabledReason,
  newIdempotencyKey,
} from "./comms-utils.js";

export function CommsPage() {
  const { activeEventId } = useEventContext();

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

  // —— Segment (J02) ——
  const [segmentStatus, setSegmentStatus] = useState("accepted");
  const [selectedParticipationIds, setSelectedParticipationIds] = useState<
    string[]
  >([]);
  const [speakers, setSpeakers] = useState<AdminSpeakerListItem[]>([]);
  const [speakersError, setSpeakersError] = useState<string | null>(null);

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

  const currentFingerprint = useMemo(
    () =>
      segmentFingerprint({
        status: segmentStatus,
        participationIds: selectedParticipationIds,
        templateId,
        eventId: activeEventId,
      }),
    [segmentStatus, selectedParticipationIds, templateId, activeEventId],
  );

  const previewValid =
    preview != null &&
    previewFingerprint != null &&
    previewFingerprint === currentFingerprint;

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

  const segmentCount =
    selectedParticipationIds.length > 0
      ? selectedParticipationIds.length
      : speakers.filter((s) => s.participation.status === segmentStatus)
          .length;

  const invalidatePreview = useCallback(() => {
    setPreview(null);
    setPreviewFingerprint(null);
    setPreviewStatus(null);
    // New audience/template → new send key (prior key was for the old preview).
    setLastIdempotencyKey(null);
  }, []);

  const loadTemplates = useCallback(async (eventId: string) => {
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/templates`,
        {
          credentials: "include",
          headers: { accept: "application/json" },
        },
      );
      if (!res.ok) return;
      const raw: unknown = await res.json();
      const parsed = CommsListTemplatesResponseSchema.safeParse(raw);
      if (parsed.success) {
        setTemplates(parsed.data.templates);
      }
    } catch {
      /* non-fatal */
    }
  }, []);

  const loadSpeakers = useCallback(async (eventId: string) => {
    setSpeakersError(null);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/speakers`,
        {
          credentials: "include",
          headers: { accept: "application/json" },
        },
      );
      if (!res.ok) {
        setSpeakersError(`Speakers load failed (${res.status})`);
        setSpeakers([]);
        return;
      }
      const raw: unknown = await res.json();
      const parsed = AdminSpeakersListResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setSpeakersError("Unexpected speakers response");
        return;
      }
      setSpeakers(parsed.data.speakers);
    } catch {
      setSpeakersError("Network error loading speakers");
    }
  }, []);

  const loadJobs = useCallback(async (eventId: string) => {
    setLogError(null);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/comms/jobs`,
        {
          credentials: "include",
          headers: { accept: "application/json" },
        },
      );
      if (!res.ok) {
        setLogError(`Delivery log failed (${res.status})`);
        return;
      }
      const raw: unknown = await res.json();
      const parsed = CommsListJobsResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setLogError("Unexpected jobs response");
        return;
      }
      setJobs(parsed.data.jobs);
    } catch {
      setLogError("Network error loading delivery log");
    }
  }, []);

  const loadInvites = useCallback(async (eventId: string) => {
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/comms/ics`,
        {
          credentials: "include",
          headers: { accept: "application/json" },
        },
      );
      if (!res.ok) return;
      const raw: unknown = await res.json();
      const parsed = CommsListIcsResponseSchema.safeParse(raw);
      if (parsed.success) {
        setInvites(parsed.data.invites);
      }
    } catch {
      /* non-fatal */
    }
  }, []);

  // Event switch: clear event-scoped send state so a still-enabled Send cannot
  // submit the prior event's preview while the UI shows the new event.
  useEffect(() => {
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
    setSpeakers([]);
    setJobs([]);
    setInvites([]);
    setTemplates([]);

    if (!activeEventId) {
      return;
    }
    void loadTemplates(activeEventId);
    void loadSpeakers(activeEventId);
    void loadJobs(activeEventId);
    void loadInvites(activeEventId);
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
    setPreviewing(true);
    setPreviewStatus(null);
    try {
      const segment: {
        status?: string;
        participationIds?: string[];
      } = {};
      if (selectedParticipationIds.length > 0) {
        segment.participationIds = selectedParticipationIds;
      } else {
        segment.status = segmentStatus;
      }
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
      setPreviewFingerprint(
        segmentFingerprint({
          status: segmentStatus,
          participationIds: selectedParticipationIds,
          templateId,
          eventId: activeEventId,
        }),
      );
      setPreviewStatus({
        kind: "ok",
        text: `Preview ready — ${parsed.data.recipientCount} recipient(s)`,
      });
      setSendStatus(null);
    } catch {
      setPreviewStatus({ kind: "error", text: "Network error" });
    } finally {
      setPreviewing(false);
    }
  }, [
    activeEventId,
    templateId,
    segmentStatus,
    selectedParticipationIds,
  ]);

  const onSend = useCallback(async () => {
    if (!previewValid || !preview) return;
    setSending(true);
    setSendStatus(null);
    const idempotencyKey = lastIdempotencyKey ?? newIdempotencyKey("send");
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
      setLastIdempotencyKey(idempotencyKey);
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
      setSendStatus({ kind: "error", text: "Network error" });
    } finally {
      setSending(false);
    }
  }, [
    previewValid,
    preview,
    lastIdempotencyKey,
    activeEventId,
    loadJobs,
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

  return (
    <div className="event-settings" data-testid="page-comms" data-section="5.3">
      <p className="page-stub__overline">Comms</p>
      <h2 className="page-stub__title">Email &amp; calendar</h2>
      <p className="page-stub__body">
        Trust-before-send: edit templates, build a segment, preview every
        recipient body, then send once (idempotent). ICS attaches for scheduled
        sessions keep a stable UID and bump SEQUENCE on reschedule.
      </p>

      {!activeEventId ? (
        <p className="eval-queue__muted" data-testid="comms-no-event">
          Select an event to manage comms.
        </p>
      ) : null}

      {activeEventId ? (
        <>
          {/* —— J01 Template editor —— */}
          <section
            className="event-settings__card"
            data-testid="comms-template-editor"
            aria-labelledby="comms-template-heading"
          >
            <h3 id="comms-template-heading" className="event-settings__heading">
              Template editor
            </h3>
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

              <button
                type="submit"
                className="event-settings__submit lumen-focusable"
                data-testid="comms-template-save"
                disabled={saving}
              >
                {saving ? "Saving…" : "Save template"}
              </button>
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
          </section>

          {/* —— J02 Segment builder —— */}
          <section
            className="event-settings__card"
            data-testid="comms-segment-builder"
            aria-labelledby="comms-segment-heading"
          >
            <h3 id="comms-segment-heading" className="event-settings__heading">
              Segment audience
            </h3>
            <p className="page-stub__body">
              Filter by participation status, or pick specific speakers. Count
              updates as you change the audience.
            </p>
            {speakersError ? (
              <p
                className="event-settings__status event-settings__status--error"
                role="alert"
              >
                {speakersError}
              </p>
            ) : null}
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
                invalidatePreview();
              }}
              disabled={selectedParticipationIds.length > 0}
            >
              <option value="accepted">accepted</option>
              <option value="waitlisted">waitlisted</option>
              <option value="rejected">rejected</option>
              <option value="invited">invited</option>
            </select>

            <p
              className="event-settings__meta"
              data-testid="comms-segment-count"
              data-count={String(segmentCount)}
            >
              Audience count: <strong>{segmentCount}</strong>
              {selectedParticipationIds.length > 0
                ? " (explicit selection)"
                : ` (status=${segmentStatus})`}
            </p>

            <ul
              className="event-settings__list"
              data-testid="comms-segment-speakers"
            >
              {speakers.length === 0 ? (
                <li
                  className="event-settings__list-empty"
                  data-testid="comms-segment-empty"
                >
                  No speakers yet — accept a submission or create a direct
                  session.
                </li>
              ) : (
                speakers.map((s) => {
                  const id = s.participation.id;
                  const checked = selectedParticipationIds.includes(id);
                  const label =
                    s.participation.personName ??
                    s.participation.personEmail ??
                    id;
                  return (
                    <li key={id}>
                      <label className="eval-queue__row">
                        <input
                          type="checkbox"
                          className="lumen-focusable"
                          data-testid={`comms-segment-pick-${id}`}
                          checked={checked}
                          onChange={() => toggleParticipation(id)}
                        />{" "}
                        {label}{" "}
                        <span className="eval-queue__muted">
                          ({s.participation.status})
                        </span>
                      </label>
                    </li>
                  );
                })
              )}
            </ul>
            {selectedParticipationIds.length > 0 ? (
              <button
                type="button"
                className="eval-queue__link lumen-focusable"
                data-testid="comms-segment-clear"
                onClick={() => {
                  setSelectedParticipationIds([]);
                  invalidatePreview();
                }}
              >
                Clear selection (use status filter)
              </button>
            ) : null}
          </section>

          {/* —— J03 Preview + J08 gated send —— */}
          <section
            className="event-settings__card"
            data-testid="comms-preview-panel"
            aria-labelledby="comms-preview-heading"
          >
            <h3 id="comms-preview-heading" className="event-settings__heading">
              Preview &amp; send
            </h3>
            <div className="eval-queue__row">
              <button
                type="button"
                className="event-settings__submit lumen-focusable"
                data-testid="comms-preview-run"
                disabled={previewing || !templateId}
                onClick={() => void onPreview()}
              >
                {previewing ? "Previewing…" : "Run preview"}
              </button>
              <button
                type="button"
                className="event-settings__submit lumen-focusable"
                data-testid="comms-send-button"
                disabled={!sendEnabled}
                aria-disabled={!sendEnabled}
                title={sendReason ?? "Send once (idempotent)"}
                onClick={() => void onSend()}
              >
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
            {!sendEnabled && sendReason ? (
              <p
                className="eval-queue__muted"
                data-testid="comms-send-blocked-reason"
              >
                {sendReason}
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
            <button
              type="button"
              className="eval-queue__link lumen-focusable"
              data-testid="comms-log-refresh"
              onClick={() => {
                if (activeEventId) void loadJobs(activeEventId);
              }}
            >
              Refresh
            </button>
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
                <button
                  type="submit"
                  className="event-settings__submit lumen-focusable"
                  data-testid="comms-ics-generate"
                  disabled={icsBusy}
                >
                  {icsBusy ? "Saving…" : "Generate / update ICS"}
                </button>
                <button
                  type="button"
                  className="event-settings__submit lumen-focusable"
                  data-testid="comms-ics-cancel"
                  disabled={icsBusy}
                  onClick={(e) => void onIcsSubmit(e, { cancel: true })}
                >
                  Cancel invite
                </button>
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
