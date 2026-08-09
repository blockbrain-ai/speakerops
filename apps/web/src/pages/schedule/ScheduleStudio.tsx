/**
 * Schedule Studio — five views + tray + DnD + keyboard place + undo
 * (section 6.2 / S-SCHED · 11.5 / S-L2-SCHED visual polish).
 *
 * Lumen 2: full-height working surface, sticky time/room headers, richer
 * session tiles (track encoding, conflict/pending), navigable conflict summary.
 * Native HTML5 drag only — no DnD package.
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
  type DragEvent,
  type KeyboardEvent,
} from "react";
import {
  ScheduleListResponseSchema,
  SchedulePlaceResponseSchema,
  ScheduleMoveResponseSchema,
  ScheduleUnscheduleResponseSchema,
  RoomListResponseSchema,
  TrackListResponseSchema,
  ScheduleConflictErrorSchema,
  ErrorEnvelopeSchema,
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
  DEFAULT_SLOT_MINUTES,
  addMinutesIso,
  apiConflictsToLocal,
  buildDayKeys,
  buildTimeSlots,
  conflictedPlacementIds,
  dayWindowForEvent,
  detectLocalRoomConflicts,
  durationMinutes,
  formatConflictMessage,
  formatTimeLabel,
  groupByRoom,
  groupByTrack,
  placementInSlot,
  placementsOnDay,
  safeTrackColor,
  slotKey,
  undoForMove,
  undoForPlace,
  undoForUnschedule,
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

  const loadGenRef = useRef(0);
  const activeEventIdRef = useRef(activeEventId);
  activeEventIdRef.current = activeEventId;

  /** Default day-by-room studio per page-atlas (L2). */
  const [view, setView] = useState<ScheduleViewMode>("day");
  const [placements, setPlacements] = useState<SchedulePlacementDto[]>([]);
  const [unscheduled, setUnscheduled] = useState<UnscheduledSessionDto[]>([]);
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

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(
    null,
  );
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [toast, setToast] = useState<ToastState>(null);
  const [staleRecovery, setStaleRecovery] = useState<StaleRecovery | null>(
    null,
  );
  /** API conflict rows kept for summary + tile marks until cleared. */
  const [apiConflictRows, setApiConflictRows] = useState<
    LocalScheduleConflict[]
  >([]);

  const [dragPayload, setDragPayload] = useState<DragPayload | null>(null);
  /** Sync ref so HTML5 drop sees payload even when React state has not flushed. */
  const dragPayloadRef = useRef<DragPayload | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<string | null>(null);

  const setDrag = useCallback((payload: DragPayload | null) => {
    dragPayloadRef.current = payload;
    setDragPayload(payload);
  }, []);

  const timezone = activeEvent?.timezone ?? "UTC";
  const eventStartsAt = activeEvent?.startsAt ?? null;
  const eventEndsAt = activeEvent?.endsAt ?? null;

  // Week/day chrome: only event-range days (never pad to Mon–Sun). S-SCHED-CHROME.
  const dayKeys = useMemo(
    () => buildDayKeys(eventStartsAt, eventEndsAt, 7, timezone),
    [eventStartsAt, eventEndsAt, timezone],
  );
  const primaryDay = dayKeys[0] ?? "2026-09-01";

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

  const loadAll = useCallback(
    async (eventId: string) => {
      const gen = ++loadGenRef.current;
      setLoading(true);
      setLoadError(null);
      try {
        const [schedRes, roomsRes, tracksRes] = await Promise.all([
          fetch(
            `/api/events/${encodeURIComponent(eventId)}/schedule?view=${view}`,
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
          setLoadError(`Schedule load failed (${schedRes.status})`);
          setPlacements([]);
          setUnscheduled([]);
          return;
        }
        const schedRaw: unknown = await schedRes.json();
        if (!isCurrent(eventId, gen)) return;
        const sched = ScheduleListResponseSchema.safeParse(schedRaw);
        if (!sched.success) {
          setLoadError("Invalid schedule response");
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
        setLoadError("Network error loading schedule");
      } finally {
        if (isCurrent(eventId, gen)) setLoading(false);
      }
    },
    [isCurrent, view],
  );

  useEffect(() => {
    if (!activeEventId) {
      setPlacements([]);
      setUnscheduled([]);
      setRooms([]);
      setTracks([]);
      return;
    }
    void loadAll(activeEventId);
  }, [activeEventId, loadAll]);

  const pushUndo = useCallback((action: UndoAction) => {
    setUndoStack((prev) => [...prev, action]);
  }, []);

  const showConflict = useCallback((conflicts: ScheduleConflictItem[]) => {
    setApiConflictRows(apiConflictsToLocal(conflicts));
    setToast({
      kind: "conflict",
      text: formatConflictMessage(conflicts),
      conflicts,
    });
  }, []);

  const handleApiError = useCallback(
    async (res: Response): Promise<"conflict" | "version" | "other"> => {
      const raw: unknown = await res.json().catch(() => null);
      if (res.status === 409) {
        const conflict = ScheduleConflictErrorSchema.safeParse(raw);
        if (conflict.success) {
          showConflict(conflict.data.conflicts);
          return "conflict";
        }
        const env = ErrorEnvelopeSchema.safeParse(raw);
        if (env.success && env.data.code === "VERSION") {
          const details = env.data.details as
            | { expectedVersion?: number; actual?: unknown }
            | undefined;
          setStaleRecovery({
            message:
              "Someone else changed this placement. Refresh to recover — no silent overwrite.",
            expectedVersion: details?.expectedVersion,
            actual: details?.actual,
          });
          setToast({
            kind: "error",
            text: "Stale version — refresh to recover",
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
      if (!activeEventId || busy) return false;
      setBusy(true);
      setPendingSessionId(input.sessionId);
      setToast(null);
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
          await handleApiError(res);
          return false;
        }
        const raw: unknown = await res.json();
        const parsed = SchedulePlaceResponseSchema.safeParse(raw);
        if (!parsed.success) {
          setToast({ kind: "error", text: "Invalid place response" });
          return false;
        }
        if (!input.skipUndo) {
          pushUndo(undoForPlace(parsed.data.placement));
        }
        setSelectedSessionId(null);
        setStaleRecovery(null);
        setApiConflictRows([]);
        setToast({ kind: "ok", text: "Session placed" });
        await loadAll(activeEventId);
        return true;
      } catch {
        setToast({ kind: "error", text: "Network error on place" });
        return false;
      } finally {
        setBusy(false);
        setPendingSessionId(null);
      }
    },
    [activeEventId, busy, handleApiError, loadAll, pushUndo],
  );

  const movePlacement = useCallback(
    async (input: {
      placementId: string;
      roomId: string;
      startsAt: string;
      endsAt: string;
      expectedVersion: number;
      previous?: { roomId: string; startsAt: string; endsAt: string };
      skipUndo?: boolean;
    }) => {
      if (!activeEventId || busy) return false;
      setBusy(true);
      setPendingPlacementId(input.placementId);
      setToast(null);
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
              expectedVersion: input.expectedVersion,
            }),
          },
        );
        if (!res.ok) {
          await handleApiError(res);
          return false;
        }
        const raw: unknown = await res.json();
        const parsed = ScheduleMoveResponseSchema.safeParse(raw);
        if (!parsed.success) {
          setToast({ kind: "error", text: "Invalid move response" });
          return false;
        }
        if (!input.skipUndo && input.previous) {
          pushUndo(undoForMove(parsed.data.placement, input.previous));
        }
        setStaleRecovery(null);
        setApiConflictRows([]);
        setToast({ kind: "ok", text: "Session moved" });
        await loadAll(activeEventId);
        return true;
      } catch {
        setToast({ kind: "error", text: "Network error on move" });
        return false;
      } finally {
        setBusy(false);
        setPendingPlacementId(null);
      }
    },
    [activeEventId, busy, handleApiError, loadAll, pushUndo],
  );

  const unschedulePlacement = useCallback(
    async (input: {
      placementId: string;
      expectedVersion: number;
      previous?: {
        sessionId: string;
        roomId: string;
        startsAt: string;
        endsAt: string;
      };
      skipUndo?: boolean;
    }) => {
      if (!activeEventId || busy) return false;
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
              expectedVersion: input.expectedVersion,
            }),
          },
        );
        if (!res.ok) {
          await handleApiError(res);
          return false;
        }
        const raw: unknown = await res.json();
        const parsed = ScheduleUnscheduleResponseSchema.safeParse(raw);
        if (!parsed.success) {
          setToast({ kind: "error", text: "Invalid unschedule response" });
          return false;
        }
        if (!input.skipUndo && input.previous) {
          pushUndo(undoForUnschedule(input.previous));
        }
        setSelectedPlacementId(null);
        setStaleRecovery(null);
        setApiConflictRows([]);
        setToast({ kind: "ok", text: "Session unscheduled" });
        await loadAll(activeEventId);
        return true;
      } catch {
        setToast({ kind: "error", text: "Network error on unschedule" });
        return false;
      } finally {
        setBusy(false);
        setPendingPlacementId(null);
      }
    },
    [activeEventId, busy, handleApiError, loadAll, pushUndo],
  );

  const runUndo = useCallback(async () => {
    if (!activeEventId || undoStack.length === 0 || busy) return;
    const action = undoStack[undoStack.length - 1]!;
    setUndoStack((prev) => prev.slice(0, -1));
    if (action.kind === "unschedule") {
      await unschedulePlacement({
        placementId: action.placementId,
        expectedVersion: action.expectedVersion,
        skipUndo: true,
      });
    } else if (action.kind === "place") {
      await placeSession({ ...action, skipUndo: true });
    } else {
      await movePlacement({
        placementId: action.placementId,
        roomId: action.roomId,
        startsAt: action.startsAt,
        endsAt: action.endsAt,
        expectedVersion: action.expectedVersion,
        skipUndo: true,
      });
    }
  }, [
    activeEventId,
    undoStack,
    busy,
    unschedulePlacement,
    placeSession,
    movePlacement,
  ]);

  const applyToSlot = useCallback(
    async (roomId: string, startsAt: string) => {
      const drag = dragPayloadRef.current;
      if (drag?.source === "tray") {
        const endsAt = addMinutesIso(startsAt, DEFAULT_SLOT_MINUTES);
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
        // Preserve existing duration on move (do not reset to DEFAULT_SLOT_MINUTES).
        const endsAt = addMinutesIso(
          startsAt,
          durationMinutes(drag.startsAt, drag.endsAt),
        );
        await movePlacement({
          placementId: drag.placementId,
          roomId,
          startsAt,
          endsAt,
          expectedVersion: drag.version,
          previous: {
            roomId: drag.roomId,
            startsAt: drag.startsAt,
            endsAt: drag.endsAt,
          },
        });
        setDrag(null);
        return;
      }
      if (selectedSessionId) {
        const endsAt = addMinutesIso(startsAt, DEFAULT_SLOT_MINUTES);
        await placeSession({
          sessionId: selectedSessionId,
          roomId,
          startsAt,
          endsAt,
        });
        return;
      }
      if (selectedPlacementId) {
        const p = placements.find((x) => x.id === selectedPlacementId);
        if (p) {
          const endsAt = addMinutesIso(
            startsAt,
            durationMinutes(p.startsAt, p.endsAt),
          );
          await movePlacement({
            placementId: p.id,
            roomId,
            startsAt,
            endsAt,
            expectedVersion: p.version,
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
      placements,
      placeSession,
      movePlacement,
      setDrag,
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

  const onTrayDragStart = (
    e: DragEvent,
    session: UnscheduledSessionDto,
  ) => {
    const payload: DragPayload = {
      source: "tray",
      sessionId: session.id,
      title: session.title,
    };
    setDrag(payload);
    e.dataTransfer.setData("application/json", JSON.stringify(payload));
    e.dataTransfer.setData("text/plain", session.id);
    e.dataTransfer.effectAllowed = "copyMove";
  };

  const onPlacementDragStart = (
    e: DragEvent,
    p: SchedulePlacementDto,
  ) => {
    const payload: DragPayload = {
      source: "placement",
      placementId: p.id,
      sessionId: p.sessionId,
      title: p.title ?? p.sessionId,
      version: p.version,
      roomId: p.roomId,
      startsAt: p.startsAt,
      endsAt: p.endsAt,
    };
    setDrag(payload);
    setSelectedPlacementId(p.id);
    e.dataTransfer.setData("application/json", JSON.stringify(payload));
    e.dataTransfer.setData("text/plain", p.id);
    e.dataTransfer.effectAllowed = "move";
  };

  const onDragEnd = () => {
    setDrag(null);
    setDragOverSlot(null);
  };

  const onSlotDragOver = (e: DragEvent, key: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect =
      dragPayloadRef.current?.source === "tray" ? "copy" : "move";
    setDragOverSlot(key);
  };

  const onSlotDrop = (e: DragEvent, roomId: string, startsAt: string) => {
    e.preventDefault();
    setDragOverSlot(null);
    // Prefer dataTransfer; fall back to ref (Playwright / incomplete DnD).
    let payload = dragPayloadRef.current;
    try {
      const raw = e.dataTransfer.getData("application/json");
      if (raw) payload = JSON.parse(raw) as DragPayload;
    } catch {
      /* keep ref payload */
    }
    if (!payload) return;
    setDrag(payload);
    if (payload.source === "tray") {
      const endsAt = addMinutesIso(startsAt, DEFAULT_SLOT_MINUTES);
      void placeSession({
        sessionId: payload.sessionId,
        roomId,
        startsAt,
        endsAt,
      }).finally(() => setDrag(null));
    } else {
      // Preserve duration from the dragged placement.
      const endsAt = addMinutesIso(
        startsAt,
        durationMinutes(payload.startsAt, payload.endsAt),
      );
      void movePlacement({
        placementId: payload.placementId,
        roomId,
        startsAt,
        endsAt,
        expectedVersion: payload.version,
        previous: {
          roomId: payload.roomId,
          startsAt: payload.startsAt,
          endsAt: payload.endsAt,
        },
      }).finally(() => setDrag(null));
    }
  };

  const placementTitle = (p: SchedulePlacementDto) =>
    p.title ?? p.sessionId;

  const focusConflictPlacement = useCallback(
    (conflict: LocalScheduleConflict) => {
      const id =
        conflict.placementId ?? conflict.affectedPlacementIds[0] ?? null;
      if (id) {
        setSelectedPlacementId(id);
        setSelectedSessionId(null);
        setView("day");
      }
    },
    [],
  );

  const renderTile = (
    occupant: SchedulePlacementDto,
    opts?: { compact?: boolean },
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
        draggable={!compact}
        tabIndex={0}
        onDragStart={
          compact
            ? undefined
            : (e) => onPlacementDragStart(e, occupant)
        }
        onDragEnd={compact ? undefined : onDragEnd}
        onClick={(e) => {
          e.stopPropagation();
          setSelectedPlacementId(occupant.id);
          setSelectedSessionId(null);
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
    // Match by slot window (not exact ISO equality) so e.g. 10:30 appears in 10:00 hour.
    // Multiple non-overlapping placements can begin in the same hour (10:00 + 10:30);
    // render all of them — never placements.find() which hides the rest.
    const occupants = placements.filter((p) =>
      placementInSlot(p, roomId, startsAt, DEFAULT_SLOT_MINUTES),
    );
    const isOver = dragOverSlot === key;
    const hasConflict = occupants.some((o) => conflictPlacementSet.has(o.id));
    return (
      <div
        key={key}
        className={[
          "schedule-studio__slot",
          "lumen-focusable",
          isOver ? "schedule-studio__slot--over" : "",
          occupants.length > 0 ? "schedule-studio__slot--filled" : "",
          hasConflict ? "schedule-studio__slot--conflict" : "",
          busy && (selectedSessionId || selectedPlacementId || dragPayload)
            ? "schedule-studio__slot--pending-target"
            : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-testid={`schedule-slot-${key}`}
        data-room-id={roomId}
        data-starts-at={startsAt}
        data-ends-at={addMinutesIso(startsAt, DEFAULT_SLOT_MINUTES)}
        role="button"
        tabIndex={0}
        aria-label={`Slot ${roomName(roomId)} ${formatTimeLabel(startsAt, timezone)}`}
        onDragOver={(e) => onSlotDragOver(e, key)}
        onDragLeave={() => setDragOverSlot((cur) => (cur === key ? null : cur))}
        onDrop={(e) => onSlotDrop(e, roomId, startsAt)}
        onKeyDown={(e) => onSlotKeyDown(e, roomId, startsAt)}
        onClick={() => {
          if (selectedSessionId || selectedPlacementId) {
            void applyToSlot(roomId, startsAt);
          }
        }}
      >
        <span className="schedule-studio__slot-time">
          {formatTimeLabel(startsAt, timezone)}
        </span>
        {occupants.length > 0 ? (
          occupants.map((occupant) => renderTile(occupant))
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
    );
    const slots = buildTimeSlots(dayStart, dayEnd, DEFAULT_SLOT_MINUTES);
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
                dayWindowForEvent(dk, eventStartsAt, eventEndsAt, timezone)
                  .dayStart,
                dayWindowForEvent(dk, eventStartsAt, eventEndsAt, timezone)
                  .dayEnd,
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
              ).dayStart,
              dayWindowForEvent(
                primaryDay,
                eventStartsAt,
                eventEndsAt,
                timezone,
              ).dayEnd,
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
                  Dismiss API alerts
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
              <ul className="eval-queue__list" data-testid="schedule-tray-list">
                {unscheduled.length === 0 ? (
                  <li
                    className="eval-queue__muted"
                    data-testid="schedule-tray-empty"
                  >
                    Tray empty — all sessions placed or none created.
                  </li>
                ) : (
                  unscheduled.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
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
                        draggable
                        aria-selected={selectedSessionId === s.id}
                        onDragStart={(e) => onTrayDragStart(e, s)}
                        onDragEnd={onDragEnd}
                        onClick={() => {
                          setSelectedSessionId(s.id);
                          setSelectedPlacementId(null);
                        }}
                      >
                        <span className="schedule-tray-item__title">
                          {s.title}
                        </span>
                        <span className="schedule-tray-item__meta">
                          {trackName(s.trackId)}
                        </span>
                      </button>
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
