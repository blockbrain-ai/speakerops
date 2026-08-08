/**
 * Event settings — section 2.3.
 *
 * Inventory: C01 create, C07 settings, O01 event fields, O02 rooms, O03 tracks.
 * Wired to real COMMANDS.md APIs (no placeholders).
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  EventCreateBodySchema,
  EventResponseSchema,
  EventUpdateBodySchema,
  RoomListResponseSchema,
  RoomResponseSchema,
  TrackListResponseSchema,
  TrackResponseSchema,
  ErrorEnvelopeSchema,
  uuidv7,
  type EventDto,
  type RoomDto,
  type TrackDto,
} from "@speakerops/shared";
import { useEventContext } from "../events/EventContext.js";

type StatusMsg = { kind: "ok" | "error"; text: string } | null;

export function EventSettingsPage() {
  const { activeEventId, activeEvent, refreshEvents, setActiveEventId } =
    useEventContext();

  // --- Create event (C01) ---
  const [createName, setCreateName] = useState("");
  const [createTz, setCreateTz] = useState("America/New_York");
  const [createStarts, setCreateStarts] = useState("");
  const [createEnds, setCreateEnds] = useState("");
  const [createStatus, setCreateStatus] = useState<StatusMsg>(null);
  const [creating, setCreating] = useState(false);

  // --- Event settings form (O01 / C07) ---
  const [eventDetail, setEventDetail] = useState<EventDto | null>(null);
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [settingsStatus, setSettingsStatus] = useState<StatusMsg>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // --- Rooms (O02) ---
  const [rooms, setRooms] = useState<RoomDto[]>([]);
  const [roomName, setRoomName] = useState("");
  const [roomCapacity, setRoomCapacity] = useState("");
  const [roomStatus, setRoomStatus] = useState<StatusMsg>(null);

  // --- Tracks (O03) ---
  const [tracks, setTracks] = useState<TrackDto[]>([]);
  const [trackName, setTrackName] = useState("");
  const [trackColor, setTrackColor] = useState("");
  const [trackStatus, setTrackStatus] = useState<StatusMsg>(null);

  const loadEventDetail = useCallback(async (eventId: string) => {
    setLoadError(null);
    const res = await fetch(`/api/events/${encodeURIComponent(eventId)}`, {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    if (res.status === 404) {
      // Bootstrap membership without real row — clear form for create/edit
      setEventDetail(null);
      setName(activeEvent?.name ?? eventId);
      setTimezone("UTC");
      setStartsAt("");
      setEndsAt("");
      return;
    }
    if (!res.ok) {
      setLoadError(`Failed to load event (${res.status})`);
      return;
    }
    const raw: unknown = await res.json();
    const parsed = EventResponseSchema.safeParse(raw);
    if (!parsed.success) {
      setLoadError("Invalid event response");
      return;
    }
    const ev = parsed.data.event;
    setEventDetail(ev);
    setName(ev.name);
    setTimezone(ev.timezone);
    setStartsAt(ev.startsAt ?? "");
    setEndsAt(ev.endsAt ?? "");
  }, [activeEvent?.name]);

  const loadRooms = useCallback(async (eventId: string) => {
    const res = await fetch(
      `/api/events/${encodeURIComponent(eventId)}/rooms`,
      {
        credentials: "include",
        headers: { accept: "application/json" },
      },
    );
    if (!res.ok) {
      setRooms([]);
      return;
    }
    const raw: unknown = await res.json();
    const parsed = RoomListResponseSchema.safeParse(raw);
    if (parsed.success) setRooms(parsed.data.rooms);
  }, []);

  const loadTracks = useCallback(async (eventId: string) => {
    const res = await fetch(
      `/api/events/${encodeURIComponent(eventId)}/tracks`,
      {
        credentials: "include",
        headers: { accept: "application/json" },
      },
    );
    if (!res.ok) {
      setTracks([]);
      return;
    }
    const raw: unknown = await res.json();
    const parsed = TrackListResponseSchema.safeParse(raw);
    if (parsed.success) setTracks(parsed.data.tracks);
  }, []);

  useEffect(() => {
    if (!activeEventId) return;
    void loadEventDetail(activeEventId);
    void loadRooms(activeEventId);
    void loadTracks(activeEventId);
  }, [activeEventId, loadEventDetail, loadRooms, loadTracks]);

  async function onCreateEvent(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateStatus(null);
    const body = {
      name: createName,
      timezone: createTz,
      startsAt: createStarts || null,
      endsAt: createEnds || null,
    };
    const valid = EventCreateBodySchema.safeParse(body);
    if (!valid.success) {
      setCreateStatus({ kind: "error", text: "Validation failed" });
      setCreating(false);
      return;
    }
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(valid.data),
      });
      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setCreateStatus({
          kind: "error",
          text: env.success ? env.data.error : `Create failed (${res.status})`,
        });
        setCreating(false);
        return;
      }
      const parsed = EventResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setCreateStatus({ kind: "error", text: "Unexpected response" });
        setCreating(false);
        return;
      }
      setCreateStatus({
        kind: "ok",
        text: `Created ${parsed.data.event.name} (${parsed.data.event.timezone})`,
      });
      setCreateName("");
      setActiveEventId(parsed.data.event.id);
      await refreshEvents();
    } catch {
      setCreateStatus({ kind: "error", text: "Network error" });
    } finally {
      setCreating(false);
    }
  }

  async function onSaveSettings(e: FormEvent) {
    e.preventDefault();
    if (!activeEventId || !eventDetail) {
      setSettingsStatus({
        kind: "error",
        text: "Select a created event (or create one) before saving settings",
      });
      return;
    }
    setSavingSettings(true);
    setSettingsStatus(null);
    const body = {
      name,
      timezone,
      startsAt: startsAt || null,
      endsAt: endsAt || null,
      expectedVersion: eventDetail.version,
    };
    const valid = EventUpdateBodySchema.safeParse(body);
    if (!valid.success) {
      setSettingsStatus({ kind: "error", text: "Validation failed" });
      setSavingSettings(false);
      return;
    }
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(activeEventId)}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(valid.data),
        },
      );
      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setSettingsStatus({
          kind: "error",
          text: env.success ? env.data.error : `Save failed (${res.status})`,
        });
        setSavingSettings(false);
        return;
      }
      const parsed = EventResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setSettingsStatus({ kind: "error", text: "Unexpected response" });
        setSavingSettings(false);
        return;
      }
      setEventDetail(parsed.data.event);
      setSettingsStatus({ kind: "ok", text: "Event settings saved" });
      await refreshEvents();
    } catch {
      setSettingsStatus({ kind: "error", text: "Network error" });
    } finally {
      setSavingSettings(false);
    }
  }

  async function onAddRoom(e: FormEvent) {
    e.preventDefault();
    if (!activeEventId) return;
    setRoomStatus(null);
    const roomId = uuidv7();
    const capacity =
      roomCapacity.trim() === "" ? null : Number.parseInt(roomCapacity, 10);
    if (capacity !== null && Number.isNaN(capacity)) {
      setRoomStatus({ kind: "error", text: "Capacity must be a number" });
      return;
    }
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(activeEventId)}/rooms/${encodeURIComponent(roomId)}`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: roomName, capacity }),
        },
      );
      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setRoomStatus({
          kind: "error",
          text: env.success ? env.data.error : `Room save failed (${res.status})`,
        });
        return;
      }
      const parsed = RoomResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setRoomStatus({ kind: "error", text: "Unexpected room response" });
        return;
      }
      setRoomName("");
      setRoomCapacity("");
      setRoomStatus({ kind: "ok", text: `Room “${parsed.data.room.name}” saved` });
      await loadRooms(activeEventId);
    } catch {
      setRoomStatus({ kind: "error", text: "Network error" });
    }
  }

  async function onAddTrack(e: FormEvent) {
    e.preventDefault();
    if (!activeEventId) return;
    setTrackStatus(null);
    const trackId = uuidv7();
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(activeEventId)}/tracks/${encodeURIComponent(trackId)}`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: trackName,
            color: trackColor.trim() === "" ? null : trackColor.trim(),
          }),
        },
      );
      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setTrackStatus({
          kind: "error",
          text: env.success ? env.data.error : `Track save failed (${res.status})`,
        });
        return;
      }
      const parsed = TrackResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setTrackStatus({ kind: "error", text: "Unexpected track response" });
        return;
      }
      setTrackName("");
      setTrackColor("");
      setTrackStatus({
        kind: "ok",
        text: `Track “${parsed.data.track.name}” saved`,
      });
      await loadTracks(activeEventId);
    } catch {
      setTrackStatus({ kind: "error", text: "Network error" });
    }
  }

  return (
    <div className="event-settings" data-testid="page-settings" data-section="2.3">
      <p className="page-stub__overline">Settings</p>
      <h2 className="page-stub__title">Event settings</h2>
      <p className="page-stub__body">
        Create events, edit name/timezone/dates, and manage rooms and tracks.
      </p>

      {/* C01 — Create event */}
      <section
        className="event-settings__card"
        data-testid="event-create-section"
        aria-labelledby="event-create-heading"
      >
        <h3 id="event-create-heading" className="event-settings__heading">
          Create event
        </h3>
        <form
          className="event-settings__form"
          onSubmit={onCreateEvent}
          data-testid="event-create-form"
        >
          <label className="event-settings__label" htmlFor="create-name">
            Name
          </label>
          <input
            id="create-name"
            className="event-settings__input lumen-focusable"
            data-testid="event-create-name"
            value={createName}
            onChange={(ev) => setCreateName(ev.target.value)}
            required
            maxLength={200}
          />
          <label className="event-settings__label" htmlFor="create-tz">
            Timezone
          </label>
          <input
            id="create-tz"
            className="event-settings__input lumen-focusable"
            data-testid="event-create-timezone"
            value={createTz}
            onChange={(ev) => setCreateTz(ev.target.value)}
            required
            placeholder="America/New_York"
          />
          <label className="event-settings__label" htmlFor="create-starts">
            Starts at
          </label>
          <input
            id="create-starts"
            type="datetime-local"
            className="event-settings__input lumen-focusable"
            data-testid="event-create-starts"
            value={createStarts}
            onChange={(ev) => setCreateStarts(ev.target.value)}
          />
          <label className="event-settings__label" htmlFor="create-ends">
            Ends at
          </label>
          <input
            id="create-ends"
            type="datetime-local"
            className="event-settings__input lumen-focusable"
            data-testid="event-create-ends"
            value={createEnds}
            onChange={(ev) => setCreateEnds(ev.target.value)}
          />
          <button
            type="submit"
            className="event-settings__submit lumen-focusable"
            data-testid="event-create-submit"
            disabled={creating}
          >
            {creating ? "Creating…" : "Create event"}
          </button>
          {createStatus ? (
            <p
              className={
                createStatus.kind === "ok"
                  ? "event-settings__status event-settings__status--ok"
                  : "event-settings__status event-settings__status--error"
              }
              data-testid="event-create-status"
              role="status"
            >
              {createStatus.text}
            </p>
          ) : null}
        </form>
      </section>

      {/* O01 / C07 — Event name/dates/tz */}
      <section
        className="event-settings__card"
        data-testid="event-settings-section"
        aria-labelledby="event-settings-heading"
      >
        <h3 id="event-settings-heading" className="event-settings__heading">
          Active event
        </h3>
        {loadError ? (
          <p className="event-settings__status event-settings__status--error">
            {loadError}
          </p>
        ) : null}
        {!activeEventId ? (
          <p className="page-stub__body">No active event. Create one above.</p>
        ) : (
          <form
            className="event-settings__form"
            onSubmit={onSaveSettings}
            data-testid="event-settings-form"
          >
            <p className="event-settings__meta" data-testid="event-settings-id">
              Event id: {activeEventId}
            </p>
            <label className="event-settings__label" htmlFor="settings-name">
              Name
            </label>
            <input
              id="settings-name"
              className="event-settings__input lumen-focusable"
              data-testid="event-settings-name"
              value={name}
              onChange={(ev) => setName(ev.target.value)}
              required
              disabled={!eventDetail}
            />
            <label className="event-settings__label" htmlFor="settings-tz">
              Timezone
            </label>
            <input
              id="settings-tz"
              className="event-settings__input lumen-focusable"
              data-testid="event-settings-timezone"
              value={timezone}
              onChange={(ev) => setTimezone(ev.target.value)}
              required
              disabled={!eventDetail}
            />
            <label className="event-settings__label" htmlFor="settings-starts">
              Starts at (CFP window open)
            </label>
            <input
              id="settings-starts"
              className="event-settings__input lumen-focusable"
              data-testid="event-settings-starts"
              value={startsAt}
              onChange={(ev) => setStartsAt(ev.target.value)}
              disabled={!eventDetail}
              placeholder="ISO datetime"
            />
            <label className="event-settings__label" htmlFor="settings-ends">
              Ends at (CFP window close)
            </label>
            <input
              id="settings-ends"
              className="event-settings__input lumen-focusable"
              data-testid="event-settings-ends"
              value={endsAt}
              onChange={(ev) => setEndsAt(ev.target.value)}
              disabled={!eventDetail}
              placeholder="ISO datetime"
            />
            <button
              type="submit"
              className="event-settings__submit lumen-focusable"
              data-testid="event-settings-save"
              disabled={savingSettings || !eventDetail}
            >
              {savingSettings ? "Saving…" : "Save settings"}
            </button>
            {settingsStatus ? (
              <p
                className={
                  settingsStatus.kind === "ok"
                    ? "event-settings__status event-settings__status--ok"
                    : "event-settings__status event-settings__status--error"
                }
                data-testid="event-settings-status"
                role="status"
              >
                {settingsStatus.text}
              </p>
            ) : null}
            {!eventDetail ? (
              <p
                className="event-settings__status"
                data-testid="event-settings-bootstrap-hint"
              >
                This event id has no stored row yet. Create an event to edit
                settings.
              </p>
            ) : null}
          </form>
        )}
      </section>

      {/* O02 — Rooms */}
      <section
        className="event-settings__card"
        data-testid="rooms-section"
        aria-labelledby="rooms-heading"
      >
        <h3 id="rooms-heading" className="event-settings__heading">
          Rooms
        </h3>
        <ul className="event-settings__list" data-testid="rooms-list">
          {rooms.length === 0 ? (
            <li className="event-settings__list-empty">No rooms yet</li>
          ) : (
            rooms.map((r) => (
              <li key={r.id} data-testid={`room-item-${r.id}`}>
                <span data-testid="room-item-name">{r.name}</span>
                {r.capacity != null ? (
                  <span className="event-settings__muted"> · cap {r.capacity}</span>
                ) : null}
              </li>
            ))
          )}
        </ul>
        <form
          className="event-settings__form"
          onSubmit={onAddRoom}
          data-testid="room-form"
        >
          <label className="event-settings__label" htmlFor="room-name">
            Room name
          </label>
          <input
            id="room-name"
            className="event-settings__input lumen-focusable"
            data-testid="room-name-input"
            value={roomName}
            onChange={(ev) => setRoomName(ev.target.value)}
            required
            disabled={!activeEventId}
          />
          <label className="event-settings__label" htmlFor="room-capacity">
            Capacity (optional)
          </label>
          <input
            id="room-capacity"
            className="event-settings__input lumen-focusable"
            data-testid="room-capacity-input"
            value={roomCapacity}
            onChange={(ev) => setRoomCapacity(ev.target.value)}
            disabled={!activeEventId}
          />
          <button
            type="submit"
            className="event-settings__submit lumen-focusable"
            data-testid="room-save"
            disabled={!activeEventId}
          >
            Add room
          </button>
          {roomStatus ? (
            <p
              className={
                roomStatus.kind === "ok"
                  ? "event-settings__status event-settings__status--ok"
                  : "event-settings__status event-settings__status--error"
              }
              data-testid="room-status"
              role="status"
            >
              {roomStatus.text}
            </p>
          ) : null}
        </form>
      </section>

      {/* O03 — Tracks */}
      <section
        className="event-settings__card"
        data-testid="tracks-section"
        aria-labelledby="tracks-heading"
      >
        <h3 id="tracks-heading" className="event-settings__heading">
          Tracks
        </h3>
        <ul className="event-settings__list" data-testid="tracks-list">
          {tracks.length === 0 ? (
            <li className="event-settings__list-empty">No tracks yet</li>
          ) : (
            tracks.map((t) => (
              <li key={t.id} data-testid={`track-item-${t.id}`}>
                <span data-testid="track-item-name">{t.name}</span>
                {t.color ? (
                  <span className="event-settings__muted"> · {t.color}</span>
                ) : null}
              </li>
            ))
          )}
        </ul>
        <form
          className="event-settings__form"
          onSubmit={onAddTrack}
          data-testid="track-form"
        >
          <label className="event-settings__label" htmlFor="track-name">
            Track name
          </label>
          <input
            id="track-name"
            className="event-settings__input lumen-focusable"
            data-testid="track-name-input"
            value={trackName}
            onChange={(ev) => setTrackName(ev.target.value)}
            required
            disabled={!activeEventId}
          />
          <label className="event-settings__label" htmlFor="track-color">
            Color (optional)
          </label>
          <input
            id="track-color"
            className="event-settings__input lumen-focusable"
            data-testid="track-color-input"
            value={trackColor}
            onChange={(ev) => setTrackColor(ev.target.value)}
            disabled={!activeEventId}
            placeholder="#4f46e5"
          />
          <button
            type="submit"
            className="event-settings__submit lumen-focusable"
            data-testid="track-save"
            disabled={!activeEventId}
          >
            Add track
          </button>
          {trackStatus ? (
            <p
              className={
                trackStatus.kind === "ok"
                  ? "event-settings__status event-settings__status--ok"
                  : "event-settings__status event-settings__status--error"
              }
              data-testid="track-status"
              role="status"
            >
              {trackStatus.text}
            </p>
          ) : null}
        </form>
      </section>
    </div>
  );
}
