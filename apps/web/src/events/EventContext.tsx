/**
 * Active event context — section 2.3.
 *
 * Loads Event.List for admin; persists active event id in localStorage.
 * Shell switcher + settings surfaces consume this (testid event-context).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  EventListResponseSchema,
  type EventListItem,
} from "@speakerops/shared";

const STORAGE_KEY = "speakerops.activeEventId";

export type EventContextValue = {
  events: EventListItem[];
  activeEventId: string | null;
  activeEvent: EventListItem | null;
  loading: boolean;
  error: string | null;
  setActiveEventId: (id: string) => void;
  refreshEvents: () => Promise<void>;
};

const EventContext = createContext<EventContextValue | null>(null);

async function fetchEventList(): Promise<EventListItem[]> {
  const res = await fetch("/api/events", {
    method: "GET",
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Event.List failed: ${res.status}`);
  }
  const raw: unknown = await res.json();
  const parsed = EventListResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Event.List response invalid");
  }
  return parsed.data.events;
}

export function EventProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [activeEventId, setActiveEventIdState] = useState<string | null>(() => {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(STORAGE_KEY);
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchEventList();
      setEvents(list);
      setActiveEventIdState((prev) => {
        if (prev && list.some((e) => e.id === prev)) return prev;
        const stored =
          typeof localStorage !== "undefined"
            ? localStorage.getItem(STORAGE_KEY)
            : null;
        if (stored && list.some((e) => e.id === stored)) return stored;
        const first = list[0]?.id ?? null;
        if (first && typeof localStorage !== "undefined") {
          localStorage.setItem(STORAGE_KEY, first);
        }
        return first;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load events");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshEvents();
  }, [refreshEvents]);

  const setActiveEventId = useCallback((id: string) => {
    setActiveEventIdState(id);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, id);
    }
  }, []);

  const activeEvent = useMemo(
    () => events.find((e) => e.id === activeEventId) ?? null,
    [events, activeEventId],
  );

  const value = useMemo<EventContextValue>(
    () => ({
      events,
      activeEventId,
      activeEvent,
      loading,
      error,
      setActiveEventId,
      refreshEvents,
    }),
    [
      events,
      activeEventId,
      activeEvent,
      loading,
      error,
      setActiveEventId,
      refreshEvents,
    ],
  );

  return (
    <EventContext.Provider value={value}>{children}</EventContext.Provider>
  );
}

export function useEventContext(): EventContextValue {
  const ctx = useContext(EventContext);
  if (!ctx) {
    throw new Error("useEventContext must be used within EventProvider");
  }
  return ctx;
}

/** Safe optional hook when provider may be absent (tests). */
export function useEventContextOptional(): EventContextValue | null {
  return useContext(EventContext);
}
