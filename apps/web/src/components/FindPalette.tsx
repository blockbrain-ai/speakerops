/**
 * F5 ⌘K Find palette — permissioned DB search (not genAI).
 * cmdk for keyboard-first navigation; debounced server query.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Command } from "cmdk";
import { useNavigate } from "react-router-dom";
import {
  SearchResponseSchema,
  isAllowedSearchRoute,
  type SearchHit,
  type SearchEntityType,
} from "@speakerops/shared";
import { useEventContextOptional } from "../events/EventContext.js";

const DEBOUNCE_MS = 200;
const RECENTS_KEY = "speakerops.find.recents.v1";
const MAX_RECENTS = 8;

const TYPE_LABEL: Record<SearchEntityType, string> = {
  submission: "Submissions",
  session: "Sessions",
  speaker: "Speakers",
  form: "Forms",
  task: "Tasks",
};

function loadRecents(eventId: string): SearchHit[] {
  try {
    const raw = sessionStorage.getItem(`${RECENTS_KEY}:${eventId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_RECENTS) as SearchHit[];
  } catch {
    return [];
  }
}

function saveRecent(eventId: string, hit: SearchHit): void {
  try {
    const prev = loadRecents(eventId).filter((h) => h.id !== hit.id);
    const next = [hit, ...prev].slice(0, MAX_RECENTS);
    sessionStorage.setItem(`${RECENTS_KEY}:${eventId}`, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
}

export type FindPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function FindPalette({ open, onOpenChange }: FindPaletteProps) {
  const eventCtx = useEventContextOptional();
  const activeEventId = eventCtx?.activeEventId ?? null;
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [recents, setRecents] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freshness, setFreshness] = useState<string | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setHits([]);
    setError(null);
    if (activeEventId) setRecents(loadRecents(activeEventId));
  }, [open, activeEventId]);

  const runSearch = useCallback(
    async (query: string) => {
      if (!activeEventId) {
        setError("Select an event to search");
        setHits([]);
        return;
      }
      const trimmed = query.trim();
      if (!trimmed) {
        setHits([]);
        setLoading(false);
        setError(null);
        return;
      }
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          q: trimmed,
          limit: "20",
        });
        const res = await fetch(
          `/api/events/${encodeURIComponent(activeEventId)}/search?${params}`,
          {
            credentials: "include",
            headers: { accept: "application/json" },
            signal: controller.signal,
          },
        );
        if (controller.signal.aborted) return;
        if (res.status === 401) {
          setError("Session expired — sign in again");
          setHits([]);
          return;
        }
        if (res.status === 403) {
          setError("You don’t have access to search this event");
          setHits([]);
          return;
        }
        if (!res.ok) {
          setError(`Search failed (${res.status})`);
          setHits([]);
          return;
        }
        const parsed = SearchResponseSchema.safeParse(await res.json());
        if (!parsed.success) {
          setError("Unexpected search response");
          setHits([]);
          return;
        }
        setHits(parsed.data.hits);
        setFreshness(parsed.data.freshness);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError("Network error — could not search");
        setHits([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [activeEventId],
  );

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runSearch(q);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, open, runSearch]);

  function go(hit: SearchHit) {
    if (!isAllowedSearchRoute(hit.route)) {
      setError("Blocked unsafe search result route");
      return;
    }
    if (activeEventId) saveRecent(activeEventId, hit);
    onOpenChange(false);
    navigate(hit.route);
  }

  async function rebuildIndex() {
    if (!activeEventId || reindexing) return;
    setReindexing(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(activeEventId)}/search/reindex`,
        {
          method: "POST",
          credentials: "include",
          headers: { accept: "application/json" },
        },
      );
      if (!res.ok) {
        setError(`Index rebuild failed (${res.status})`);
        return;
      }
      const body = (await res.json()) as { freshness?: string; indexed?: number };
      if (body.freshness) setFreshness(body.freshness);
      if (q.trim()) await runSearch(q);
      else setError(null);
    } catch {
      setError("Could not rebuild search index");
    } finally {
      setReindexing(false);
    }
  }

  if (!open) return null;

  const grouped = new Map<SearchEntityType, SearchHit[]>();
  for (const h of hits) {
    const list = grouped.get(h.entityType) ?? [];
    list.push(h);
    grouped.set(h.entityType, list);
  }

  const showRecents = q.trim().length === 0 && recents.length > 0;

  return (
    <div
      className="find-palette"
      data-testid="find-palette"
      role="presentation"
    >
      <button
        type="button"
        className="find-palette__backdrop"
        aria-label="Close find"
        data-testid="find-palette-backdrop"
        onClick={() => onOpenChange(false)}
      />
      <Command
        className="find-palette__dialog"
        label="Find in this event"
        shouldFilter={false}
        loop
      >
        <div className="find-palette__header">
          <Command.Input
            value={q}
            onValueChange={setQ}
            placeholder="Find submissions, sessions, speakers…"
            className="find-palette__input lumen-focusable"
            data-testid="find-input"
            autoFocus
          />
          <kbd className="find-palette__kbd" data-testid="find-kbd-esc">
            esc
          </kbd>
        </div>
        <Command.List
          className="find-palette__list"
          data-testid="find-results"
        >
          {loading ? (
            <Command.Loading>
              <div className="find-palette__state" data-testid="find-loading">
                Searching…
              </div>
            </Command.Loading>
          ) : null}
          {error ? (
            <div
              className="find-palette__state find-palette__state--error"
              data-testid="find-error"
            >
              {error}
            </div>
          ) : null}
          {!loading && !error && q.trim() && hits.length === 0 ? (
            <Command.Empty
              className="find-palette__state"
              data-testid="find-empty"
            >
              <p>No matches for “{q.trim()}”</p>
              <p className="find-palette__hint">
                Try another title, speaker name, or rebuild the index if data
                just changed.
              </p>
              <button
                type="button"
                className="find-palette__reindex lumen-focusable"
                data-testid="find-reindex"
                disabled={reindexing || !activeEventId}
                onClick={() => void rebuildIndex()}
              >
                {reindexing ? "Rebuilding…" : "Rebuild search index"}
              </button>
            </Command.Empty>
          ) : null}
          {!activeEventId && open ? (
            <div
              className="find-palette__state find-palette__state--error"
              data-testid="find-no-event"
            >
              Select an event in the top bar to search its programme.
            </div>
          ) : null}
          {showRecents ? (
            <Command.Group heading="Recent" data-testid="find-recents">
              {recents.map((h) => (
                <Command.Item
                  key={`recent-${h.id}`}
                  value={`${h.title} ${h.entityType} ${h.id}`}
                  onSelect={() => go(h)}
                  data-testid={`find-hit-${h.entityType}-${h.entityId}`}
                >
                  <span className="find-palette__hit-type">
                    {TYPE_LABEL[h.entityType]}
                  </span>
                  <span className="find-palette__hit-title">{h.title}</span>
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}
          {[...grouped.entries()].map(([type, list]) => (
            <Command.Group
              key={type}
              heading={TYPE_LABEL[type]}
              data-testid={`find-group-${type}`}
            >
              {list.map((h) => (
                <Command.Item
                  key={h.id}
                  value={`${h.title} ${h.snippet} ${h.id}`}
                  onSelect={() => go(h)}
                  data-testid={`find-hit-${h.entityType}-${h.entityId}`}
                >
                  <span className="find-palette__hit-title">{h.title}</span>
                  {h.snippet ? (
                    <span className="find-palette__hit-snippet">
                      {h.snippet}
                    </span>
                  ) : null}
                  {h.status ? (
                    <span className="find-palette__hit-status">{h.status}</span>
                  ) : null}
                </Command.Item>
              ))}
            </Command.Group>
          ))}
        </Command.List>
        <div className="find-palette__footer" data-testid="find-footer">
          {freshness ? (
            <span data-testid="find-freshness">
              Index as of {new Date(freshness).toLocaleString()}
            </span>
          ) : (
            <span className="find-palette__hint">
              Search this event’s submissions, sessions, speakers, forms, tasks
            </span>
          )}
          {activeEventId ? (
            <button
              type="button"
              className="find-palette__reindex find-palette__reindex--footer lumen-focusable"
              data-testid="find-reindex-footer"
              disabled={reindexing}
              onClick={() => void rebuildIndex()}
            >
              {reindexing ? "Rebuilding…" : "Rebuild index"}
            </button>
          ) : null}
        </div>
      </Command>
    </div>
  );
}

/** Global ⌘/Ctrl+K binder + topbar trigger. */
export function FindTrigger() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        className="admin-shell__find-trigger lumen-focusable"
        data-testid="topbar-find-trigger"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="admin-shell__find-placeholder">Find in event…</span>
        <kbd className="admin-shell__find-kbd">⌘K</kbd>
      </button>
      <FindPalette open={open} onOpenChange={setOpen} />
    </>
  );
}
