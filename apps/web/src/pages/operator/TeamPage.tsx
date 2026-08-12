/**
 * N6 Event Team — membership roster (admin).
 */
import { useCallback, useEffect, useState } from "react";
import { useEventContext } from "../../events/EventContext.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { Button } from "../../components/ui/Button.js";
import { Badge } from "../../components/ui/Badge.js";
import {
  EventMembersResponseSchema,
  ErrorEnvelopeSchema,
  type EventMember,
} from "@speakerops/shared";

export function TeamPage() {
  const { activeEventId } = useEventContext();
  const [members, setMembers] = useState<EventMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!activeEventId) {
      setMembers([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Members API supports role filter; omit for full team.
      const res = await fetch(
        `/api/events/${encodeURIComponent(activeEventId)}/members`,
        {
          credentials: "include",
          headers: { accept: "application/json" },
        },
      );
      if (!res.ok) {
        // Fallback: load admin + evaluator + speaker slices
        const roles = ["admin", "evaluator", "speaker"] as const;
        const all: EventMember[] = [];
        for (const role of roles) {
          const r = await fetch(
            `/api/events/${encodeURIComponent(activeEventId)}/members?role=${role}`,
            {
              credentials: "include",
              headers: { accept: "application/json" },
            },
          );
          if (!r.ok) continue;
          const p = EventMembersResponseSchema.safeParse(await r.json());
          if (p.success) all.push(...p.data.members);
        }
        if (all.length === 0 && res.status !== 200) {
          const raw: unknown = await res.json().catch(() => null);
          const env = ErrorEnvelopeSchema.safeParse(raw);
          setError(env.success ? env.data.error : `Failed (${res.status})`);
        }
        // de-dupe by userId+role
        const seen = new Set<string>();
        setMembers(
          all.filter((m) => {
            const k = `${m.userId}:${m.role}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          }),
        );
        return;
      }
      const parsed = EventMembersResponseSchema.safeParse(await res.json());
      if (!parsed.success) {
        setError("Unexpected members response");
        setMembers([]);
        return;
      }
      setMembers(parsed.data.members);
    } catch {
      setError("Network error");
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [activeEventId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div data-testid="page-team" data-section="n6-team">
      <PageHeader
        eyebrow="Operator"
        title="Event team"
        description="Admins, evaluators, and speakers with membership on this event."
        data-testid="team-page-header"
        actions={
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid="team-refresh"
            disabled={loading}
            onClick={() => void load()}
          >
            Refresh
          </Button>
        }
      />
      {!activeEventId ? (
        <p className="eval-queue__muted">Select an event.</p>
      ) : error ? (
        <p className="eval-queue__muted" data-testid="team-error">
          {error}
        </p>
      ) : members.length === 0 ? (
        <p className="eval-queue__muted" data-testid="team-empty">
          {loading ? "Loading…" : "No members yet."}
        </p>
      ) : (
        <ul className="team-list" data-testid="team-list">
          {members.map((m) => (
            <li
              key={`${m.userId}-${m.role}`}
              className="team-list__row"
              data-testid={`team-member-${m.userId}`}
            >
              <div>
                <strong>{m.email}</strong>
                <p className="eval-queue__muted">
                  Assignments: {m.assignmentCount}
                </p>
              </div>
              <Badge
                tone={
                  m.role === "admin"
                    ? "info"
                    : m.role === "evaluator"
                      ? "progress"
                      : "neutral"
                }
              >
                {m.role}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
