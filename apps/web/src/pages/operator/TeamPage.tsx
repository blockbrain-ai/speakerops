/**
 * N6 Event Team — membership roster (admin).
 */
import { useCallback, useEffect, useState } from "react";
import { useEventContext } from "../../events/EventContext.js";
import { PageHeader } from "../../components/ui/PageHeader.js";
import { Button } from "../../components/ui/Button.js";
import { Badge } from "../../components/ui/Badge.js";
import { useToast } from "../../components/ui/Toast.js";
import {
  EventMembersResponseSchema,
  ErrorEnvelopeSchema,
  type EventMember,
} from "@speakerops/shared";

export function TeamPage() {
  const { activeEventId } = useEventContext();
  const toast = useToast();
  const [members, setMembers] = useState<EventMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "evaluator" | "speaker">(
    "evaluator",
  );
  const [inviteBusy, setInviteBusy] = useState(false);

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

  async function sendInvite() {
    if (!activeEventId || !inviteEmail.trim()) return;
    setInviteBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(activeEventId)}/invites`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            email: inviteEmail.trim(),
            role: inviteRole,
          }),
        },
      );
      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const env = ErrorEnvelopeSchema.safeParse(raw);
        setError(env.success ? env.data.error : `Invite failed (${res.status})`);
        return;
      }
      const body = raw as { message?: string; mailEnqueued?: boolean };
      toast.push({
        tone: body.mailEnqueued === false ? "warn" : "success",
        title: body.message ?? "Invite sent",
      });
      setInviteEmail("");
      await load();
    } finally {
      setInviteBusy(false);
    }
  }

  async function changeRole(userId: string, role: string) {
    if (!activeEventId) return;
    setError(null);
    const res = await fetch(
      `/api/events/${encodeURIComponent(activeEventId)}/members/${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ role }),
      },
    );
    if (!res.ok) {
      const raw: unknown = await res.json().catch(() => null);
      const env = ErrorEnvelopeSchema.safeParse(raw);
      setError(env.success ? env.data.error : `Role change failed (${res.status})`);
      return;
    }
    toast.push({ tone: "success", title: "Role updated" });
    await load();
  }

  return (
    <div data-testid="page-team" data-section="n6-team">
      <PageHeader
        eyebrow="Operator"
        title="Event team"
        description="Admins, evaluators, and speakers with membership on this event. Add members by email invite."
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
      ) : (
        <>
          <div className="portal-forms-create" data-testid="team-add-member">
            <label className="portal-label" htmlFor="team-invite-email">
              Email
            </label>
            <input
              id="team-invite-email"
              className="portal-input lumen-focusable"
              data-testid="team-add-member-email"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@example.com"
            />
            <label className="portal-label" htmlFor="team-invite-role">
              Role
            </label>
            <select
              id="team-invite-role"
              className="portal-input lumen-focusable"
              data-testid="team-add-member-role"
              value={inviteRole}
              onChange={(e) =>
                setInviteRole(
                  e.target.value as "admin" | "evaluator" | "speaker",
                )
              }
            >
              <option value="admin">Admin</option>
              <option value="evaluator">Evaluator</option>
              <option value="speaker">Speaker</option>
            </select>
            <Button
              type="button"
              data-testid="team-add-member-submit"
              disabled={inviteBusy || !inviteEmail.trim()}
              onClick={() => void sendInvite()}
            >
              Add member
            </Button>
          </div>
          {error ? (
            <p className="eval-queue__muted" data-testid="team-error">
              {error}
            </p>
          ) : null}
          {members.length === 0 ? (
            <p className="eval-queue__muted" data-testid="team-empty">
              {loading ? "Loading…" : "No members yet — add one above."}
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
                  <select
                    className="portal-input lumen-focusable"
                    data-testid={`team-member-role-${m.userId}`}
                    value={m.role}
                    onChange={(e) => void changeRole(m.userId, e.target.value)}
                    aria-label={`Role for ${m.email}`}
                  >
                    <option value="admin">Admin</option>
                    <option value="evaluator">Evaluator</option>
                    <option value="speaker">Speaker</option>
                  </select>
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
        </>
      )}
    </div>
  );
}
