/**
 * Speakers admin pure helpers (section 11.6 / S-L2-PORTAL).
 *
 * Lifecycle readiness dimensions from list/detail fields only —
 * not a portrait gallery CMS. Travel booking CRM is out of scope;
 * "tasks" covers programme readiness (bio/headshot/slides templates).
 */

import type { AdminSpeakerListItem } from "@speakerops/shared";

/** Named readiness dimensions for lifecycle table (page-atlas / design pack). */
export type SpeakerReadinessDimension =
  | "accepted"
  | "confirmed"
  | "profile"
  | "tasks"
  | "session";

export type SpeakerReadiness = {
  accepted: boolean;
  /** Account linked (magic-link / userId) — programme confirmation signal. */
  confirmed: boolean;
  /** Profile has bio, company/title, or headshot pointer. */
  profile: boolean;
  /** No pending/overdue tasks remain. */
  tasks: boolean;
  /** At least one programme session linked. */
  session: boolean;
};

/** Saved views from page-atlas (client-side filter over list payload). */
export type SpeakersViewFilter =
  | "all"
  | "needs_action"
  | "unconfirmed"
  | "profile_incomplete"
  | "travel_tasks";

export const SPEAKERS_VIEW_OPTIONS: ReadonlyArray<{
  value: SpeakersViewFilter;
  label: string;
}> = [
  { value: "needs_action", label: "Needs action" },
  { value: "all", label: "All speakers" },
  { value: "unconfirmed", label: "Unconfirmed" },
  { value: "profile_incomplete", label: "Profile incomplete" },
  { value: "travel_tasks", label: "Travel / tasks" },
] as const;

/**
 * Derive discrete readiness flags for a list row.
 * Dimensions stay separate — never collapse into one vague status chip.
 */
export function deriveSpeakerReadiness(
  item: Pick<
    AdminSpeakerListItem,
    "participation" | "pendingTaskCount" | "completedTaskCount" | "sessionCount"
  >,
): SpeakerReadiness {
  const p = item.participation;
  const status = (p.status ?? "").toLowerCase();
  const accepted =
    status === "accepted" || status === "confirmed" || status === "active";
  const confirmed = Boolean(p.userId);
  const hasText = (v: string | null | undefined) =>
    typeof v === "string" && v.trim().length > 0;
  const profile =
    hasText(p.bio) ||
    hasText(p.company) ||
    hasText(p.title) ||
    Boolean(p.headshotFileId);
  const tasks = item.pendingTaskCount <= 0;
  const session = item.sessionCount > 0;
  return { accepted, confirmed, profile, tasks, session };
}

/** True when operator still has work on this speaker. */
export function speakerNeedsAction(readiness: SpeakerReadiness): boolean {
  return (
    !readiness.accepted ||
    !readiness.confirmed ||
    !readiness.profile ||
    !readiness.tasks ||
    !readiness.session
  );
}

/** Filter list rows by lifecycle view. */
export function filterSpeakersByView(
  speakers: readonly AdminSpeakerListItem[],
  view: SpeakersViewFilter,
): AdminSpeakerListItem[] {
  if (view === "all") return [...speakers];
  return speakers.filter((s) => {
    const r = deriveSpeakerReadiness(s);
    switch (view) {
      case "needs_action":
        return speakerNeedsAction(r);
      case "unconfirmed":
        return !r.confirmed;
      case "profile_incomplete":
        return !r.profile;
      case "travel_tasks":
        return !r.tasks;
      default:
        return true;
    }
  });
}

/** Short label for participation status (admin vocabulary ok here). */
export function participationStatusLabel(status: string): string {
  const s = (status ?? "").trim().toLowerCase();
  if (!s) return "Unknown";
  if (s === "accepted") return "Accepted";
  if (s === "confirmed") return "Confirmed";
  if (s === "withdrawn") return "Withdrawn";
  if (s === "declined") return "Declined";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Count how many readiness dimensions are green (0–5). */
export function readinessScore(readiness: SpeakerReadiness): number {
  let n = 0;
  if (readiness.accepted) n += 1;
  if (readiness.confirmed) n += 1;
  if (readiness.profile) n += 1;
  if (readiness.tasks) n += 1;
  if (readiness.session) n += 1;
  return n;
}

export const READINESS_DIMENSION_LABELS: Record<
  SpeakerReadinessDimension,
  string
> = {
  accepted: "Accepted",
  confirmed: "Confirmed",
  profile: "Profile",
  tasks: "Tasks",
  session: "Session",
};

export const READINESS_DIMENSION_ORDER: SpeakerReadinessDimension[] = [
  "accepted",
  "confirmed",
  "profile",
  "tasks",
  "session",
];
