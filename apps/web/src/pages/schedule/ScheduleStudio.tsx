/**
 * Schedule Studio — five views + tray + DnD + keyboard place + undo
 * (section 6.2 / S-SCHED · 11.5 / S-L2-SCHED visual polish).
 *
 * Lumen 2: full-height working surface, sticky time/room headers, richer
 * session tiles (track encoding, conflict/pending), navigable conflict summary.
 *
 * ## Pointer drag state machine (do not regress)
 *
 * Symptom we prevent: ghost "Dragging: …" stays glued to the mouse and the
 * user cannot put the session down anywhere (intermittent). Root cause was
 * move/up/cancel bound only on the source tile/tray with setPointerCapture —
 * when capture failed or was lost (source unmount, view switch, UA revoke),
 * pointerup never hit our handler and dragPayload/ghostPos stuck forever.
 *
 * Contract (auditors 2026-08-12, docs/reports/SCHEDULE_STUCK_DRAG_INVESTIGATION_*.md):
 * - Window-level pointermove/up/cancel (capture phase) are the SOLE authority
 *   while a gesture is armed. Do NOT re-bind move/up only to the source element.
 * - lostpointercapture → cancel only if that pointerId is still armed (own
 *   releasePointerCapture also fires lostcapture — must no-op after end).
 * - Terminals are idempotent (endPointerGesture latch). Never double-performDrop.
 * - Ghost + dragPayload clear at gesture end — never lease them for the network
 *   RTT (pendingSessionId / pendingPlacementId own save chrome).
 * - Do NOT gate pointerdown on busy/pending (post-drop dead-window regression).
 * - setPointerCapture is best-effort; the window net makes it non-optional for UX.
 * - Escape still cancels. No native HTML5 DnD.
 *
 * Inventory I01–I16. APIs (COMMANDS.md):
 *   GET  /api/events/:eventId/schedule
 *   POST /api/events/:eventId/schedule/place
 *   POST /api/events/:eventId/schedule/move
 *   POST /api/events/:eventId/schedule/unschedule
 *   GET  /api/events/:eventId/rooms
 *   GET  /api/events/:eventId/tracks
 *
 * Real backend only — no placeholder mutations.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  ScheduleListResponseSchema,
  SchedulePlaceResponseSchema,
  ScheduleMoveResponseSchema,
  ScheduleUnscheduleResponseSchema,
  RoomListResponseSchema,
  TrackListResponseSchema,
  ScheduleConflictErrorSchema,
  ErrorEnvelopeSchema,
  parseEventAgendaSettings,
  hasExplicitAgendaWindow,
  type SchedulePlacementDto,
  type UnscheduledSessionDto,
  type RoomDto,
  type TrackDto,
  type ScheduleConflictItem,
} from "@speakerops/shared";
import { useEventContext } from "../../events/EventContext.js";
import {
  Alert,
  Badge,
  Button,
  PageHeader,
} from "../../components/ui/index.js";
import {
  SCHEDULE_VIEWS,
  type ScheduleViewMode,
  type UndoAction,
  type LocalScheduleConflict,
  type DayWindowOpts,
  addMinutesIso,
  apiConflictsToLocal,
  buildDayKeys,
  buildTimeSlots,
  conflictedPlacementIds,
  dayWindowForEvent,
  detectLocalRoomConflicts,
  durationMinutes,
  exceedsDragThreshold,
  formatConflictMessage,
  formatTimeLabel,
  groupByRoom,
  groupByTrack,
  placementInSlot,
  placementOccupiesSlot,
  placementsOnDay,
  safeTrackColor,
  slotKey,
  slotTargetFromElement,
  undoForMove,
  undoForPlace,
  undoForUnschedule,
  findRoomOverlaps,
  localRoomConflictItems,
  wouldRoomOverlap,
  zonedDayKey,
  zonedWallParts,
  zonedWallToUtcIso,
} from "./schedule-utils.js";

type ToastState =
  | { kind: "conflict"; text: string; conflicts: ScheduleConflictItem[] }
  | { kind: "ok"; text: string }
  | { kind: "error"; text: string }
  | null;

type DragPayload =
  | { source: "tray"; sessionId: string; title: string }
  | {
      source: "placement";
      placementId: string;
      sessionId: string;
      title: string;
      version: number;
      roomId: string;
      startsAt: string;
      endsAt: string;
    };

type StaleRecovery = {
  message: string;
  expectedVersion?: number;
  actual?: unknown;
};

export function ScheduleStudioPage() {
  const { activeEventId, activeEvent } = useEventContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkSessionId = searchParams.get("sessionId");

  const loadGenRef = useRef(0);
  const activeEventIdRef = useRef(activeEventId);
  activeEventIdRef.current = activeEventId;

  /** Default day-by-room studio per page-atlas (L2). */
  const [view, setView] = useState<ScheduleViewMode>("day");
  const [placements, setPlacements] = useState<SchedulePlacementDto[]>([]);
  const [unscheduled, setUnscheduled] = useState<UnscheduledSessionDto[]>([]);
  const [traySearch, setTraySearch] = useState("");
  const [traySort, setTraySort] = useState<"title" | "track" | "status">("title");
  const [rooms, setRooms] = useState<RoomDto[]>([]);
  const [tracks, setTracks] = useState<TrackDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Placement/session currently mid-mutation (pending tile chrome). */
  const [pendingPlacementId, setPendingPlacementId] = useState<string | null>(
    null,
  );
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  /**
   * Synchronous mutation token (DnD verdict). React `busy` is display-only;
   * this ref is claimed before fetch so two paths cannot both pass a busy check.
   * 0 = free; non-zero = in flight. Does NOT block pointerdown (dead-window fix).
   */
  const mutationInFlightRef = useRef(false);
  /** Live placements ref so commit-time version re-read never uses a stale closure. */
  const placementsRef = useRef<SchedulePlacementDto[]>([]);
  placementsRef.current = placements;

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(
    null,
  );
  /**
   * Click-to-place is armed only when the user selected a tile/tray WITHOUT
   * crossing the drag threshold on that gesture (gates the "teleport" bug).
   */
  const clickPlaceArmedRef = useRef(false);
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [toast, setToast] = useState<ToastState>(null);
  const [staleRecovery, setStaleRecovery] = useState<StaleRecovery | null>(
    null,
  );
  /** API conflict rows kept for summary + tile marks until cleared. */
  const [apiConflictRows, setApiConflictRows] = useState<
    LocalScheduleConflict[]
  >([]);
  /** Last rejected drop target key — flash chrome (CONFLICT UX). */
  const [rejectedSlotKey, setRejectedSlotKey] = useState<string | null>(null);

  const [dragPayload, setDragPayload] = useState<DragPayload | null>(null);
  /** Sync ref so drop logic sees payload even when React state has not flushed. */
  const dragPayloadRef = useRef<DragPayload | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<string | null>(null);
  /** Floating drag ghost position (fixed, at cursor). Null until drag starts. */
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  /**
   * Armed-but-not-yet-started drag (pointerdown recorded, threshold not
   * crossed). `active` flips once movement exceeds DRAG_ACTIVATION_PX.
   * Cleared first inside endPointerGesture so lostpointercapture after our
   * own releasePointerCapture is a no-op.
   */
  const pointerDragRef = useRef<{
    payload: DragPayload;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
    el: HTMLElement;
  } | null>(null);
  /** Set when a real drag (or Escape-cancel) ended — swallows the trailing click. */
  const suppressClickRef = useRef(false);
  /** True while window capture-phase drag listeners are attached. */
  const windowDragBoundRef = useRef(false);
  /** Stable wrappers so removeEventListener matches addEventListener. */
  const windowListenerWrappersRef = useRef<{
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
    cancel: (e: PointerEvent) => void;
    lost: (e: PointerEvent) => void;
  } | null>(null);
  /**
   * Mutable handler table — window listeners call through this so we never
   * re-bind listeners mid-gesture when React callbacks change identity.
   */
  const dragMachineRef = useRef({
    onMove: (_e: PointerEvent) => {},
    onUp: (_e: PointerEvent) => {},
    onCancel: (_e: PointerEvent) => {},
    onLost: (_e: PointerEvent) => {},
  });

  /** Click-to-reschedule inspector (non-drag path). */
  const [inspectorRoomId, setInspectorRoomId] = useState("");
  const [inspectorDay, setInspectorDay] = useState("");
  const [inspectorTime, setInspectorTime] = useState("09:00");

  const setDrag = useCallback((payload: DragPayload | null) => {
    dragPayloadRef.current = payload;
    setDragPayload(payload);
  }, []);

  const detachWindowDragListeners = useCallback(() => {
    const w = windowListenerWrappersRef.current;
    if (!w) {
      windowDragBoundRef.current = false;
      return;
    }
    window.removeEventListener("pointermove", w.move, true);
    window.removeEventListener("pointerup", w.up, true);
    window.removeEventListener("pointercancel", w.cancel, true);
    window.removeEventListener("lostpointercapture", w.lost, true);
    windowListenerWrappersRef.current = null;
    windowDragBoundRef.current = false;
  }, []);

  const attachWindowDragListeners = useCallback(() => {
    if (windowDragBoundRef.current) return;
    const move = (e: PointerEvent) => dragMachineRef.current.onMove(e);
    const up = (e: PointerEvent) => dragMachineRef.current.onUp(e);
    const cancel = (e: PointerEvent) => dragMachineRef.current.onCancel(e);
    const lost = (e: PointerEvent) => dragMachineRef.current.onLost(e);
    windowListenerWrappersRef.current = { move, up, cancel, lost };
    // Capture phase: sole authority while armed (see file header).
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("lostpointercapture", lost, true);
    windowDragBoundRef.current = true;
  }, []);

  useEffect(() => {
    return () => {
      detachWindowDragListeners();
    };
  }, [detachWindowDragListeners]);

  const timezone = activeEvent?.timezone ?? "UTC";
  const eventStartsAt = activeEvent?.startsAt ?? null;
  const eventEndsAt = activeEvent?.endsAt ?? null;

  // Wave 2 agenda settings (events.settings_json): day window + grid interval.
  // The API enforces the window (409 "hours"); the grid mirrors the same
  // envelope so every offered slot is placeable.
  const agendaSettingsJson = activeEvent?.settingsJson ?? null;
  const agenda = useMemo(
    () => parseEventAgendaSettings(agendaSettingsJson),
    [agendaSettingsJson],
  );
  const agendaWindow: DayWindowOpts | undefined = useMemo(
    () =>
      hasExplicitAgendaWindow(agendaSettingsJson)
        ? {
            startHHMM: agenda.agendaDayStart,
            endHHMM: agenda.agendaDayEnd,
          }
        : undefined,
    [agendaSettingsJson, agenda],
  );
  const slotMinutes = agenda.slotIntervalMin;

  const selectedPlacement = useMemo(
    () => placements.find((p) => p.id === selectedPlacementId) ?? null,
    [placements, selectedPlacementId],
  );

  // Seed inspector fields when selection changes.
  useEffect(() => {
    if (!selectedPlacement) return;
    const wall = zonedWallParts(selectedPlacement.startsAt, timezone);
    setInspectorRoomId(selectedPlacement.roomId);
    setInspectorDay(wall.dayKey);
    setInspectorTime(
      `${String(wall.hour).padStart(2, "0")}:${String(wall.minute).padStart(2, "0")}`,
    );
  }, [selectedPlacement, timezone]);

  // Week/day chrome: only event-range days (never pad to Mon–Sun). S-SCHED-CHROME.
  const dayKeys = useMemo(() => {
    const fromEvent = buildDayKeys(eventStartsAt, eventEndsAt, 7, timezone);
    // Dogfood seed may have inverted endsAt < startsAt → fallback single day.
    // Always include days that actually have placements so list→day focus works.
    const fromPlacements = [
      ...new Set(
        placements.map((p) => zonedDayKey(p.startsAt, timezone)).filter(Boolean),
      ),
    ].sort();
    const merged = [...fromEvent];
    for (const d of fromPlacements) {
      if (!merged.includes(d)) merged.push(d);
    }
    merged.sort();
    return merged.length > 0 ? merged.slice(0, 14) : fromEvent;
  }, [eventStartsAt, eventEndsAt, timezone, placements]);

  /** Day shown in day view — follows list/conflict selection. */
  const [focusedDayKey, setFocusedDayKey] = useState<string | null>(null);
  const primaryDay =
    (focusedDayKey && dayKeys.includes(focusedDayKey)
      ? focusedDayKey
      : null) ??
    dayKeys[0] ??
    "2026-09-01";

  const roomName = useCallback(
    (roomId: string) => rooms.find((r) => r.id === roomId)?.name ?? roomId,
    [rooms],
  );
  const trackName = useCallback(
    (trackId: string | null | undefined) => {
      if (!trackId || trackId === "untracked") return "Untracked";
      return tracks.find((t) => t.id === trackId)?.name ?? trackId;
    },
    [tracks],
  );
  const trackColor = useCallback(
    (trackId: string | null | undefined): string | null => {
      if (!trackId || trackId === "untracked") return null;
      return safeTrackColor(tracks.find((t) => t.id === trackId)?.color);
    },
    [tracks],
  );

  const localRoomConflicts = useMemo(
    () => detectLocalRoomConflicts(placements),
    [placements],
  );

  const allConflicts = useMemo(() => {
    // Prefer fresh local room geometry; append API rows not already covered.
    const localIds = new Set(
      localRoomConflicts.map(
        (c) => `${c.type}:${c.affectedPlacementIds.slice().sort().join(",")}`,
      ),
    );
    const extra = apiConflictRows.filter((c) => {
      const key = `${c.type}:${c.affectedPlacementIds.slice().sort().join(",")}`;
      return !localIds.has(key);
    });
    return [...localRoomConflicts, ...extra];
  }, [localRoomConflicts, apiConflictRows]);

  const conflictPlacementSet = useMemo(
    () => conflictedPlacementIds(allConflicts),
    [allConflicts],
  );

  const isCurrent = useCallback(
    (eventId: string, gen: number) =>
      gen === loadGenRef.current && activeEventIdRef.current === eventId,
    [],
  );

  /**
   * Live view for optional schedule?view= hint only. API returns the full set
   * regardless of view — do NOT put `view` in loadAll deps (that reloaded the
   * board on every view-tab switch and remounted drag sources mid-session).
   */
  const viewRef = useRef(view);
  viewRef.current = view;
  /** Count of non-silent loads so silent superseding a visible load cannot stick loading. */
  const nonSilentLoadDepthRef = useRef(0);

  /**
   * Load schedule + rooms + tracks.
   * @param opts.silent — background refetch after place/move (no "Loading…" flash,
   *   does not disable Refresh). Use for post-mutation resync so drag chrome stays free.
   */
  const loadAll = useCallback(
    async (eventId: string, opts?: { silent?: boolean }) => {
      const gen = ++loadGenRef.current;
      const showLoading = !opts?.silent;
      if (showLoading) {
        nonSilentLoadDepthRef.current += 1;
        setLoading(true);
        setLoadError(null);
      }
      // Echo-only view hint; data is view-independent (ScheduleListResponse).
      const viewHint = viewRef.current;
      try {
        const [schedRes, roomsRes, tracksRes] = await Promise.all([
          fetch(
            `/api/events/${encodeURIComponent(eventId)}/schedule?view=${encodeURIComponent(viewHint)}`,
            {
              credentials: "include",
              headers: { accept: "application/json" },
            },
          ),
          fetch(`/api/events/${encodeURIComponent(eventId)}/rooms`, {
            credentials: "include",
            headers: { accept: "application/json" },
          }),
          fetch(`/api/events/${encodeURIComponent(eventId)}/tracks`, {
            credentials: "include",
            headers: { accept: "application/json" },
          }),
        ]);
        if (!isCurrent(eventId, gen)) return;
        if (!schedRes.ok) {
          if (showLoading || placementsRef.current.length === 0) {
            setLoadError(`Schedule load failed (${schedRes.status})`);
            setPlacements([]);
            setUnscheduled([]);
          }
          return;
        }
        const schedRaw: unknown = await schedRes.json();
        if (!isCurrent(eventId, gen)) return;
        const sched = ScheduleListResponseSchema.safeParse(schedRaw);
        if (!sched.success) {
          if (showLoading) setLoadError("Invalid schedule response");
          return;
        }
        setPlacements(sched.data.placements);
        setUnscheduled(sched.data.unscheduled);

        if (roomsRes.ok) {
          const roomsRaw: unknown = await roomsRes.json();
          const parsed = RoomListResponseSchema.safeParse(roomsRaw);
          if (parsed.success) setRooms(parsed.data.rooms);
        }
        if (tracksRes.ok) {
          const tracksRaw: unknown = await tracksRes.json();
          const parsed = TrackListResponseSchema.safeParse(tracksRaw);
          if (parsed.success) setTracks(parsed.data.tracks);
        }
      } catch {
        if (!isCurrent(eventId, gen)) return;
        if (showLoading) setLoadError("Network error loading schedule");
      } finally {
        if (showLoading) {
          nonSilentLoadDepthRef.current = Math.max(
            0,
            nonSilentLoadDepthRef.current - 1,
          );
          if (nonSilentLoadDepthRef.current === 0) setLoading(false);
        }
      }
    },
    [isCurrent],
  );

  useEffect(() => {
    if (!activeEventId) {
      setPlacements([]);
      setUnscheduled([]);
      setRooms([]);
      setTracks([]);
      return;
    }
    // Initial / event-switch load: show Loading… (not a silent background resync).
    void loadAll(activeEventId);
  }, [activeEventId, loadAll]);

  // Deep-link from Speakers detail: ?sessionId= → select placement or tray item
  useEffect(() => {
    if (!deepLinkSessionId || loading) return;
    const placement = placements.find(
      (p) => p.sessionId === deepLinkSessionId,
    );
    if (placement) {
      setSelectedPlacementId(placement.id);
      setSelectedSessionId(null);
      setFocusedDayKey(zonedDayKey(placement.startsAt, timezone));
      setView("day");
      setToast({
        kind: "ok",
        text: `Focused session: ${placement.title ?? placement.sessionId}`,
      });
      // Consume query so refresh doesn't re-toast forever
      const next = new URLSearchParams(searchParams);
      next.delete("sessionId");
      setSearchParams(next, { replace: true });
      return;
    }
    const tray = unscheduled.find((s) => s.id === deepLinkSessionId);
    if (tray) {
      clickPlaceArmedRef.current = true;
      setSelectedSessionId(tray.id);
      setSelectedPlacementId(null);
      setView("day");
      setToast({
        kind: "ok",
        text: `Session is unscheduled: ${tray.title} — select a slot to place.`,
      });
      const next = new URLSearchParams(searchParams);
      next.delete("sessionId");
      setSearchParams(next, { replace: true });
      return;
    }
    setToast({
      kind: "error",
      text: "That session was not found on this event’s schedule.",
    });
    const next = new URLSearchParams(searchParams);
    next.delete("sessionId");
    setSearchParams(next, { replace: true });
  }, [
    deepLinkSessionId,
    loading,
    placements,
    unscheduled,
    timezone,
    searchParams,
    setSearchParams,
  ]);

  const pushUndo = useCallback((action: UndoAction) => {
    setUndoStack((prev) => [...prev, action]);
  }, []);

  const showConflict = useCallback(
    (conflicts: ScheduleConflictItem[]) => {
      // Banner + summary rows show event-local times (grid parity), not raw ISO.
      setApiConflictRows(apiConflictsToLocal(conflicts, timezone));
      setToast({
        kind: "conflict",
        text: formatConflictMessage(conflicts, timezone),
        conflicts,
      });
    },
    [timezone],
  );

  /**
   * Local room-overlap pre-flight. Returns true when blocked (caller must
   * abort; zero POST). Surfaces conflict toast + tile chrome via placementIds.
   */
  const blockLocalRoomOverlap = useCallback(
    (candidate: {
      roomId: string;
      startsAt: string;
      endsAt: string;
      excludePlacementId?: string;
    }): boolean => {
      const overlaps = findRoomOverlaps(placementsRef.current, candidate);
      if (overlaps.length === 0) return false;
      showConflict(localRoomConflictItems(overlaps, candidate.roomId));
      setRejectedSlotKey(slotKey(candidate.roomId, candidate.startsAt));
      window.setTimeout(() => setRejectedSlotKey(null), 1600);
      clickPlaceArmedRef.current = false;
      return true;
    },
    [showConflict],
  );

  const handleApiError = useCallback(
    async (
      res: Response,
      opts?: { rejectedSlotKey?: string | null },
    ): Promise<"conflict" | "version" | "other"> => {
      const raw: unknown = await res.json().catch(() => null);
      if (res.status === 409) {
        const conflict = ScheduleConflictErrorSchema.safeParse(raw);
        if (conflict.success) {
          // CONFLICT: keep source in place (caller loadAll/rollback), flash
          // rejected target, clear click-to-place so next empty slot click
          // emits ZERO POSTs.
          showConflict(conflict.data.conflicts);
          clickPlaceArmedRef.current = false;
          setSelectedPlacementId(null);
          setSelectedSessionId(null);
          if (opts?.rejectedSlotKey) {
            setRejectedSlotKey(opts.rejectedSlotKey);
            window.setTimeout(() => setRejectedSlotKey(null), 1600);
          }
          return "conflict";
        }
        const env = ErrorEnvelopeSchema.safeParse(raw);
        if (env.success && env.data.code === "VERSION") {
          const details = env.data.details as
            | { expectedVersion?: number; actual?: unknown }
            | undefined;
          // VERSION 409 → auto-reload + clear stale/undo; never silent retry.
          setUndoStack([]);
          clickPlaceArmedRef.current = false;
          setSelectedPlacementId(null);
          setSelectedSessionId(null);
          setStaleRecovery({
            message:
              "Schedule changed — refreshed, try again. Destination was not applied.",
            expectedVersion: details?.expectedVersion,
            actual: details?.actual,
          });
          setToast({
            kind: "error",
            text: "Schedule changed — refreshed, try again.",
          });
          return "version";
        }
      }
      const env = ErrorEnvelopeSchema.safeParse(raw);
      setToast({
        kind: "error",
        text: env.success
          ? env.data.error
          : `Request failed (${res.status})`,
      });
      return "other";
    },
    [showConflict],
  );

  const placeSession = useCallback(
    async (input: {
      sessionId: string;
      roomId: string;
      startsAt: string;
      endsAt: string;
      /** When true, do not push undo (used by undo itself). */
      skipUndo?: boolean;
    }) => {
      if (!activeEventId) return false;
      if (mutationInFlightRef.current) {
        setToast({
          kind: "error",
          text: "Busy saving another change — wait a moment and try again.",
        });
        return false;
      }
      mutationInFlightRef.current = true;
      setBusy(true);
      setPendingSessionId(input.sessionId);
      setToast(null);
      // Optimistic tray honesty for drag + keyboard place paths.
      setUnscheduled((prev) => prev.filter((s) => s.id !== input.sessionId));
      try {
        const res = await fetch(
          `/api/events/${encodeURIComponent(activeEventId)}/schedule/place`,
          {
            method: "POST",
            credentials: "include",
            headers: {
              "content-type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify({
              sessionId: input.sessionId,
              roomId: input.roomId,
              startsAt: input.startsAt,
              endsAt: input.endsAt,
            }),
          },
        );
        if (!res.ok) {
          await handleApiError(res, {
            rejectedSlotKey: slotKey(input.roomId, input.startsAt),
          });
          await loadAll(activeEventId, { silent: true });
          return false;
        }
        const raw: unknown = await res.json();
        const parsed = SchedulePlaceResponseSchema.safeParse(raw);
        if (!parsed.success) {
          setToast({ kind: "error", text: "Invalid place response" });
          await loadAll(activeEventId, { silent: true });
          return false;
        }
        // Apply response optimistically; background-refetch (no dead window).
        setPlacements((prev) => {
          const withoutDup = prev.filter((p) => p.id !== parsed.data.placement.id);
          return [...withoutDup, parsed.data.placement];
        });
        if (!input.skipUndo) {
          pushUndo(undoForPlace(parsed.data.placement));
        }
        setSelectedSessionId(null);
        clickPlaceArmedRef.current = false;
        setStaleRecovery(null);
        setApiConflictRows([]);
        setToast({ kind: "ok", text: "Session placed" });
        void loadAll(activeEventId, { silent: true });
        return true;
      } catch {
        setToast({ kind: "error", text: "Network error on place" });
        await loadAll(activeEventId, { silent: true });
        return false;
      } finally {
        mutationInFlightRef.current = false;
        setBusy(false);
        setPendingSessionId(null);
      }
    },
    [activeEventId, handleApiError, loadAll, pushUndo],
  );

  const movePlacement = useCallback(
    async (input: {
      placementId: string;
      roomId: string;
      startsAt: string;
      endsAt: string;
      /** Optional hint; re-read from live placements at commit (DnD verdict). */
      expectedVersion?: number;
      previous?: { roomId: string; startsAt: string; endsAt: string };
      skipUndo?: boolean;
    }) => {
      if (!activeEventId) return false;
      if (mutationInFlightRef.current) {
        setToast({
          kind: "error",
          text: "Busy saving another change — wait a moment and try again.",
        });
        return false;
      }
      // Commit-time version re-read from latest client snapshot (not pointerdown).
      const live = placementsRef.current.find((p) => p.id === input.placementId);
      const expectedVersion =
        live?.version ?? input.expectedVersion;
      if (expectedVersion == null) {
        setToast({ kind: "error", text: "Placement missing — refreshing" });
        await loadAll(activeEventId, { silent: true });
        return false;
      }
      const previous = input.previous ?? (live
        ? {
            roomId: live.roomId,
            startsAt: live.startsAt,
            endsAt: live.endsAt,
          }
        : undefined);

      mutationInFlightRef.current = true;
      setBusy(true);
      setPendingPlacementId(input.placementId);
      setToast(null);
      // Snapshot for local rollback if mutation or recovery fetch fails
      // (Codex DND-01: never leave rejected geometry painted when resync dies).
      const preMoveSnapshot = placementsRef.current.map((p) => ({ ...p }));
      // Optimistic geometry — tile moves immediately; failure snaps back.
      setPlacements((prev) =>
        prev.map((p) =>
          p.id === input.placementId
            ? {
                ...p,
                roomId: input.roomId,
                startsAt: input.startsAt,
                endsAt: input.endsAt,
              }
            : p,
        ),
      );
      try {
        const res = await fetch(
          `/api/events/${encodeURIComponent(activeEventId)}/schedule/move`,
          {
            method: "POST",
            credentials: "include",
            headers: {
              "content-type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify({
              placementId: input.placementId,
              roomId: input.roomId,
              startsAt: input.startsAt,
              endsAt: input.endsAt,
              expectedVersion,
            }),
          },
        );
        if (!res.ok) {
          // Local rollback first, then ALWAYS resync (smoking gun).
          setPlacements(preMoveSnapshot);
          await handleApiError(res, {
            rejectedSlotKey: slotKey(input.roomId, input.startsAt),
          });
          try {
            await loadAll(activeEventId, { silent: true });
          } catch {
            /* snapshot already restored */
          }
          return false;
        }
        const raw: unknown = await res.json();
        const parsed = ScheduleMoveResponseSchema.safeParse(raw);
        if (!parsed.success) {
          setPlacements(preMoveSnapshot);
          setToast({ kind: "error", text: "Invalid move response" });
          try {
            await loadAll(activeEventId, { silent: true });
          } catch {
            /* snapshot already restored */
          }
          return false;
        }
        // Authoritative response applied optimistically; refetch in background.
        setPlacements((prev) =>
          prev.map((p) =>
            p.id === parsed.data.placement.id ? parsed.data.placement : p,
          ),
        );
        if (!input.skipUndo && previous) {
          pushUndo(undoForMove(parsed.data.placement, previous));
        }
        setStaleRecovery(null);
        setApiConflictRows([]);
        setToast({ kind: "ok", text: "Session moved" });
        void loadAll(activeEventId, { silent: true });
        return true;
      } catch {
        setPlacements(preMoveSnapshot);
        setToast({ kind: "error", text: "Network error on move" });
        try {
          await loadAll(activeEventId, { silent: true });
        } catch {
          /* snapshot already restored */
        }
        return false;
      } finally {
        // Clear pending immediately so the next drag is not dead-windowed.
        mutationInFlightRef.current = false;
        setBusy(false);
        setPendingPlacementId(null);
      }
    },
    [activeEventId, handleApiError, loadAll, pushUndo],
  );

  const unschedulePlacement = useCallback(
    async (input: {
      placementId: string;
      expectedVersion?: number;
      previous?: {
        sessionId: string;
        roomId: string;
        startsAt: string;
        endsAt: string;
      };
      skipUndo?: boolean;
    }) => {
      if (!activeEventId) return false;
      if (mutationInFlightRef.current) {
        setToast({
          kind: "error",
          text: "Busy saving another change — wait a moment and try again.",
        });
        return false;
      }
      const live = placementsRef.current.find((p) => p.id === input.placementId);
      const expectedVersion = live?.version ?? input.expectedVersion;
      if (expectedVersion == null) {
        setToast({ kind: "error", text: "Placement missing — refreshing" });
        await loadAll(activeEventId, { silent: true });
        return false;
      }
      mutationInFlightRef.current = true;
      setBusy(true);
      setPendingPlacementId(input.placementId);
      setToast(null);
      try {
        const res = await fetch(
          `/api/events/${encodeURIComponent(activeEventId)}/schedule/unschedule`,
          {
            method: "POST",
            credentials: "include",
            headers: {
              "content-type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify({
              placementId: input.placementId,
              expectedVersion,
            }),
          },
        );
        if (!res.ok) {
          await handleApiError(res);
          await loadAll(activeEventId, { silent: true });
          return false;
        }
        const raw: unknown = await res.json();
        const parsed = ScheduleUnscheduleResponseSchema.safeParse(raw);
        if (!parsed.success) {
          setToast({ kind: "error", text: "Invalid unschedule response" });
          await loadAll(activeEventId, { silent: true });
          return false;
        }
        if (!input.skipUndo && input.previous) {
          pushUndo(undoForUnschedule(input.previous));
        }
        setSelectedPlacementId(null);
        clickPlaceArmedRef.current = false;
        setStaleRecovery(null);
        setApiConflictRows([]);
        setToast({ kind: "ok", text: "Session unscheduled" });
        void loadAll(activeEventId, { silent: true });
        return true;
      } catch {
        setToast({ kind: "error", text: "Network error on unschedule" });
        await loadAll(activeEventId, { silent: true });
        return false;
      } finally {
        mutationInFlightRef.current = false;
        setBusy(false);
        setPendingPlacementId(null);
      }
    },
    [activeEventId, handleApiError, loadAll, pushUndo],
  );

  const runUndo = useCallback(async () => {
    // Do not pop until success — a failed undo must remain stack-visible.
    if (!activeEventId || undoStack.length === 0 || mutationInFlightRef.current)
      return;
    const action = undoStack[undoStack.length - 1]!;
    let ok = false;
    if (action.kind === "unschedule") {
      ok = await unschedulePlacement({
        placementId: action.placementId,
        skipUndo: true,
      });
    } else if (action.kind === "place") {
      ok = await placeSession({ ...action, skipUndo: true });
    } else {
      ok = await movePlacement({
        placementId: action.placementId,
        roomId: action.roomId,
        startsAt: action.startsAt,
        endsAt: action.endsAt,
        skipUndo: true,
      });
    }
    if (ok) {
      setUndoStack((prev) => prev.slice(0, -1));
    }
  }, [
    activeEventId,
    undoStack,
    unschedulePlacement,
    placeSession,
    movePlacement,
  ]);

  const applyToSlot = useCallback(
    async (roomId: string, startsAt: string) => {
      const drag = dragPayloadRef.current;
      if (drag?.source === "tray") {
        const endsAt = addMinutesIso(startsAt, slotMinutes);
        if (
          blockLocalRoomOverlap({
            roomId,
            startsAt,
            endsAt,
          })
        ) {
          setDrag(null);
          return;
        }
        await placeSession({
          sessionId: drag.sessionId,
          roomId,
          startsAt,
          endsAt,
        });
        setDrag(null);
        return;
      }
      if (drag?.source === "placement") {
        // Preserve existing duration on move (do not reset to the grid interval).
        const endsAt = addMinutesIso(
          startsAt,
          durationMinutes(drag.startsAt, drag.endsAt),
        );
        if (
          blockLocalRoomOverlap({
            roomId,
            startsAt,
            endsAt,
            excludePlacementId: drag.placementId,
          })
        ) {
          setDrag(null);
          return;
        }
        // Version re-read at commit inside movePlacement (not drag.version).
        await movePlacement({
          placementId: drag.placementId,
          roomId,
          startsAt,
          endsAt,
          previous: {
            roomId: drag.roomId,
            startsAt: drag.startsAt,
            endsAt: drag.endsAt,
          },
        });
        setDrag(null);
        return;
      }
      // Click-to-place only when explicitly armed (no prior drag on that select).
      if (!clickPlaceArmedRef.current) return;
      if (selectedSessionId) {
        const endsAt = addMinutesIso(startsAt, slotMinutes);
        if (
          blockLocalRoomOverlap({
            roomId,
            startsAt,
            endsAt,
          })
        ) {
          return;
        }
        await placeSession({
          sessionId: selectedSessionId,
          roomId,
          startsAt,
          endsAt,
        });
        return;
      }
      if (selectedPlacementId) {
        const p = placementsRef.current.find(
          (x) => x.id === selectedPlacementId,
        );
        if (p) {
          const endsAt = addMinutesIso(
            startsAt,
            durationMinutes(p.startsAt, p.endsAt),
          );
          if (
            blockLocalRoomOverlap({
              roomId,
              startsAt,
              endsAt,
              excludePlacementId: p.id,
            })
          ) {
            return;
          }
          await movePlacement({
            placementId: p.id,
            roomId,
            startsAt,
            endsAt,
            previous: {
              roomId: p.roomId,
              startsAt: p.startsAt,
              endsAt: p.endsAt,
            },
          });
        }
      }
    },
    [
      selectedSessionId,
      selectedPlacementId,
      placeSession,
      movePlacement,
      setDrag,
      slotMinutes,
      blockLocalRoomOverlap,
    ],
  );

  const onSlotKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>, roomId: string, startsAt: string) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        void applyToSlot(roomId, startsAt);
      }
    },
    [applyToSlot],
  );

  /**
   * Drop payload onto a slot — same apply logic the old HTML5 onSlotDrop used
   * (place from tray; move preserving duration; no-op on same slot).
   *
   * Caller must already have cleared drag chrome (ghost/payload). We never
   * re-set dragPayload for the network RTT — pending* ids own save chrome.
   */
  const performDrop = useCallback(
    (payload: DragPayload, roomId: string, startsAt: string) => {
      // A completed drag never leaves click-to-place armed (teleport guard).
      clickPlaceArmedRef.current = false;
      setSelectedPlacementId(null);
      setSelectedSessionId(null);
      // No-op move onto same slot (avoid version churn / toast noise).
      if (
        payload.source === "placement" &&
        payload.roomId === roomId &&
        payload.startsAt === startsAt
      ) {
        return;
      }
      if (payload.source === "tray") {
        const endsAt = addMinutesIso(startsAt, slotMinutes);
        if (
          blockLocalRoomOverlap({
            roomId,
            startsAt,
            endsAt,
          })
        ) {
          return;
        }
        void placeSession({
          sessionId: payload.sessionId,
          roomId,
          startsAt,
          endsAt,
        });
      } else {
        // Preserve duration from the dragged placement.
        const endsAt = addMinutesIso(
          startsAt,
          durationMinutes(payload.startsAt, payload.endsAt),
        );
        if (
          blockLocalRoomOverlap({
            roomId,
            startsAt,
            endsAt,
            excludePlacementId: payload.placementId,
          })
        ) {
          return;
        }
        // Version re-read at commit inside movePlacement.
        void movePlacement({
          placementId: payload.placementId,
          roomId,
          startsAt,
          endsAt,
          previous: {
            roomId: payload.roomId,
            startsAt: payload.startsAt,
            endsAt: payload.endsAt,
          },
        });
      }
    },
    [movePlacement, placeSession, slotMinutes, blockLocalRoomOverlap],
  );
  const performDropRef = useRef(performDrop);
  performDropRef.current = performDrop;

  type EndGestureResult = {
    payload: DragPayload;
    active: boolean;
    clientX: number;
    clientY: number;
  };

  /**
   * Idempotent gesture end. Clears ref first so a subsequent lostpointercapture
   * from our own releasePointerCapture is a no-op. Returns a snapshot for the
   * up-handler to decide drop vs click; cancel paths discard the snapshot.
   */
  const endPointerGesture = useCallback(
    (opts: {
      pointerId: number;
      reason: "up" | "cancel" | "lost" | "escape";
      clientX?: number;
      clientY?: number;
    }): EndGestureResult | null => {
      const st = pointerDragRef.current;
      if (!st || st.pointerId !== opts.pointerId) return null;

      const snapshot: EndGestureResult = {
        payload: st.payload,
        active: st.active,
        clientX: opts.clientX ?? st.startX,
        clientY: opts.clientY ?? st.startY,
      };

      // Latch: clear before release so lostpointercapture cannot re-enter.
      pointerDragRef.current = null;
      detachWindowDragListeners();
      try {
        st.el.releasePointerCapture(st.pointerId);
      } catch {
        /* already released or never captured */
      }

      setDrag(null);
      setDragOverSlot(null);
      setGhostPos(null);

      if (snapshot.active) {
        suppressClickRef.current = true;
        if (opts.reason !== "up") {
          // Cancel paths may not produce a trailing click; do not leave the
          // one-shot flag set forever (must not swallow a later slot click).
          window.setTimeout(() => {
            suppressClickRef.current = false;
          }, 0);
        }
      }

      return snapshot;
    },
    [detachWindowDragListeners, setDrag],
  );
  const endPointerGestureRef = useRef(endPointerGesture);
  endPointerGestureRef.current = endPointerGesture;

  /** Cancel any in-flight pointer drag and clear all drag chrome. */
  const cancelPointerDrag = useCallback(() => {
    const st = pointerDragRef.current;
    if (st) {
      endPointerGestureRef.current({
        pointerId: st.pointerId,
        reason: "escape",
      });
      return;
    }
    // Orphan chrome (should not happen) — still clear.
    detachWindowDragListeners();
    setDrag(null);
    setDragOverSlot(null);
    setGhostPos(null);
  }, [detachWindowDragListeners, setDrag]);

  // Keep window handler table current every render (listeners call through).
  dragMachineRef.current.onMove = (e: PointerEvent) => {
    const st = pointerDragRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    if (!st.active) {
      if (!exceedsDragThreshold(st.startX, st.startY, e.clientX, e.clientY)) {
        return;
      }
      st.active = true;
      // Drag disarms click-to-place for this gesture (teleport guard).
      clickPlaceArmedRef.current = false;
      setDrag(st.payload);
    }
    e.preventDefault();
    setGhostPos({ x: e.clientX, y: e.clientY });
    // Ghost is pointer-events:none, so elementFromPoint sees the slot below.
    const slot = slotTargetFromElement(
      document.elementFromPoint(e.clientX, e.clientY),
    );
    setDragOverSlot(slot ? slot.key : null);
  };

  dragMachineRef.current.onUp = (e: PointerEvent) => {
    const snap = endPointerGestureRef.current({
      pointerId: e.pointerId,
      reason: "up",
      clientX: e.clientX,
      clientY: e.clientY,
    });
    if (!snap) return;
    if (!snap.active) {
      // Below threshold — a click; let the click handler select/open.
      return;
    }
    e.preventDefault();
    const slot = slotTargetFromElement(
      document.elementFromPoint(snap.clientX, snap.clientY),
    );
    if (slot) {
      // Chrome already cleared; commit from local snapshot only.
      performDropRef.current(snap.payload, slot.roomId, slot.startsAt);
    }
  };

  dragMachineRef.current.onCancel = (e: PointerEvent) => {
    endPointerGestureRef.current({
      pointerId: e.pointerId,
      reason: "cancel",
      clientX: e.clientX,
      clientY: e.clientY,
    });
  };

  dragMachineRef.current.onLost = (e: PointerEvent) => {
    // Only unexpected loss: after normal up we already cleared the ref.
    endPointerGestureRef.current({
      pointerId: e.pointerId,
      reason: "lost",
    });
  };

  /**
   * Arm a potential drag. Not a drag yet — pointer must travel beyond
   * DRAG_ACTIVATION_PX first, so plain clicks still select / open inspector.
   * Window listeners attach immediately so end never depends on source capture.
   */
  const onDragPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>, payload: DragPayload) => {
      if (e.button !== 0) return;
      // Do NOT gate on busy/pending — that is the post-drop dead window.
      // Concurrent mutations are serialized by mutationInFlightRef at commit.
      if (pointerDragRef.current) {
        endPointerGestureRef.current({
          pointerId: pointerDragRef.current.pointerId,
          reason: "cancel",
        });
      }
      suppressClickRef.current = false;
      const el = e.currentTarget;
      pointerDragRef.current = {
        payload,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        active: false,
        el,
      };
      // Best-effort capture (improves hit-testing under the cursor). The window
      // net is the safety net — capture is NOT optional for ending the gesture.
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* window listeners still own move/up/cancel */
      }
      attachWindowDragListeners();
    },
    [attachWindowDragListeners],
  );

  /** Escape cancels an active or armed drag. */
  useEffect(() => {
    const onKey = (ev: globalThis.KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (!pointerDragRef.current && !dragPayloadRef.current) return;
      cancelPointerDrag();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancelPointerDrag]);

  /** True (and consumed) when the click is the tail of a completed drag. */
  const consumeClickSuppression = useCallback(() => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return true;
    }
    return false;
  }, []);

  const placementTitle = (p: SchedulePlacementDto) =>
    p.title ?? p.sessionId;

  const focusConflictPlacement = useCallback(
    (conflict: LocalScheduleConflict) => {
      const id =
        conflict.placementId ?? conflict.affectedPlacementIds[0] ?? null;
      if (id) {
        setSelectedPlacementId(id);
        setSelectedSessionId(null);
        const p = placements.find((x) => x.id === id);
        if (p) setFocusedDayKey(zonedDayKey(p.startsAt, timezone));
        setView("day");
      }
    },
    [placements, timezone],
  );

  const renderTile = (
    occupant: SchedulePlacementDto,
    opts?: {
      compact?: boolean;
    },
  ) => {
    const compact = opts?.compact === true;
    const isSelected = selectedPlacementId === occupant.id;
    const isConflict = conflictPlacementSet.has(occupant.id);
    const isPending = pendingPlacementId === occupant.id;
    const color = trackColor(occupant.trackId);
    const style: CSSProperties | undefined = color
      ? ({ ["--schedule-track-color" as string]: color } as CSSProperties)
      : undefined;

    return (
      <div
        key={occupant.id}
        className={[
          "schedule-tile",
          "lumen-focusable",
          compact ? "schedule-tile--compact" : "",
          isSelected ? "schedule-tile--selected" : "",
          isConflict ? "schedule-tile--conflict" : "",
          isPending ? "schedule-tile--pending" : "",
          color ? "schedule-tile--tracked" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={style}
        data-testid={`schedule-placement-${occupant.id}`}
        data-session-id={occupant.sessionId}
        data-placement-id={occupant.id}
        data-version={occupant.version}
        data-conflict={isConflict ? "true" : undefined}
        data-pending={isPending ? "true" : undefined}
        data-draggable="true"
        tabIndex={0}
        // Pointer-event drag (all tiles incl. compact week/track/room ones).
        // A drop over a filled tile hit-tests up to its slot — nested honesty
        // without per-tile dragover/drop wiring.
        onPointerDown={(e) => {
          // Never gate pointerdown on isPending — post-drop dead window fix.
          // Move/up/cancel live on window while armed (stuck-ghost fix).
          onDragPointerDown(e, {
            source: "placement",
            placementId: occupant.id,
            sessionId: occupant.sessionId,
            title: occupant.title ?? occupant.sessionId,
            version: occupant.version,
            roomId: occupant.roomId,
            startsAt: occupant.startsAt,
            endsAt: occupant.endsAt,
          });
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (consumeClickSuppression()) return;
          // Pure click (no drag threshold) arms click-to-place.
          clickPlaceArmedRef.current = true;
          setSelectedPlacementId(occupant.id);
          setSelectedSessionId(null);
          setFocusedDayKey(zonedDayKey(occupant.startsAt, timezone));
        }}
      >
        {!compact ? (
          <span className="schedule-tile__track" aria-hidden />
        ) : null}
        <div className="schedule-tile__body">
          <span className="schedule-tile__title">
            {placementTitle(occupant)}
          </span>
          <span className="schedule-tile__meta">
            {formatTimeLabel(occupant.startsAt, timezone)}–
            {formatTimeLabel(occupant.endsAt, timezone)}
            {" · "}
            {roomName(occupant.roomId)}
          </span>
          {occupant.trackId ? (
            <span className="schedule-tile__track-label">
              {trackName(occupant.trackId)}
            </span>
          ) : null}
          {isConflict ? (
            <Badge
              tone="danger"
              showDot
              className="schedule-tile__badge"
              data-testid={`schedule-tile-conflict-${occupant.id}`}
            >
              Conflict
            </Badge>
          ) : null}
          {isPending ? (
            <Badge
              tone="info"
              className="schedule-tile__badge"
              data-testid={`schedule-tile-pending-${occupant.id}`}
            >
              Saving…
            </Badge>
          ) : null}
        </div>
      </div>
    );
  };

  const renderSlot = (roomId: string, startsAt: string) => {
    const key = slotKey(roomId, startsAt);
    // Start-row tiles: placements that BEGIN in this slot.
    const occupants = placements.filter((p) =>
      placementInSlot(p, roomId, startsAt, slotMinutes),
    );
    // Honest multi-row occupancy: any placement whose interval intersects.
    const occupying = placements.filter((p) =>
      placementOccupiesSlot(p, roomId, startsAt, slotMinutes),
    );
    const isContinuation =
      occupying.length > 0 &&
      occupants.length === 0 &&
      occupying.some((p) => !placementInSlot(p, roomId, startsAt, slotMinutes));
    const isOver = dragOverSlot === key;
    const isRejected = rejectedSlotKey === key;
    const hasConflict = occupying.some((o) => conflictPlacementSet.has(o.id));
    // Local pre-flight block for active drag destination.
    const drag = dragPayload;
    let blockedByLocal = false;
    if (drag) {
      const endsAt =
        drag.source === "placement"
          ? addMinutesIso(
              startsAt,
              durationMinutes(drag.startsAt, drag.endsAt),
            )
          : addMinutesIso(startsAt, slotMinutes);
      blockedByLocal = wouldRoomOverlap(placements, {
        roomId,
        startsAt,
        endsAt,
        excludePlacementId:
          drag.source === "placement" ? drag.placementId : undefined,
      });
    }
    return (
      <div
        key={key}
        className={[
          "schedule-studio__slot",
          "lumen-focusable",
          isOver ? "schedule-studio__slot--over" : "",
          occupants.length > 0 || isContinuation
            ? "schedule-studio__slot--filled"
            : "",
          isContinuation ? "schedule-studio__slot--continuation" : "",
          hasConflict ? "schedule-studio__slot--conflict" : "",
          isRejected ? "schedule-studio__slot--rejected" : "",
          blockedByLocal ? "schedule-studio__slot--blocked" : "",
          busy && (selectedSessionId || selectedPlacementId || dragPayload)
            ? "schedule-studio__slot--pending-target"
            : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-testid={`schedule-slot-${key}`}
        data-room-id={roomId}
        data-starts-at={startsAt}
        data-ends-at={addMinutesIso(startsAt, slotMinutes)}
        data-blocked={blockedByLocal ? "true" : undefined}
        data-continuation={isContinuation ? "true" : undefined}
        role="button"
        tabIndex={0}
        aria-label={`Slot ${roomName(roomId)} ${formatTimeLabel(startsAt, timezone)}`}
        onKeyDown={(e) => onSlotKeyDown(e, roomId, startsAt)}
        onClick={() => {
          if (consumeClickSuppression()) return;
          // Click-to-place only when armed (pure select, not residual drag intent).
          if (
            clickPlaceArmedRef.current &&
            (selectedSessionId || selectedPlacementId)
          ) {
            if (blockedByLocal) {
              const endsAtForBlock =
                dragPayload?.source === "placement"
                  ? addMinutesIso(
                      startsAt,
                      durationMinutes(
                        dragPayload.startsAt,
                        dragPayload.endsAt,
                      ),
                    )
                  : addMinutesIso(startsAt, slotMinutes);
              blockLocalRoomOverlap({
                roomId,
                startsAt,
                endsAt: endsAtForBlock,
                excludePlacementId:
                  dragPayload?.source === "placement"
                    ? dragPayload.placementId
                    : undefined,
              });
              return;
            }
            void applyToSlot(roomId, startsAt);
          }
        }}
      >
        <span className="schedule-studio__slot-time">
          {formatTimeLabel(startsAt, timezone)}
        </span>
        {occupants.length > 0 ? (
          occupants.map((occupant) => renderTile(occupant))
        ) : isContinuation ? (
          <span
            className="schedule-studio__slot-continuation"
            data-testid={`schedule-slot-occupied-${key}`}
          >
            Occupied
          </span>
        ) : (
          <span className="schedule-studio__slot-empty">Empty</span>
        )}
      </div>
    );
  };

  const renderDayGrid = (dayKey: string) => {
    const { dayStart, dayEnd } = dayWindowForEvent(
      dayKey,
      eventStartsAt,
      eventEndsAt,
      timezone,
      agendaWindow,
    );
    const slots = buildTimeSlots(dayStart, dayEnd, slotMinutes);
    const roomList =
      rooms.length > 0
        ? rooms
        : [{ id: "room_default", name: "Default room" } as RoomDto];
    const colStyle = {
      gridTemplateColumns: `var(--schedule-time-col, 4.5rem) repeat(${roomList.length}, minmax(9rem, 1fr))`,
    } as CSSProperties;

    return (
      <div
        className="schedule-studio__board"
        data-testid="schedule-board"
        data-day-key={dayKey}
      >
        <div
          className="schedule-studio__grid"
          data-testid={`schedule-day-grid-${dayKey}`}
        >
          <div
            className="schedule-studio__grid-header"
            data-testid="schedule-grid-header"
            role="row"
            style={colStyle}
          >
            <div
              className="schedule-studio__grid-corner"
              data-testid="schedule-grid-corner"
            >
              Time
            </div>
            {roomList.map((r) => (
              <div
                key={r.id}
                className="schedule-studio__grid-room"
                data-testid={`schedule-room-col-${r.id}`}
              >
                {r.name}
              </div>
            ))}
          </div>
          {slots.map((startsAt) => (
            <div
              key={startsAt}
              className="schedule-studio__grid-row"
              role="row"
              style={colStyle}
            >
              <div
                className="schedule-studio__grid-time"
                data-testid="schedule-grid-time"
              >
                {formatTimeLabel(startsAt, timezone)}
              </div>
              {roomList.map((r) => renderSlot(r.id, startsAt))}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const listView = (
    <div className="schedule-studio__list" data-testid="schedule-list-view">
      <table className="eval-queue__table" data-testid="schedule-list-table">
        <thead>
          <tr>
            <th>Session</th>
            <th>Room</th>
            <th>Starts</th>
            <th>Ends</th>
            <th>Version</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {placements.length === 0 ? (
            <tr>
              <td colSpan={6} className="eval-queue__muted">
                No placements yet — drag from the tray or keyboard-place into a
                day/room slot.
              </td>
            </tr>
          ) : (
            placements.map((p) => (
              <tr
                key={p.id}
                data-testid={`schedule-list-row-${p.id}`}
                data-session-id={p.sessionId}
                className={
                  conflictPlacementSet.has(p.id)
                    ? "schedule-studio__list-row--conflict"
                    : undefined
                }
              >
                <td>
                  <button
                    type="button"
                    className="eval-queue__link lumen-focusable"
                    data-testid={`schedule-list-session-${p.sessionId}`}
                    onClick={() => {
                      setSelectedPlacementId(p.id);
                      setSelectedSessionId(null);
                      // List chrome looks like a link — open day view on that day.
                      setFocusedDayKey(zonedDayKey(p.startsAt, timezone));
                      setView("day");
                    }}
                  >
                    {placementTitle(p)}
                  </button>
                  {conflictPlacementSet.has(p.id) ? (
                    <Badge tone="danger" showDot className="schedule-tile__badge">
                      Conflict
                    </Badge>
                  ) : null}
                </td>
                <td data-testid={`schedule-list-room-${p.id}`}>
                  {roomName(p.roomId)}
                </td>
                <td data-starts-at={p.startsAt}>
                  {formatTimeLabel(p.startsAt, timezone)}
                </td>
                <td>{formatTimeLabel(p.endsAt, timezone)}</td>
                <td data-version={p.version}>{p.version}</td>
                <td>
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid={`schedule-unschedule-${p.id}`}
                    disabled={busy}
                    pending={pendingPlacementId === p.id}
                    onClick={() =>
                      void unschedulePlacement({
                        placementId: p.id,
                        expectedVersion: p.version,
                        previous: {
                          sessionId: p.sessionId,
                          roomId: p.roomId,
                          startsAt: p.startsAt,
                          endsAt: p.endsAt,
                        },
                      })
                    }
                  >
                    Unschedule
                  </Button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  const dayView = (
    <div className="schedule-studio__day" data-testid="schedule-day-view">
      <p className="eval-queue__muted" data-testid="schedule-day-label">
        Day {primaryDay}
      </p>
      {renderDayGrid(primaryDay)}
    </div>
  );

  const weekView = (
    <div
      className="schedule-studio__week"
      data-testid="schedule-week-view"
      data-event-days={dayKeys.join(",")}
      data-day-count={String(dayKeys.length)}
    >
      {dayKeys.map((dk) => (
        <section
          key={dk}
          className="schedule-studio__week-day"
          data-testid={`schedule-week-day-${dk}`}
          data-day-key={dk}
        >
          <h4 className="schedule-studio__subhead">{dk}</h4>
          <ul className="schedule-studio__week-list">
            {placementsOnDay(placements, dk, timezone).length === 0 ? (
              <li className="eval-queue__muted">No sessions</li>
            ) : (
              placementsOnDay(placements, dk, timezone).map((p) => (
                <li
                  key={p.id}
                  data-testid={`schedule-week-placement-${p.id}`}
                >
                  {renderTile(p, { compact: true })}
                </li>
              ))
            )}
          </ul>
          {/* Slots for keyboard/drag place on each week day (first room). */}
          {rooms[0]
            ? buildTimeSlots(
                dayWindowForEvent(
                  dk,
                  eventStartsAt,
                  eventEndsAt,
                  timezone,
                  agendaWindow,
                ).dayStart,
                dayWindowForEvent(
                  dk,
                  eventStartsAt,
                  eventEndsAt,
                  timezone,
                  agendaWindow,
                ).dayEnd,
                slotMinutes,
              )
                .slice(0, 4)
                .map((startsAt) => renderSlot(rooms[0]!.id, startsAt))
            : null}
        </section>
      ))}
    </div>
  );

  const trackView = (
    <div className="schedule-studio__track" data-testid="schedule-track-view">
      {[...groupByTrack(placements).entries()].map(([trackId, list]) => (
        <section
          key={trackId}
          className="event-settings__card"
          data-testid={`schedule-track-group-${trackId}`}
        >
          <h4 className="event-settings__heading">{trackName(trackId)}</h4>
          <ul className="eval-queue__list">
            {list.map((p) => (
              <li key={p.id} data-testid={`schedule-track-placement-${p.id}`}>
                {renderTile(p, { compact: true })}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {placements.length === 0 ? (
        <p className="eval-queue__muted">No placed sessions to group by track.</p>
      ) : null}
      {/* Drop grid still available for place/move while in track view */}
      {rooms[0] ? renderDayGrid(primaryDay) : null}
    </div>
  );

  const roomView = (
    <div className="schedule-studio__room" data-testid="schedule-room-view">
      {[...groupByRoom(placements).entries()].map(([roomId, list]) => (
        <section
          key={roomId}
          className="event-settings__card"
          data-testid={`schedule-room-group-${roomId}`}
        >
          <h4 className="event-settings__heading">{roomName(roomId)}</h4>
          <ul className="eval-queue__list">
            {list.map((p) => (
              <li key={p.id} data-testid={`schedule-room-placement-${p.id}`}>
                {renderTile(p, { compact: true })}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {rooms.map((r) => (
        <section
          key={`slots-${r.id}`}
          className="schedule-studio__room-slots"
          data-testid={`schedule-room-slots-${r.id}`}
        >
          <h4 className="schedule-studio__subhead">{r.name} slots</h4>
          <div className="schedule-studio__room-slot-row">
            {buildTimeSlots(
              dayWindowForEvent(
                primaryDay,
                eventStartsAt,
                eventEndsAt,
                timezone,
                agendaWindow,
              ).dayStart,
              dayWindowForEvent(
                primaryDay,
                eventStartsAt,
                eventEndsAt,
                timezone,
                agendaWindow,
              ).dayEnd,
              slotMinutes,
            )
              .slice(0, 6)
              .map((startsAt) => renderSlot(r.id, startsAt))}
          </div>
        </section>
      ))}
      {rooms.length === 0 ? (
        <p className="eval-queue__muted" data-testid="schedule-no-rooms">
          Add rooms in Settings before placing sessions.
        </p>
      ) : null}
    </div>
  );

  // P8 Month view — calendar of event days with placement counts + jump-to-day.
  const monthView = (
    <div className="schedule-studio__month" data-testid="schedule-month-view">
      <div className="schedule-studio__month-grid">
        {dayKeys.map((dk) => {
          const dayPlacements = placementsOnDay(placements, dk, timezone);
          return (
            <button
              key={dk}
              type="button"
              className="schedule-studio__month-cell lumen-focusable"
              data-testid={`schedule-month-day-${dk}`}
              data-count={dayPlacements.length}
              onClick={() => {
                setFocusedDayKey(dk);
                setView("day");
              }}
            >
              <span className="schedule-studio__month-date">{dk}</span>
              <span className="schedule-studio__month-count">
                {dayPlacements.length} session
                {dayPlacements.length === 1 ? "" : "s"}
              </span>
              <ul className="schedule-studio__month-titles">
                {dayPlacements.slice(0, 3).map((p) => (
                  <li key={p.id}>{p.title ?? p.sessionId}</li>
                ))}
                {dayPlacements.length > 3 ? (
                  <li>+{dayPlacements.length - 3} more</li>
                ) : null}
              </ul>
            </button>
          );
        })}
      </div>
      {dayKeys.length === 0 ? (
        <p className="eval-queue__muted">Set event dates to build the month grid.</p>
      ) : null}
    </div>
  );

  // P8 Conflicts work-queue view.
  const conflictsView = (
    <div
      className="schedule-studio__conflicts-view"
      data-testid="schedule-conflicts-view"
    >
      {allConflicts.length === 0 ? (
        <p className="eval-queue__muted" data-testid="schedule-conflicts-empty">
          No hard conflicts on the board.
        </p>
      ) : (
        <ul className="schedule-studio__conflicts-list">
          {allConflicts.map((c, i) => (
            <li
              key={`${c.sessionId ?? "x"}-${i}`}
              className="schedule-studio__conflict-row"
              data-testid={`schedule-conflict-row-${i}`}
            >
              <Badge tone="danger" showDot>
                Conflict
              </Badge>
              <span>{c.message || "Schedule conflict"}</span>
              {c.sessionId ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  data-testid={`schedule-conflict-focus-${c.sessionId}`}
                  onClick={() => {
                    setSearchParams((prev) => {
                      const n = new URLSearchParams(prev);
                      n.set("sessionId", c.sessionId!);
                      return n;
                    });
                    setView("day");
                  }}
                >
                  Focus
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );


  const filteredUnscheduled = useMemo(() => {
    const q = traySearch.trim().toLowerCase();
    let list = unscheduled;
    if (q) {
      list = list.filter((s) => {
        const title = (s.title ?? "").toLowerCase();
        const track = (trackName(s.trackId) ?? "").toLowerCase();
        const status = (s.status ?? "").toLowerCase();
        return title.includes(q) || track.includes(q) || status.includes(q);
      });
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (traySort === "track") {
        return trackName(a.trackId).localeCompare(trackName(b.trackId)) ||
          (a.title ?? "").localeCompare(b.title ?? "");
      }
      if (traySort === "status") {
        return (a.status ?? "").localeCompare(b.status ?? "") ||
          (a.title ?? "").localeCompare(b.title ?? "");
      }
      return (a.title ?? "").localeCompare(b.title ?? "");
    });
    return sorted;
  }, [unscheduled, traySearch, traySort, trackName]);

  const viewBody = (() => {
    switch (view) {
      case "list":
        return listView;
      case "day":
        return dayView;
      case "week":
        return weekView;
      case "track":
        return trackView;
      case "room":
        return roomView;
      case "month":
        return monthView;
      case "conflicts":
        return conflictsView;
      default:
        return listView;
    }
  })();

  const placeHint =
    selectedSessionId || selectedPlacementId
      ? "Selection active — click or press Enter on a slot to place/move."
      : "Select a tray session or placement, then keyboard-place into a slot.";

  return (
    <div
      className="schedule-studio schedule-studio--l2"
      data-testid="page-schedule"
      data-section="11.5"
    >
      <PageHeader
        eyebrow="Schedule"
        title="Schedule Studio"
        description="Place sessions with drag-and-drop or keyboard. Hard conflicts block commits; undo reverses the last move."
        data-testid="schedule-page-header"
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              data-testid="schedule-undo"
              disabled={busy || undoStack.length === 0}
              onClick={() => void runUndo()}
            >
              Undo
            </Button>
            <Button
              variant="secondary"
              size="sm"
              data-testid="schedule-refresh"
              disabled={busy || loading}
              pending={loading && !busy}
              onClick={() => {
                setStaleRecovery(null);
                if (activeEventId) void loadAll(activeEventId);
              }}
            >
              Refresh
            </Button>
          </>
        }
      />

      {!activeEventId ? (
        <p className="eval-queue__muted" data-testid="schedule-no-event">
          Select an event to open Schedule Studio.
        </p>
      ) : (
        <>
          <div className="schedule-studio__toolbar" data-testid="schedule-toolbar">
            <div
              className="schedule-studio__tz"
              data-testid="schedule-timezone"
              data-timezone={timezone}
            >
              Timezone: <strong>{timezone}</strong>
            </div>
            <div
              className="schedule-studio__count"
              data-testid="schedule-placement-count"
              data-count={placements.length}
            >
              Placements: {placements.length}
            </div>
            <div
              className="schedule-studio__count"
              data-testid="schedule-unscheduled-count"
              data-count={unscheduled.length}
            >
              Unscheduled: {unscheduled.length}
            </div>
            {allConflicts.length > 0 ? (
              <Badge
                tone="danger"
                showDot
                data-testid="schedule-conflict-count"
              >
                {allConflicts.length} conflict
                {allConflicts.length === 1 ? "" : "s"}
              </Badge>
            ) : (
              <Badge tone="success" data-testid="schedule-conflict-clear">
                No conflicts
              </Badge>
            )}
            <span
              className="schedule-studio__place-hint"
              data-testid="schedule-place-hint"
            >
              {placeHint}
            </span>
          </div>

          <div
            className="schedule-studio__views"
            role="tablist"
            aria-label="Schedule views"
            data-testid="schedule-view-tabs"
          >
            {SCHEDULE_VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                className={[
                  "schedule-studio__view-tab",
                  "lumen-focusable",
                  view === v ? "schedule-studio__view-tab--active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-testid={`schedule-view-${v}`}
                onClick={() => setView(v)}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>

          {selectedPlacement ? (
            <section
              className="schedule-studio__inspector event-settings__card"
              data-testid="schedule-inspector"
              aria-label="Reschedule selected session"
            >
              <h3
                className="event-settings__heading"
                data-testid="schedule-inspector-title"
              >
                Reschedule · {selectedPlacement.title ?? selectedPlacement.sessionId}
              </h3>
              <p className="eval-queue__muted">
                Drag the tile to a slot, or set room / day / time and apply.
                Times use event timezone ({timezone}).
              </p>
              <div className="schedule-studio__inspector-fields">
                <label className="schedule-studio__inspector-field">
                  <span>Room</span>
                  <select
                    className="lumen-focusable"
                    data-testid="schedule-inspector-room"
                    value={inspectorRoomId}
                    onChange={(e) => setInspectorRoomId(e.target.value)}
                  >
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="schedule-studio__inspector-field">
                  <span>Day</span>
                  <input
                    type="date"
                    className="lumen-focusable"
                    data-testid="schedule-inspector-day"
                    value={inspectorDay}
                    onChange={(e) => setInspectorDay(e.target.value)}
                  />
                </label>
                <label className="schedule-studio__inspector-field">
                  <span>Start time</span>
                  <input
                    type="time"
                    className="lumen-focusable"
                    data-testid="schedule-inspector-time"
                    value={inspectorTime}
                    onChange={(e) => setInspectorTime(e.target.value)}
                  />
                </label>
              </div>
              <div className="schedule-studio__inspector-actions">
                <Button
                  variant="primary"
                  size="sm"
                  data-testid="schedule-inspector-apply"
                  disabled={busy || !inspectorRoomId || !inspectorDay}
                  onClick={() => {
                    const [hh, mm] = inspectorTime.split(":").map(Number);
                    const startsAt = zonedWallToUtcIso(
                      inspectorDay,
                      hh || 0,
                      mm || 0,
                      timezone,
                    );
                    const endsAt = addMinutesIso(
                      startsAt,
                      durationMinutes(
                        selectedPlacement.startsAt,
                        selectedPlacement.endsAt,
                      ),
                    );
                    setFocusedDayKey(inspectorDay);
                    setView("day");
                    void movePlacement({
                      placementId: selectedPlacement.id,
                      roomId: inspectorRoomId,
                      startsAt,
                      endsAt,
                      expectedVersion: selectedPlacement.version,
                      previous: {
                        roomId: selectedPlacement.roomId,
                        startsAt: selectedPlacement.startsAt,
                        endsAt: selectedPlacement.endsAt,
                      },
                    });
                  }}
                >
                  Apply reschedule
                </Button>
                <Button
                  variant="quiet"
                  size="sm"
                  data-testid="schedule-inspector-unschedule"
                  disabled={busy}
                  onClick={() => {
                    void unschedulePlacement({
                      placementId: selectedPlacement.id,
                      expectedVersion: selectedPlacement.version,
                      previous: {
                        sessionId: selectedPlacement.sessionId,
                        roomId: selectedPlacement.roomId,
                        startsAt: selectedPlacement.startsAt,
                        endsAt: selectedPlacement.endsAt,
                      },
                    });
                    setSelectedPlacementId(null);
                  }}
                >
                  Unschedule to tray
                </Button>
                <Button
                  variant="quiet"
                  size="sm"
                  data-testid="schedule-inspector-clear"
                  onClick={() => setSelectedPlacementId(null)}
                >
                  Clear selection
                </Button>
              </div>
            </section>
          ) : null}

          {allConflicts.length > 0 ? (
            <section
              className="schedule-studio__conflict-summary"
              data-testid="schedule-conflict-summary"
              aria-label="Schedule conflicts"
            >
              <div className="schedule-studio__conflict-summary-head">
                <h3 className="schedule-studio__conflict-summary-title">
                  Conflict summary
                </h3>
                <Button
                  variant="quiet"
                  size="sm"
                  data-testid="schedule-conflict-dismiss"
                  onClick={() => {
                    setApiConflictRows([]);
                    if (toast?.kind === "conflict") setToast(null);
                  }}
                >
                  Dismiss alerts
                </Button>
              </div>
              <ul
                className="schedule-studio__conflict-list"
                data-testid="schedule-conflict-list"
              >
                {allConflicts.map((c, i) => (
                  <li key={`${c.type}-${c.message}-${i}`}>
                    <button
                      type="button"
                      className="schedule-studio__conflict-item lumen-focusable"
                      data-testid={`schedule-conflict-item-${i}`}
                      data-conflict-type={c.type}
                      onClick={() => focusConflictPlacement(c)}
                    >
                      <Badge
                        tone="danger"
                        showDot
                        className="schedule-studio__conflict-type"
                      >
                        {c.type}
                      </Badge>
                      <span className="schedule-studio__conflict-msg">
                        {c.message}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {staleRecovery ? (
            <div
              className="schedule-studio__stale"
              data-testid="schedule-stale-recovery"
              role="alert"
            >
              <p>{staleRecovery.message}</p>
              <p className="eval-queue__muted">
                expectedVersion={String(staleRecovery.expectedVersion ?? "—")}{" "}
                actual={String(staleRecovery.actual ?? "—")}
              </p>
              <Button
                variant="primary"
                size="sm"
                data-testid="schedule-stale-refresh"
                onClick={() => {
                  setStaleRecovery(null);
                  void loadAll(activeEventId);
                }}
              >
                Refresh schedule
              </Button>
            </div>
          ) : null}

          {toast ? (
            <div
              className={[
                "schedule-studio__toast",
                toast.kind === "conflict"
                  ? "schedule-studio__toast--conflict"
                  : toast.kind === "error"
                    ? "schedule-studio__toast--error"
                    : "schedule-studio__toast--ok",
              ].join(" ")}
              data-testid={
                toast.kind === "conflict"
                  ? "schedule-conflict-toast"
                  : "schedule-status-toast"
              }
              role="status"
              data-kind={toast.kind}
            >
              {toast.text}
            </div>
          ) : null}

          {dragPayload ? (
            <div
              className="schedule-studio__ghost"
              data-testid="schedule-dnd-ghost"
              data-drag-source={dragPayload.source}
              style={
                ghostPos
                  ? { left: ghostPos.x + 14, top: ghostPos.y + 12 }
                  : undefined
              }
              aria-hidden
            >
              Dragging: {dragPayload.title}
            </div>
          ) : null}

          {loadError ? (
            <Alert tone="danger" data-testid="schedule-load-error">
              {loadError}
            </Alert>
          ) : null}
          {loading ? (
            <p className="eval-queue__muted" data-testid="schedule-loading">
              Loading schedule…
            </p>
          ) : null}

          <div className="schedule-studio__layout">
            <aside
              className="schedule-studio__tray event-settings__card"
              data-testid="schedule-tray"
              aria-label="Unscheduled sessions"
            >
              <h3 className="event-settings__heading">Unscheduled tray</h3>
              <p className="eval-queue__muted">
                Drag a session onto a slot, or select then press Enter on a
                focused slot.
              </p>
              <div className="schedule-studio__tray-controls">
                <label className="event-settings__label" htmlFor="schedule-tray-search">
                  Search tray
                </label>
                <input
                  id="schedule-tray-search"
                  className="event-settings__input lumen-focusable"
                  data-testid="schedule-tray-search"
                  type="search"
                  placeholder="Filter by title, track, status…"
                  value={traySearch}
                  onChange={(e) => setTraySearch(e.target.value)}
                />
                <label className="event-settings__label" htmlFor="schedule-tray-sort">
                  Sort by
                </label>
                <select
                  id="schedule-tray-sort"
                  className="event-settings__input lumen-focusable"
                  data-testid="schedule-tray-sort"
                  value={traySort}
                  onChange={(e) =>
                    setTraySort(e.target.value as "title" | "track" | "status")
                  }
                >
                  <option value="title">Title</option>
                  <option value="track">Track</option>
                  <option value="status">Status</option>
                </select>
              </div>
              <ul className="eval-queue__list" data-testid="schedule-tray-list">
                {unscheduled.length === 0 ? (
                  <li
                    className="eval-queue__muted"
                    data-testid="schedule-tray-empty"
                  >
                    Tray empty — all sessions placed or none created.
                  </li>
                ) : filteredUnscheduled.length === 0 ? (
                  <li
                    className="eval-queue__muted"
                    data-testid="schedule-tray-filter-empty"
                  >
                    No tray sessions match this search.
                  </li>
                ) : (
                  filteredUnscheduled.map((s) => (
                    <li key={s.id}>
                      {/*
                        Div with role=button (kept from the HTML5-DnD era for
                        grab-surface parity); dragging is pointer-event based.
                      */}
                      <div
                        role="button"
                        className={[
                          "schedule-tray-item",
                          "lumen-focusable",
                          selectedSessionId === s.id
                            ? "schedule-tray-item--selected"
                            : "",
                          pendingSessionId === s.id
                            ? "schedule-tray-item--pending"
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        data-testid={`schedule-tray-item-${s.id}`}
                        data-session-id={s.id}
                        data-pending={
                          pendingSessionId === s.id ? "true" : undefined
                        }
                        data-draggable="true"
                        tabIndex={0}
                        aria-selected={selectedSessionId === s.id}
                        aria-grabbed={
                          dragPayload?.source === "tray" &&
                          dragPayload.sessionId === s.id
                            ? true
                            : undefined
                        }
                        onPointerDown={(e) => {
                          // Never gate on pending — dead-window fix (same as tiles).
                          // Move/up/cancel live on window while armed (stuck-ghost fix).
                          onDragPointerDown(e, {
                            source: "tray",
                            sessionId: s.id,
                            title: s.title,
                          });
                        }}
                        onClick={() => {
                          if (consumeClickSuppression()) return;
                          clickPlaceArmedRef.current = true;
                          setSelectedSessionId(s.id);
                          setSelectedPlacementId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            clickPlaceArmedRef.current = true;
                            setSelectedSessionId(s.id);
                            setSelectedPlacementId(null);
                          }
                        }}
                      >
                        <span
                          className="schedule-tray-item__grip"
                          aria-hidden
                          title="Drag to schedule"
                        />
                        <span className="schedule-tray-item__title">
                          {s.title}
                        </span>
                        <span className="schedule-tray-item__meta">
                          {trackName(s.trackId)} · drag or select + slot Enter
                        </span>
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </aside>

            <section
              className="schedule-studio__main event-settings__card"
              data-testid={`schedule-view-panel-${view}`}
              aria-label={`${view} view`}
            >
              {viewBody}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
