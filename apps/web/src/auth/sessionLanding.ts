/**
 * Role → SPA landing paths (section 10.4 S-AUTH-ROLES).
 *
 * Keep aligned with Auth.DevRoleSwitch `redirectTo` in
 * `apps/api/src/modules/auth/commands.ts` so magic-link exchange and demo mint
 * land the same shells. Speaker portal **requires** eventId or tasks never load.
 */
import type { EventRole, MagicLinkPurpose } from "@speakerops/shared";
import { DEFAULT_BOOTSTRAP_EVENT_ID } from "@speakerops/shared";

/** Admin shell home. */
export const ADMIN_LANDING = "/admin" as const;

/** Evaluator queue home. */
export const EVALUATOR_LANDING = "/eval" as const;

/**
 * Speaker portal with event context.
 * @param eventId defaults to dogfood bootstrap event when omitted
 */
export function speakerLandingPath(
  eventId: string = DEFAULT_BOOTSTRAP_EVENT_ID,
): string {
  const id = eventId.trim().length > 0 ? eventId.trim() : DEFAULT_BOOTSTRAP_EVENT_ID;
  return `/portal?eventId=${encodeURIComponent(id)}`;
}

/** Landing path for an event membership role (demo switcher / mint). */
export function landingPathForRole(
  role: EventRole,
  eventId: string = DEFAULT_BOOTSTRAP_EVENT_ID,
): string {
  switch (role) {
    case "admin":
      return ADMIN_LANDING;
    case "evaluator":
      return EVALUATOR_LANDING;
    case "speaker":
      return speakerLandingPath(eventId);
    default:
      return "/login";
  }
}

/** Landing path after magic-link exchange (purpose maps 1:1 to role). */
export function landingPathForPurpose(
  purpose: MagicLinkPurpose,
  eventId: string = DEFAULT_BOOTSTRAP_EVENT_ID,
): string {
  return landingPathForRole(purpose, eventId);
}
